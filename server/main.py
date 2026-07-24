import asyncio
import math
import random
import time
from datetime import datetime, timedelta
from typing import Optional

from dotenv import load_dotenv
load_dotenv()  # до импорта database/auth ниже — оба читают os.getenv() на уровне модуля

from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import or_, and_, select, delete, update, func
from sqlalchemy.ext.asyncio import AsyncSession

from database import engine, get_db, SessionLocal, Base
from models import User, PlayerState, PlayerProfile, AuditLog, ChatMessage, Friendship, Blacklist, PrivateMessage, EmailVerificationToken, DungeonRun, DungeonLives, MiningBaseState, ArenaDaily
from schemas import (
    RegisterRequest, LoginRequest, TokenResponse, UserResponse,
    VerifyEmailRequest, ChangePasswordRequest, ChangeEmailRequest, ChangeUsernameRequest,
    PlayerStateResponse, AuditEntryCreate, AuditEntryResponse,
    ProfileUpdateRequest, ProfileSelfResponse, ProfilePublicResponse,
    BlacklistAddRequest, BlacklistEntryResponse, BlacklistListResponse,
    PmMessageResponse, PmHistoryResponse, PmMarkReadRequest, PmUnreadSummaryResponse,
    PmThreadResponse, PmThreadsResponse,
    DungeonStatusResponse, DungeonEnterRequest, DungeonEnterResponse,
    DungeonMobKilledRequest, DungeonLootDropRequest, DungeonLootCollectedRequest,
    DungeonCorridorStateRequest, DungeonDeathRequest, DungeonDeathResponse,
    DungeonCompleteRequest, MiningBaseSaveRequest, MiningBaseSectorResponse,
    ArenaStatusResponse, ArenaMatchCompleteRequest, ArenaMatchCompleteResponse,
)
from auth import hash_password, verify_password, create_token, decode_token
from mailer import send_verification_code
from arena import (
    ArenaMatch, ArenaQueueManager, ArenaMatchManager,
    ARENA_TEAM_SIZE, ARENA_LEVEL_SPREAD, ARENA_RESPAWN_MS, ARENA_OFFLINE_ABORT_MS, ARENA_BASE_SAFE_R,
    ARENA_PICKUP_R, ARENA_CAPTURE_R, ARENA_POINT_R, ARENA_POINT_CLAIM_COOLDOWN,
    ARENA_POINT_DURABILITY_PER_CLAIM, ARENA_POINT_MAX_DURABILITY, ARENA_DUEL_ROUNDS_TO_WIN,
    ARENA_CARGO_RESPAWN_SEC, ARENA_FLAG_TOUCH_RETURN_SEC, ARENA_FLAG_DROP_TIMEOUT_SEC,
    ARENA_EARLY_LEAVE_VOID_SEC,
)

app = FastAPI(title="Stellar Drift API", version="0.1.0")


async def _migrate_add_email_column():
    # create_all создаёт таблицы только "если не существует" — не добавляет колонки
    # к уже существующим (нет Alembic в проекте). PRAGMA table_info — явная проверка,
    # т.к. повторный ALTER TABLE ADD COLUMN на SQLite падает ошибкой "duplicate column".
    async with engine.begin() as conn:
        def _check_and_alter(sync_conn):
            cols = {r[1] for r in sync_conn.exec_driver_sql("PRAGMA table_info(users)").fetchall()}
            if "email" not in cols:
                sync_conn.exec_driver_sql("ALTER TABLE users ADD COLUMN email VARCHAR(255)")
                sync_conn.exec_driver_sql("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users(email)")
            if "email_verified" not in cols:
                sync_conn.exec_driver_sql("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0")
            if "username_changed_at" not in cols:
                sync_conn.exec_driver_sql("ALTER TABLE users ADD COLUMN username_changed_at DATETIME")
        await conn.run_sync(_check_and_alter)


@app.on_event("startup")
async def _create_tables():
    # create_all — синхронный вызов metadata, run_sync прогоняет его через
    # обычное DBAPI-соединение движка (aiosqlite) без блокировки event loop
    # (см. диалог про переход на async SQLAlchemy).
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await _migrate_add_email_column()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

bearer = HTTPBearer()


# ── Chat ─────────────────────────────────────────────────────────────

# Потолок одновременных подключений на бета-тест (см. нагрузочный тест —
# server/loadtest.py: SQLite/aiosqlite упирается в контеншн на открытии новых
# соединений уже при ~80-90 одновременно живых WS). 100 — это ПОЛЬЗОВАТЕЛИ
# (уникальные uid), не сокеты: реконнект того же игрока не съедает слот.
MAX_CONCURRENT_USERS = 100


class ChatManager:
    def __init__(self):
        self.active: dict = {}

    def is_full(self, uid: int) -> bool:
        existing_uids = {m['uid'] for m in self.active.values()}
        return uid not in existing_uids and len(existing_uids) >= MAX_CONCURRENT_USERS

    async def connect(self, ws: WebSocket, uid: int, name: str, corp_ch: str, clan_ch):
        # Один пользователь — одно активное соединение. Без этого повторный коннект
        # (reload вкладки, реконнект-таймер в HudScene) оставлял старое соединение
        # висеть в self.active — send_to_uid находит ПЕРВОЕ совпадение по uid, которое
        # могло оказаться как раз мёртвым/зависшим, и активная вкладка переставала
        # получать вообще какие-либо ответы (только исходящие pvp_pos, без ответов).
        stale = [w for w, m in self.active.items() if m.get('uid') == uid]
        for w in stale:
            self.active.pop(w, None)
            try:
                await w.close(code=4000)
            except Exception:
                pass
        await ws.accept()
        self.active[ws] = {'uid': uid, 'name': name, 'corp_ch': corp_ch, 'clan_ch': clan_ch, 'sector': ''}

    def disconnect(self, ws: WebSocket):
        self.active.pop(ws, None)

    async def _send(self, ws: WebSocket, data: dict) -> bool:
        try:
            # Таймаут — иначе зависшая/мёртвая (но формально не разорванная) сторона
            # стопорит этот await навсегда, а с ним и весь однопоточный event loop:
            # ни другие сообщения, ни новые подключения не обработаются, пока сервер
            # ждёт ответа от давно неживого сокета.
            await asyncio.wait_for(ws.send_json(data), timeout=5.0)
            return True
        except Exception:
            return False

    async def broadcast(self, channel: str, data: dict):
        dead = []
        for ws, m in list(self.active.items()):
            ok = (
                channel == 'general' or
                channel == m.get('corp_ch') or
                (channel.startswith('clan_') and channel == m.get('clan_ch'))
            )
            if ok and not await self._send(ws, data):
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    async def send_pm(self, to_name: str, data: dict):
        for ws, m in list(self.active.items()):
            if m['name'] == to_name:
                await self._send(ws, data)
                break

    async def send_to_uid(self, uid: int, data: dict):
        for ws, m in list(self.active.items()):
            if m.get('uid') == uid:
                await self._send(ws, data)
                return

    async def broadcast_to_uids(self, uids, data: dict, exclude_uid: int | None = None):
        # Раньше это звало send_to_uid(uid) в цикле — КАЖДЫЙ вызов заново линейно
        # сканирует self.active (ВСЕ соединения сервера, не только эту комнату),
        # т.е. O(получателей × всех_соединений) ПОСЛЕДОВАТЕЛЬНЫХ await на один
        # broadcast. Для редких разовых рассылок (бонус, PM) это было незаметно, но
        # новый серверный тик мобов (см. _mob_tick_loop, ~6 раз/сек) — первый в
        # кодовой базе caller, который зовёт это часто и с размером комнаты в
        # получателях; при ~100 одновременных игроках нагрузочный тест
        # (loadtest.py --drones) показал реальную деградацию — часть НОВЫХ WS-
        # хэндшейков не успевала за то время, пока event loop последовательно рассылал
        # тик всем. Строим uid→ws один раз (O(соединений)) и шлём конкурентно.
        uid_set = set(uids)
        if exclude_uid is not None:
            uid_set.discard(exclude_uid)
        if not uid_set:
            return
        targets = [ws for ws, m in list(self.active.items()) if m.get('uid') in uid_set]
        if targets:
            await asyncio.gather(*(self._send(ws, data) for ws in targets))


chat_manager = ChatManager()


# ── Group & Dungeon Instance Manager ──────────────────────────────────
# TODO: перенести хранение групп и cooldown в БД (player_state.state.dungeonCooldowns)
#       когда будет готова полная мультиплеер-инфраструктура.

class DungeonInstance:
    def __init__(self, dungeon_key: str, leader: str, instance_id: str, solo: bool = False):
        self.dungeon_key  = dungeon_key
        self.leader       = leader
        self.instance_id  = instance_id
        self.solo         = solo          # True → нельзя добавить игроков после старта
        self.members: dict = {leader: {'damage': 0.0, 'heal': 0.0}}
        self.boss_alive   = True
        self.boss_hp_ratio = 1.0
        self.locked       = False         # закрыт после гибели босса


class GroupManager:
    def __init__(self):
        self.groups: dict[str, DungeonInstance] = {}   # leader_name → instance
        self.player_group: dict[str, str] = {}         # player_name → leader_name

    # ── создать группу / соло-инстанс ────────────────────────────────
    def create(self, leader: str, dungeon_key: str, solo: bool = False) -> str:
        self.leave(leader)  # покинуть предыдущую группу
        iid = f"{dungeon_key}_{leader}_{int(time.time())}"
        inst = DungeonInstance(dungeon_key, leader, iid, solo)
        self.groups[leader] = inst
        self.player_group[leader] = leader
        return iid

    # ── пригласить игрока (сервер только пересылает invite) ──────────
    def can_join(self, leader: str) -> str | None:
        inst = self.groups.get(leader)
        if not inst:                   return "Группа не найдена"
        if inst.locked:                return "Босс уже убит"
        if inst.solo:                  return "Соло-режим, вход запрещён"
        if not inst.boss_alive:        return "Данж завершён"
        if len(inst.members) >= 8:    return "Группа заполнена (макс. 8)"
        return None

    # ── принять приглашение ──────────────────────────────────────────
    def join(self, player: str, leader: str) -> tuple[str | None, str | None]:
        reason = self.can_join(leader)
        if reason:
            return None, reason
        self.leave(player)
        inst = self.groups[leader]
        inst.members[player] = {'damage': 0.0, 'heal': 0.0}
        self.player_group[player] = leader
        return inst.instance_id, None

    # ── покинуть группу ──────────────────────────────────────────────
    def leave(self, player: str):
        leader = self.player_group.pop(player, None)
        if not leader:
            return
        inst = self.groups.get(leader)
        if not inst:
            return
        inst.members.pop(player, None)
        if player == leader:
            for m in list(inst.members.keys()):
                self.player_group.pop(m, None)
            del self.groups[leader]

    # ── получить инстанс игрока ──────────────────────────────────────
    def get_instance(self, player: str) -> DungeonInstance | None:
        return self.groups.get(self.player_group.get(player, ''))

    # ── записать урон ─────────────────────────────────────────────────
    def record_damage(self, player: str, amount: float):
        inst = self.get_instance(player)
        if inst and player in inst.members:
            inst.members[player]['damage'] += amount

    def record_heal(self, player: str, amount: float):
        inst = self.get_instance(player)
        if inst and player in inst.members:
            inst.members[player]['heal'] += amount

    # ── босс убит → пропорциональное распределение золота/credits/xp ─
    # Раньше делилось только золото — credits/xp каждый член группы начислял себе
    # ПОЛНОСТЬЮ и независимо на клиенте (баг: группа из N игроков получала ×N
    # суммарной награды за один и тот же килл). Теперь все три пула делятся
    # ОДНИМ и тем же соотношением урон+хил, как и было для золота.
    def boss_died(self, player: str, base_gold: int, base_credits: int = 0, base_xp: int = 0) -> dict[str, dict[str, int]]:
        inst = self.get_instance(player)
        if not inst:
            return {player: {'gold': base_gold, 'credits': base_credits, 'xp': base_xp}}
        inst.boss_alive = False
        inst.locked = True
        pool = {n: (v['damage'] + v['heal']) for n, v in inst.members.items()}
        total = sum(pool.values())
        if total == 0:
            share = 1.0 / len(pool)
            ratios = {n: share for n in pool}
        else:
            ratios = {n: v / total for n, v in pool.items()}
        return {
            n: {
                'gold': max(1, round(base_gold * r)) if base_gold > 0 else 0,
                'credits': max(1, round(base_credits * r)) if base_credits > 0 else 0,
                'xp': max(1, round(base_xp * r)) if base_xp > 0 else 0,
            }
            for n, r in ratios.items()
        }

    # ── список участников для UI ──────────────────────────────────────
    def members_list(self, player: str) -> list[str]:
        inst = self.get_instance(player)
        return list(inst.members.keys()) if inst else []


group_manager = GroupManager()

# ── Арена: очередь + матчи (см. arena.py) ──────────────────────────────
arena_queue = ArenaQueueManager()
arena_matches = ArenaMatchManager()
ARENA_DAILY_CAP = 10
ARENA_REWARD = {'win': {'honor': 50, 'gold': 5}, 'draw': {'honor': 10, 'gold': 2}}
ARENA_MODE_SECTOR = {'flag': 'arena_flag', 'points': 'arena_points', 'cargo': 'arena_cargo', 'duel': 'arena_duel'}
ARENA_COUNTDOWN_SEC = 5.0  # обратный отсчёт до боя — зеркалит клиентский ArenaController.countdownActive

# Абсолютные мировые координаты баз/точек/спавна груза — ДОЛЖНЫ совпадать с offset'ами
# в client/src/data/arenaLayouts.js (там координаты заданы от центра мира, здесь —
# центр + offset, т.к. серверные PvpPlayerState.x/y абсолютны, как this.player.x/y).
ARENA_BASE_WORLD_W, ARENA_BASE_WORLD_H = 8315.0, 4680.0
ARENA_3V3_SCALE, ARENA_1V1_SCALE = 0.85, 0.6


def _arena_world_center(scale: float) -> tuple[float, float]:
    return (ARENA_BASE_WORLD_W * scale / 2.0, ARENA_BASE_WORLD_H * scale / 2.0)


_ax3, _ay3 = _arena_world_center(ARENA_3V3_SCALE)
_ax1, _ay1 = _arena_world_center(ARENA_1V1_SCALE)

ARENA_SPAWNS = {
    'flag':   ((_ax3 - 2900, _ay3 - 1400), (_ax3 + 2900, _ay3 + 1400)),
    'points': ((_ax3 - 3300, _ay3), (_ax3 + 3300, _ay3)),
    'cargo':  ((_ax3 - 3000, _ay3), (_ax3 + 3000, _ay3)),
    'duel':   ((_ax1 - 1200, _ay1), (_ax1 + 1200, _ay1)),
}
ARENA_CARGO_SPAWN = (_ax3, _ay3)
# Точки: B всегда в центре (истинный центр карты, максимально нейтрально), A/C — по
# одной ближе к каждой базе, но случайное расстояние НА МАТЧ (см. диалог: "точки
# сделать случайный разброс с условием 2 точки ближе к каждой из баз, одна в
# центре") — тот же принцип, что ArenaMatch.maze_variant: сервер кидает кубик один
# раз при создании матча (см. arena_queue_join), обе стороны получают ОДНО и то же
# значение через arena_match_found. Клиренс под стены режется в рантайме
# (GameScene.js clipLine, круг R=260 на реальной позиции этого матча), не запечён
# статически — не нужно плодить лабиринт под каждый офсет.
ARENA_POINT_OFFSET_CHOICES = (1200.0, 1600.0, 2000.0)
# A/C раньше сидели на той же строке сетки лабиринта (y=0), что и обе базы — весь
# матч сводился к полёту по одному горизонтальному коридору (баг из диалога: "3
# точки на одной линии — нет смысла летать кроме как по одной линии"). Сдвигаем их
# на соседние ряды сетки (шаг ~583, см. arenaLayouts.js), в противоположные стороны
# — по диагонали от своих баз, а не по одной прямой.
ARENA_POINT_ROW_OFFSET = 583.0


def _arena_point_positions(offset: float) -> dict[str, tuple[float, float]]:
    return {
        'A': (_ax3 - offset, _ay3 - ARENA_POINT_ROW_OFFSET),
        'B': (_ax3, _ay3),
        'C': (_ax3 + offset, _ay3 + ARENA_POINT_ROW_OFFSET),
    }

# Уровень пилота — из БД PlayerState.state['pilotXp'] (не из client-claimed loadout на
# pvp_enter, см. план risk#2), формула — намеренный порт client/src/leveling.js
# (xpToNext/levelInfo). Как и LASER_SHIELD_MULT/PVP_BURST_MULT выше — дублирование
# клиентской формулы, синхронизировать вручную при изменении кривой опыта.
ARENA_MAX_LEVEL = 50


def _xp_to_next(level: int) -> float:
    if level >= ARENA_MAX_LEVEL:
        return float('inf')
    knee = max(0, level - 25)
    base = 40 * level * level + 13 * (knee ** 3)
    if level >= 46:
        return base * 6
    if level >= 40:
        return base * 4.5
    return base


def _level_from_xp(total_xp: float) -> int:
    level, acc = 1, 0.0
    while level < ARENA_MAX_LEVEL:
        need = _xp_to_next(level)
        if total_xp < acc + need:
            break
        acc += need
        level += 1
    return level


async def _player_level(db: AsyncSession, user_id: int) -> int:
    ps = (await db.execute(select(PlayerState).where(PlayerState.user_id == user_id))).scalar_one_or_none()
    xp = ((ps.state or {}).get('pilotXp') or 0) if ps else 0
    return _level_from_xp(float(xp))


# ── PvP: live-позиции и бой игрок-игрок в PvP-секторах ─────────────────
# In-memory, как GroupManager выше — тот же допущение "один воркер, не
# переживает перезапуск", уже принятое для групп/чата в этом кодбейзе.
# Сервер авторитетен только для PvP-взаимодействия игрок-игрок; мобы/PvE
# в этих же секторах остаются полностью клиент-локальными как раньше.

PVP_FIRE_COOLDOWN_FLOOR = 0.15   # сек — ниже этого порога клиенту не верим при любом заявленном КД
PVP_MAX_RANGE  = 1600.0          # px — потолок дальности (админ-лазер клиента максимум 1500 + запас)
PVP_MAX_DAMAGE = 6000.0          # потолок БАЗОВОГО урона (loadout, без баффов) — выше топовых базовых
                                 # значений не бывает; сам per-shot урон см. PVP_BURST_MULT ниже.
# Клиент репортит РЕАЛЬНО посчитанный урон каждого выстрела (после скилл-баффов
# овердрайва/берсерка/залпа, перков, элитных патронов — см. GameScene._fireCannon/
# _fireLaser), а не полагается на статичный loadout.dmg весь визит в комнату (иначе
# крит-билд/овердрайв ощущались бы одинаково слабо). Сервер не пересчитывает эти
# баффы сам (это долг, недостижимый без полного дублирования боевой формулы), но
# и не доверяет заявке безоговорочно — зажимает потолком в PVP_BURST_MULT раз
# больше статичного loadout.dmg (щедрый, но конечный допуск на бёрст).
PVP_BURST_MULT = 3.0
# Лазер слабее по щиту / сильнее по корпусу — зеркалит client/src/entities/Player.js
# weaponShieldMult/weaponHullMult (GameScene.js:7612-7613). Раньше эта асимметрия
# нигде не долетала до сервера (клиент слал только dmg + строку weaponType, которая
# использовалась исключительно как визуальная метка для VFX) — _apply_pvp_damage
# бил один и тот же плоский penetration-сплит для лазера и пушки, из-за чего лазер
# по турелям/вагонам/игрокам в PvP наносил в корпус ровно столько же, сколько в щит
# (баг из диалога: "лазер наносит одинаково урона что по щиту что по корпусу").
# Считаем по строке weaponType, присланной клиентом, а НЕ доверяем клиентским
# множителям напрямую — то же обоснование, что и у остального PvP-урона (заявка
# только "чем стреляли", величину эффекта решает сервер по фиксированным правилам.
LASER_SHIELD_MULT = 0.90
LASER_HULL_MULT   = 1.30


def _weapon_mults(weapon_type: str) -> tuple[float, float]:
    if weapon_type == 'laser':
        return LASER_SHIELD_MULT, LASER_HULL_MULT
    return 1.0, 1.0
# Крит-шанс/множитель — по статам АТАКУЮЩЕГО игрока (loadout.critChance/critMult),
# а не фиксированные для всех: иначе билд с высоким личным крит-шансом ощущался бы
# так же, как билд без него вообще. Ролл всё равно решает сервер, не клиент —
# доверять client-claimed isCrit нельзя (свободный крит на каждый выстрел).
PVP_CRIT_CHANCE_CAP = 0.45   # потолок — тот же, что у клиента (Player.js:critChance)
PVP_CRIT_MULT_CAP   = 3.0    # потолок — тот же, что у клиента (Player.js:critMult)

# Пассивный реген (см. PvpPlayerState.last_hp_sync_at) — потолок ЗАЯВЛЕННОГО роста
# hull/shield за секунду, не точная копия клиентской формулы (та зависит от кучи
# факторов — перки/борды/скиллы/тип корпуса), а щедрый, но конечный допуск в том же
# духе, что PVP_BURST_MULT: реальный реген (5%/с корпус, максимум в районе тех же
# единиц % у щита) всегда пройдёт, а "заявить себе мгновенно полный хил" — нет.
PVP_REGEN_RATE_CEILING = 0.20  # доля от max за секунду

# План Фаза 3.1 (offline-ship): PvpPlayerState.hull/maxHull/shield/maxShield сегодня
# сознательно НЕ валидируются на входе (см. _clamp_pvp_loadout ниже — там только боевые
# статы) — приемлемо для живого, постоянно переподтверждаемого соединения, но не для
# значения, которое дальше часами будет авторитетным в OfflineShipManager без клиента
# рядом, который мог бы его исправить. Потолок — выше топового легитимного (admin
# Аргус 500k щита, см. CLAUDE.md) с запасом, тот же принцип, что и у PVP_MAX_DAMAGE.
PVP_MAX_HULL   = 700000.0
PVP_MAX_SHIELD = 700000.0

# Активные способности Аргуса (DEV key 8) — потолок урона и per-ability кулдаун-флор
# (не общий attacker.loadout['cooldown']/last_shot_at обычного оружия, см.
# PvpPlayerState.ability_last_fire). Значения — с запасом над реальным уроном
# способности (client/src/systems/ArgusController.js: pulsar 900/тик, missile 2000),
# тот же принцип "щедрый, но конечный допуск", что и PVP_BURST_MULT ниже.
ABILITY_DAMAGE_CEILING = {'argus_pulsar': 1000.0, 'argus_missile': 2500.0}
ABILITY_COOLDOWN_FLOOR = {'argus_pulsar': 0.08, 'argus_missile': 0.03}

# "Фазовый кокон" (см. pvp_self_heal_claim) — сервер сам считает сумму хила от своего
# max_hull/max_shield (% фиксирован, клиентской заявке тут доверять нечему), только
# кулдаун-флор нужен как страховка от спама. Значения зеркалят клиент
# (ArgusController._activateCocoon: 30% хил, 2с неуязвимость; GameScene._skillCooldownMs:
# 'argus:cocoon' 60с) — с тем же запасом "щедрый, но конечный допуск", что и выше.
ABILITY_HEAL_PCT = {'argus_cocoon': 0.30}
ARGUS_COCOON_COOLDOWN_FLOOR = 55.0
ARGUS_COCOON_INVULN_SEC = 2.0

# Щит-дрон (расходник, покупка только в магазине, см. память roadmap-future) — визуально
# видимый всем в комнате дрон, который владелец разворачивает рядом с собой на 1 мин (или
# до уничтожения). Позиция дрона НЕ синкается отдельно — каждый клиент рисует его как
# оффсет (сбоку/сзади в зависимости от скорости, см. client ShieldDrone.js) от уже
# реплицируемой позиции владельца (pvp_pos/RemotePlayer), сервер хранит только
# HP-бухгалтерию и авторитетно решает урон, тем же контрактом pvp_hit_result, что и
# обычный выстрел по кораблю (см. _resolve_pvp_hit ниже). Одна активная копия на игрока —
# новая активация до истечения старой невозможна (кулдаун-флор длиннее длительности).
SHIELD_DRONE_MAX_HULL = 10000.0
SHIELD_DRONE_MAX_SHIELD = 15000.0
SHIELD_DRONE_DURATION_SEC = 60.0
SHIELD_DRONE_COOLDOWN_FLOOR = 300.0  # 5 мин
# Обычный выстрел по КОРАБЛЮ владельца при активном дроне: 90% урона уходит на дрон (и
# дополнительно снижен вдвое), 10% — на владельца как есть (см. диалог с пользователем).
SHIELD_DRONE_REDIRECT_PCT = 0.90
SHIELD_DRONE_REDIRECT_REDUCTION = 0.50
# Прямое прицеливание на САМ дрон (см. GameScene shieldDroneAt/isShieldDrone) — снижение
# слабее (30%, не 50%) — так дрон дешевле выбить прицельным огнём, чем полагаться только
# на перенаправление с владельца (по дизайну пользователя).
SHIELD_DRONE_DIRECT_REDUCTION = 0.30

# Турели добывающих баз — залп НЕ привязан к личному оружию/лоадауту конкретного
# игрока (иначе конфликтовал бы с cooldown/range того игрока, чей клиент случайно
# первым отправил заявку). Каждый игрок, видящий базу, крутит свою локальную копию
# MiningBase._updateTurrets — все они независимо решают "пора стрелять" по одному
# и тому же слоту почти одновременно; turret_last_fire (см. PvpRoomManager)
# дедуплицирует это в один засчитанный залп за минимальный интервал турели, чтобы
# урон турели не рос с числом наблюдателей рядом с базой. Значения — зеркало
# client/src/bases.js BASE_CONFIG (cannon1/cannon2 range/damage/rate); 'damage' —
# базовое значение для pvp4/pvp5 (коэф. 1.0), см. _turret_damage_mult ниже —
# дальность/КД тиром НЕ масштабируются, только урон.
TURRET_WEAPONS = {
    'cannon1': {'damage': 500.0,  'range': 600.0, 'minInterval': (1.0 / 1) * 0.9},
    'cannon2': {'damage': 1000.0, 'range': 650.0, 'minInterval': (1.0 / 1) * 0.9},
}


def _turret_damage_mult(pvp_tier) -> float:
    """Зеркало pvpTierMult в client/src/bases.js — урон турели слабее заявленного
    базового на pvp1-3, полная сила на pvp4/pvp5."""
    tier = int(pvp_tier or 1)
    if tier <= 1: return 0.3
    if tier == 2: return 0.6
    if tier == 3: return 0.8
    return 1.0


def _clamp_pvp_loadout(loadout: dict) -> dict:
    """Потолки заявленного лоадаута — клиент репортит свои эффективные статы (сервер их
    не пересчитывает, perks/skills/boards целиком на клиенте), но зажимает в разумные
    границы для последующей валидации попаданий. Общая для __init__ и pvp_update_loadout
    (см. Player.recomputeStats — без обновления "на лету" смена корабля/экипировки/уровня
    ПОСЛЕ входа в комнату оставляла бы сервер с протухшим потолком на весь остаток визита)."""
    return {
        'dmg':         max(0.0, min(float(loadout.get('dmg', 0)), PVP_MAX_DAMAGE)),
        'range':       max(1.0, min(float(loadout.get('range', 800)), PVP_MAX_RANGE)),
        'cooldown':    max(PVP_FIRE_COOLDOWN_FLOOR, float(loadout.get('cooldown', 1.0))),
        'penetration': max(0.0, min(float(loadout.get('penetration', 0)), 0.6)),
        # Статическое уклонение (перки/скиллы/борды) — потолок 0.30, тот же, что и у
        # клиента (Player.js:this.evasion). Движение-based часть (до +0.12 от скорости)
        # не моделируем — сервер не знает скорость игрока, только позицию раз в ~100мс,
        # это отдельная неточность, принятая вместе с клиент-локальным движением.
        'evasion':     max(0.0, min(float(loadout.get('evasion', 0)), 0.30)),
        'critChance':  max(0.0, min(float(loadout.get('critChance', 0)), PVP_CRIT_CHANCE_CAP)),
        'critMult':    max(1.0, min(float(loadout.get('critMult', 2.0)), PVP_CRIT_MULT_CAP)),
    }


def _clamp_offline_hp(hull: float, max_hull: float, shield: float, max_shield: float) -> tuple[float, float, float, float]:
    """План Фаза 3.1 — потолок HP-снапшота при уходе в офлайн, см. PVP_MAX_HULL/SHIELD выше."""
    max_hull   = max(1.0, min(float(max_hull), PVP_MAX_HULL))
    max_shield = max(0.0, min(float(max_shield), PVP_MAX_SHIELD))
    hull   = max(0.0, min(float(hull), max_hull))
    shield = max(0.0, min(float(shield), max_shield))
    return hull, max_hull, shield, max_shield


class PvpPlayerState:
    def __init__(self, user_id: int, username: str, x: float, y: float, loadout: dict):
        self.user_id  = user_id
        self.username = username
        self.ship_key = str(loadout.get('shipKey', ''))[:40]  # только для рендера у др. клиентов, не участвует в валидации
        self.corp = str(loadout.get('corp') or 'neutral')[:20]  # для запрета дружественного огня, см. pvp_fire_claim
        self.level = max(1, int(loadout.get('level') or 1))  # для честного тира чести (PVP_HIGHER/EQUAL/LOWER), см. pvp_fire_claim
        # rankId/clanTag — чисто для нашивки над кораблём у других клиентов (см. клиент
        # RemotePlayer._refreshNameplate), сервер их ни во что не подставляет.
        rank_id = loadout.get('rankId')
        self.rank_id: int | None = int(rank_id) if rank_id is not None else None
        self.clan_tag: str | None = (str(loadout['clanTag'])[:8] if loadout.get('clanTag') else None)
        self.x = float(x)
        self.y = float(y)
        self.heading = 0.0
        # План Фаза 3.1 (offline-ship): waypoint/speed нужны, чтобы на дисконнекте было,
        # от чего продолжать полёт — раньше сервер знал только последнюю позицию/heading
        # (см. update_pos), сам курс/скорость были чисто клиент-локальными (Movement.js).
        # None пока клиент ни разу не прислал pvp_pos с активным курсом.
        self.waypoint_x: float | None = None
        self.waypoint_y: float | None = None
        self.speed = 0.0
        self.hull        = float(loadout.get('hull', 1))
        self.max_hull    = max(1.0, float(loadout.get('maxHull', 1)))
        self.shield      = float(loadout.get('shield', 0))
        self.max_shield  = max(0.0, float(loadout.get('maxShield', 0)))
        self.loadout = _clamp_pvp_loadout(loadout)
        self.last_shot_at = 0.0
        # Пассивный реген (щит/корпус, см. Player.js update()) считается целиком на
        # клиенте — pvp_update_loadout периодически репортит РОСТ hull/shield (см. диалог:
        # "актуально — полная жизнь... над кораблём врага и на экране — неактуально"),
        # зажатый PVP_REGEN_RATE_CEILING*elapsed от last_hp_sync_at, чтобы клиент не мог
        # заявить мгновенный полный хил тем же путём.
        self.last_hp_sync_at = time.time()
        # Кто наносил урон этой жизни игрока (uid → суммарный урон) — используется,
        # чтобы решить, кому будет виден лут-бокс после смерти (см. PvpLootBox). Сбрасывается
        # при килле в last_death_eligible.
        self.damage_by: dict[int, float] = {}
        self.last_death_eligible: list[int] = []
        # 3с неуязвимости после "ремонта на месте" (см. GameScene.finishRespawn) —
        # выставляется в _resolve_pvp_hit сразу на килле (сервер и так мгновенно
        # "респавнит" hull/shield в своей бухгалтерии, см. _apply_pvp_damage). Снимается
        # досрочно, как только сама жертва атакует (см. pvp_fire_claim/pvp_mob_fire_claim —
        # открытие огня сбрасывает это поле в 0).
        self.respawn_grace_until = 0.0
        # Активные способности (Аргус: pulsar/missiles и т.п., см. pvp_ability_fire_claim)
        # — СВОЙ per-ability кулдаун-флор, не общий last_shot_at обычного оружия: залп
        # пульсара/ракет на порядок мощнее и тикает намного чаще одиночного выстрела,
        # общий гейт душил бы почти все попадания (баг из диалога: "не действуют на
        # других игроков" — способности вообще не были рассчитаны на игроков, били
        # только мобов).
        self.ability_last_fire: dict[str, float] = {}
        # "Фазовый кокон" (argus:cocoon, см. ArgusController._activateCocoon) — раньше
        # хил+неуязвимость были ЧИСТО клиент-локальными: сервер никогда не узнавал ни о
        # заживлении (следующий хит считался от старого, незалеченного hull — баг из
        # диалога "бар хп/щита у противника неактуальный"), ни о самой неуязвимости
        # (кокон визуально защищал, а сервер всё равно засчитывал полный урон). См.
        # pvp_self_heal_claim.
        self.invulnerable_until = 0.0
        # Щит-дрон (см. SHIELD_DRONE_* выше) — 0.0 active_until = нет активного дрона.
        # last_use — свой кулдаун-флор, отдельный от respawn_grace/invulnerable (тот же
        # принцип, что ability_last_fire — своя механика, свой таймер).
        self.shield_drone_last_use = 0.0
        self.shield_drone_active_until = 0.0
        self.shield_drone_hull = 0.0
        self.shield_drone_shield = 0.0

    def to_public(self) -> dict:
        now = time.time()
        drone_active = self.shield_drone_active_until > now
        return {
            'userId': self.user_id, 'name': self.username, 'shipKey': self.ship_key,
            'corp': self.corp, 'level': self.level,
            'rankId': self.rank_id, 'clanTag': self.clan_tag,
            'x': self.x, 'y': self.y, 'heading': self.heading,
            'hull': self.hull, 'maxHull': self.max_hull,
            'shield': self.shield, 'maxShield': self.max_shield,
            # Снапшот для клиента, ПРИСОЕДИНИВШЕГОСЯ к комнате, пока чей-то дрон уже
            # летает (pvp_room_snapshot/pvp_player_joined) — без этого поздний джойнер
            # не узнал бы о нём вообще (нет отдельного "спавн всем" при входе задним числом).
            'droneActive': drone_active,
            'droneHull': self.shield_drone_hull if drone_active else 0.0,
            'droneMaxHull': SHIELD_DRONE_MAX_HULL,
            'droneShield': self.shield_drone_shield if drone_active else 0.0,
            'droneMaxShield': SHIELD_DRONE_MAX_SHIELD,
            'droneRemainingSec': max(0.0, self.shield_drone_active_until - now) if drone_active else 0.0,
        }


class PvpMobState:
    """Общий на всех игроков в секторе HP-леджер моба. Позиция/AI моба остаются
    клиент-локальными (каждый клиент считает движение сам) — синхронизируем только
    hull/shield/kill, см. обсуждение в разговоре: полная позиционная синхронизация
    мобов требовала бы серверного AI-луп, это отдельная, намного большая задача.
    Создаётся лениво по первому pvp_mob_fire_claim с этим mob_id (см. ниже) —
    id детерминирован порядком спавна на клиенте (GameScene.spawnMobs: pvpMobId),
    поэтому отдельный протокол регистрации ростера не нужен."""
    def __init__(self, mob_id: str, max_hull: float, max_shield: float):
        self.mob_id = mob_id
        self.max_hull = max_hull
        self.max_shield = max_shield
        self.hull = max_hull
        self.shield = max_shield
        # uid → суммарный урон за жизнь ЭТОГО моба — не используется для обычных мобов
        # (просто накапливается и выкидывается вместе с состоянием), но нужно для
        # пропорциональной раздачи награды с вагонов бронепоезда (см. ArmoredTrainManager
        # и pvp_mob_fire_claim ниже: топ-5 по damage_by получают долю пула).
        self.damage_by: dict[int, float] = {}


class PvpLootBox:
    """Лут с убитого игрока — одна общая коробка, видимая только тем, кто наносил
    урон victim в эту жизнь (eligible), не самому victim. Живёт в памяти без таймера
    удаления — до подбора кем-то из eligible или до перезапуска сервера (то же
    допущение, что и у остальных PvP-структур в этом классе)."""
    def __init__(self, loot_id: str, x: float, y: float, item: dict, eligible: list[int]):
        self.loot_id = loot_id
        self.x = x
        self.y = y
        self.item = item
        self.eligible = set(eligible)


class PvpResourceNode:
    """Депозит ресурса (плазмит/данж-кристалл), общий на всех игроков комнаты.
    Позицию/количество/тип задаёт ПЕРВЫЙ клиент комнаты (см. get_or_create_resources —
    "клиент решает ЧТО, сервер решает ЧЬЯ версия становится общей", тот же трюк, что и
    у pvp_loot_spawn), сервер лишь хранит и арбитрирует alive/collect/respawn, чтобы
    все клиенты комнаты видели ОДИН и тот же депозит в ОДНОМ месте (см. диалог:
    "каждый видит свой ресурс")."""
    def __init__(self, node_id: str, x: float, y: float, resource_type: str, amount: float, respawn_ms: float):
        self.node_id = node_id
        self.x = x
        self.y = y
        self.resource_type = resource_type
        self.amount = amount
        self.respawn_ms = respawn_ms
        self.alive = True
        self.respawn_at = 0.0  # time.time() когда снова станет alive (0 — не собран)


class PvpRoomManager:
    def __init__(self):
        self.rooms: dict[str, dict[int, PvpPlayerState]] = {}
        self.player_sector: dict[int, str] = {}   # user_id → sector, для leave на disconnect
        self.mob_rooms: dict[str, dict[str, PvpMobState]] = {}
        self.loot_rooms: dict[str, dict[str, PvpLootBox]] = {}
        self.resource_rooms: dict[str, dict[str, PvpResourceNode]] = {}
        # turret_id (уже включает sector через base.id) → time.time() последнего
        # засчитанного залпа — см. TURRET_WEAPONS выше и pvp_turret_fire_claim ниже.
        self.turret_last_fire: dict[str, float] = {}

    def enter(self, sector: str, user_id: int, username: str, x: float, y: float, loadout: dict) -> PvpPlayerState:
        self.leave(user_id)  # если уже был в другом PvP-секторе — сначала выходим оттуда
        room = self.rooms.setdefault(sector, {})
        state = PvpPlayerState(user_id, username, x, y, loadout)
        room[user_id] = state
        self.player_sector[user_id] = sector
        return state

    def leave(self, user_id: int) -> str | None:
        sector = self.player_sector.pop(user_id, None)
        if sector and sector in self.rooms:
            self.rooms[sector].pop(user_id, None)
            if not self.rooms[sector]:
                del self.rooms[sector]
        return sector

    def others(self, sector: str, exclude_uid: int) -> list["PvpPlayerState"]:
        return [p for uid, p in self.rooms.get(sector, {}).items() if uid != exclude_uid]

    def get(self, sector: str, user_id: int) -> "PvpPlayerState | None":
        return self.rooms.get(sector, {}).get(user_id)

    def update_pos(self, sector: str, user_id: int, x: float, y: float, heading: float,
                    waypoint_x: float | None = None, waypoint_y: float | None = None, speed: float = 0.0):
        p = self.get(sector, user_id)
        if p:
            p.x, p.y, p.heading = float(x), float(y), float(heading)
            # План Фаза 3.1: см. PvpPlayerState.waypoint_x/y/speed — снапшот на дисконнекте
            # берёт эти поля, чтобы OfflineShipManager знал, куда продолжать лететь.
            p.waypoint_x = float(waypoint_x) if waypoint_x is not None else None
            p.waypoint_y = float(waypoint_y) if waypoint_y is not None else None
            p.speed = float(speed)

    def get_or_create_mob(self, sector: str, mob_id: str, max_hull: float, max_shield: float) -> PvpMobState:
        room = self.mob_rooms.setdefault(sector, {})
        state = room.get(mob_id)
        if not state:
            state = PvpMobState(mob_id, max_hull, max_shield)
            room[mob_id] = state
        return state

    def remove_mob(self, sector: str, mob_id: str):
        self.mob_rooms.get(sector, {}).pop(mob_id, None)

    def spawn_loot(self, sector: str, loot_id: str, x: float, y: float, item: dict, eligible: list[int]) -> PvpLootBox:
        box = PvpLootBox(loot_id, x, y, item, eligible)
        self.loot_rooms.setdefault(sector, {})[loot_id] = box
        return box

    def get_loot(self, sector: str, loot_id: str) -> "PvpLootBox | None":
        return self.loot_rooms.get(sector, {}).get(loot_id)

    def remove_loot(self, sector: str, loot_id: str):
        self.loot_rooms.get(sector, {}).pop(loot_id, None)

    def mob_snapshot(self, sector: str) -> dict:
        return {mid: {'hull': s.hull, 'maxHull': s.max_hull, 'shield': s.shield, 'maxShield': s.max_shield}
                for mid, s in self.mob_rooms.get(sector, {}).items()}

    # Идемпотентно: первый клиент комнаты, приславший непустой resources[], "выигрывает"
    # и его раскладка становится общей навсегда (пока комната не опустеет/сервер не
    # перезапустится — то же допущение времени жизни, что у mob_rooms/loot_rooms).
    # Опоздавшие/расходящиеся предложения от других клиентов той же комнаты молча
    # игнорируются — они получат уже сохранённую раскладку через serialize_resources.
    def get_or_create_resources(self, sector: str, proposed: list[dict]) -> dict[str, PvpResourceNode]:
        room = self.resource_rooms.setdefault(sector, {})
        if not room and proposed:
            for entry in proposed[:200]:
                node_id = str(entry.get('id', ''))[:40]
                if not node_id or node_id in room:
                    continue
                try:
                    x = float(entry.get('x', 0))
                    y = float(entry.get('y', 0))
                    amount = max(0.0, float(entry.get('amount', 0)))
                    respawn_ms = max(1000.0, float(entry.get('respawnMs', 600000)))
                except (TypeError, ValueError):
                    continue
                resource_type = str(entry.get('resourceType', 'plasmate'))[:30]
                room[node_id] = PvpResourceNode(node_id, x, y, resource_type, amount, respawn_ms)
        return room

    def serialize_resources(self, sector: str) -> list[dict]:
        now_ts = time.time()
        out = []
        for node in self.resource_rooms.get(sector, {}).values():
            if not node.alive and node.respawn_at and now_ts >= node.respawn_at:
                node.alive = True
                node.respawn_at = 0.0
            out.append({
                'id': node.node_id, 'x': node.x, 'y': node.y,
                'resourceType': node.resource_type, 'amount': node.amount,
                'respawnMs': node.respawn_ms, 'alive': node.alive,
            })
        return out

    def get_resource(self, sector: str, node_id: str) -> "PvpResourceNode | None":
        return self.resource_rooms.get(sector, {}).get(node_id)


pvp_room_manager = PvpRoomManager()


# ── Бронепоезд: серверная гарантия порядка уничтожения (бьют строго с хвоста) ──
# Клиент-локальный AI/позиция поезда (как и у обычных мобов — см. PvpMobState),
# но "какой вагон сейчас можно бить" ДОЛЖНА быть авторитетна на сервере, иначе
# читерский клиент мог бы просто слать pvp_mob_fire_claim по mobId головы/середины
# вагона напрямую, игнорируя очередь. mob_id вагона = "train:{sector}:{startAt}:{idx}",
# idx 0 = хвост (бьётся первым) … 4 = ближайший к голове, 5 = голова (бьётся последней).
# Уничтоженные indices переживают remove_mob() состояния самого PvpMobState (то
# состояние удаляется на килле) — без этого набора повторный fire_claim по тому же
# mobId лениво пересоздал бы вагон с полным HP (см. get_or_create_mob).
# Бронепоезд: ракетный залп/поворотная турель — первый в кодовой базе случай, когда
# СЕРВЕР сам решает атаковать игрока без входящей client-claim заявки (см. диалог/
# feedback-память про upfront-вопрос о server-authority для новой PvP-механики —
# пользователь явно выбрал "Полностью серверное"). mob_id-схема (ArmoredTrain.js):
# вагон = "train:{sector}:{startAt}:{idx}", турель = "train:{sector}:{startAt}:{wagonIdx}:
# turret:{turretIdx}", поворотная турель головы = "train:{sector}:{startAt}:{wagonIdx}:core".
TURRETS_PER_WAGON = 4
HEAD_WAGON_IDX = 3  # зеркало client/src/constants.js ARMORED_TRAIN_WAGON_COUNT (3 + голова)
TRAIN_MISSILE_DMG = 3000.0
TRAIN_MISSILE_DMG_HEAD = 4500.0  # ×1.5 обычного (было ×2 = 6000 — правка по просьбе)
TRAIN_MISSILE_COOLDOWN = 10.0
TRAIN_MISSILE_PENETRATION = 0.15
TRAIN_MISSILES_PER_VOLLEY = 8
TRAIN_CORE_BOLT_DMG = 900.0
TRAIN_CORE_BOLT_PENETRATION = 0.1
TRAIN_CORE_BOLTS_PER_VOLLEY = 8
TRAIN_CORE_VOLLEY_GAP = 1.0
TRAIN_CORE_BURST_CD = 5.0
TRAIN_CORE_VOLLEYS_PER_BURST = 3
TRAIN_WEAPON_TICK_MS = 250


class ArmoredTrainManager:
    def __init__(self):
        self.destroyed: dict[str, set[int]] = {}  # train_key ("sector:startAt") → уничтоженные idx
        # Счётчик убитых турелей вагона — по достижении TURRETS_PER_WAGON вооружает
        # ракетный залп (missile_ready_at); отдельно от self.destroyed (тот — про
        # уничтожение самого КОРПУСА вагона, очередь "строго с хвоста", к турелям не относится).
        self.turret_kills: dict[str, dict[int, int]] = {}
        self.missile_ready_at: dict[str, dict[int, float]] = {}  # train_key → wagon_idx → следующий разрешённый залп
        self.core_turret: dict[str, dict] = {}  # train_key → {'burst_step': int, 'next_fire_at': float}

    def is_vulnerable(self, train_key: str, wagon_idx: int) -> bool:
        d = self.destroyed.get(train_key, set())
        # wagon_idx not in d — раньше отсутствовало: проверялись только МЕНЬШИЕ индексы,
        # так что уже уничтоженный вагон сам по себе продолжал проходить эту проверку
        # (все младшие тоже destroyed). Позднее/повторное pvp_mob_fire_claim по тому же
        # (уже мёртвому) mob_id лениво пересоздавал бы mob_state с полным HP и пустым
        # damage_by (get_or_create_mob) — тот же вагон убивался и награждался ВТОРОЙ раз.
        return wagon_idx not in d and all(i in d for i in range(wagon_idx))

    def mark_destroyed(self, train_key: str, wagon_idx: int):
        self.destroyed.setdefault(train_key, set()).add(wagon_idx)

    def note_turret_kill(self, train_key: str, wagon_idx: int) -> bool:
        """True, только когда эта турель была ПОСЛЕДНЕЙ (4-й) у своего вагона."""
        counts = self.turret_kills.setdefault(train_key, {})
        counts[wagon_idx] = counts.get(wagon_idx, 0) + 1
        return counts[wagon_idx] >= TURRETS_PER_WAGON

    def arm_missiles(self, train_key: str, wagon_idx: int):
        # +4с задержка перед первым залпом (мирроит клиентский _missileCd=4 из
        # дореалти-версии) — даёт игроку миг отреагировать, не наказывает добивающий
        # выстрел по последней турели немедленным ответным огнём.
        self.missile_ready_at.setdefault(train_key, {})[wagon_idx] = time.time() + 4.0

    def spawn_core_turret(self, train_key: str):
        self.core_turret[train_key] = {'burst_step': 0, 'next_fire_at': time.time()}

    def despawn_core_turret(self, train_key: str):
        self.core_turret.pop(train_key, None)

    def cleanup(self, train_key: str):
        self.destroyed.pop(train_key, None)
        self.turret_kills.pop(train_key, None)
        self.missile_ready_at.pop(train_key, None)
        self.core_turret.pop(train_key, None)


armored_train_manager = ArmoredTrainManager()

# Мировое событие "нашествие" (World Event, GameScene._worldEvent) — общий вклад урона
# по ВСЕМ мобам одной волны, we_key ("sector:startAt", тот же формат что train_key).
# mob_id "we:{sector}:{startAt}:{idx}" (4 части после split — та же структурная проверка,
# что и у вагонов поезда). Живёт ДОЛЬШЕ отдельных PvpMobState — те удаляются на килле
# КАЖДОГО моба (remove_mob), а нужен честный пропорциональный сплит награды за расчистку
# ВСЕЙ волны (см. pvp_world_event_clear_claim ниже) — тот же приём "фотографируем вклад
# сразу", что и у group_boss_died (см. комментарий там). Раньше сплита не было вовсе —
# каждый клиент, нанёсший хоть какой-то урон, сам себе выдавал ПОЛНУЮ награду локально,
# без участия сервера (баг класса "самозаявленный reward", тот же, что чинили для турелей).
world_event_damage: dict[str, dict[int, float]] = {}


# ── Серверный тик мобов (Фаза 1 плана "server-authoritative shared mobs") ──────
# Раньше ЛЮБОЙ моб (дроны поезда, турели поезда/баз, групповые боссы) был чисто
# клиент-локальным — update() каждого клиента видел ТОЛЬКО своего локального игрока,
# так что двое игроков рядом с одной турелью каждый видел "она бьёт МЕНЯ", хотя
# турель физически одна (см. диалог). Это первый в кодовой базе фоновый тик-цикл —
# PvpMobState выше специально НЕ хранит позицию/таргет (см. её докстринг), только
# hull/shield по факту попаданий; ServerMob — надстройка НАД ней для мобов, которым
# нужна реальная общая позиция/таргетинг, не только общий HP-леджер.
#
# Масштаб (см. план): сервер авторитетен за ТАРГЕТИНГОМ/ТАЙМИНГОМ, не за формулой
# урона — крит/уклонение/щит-сплит остаются как раньше, урон по игроку/мобу применяется
# локально тем же клиентом, что и сегодня (Player.takeDamage / pvp_mob_fire_claim).
# Фаза 2 (дроны бронепоезда) сознательно НЕ реплицирует позицию/движение на сервер —
# слишком дорого/рискованно для затеи (см. план, открытые вопросы); вместо этого
# движение остаётся клиент-локальным (Mob.js как и раньше), а сервер решает только
# КОГО каждый дрон атакует в этот тик (круговое распределение по игрокам комнаты, не
# "все к ближайшему") — клиент, назначенный НЕ целью в этот тик, просто не агрится
# локально (drone уходит в idle-патруль у головы поезда), см. GameScene.js
# _onPvpMobRoomUpdate/mobs.forEach.
#
# room_key — тот же неймспейс, что и pvp_room_manager.rooms: PvP-сектор ("pvp_1") ИЛИ
# групповой данж-инстанс ("group:<instanceId>", см. GroupManager) — единая регистрация,
# не два отдельных менеджера.
class ServerMob:
    def __init__(self, mob_id: str, room_key: str, x: float, y: float,
                 max_hull: float, max_shield: float, speed: float = 0.0,
                 aggro_range: float = 0.0, leash: float = 0.0, atk_range: float = 0.0,
                 damage: float = 0.0, fire_rate: float = 1.0, owner_corp: str | None = None):
        self.mob_id = mob_id
        self.room_key = room_key
        # owner_corp — ТОЛЬКО для турелей добывающих баз (см. Фаза 3): база не может
        # атаковать игроков своего же корпуса, так что кандидатов на таргетинг для неё
        # нужно фильтровать ПО КОРПУСУ, а не брать всех присутствующих в комнате (в
        # отличие от дронов/турелей бронепоезда — нейтральная угроза, бьёт любого,
        # owner_corp=None ⇒ все игроки комнаты валидны). См. _tick_room.
        self.owner_corp = owner_corp
        self.x = x
        self.y = y
        self.heading = 0.0
        self.spawn_x = x
        self.spawn_y = y
        self.max_hull = max_hull
        self.max_shield = max_shield
        self.hull = max_hull
        self.shield = max_shield
        self.speed = speed
        self.aggro_range = aggro_range
        self.leash = leash
        self.range = atk_range
        self.damage = damage
        self.fire_rate = fire_rate
        self.target_uid: int | None = None
        self.state = 'idle'  # idle | aggro
        self.last_fire_at = 0.0
        # uid → суммарный урон — тот же контракт, что PvpMobState.damage_by (топ-N на
        # награду), заполняется по мере переноса реального боевого тика (Фаза 2+).
        self.damage_by: dict[int, float] = {}


class ServerMobManager:
    """Реестр ServerMob по room_key. Пусто (нет активных серверных мобов нигде) —
    _mob_tick_loop не делает вообще никакой работы за тик (см. ранний continue)."""
    def __init__(self):
        self.rooms: dict[str, dict[str, ServerMob]] = {}

    def spawn(self, mob: ServerMob):
        """Идемпотентно: несколько клиентов в комнате слышат один и тот же
        детерминированный спавн (mob_id) и все вызовут это почти одновременно —
        первый регистрирует, остальные не должны перезатирать уже тикающий объект
        (иначе target_uid/state сбрасывались бы каждый раз, когда ещё кто-то
        подключается/переспавнивает свою локальную копию того же дрона).
        Исключение — owner_corp турели базы: тот же mob_id (база+слот) переживает
        смену владельца (уничтожили/перекупили) без переспавна id, но кандидатов на
        таргетинг нужно фильтровать уже ПО НОВОМУ корпу — обновляем на месте, не трогая
        остальное состояние (target_uid и т.п.), см. MiningBase._updateTurrets."""
        room = self.rooms.setdefault(mob.room_key, {})
        existing = room.get(mob.mob_id)
        if existing is None:
            room[mob.mob_id] = mob
        elif existing.owner_corp != mob.owner_corp:
            existing.owner_corp = mob.owner_corp

    def remove(self, room_key: str, mob_id: str):
        room = self.rooms.get(room_key)
        if not room:
            return
        room.pop(mob_id, None)
        if not room:
            del self.rooms[room_key]

    def clear_room(self, room_key: str):
        self.rooms.pop(room_key, None)


server_mob_manager = ServerMobManager()


# ── Офлайн-корабли (План Фаза 3, шаг 3.1: "server-authoritative travel/regen переживают
# закрытую вкладку") ────────────────────────────────────────────────────────────────
# Раньше дисконнект молча удалял PvpPlayerState (см. except-блок ниже) — другие игроки
# в той же комнате видели, что корабль просто исчезает/замирает, а на реконнект сервер
# верил заявленным клиентом x/y/hull/shield как на первом входе. Вместо удаления —
# снимаем снапшот сюда: позиция продолжает тикать реальным временем (см.
# _offline_ship_tick_loop), (а) так что другие видят полёт, (б) на pvp_enter сервер
# знает актуальную позицию/HP сам, а не то, что заявит клиент. НЕ путать с
# PvpPlayerState — та живёт только пока сокет открыт, OfflineShip — именно НА ВРЕМЯ
# отсутствия соединения. Не персистится в БД (то же допущение, что и у остальных PvP-
# структур в этом классе — не переживает перезапуск сервера).
OFFLINE_SHIP_MAX_AGE_SEC = 24 * 60 * 60  # план: 24ч потолок — дальше клиент сам догоняет (Фаза 2)
OFFLINE_SHIP_ARRIVAL_PX  = 16.0          # то же значение, что client Movement.js arrivalThreshold


class OfflineShip:
    def __init__(self, sector: str, user_id: int, username: str, state: "PvpPlayerState"):
        self.sector = sector
        self.user_id = user_id
        self.username = username
        self.x = state.x
        self.y = state.y
        self.heading = state.heading
        self.waypoint_x = state.waypoint_x
        self.waypoint_y = state.waypoint_y
        self.speed = max(0.0, state.speed)
        self.hull, self.max_hull, self.shield, self.max_shield = _clamp_offline_hp(
            state.hull, state.max_hull, state.shield, state.max_shield)
        self.ship_key = state.ship_key
        self.corp = state.corp
        self.level = state.level
        self.loadout = state.loadout
        self.entered_offline_at = time.time()


class OfflineShipManager:
    """Реестр OfflineShip по (sector, user_id) — та же форма, что ServerMobManager выше."""
    def __init__(self):
        self.rooms: dict[str, dict[int, OfflineShip]] = {}

    def snapshot(self, sector: str, user_id: int, username: str, state: "PvpPlayerState") -> OfflineShip:
        ship = OfflineShip(sector, user_id, username, state)
        self.rooms.setdefault(sector, {})[user_id] = ship
        return ship

    def pop(self, sector: str, user_id: int) -> "OfflineShip | None":
        room = self.rooms.get(sector)
        if not room:
            return None
        ship = room.pop(user_id, None)
        if not room:
            self.rooms.pop(sector, None)
        return ship

    def find(self, user_id: int) -> tuple[str, "OfflineShip"] | tuple[None, None]:
        """Для pvp_enter — ищем по всем секторам, не только целевому: сектор мог
        поменяться между дисконнектом/реконнектом (см. GameScene._reconnectPvpCorp)."""
        for sector, room in self.rooms.items():
            if user_id in room:
                return sector, room[user_id]
        return None, None


offline_ship_manager = OfflineShipManager()


def _advance_offline_ship(ship: OfflineShip, dt: float):
    """Та же арифметика клиент-катчапа (Фаза 2, GameScene.create()'s travelCatchup) —
    здесь тикается непрерывно раз в OFFLINE_SHIP_TICK_MS, а не одним прыжком на логине."""
    if ship.waypoint_x is None or ship.waypoint_y is None or dt <= 0:
        return
    dx = ship.waypoint_x - ship.x
    dy = ship.waypoint_y - ship.y
    dist = math.hypot(dx, dy)
    traveled = min(dist, ship.speed * dt)
    if dist - traveled <= OFFLINE_SHIP_ARRIVAL_PX:
        ship.x, ship.y = ship.waypoint_x, ship.waypoint_y
        ship.waypoint_x = ship.waypoint_y = None
    else:
        bearing = math.atan2(dy, dx)
        ship.heading = bearing
        ship.x += math.cos(bearing) * traveled
        ship.y += math.sin(bearing) * traveled


OFFLINE_SHIP_TICK_MS = 1000  # ~1Гц — точность плана Фазы 2 (клиентский catch-up), не боевая (175мс)


async def _offline_ship_tick_loop():
    """Второй фоновый цикл сервера (первый — _mob_tick_loop). Продолжает движение
    офлайн-кораблей реальным временем, пока их владелец отключён, и рассылает позицию
    живым игрокам комнаты — иначе корабль просто замер бы у них на экране. Список
    комнат копируется (list(...)) на случай мутации во время тика (реконнект/экспайр)."""
    last_tick = time.time()
    while True:
        await asyncio.sleep(OFFLINE_SHIP_TICK_MS / 1000)
        now = time.time()
        dt = now - last_tick
        last_tick = now
        for sector, room in list(offline_ship_manager.rooms.items()):
            if not room:
                continue
            expired = [uid for uid, ship in room.items()
                       if now - ship.entered_offline_at > OFFLINE_SHIP_MAX_AGE_SEC]
            for uid in expired:
                offline_ship_manager.pop(sector, uid)
            if not room:
                continue
            updates = []
            for ship in room.values():
                _advance_offline_ship(ship, dt)
                updates.append({'userId': ship.user_id, 'x': ship.x, 'y': ship.y, 'heading': ship.heading})
            live_players = _players_in_room(sector)
            if live_players and updates:
                await chat_manager.broadcast_to_uids(
                    [p.user_id for p in live_players],
                    {'type': 'pvp_offline_ship_update', 'sector': sector, 'ships': updates},
                )


MOB_TICK_MS = 175  # ~5.7Hz — грубее позиции игрока (100мс/10Hz в pvp_pos), см. план


def _players_in_room(room_key: str) -> list["PvpPlayerState"]:
    """Живые игроки в этой "комнате" — единственный источник целей для тика мобов.
    room_key — тот же неймспейс, что pvp_room_manager.rooms (PvP-сектор или групповой
    данж-инстанс), так что для группового данжа нужно будет регистрировать игроков в
    pvp_room_manager.rooms под ключом "group:<id>" (см. план, Фаза 4) — здесь никакой
    отдельной логики для секторов/данжей нет, только чтение уже существующего реестра."""
    return list(pvp_room_manager.rooms.get(room_key, {}).values())


async def _tick_room(room_key: str, mobs: dict[str, ServerMob], players: list["PvpPlayerState"]):
    # Круговое распределение по игрокам, а НЕ "все к ближайшему" — рой/турели должны
    # реально разойтись по нескольким атакующим одновременно, а не задавить всех на
    # одного, кто оказался чуть ближе (см. диалог: "распределяют урон по игрокам если
    # несколько нападающих"). Сортировка по user_id/mob_id — детерминированный,
    # стабильный между тиками порядок (иначе назначение "прыгало" бы от произвольного
    # порядка итерации по dict).
    #
    # owner_corp (Фаза 3, турели баз): своя база не может выбрать союзника-кандидата
    # (визитёр своего корпуса) целью — фильтруем пул кандидатов ПЕРЕД распределением,
    # не после. Отдельный счётчик ротации НА КАЖДЫЙ уникальный пул кандидатов (ключ —
    # owner_corp, None у дронов/турелей поезда = "все игроки комнаты валидны") — общий
    # индекс по списку мобов означал бы, что турель без валидных целей (все в комнате —
    # свои) "съедает" номер очереди у следующей, кому кандидаты как раз есть.
    ordered_players = sorted(players, key=lambda p: p.user_id)
    ordered_mob_ids = sorted(mobs.keys())
    rotation: dict[str | None, int] = {}
    updates = []
    for mob_id in ordered_mob_ids:
        mob = mobs[mob_id]
        candidates = [p for p in ordered_players if mob.owner_corp is None or p.corp != mob.owner_corp]
        if not candidates:
            mob.target_uid = None
            mob.state = 'idle'
        else:
            idx = rotation.get(mob.owner_corp, 0)
            rotation[mob.owner_corp] = idx + 1
            mob.target_uid = candidates[idx % len(candidates)].user_id
            mob.state = 'aggro'
        updates.append({'mobId': mob.mob_id, 'targetUserId': mob.target_uid})
    uids = [p.user_id for p in players]
    await chat_manager.broadcast_to_uids(uids, {
        'type': 'pvp_mob_room_update', 'roomKey': room_key, 'mobs': updates,
    })


def _sector_pvp_tier(sector: str) -> int:
    """Зеркало parseInt(sectorKey.split('_').pop(), 10) || 1 (client ArmoredTrain.js)."""
    try:
        return int(sector.rsplit('_', 1)[-1])
    except (ValueError, IndexError):
        return 1


async def _distribute_train_damage(targets: list["PvpPlayerState"], total_shots: int,
                                    dmg_per_shot: float, penetration: float,
                                    train_key: str, wagon_idx: int, weapon: str,
                                    num_groups: int = 1):
    """Раздаёт total_shots "попаданий" круговым round-robin между targets — суммарный
    урон залпа не растёт с числом игроков в комнате (один заберёт все total_shots,
    несколько — поделят), см. AskUserQuestion "распределить суммарный урон (рекомендую)".
    Один игрок — одна общая заявка _apply_pvp_damage (не по отдельному попаданию) —
    это статичный хазард без личного крита/уклонения атакующего, отдельные роллы не нужны.

    num_groups>1 — залп с нескольких независимых "бортов" (см. _fire_train_missiles:
    4 ракеты с каждого борта). Сервер НЕ знает реальную позицию поезда/игроков (см.
    диалог — сознательно не портировали геометрию движения поезда в Python), поэтому
    "борт" каждого игрока — стабильная (по user_id, не случайная от тика к тику)
    привязка, а не настоящая геометрия. Каждая группа раздаёт СВОЮ долю снарядов ТОЛЬКО
    своим игрокам — если на борту никого нет, его снаряды в этот залп ни в кого не
    попадают, а не "долетают" через весь поезд до игрока с другого борта, как было
    раньше (баг из диалога: "с одного борта 4 ракеты - если игрок с одной стороны то
    только 4 ракеты попадать должны, 4 остальных должны лететь в другую сторону")."""
    if not targets:
        return
    hits: dict[int, int] = {}
    if num_groups <= 1:
        for i in range(total_shots):
            p = targets[i % len(targets)]
            hits[p.user_id] = hits.get(p.user_id, 0) + 1
    else:
        sorted_targets = sorted(targets, key=lambda p: p.user_id)
        groups: list[list["PvpPlayerState"]] = [[] for _ in range(num_groups)]
        for i, p in enumerate(sorted_targets):
            groups[i % num_groups].append(p)
        shots_per_group = total_shots // num_groups
        for g in groups:
            if not g:
                continue
            for i in range(shots_per_group):
                p = g[i % len(g)]
                hits[p.user_id] = hits.get(p.user_id, 0) + 1
    out_hits = []
    for p in targets:
        n = hits.get(p.user_id, 0)
        if n <= 0 or p.respawn_grace_until > time.time():
            continue
        dmg = dmg_per_shot * n
        result = _apply_pvp_damage(dmg, dmg, penetration, p.hull, p.shield, p.max_hull, p.max_shield)
        p.hull, p.shield = result['hull'], result['shield']
        if result['killed']:
            p.respawn_grace_until = time.time() + 3.0
        out_hits.append({
            'uid': p.user_id, 'hits': n, 'dmg': result['dmg'],
            'hull': p.hull, 'shield': p.shield,
            'maxHull': p.max_hull, 'maxShield': p.max_shield,
            'killed': result['killed'],
        })
    if not out_hits:
        return
    await chat_manager.broadcast_to_uids([p.user_id for p in targets], {
        'type': 'pvp_train_weapon_fire', 'trainKey': train_key, 'wagonIdx': wagon_idx,
        'weapon': weapon, 'hits': out_hits,
    })


async def _fire_train_missiles(train_key: str, wagon_idx: int, targets: list["PvpPlayerState"]):
    sector = train_key.split(':', 1)[0]
    mult = _turret_damage_mult(_sector_pvp_tier(sector))
    dmg = (TRAIN_MISSILE_DMG_HEAD if wagon_idx == HEAD_WAGON_IDX else TRAIN_MISSILE_DMG) * mult
    # num_groups=2 — 2 борта по 4 ракеты (см. _distribute_train_damage) — солист теперь
    # получает максимум 4 ракеты за залп, а не все 8.
    await _distribute_train_damage(targets, TRAIN_MISSILES_PER_VOLLEY, dmg,
                                    TRAIN_MISSILE_PENETRATION, train_key, wagon_idx, 'missile',
                                    num_groups=2)


async def _fire_core_volley(train_key: str, targets: list["PvpPlayerState"]):
    sector = train_key.split(':', 1)[0]
    mult = _turret_damage_mult(_sector_pvp_tier(sector))
    dmg = TRAIN_CORE_BOLT_DMG * mult
    await _distribute_train_damage(targets, TRAIN_CORE_BOLTS_PER_VOLLEY, dmg,
                                    TRAIN_CORE_BOLT_PENETRATION, train_key, HEAD_WAGON_IDX, 'core_bolt')


async def _train_weapon_tick_loop():
    """Первый server-initiated (без входящей client-claim заявки) источник урона по
    игроку в кодовой базе — ракетный залп бронепоезда и болтовой веер поворотной турели
    головы (см. диалог "управление турелью серверное, ракеты тоже" + upfront feedback про
    server-authority). Раздача — _distribute_train_damage; визуал (полёт ракет/болтов)
    рисует клиент по броадкасту pvp_train_weapon_fire, см. GameScene._onTrainWeaponFire."""
    while True:
        await asyncio.sleep(TRAIN_WEAPON_TICK_MS / 1000)
        now = time.time()
        for train_key in list(armored_train_manager.missile_ready_at.keys()):
            sector = train_key.split(':', 1)[0]
            destroyed = armored_train_manager.destroyed.get(train_key, set())
            wagons = armored_train_manager.missile_ready_at.get(train_key, {})
            # Оголённые турели ≠ уничтоженный корпус вагона (разные HP-пулы, см.
            # ArmoredTrainManager.destroyed/note_turret_kill) — залп вооружается, когда
            # умерли ВСЕ 4 турели, но если ПОСЛЕ этого игроки добьют и сам вагон, залп
            # должен прекратиться. Раньше это не проверялось вовсе — уничтоженный вагон
            # (и его турели-сокеты) продолжал слать залпы бесконечно (баг из диалога:
            # "урон игроку наносится после убийства головного вагона").
            for wagon_idx in [idx for idx in wagons if idx in destroyed]:
                wagons.pop(wagon_idx, None)
            if not wagons:
                armored_train_manager.missile_ready_at.pop(train_key, None)
                continue
            targets = list(pvp_room_manager.rooms.get(sector, {}).values())
            if not targets:
                continue
            for wagon_idx, ready_at in list(wagons.items()):
                if now >= ready_at:
                    wagons[wagon_idx] = now + TRAIN_MISSILE_COOLDOWN
                    await _fire_train_missiles(train_key, wagon_idx, targets)
        for train_key in list(armored_train_manager.core_turret.keys()):
            sector = train_key.split(':', 1)[0]
            # Сама поворотная турель растёт ТОЛЬКО на головном вагоне — если его уже
            # добили (корпус, не только турели), она физически исчезла вместе с ним
            # (см. клиентский _onCoreTurretDestroyed при уничтожении вагона — но раньше
            # сервер продолжал слать залпы от уже несуществующей турели, тот же класс
            # бага, что и у ракет выше).
            if HEAD_WAGON_IDX in armored_train_manager.destroyed.get(train_key, set()):
                armored_train_manager.despawn_core_turret(train_key)
                continue
            targets = list(pvp_room_manager.rooms.get(sector, {}).values())
            if not targets:
                continue
            core = armored_train_manager.core_turret.get(train_key)
            if not core or now < core['next_fire_at']:
                continue
            await _fire_core_volley(train_key, targets)
            core['burst_step'] += 1
            if core['burst_step'] >= TRAIN_CORE_VOLLEYS_PER_BURST:
                core['burst_step'] = 0
                core['next_fire_at'] = now + TRAIN_CORE_BURST_CD
            else:
                core['next_fire_at'] = now + TRAIN_CORE_VOLLEY_GAP


async def _mob_tick_loop():
    """Единственный фоновый цикл сервера (первый в кодовой базе — см. план). Тикает
    ВСЕ активные комнаты с ServerMob раз в MOB_TICK_MS; список копируется (list(...))
    на случай, если тик одной комнаты меняет server_mob_manager.rooms (спавн/деспавн)."""
    while True:
        await asyncio.sleep(MOB_TICK_MS / 1000)
        for room_key, mobs in list(server_mob_manager.rooms.items()):
            if not mobs:
                continue
            players = _players_in_room(room_key)
            if not players:
                # Комната опустела (игроки вышли из сектора/дисконнектнулись) — мобы
                # могли не почиститься по факту убийства (событие просто закончилось с
                # выжившими дронами). Не тикаем мёртвый груз вечно.
                server_mob_manager.clear_room(room_key)
                continue
            await _tick_room(room_key, mobs, players)


RESOURCE_TICK_MS = 5000  # реген депозитов — минуты/часы, 6Hz мобов тут избыточен


async def _resource_tick_loop():
    """Третий фоновый цикл сервера. Респавн депозита должен долететь ДО ВСЕХ живых
    клиентов комнаты пушем (не только тому, кто его собрал) — в отличие от pvp_mob_
    hit_result, тут никто не "стреляет" в момент респавна, чтобы естественно получить
    событие, поэтому лениво-по-запросу (как serialize_resources на pvp_enter) не
    покрыло бы уже присутствующих в комнате игроков."""
    while True:
        await asyncio.sleep(RESOURCE_TICK_MS / 1000)
        now_ts = time.time()
        for sector, nodes in list(pvp_room_manager.resource_rooms.items()):
            room_uids = [p.user_id for p in pvp_room_manager.rooms.get(sector, {}).values()]
            if not room_uids:
                continue
            for node in nodes.values():
                if node.alive or not node.respawn_at or now_ts < node.respawn_at:
                    continue
                node.alive = True
                node.respawn_at = 0.0
                await chat_manager.broadcast_to_uids(room_uids, {
                    'type': 'pvp_resource_respawned', 'resourceId': node.node_id,
                    'x': node.x, 'y': node.y, 'resourceType': node.resource_type,
                    'amount': node.amount, 'respawnMs': node.respawn_ms,
                })


SHIELD_DRONE_TICK_MS = 2000  # достаточно часто для "исчез максимум на 2с позже времени" ощущения


async def _shield_drone_tick_loop():
    """Дрон истекает по времени (30с), а не только от урона — без фонового тика клиенты
    узнали бы об истечении только на следующем pvp_hit_result по этому владельцу (или
    никогда, если его больше не атаковали), и висел бы виден всем бесконечно после
    настоящего истечения. Дешёвый обход всех комнат раз в SHIELD_DRONE_TICK_MS — то же
    решение, что и _resource_tick_loop для респавна депозитов."""
    while True:
        await asyncio.sleep(SHIELD_DRONE_TICK_MS / 1000)
        now_ts = time.time()
        for sector, room in list(pvp_room_manager.rooms.items()):
            room_uids = None
            for state in room.values():
                if state.shield_drone_active_until and state.shield_drone_active_until <= now_ts:
                    state.shield_drone_active_until = 0.0
                    state.shield_drone_hull = 0.0
                    state.shield_drone_shield = 0.0
                    # КД (SHIELD_DRONE_COOLDOWN_FLOOR) отсчитывается от момента, когда дрон
                    # РЕАЛЬНО перестал действовать — не от активации (см. диалог: "сначала
                    # действие, потом КД"), поэтому last_use обновляется именно тут, а не
                    # в pvp_shield_drone_activate.
                    state.shield_drone_last_use = now_ts
                    if room_uids is None:
                        room_uids = [p.user_id for p in room.values()]
                    await chat_manager.broadcast_to_uids(room_uids, {
                        'type': 'pvp_shield_drone_expire', 'ownerUserId': state.user_id,
                    })


@app.on_event("startup")
async def _start_mob_tick_loop():
    asyncio.create_task(_mob_tick_loop())
    asyncio.create_task(_offline_ship_tick_loop())
    asyncio.create_task(_resource_tick_loop())
    asyncio.create_task(_train_weapon_tick_loop())
    asyncio.create_task(_arena_tick_loop())
    asyncio.create_task(_shield_drone_tick_loop())


def _split_reward_top5(damage_by: dict[int, float], pools: dict[str, float]) -> dict[int, dict[str, int]]:
    """Топ-5 по урону получают долю КАЖДОГО пула (credits/xp/gold/...) пропорционально
    их вкладу СРЕДИ ЭТИХ ПЯТИ (не всех атаковавших) — см. обсуждение дизайна бронепоезда."""
    top5 = sorted(damage_by.items(), key=lambda kv: kv[1], reverse=True)[:5]
    total = sum(dmg for _, dmg in top5)
    if total <= 0:
        return {}
    return {
        uid: {k: max(1, round(v * (dmg / total))) if v > 0 else 0 for k, v in pools.items()}
        for uid, dmg in top5
    }


# ── Доска розыска: чисто in-memory, никакой персистентности — реально исчезает
# при рестарте сервера (так и задумано). killer_user_id → {'name': str, 'corp': str}.
# Один активный розыск на игрока (без стека, флат-награда): killer_user_id in bounties
# уже гейтит повторную подачу в pvp_bounty_post ниже, даже от той же жертвы серийно.
bounties: dict[int, dict] = {}


def _bounty_list_detailed() -> list[dict]:
    # Онлайн/сектор считаются на лету из chat_manager.active (то же поле 'sector',
    # что обновляет sector_update) — никакого отдельного трекинга по игроку в розыске
    # не нужно: не в active → офлайн → sector неизвестен (None, не последний известный).
    uid_info = {m['uid']: m for m in chat_manager.active.values()}
    out = []
    for uid, b in bounties.items():
        info = uid_info.get(uid)
        out.append({
            'userId': uid, 'name': b['name'], 'corp': b.get('corp', 'neutral'), 'kills': b.get('kills', 1),
            'online': info is not None,
            'sector': (info.get('sector') or None) if info else None,
        })
    return out

# Аргус: детерминированное (по wall-clock, time.time()) окно "квантовой фазы" —
# одно и то же окно у ВСЕХ атакующих клиентов И сервера, без отдельного протокола
# синхронизации (эпоха общая на всех машинах с точностью до рассинхрона часов).
# Клиент считает ТУ ЖЕ формулу для визуального мерцания (см.
# ArgusController._isPhaseInvincible) — иначе разные игроки видели/защищали бы
# разные окна. Раньше был client-only таймер поверх локального takeDamage — реально
# блокировал урон только у того клиента, чей таймер сработал (см. диалог).
ARGUS_FLICKER_PERIOD_NORMAL  = 3.0
ARGUS_FLICKER_PERIOD_BERSERK = 1.2
ARGUS_FLICKER_DURATION       = 0.4
ARGUS_BERSERK_HULL_FRAC      = 0.40


def _argus_phase_invincible(hull_frac: float) -> bool:
    period = ARGUS_FLICKER_PERIOD_BERSERK if hull_frac < ARGUS_BERSERK_HULL_FRAC else ARGUS_FLICKER_PERIOD_NORMAL
    return (time.time() % period) < ARGUS_FLICKER_DURATION


def _roll_pvp_shot(claimed_dmg: float, ceiling: float, crit_chance: float, crit_mult: float,
                    victim_evasion: float, burst_mult: float = PVP_BURST_MULT) -> dict:
    """Уклонение/крит/потолок-клэмп одного выстрела — вынесено из _apply_pvp_damage, чтобы
    щит-дрон (см. SHIELD_DRONE_* выше) мог разделить ОДИН и тот же ролл между двумя
    жертвами (дрон + владелец), не роллируя крит/уклонение дважды на один выстрел."""
    if victim_evasion > 0 and random.random() < victim_evasion:
        return {'isCrit': False, 'dodged': True, 'amount': 0.0}
    base = max(0.0, min(claimed_dmg, ceiling * burst_mult))
    is_crit = random.random() < crit_chance
    return {'isCrit': is_crit, 'dodged': False, 'amount': base * (crit_mult if is_crit else 1.0)}


def _split_pvp_damage(amount: float, penetration: float,
                       victim_hull: float, victim_shield: float,
                       victim_max_hull: float, victim_max_shield: float,
                       shield_mult: float = 1.0, hull_mult: float = 1.0) -> dict:
    """Shield/hull split одной уже-посчитанной (после крита/потолка) суммы урона — вынесено
    из _apply_pvp_damage, чтобы щит-дрон мог применить СВОЮ долю урона к своему собственному
    hull/shield-пулу тем же алгоритмом, что и обычная жертва (см. _resolve_pvp_hit)."""
    direct = amount * penetration
    to_shield_raw = amount - direct
    hull_hit = direct * hull_mult

    shield = victim_shield
    if shield > 0:
        to_shield = to_shield_raw * shield_mult
        if to_shield <= shield:
            shield -= to_shield
        else:
            hull_hit += (to_shield - shield) * hull_mult
            shield = 0.0
    else:
        hull_hit = amount * hull_mult

    hull = max(0.0, victim_hull - hull_hit)
    killed = hull <= 0
    if killed:
        # Респавн в бухгалтерии сразу — для игрока это мирроит клиентский Player.respawn();
        # для моба записи просто удаляются после броадкаста (см. remove_mob), это поле
        # там не используется, но killed=True/hull=0 в самом сообщении уже отражает смерть.
        hull, shield = victim_max_hull, victim_max_shield

    return {'dmg': round(amount), 'killed': killed, 'hull': hull, 'shield': shield}


def _apply_pvp_damage(claimed_dmg: float, ceiling: float, penetration: float,
                       victim_hull: float, victim_shield: float,
                       victim_max_hull: float, victim_max_shield: float,
                       crit_chance: float = 0.0, crit_mult: float = 2.0,
                       victim_evasion: float = 0.0,
                       shield_mult: float = 1.0, hull_mult: float = 1.0,
                       burst_mult: float = PVP_BURST_MULT) -> dict:
    """Мирроит shield/hull split из Player.takeDamage (client/src/entities/Player.js).
    Урон — заявка клиента (claimed_dmg, реальный посчитанный урон выстрела со всеми
    баффами/перками), зажатая потолком ceiling*burst_mult — не плоское число на
    весь визит в комнату, но и не слепое доверие. Крит и уклонение всё равно решает
    сервер своим роллом (по статам АТАКУЮЩЕГО — crit_chance/crit_mult, не фиксированные
    для всех), не заявка клиента. Общий расчёт для игрок→игрок и игрок→моб — обе жертвы
    описываются просто парой hull/shield, дальше не важно, чьи они. victim_evasion=0
    для мобов — их движение клиент-локальное, сервер не знает скорость, чтобы честно
    её учитывать. shield_mult/hull_mult — см. _weapon_mults (асимметрия лазера).
    burst_mult по умолчанию PVP_BURST_MULT (слэк на баффы поверх СТАТИЧНОГО
    loadout.dmg у обычного оружия) — способности (ABILITY_DAMAGE_CEILING) передают
    burst_mult=1.0 явно: их ceiling уже САМ ПО СЕБЕ финальный урон одного тика/ракеты,
    не "статичная база до баффов", лишний ×3 сверху не нужен и раньше давал урон
    способности на порядок выше задуманного (баг из диалога: "ракетный залп нанёс
    более 400 тыс урона"). Тонкая обёртка над _roll_pvp_shot+_split_pvp_damage (см.
    выше) — оставлена как есть ради всех существующих вызывающих (моб/турель/абилки)."""
    roll = _roll_pvp_shot(claimed_dmg, ceiling, crit_chance, crit_mult, victim_evasion, burst_mult)
    if roll['dodged']:
        return {'isCrit': False, 'dmg': 0, 'killed': False, 'dodged': True,
                'hull': victim_hull, 'shield': victim_shield}
    r = _split_pvp_damage(roll['amount'], penetration, victim_hull, victim_shield,
                           victim_max_hull, victim_max_shield, shield_mult, hull_mult)
    return {'isCrit': roll['isCrit'], 'dodged': False, **r}


def _drone_public(victim: "PvpPlayerState") -> dict:
    """Снапшот текущего состояния дрона жертвы для pvp_hit_result — клиент рисует
    HP-бар/деспавн дрона по этим полям (см. GameScene._onPvpHitResult), а не по
    отдельному сообщению, чтобы урон и обновление дрона всегда приходили атомарно."""
    active = victim.shield_drone_active_until > time.time()
    return {
        'droneActive': active,
        'droneHull': victim.shield_drone_hull if active else 0.0,
        'droneMaxHull': SHIELD_DRONE_MAX_HULL,
        'droneShield': victim.shield_drone_shield if active else 0.0,
        'droneMaxShield': SHIELD_DRONE_MAX_SHIELD,
    }


def _resolve_pvp_hit(attacker: PvpPlayerState, victim: PvpPlayerState, claimed_dmg: float,
                      weapon_type: str = 'cannon', target_type: str = 'ship') -> "dict | None":
    # Грейс-период после "ремонта на месте" ИЛИ активный "Фазовый кокон" (см.
    # PvpPlayerState.invulnerable_until, pvp_self_heal_claim) — короткое замыкание ДО
    # _apply_pvp_damage, тем же контрактом ответа, что дожд ("dodged"), которым уже
    # пользуется клиент (_onPvpHitResult → showDodge), без урона и без изменения
    # hull/shield жертвы. Применяется и к прямому выстрелу по дрону — фазовый кокон/грейс
    # владельца логично защищает и его дрон тоже (тот же "неуязвимый момент").
    if victim.respawn_grace_until > time.time() or victim.invulnerable_until > time.time():
        return {
            'isCrit': False, 'dmg': 0, 'killed': False, 'dodged': True,
            'hull': victim.hull, 'shield': victim.shield,
            'maxHull': victim.max_hull, 'maxShield': victim.max_shield,
            'damageBy': None, 'bountyBonus': None, **_drone_public(victim), 'droneDestroyed': False,
        }
    shield_mult, hull_mult = _weapon_mults(weapon_type)
    now_ts = time.time()
    drone_active = victim.shield_drone_active_until > now_ts and (
        victim.shield_drone_hull > 0 or victim.shield_drone_shield > 0)

    # ── Прямой выстрел ПО ДРОНУ (клиент явно выбрал дрон целью, см.
    #    GameScene shieldDroneAt/isShieldDrone) — не трогает hull/shield владельца
    #    вообще, свой (более мягкий, 30%) множитель снижения урона.
    if target_type == 'drone':
        if not drone_active:
            return None  # дрон уже не существует — невалидная заявка, вызывающий код игнорирует
        roll = _roll_pvp_shot(claimed_dmg, attacker.loadout['dmg'], attacker.loadout['critChance'],
                               attacker.loadout['critMult'], 0.0)
        if roll['dodged']:  # victim_evasion=0.0 выше — дрон не уклоняется, ветка чисто симметрии ради
            return {
                'isCrit': False, 'dmg': 0, 'killed': False, 'dodged': True,
                'hull': victim.hull, 'shield': victim.shield,
                'maxHull': victim.max_hull, 'maxShield': victim.max_shield,
                'damageBy': None, 'bountyBonus': None, **_drone_public(victim), 'droneDestroyed': False,
            }
        amount = roll['amount'] * (1 - SHIELD_DRONE_DIRECT_REDUCTION)
        d = _split_pvp_damage(amount, attacker.loadout['penetration'],
                               victim.shield_drone_hull, victim.shield_drone_shield,
                               SHIELD_DRONE_MAX_HULL, SHIELD_DRONE_MAX_SHIELD, shield_mult, hull_mult)
        victim.shield_drone_hull, victim.shield_drone_shield = d['hull'], d['shield']
        drone_destroyed = d['killed']
        if drone_destroyed:
            victim.shield_drone_active_until = 0.0
            victim.shield_drone_hull = 0.0
            victim.shield_drone_shield = 0.0
            victim.shield_drone_last_use = now_ts  # КД — от момента реального конца, см. _shield_drone_tick_loop
        if not roll['dodged'] and d['dmg'] > 0:
            victim.damage_by[attacker.user_id] = victim.damage_by.get(attacker.user_id, 0.0) + d['dmg']
        return {
            'isCrit': roll['isCrit'], 'dmg': d['dmg'], 'killed': False, 'dodged': False,
            'hull': victim.hull, 'shield': victim.shield,
            'maxHull': victim.max_hull, 'maxShield': victim.max_shield,
            'damageBy': None, 'bountyBonus': None, **_drone_public(victim), 'droneDestroyed': drone_destroyed,
        }

    # ── Обычный выстрел ПО КОРАБЛЮ владельца — если у него активен дрон, перенаправляем
    #    90% (сниженных вдвое) на дрон, 10% остаётся на владельце как обычно. Крит/
    #    уклонение роллятся ОДИН раз на весь выстрел (владелец либо уклонился целиком —
    #    дрон в таком случае тоже не задет, это один и тот же промах).
    roll = _roll_pvp_shot(claimed_dmg, attacker.loadout['dmg'], attacker.loadout['critChance'],
                           attacker.loadout['critMult'], victim.loadout['evasion'])
    if roll['dodged']:
        return {
            'isCrit': False, 'dmg': 0, 'killed': False, 'dodged': True,
            'hull': victim.hull, 'shield': victim.shield,
            'maxHull': victim.max_hull, 'maxShield': victim.max_shield,
            'damageBy': None, 'bountyBonus': None, **_drone_public(victim), 'droneDestroyed': False,
        }

    drone_destroyed = False
    if drone_active:
        drone_amount = roll['amount'] * SHIELD_DRONE_REDIRECT_PCT * (1 - SHIELD_DRONE_REDIRECT_REDUCTION)
        owner_amount = roll['amount'] * (1 - SHIELD_DRONE_REDIRECT_PCT)
        d = _split_pvp_damage(drone_amount, attacker.loadout['penetration'],
                               victim.shield_drone_hull, victim.shield_drone_shield,
                               SHIELD_DRONE_MAX_HULL, SHIELD_DRONE_MAX_SHIELD, shield_mult, hull_mult)
        victim.shield_drone_hull, victim.shield_drone_shield = d['hull'], d['shield']
        drone_destroyed = d['killed']
        if drone_destroyed:
            victim.shield_drone_active_until = 0.0
            victim.shield_drone_hull = 0.0
            victim.shield_drone_shield = 0.0
            victim.shield_drone_last_use = now_ts  # КД — от момента реального конца, см. _shield_drone_tick_loop
    else:
        owner_amount = roll['amount']

    r = _split_pvp_damage(owner_amount, attacker.loadout['penetration'],
                           victim.hull, victim.shield, victim.max_hull, victim.max_shield,
                           shield_mult, hull_mult)
    victim.hull, victim.shield = r['hull'], r['shield']
    # Репортим ПОЛНЫЙ урон выстрела (roll['amount']), не только долю, доставшуюся кораблю —
    # честь/лут-элигибл считаются по факту "участвовал в бою", не по тому, куда физически
    # ушёл урон (иначе стрельба по игроку с дроном выглядела бы как урон в 10 раз меньше).
    total_dmg = round(roll['amount'])
    if total_dmg > 0:
        victim.damage_by[attacker.user_id] = victim.damage_by.get(attacker.user_id, 0.0) + total_dmg
    damage_by_out = None
    bounty_bonus = None
    if r['killed']:
        victim.respawn_grace_until = time.time() + 3.0
        # Снапшот "кто бил эту жизнь" для лут-бокса (см. pvp_loot_spawn) — победитель
        # и все, кто помогал, увидят коробку; сам victim — нет. Тот же снапшот (уже с
        # суммами, не только ключами) шлём в pvp_hit_result — каждый атаковавший клиент
        # сам считает свою долю урона для пропорциональной чести (см. диалог).
        victim.last_death_eligible = list(victim.damage_by.keys())
        damage_by_out = {str(uid): round(dmg) for uid, dmg in victim.damage_by.items()}
        victim.damage_by = {}
        # Доска розыска: если жертва этой смерти сама была "в розыске" — тройная честь
        # + 20 золота делятся среди всех атаковавших (тот же damage_by_out), розыск снят.
        # Серийный убийца (10+ квалифицирующих жертв, накопленных в той же записи —
        # см. pvp_bounty_post) даёт вдвое больше — награда за поимку "крупной дичи".
        if victim.user_id in bounties:
            b = bounties[victim.user_id]
            mult = 2 if b.get('kills', 1) >= 10 else 1
            bounty_bonus = {'honorMult': 3 * mult, 'gold': 20 * mult}
            del bounties[victim.user_id]
    return {
        'isCrit': roll['isCrit'], 'dmg': total_dmg, 'killed': r['killed'], 'dodged': False,
        'hull': r['hull'], 'shield': r['shield'],
        'maxHull': victim.max_hull, 'maxShield': victim.max_shield,
        'damageBy': damage_by_out, 'bountyBonus': bounty_bonus,
        **_drone_public(victim), 'droneDestroyed': drone_destroyed,
    }


# ── Арена: персонализированный arena_match_end ──────────────────────────
# Раньше все 4 места, шлющие arena_match_end, делали один и тот же
# broadcast_to_uids с СЫРЫМ m.outcome ('win_a'/'win_b'/'draw'/'void') всем игрокам
# одинаково — ArenaMatch.outcome_for(uid) (уже существовавший нормализатор в 'win'/
# 'lose'/'draw'/'void' для конкретного получателя) вызывался только в /arena/
# match-complete (награда), никогда в самом WS-broadcast. Клиент (ArenaController.
# onMatchEnd) ищет outcome в таблице labels — 'win_a' там нет, показывает как есть
# (баг из диалога: "победитель — выводить ник а не просто wins_a"). winnerName —
# дополнительно ник победителя (из PvpPlayerState.username), чтобы проигравший видел,
# КТО именно выиграл, не только сам факт поражения.
async def _broadcast_arena_match_end(m: "ArenaMatch"):
    winner_name = None
    if m.outcome and m.outcome.startswith('win_'):
        winner_team = m.outcome[len('win_'):]
        winner_uids = m.teams.get(winner_team, [])
        if winner_uids:
            winner_state = pvp_room_manager.get(m.room_key, winner_uids[0])
            winner_name = winner_state.username if winner_state else None
    winning_team = m.outcome[len('win_'):] if m.outcome and m.outcome.startswith('win_') else None
    for uid in list(m.team_of.keys()):
        await chat_manager.send_to_uid(uid, {
            'type': 'arena_match_end', 'outcome': m.outcome_for(uid),
            'winningTeam': winning_team, 'winnerName': winner_name,
        })


# ── Арена: обработка килла внутри матча ─────────────────────────────────
# Вызывается из pvp_fire_claim/pvp_ability_fire_claim ПОСЛЕ того, как _resolve_pvp_hit/
# ручная бухгалтерия уже отметили result['killed']=True и сбросили victim.damage_by —
# здесь только арена-специфичные последствия (дуэль завершается, носимый флаг/груз
# роняется, respawn ставится на таймер вместо мгновенного).
async def _arena_on_kill(m: "ArenaMatch", victim: "PvpPlayerState", attacker: "PvpPlayerState"):
    if m.outcome:
        return
    if m.mode == 'duel':
        # До 2 побед из 3 раундов (см. диалог: "должно быть 3 боя, потом только награда
        # победителю") — очки те же self.scores, что и у flag/cargo, просто с другим
        # порогом. Награда — уже как есть: outcome_for() нормализует только на итоговый
        # win_a/win_b, промежуточные раунды наград не дают (нет ArenaMatchCompleteRequest
        # между раундами — клиент зовёт /arena/match-complete только по arena_match_end).
        winner_team = m.team_of.get(attacker.user_id)
        m.scores[winner_team] = m.scores.get(winner_team, 0) + 1
        await chat_manager.broadcast_to_uids(
            list(m.team_of.keys()), {'type': 'arena_score', 'a': m.scores['a'], 'b': m.scores['b']},
        )
        if m.scores[winner_team] >= ARENA_DUEL_ROUNDS_TO_WIN:
            arena_matches.end(m.room_key, f'win_{winner_team}')
            await _broadcast_arena_match_end(m)
            return
        # Не финал — новый раунд: респаун ОБОИХ на своих споунах, полный HP. Клиент сам
        # рестартует 5с обратный отсчёт по получению arena_respawn в duel-режиме (см.
        # ArenaController.onRespawn) — отдельное сообщение не нужно.
        now_ts = time.time()
        for uid, team in list(m.team_of.items()):
            sx, sy = m.spawns[team]
            state = pvp_room_manager.get(m.room_key, uid)
            if state:
                state.x, state.y = sx, sy
                state.hull, state.shield = state.max_hull, state.max_shield
                state.respawn_grace_until = now_ts + 3.0
            m.respawn_at.pop(uid, None)
            await chat_manager.broadcast_to_uids(
                list(m.team_of.keys()), {'type': 'arena_respawn', 'userId': uid, 'x': sx, 'y': sy, 'at': now_ts},
            )
        return
    # 3на3 — уронить флаг/груз, если убитый его несёт; respawn через таймер (тикает
    # _arena_tick_loop), не мгновенно, как обычный "ремонт на месте".
    dropped = False
    if m.mode == 'flag' and m.flags:
        for team, f in m.flags.items():
            if f['carrier'] == victim.user_id:
                f['carrier'] = None
                f['x'], f['y'] = victim.x, victim.y
                # failsafe: никто не тронул за ARENA_FLAG_DROP_TIMEOUT_SEC — сам
                # вернётся на базу (см. arena_flag_return/_arena_tick_loop, диалог:
                # "никто не подбирает — 15 сек и тоже возвращается на базу").
                f['auto_return_at'] = time.time() + ARENA_FLAG_DROP_TIMEOUT_SEC
                dropped = True
    elif m.mode == 'cargo' and m.cargo and m.cargo['carrier'] == victim.user_id:
        m.cargo['carrier'] = None
        m.cargo['x'], m.cargo['y'] = victim.x, victim.y
        dropped = True
    m.respawn_at[victim.user_id] = time.time() + ARENA_RESPAWN_MS / 1000.0
    payload = {'type': 'arena_objective_sync'}
    if m.mode == 'flag':
        payload['flags'] = m.flags
    elif m.mode == 'cargo':
        payload['cargo'] = m.cargo
    if dropped:
        await chat_manager.broadcast_to_uids(list(m.team_of.keys()), payload)


ARENA_TICK_MS = 500


async def _arena_tick_loop():
    """Третий фоновый цикл сервера (после _mob_tick_loop/_offline_ship_tick_loop).
    Респауны по таймеру, декей точек/кумулятивное время владения (см. ArenaMatch.tick —
    абсолютные таймстемпы), проверка победы/дедлайна, watchdog оффлайна >2 мин → void."""
    while True:
        await asyncio.sleep(ARENA_TICK_MS / 1000)
        now = time.time()
        for room_key, m in list(arena_matches.matches.items()):
            if m.outcome:
                continue
            for uid, rat in list(m.respawn_at.items()):
                if now >= rat:
                    del m.respawn_at[uid]
                    team = m.team_of.get(uid)
                    sx, sy = m.spawns.get(team, (0.0, 0.0))
                    state = pvp_room_manager.get(room_key, uid)
                    if state:
                        state.x, state.y = sx, sy
                        state.hull, state.shield = state.max_hull, state.max_shield
                        state.respawn_grace_until = now + 3.0
                    await chat_manager.broadcast_to_uids(
                        list(m.team_of.keys()),
                        {'type': 'arena_respawn', 'userId': uid, 'x': sx, 'y': sy, 'at': now},
                    )
            # Груз: пауза после доставки (ARENA_CARGO_RESPAWN_SEC, см. arena_cargo_deliver) —
            # available=False, x/y=None, до этого момента подбирать нечего.
            if m.mode == 'cargo' and m.cargo and not m.cargo.get('available', True) and now >= m.cargo['next_spawn_at']:
                cx, cy = ARENA_CARGO_SPAWN
                m.cargo = {'spawned_at': now, 'carrier': None, 'x': cx, 'y': cy,
                           'next_spawn_at': now, 'available': True}
                await chat_manager.broadcast_to_uids(list(m.team_of.keys()),
                                                      {'type': 'arena_objective_sync', 'cargo': m.cargo})
            # Флаг: авто-возврат упавшего флага домой — либо 3с после касания своим (см.
            # arena_flag_return), либо 15с failsafe без касаний вовсе (см. _arena_on_kill).
            if m.mode == 'flag' and m.flags:
                for team, f in m.flags.items():
                    if f['carrier'] is None and not f['at_base'] and f['auto_return_at'] and now >= f['auto_return_at']:
                        sx, sy = m.spawns[team]
                        f['x'], f['y'] = sx, sy
                        f['at_base'] = True
                        f['auto_return_at'] = None
                        await chat_manager.broadcast_to_uids(list(m.team_of.keys()),
                                                              {'type': 'arena_objective_sync', 'flags': m.flags})
            m.tick(now)
            outcome = m.check_win(now)
            if not outcome and now >= m.deadline:
                outcome = m.deadline_outcome()
            if outcome:
                arena_matches.end(room_key, outcome)
                await _broadcast_arena_match_end(m)
                continue
            for uid, dat in list(m.disconnected_at.items()):
                if now - dat > ARENA_OFFLINE_ABORT_MS / 1000.0:
                    arena_matches.end(room_key, 'void')
                    await _broadcast_arena_match_end(m)
                    break
        arena_matches.cleanup_ended(now)


# ── Friends helpers ───────────────────────────────────────────────────

def _online_names() -> set[str]:
    return {m['name'] for m in chat_manager.active.values()}


def _online_sectors() -> dict[str, str]:
    return {m['name']: m.get('sector', '') for m in chat_manager.active.values()}


async def _get_friend_list(username: str, db: AsyncSession) -> list[dict]:
    online   = _online_names()
    sectors  = _online_sectors()
    rows = (await db.execute(select(Friendship).where(
        or_(Friendship.user_a == username, Friendship.user_b == username)
    ))).scalars().all()
    result = []
    for r in rows:
        other     = r.user_b if r.user_a == username else r.user_a
        direction = 'out'    if r.user_a == username else 'in'
        result.append({
            'name':   other,
            'status': r.status,
            'dir':    direction,
            'online': other in online,
            'sector': sectors.get(other, ''),
        })
    return result


def _fmt_time(ts: float) -> str:
    from datetime import datetime as _dt
    return _dt.utcfromtimestamp(ts).strftime('%H:%M')


def _to_db_ch(frontend_ch: str, corp_ch: str, clan_ch) -> str:
    if frontend_ch == 'corp': return corp_ch
    if frontend_ch == 'clan': return clan_ch or 'clan_none'
    return frontend_ch


def _to_frontend_ch(db_ch: str) -> str:
    if db_ch.startswith('corp_'): return 'corp'
    if db_ch.startswith('clan_'): return 'clan'
    return db_ch


async def _player_channels(user_id: int, db: AsyncSession):
    ps = (await db.execute(select(PlayerState).where(PlayerState.user_id == user_id))).scalar_one_or_none()
    state = (ps.state or {}) if ps else {}
    corp = state.get('playerCorp') or 'helios'
    corp_ch = f'corp_{corp}' if corp != 'neutral' else 'corp_helios'
    clan_tag = state.get('clanTag')
    clan_ch = f'clan_{clan_tag}' if clan_tag else None
    return corp_ch, clan_ch


async def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    user_id = decode_token(creds.credentials)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


# ── Auth ─────────────────────────────────────────────────────────────

VERIFICATION_CODE_TTL_MIN = 30
VERIFICATION_RESEND_COOLDOWN_SEC = 60


def _gen_verification_code() -> str:
    return f"{random.randint(0, 999999):06d}"


async def _issue_verification_code(user: User, db: AsyncSession):
    # Один активный код — предыдущий удаляем, а не помечаем использованным (см. models.py).
    await db.execute(delete(EmailVerificationToken).where(EmailVerificationToken.user_id == user.id))
    code = _gen_verification_code()
    db.add(EmailVerificationToken(
        user_id=user.id, code=code,
        expires_at=datetime.utcnow() + timedelta(minutes=VERIFICATION_CODE_TTL_MIN),
    ))
    await db.commit()
    # Отправка блокирующая (smtplib) — в тред-пул, тот же приём, что и bcrypt ниже.
    await asyncio.to_thread(send_verification_code, user.email, code)


def _needs_verification(user: User) -> bool:
    # Аккаунты без email (созданные до Milestone 1) не гейтятся — им нечего верифицировать.
    return bool(user.email) and not user.email_verified


@app.post("/auth/register", response_model=TokenResponse)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    existing = (await db.execute(select(User).where(User.username == body.username))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="Username already taken")
    existing_email = (await db.execute(select(User).where(User.email == body.email))).scalar_one_or_none()
    if existing_email:
        raise HTTPException(status_code=400, detail="Email already registered")
    # bcrypt намеренно медленный (CPU-bound) — в тред-пул, иначе блокирует event loop
    # на ~100-300мс на КАЖДУЮ регистрацию (см. диалог про нагрузочный тест).
    password_hash = await asyncio.to_thread(hash_password, body.password)
    user = User(username=body.username, email=body.email, password_hash=password_hash, email_verified=0)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    await _issue_verification_code(user, db)
    return TokenResponse(access_token=create_token(user.id), username=user.username, email_verified=False)


@app.post("/auth/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    user = (await db.execute(select(User).where(User.username == body.username))).scalar_one_or_none()
    if not user or not await asyncio.to_thread(verify_password, body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    return TokenResponse(access_token=create_token(user.id), username=user.username,
                          email_verified=not _needs_verification(user))


@app.get("/auth/me", response_model=UserResponse)
def me(user: User = Depends(get_current_user)):
    return UserResponse(id=user.id, username=user.username, email=user.email,
                         email_verified=not _needs_verification(user))


@app.post("/auth/verify-email")
async def verify_email(
    body: VerifyEmailRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    code = body.code.strip()
    token = (await db.execute(select(EmailVerificationToken).where(
        EmailVerificationToken.user_id == user.id, EmailVerificationToken.code == code,
    ))).scalar_one_or_none()
    if not token or token.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Неверный или истёкший код")
    user.email_verified = 1
    await db.execute(delete(EmailVerificationToken).where(EmailVerificationToken.user_id == user.id))
    await db.commit()
    return {"ok": True}


@app.post("/auth/resend-verification")
async def resend_verification(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not user.email:
        raise HTTPException(status_code=400, detail="У аккаунта не указан email")
    if user.email_verified:
        return {"ok": True}
    existing = (await db.execute(select(EmailVerificationToken).where(
        EmailVerificationToken.user_id == user.id
    ))).scalar_one_or_none()
    if existing and existing.created_at > datetime.utcnow() - timedelta(seconds=VERIFICATION_RESEND_COOLDOWN_SEC):
        raise HTTPException(status_code=429, detail="Повторная отправка доступна через минуту")
    await _issue_verification_code(user, db)
    return {"ok": True}


@app.post("/auth/change-password")
async def change_password(
    body: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not await asyncio.to_thread(verify_password, body.current_password, user.password_hash):
        raise HTTPException(status_code=401, detail="Текущий пароль неверен")
    user.password_hash = await asyncio.to_thread(hash_password, body.new_password)
    await db.commit()
    return {"ok": True}


@app.post("/auth/change-email", response_model=TokenResponse)
async def change_email(
    body: ChangeEmailRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not await asyncio.to_thread(verify_password, body.current_password, user.password_hash):
        raise HTTPException(status_code=401, detail="Текущий пароль неверен")
    existing = (await db.execute(select(User).where(
        User.email == body.new_email, User.id != user.id
    ))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="Email уже используется")
    user.email = body.new_email
    user.email_verified = 0
    await db.commit()
    await _issue_verification_code(user, db)
    return TokenResponse(access_token=create_token(user.id), username=user.username, email_verified=False)


USERNAME_CHANGE_COOLDOWN_HOURS = 24


@app.post("/auth/change-username", response_model=TokenResponse)
async def change_username(
    body: ChangeUsernameRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Без подтверждения по почте — сознательно (см. диалог): в отличие от смены email,
    # смена ника не меняет канал восстановления доступа к аккаунту, так что более
    # тяжёлая email-верификация здесь не нужна, только суточный кулдаун + проверка формата
    # и уникальности (обе — тем же правилом, что и при регистрации, см. validate_username_format).
    new_name = body.new_username
    if new_name == user.username:
        raise HTTPException(status_code=400, detail="Это уже ваш текущий ник")

    if user.username_changed_at and user.username_changed_at > datetime.utcnow() - timedelta(hours=USERNAME_CHANGE_COOLDOWN_HOURS):
        next_ok = user.username_changed_at + timedelta(hours=USERNAME_CHANGE_COOLDOWN_HOURS)
        raise HTTPException(status_code=429, detail=f"Смена ника доступна раз в сутки — попробуйте после {next_ok.strftime('%Y-%m-%d %H:%M')} UTC")

    existing = (await db.execute(select(User).where(User.username == new_name, User.id != user.id))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="Username already taken")

    old_name = user.username
    # Friendship/Blacklist/PrivateMessage/ChatMessage хранят ник строкой, не user_id FK
    # (см. models.py) — без каскадного обновления смена ника молча "оборвала" бы игрока
    # от уже существующих друзей/чёрного списка/переписки под старым именем.
    await db.execute(update(Friendship).where(Friendship.user_a == old_name).values(user_a=new_name))
    await db.execute(update(Friendship).where(Friendship.user_b == old_name).values(user_b=new_name))
    await db.execute(update(Blacklist).where(Blacklist.blocker == old_name).values(blocker=new_name))
    await db.execute(update(Blacklist).where(Blacklist.blocked == old_name).values(blocked=new_name))
    await db.execute(update(PrivateMessage).where(PrivateMessage.from_username == old_name).values(from_username=new_name))
    await db.execute(update(PrivateMessage).where(PrivateMessage.to_username == old_name).values(to_username=new_name))
    await db.execute(update(ChatMessage).where(ChatMessage.username == old_name).values(username=new_name))

    user.username = new_name
    user.username_changed_at = datetime.utcnow()
    await db.commit()
    # Токен несёт только user.id (см. auth.create_token), переиздавать не обязательно —
    # но клиенту нужно обновить закешированный ник в sessionStorage (см. api.setSession)
    # и переподключить WS-чат, чтобы chat_manager/group_manager на сервере тоже увидели
    # новое имя (оба держат его в памяти с момента pvp_enter/connect, а не перечитывают из БД).
    return TokenResponse(access_token=create_token(user.id), username=user.username,
                          email_verified=not _needs_verification(user))


# ── Player state ──────────────────────────────────────────────────────

@app.get("/player/state", response_model=PlayerStateResponse)
async def get_state(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    ps = (await db.execute(select(PlayerState).where(PlayerState.user_id == user.id))).scalar_one_or_none()
    return PlayerStateResponse(
        state=ps.state if ps else {},
        updated_at=ps.updated_at if ps else None,
    )


@app.put("/player/state")
async def save_state(
    body: dict,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ps = (await db.execute(select(PlayerState).where(PlayerState.user_id == user.id))).scalar_one_or_none()
    if ps:
        ps.state = body
    else:
        ps = PlayerState(user_id=user.id, state=body)
        db.add(ps)
    await db.commit()
    return {"ok": True}


# ── Player profile ────────────────────────────────────────────────────

async def _pvp_win_count(username: str, db: AsyncSession) -> int:
    # PvP-победы не хранятся как отдельный счётчик — считаем по AuditLog(action='pvp_kill'),
    # который сервер и так пишет на каждое убийство (см. pvp_hit-обработчик выше). json_extract
    # работает через встроенный SQLite JSON1 (доступен в любой современной сборке sqlite3).
    result = await db.execute(
        select(func.count()).select_from(AuditLog).where(
            AuditLog.action == 'pvp_kill',
            func.json_extract(AuditLog.params, '$.killer') == username,
        )
    )
    return result.scalar_one() or 0


def _profile_to_response(user: User, pp: PlayerProfile | None, pvp_wins: int = 0) -> ProfileSelfResponse:
    if not pp:
        return ProfileSelfResponse(username=user.username, pvp_wins=pvp_wins)
    effective_ship = pp.favorite_ship_key if pp.favorite_ship_is_manual else pp.favorite_ship_auto
    return ProfileSelfResponse(
        username=user.username,
        display_name=pp.display_name,
        country=pp.country,
        city=pp.city,
        goal=pp.goal,
        favorite_games=pp.favorite_games,
        social_links=pp.social_links or {},
        favorite_ship_key=effective_ship,
        favorite_ship_is_manual=bool(pp.favorite_ship_is_manual),
        privacy=pp.privacy,
        updated_at=pp.updated_at,
        pvp_wins=pvp_wins,
    )


async def _owned_ships(user_id: int, db: AsyncSession) -> set:
    # favorite_ship_key/favorite_ship_auto клиент-заявочны (как и весь остальной прогресс,
    # см. PlayerState.state) — единственная защита от подмены "у меня корабль, которого нет"
    # это сверка с ownedShips из того же клиент-доверенного блока при принятии значения.
    ps = (await db.execute(select(PlayerState).where(PlayerState.user_id == user_id))).scalar_one_or_none()
    return set((ps.state or {}).get('ownedShips', [])) if ps else set()


@app.get("/player/profile", response_model=ProfileSelfResponse)
async def get_profile(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    pp = (await db.execute(select(PlayerProfile).where(PlayerProfile.user_id == user.id))).scalar_one_or_none()
    pvp_wins = await _pvp_win_count(user.username, db)
    return _profile_to_response(user, pp, pvp_wins)


@app.patch("/player/profile", response_model=ProfileSelfResponse)
async def update_profile(
    body: ProfileUpdateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pp = (await db.execute(select(PlayerProfile).where(PlayerProfile.user_id == user.id))).scalar_one_or_none()
    if not pp:
        pp = PlayerProfile(user_id=user.id)
        db.add(pp)

    data = body.model_dump(exclude_unset=True)

    if 'display_name' in data:     pp.display_name = data['display_name']
    if 'country' in data:          pp.country = data['country']
    if 'city' in data:             pp.city = data['city']
    if 'goal' in data:             pp.goal = data['goal']
    if 'favorite_games' in data:   pp.favorite_games = data['favorite_games']
    if 'social_links' in data:     pp.social_links = data['social_links'] or {}
    if 'privacy' in data:          pp.privacy = data['privacy']

    if 'favorite_ship_auto' in data:
        auto_key = data['favorite_ship_auto']
        if auto_key is None or auto_key in await _owned_ships(user.id, db):
            pp.favorite_ship_auto = auto_key

    if 'favorite_ship_key' in data:
        manual_key = data['favorite_ship_key']
        if manual_key is None:
            pp.favorite_ship_is_manual = 0
        elif manual_key in await _owned_ships(user.id, db):
            pp.favorite_ship_key = manual_key
            pp.favorite_ship_is_manual = 1
        else:
            raise HTTPException(status_code=400, detail="You don't own this ship")

    await db.commit()
    await db.refresh(pp)
    pvp_wins = await _pvp_win_count(user.username, db)
    return _profile_to_response(user, pp, pvp_wins)


MAX_PILOT_LEVEL = 50


def _xp_to_next(level: int) -> float:
    # Порт xpToNext() из client/src/leveling.js — уровень/честь показываются в чужом
    # профиле как ЖИВЫЕ данные из PlayerState.state (не дублируются в PlayerProfile),
    # поэтому формула уровня по XP должна совпадать 1:1 с клиентской.
    if level >= MAX_PILOT_LEVEL:
        return float('inf')
    knee = max(0, level - 25)
    base = 40 * level * level + 13 * knee ** 3
    if level >= 46:
        return base * 6
    if level >= 40:
        return base * 4.5
    return base


def _level_from_xp(total_xp: float) -> int:
    level, acc = 1, 0.0
    while level < MAX_PILOT_LEVEL:
        need = _xp_to_next(level)
        if total_xp < acc + need:
            break
        acc += need
        level += 1
    return level


@app.get("/player/profile/{username}", response_model=ProfilePublicResponse)
async def get_public_profile(
    username: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    target = (await db.execute(select(User).where(User.username == username))).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="Player not found")

    denied = HTTPException(status_code=403, detail="This player's profile is private")

    # Заблокировал ли ЦЕЛЬ смотрящего? (обратное — смотрящий заблокировал цель — НЕ
    # проверяем: смотреть профиль того, кого сам заблокировал, можно, см. план §6.3.)
    blocked = (await db.execute(select(Blacklist).where(
        Blacklist.blocker == target.username, Blacklist.blocked == user.username
    ))).scalar_one_or_none()
    if blocked:
        raise denied

    pp = (await db.execute(select(PlayerProfile).where(PlayerProfile.user_id == target.id))).scalar_one_or_none()
    privacy = pp.privacy if pp else 'everyone'

    if privacy == 'nobody':
        raise denied
    if privacy == 'friends':
        friendship = (await db.execute(select(Friendship).where(
            Friendship.status == 'accepted',
            or_(
                and_(Friendship.user_a == user.username, Friendship.user_b == target.username),
                and_(Friendship.user_a == target.username, Friendship.user_b == user.username),
            )
        ))).scalar_one_or_none()
        if not friendship:
            raise denied

    ps = (await db.execute(select(PlayerState).where(PlayerState.user_id == target.id))).scalar_one_or_none()
    state = (ps.state or {}) if ps else {}
    xp    = state.get('pilotXp') or 0
    honor = state.get('pilotHonor')
    corp  = state.get('playerCorp')
    playtime_sec = sum((state.get('shipPlayTimeSec') or {}).values())
    # Гильдии — целиком клиент-доверенная моковая система (нет отдельной таблицы,
    # см. ClanScene/GameScene._serializeState), поэтому читаем как есть из state.clan.
    clan = state.get('clan') or {}

    effective_ship = None
    if pp:
        effective_ship = pp.favorite_ship_key if pp.favorite_ship_is_manual else pp.favorite_ship_auto

    pvp_wins = await _pvp_win_count(target.username, db)

    return ProfilePublicResponse(
        username=target.username,
        display_name=pp.display_name if pp else None,
        country=pp.country if pp else None,
        city=pp.city if pp else None,
        goal=pp.goal if pp else None,
        favorite_games=pp.favorite_games if pp else None,
        social_links=(pp.social_links or {}) if pp else {},
        favorite_ship_key=effective_ship,
        level=_level_from_xp(xp),
        xp=xp,
        honor=honor,
        corp=corp,
        pvp_wins=pvp_wins,
        playtime_hours=round(playtime_sec / 3600, 1) if playtime_sec else None,
        clan_name=clan.get('name'),
        clan_tag=clan.get('tag'),
    )


# ── Blacklist ─────────────────────────────────────────────────────────
# REST only — в отличие от Friendship, блокировка однонаправленна и НЕ должна уведомлять
# заблокированного в реальном времени (тихая блокировка — стандартный UX), поэтому не
# нужна WS-инфраструктура live-broadcast, которой пользуются friend_add/accept/decline.

def _blacklist_response(rows) -> BlacklistListResponse:
    # Blacklist.blocked (не .username — такого поля на модели нет) — имя заблокированного.
    return BlacklistListResponse(blocked=[
        BlacklistEntryResponse(username=r.blocked, created_at=r.created_at) for r in rows
    ])


@app.post("/player/blacklist", response_model=BlacklistListResponse)
async def add_blacklist(
    body: BlacklistAddRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    target_name = body.username.strip()
    if not target_name or target_name == user.username:
        raise HTTPException(status_code=400, detail="Invalid username")
    target = (await db.execute(select(User).where(User.username == target_name))).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="Player not found")

    existing = (await db.execute(select(Blacklist).where(
        Blacklist.blocker == user.username, Blacklist.blocked == target_name
    ))).scalar_one_or_none()
    if not existing:
        db.add(Blacklist(blocker=user.username, blocked=target_name))
        # Блокировка подразумевает разрыв дружбы — иначе заблокированный "друг" всё ещё
        # висел бы в списке друзей, при этом не имея возможности написать (см. _resolve_pvp
        # -style рассуждение в плане: путаница хуже, чем неявный анфренд).
        await db.execute(delete(Friendship).where(
            or_(
                and_(Friendship.user_a == user.username, Friendship.user_b == target_name),
                and_(Friendship.user_a == target_name,   Friendship.user_b == user.username),
            )
        ))
        await db.commit()

    rows = (await db.execute(select(Blacklist).where(Blacklist.blocker == user.username))).scalars().all()
    return _blacklist_response(rows)


@app.delete("/player/blacklist/{username}", response_model=BlacklistListResponse)
async def remove_blacklist(
    username: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(delete(Blacklist).where(Blacklist.blocker == user.username, Blacklist.blocked == username))
    await db.commit()
    rows = (await db.execute(select(Blacklist).where(Blacklist.blocker == user.username))).scalars().all()
    return _blacklist_response(rows)


@app.get("/player/blacklist", response_model=BlacklistListResponse)
async def get_blacklist(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Blacklist).where(Blacklist.blocker == user.username))).scalars().all()
    return _blacklist_response(rows)


# ── Личные сообщения ──────────────────────────────────────────────────
# Отправка — только через WS (see msg_type == 'pm' в /ws/chat): клиент всегда на связи
# во время игры, дублировать REST-эндпоинт отправки означало бы два пути для одной
# операции. REST здесь — только для истории/непрочитанных/пометки прочитанным
# (запрос-ответ, не live-push), см. план.

@app.get("/player/pm/history", response_model=PmHistoryResponse)
async def get_pm_history(
    with_user: str,
    limit: int = 50,
    before_id: Optional[int] = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    conditions = [or_(
        and_(PrivateMessage.from_username == user.username, PrivateMessage.to_username == with_user),
        and_(PrivateMessage.from_username == with_user, PrivateMessage.to_username == user.username),
    )]
    if before_id is not None:
        conditions.append(PrivateMessage.id < before_id)
    q = (select(PrivateMessage).where(and_(*conditions))
         .order_by(PrivateMessage.id.desc()).limit(max(1, min(limit, 200))))
    rows = (await db.execute(q)).scalars().all()

    unread_count = (await db.execute(
        select(func.count(PrivateMessage.id)).where(
            PrivateMessage.to_user_id == user.id,
            PrivateMessage.from_username == with_user,
            PrivateMessage.read_at.is_(None),
        )
    )).scalar_one()

    return PmHistoryResponse(
        messages=[PmMessageResponse(
            id=r.id, from_username=r.from_username, to_username=r.to_username,
            text=r.text, ts=r.ts, read_at=r.read_at,
        ) for r in reversed(rows)],
        unread_count=unread_count,
    )


@app.get("/player/pm/threads", response_model=PmThreadsResponse)
async def get_pm_threads(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    # Реальный список переписок (не список друзей — сообщать можно кому угодно, см.
    # диалог), поэтому строим его из фактических PrivateMessage-строк, где юзер — любая
    # из сторон. Порядок по ts убывающий → берём первое вхождение на партнёра = последнее
    # сообщение (dict сохраняет порядок вставки в Python 3.7+).
    rows = (await db.execute(
        select(PrivateMessage).where(
            or_(PrivateMessage.from_user_id == user.id, PrivateMessage.to_user_id == user.id)
        ).order_by(PrivateMessage.ts.desc())
    )).scalars().all()

    threads: dict[str, dict] = {}
    for r in rows:
        partner = r.to_username if r.from_user_id == user.id else r.from_username
        if partner not in threads:
            threads[partner] = {"username": partner, "last_text": r.text, "last_ts": r.ts, "unread_count": 0}

    unread_rows = (await db.execute(
        select(PrivateMessage.from_username, func.count(PrivateMessage.id))
        .where(PrivateMessage.to_user_id == user.id, PrivateMessage.read_at.is_(None))
        .group_by(PrivateMessage.from_username)
    )).all()
    for name, cnt in unread_rows:
        threads.setdefault(name, {"username": name, "last_text": "", "last_ts": 0.0, "unread_count": 0})
        threads[name]["unread_count"] = cnt

    ordered = sorted(threads.values(), key=lambda t: t["last_ts"], reverse=True)
    return PmThreadsResponse(threads=[PmThreadResponse(**t) for t in ordered])


@app.get("/player/pm/unread-summary", response_model=PmUnreadSummaryResponse)
async def get_pm_unread_summary(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(PrivateMessage.from_username, func.count(PrivateMessage.id))
        .where(PrivateMessage.to_user_id == user.id, PrivateMessage.read_at.is_(None))
        .group_by(PrivateMessage.from_username)
    )).all()
    by_user = {name: cnt for name, cnt in rows}
    return PmUnreadSummaryResponse(by_user=by_user, total=sum(by_user.values()))


@app.post("/player/pm/mark-read")
async def mark_pm_read(
    body: PmMarkReadRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(
        update(PrivateMessage)
        .where(
            PrivateMessage.id.in_(body.message_ids),
            PrivateMessage.to_user_id == user.id,
            PrivateMessage.read_at.is_(None),
        )
        .values(read_at=datetime.utcnow())
    )
    await db.commit()
    return {"ok": True}


# ── Audit log ─────────────────────────────────────────────────────────

@app.get("/audit", response_model=list[AuditEntryResponse])
async def get_audit(
    limit: int = 200,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(AuditLog).order_by(AuditLog.ts.desc()).limit(max(1, min(limit, 500)))
    )).scalars().all()
    result = []
    for row in rows:
        u = await db.get(User, row.user_id) if row.user_id else None
        result.append(AuditEntryResponse(
            id=row.id, action=row.action, params=row.params,
            sector=row.sector, ts=row.ts,
            username=u.username if u else None,
        ))
    return result


@app.post("/audit")
async def add_audit(
    body: AuditEntryCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    entry = AuditLog(user_id=user.id, action=body.action, params=body.params, sector=body.sector)
    db.add(entry)
    await db.commit()
    return {"ok": True}


@app.get("/")
def root():
    return {"status": "ok", "service": "Stellar Drift API"}


# ── Данж-инстансы ─────────────────────────────────────────────────────
# Клиент-доверенная модель, как и PlayerState: сервер хранит то, что репортит
# клиент (какие мобы убиты, какой лут на полу), без независимой валидации
# симуляции — согласуется с остальной архитектурой игры (кредиты/опыт/лут
# тоже целиком считаются клиентом). day_key — локальная дата клиента
# (сутки данжа начинаются в 01:00), передаётся явным параметром.

DUNGEON_LIVES_MAX = 7


async def _get_or_create_lives(db: AsyncSession, user_id: int, dungeon_key: str, day_key: str) -> DungeonLives:
    row = (await db.execute(select(DungeonLives).where(
        DungeonLives.user_id == user_id,
        DungeonLives.dungeon_key == dungeon_key,
        DungeonLives.day_key == day_key,
    ))).scalar_one_or_none()
    if not row:
        row = DungeonLives(user_id=user_id, dungeon_key=dungeon_key, day_key=day_key, lives_used=0, locked_out=0)
        db.add(row)
        await db.commit()
        await db.refresh(row)
    return row


@app.get("/dungeon/status", response_model=DungeonStatusResponse)
async def dungeon_status(
    key: str,
    dayKey: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    lives = await _get_or_create_lives(db, user.id, key, dayKey)
    remaining = max(0, DUNGEON_LIVES_MAX - lives.lives_used)
    locked = bool(lives.locked_out)
    reason = "Данж уже пройден сегодня или жизни исчерпаны — доступ откроется в 01:00." if locked else None
    return DungeonStatusResponse(
        canEnter=not locked, livesUsed=lives.lives_used,
        livesRemaining=remaining, lockedOut=locked, reason=reason,
    )


@app.post("/dungeon/enter", response_model=DungeonEnterResponse)
async def dungeon_enter(
    body: DungeonEnterRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    lives = await _get_or_create_lives(db, user.id, body.key, body.dayKey)
    if lives.locked_out:
        return DungeonEnterResponse(ok=False, reason="Данж уже пройден сегодня или жизни исчерпаны.")

    # Ключ инстанса НЕ включает сложность: один выделенный инстанс на
    # (данж, сутки, соло-юзер/группа) — сложность фиксируется первым входом
    # и возвращается клиенту, чтобы модалка выбора не создавала второй инстанс.
    run = (await db.execute(select(DungeonRun).where(
        DungeonRun.dungeon_key == body.key,
        DungeonRun.day_key == body.dayKey,
        DungeonRun.owner_kind == body.ownerKind,
        DungeonRun.owner_key == body.ownerKey,
    ))).scalar_one_or_none()
    if not run:
        run = DungeonRun(
            dungeon_key=body.key, difficulty=body.difficulty, day_key=body.dayKey,
            owner_kind=body.ownerKind, owner_key=body.ownerKey,
            variant_index=body.variantIndex, killed_mob_ids=[], floor_loot=[],
            corridor_state=None, boss_alive=1, completed=0,
        )
        db.add(run)
        await db.commit()
        await db.refresh(run)

    remaining = max(0, DUNGEON_LIVES_MAX - lives.lives_used)
    return DungeonEnterResponse(
        ok=True, runId=run.id, difficulty=run.difficulty, variantIndex=run.variant_index,
        killedMobIds=run.killed_mob_ids or [], floorLoot=run.floor_loot or [],
        corridorState=run.corridor_state, bossAlive=bool(run.boss_alive),
        completed=bool(run.completed), livesUsed=lives.lives_used, livesRemaining=remaining,
    )


@app.post("/dungeon/mob_killed")
async def dungeon_mob_killed(
    body: DungeonMobKilledRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    run = await db.get(DungeonRun, body.runId)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    ids = list(run.killed_mob_ids or [])
    if body.mobId not in ids:
        ids.append(body.mobId)
        run.killed_mob_ids = ids
        await db.commit()
    return {"ok": True}


@app.post("/dungeon/loot_drop")
async def dungeon_loot_drop(
    body: DungeonLootDropRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    run = await db.get(DungeonRun, body.runId)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    loot = list(run.floor_loot or [])
    loot.append(body.loot)
    run.floor_loot = loot
    await db.commit()
    return {"ok": True}


@app.post("/dungeon/loot_collected")
async def dungeon_loot_collected(
    body: DungeonLootCollectedRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    run = await db.get(DungeonRun, body.runId)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    run.floor_loot = [l for l in (run.floor_loot or []) if l.get('id') != body.lootId]
    await db.commit()
    return {"ok": True}


@app.post("/dungeon/corridor_state")
async def dungeon_corridor_state(
    body: DungeonCorridorStateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    run = await db.get(DungeonRun, body.runId)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    run.corridor_state = body.state
    await db.commit()
    return {"ok": True}


@app.post("/dungeon/death", response_model=DungeonDeathResponse)
async def dungeon_death(
    body: DungeonDeathRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    lives = await _get_or_create_lives(db, user.id, body.key, body.dayKey)
    # Аргус (админский слив) репортится с другим key, не относящимся к данжам —
    # клиент просто не вызывает этот эндпоинт для смертей вне sec.isDungeon.
    if not lives.locked_out:
        lives.lives_used = min(DUNGEON_LIVES_MAX, lives.lives_used + 1)
        if lives.lives_used >= DUNGEON_LIVES_MAX:
            lives.locked_out = 1
        await db.commit()
    remaining = max(0, DUNGEON_LIVES_MAX - lives.lives_used)
    return DungeonDeathResponse(
        livesUsed=lives.lives_used, livesRemaining=remaining, lockedOut=bool(lives.locked_out),
    )


# ── Арена: дневной лимит награждённых матчей ────────────────────────────
# Сервер авторитетен ЗДЕСЬ (исход матча сервер знает сам — он вёл ArenaMatch),
# в отличие от общей "клиент-доверенной" модели прогресса (кредиты/xp/честь
# считает и применяет клиент через PUT /player/state, как обычно). Мы гейтим
# только сам факт "матч выиграл/сыграл вничью и лимит не исчерпан" — суммы
# честь/золото клиент применяет и сохраняет как всегда. Тот же принцип, что
# DungeonLives гейтит вход/жизни, не пересчитывая сам лут данжа.

async def _get_or_create_arena_daily(db: AsyncSession, user_id: int, day_key: str) -> ArenaDaily:
    row = (await db.execute(select(ArenaDaily).where(
        ArenaDaily.user_id == user_id,
        ArenaDaily.day_key == day_key,
    ))).scalar_one_or_none()
    if not row:
        row = ArenaDaily(user_id=user_id, day_key=day_key, rewarded_count=0)
        db.add(row)
        await db.commit()
        await db.refresh(row)
    return row


@app.get("/arena/status", response_model=ArenaStatusResponse)
async def arena_status(
    dayKey: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = await _get_or_create_arena_daily(db, user.id, dayKey)
    return ArenaStatusResponse(
        rewardedToday=row.rewarded_count,
        remaining=max(0, ARENA_DAILY_CAP - row.rewarded_count),
    )


@app.post("/arena/match-complete", response_model=ArenaMatchCompleteResponse)
async def arena_match_complete(
    body: ArenaMatchCompleteRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    m = arena_matches.matches.get(f"arena:{body.matchId}")
    if not m or user.id not in m.team_of:
        return ArenaMatchCompleteResponse(eligible=False, reason="not_in_match")
    if user.id in m.claimed:
        return ArenaMatchCompleteResponse(eligible=False, reason="already_claimed")
    server_outcome = m.outcome_for(user.id)
    if server_outcome != body.outcome:
        return ArenaMatchCompleteResponse(eligible=False, reason="outcome_mismatch")
    m.claimed.add(user.id)
    if server_outcome in ('lose', 'void'):
        return ArenaMatchCompleteResponse(eligible=False, reason=server_outcome)
    row = await _get_or_create_arena_daily(db, user.id, body.dayKey)
    if row.rewarded_count >= ARENA_DAILY_CAP:
        return ArenaMatchCompleteResponse(eligible=False, reason="cap", rewardedCount=row.rewarded_count)
    row.rewarded_count += 1
    await db.commit()
    reward = ARENA_REWARD[server_outcome]
    return ArenaMatchCompleteResponse(
        eligible=True, honor=reward['honor'], gold=reward['gold'], rewardedCount=row.rewarded_count,
    )


@app.post("/dungeon/complete")
async def dungeon_complete(
    body: DungeonCompleteRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    run = await db.get(DungeonRun, body.runId)
    if run:
        run.completed = 1
        run.boss_alive = 0
        await db.commit()
    # Прохождение засчитывается всем участникам группы (или только себе, соло) —
    # суточная попытка расходуется за коллективный клир, не только у того,
    # чей клиент отправил событие.
    names = set(body.memberUsernames) | {user.username}
    for name in names:
        member = (await db.execute(select(User).where(User.username == name))).scalar_one_or_none()
        if not member:
            continue
        lives = await _get_or_create_lives(db, member.id, body.key, body.dayKey)
        lives.locked_out = 1
        await db.commit()
    return {"ok": True}


# ── Mining bases (PvP) ───────────────────────────────────────────────
# Базы делят все игроки в секторе (не user-scoped state) — сервер просто хранит
# JSON-блоб, который строит клиент (MiningBase._persist()), и отдаёт его целиком
# всем, кто заходит в сектор. Не разбираем структуру на сервере, ровно как
# PlayerState.state — источник истины по геймдизайну баз остаётся в клиенте.

@app.get("/mining_base/sector/{sector}", response_model=MiningBaseSectorResponse)
async def mining_base_sector(
    sector: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(select(MiningBaseState).where(MiningBaseState.sector == sector))).scalars().all()
    return MiningBaseSectorResponse(bases={r.base_id: r.state for r in rows})


@app.post("/mining_base/save")
async def mining_base_save(
    body: MiningBaseSaveRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = (await db.execute(select(MiningBaseState).where(MiningBaseState.base_id == body.baseId))).scalar_one_or_none()
    if row:
        row.state = body.state
        row.sector = body.sector
    else:
        row = MiningBaseState(base_id=body.baseId, sector=body.sector, state=body.state)
        db.add(row)
    await db.commit()
    return {"ok": True}


# ── Chat REST ─────────────────────────────────────────────────────────

@app.get("/chat/history")
async def chat_history(
    channel: str = Query('general'),
    limit: int = Query(50),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    corp_ch, clan_ch = await _player_channels(current_user.id, db)
    db_ch = _to_db_ch(channel, corp_ch, clan_ch)
    msgs = (await db.execute(
        select(ChatMessage).where(ChatMessage.channel == db_ch)
        .order_by(ChatMessage.ts.desc())
        .limit(max(1, min(limit, 200)))
    )).scalars().all()
    return [{'from': m.username, 'text': m.text, 'time': _fmt_time(m.ts)} for m in reversed(msgs)]


# ── Chat WebSocket ────────────────────────────────────────────────────

@app.websocket("/ws/chat")
async def chat_ws(
    ws: WebSocket,
    token: str = Query(...),
):
    # ВАЖНО: НЕ держим один AsyncSession на весь коннект (как раньше через
    # Depends(get_db)) — при ≥100 одновременных WS каждый держал бы своё
    # выделенное SQLite/aiosqlite-соединение открытым на всю жизнь сокета,
    # и уже сам факт открытия ~100 соединений разом упирался в контеншн на
    # уровне aiosqlite/файла (см. нагрузочный тест — коннект замедлялся до
    # 5-9с при 60+ одновременно живых WS, хотя сам зависон event loop уже
    # был починен переходом на async). Вместо этого берём короткоживущую
    # сессию через `async with SessionLocal()` только на время конкретной
    # БД-операции — SQLite не выигрывает от долгих открытых соединений,
    # а короткие сессии не накапливаются с ростом числа онлайн-игроков.
    user_id = decode_token(token)
    if not user_id:
        await ws.close(code=4001)
        return
    if chat_manager.is_full(user_id):
        # accept() ПЕРЕД close() обязателен — закрытие ДО accept() (как у 4001 ниже)
        # схлопывается в голый HTTP 403 на уровне ASGI-хендшейка, и реальный код
        # закрытия до браузерного WebSocket.onclose просто не долетает. Тут код
        # нужен клиенту (HudScene._connectChatWS различает 4003, чтобы показать
        # игроку понятное сообщение вместо тихого фейла), поэтому здесь иначе.
        await ws.accept()
        await ws.close(code=4003, reason='server_full')
        return
    async with SessionLocal() as db:
        user = await db.get(User, user_id)
        if not user:
            await ws.close(code=4001)
            return
        corp_ch, clan_ch = await _player_channels(user.id, db)

    await chat_manager.connect(ws, user.id, user.username, corp_ch, clan_ch)

    # Клиент не знает свой числовой user.id (в токене/логине только username) — а он
    # нужен, чтобы сверять msg.targetUserId в pvp_hit_result с "это я" на своей стороне.
    await ws.send_json({'type': 'session_info', 'userId': user.id})
    if bounties:
        await ws.send_json({'type': 'pvp_bounty_snapshot', 'bounties': _bounty_list_detailed()})

    # Send history for each reachable channel
    history_pairs = [('general', 'general'), (corp_ch, 'corp')]
    if clan_ch:
        history_pairs.append((clan_ch, 'clan'))

    async with SessionLocal() as db:
        for db_ch, fe_ch in history_pairs:
            msgs = (await db.execute(
                select(ChatMessage).where(ChatMessage.channel == db_ch)
                .order_by(ChatMessage.ts.desc())
                .limit(50)
            )).scalars().all()
            await ws.send_json({
                'type': 'history',
                'channel': fe_ch,
                'messages': [{'from': m.username, 'text': m.text, 'time': _fmt_time(m.ts)} for m in reversed(msgs)],
            })

        # Send friend list on connect; notify online friends that this user came online
        friend_list = await _get_friend_list(user.username, db)

        # Непрочитанные ЛС по каждому отправителю — бейдж сразу на логине, без лишнего
        # REST-запроса (GET /player/pm/unread-summary остаётся для последующих обновлений).
        unread_rows = (await db.execute(
            select(PrivateMessage.from_username, func.count(PrivateMessage.id))
            .where(PrivateMessage.to_user_id == user.id, PrivateMessage.read_at.is_(None))
            .group_by(PrivateMessage.from_username)
        )).all()
    pm_by_user = {name: cnt for name, cnt in unread_rows}
    await ws.send_json({'type': 'friend_list', 'friends': friend_list})
    await ws.send_json({'type': 'pm_unread_summary', 'by_user': pm_by_user, 'total': sum(pm_by_user.values())})
    for f in friend_list:
        if f['status'] == 'accepted' and f['online']:
            await chat_manager.send_pm(f['name'], {
                'type': 'friend_online', 'name': user.username, 'sector': '',
            })

    try:
        while True:
            data = await ws.receive_json()
            msg_type = data.get('type', 'msg')

            if msg_type == 'msg':
                fe_ch = str(data.get('channel', 'general'))
                text = str(data.get('text', '')).strip()[:500]
                if not text:
                    continue
                db_ch = _to_db_ch(fe_ch, corp_ch, clan_ch)
                ts = time.time()
                async with SessionLocal() as db:
                    db.add(ChatMessage(channel=db_ch, user_id=user.id, username=user.username, text=text, ts=ts))
                    await db.commit()
                await chat_manager.broadcast(db_ch, {
                    'type': 'msg', 'channel': fe_ch,
                    'from': user.username, 'text': text, 'time': _fmt_time(ts),
                })

            elif msg_type == 'pm':
                to_name = str(data.get('to', '')).strip()
                text = str(data.get('text', '')).strip()[:500]
                if not text or not to_name:
                    continue
                if to_name == user.username:
                    await ws.send_json({'type': 'pm_error', 'text': 'Нельзя написать самому себе'})
                    continue
                async with SessionLocal() as db:
                    # Получатель — ЛЮБОЙ существующий игрок по нику (не только друзья) —
                    # см. диалог: "писать можно любому, достаточно знать ник". Блокировка
                    # остаётся единственным ограничением, той же формы, что и group_invite.
                    target = (await db.execute(select(User).where(User.username == to_name))).scalar_one_or_none()
                    if not target:
                        await ws.send_json({'type': 'pm_error', 'text': 'Игрок не найден'})
                        continue
                    blocked = (await db.execute(select(Blacklist).where(
                        Blacklist.blocker == to_name, Blacklist.blocked == user.username
                    ))).scalar_one_or_none()
                    if blocked:
                        await ws.send_json({'type': 'pm_error', 'text': f'Не удалось отправить сообщение {to_name}'})
                        continue
                    ts = time.time()
                    row = PrivateMessage(from_user_id=user.id, from_username=user.username,
                                          to_user_id=target.id, to_username=to_name, text=text, ts=ts)
                    db.add(row)
                    await db.commit()
                    await db.refresh(row)
                out = {'type': 'pm', 'id': row.id, 'from': user.username, 'to': to_name, 'text': text, 'time': _fmt_time(ts)}
                # Живая доставка, если получатель онлайн (как раньше) — офлайн-получатель
                # подхватит сообщение через GET /player/pm/history при следующем входе.
                await chat_manager.send_pm(to_name, out)
                await ws.send_json(out)  # echo to sender

            # ── Группа: создать / соло-инстанс ───────────────────────
            elif msg_type == 'group_create':
                dungeon = str(data.get('dungeon', '')).strip()
                solo    = bool(data.get('solo', False))
                iid     = group_manager.create(user.username, dungeon, solo)
                await ws.send_json({'type': 'group_created', 'instanceId': iid, 'members': [user.username]})

            # ── Группа: пригласить игрока ─────────────────────────────
            elif msg_type == 'group_invite':
                to_name = str(data.get('to', '')).strip()
                reason  = group_manager.can_join(user.username)
                if reason:
                    await ws.send_json({'type': 'group_error', 'text': reason})
                else:
                    async with SessionLocal() as db:
                        blocked = (await db.execute(select(Blacklist).where(
                            Blacklist.blocker == to_name, Blacklist.blocked == user.username
                        ))).scalar_one_or_none()
                    if blocked:
                        await ws.send_json({'type': 'group_error', 'text': f'Не удалось пригласить {to_name}'})
                    else:
                        await chat_manager.send_pm(to_name, {
                            'type': 'group_invite', 'from': user.username,
                            'dungeon': data.get('dungeon', ''),
                        })

            # ── Группа: принять приглашение ───────────────────────────
            elif msg_type == 'group_join':
                leader = str(data.get('leader', '')).strip()
                iid, err = group_manager.join(user.username, leader)
                if err:
                    await ws.send_json({'type': 'group_error', 'text': err})
                else:
                    members = group_manager.members_list(user.username)
                    await ws.send_json({'type': 'group_joined', 'instanceId': iid, 'members': members})
                    # Уведомить остальных участников
                    for m in members:
                        if m != user.username:
                            await chat_manager.send_pm(m, {
                                'type': 'group_member_joined', 'name': user.username, 'members': members,
                            })

            # ── Группа: покинуть ──────────────────────────────────────
            elif msg_type == 'group_leave':
                members_before = group_manager.members_list(user.username)
                group_manager.leave(user.username)
                await ws.send_json({'type': 'group_left'})
                for m in members_before:
                    if m != user.username:
                        await chat_manager.send_pm(m, {'type': 'group_member_left', 'name': user.username})

            # ── Группа: записать урон / хил для пропорционального золота
            elif msg_type == 'group_damage':
                amount = float(data.get('amount', 0))
                group_manager.record_damage(user.username, amount)
                # Relay to leader so they can apply it to their local boss
                inst = group_manager.get_instance(user.username)
                if inst and inst.leader != user.username:
                    await chat_manager.send_pm(inst.leader, {
                        'type': 'group_member_damage', 'from': user.username, 'amount': amount,
                    })
            elif msg_type == 'group_heal':
                group_manager.record_heal(user.username, float(data.get('amount', 0)))

            # ── Группа: босс убит → распределить золото/credits/xp ────
            elif msg_type == 'group_boss_dead':
                # Идемпотентность: сервер транслирует общий pvp_mob_hit_result ВСЕМ
                # участникам комнаты (см. pvp_mob_fire_claim), так что КАЖДЫЙ клиент
                # независимо детектирует килл локально и посылает своё group_boss_dead —
                # раньше это пересчитывало и рассылало полную награду заново на КАЖДОЕ
                # такое сообщение (баг: группа из N получала ×N суммарной награды).
                # inst.locked выставляется внутри boss_died() при первом успешном вызове.
                inst = group_manager.get_instance(user.username)
                if not inst or inst.locked:
                    continue
                base_gold    = int(data.get('baseGold', 0))
                base_credits = int(data.get('baseCredits', 0))
                base_xp      = int(data.get('baseXp', 0))
                rewards      = group_manager.boss_died(user.username, base_gold, base_credits, base_xp)
                # Отправить каждому его долю + уведомить о смерти босса
                for name, share in rewards.items():
                    payload = {'type': 'group_gold_reward', **share}
                    if name == user.username:
                        await ws.send_json(payload)
                    else:
                        await chat_manager.send_pm(name, payload)
                        await chat_manager.send_pm(name, {'type': 'group_boss_killed'})

            # ── Группа: охранник/минибосс убит лидером → relay всем участникам
            elif msg_type == 'group_mob_died':
                inst = group_manager.get_instance(user.username)
                if inst and inst.leader == user.username:
                    members = group_manager.members_list(user.username)
                    for m in members:
                        if m != user.username:
                            await chat_manager.send_pm(m, {
                                'type': 'group_mob_died', 'id': data.get('id'),
                            })

            # ── Группа: синхронизировать HP босса ────────────────────
            elif msg_type == 'group_boss_hp':
                inst = group_manager.get_instance(user.username)
                if inst:
                    inst.boss_hp_ratio = float(data.get('ratio', 1.0))
                    members = group_manager.members_list(user.username)
                    for m in members:
                        if m != user.username:
                            await chat_manager.send_pm(m, {
                                'type': 'group_boss_hp', 'ratio': inst.boss_hp_ratio,
                            })

            # ── Сектор: клиент сообщает текущий сектор ───────────────
            elif msg_type == 'sector_update':
                sec = str(data.get('sector', '')).strip()[:50]
                if ws in chat_manager.active:
                    chat_manager.active[ws]['sector'] = sec
                # Notify online friends of new sector
                async with SessionLocal() as db:
                    fl = await _get_friend_list(user.username, db)
                for f in fl:
                    if f['status'] == 'accepted' and f['online']:
                        await chat_manager.send_pm(f['name'], {
                            'type': 'friend_online', 'name': user.username, 'sector': sec,
                        })

            # ── PvP: вход в живой сектор — регистрируем в комнате, шлём
            #    снапшот текущих игроков, уведомляем остальных о новом ─
            elif msg_type == 'pvp_enter':
                sector  = str(data.get('sector', '')).strip()[:50]
                x       = float(data.get('x', 0) or 0)
                y       = float(data.get('y', 0) or 0)
                loadout = data.get('loadout') or {}
                if not sector:
                    continue
                # План Фаза 3.1: если этот игрок улетал офлайн (см. except-блок дисконнекта
                # выше и OfflineShipManager), сервер уже знает актуальную ПОЗИЦИЮ — подменяем
                # ею то, что заявляет клиент (сервер авторитетен за курсом/полётом, в этом и
                # была цель шага). Ищем по ВСЕМ секторам, не только целевому — сектор мог
                # смениться между дисконнектом/реконнектом.
                #
                # hull/shield НЕ подменяем: _advance_offline_ship тикает только позицию —
                # сервер сегодня вообще не знает реген-ставок корабля (shieldRegenPerSec и
                # т.п. считаются в Player.js.recomputeStats() из корабля/модулей/скиллов/
                # перков и никогда не репортятся серверу, только точечные hull/shield). То
                # есть OfflineShip.hull/shield — это ЗАМОРОЖЕННЫЙ снапшот на момент дисконнекта,
                # а не то, что реально накопилось за время офлайна. Клиентский catch-up
                # (Фаза 2, GameScene.create()) уже правильно считает регенерацию тем же
                # временем — если бы мы затёрли его этим замороженным снапшотом здесь, это
                # был бы РЕГРЕСС (откат уже честно посчитанного регена). Донести реген-ставки
                # на сервер и сделать hull/shield тоже авторитетными — задача Шага 3.2, когда
                # появится реальный урон офлайн-кораблям и станет нужно арбитрировать HP.
                _off_sector, _off_ship = offline_ship_manager.find(user.id)
                if _off_ship:
                    offline_ship_manager.pop(_off_sector, user.id)
                    x, y = _off_ship.x, _off_ship.y
                state = pvp_room_manager.enter(sector, user.id, user.username, x, y, loadout)
                if _off_ship:
                    state.heading = _off_ship.heading
                    state.waypoint_x = _off_ship.waypoint_x
                    state.waypoint_y = _off_ship.waypoint_y
                    state.speed = _off_ship.speed
                # Депозиты ресурсов (плазмит/данж-кристаллы) — первый клиент комнаты
                # предлагает раскладку (resources[]), она становится общей навсегда
                # (см. get_or_create_resources); опоздавшие клиенты просто получают уже
                # сохранённую раскладку в ответ, свою собственную не сохраняя.
                proposed_resources = data.get('resources') or []
                if isinstance(proposed_resources, list) and proposed_resources:
                    pvp_room_manager.get_or_create_resources(sector, proposed_resources)
                others = pvp_room_manager.others(sector, user.id)
                await ws.send_json({
                    'type': 'pvp_room_snapshot',
                    'players': [p.to_public() for p in others],
                    # Только мобы, по которым уже кто-то стрелял (см. PvpMobState) — не
                    # тронутые мобы у новых клиентов и так спавнятся на полном HP.
                    'mobs': pvp_room_manager.mob_snapshot(sector),
                    'resources': pvp_room_manager.serialize_resources(sector),
                })
                await chat_manager.broadcast_to_uids(
                    [p.user_id for p in others],
                    {'type': 'pvp_player_joined', 'player': pvp_room_manager.get(sector, user.id).to_public()},
                    exclude_uid=user.id,
                )

            # ── PvP: обновить потолок лоадаута без выхода/входа в комнату — клиент
            #    шлёт это при каждом Player.recomputeStats() (смена корабля/экипировки/
            #    уровня/скиллов), иначе потолок протухает с момента входа в комнату
            #    (см. _clamp_pvp_loadout) и урон зажимается сильнее, чем нужно ─────
            elif msg_type == 'pvp_update_loadout':
                sector = pvp_room_manager.player_sector.get(user.id)
                state = pvp_room_manager.get(sector, user.id) if sector else None
                if not state:
                    continue
                loadout = data.get('loadout') or {}
                state.loadout = _clamp_pvp_loadout(loadout)
                if loadout.get('shipKey'):
                    state.ship_key = str(loadout['shipKey'])[:40]
                if loadout.get('maxHull'):
                    state.max_hull = max(1.0, float(loadout['maxHull']))
                if loadout.get('maxShield') is not None:
                    state.max_shield = max(0.0, float(loadout['maxShield']))
                # Пассивный реген (см. PvpPlayerState.last_hp_sync_at выше) — только РОСТ,
                # зажатый темпом с последней синхронизации; урон/смерть остаются
                # авторитетными исключительно через pvp_fire_claim/ability, это НИКОГДА
                # не уменьшает hull/shield.
                _now_hp = time.time()
                _elapsed = max(0.0, _now_hp - state.last_hp_sync_at)
                if loadout.get('hull') is not None:
                    _claimed_hull = float(loadout['hull'])
                    _max_hull_gain = state.max_hull * PVP_REGEN_RATE_CEILING * _elapsed
                    state.hull = max(state.hull, min(_claimed_hull, state.hull + _max_hull_gain, state.max_hull))
                if loadout.get('shield') is not None:
                    _claimed_shield = float(loadout['shield'])
                    _max_shield_gain = state.max_shield * PVP_REGEN_RATE_CEILING * _elapsed
                    state.shield = max(state.shield, min(_claimed_shield, state.shield + _max_shield_gain, state.max_shield))
                state.last_hp_sync_at = _now_hp
                if loadout.get('corp'):
                    state.corp = str(loadout['corp'])[:20]
                if loadout.get('level'):
                    state.level = max(1, int(loadout['level']))
                if loadout.get('rankId') is not None:
                    state.rank_id = int(loadout['rankId'])
                if loadout.get('clanTag') is not None:
                    state.clan_tag = str(loadout['clanTag'])[:8] if loadout['clanTag'] else None
                # Раньше это обновление было чисто внутренним (только потолок урона на
                # сервере, см. _clamp_pvp_loadout) — другие клиенты, уже отрендерившие
                # этого игрока как RemotePlayer, никогда не узнавали о смене
                # корабля/корпуса/уровня после первого джойна комнаты (баг "враг
                # переключился на Аргуса, а у меня всё ещё виден старый корабль",
                # переживает даже респавн — respawn не пересоздаёт RemotePlayer, только
                # позицию, см. клиент RemotePlayer.applyPos). Раздаём публичные поля.
                others = pvp_room_manager.others(sector, user.id)
                if others:
                    await chat_manager.broadcast_to_uids(
                        [p.user_id for p in others],
                        {'type': 'pvp_player_updated', 'userId': user.id, 'shipKey': state.ship_key,
                         'corp': state.corp, 'level': state.level,
                         'rankId': state.rank_id, 'clanTag': state.clan_tag,
                         'maxHull': state.max_hull, 'maxShield': state.max_shield,
                         # hull/shield — реген (см. выше), раньше сюда не попадали вовсе:
                         # наблюдатель никогда не видел, что чужой hull/shield подрос со
                         # временем (баг из диалога), только на следующее боевое попадание.
                         'hull': state.hull, 'shield': state.shield},
                    )

            # ── PvP: обновление позиции (throttled клиентом, ~10Hz) ────
            elif msg_type == 'pvp_pos':
                sector = pvp_room_manager.player_sector.get(user.id)
                if not sector:
                    continue
                x = float(data.get('x', 0) or 0)
                y = float(data.get('y', 0) or 0)
                heading = float(data.get('heading', 0) or 0)
                # План Фаза 3.1: waypoint/speed — см. PvpPlayerState.waypoint_x/y/speed.
                wp_x = data.get('waypointX')
                wp_y = data.get('waypointY')
                speed = float(data.get('speed', 0) or 0)
                pvp_room_manager.update_pos(
                    sector, user.id, x, y, heading,
                    float(wp_x) if wp_x is not None else None,
                    float(wp_y) if wp_y is not None else None,
                    speed,
                )
                others = pvp_room_manager.others(sector, user.id)
                await chat_manager.broadcast_to_uids(
                    [p.user_id for p in others],
                    {'type': 'pvp_pos_update', 'userId': user.id, 'x': x, 'y': y, 'heading': heading},
                    exclude_uid=user.id,
                )

            # ── Эскорт: игрок начал daily_escort — оповещаем остальных в той же
            # комнате, чтобы их клиент отложил свой (независимый, невидимый чужому
            # клиенту) старт на 30с — см. GameScene._shouldSpawnEscort. Чисто relay,
            # сервер не хранит состояние (симметрично pvp_pos).
            elif msg_type == 'pvp_escort_start':
                sector = pvp_room_manager.player_sector.get(user.id)
                if not sector:
                    continue
                others = pvp_room_manager.others(sector, user.id)
                await chat_manager.broadcast_to_uids(
                    [p.user_id for p in others],
                    {'type': 'pvp_escort_started', 'userId': user.id},
                    exclude_uid=user.id,
                )

            # ── Моб/турель атакует ИГРОКА — этот урон целиком локально-авторитетен на
            # клиенте цели (см. GameScene.fireMobWeapon: victim.takeDamage прямо тут, без
            # сервера — та же модель, что и обычные NPC-мобы), сервер тут ничего не решает
            # и не хранит. Но БЕЗ этого relay остальные игроки комнаты вообще не подозревали,
            # что что-то произошло: "турель 1 бьёт игрока 1, игрок 2 не видит, что турель 1
            # бьёт игрока 1" (баг из диалога) — событие было полностью invisible за пределами
            # экрана самой жертвы. Чисто relay, симметрично pvp_escort_start/pvp_pos —
            # сервер не хранит состояние, targetUserId берём из сессии (не из тела, чтобы
            # клиент не мог заявить чужой userId).
            elif msg_type == 'pvp_mob_attack_vfx':
                sector = pvp_room_manager.player_sector.get(user.id)
                if not sector:
                    continue
                others = pvp_room_manager.others(sector, user.id)
                if others:
                    await chat_manager.broadcast_to_uids(
                        [p.user_id for p in others],
                        {
                            'type': 'pvp_mob_attack_vfx',
                            'mobId': str(data.get('mobId', ''))[:80],
                            'weaponType': str(data.get('weaponType', 'plasma'))[:20],
                            'targetUserId': user.id,
                        },
                        exclude_uid=user.id,
                    )

            # ── Результат удара моба/турели по игроку — реальный урон посчитан клиентом
            # ЖЕРТВЫ (см. Player.takeDamage/onProjectileHit), сервер тут только ретранслирует
            # готовый результат остальным (не решает и не хранит). Отдельно от
            # pvp_mob_attack_vfx выше: тот шлётся В МОМЕНТ ВЫСТРЕЛА (визуал болта/поворот
            # турели), этот — В МОМЕНТ ПОПАДАНИЯ (не синхронно для не-хитскан оружия —
            # летящий болт долетает не мгновенно), несёт реальные цифры урона/HP, без него
            # у наблюдателей полоска HP жертвы не двигалась и не было цифры урона (баг из
            # диалога: "не видно сколько урона нанесено", "прочность и щит другого игрока
            # тоже неактуальна, не уменьшается от урона турели").
            elif msg_type == 'pvp_mob_attack_result':
                sector = pvp_room_manager.player_sector.get(user.id)
                if not sector:
                    continue
                others = pvp_room_manager.others(sector, user.id)
                if others:
                    await chat_manager.broadcast_to_uids(
                        [p.user_id for p in others],
                        {
                            'type': 'pvp_mob_attack_result',
                            'targetUserId': user.id,
                            'dodged': bool(data.get('dodged', False)),
                            'hullHit': float(data.get('hullHit', 0) or 0),
                            'shieldHit': float(data.get('shieldHit', 0) or 0),
                            'hull': float(data.get('hull', 0) or 0),
                            'maxHull': float(data.get('maxHull', 0) or 0),
                            'shield': float(data.get('shield', 0) or 0),
                            'maxShield': float(data.get('maxShield', 0) or 0),
                            'killed': bool(data.get('killed', False)),
                            'isCrit': bool(data.get('isCrit', False)),
                        },
                        exclude_uid=user.id,
                    )

            # ── PvP: осознанный выход из сектора (не disconnect) ───────
            elif msg_type == 'pvp_leave':
                # Осознанный выход из арена-комнаты (не дисконнект WS) — раньше НЕ запускал
                # 2-минутный void-таймер вообще (тот стоит только в except-блоке
                # дисконнекта ниже), так что ушедший вручную игрок оставлял соперника
                # висеть в ожидании до конца 10-минутного дедлайна матча (баг из диалога:
                # "противник перезагрузился и вышел, игрок продолжает висеть на арене").
                # Сектор берём ДО leave() — та удаляет запись, после неё узнать откуда
                # ушёл игрок можно только из её же возвращаемого значения.
                _leaving_sector = pvp_room_manager.player_sector.get(user.id)
                if _leaving_sector and _leaving_sector.startswith('arena:'):
                    _am = arena_matches.matches.get(_leaving_sector)
                    if _am and not _am.outcome:
                        # Досрочный выход, пока соперник ещё в матче (хоть один участник
                        # его команды подключён) — поражение вышедшего, без ожидания
                        # 2-минутного void-таймера (см. диалог: "выход по время матча
                        # если противник на карте - поражение"). Если соперник уже сам
                        # отключился — просто запускаем обычный void-таймер, как раньше.
                        # НО победу засчитываем, только если у оставшихся уже есть реальное
                        # преимущество (см. ArenaMatch.has_advantage, диалог: "если ни одного
                        # флага/груза/точки не захвачено... победу не присуждать, просто
                        # выйти", "для победы должно быть преимущество") — при равном счёте
                        # (в т.ч. 0:0) уходящий не отдаёт победу, матч просто void.
                        _my_team = _am.team_of.get(user.id)
                        _opp_team = 'b' if _my_team == 'a' else 'a'
                        _opp_uids = _am.teams.get(_opp_team, [])
                        _opp_connected = any(_am.connected.get(u, True) for u in _opp_uids)
                        if _opp_connected:
                            # Только 3на3 (не дуэль) — первые 3 минуты выход не даёт победы
                            # никому вообще, даже при перевесе (см. ARENA_EARLY_LEAVE_VOID_SEC).
                            _too_early = _am.mode != 'duel' and time.time() - _am.start_at < ARENA_EARLY_LEAVE_VOID_SEC
                            _outcome = 'void' if _too_early else (f'win_{_opp_team}' if _am.has_advantage(_opp_team) else 'void')
                            arena_matches.end(_leaving_sector, _outcome)
                            await _broadcast_arena_match_end(_am)
                        else:
                            arena_matches.on_disconnect(user.id, time.time())
                sector = pvp_room_manager.leave(user.id)
                if sector:
                    others = pvp_room_manager.others(sector, user.id)
                    await chat_manager.broadcast_to_uids(
                        [p.user_id for p in others],
                        {'type': 'pvp_player_left', 'userId': user.id},
                        exclude_uid=user.id,
                    )

            # ── PvP: заявка на выстрел — клиент заявляет только "выстрелил
            #    по X", сервер сам валидирует дальность/КД и решает исход
            #    (урон/крит), не доверяя клиенту ни то, ни другое ────────────
            elif msg_type == 'pvp_fire_claim':
                sector = pvp_room_manager.player_sector.get(user.id)
                target_id = data.get('targetUserId')
                if not sector or target_id is None:
                    continue
                # Игрок-игрок бой — в реальных PvP-секторах (room key начинается с "pvp_")
                # ИЛИ в арена-матче (room key "arena:<matchId>", см. arena.py). Комнаты для
                # дома/PvE/групповых данжей (room key = имя сектора или "group:<instanceId>")
                # тоже используют pvp_enter/pvp_pos для видимости союзников, но там драться
                # друг с другом нельзя — молча игнорируем попытку.
                is_arena = sector.startswith('arena:')
                if not sector.startswith('pvp_') and not is_arena:
                    continue
                attacker = pvp_room_manager.get(sector, user.id)
                victim = pvp_room_manager.get(sector, int(target_id))
                if not attacker or not victim or victim.user_id == attacker.user_id:
                    continue
                arena_match = None
                if is_arena:
                    arena_match = arena_matches.matches.get(sector)
                    if not arena_match or arena_match.outcome:
                        continue  # матч уже завершён/void — урон больше не считаем
                    if time.time() - arena_match.start_at < ARENA_COUNTDOWN_SEC:
                        continue  # 5с обратный отсчёт до боя — сервер тоже игнорирует урон, не только клиент
                    if arena_match.team_of.get(attacker.user_id) == arena_match.team_of.get(victim.user_id):
                        continue  # союзник по арена-команде — независимо от корпорации
                    if arena_match.mode != 'duel':  # дуэль без safe zone на спавне
                        victim_team = arena_match.team_of.get(victim.user_id)
                        bx, by = arena_match.spawns.get(victim_team, (victim.x, victim.y))
                        if math.hypot(victim.x - bx, victim.y - by) < ARENA_BASE_SAFE_R:
                            continue  # жертва на своей базе — safe zone, неатакуема
                else:
                    # Дружественный огонь между игроками одного корпа запрещён вне арены.
                    # Проверяем на сервере (не только скрытие/блок на клиенте), т.к. клиент
                    # не авторитетен.
                    if attacker.corp == victim.corp:
                        continue
                now_ts = time.time()
                if now_ts - attacker.last_shot_at < attacker.loadout['cooldown']:
                    continue  # чаще заявленного КД — молча игнорируем (см. план: без ложных банов)
                dist = math.hypot(victim.x - attacker.x, victim.y - attacker.y)
                if dist > attacker.loadout['range']:
                    continue  # вне заявленной дальности — молча игнорируем
                attacker.last_shot_at = now_ts
                # Открытие огня самим атакующим снимает ЕГО СОБСТВЕННУЮ грейс-неуязвимость
                # после ремонта на месте (см. respawn_grace_until) — "если сам не атакуешь".
                attacker.respawn_grace_until = 0.0

                claimed_dmg = max(0.0, float(data.get('dmg', 0) or 0))
                weapon_type = str(data.get('weaponType', 'cannon'))[:20]
                # Щит-дрон (см. SHIELD_DRONE_* выше): targetType='drone' — клиент явно
                # выбрал дрон целью (не корабль владельца), см. GameScene shieldDroneAt.
                target_type = str(data.get('targetType', 'ship'))[:10]
                if target_type not in ('ship', 'drone'):
                    target_type = 'ship'
                result = _resolve_pvp_hit(attacker, victim, claimed_dmg, weapon_type, target_type)
                if result is None:
                    continue  # targetType='drone', но дрон уже не существует — невалидная заявка
                out = {
                    'type': 'pvp_hit_result',
                    'attackerUserId': attacker.user_id, 'targetUserId': victim.user_id,
                    'weaponType': weapon_type, 'targetType': target_type,
                    **result,
                }
                room_uids = [attacker.user_id] + [p.user_id for p in pvp_room_manager.others(sector, attacker.user_id)]
                await chat_manager.broadcast_to_uids(room_uids, out)

                if result['killed'] and arena_match:
                    await _arena_on_kill(arena_match, victim, attacker)
                elif result['killed']:
                    async with SessionLocal() as db:
                        db.add(AuditLog(user_id=victim.user_id, action='pvp_kill', params={
                            'killer': attacker.username, 'victim': victim.username, 'sector': sector,
                        }, sector=sector))
                        await db.commit()
                    if result.get('bountyBonus'):
                        await chat_manager.broadcast('general', {'type': 'pvp_bounty_cleared', 'userId': victim.user_id})

            # ── Активная способность (Аргус: pulsar/missiles, DEV key 8) бьёт другого
            # ИГРОКА — раньше эти способности вообще не рассматривали RemotePlayer как
            # цель, только this.scene.mobs (баг из диалога: "не действуют на других
            # игроков"). Отдельно от pvp_fire_claim: свой потолок урона и свой per-ability
            # кулдаун-флор (см. ABILITY_DAMAGE_CEILING/FLOOR выше) — общий гейт обычного
            # оружия (attacker.loadout['dmg']/['cooldown']) душил бы почти все попадания,
            # способность на порядок мощнее и тикает намного чаще одиночного выстрела.
            # Переиспользует _apply_pvp_damage и ФОРМАТ pvp_hit_result целиком — клиенту
            # не нужен отдельный обработчик результата, тот же _onPvpHitResult справится
            # (weaponType не 'laser'/'cannon' — просто не рисует луч выстрела, это ок).
            elif msg_type == 'pvp_ability_fire_claim':
                sector = pvp_room_manager.player_sector.get(user.id)
                target_id = data.get('targetUserId')
                ability = str(data.get('ability', ''))[:30]
                if not sector or target_id is None or ability not in ABILITY_DAMAGE_CEILING:
                    continue
                is_arena = sector.startswith('arena:')
                if not sector.startswith('pvp_') and not is_arena:
                    continue
                attacker = pvp_room_manager.get(sector, user.id)
                victim = pvp_room_manager.get(sector, int(target_id))
                if not attacker or not victim or victim.user_id == attacker.user_id:
                    continue
                arena_match = None
                if is_arena:
                    arena_match = arena_matches.matches.get(sector)
                    if not arena_match or arena_match.outcome:
                        continue
                    if arena_match.team_of.get(attacker.user_id) == arena_match.team_of.get(victim.user_id):
                        continue
                    if arena_match.mode != 'duel':  # дуэль без safe zone на спавне
                        victim_team = arena_match.team_of.get(victim.user_id)
                        bx, by = arena_match.spawns.get(victim_team, (victim.x, victim.y))
                        if math.hypot(victim.x - bx, victim.y - by) < ARENA_BASE_SAFE_R:
                            continue
                elif attacker.corp == victim.corp:
                    continue
                now_ts = time.time()
                last = attacker.ability_last_fire.get(ability, 0.0)
                if now_ts - last < ABILITY_COOLDOWN_FLOOR[ability]:
                    continue
                attacker.ability_last_fire[ability] = now_ts
                attacker.respawn_grace_until = 0.0

                claimed_dmg = max(0.0, float(data.get('dmg', 0) or 0))
                if victim.respawn_grace_until > now_ts or victim.invulnerable_until > now_ts:
                    r = {'isCrit': False, 'dmg': 0, 'killed': False, 'dodged': True,
                         'hull': victim.hull, 'shield': victim.shield}
                else:
                    # Способности — без крита (см. диалог: "нельзя применять криты к
                    # способностям", "8 ракет по 2 тысячи — 16 тыс в одну цель должно
                    # быть статично") — 0.0 critChance делает is_crit гарантированно
                    # False в _apply_pvp_damage, урон = ceiling ровно, без разброса.
                    r = _apply_pvp_damage(claimed_dmg, ABILITY_DAMAGE_CEILING[ability], 0.0,
                                           victim.hull, victim.shield, victim.max_hull, victim.max_shield,
                                           0.0, 1.0,
                                           victim.loadout['evasion'], burst_mult=1.0)
                    victim.hull, victim.shield = r['hull'], r['shield']
                damage_by_out = None
                if not r['dodged'] and r['dmg'] > 0:
                    victim.damage_by[attacker.user_id] = victim.damage_by.get(attacker.user_id, 0.0) + r['dmg']
                if r['killed']:
                    victim.respawn_grace_until = now_ts + 3.0
                    victim.last_death_eligible = list(victim.damage_by.keys())
                    damage_by_out = {str(uid): round(dmg) for uid, dmg in victim.damage_by.items()}
                    victim.damage_by = {}
                    if arena_match:
                        await _arena_on_kill(arena_match, victim, attacker)

                out = {
                    'type': 'pvp_hit_result',
                    'attackerUserId': attacker.user_id, 'targetUserId': victim.user_id,
                    'weaponType': ability,
                    'isCrit': r['isCrit'], 'dmg': r['dmg'], 'killed': r['killed'], 'dodged': r['dodged'],
                    'hull': r['hull'], 'shield': r['shield'],
                    'maxHull': victim.max_hull, 'maxShield': victim.max_shield,
                    'damageBy': damage_by_out, 'bountyBonus': None,
                }
                room_uids = [attacker.user_id] + [p.user_id for p in pvp_room_manager.others(sector, attacker.user_id)]
                await chat_manager.broadcast_to_uids(room_uids, out)

                if r['killed']:
                    async with SessionLocal() as db:
                        db.add(AuditLog(user_id=victim.user_id, action='pvp_kill', params={
                            'killer': attacker.username, 'victim': victim.username, 'sector': sector,
                        }, sector=sector))
                        await db.commit()

            # ── Аргус: "Фазовый кокон" (argus:cocoon) — самолечение + неуязвимость.
            # Раньше ArgusController._activateCocoon лечил hull/shield и ставил
            # invulnerable=true ЧИСТО локально у себя — сервер (и другие клиенты) никогда
            # об этом не узнавали: следующий хит от сервера считался от старого,
            # незалеченного hull (бар HP/щита противника выглядел "неактуальным" — баг из
            # диалога), а сама неуязвимость не мешала серверу засчитать полный урон, пока
            # клиент думал, что защищён. Сумма хила — считает СЕРВЕР сам от своего
            # авторитетного max_hull/max_shield (не клиентская заявка) — это фиксированный
            # % способности, а не бой-ролл, доверять тут нечему.
            elif msg_type == 'pvp_self_heal_claim':
                sector = pvp_room_manager.player_sector.get(user.id)
                ability = str(data.get('ability', ''))[:30]
                if not sector or ability not in ABILITY_HEAL_PCT:
                    continue
                state = pvp_room_manager.get(sector, user.id)
                if not state:
                    continue
                now_ts = time.time()
                last = state.ability_last_fire.get(ability, 0.0)
                if now_ts - last < ABILITY_COOLDOWN_FLOOR.get(ability, ARGUS_COCOON_COOLDOWN_FLOOR):
                    continue
                state.ability_last_fire[ability] = now_ts
                pct = ABILITY_HEAL_PCT[ability]
                state.hull = min(state.max_hull, state.hull + state.max_hull * pct)
                state.shield = min(state.max_shield, state.shield + state.max_shield * pct)
                state.invulnerable_until = now_ts + ARGUS_COCOON_INVULN_SEC
                room_uids = [user.id] + [p.user_id for p in pvp_room_manager.others(sector, user.id)]
                await chat_manager.broadcast_to_uids(room_uids, {
                    'type': 'pvp_player_healed', 'userId': user.id,
                    'hull': state.hull, 'shield': state.shield,
                    'maxHull': state.max_hull, 'maxShield': state.max_shield,
                })

            # ── Щит-дрон (расходник, см. SHIELD_DRONE_* выше) — активация. Клиент уже
            # списал расходник (КД на своей стороне НЕ включает сразу — стартует только
            # когда дрон реально перестанет действовать, см. GameScene._despawnShieldDrone
            # и диалог "сначала действие, потом КД") — здесь серверный кулдаун-флор
            # (страховка от спама/читерского клиента) и сама HP-бухгалтерия. last_use
            # обновляется НЕ тут, а в момент истечения/уничтожения дрона (см.
            # _shield_drone_tick_loop/_resolve_pvp_hit) — тот же принцип "от конца
            # действия, не от активации". Видимость всем в комнате (не только владельцу) —
            # через broadcast, а не lazy-реконструкцию, потому что дрон недолговечен (1 мин)
            # и эфемерен (не персистится нигде) — в отличие от hiredSecurity/registerMob,
            # которые переживают сектор через БД, тут нечему "пересоздаваться" у нового
            # джойнера — тот подхватит уже активный дрон через to_public() (см. выше).
            elif msg_type == 'pvp_shield_drone_activate':
                sector = pvp_room_manager.player_sector.get(user.id)
                if not sector:
                    continue
                state = pvp_room_manager.get(sector, user.id)
                if not state:
                    continue
                now_ts = time.time()
                if state.shield_drone_active_until > now_ts:
                    continue  # уже активен — повторная активация до истечения невозможна
                if now_ts - state.shield_drone_last_use < SHIELD_DRONE_COOLDOWN_FLOOR:
                    continue  # чаще заявленного КД — молча игнорируем, тот же паттерн, что и остальные КД
                state.shield_drone_active_until = now_ts + SHIELD_DRONE_DURATION_SEC
                state.shield_drone_hull = SHIELD_DRONE_MAX_HULL
                state.shield_drone_shield = SHIELD_DRONE_MAX_SHIELD
                room_uids = [user.id] + [p.user_id for p in pvp_room_manager.others(sector, user.id)]
                await chat_manager.broadcast_to_uids(room_uids, {
                    'type': 'pvp_shield_drone_spawn', 'ownerUserId': user.id,
                    'maxHull': SHIELD_DRONE_MAX_HULL, 'maxShield': SHIELD_DRONE_MAX_SHIELD,
                    'durationSec': SHIELD_DRONE_DURATION_SEC,
                })

            # ── Щит-дрон: урон от PvE (моб/AOE/мина) — целиком клиент-локальный бой (см.
            # комментарий у DungeonRun — весь PvE-прогресс доверенный), сервер тут не
            # пересчитывает сплит сам, только принимает уже посчитанный владельцем итог
            # (hull/shield, не дельту) и ретранслирует комнате — иначе PvE-урон по дрону
            # был бы виден только самому владельцу (pvp_hit_result для PvE не шлётся
            # вообще, см. Player.js takeDamage). Клэмп — та же защита от абсурдных
            # значений, что и у остального PvP-урона, не полноценная валидация.
            elif msg_type == 'pvp_shield_drone_pve_damage':
                sector = pvp_room_manager.player_sector.get(user.id)
                if not sector:
                    continue
                state = pvp_room_manager.get(sector, user.id)
                if not state or state.shield_drone_active_until <= time.time():
                    continue
                hull = max(0.0, min(float(data.get('hull', 0) or 0), SHIELD_DRONE_MAX_HULL))
                shield = max(0.0, min(float(data.get('shield', 0) or 0), SHIELD_DRONE_MAX_SHIELD))
                state.shield_drone_hull = hull
                state.shield_drone_shield = shield
                destroyed = hull <= 0
                if destroyed:
                    state.shield_drone_active_until = 0.0
                    state.shield_drone_last_use = time.time()
                room_uids = [user.id] + [p.user_id for p in pvp_room_manager.others(sector, user.id)]
                await chat_manager.broadcast_to_uids(room_uids, {
                    'type': 'pvp_shield_drone_sync', 'ownerUserId': user.id,
                    'hull': hull, 'shield': shield, 'destroyed': destroyed,
                })

            # ── Доска розыска: жертва (после своей смерти) вешает розыск на убийцу —
            # только если убийца оказался выше уровнем (см. клиент _onPvpHitResult).
            # Сервер не перепроверяет уровни (клиент-доверенная модель, как и весь
            # остальной прогресс — см. комментарий у DungeonRun), просто хранит/шлёт.
            # Повторная подача на уже разыскиваемого НЕ создаёт новую запись — просто
            # инкрементит 'kills' в существующей (см. _resolve_pvp_hit: 10+ даёт ×2 награду).
            elif msg_type == 'pvp_bounty_post':
                killer_id = data.get('killerId')
                killer_name = str(data.get('killerName', '') or '')[:50]
                if killer_id is None or not killer_name:
                    continue
                killer_id = int(killer_id)
                if killer_id in bounties:
                    bounties[killer_id]['kills'] = bounties[killer_id].get('kills', 1) + 1
                    continue
                killer_corp = str(data.get('killerCorp', '') or 'neutral')[:20]
                bounties[killer_id] = {'name': killer_name, 'corp': killer_corp, 'kills': 1}
                await chat_manager.broadcast('general', {
                    'type': 'pvp_bounty_posted', 'userId': killer_id, 'name': killer_name, 'corp': killer_corp,
                })

            # ── Доска розыска: клиент запрашивает свежий список при открытии
            # вкладки РОЗЫСК в CorpScene — online/sector считаются в момент запроса,
            # не кэшируются (см. _bounty_list_detailed).
            elif msg_type == 'pvp_bounty_query':
                await ws.send_json({'type': 'pvp_bounty_snapshot', 'bounties': _bounty_list_detailed()})

            # ── Бронепоезд: клиент запрашивает текущее состояние ПОСЛЕ того, как сам
            # локально построил ArmoredTrain (знает sectorKey+startAt из детерминированного
            # расписания — см. ArmoredTrain.js/_armoredTrainTodayStart) — без этого игрок,
            # зашедший в сектор ПОСЛЕ начала события, видел бы поезд с полным HP вместо
            # реального состояния (уничтоженные другими вагоны/текущий hull остальных).
            # trainKey = "sector:startAt" (без mobId-префикса "train:") — совпадает с
            # ключом ArmoredTrainManager.destroyed на сервере.
            elif msg_type == 'pvp_train_query':
                sector = pvp_room_manager.player_sector.get(user.id)
                train_key = str(data.get('trainKey', ''))[:80]
                if not sector or not train_key:
                    continue
                destroyed = list(armored_train_manager.destroyed.get(train_key, set()))
                prefix = f'train:{train_key}:'
                wagons = {mid: s for mid, s in pvp_room_manager.mob_snapshot(sector).items() if mid.startswith(prefix)}
                await ws.send_json({'type': 'pvp_train_snapshot', 'trainKey': train_key, 'destroyed': destroyed, 'wagons': wagons})

            # ── DEV: хоткей T (GameScene) принудительно запускает бронепоезд с
            # произвольным startAt=Date.now(), а не детерминированным
            # _armoredTrainTodayStart — в отличие от обычного расписания это НЕ
            # выводится одинаково на всех клиентах самостоятельно, так что раньше поезд
            # видел только тот, кто нажал T. Просто ретранслируем startAt остальным в
            # секторе — их ArmoredTrain.js строит маршрут детерминированно от
            # (sectorKey, startAt), так что все получат идентичный путь/позиции.
            elif msg_type == 'pvp_train_force_spawn':
                sector = pvp_room_manager.player_sector.get(user.id)
                if not sector:
                    continue
                start_at = data.get('startAt')
                if start_at is None:
                    continue
                others = pvp_room_manager.others(sector, user.id)
                if others:
                    await chat_manager.broadcast_to_uids(
                        [p.user_id for p in others],
                        {'type': 'pvp_train_force_spawn', 'startAt': start_at},
                    )

            # ── Сервер-авторитетный таргетинг для дронов бронепоезда (План, Фаза 2) —
            # регистрирует ServerMob для mobId, если он ещё не зарегистрирован (см.
            # ServerMobManager.spawn — идемпотентно, несколько клиентов зовут это почти
            # одновременно на детерминированный спавн). x/y/hull не используются в текущем
            # масштабе (см. _tick_room — распределение круговое, не по дистанции), так что
            # достаточно самого факта регистрации mob_id в комнате. Очистка — либо на килле
            # (pvp_mob_fire_claim ниже), либо когда комната опустеет (_mob_tick_loop).
            # ── Арена: встать/выйти из очереди ─────────────────────────────
            # 3на3 — вызывается ЛИДЕРОМ уже собранной группы (см. GroupManager, тот же
            # флоу что данж-пати — арена просто использует dungeon_key вида "arena:<mode>"
            # как непрозрачный ключ инстанса, никакой новой серверной party-логики не
            # нужно). 1на1 — вызывается самим игроком, группа не нужна. Уровни — из БД
            # PlayerState.state (клиент-заявочные, как и весь остальной прогресс в этом
            # проекте, но нужен отдельный round-trip до постановки в очередь — не тот же
            # риск подмены "на лету", что client-claimed loadout на pvp_enter).
            elif msg_type == 'arena_queue_join':
                mode = str(data.get('mode', ''))[:10]
                if mode not in ARENA_TEAM_SIZE:
                    continue
                if mode == 'duel':
                    member_names = [user.username]
                else:
                    # ── ВРЕМЕННЫЙ DEV-БЭКДОР (см. диалог: "как протестировать 3на3, 6
                    # аккаунтов не запущу") — обычно 3на3 требует РЕАЛЬНОЙ группы ровно
                    # из 3 (лидер жмёт запись, len(member_names) == ARENA_TEAM_SIZE[mode]).
                    # На время ручного тестирования с малым числом аккаунтов принимаем
                    # ЛЮБОЙ размер группы (включая соло, без группы вовсе) как "команду"
                    # для мэтчинга — механика режима (флаг/точки/груз) от размера команды
                    # не зависит. УБРАТЬ перед реальным тестом с полными командами —
                    # вернуть строгую проверку == ARENA_TEAM_SIZE[mode] и обязательность
                    # группы/лидерства.
                    inst = group_manager.get_instance(user.username)
                    if inst and inst.leader != user.username:
                        await ws.send_json({'type': 'arena_queue_update', 'mode': mode,
                                             'ok': False, 'reason': 'Встать в очередь может только лидер группы.'})
                        continue
                    member_names = list(inst.members.keys()) if inst else [user.username]
                uid_by_name = {m['name']: m['uid'] for m in chat_manager.active.values()}
                member_uids = [uid_by_name[n] for n in member_names if n in uid_by_name]
                if len(member_uids) != len(member_names):
                    await ws.send_json({'type': 'arena_queue_update', 'mode': mode,
                                         'ok': False, 'reason': 'Не все участники группы онлайн.'})
                    continue
                async with SessionLocal() as db:
                    levels = [await _player_level(db, uid) for uid in member_uids]
                # Разброс уровней ВНУТРИ своей же группы уже больше лимита — заведомо
                # невозможно найти соперника (доп. игроки могут только РАСШИРИТЬ разброс,
                # никогда не сузить), предупреждаем сразу, не тратя 3 мин ожидания впустую.
                if max(levels) - min(levels) > ARENA_LEVEL_SPREAD:
                    await ws.send_json({'type': 'arena_queue_update', 'mode': mode, 'ok': False,
                                         'reason': f'Разница уровней в группе больше {ARENA_LEVEL_SPREAD} — запись невозможна.'})
                    continue
                pair = arena_queue.enqueue(mode, user.id, member_uids, levels)
                if not pair:
                    await chat_manager.broadcast_to_uids(
                        member_uids, {'type': 'arena_queue_update', 'mode': mode, 'ok': True, 'waiting': True},
                    )
                    continue
                sector_key = ARENA_MODE_SECTOR[mode]
                match_id = f"{mode}_{int(time.time() * 1000)}"
                spawn_a, spawn_b = ARENA_SPAWNS.get(mode, ((-3000.0, 0.0), (3000.0, 0.0)))
                m = ArenaMatch(match_id, mode, sector_key, pair['a']['member_uids'], pair['b']['member_uids'], spawn_a, spawn_b)
                if mode == 'cargo':
                    m.cargo['x'], m.cargo['y'] = ARENA_CARGO_SPAWN
                if mode == 'points':
                    m.point_offset = random.choice(ARENA_POINT_OFFSET_CHOICES)
                arena_matches.create(m)
                name_by_uid = {v: k for k, v in uid_by_name.items()}
                for team in ('a', 'b'):
                    team_uids = m.teams[team]
                    other_team = 'b' if team == 'a' else 'a'
                    for uid in team_uids:
                        await chat_manager.send_to_uid(uid, {
                            'type': 'arena_match_found', 'matchId': match_id, 'roomKey': m.room_key,
                            'mode': mode, 'sectorKey': sector_key, 'team': team, 'mazeVariant': m.maze_variant,
                            'pointOffset': getattr(m, 'point_offset', None),
                            # userId-списки — авторитетны для teamOf()/hostility (см. ArenaController);
                            # имена — только для отображения в HUD/лобби.
                            'teammateIds': [u for u in team_uids if u != uid],
                            'enemyIds': list(m.teams[other_team]),
                            'teammates': [name_by_uid.get(u, '') for u in team_uids if u != uid],
                            'enemies': [name_by_uid.get(u, '') for u in m.teams[other_team]],
                            'spawn': {'x': m.spawns[team][0], 'y': m.spawns[team][1]},
                        })

            elif msg_type == 'arena_queue_leave':
                arena_queue.dequeue(user.id)
                await ws.send_json({'type': 'arena_queue_update', 'mode': None, 'ok': True, 'waiting': False})

            # ── Арена: захват флага ─────────────────────────────────────────
            # Все переходы валидируются по серверной позиции игрока (pvp_room_manager),
            # никогда по самозаявке клиента — клиент присылает только "я поднимаю/несу/
            # донёс", сервер проверяет дистанцию сам (см. план, риск #3).
            elif msg_type == 'arena_flag_pickup':
                m = arena_matches.get_by_uid(user.id)
                if not m or m.mode != 'flag' or m.outcome or not m.flags:
                    continue
                my_team = m.team_of.get(user.id)
                enemy_team = 'b' if my_team == 'a' else 'a'
                flag = m.flags[enemy_team]
                if flag['carrier'] is not None:
                    continue  # уже несут
                state = pvp_room_manager.get(m.room_key, user.id)
                if not state or math.hypot(state.x - flag['x'], state.y - flag['y']) > ARENA_PICKUP_R:
                    continue
                flag['carrier'] = user.id
                # at_base=False — раньше это НИГДЕ не выставлялось на подборе (только
                # arena_flag_return/capture возвращали его в True), из-за чего два места
                # молча ломались: (1) arena_flag_capture's "свой флаг должен быть дома"
                # проверка всегда проходила (at_base оставался True даже когда флаг несли),
                # (2) клиентский arena_flag_return никогда не срабатывал на упавший флаг
                # (см. диалог: "убийство носителя флага... так работает?" — расследование).
                flag['at_base'] = False
                flag['auto_return_at'] = None  # понесли — failsafe-таймер больше не нужен
                await chat_manager.broadcast_to_uids(list(m.team_of.keys()),
                                                      {'type': 'arena_objective_sync', 'flags': m.flags})

            elif msg_type == 'arena_flag_capture':
                m = arena_matches.get_by_uid(user.id)
                if not m or m.mode != 'flag' or m.outcome or not m.flags:
                    continue
                my_team = m.team_of.get(user.id)
                enemy_team = 'b' if my_team == 'a' else 'a'
                enemy_flag = m.flags[enemy_team]
                if enemy_flag['carrier'] != user.id:
                    continue
                state = pvp_room_manager.get(m.room_key, user.id)
                bx, by = m.spawns[my_team]
                if not state or math.hypot(state.x - bx, state.y - by) > ARENA_CAPTURE_R:
                    continue
                # Захват возможен только если СВОЙ флаг на месте (см. правило "защитить флаг
                # на своей базе") — если свой флаг унесён, донести чужой домой не считается.
                if not m.flags[my_team]['at_base']:
                    continue
                enemy_flag['carrier'] = None
                enemy_flag['x'], enemy_flag['y'] = m.spawns[enemy_team]
                enemy_flag['at_base'] = True  # свежий респаун на своей базе (см. фикс at_base выше)
                enemy_flag['auto_return_at'] = None
                m.add_score(my_team)
                await chat_manager.broadcast_to_uids(
                    list(m.team_of.keys()),
                    {'type': 'arena_objective_sync', 'flags': m.flags},
                )
                await chat_manager.broadcast_to_uids(list(m.team_of.keys()),
                                                      {'type': 'arena_score', 'a': m.scores['a'], 'b': m.scores['b']})

            elif msg_type == 'arena_flag_return':
                # Коснулся СВОЙ упавший (не у врага) флаг на земле — не мгновенный возврат,
                # а таймер на ARENA_FLAG_TOUCH_RETURN_SEC (3с), фактический "прыжок" домой —
                # см. _arena_tick_loop (см. диалог: "свой подбирает — 3 сек и флаг
                # перескакивает на место на базу"). min(), не перезапись — повторные касания
                # (клиент шлёт это каждые 300мс, пока стоит рядом) не должны ОТКЛАДЫВАТЬ уже
                # тикающий таймер дальше в будущее.
                m = arena_matches.get_by_uid(user.id)
                if not m or m.mode != 'flag' or m.outcome or not m.flags:
                    continue
                my_team = m.team_of.get(user.id)
                flag = m.flags[my_team]
                if flag['at_base'] or flag['carrier'] is not None:
                    continue
                state = pvp_room_manager.get(m.room_key, user.id)
                if not state or math.hypot(state.x - flag['x'], state.y - flag['y']) > ARENA_PICKUP_R:
                    continue
                target = time.time() + ARENA_FLAG_TOUCH_RETURN_SEC
                if flag['auto_return_at'] is None or flag['auto_return_at'] > target:
                    flag['auto_return_at'] = target

            # ── Арена: захват груза ──────────────────────────────────────────
            elif msg_type == 'arena_cargo_pickup':
                m = arena_matches.get_by_uid(user.id)
                if not m or m.mode != 'cargo' or m.outcome or not m.cargo:
                    continue
                if m.cargo['carrier'] is not None:
                    continue
                state = pvp_room_manager.get(m.room_key, user.id)
                if not state or math.hypot(state.x - m.cargo['x'], state.y - m.cargo['y']) > ARENA_PICKUP_R:
                    continue
                m.cargo['carrier'] = user.id
                await chat_manager.broadcast_to_uids(list(m.team_of.keys()),
                                                      {'type': 'arena_objective_sync', 'cargo': m.cargo})

            elif msg_type == 'arena_cargo_deliver':
                m = arena_matches.get_by_uid(user.id)
                if not m or m.mode != 'cargo' or m.outcome or not m.cargo:
                    continue
                if m.cargo['carrier'] != user.id:
                    continue
                my_team = m.team_of.get(user.id)
                state = pvp_room_manager.get(m.room_key, user.id)
                bx, by = m.spawns[my_team]
                if not state or math.hypot(state.x - bx, state.y - by) > ARENA_CAPTURE_R:
                    continue
                m.add_score(my_team)
                now_ts = time.time()
                # available=False на ARENA_CARGO_RESPAWN_SEC — раньше груз мгновенно
                # возвращался в центр картой же доставкой, без паузы (см. диалог: "через
                # 5 сек он должен вернуться на место респавна"); фактическое появление —
                # см. _arena_tick_loop.
                m.cargo = {'spawned_at': None, 'carrier': None, 'x': None, 'y': None,
                           'next_spawn_at': now_ts + ARENA_CARGO_RESPAWN_SEC, 'available': False}
                await chat_manager.broadcast_to_uids(list(m.team_of.keys()),
                                                      {'type': 'arena_objective_sync', 'cargo': m.cargo})
                await chat_manager.broadcast_to_uids(list(m.team_of.keys()),
                                                      {'type': 'arena_score', 'a': m.scores['a'], 'b': m.scores['b']})

            # ── Арена: заявка на точку — сервер валидирует дистанцию и кулдаун заявок,
            #    сам решает прочность/владельца (никогда по самозаявке клиента) ──────
            elif msg_type == 'arena_point_claim':
                m = arena_matches.get_by_uid(user.id)
                point_id = str(data.get('pointId', ''))[:1]
                if not m or m.mode != 'points' or m.outcome or not m.points or point_id not in m.points:
                    continue
                now_ts = time.time()
                if now_ts - m.last_point_claim.get(user.id, 0.0) < ARENA_POINT_CLAIM_COOLDOWN:
                    continue
                m.last_point_claim[user.id] = now_ts
                state = pvp_room_manager.get(m.room_key, user.id)
                px, py = _arena_point_positions(getattr(m, 'point_offset', 1600.0)).get(point_id, (0.0, 0.0))
                if not state or math.hypot(state.x - px, state.y - py) > ARENA_POINT_R:
                    continue
                my_team = m.team_of.get(user.id)
                p = m.points[point_id]
                if p['owner'] == my_team:
                    continue  # своя точка — нечего заявлять
                # Живой защитник (игрок ПРОТИВОПОЛОЖНОЙ команды) в радиусе точки — захват
                # невозможен вовсе, пока его не убьют (см. диалог: "если противник стоит
                # возле точки — захватить невозможно, нужно уничтожить противника").
                # Раньше присутствие защитника никак не мешало захвату — обе стороны
                # просто отправляли заявки, и точка "перескакивала" туда-сюда без реальной
                # необходимости сначала выиграть бой за неё.
                opp_team = 'b' if my_team == 'a' else 'a'
                opp_defending = any(
                    (opp_state := pvp_room_manager.get(m.room_key, opp_uid)) and opp_state.hull > 0
                    and math.hypot(opp_state.x - px, opp_state.y - py) <= ARENA_POINT_R
                    for opp_uid in m.teams.get(opp_team, [])
                )
                if opp_defending:
                    continue
                p['attacker'] = my_team
                p['last_attacked_at'] = now_ts
                p['durability'] -= ARENA_POINT_DURABILITY_PER_CLAIM
                if p['durability'] <= 0:
                    p['owner'] = my_team
                    p['durability'] = ARENA_POINT_MAX_DURABILITY
                    p['attacker'] = None
                    # Счёт наверху экрана — количество ЗАХВАТОВ (растёт монотонно,
                    # как у флага/груза), а не "сколько точек держим прямо сейчас"
                    # (то — live-снимок владения, который может упасть при потере
                    # точки; см. диалог: "нужно по кол-ву... захватили несколько раз
                    # ту же точку — считать столько раз сколько захватили"). Победа/
                    # тайбрейк для points режима как и раньше решаются отдельно
                    # (all_points_held/owned_seconds, см. check_win/deadline_outcome)
                    # — m.scores здесь используется ТОЛЬКО для табло, has_advantage()
                    # у points тоже намеренно продолжает смотреть на live-владение.
                    m.add_score(my_team)
                    await chat_manager.broadcast_to_uids(list(m.team_of.keys()),
                                                          {'type': 'arena_score', 'a': m.scores['a'], 'b': m.scores['b']})
                await chat_manager.broadcast_to_uids(list(m.team_of.keys()),
                                                      {'type': 'arena_objective_sync', 'points': m.points})

            elif msg_type == 'pvp_mob_register':
                sector = pvp_room_manager.player_sector.get(user.id)
                mob_id = data.get('mobId')
                if not sector or not mob_id:
                    continue
                mob_id = str(mob_id)[:80]
                owner_corp = data.get('ownerCorp')
                owner_corp = str(owner_corp)[:20] if owner_corp else None
                server_mob_manager.spawn(ServerMob(mob_id, sector, 0.0, 0.0, max_hull=1.0, max_shield=0.0, owner_corp=owner_corp))

            # ── PvP: заявка на выстрел по общему мобу сектора — HP шарится
            #    между всеми игроками (см. PvpMobState); движение моба сервер
            #    не знает (клиент-локальный AI), поэтому дальность — мягкая
            #    проверка по client-reported позиции моба, не строгая как для
            #    игроков; КД — строгая (по собственному таймеру атакующего) ──
            elif msg_type == 'pvp_mob_fire_claim':
                sector = pvp_room_manager.player_sector.get(user.id)
                mob_id = data.get('mobId')
                if not sector or not mob_id:
                    continue
                attacker = pvp_room_manager.get(sector, user.id)
                if not attacker:
                    continue
                # Способность (Аргус: pulsar/missiles, см. abilityMobFireClaim) бьёт общего
                # моба/турель/вагон тем же протоколом, что обычное оружие — НО со своим
                # потолком урона/кулдауном (ABILITY_DAMAGE_CEILING/COOLDOWN_FLOOR), не
                # личным лоадаутом атакующего (иначе почти все попадания душил бы общий
                # гейт обычного оружия — способность бьёт на порядок мощнее и намного чаще,
                # см. тот же аргумент у pvp_ability_fire_claim). Раньше у способностей
                # вообще не было пути на турели/вагоны бронепоезда (баг из диалога:
                # "ракетный залп и квантовый пульсар не наносят урон турелям и вагонам") —
                # ArgusController бил их локальным takeDamage(), сервер не участвовал вовсе.
                ability = data.get('ability')
                ability = str(ability)[:30] if ability else None
                if ability and ability not in ABILITY_DAMAGE_CEILING:
                    continue
                now_ts = time.time()
                if ability:
                    last = attacker.ability_last_fire.get(ability, 0.0)
                    if now_ts - last < ABILITY_COOLDOWN_FLOOR[ability]:
                        continue
                    attacker.ability_last_fire[ability] = now_ts
                else:
                    if now_ts - attacker.last_shot_at < attacker.loadout['cooldown']:
                        continue
                    mob_x, mob_y = data.get('mobX'), data.get('mobY')
                    if mob_x is not None and mob_y is not None:
                        dist = math.hypot(float(mob_x) - attacker.x, float(mob_y) - attacker.y)
                        if dist > attacker.loadout['range']:
                            continue
                    attacker.last_shot_at = now_ts
                # Огонь по мобу/базе/турели/бронепоезду — тоже "сам атакуешь", снимает
                # грейс-неуязвимость после ремонта на месте, как и огонь по игроку выше.
                attacker.respawn_grace_until = 0.0

                mob_id = str(mob_id)[:80]
                # Бронепоезд: бить можно только текущий хвостовой вагон — читер не может
                # пропустить очередь, отправив fire_claim по mobId середины/головы напрямую.
                train_key = wagon_idx = None
                if mob_id.startswith('train:'):
                    parts = mob_id.split(':')
                    # Только реальные вагоны (mobId "train:sector:startAt:idx", 4 части)
                    # проходят очередь "бить строго с хвоста". Дроны охраны головы
                    # ("train:sector:startAt:drone:phase:i", 6 частей) — обычные мобы,
                    # без этого gate'а: раньше wagon_idx оставался None для НИХ тоже, и
                    # continue ниже молча дропал вообще ВСЕ заявки по дронам — дроны были
                    # неубиваемы (сервер никогда не применял урон к mob_state).
                    if len(parts) == 4:
                        train_key = f"{parts[1]}:{parts[2]}"
                        try:
                            wagon_idx = int(parts[3])
                        except ValueError:
                            wagon_idx = None
                        if wagon_idx is None or not armored_train_manager.is_vulnerable(train_key, wagon_idx):
                            continue  # этот вагон ещё неуязвим (или mobId битый) — молча игнорируем

                max_hull = max(1.0, float(data.get('maxHull', 1)))
                max_shield = max(0.0, float(data.get('maxShield', 0)))
                mob_state = pvp_room_manager.get_or_create_mob(sector, mob_id, max_hull, max_shield)
                claimed_dmg = max(0.0, float(data.get('dmg', 0) or 0))
                # Аргус — реальное окно неуязвимости "квантовой фазы", см. _argus_phase_invincible.
                evasion = 0.0
                if mob_id.endswith(':argus'):
                    hull_frac = mob_state.hull / mob_state.max_hull if mob_state.max_hull > 0 else 1.0
                    evasion = 1.0 if _argus_phase_invincible(hull_frac) else 0.0
                weapon_type = ability if ability else str(data.get('weaponType', 'cannon'))[:20]
                shield_mult, hull_mult = _weapon_mults(weapon_type)
                ceiling = ABILITY_DAMAGE_CEILING[ability] if ability else attacker.loadout['dmg']
                penetration = 0.0 if ability else attacker.loadout['penetration']
                # burst_mult=1.0 и без крита для способности — тот же фикс/причина, что и у
                # pvp_ability_fire_claim (см. _apply_pvp_damage) — ceiling уже финальный урон
                # тика/ракеты, крит на способностях не должен применяться вовсе (см. диалог).
                crit_chance = 0.0 if ability else attacker.loadout['critChance']
                crit_mult   = 1.0 if ability else attacker.loadout['critMult']
                result = _apply_pvp_damage(
                    claimed_dmg, ceiling, penetration,
                    mob_state.hull, mob_state.shield, mob_state.max_hull, mob_state.max_shield,
                    crit_chance, crit_mult, evasion,
                    shield_mult, hull_mult, burst_mult=(1.0 if ability else PVP_BURST_MULT),
                )
                mob_state.hull, mob_state.shield = result['hull'], result['shield']
                if result['dmg'] > 0:
                    mob_state.damage_by[attacker.user_id] = mob_state.damage_by.get(attacker.user_id, 0.0) + result['dmg']
                    # Нашествие: копим вклад на уровне ВСЕЙ волны (world_event_damage),
                    # не только этого одного моба — mob_state.damage_by (выше) удалится
                    # вместе с записью на килле ЭТОГО моба (remove_mob ниже), а честный
                    # сплит награды нужен по сумме урона ПО ВСЕЙ волне (см.
                    # pvp_world_event_clear_claim). mob_id "we:sector:startAt:idx" — 4 части.
                    if mob_id.startswith('we:'):
                        we_parts = mob_id.split(':')
                        if len(we_parts) == 4:
                            we_key = f"{we_parts[1]}:{we_parts[2]}"
                            wed = world_event_damage.setdefault(we_key, {})
                            wed[attacker.user_id] = wed.get(attacker.user_id, 0.0) + result['dmg']
                if result['killed']:
                    pvp_room_manager.remove_mob(sector, mob_id)  # следующий, кто попадёт — лениво пересоздаст запись
                    server_mob_manager.remove(sector, mob_id)  # ServerMob-регистрация (дроны) синхронно с HP-леджером
                    if train_key is not None:
                        armored_train_manager.mark_destroyed(train_key, wagon_idx)
                    # Награда (вагон ИЛИ турель — базы или поезда, см. TURRET_REWARD в
                    # constants.js) — тот же pools/_split_reward_top5/pvp_wagon_reward
                    # путь, что раньше был только у вагонов (см. wagonReward-геттер,
                    # который раньше был только у ArmoredTrainWagon, не у турелей —
                    # баг из диалога: "награда за уничтожение турелей... похоже что её
                    # нет ни для станций"). ':turret:' — общий суффикс id и у турели базы
                    # (`<roomKey>:sector_base_idx:turret:slotIdx`), и у турели поезда
                    # (`train:sector:startAt:wagonIdx:turret:turretIdx`) — не нужно отдельно
                    # различать базу/поезд. mark_destroyed выше остаётся строго вагонным
                    # (порядок уничтожения "с хвоста" к турелям не относится).
                    is_turret = ':turret:' in mob_id
                    is_core = mob_id.startswith('train:') and mob_id.endswith(':core')
                    # Ракетный залп/поворотная турель — server-authoritative (см.
                    # ArmoredTrainManager выше). 4-я убитая турель вагона вооружает залп;
                    # если это ГОЛОВНОЙ вагон — ещё и спавнит серверную поворотную турель.
                    # Сама убитая поворотная турель снимается с учёта тем же путём.
                    if is_turret and mob_id.startswith('train:'):
                        tparts = mob_id.split(':')
                        if len(tparts) == 6:  # train:sector:startAt:wagonIdx:turret:turretIdx
                            t_train_key = f"{tparts[1]}:{tparts[2]}"
                            try:
                                t_wagon_idx = int(tparts[3])
                            except ValueError:
                                t_wagon_idx = None
                            if t_wagon_idx is not None and armored_train_manager.note_turret_kill(t_train_key, t_wagon_idx):
                                armored_train_manager.arm_missiles(t_train_key, t_wagon_idx)
                                if t_wagon_idx == HEAD_WAGON_IDX:
                                    armored_train_manager.spawn_core_turret(t_train_key)
                    elif is_core:
                        cparts = mob_id.split(':')
                        if len(cparts) == 5:  # train:sector:startAt:wagonIdx:core
                            armored_train_manager.despawn_core_turret(f"{cparts[1]}:{cparts[2]}")
                    if train_key is not None or is_turret or is_core:
                        # wagonReward — тот же детерминированный (по ARMORED_TRAIN_SECTORS/
                        # TURRET_REWARD) пул у ВСЕХ атакующих клиентов, неважно чья заявка убила цель.
                        pools = data.get('wagonReward') or {}
                        if isinstance(pools, dict) and pools:
                            shares = _split_reward_top5(mob_state.damage_by, {
                                k: float(v) for k, v in pools.items() if k in ('credits', 'xp', 'gold', 'biomech_fragment', 'quantum_shard', 'plasma_strand')
                            })
                            for uid, share in shares.items():
                                await chat_manager.send_to_uid(uid, {'type': 'pvp_wagon_reward', 'mobId': mob_id, **share})
                    elif sector.startswith('group:') and data.get('isDungeonBoss'):
                        # Данж-босс в группе (Фаза 4): урон уже общий (mob_state.damage_by,
                        # обычный PvpMobState-леджер — ничего дополнительного делать не нужно),
                        # но раньше сплит награды (GroupManager.boss_died) читал СТАРЫЙ relay-
                        # протокол group_damage/inst.members[...]['damage'], который перестал
                        # вызываться вообще, как только эти мобы получили pvpMobId (см. комментарий
                        # у DungeonInstance/GroupManager) — split деградировал до "только хил".
                        # "Фотографируем" реальный вклад ПРЯМО СЕЙЧАС: mob_state будет удалён из
                        # реестра (remove_mob выше) раньше, чем долетит отдельное group_boss_dead
                        # от клиента, заметившего килл — ждать его для чтения damage_by нельзя.
                        # uid→username — через живых участников той же комнаты (room_players),
                        # damage_by ключуется по uid, inst.members — по username (унаследовано
                        # от старого relay-протокола, трогать шире этого фикса не стал).
                        inst = group_manager.get_instance(attacker.username)
                        if inst and not inst.locked:
                            room_players = pvp_room_manager.rooms.get(sector, {})
                            for uid, dmg in mob_state.damage_by.items():
                                p = room_players.get(uid)
                                if p and p.username in inst.members:
                                    inst.members[p.username]['damage'] = dmg

                out = {
                    'type': 'pvp_mob_hit_result', 'mobId': mob_id, 'attackerUserId': attacker.user_id,
                    'weaponType': weapon_type,
                    'maxHull': mob_state.max_hull, 'maxShield': mob_state.max_shield,
                    **result,
                }
                # damageBy — только на килле вагона поезда, нужен убивающему клиенту, чтобы
                # определить, кто имеет право на лутбокс с вагона (см. pvp_wagon_loot_spawn
                # ниже) — раньше этот путь (в отличие от игрок-игрок _resolve_pvp_hit) вообще
                # не сообщал разбивку урона по атакующим.
                if result['killed'] and train_key is not None:
                    out['damageBy'] = {str(uid): round(dmg) for uid, dmg in mob_state.damage_by.items()}
                room_uids = [attacker.user_id] + [p.user_id for p in pvp_room_manager.others(sector, attacker.user_id)]
                await chat_manager.broadcast_to_uids(room_uids, out)

            # ── Нашествие расчищено — клиент, заметивший это (все мобы волны мертвы),
            #    просит разослать пропорциональную награду. Раньше сплита не было вовсе —
            #    каждый клиент с любым уроном по волне сам себе выдавал ПОЛНУЮ награду
            #    локально, без сервера (баг того же класса, что чинили для турелей). pools —
            #    тот же детерминированный (по WORLD_EVENT_SECTORS) reward-объект у ВСЕХ
            #    клиентов комнаты, неважно чей клиент первым заметил расчистку. pop() —
            #    идемпотентность: если несколько клиентов заметят расчистку одновременно
            #    и пришлют claim, первый "выигрывает" и потребляет накопленный вклад,
            #    остальные находят world_event_damage[we_key] уже удалённым — молча no-op.
            elif msg_type == 'pvp_world_event_clear_claim':
                sector = pvp_room_manager.player_sector.get(user.id)
                we_key = str(data.get('weKey', ''))[:80]
                if not sector or not we_key:
                    continue
                pools = data.get('rewards') or {}
                contrib = world_event_damage.pop(we_key, None)
                if not contrib or not isinstance(pools, dict) or not pools:
                    continue
                # 'stars' — реальное имя поля в WORLD_EVENT_SECTORS.rewards (client
                # constants.js), не 'gold' (то — только у вагонов/турелей поезда).
                shares = _split_reward_top5(contrib, {
                    k: float(v) for k, v in pools.items() if k in ('credits', 'xp', 'stars')
                })
                for uid, share in shares.items():
                    await chat_manager.send_to_uid(uid, {'type': 'pvp_world_event_reward', 'weKey': we_key, **share})

            # ── PvP: заявка на выстрел ТУРЕЛИ добывающей базы по общему мобу —
            #    урон/дальность/КД считаем по типу турели (TURRET_WEAPONS), НЕ по
            #    личному лоадауту отправившего игрока (турель — не его оружие).
            #    turret_last_fire дедуплицирует независимые заявки разных клиентов
            #    об одном и том же залпе (см. комментарий у TURRET_WEAPONS) —
            #    засчитываем первую, остальные в пределах minInterval молча игнорируем.
            elif msg_type == 'pvp_turret_fire_claim':
                sector = pvp_room_manager.player_sector.get(user.id)
                mob_id = data.get('mobId')
                turret_id = data.get('turretId')
                if not sector or not mob_id or not turret_id:
                    continue
                turret_id = str(turret_id)[:120]
                weapon_type = str(data.get('weaponType', 'cannon1'))[:20]
                cfg = TURRET_WEAPONS.get(weapon_type, TURRET_WEAPONS['cannon1'])
                now_ts = time.time()
                if now_ts - pvp_room_manager.turret_last_fire.get(turret_id, 0.0) < cfg['minInterval']:
                    continue
                base_x, base_y = data.get('baseX'), data.get('baseY')
                mob_x, mob_y = data.get('mobX'), data.get('mobY')
                if base_x is not None and mob_x is not None:
                    dist = math.hypot(float(mob_x) - float(base_x), float(mob_y) - float(base_y))
                    if dist > cfg['range']:
                        continue
                pvp_room_manager.turret_last_fire[turret_id] = now_ts

                mob_id = str(mob_id)[:80]
                max_hull = max(1.0, float(data.get('maxHull', 1)))
                max_shield = max(0.0, float(data.get('maxShield', 0)))
                mob_state = pvp_room_manager.get_or_create_mob(sector, mob_id, max_hull, max_shield)
                claimed_dmg = max(0.0, float(data.get('dmg', 0) or 0))
                ceiling = cfg['damage'] * _turret_damage_mult(data.get('pvpTier'))
                evasion = 0.0
                if mob_id.endswith(':argus'):
                    hull_frac = mob_state.hull / mob_state.max_hull if mob_state.max_hull > 0 else 1.0
                    evasion = 1.0 if _argus_phase_invincible(hull_frac) else 0.0
                result = _apply_pvp_damage(
                    claimed_dmg, ceiling, 0.0,
                    mob_state.hull, mob_state.shield, mob_state.max_hull, mob_state.max_shield,
                    0.0, 2.0, evasion,
                )
                mob_state.hull, mob_state.shield = result['hull'], result['shield']
                if result['killed']:
                    pvp_room_manager.remove_mob(sector, mob_id)

                out = {
                    'type': 'pvp_mob_hit_result', 'mobId': mob_id, 'attackerUserId': None,
                    'weaponType': weapon_type,
                    'maxHull': mob_state.max_hull, 'maxShield': mob_state.max_shield,
                    **result,
                }
                room_uids = [user.id] + [p.user_id for p in pvp_room_manager.others(sector, user.id)]
                await chat_manager.broadcast_to_uids(room_uids, out)

            # ── PvP: лут с убитого игрока — репортит сама жертва (только у её
            #    клиента есть реальный инвентарь, откуда считается 5%-дроп), сервер
            #    решает, КОМУ он виден: победителю и всем, кто наносил урон в эту
            #    жизнь (last_death_eligible, см. _resolve_pvp_hit), не самой жертве ──
            elif msg_type == 'pvp_loot_spawn':
                sector = pvp_room_manager.player_sector.get(user.id)
                victim = pvp_room_manager.get(sector, user.id) if sector else None
                if not victim:
                    continue
                eligible = victim.last_death_eligible
                victim.last_death_eligible = []
                if not eligible:
                    continue  # не должно происходить (килл невозможен без урона), но защитимся
                loot_id = f"{sector}:{user.id}:{int(time.time() * 1000)}"
                item = data.get('item') or {}
                x = float(data.get('x', victim.x) or victim.x)
                y = float(data.get('y', victim.y) or victim.y)
                pvp_room_manager.spawn_loot(sector, loot_id, x, y, item, eligible)
                await chat_manager.broadcast_to_uids(eligible, {
                    'type': 'pvp_loot_spawned', 'lootId': loot_id, 'x': x, 'y': y, 'item': item,
                })

            # ── Бронепоезд: лутбокс с уничтоженного вагона — переиспользует ту же
            #    PvpLootBox/spawn_loot инфраструктуру, что и лут с убитого игрока выше, но
            #    eligible нет откуда взять из PvpPlayerState (нет "жертвы"-игрока) — клиент,
            #    добивший вагон, шлёт готовый item (тот же паттерн "клиент решает ЧТО, сервер
            #    решает КОМУ видно", см. pvp_loot_spawn) + список contributor uid'ов из
            #    damageBy, которую сервер сам прислал ему в pvp_mob_hit_result на килле (см.
            #    выше в pvp_mob_fire_claim) — не считаем заново, просто доверяем тому же
            #    множеству, что уже получило денежную долю за вагон.
            elif msg_type == 'pvp_wagon_loot_spawn':
                sector = pvp_room_manager.player_sector.get(user.id)
                if not sector:
                    continue
                item = data.get('item')
                eligible_raw = data.get('eligible') or []
                try:
                    eligible = [int(u) for u in eligible_raw]
                except (TypeError, ValueError):
                    eligible = []
                if not isinstance(item, dict) or not item or not eligible:
                    continue
                x = float(data.get('x', 0) or 0)
                y = float(data.get('y', 0) or 0)
                # +random-суффикс — с личными бандл-коробками на игрока (см. диалог: "1 коробка
                # на 1 игрока") один и тот же клиент шлёт НЕСКОЛЬКО таких заявок подряд без
                # паузы; timestamp_ms:user_id одинаков для запросов, попавших в одну и ту же
                # миллисекунду — коллизия loot_id тихо перезаписывала бы (и теряла) более
                # раннюю коробку в pvp_room_manager.loot_rooms (dict по loot_id).
                loot_id = f"wagonloot:{sector}:{int(time.time() * 1000)}:{user.id}:{random.randint(0, 999999)}"
                pvp_room_manager.spawn_loot(sector, loot_id, x, y, item, eligible)
                await chat_manager.broadcast_to_uids(eligible, {
                    'type': 'pvp_loot_spawned', 'lootId': loot_id, 'x': x, 'y': y, 'item': item,
                })

            # ── Бронепоезд: локальный ArmoredTrain клиента закончился (все вагоны
            #    уничтожены ИЛИ истёк маршрутный таймаут — см. ArmoredTrain._markFinished) —
            #    чистим turret_kills/missile_ready_at/core_turret для этого train_key.
            #    Раньше ArmoredTrainManager.cleanup() существовал, но его никто не звал —
            #    _train_weapon_tick_loop продолжал слать залпы уже несуществующего поезда
            #    бесконечно (баг из диалога: "урон после уничтожения поезда продолжает
            #    убивать игрока"). Идемпотентно — можно звать с любого клиента комнаты
            #    независимо, cleanup() просто молча no-op'ит на уже отсутствующих ключах.
            elif msg_type == 'pvp_train_finished':
                train_key = str(data.get('trainKey', ''))[:80]
                if train_key:
                    armored_train_manager.cleanup(train_key)

            # ── PvP: заявка на подбор общего лут-бокса — первый успешный клейм
            #    забирает; остальным eligible-игрокам разослать "коробки больше нет" ─
            elif msg_type == 'pvp_loot_claim':
                sector = pvp_room_manager.player_sector.get(user.id)
                loot_id = data.get('lootId')
                if not sector or not loot_id:
                    continue
                box = pvp_room_manager.get_loot(sector, loot_id)
                if not box or user.id not in box.eligible:
                    continue  # уже забрали (box=None) или это не "наш" лут — тихо игнорируем
                pvp_room_manager.remove_loot(sector, loot_id)
                await ws.send_json({'type': 'pvp_loot_result', 'lootId': loot_id, 'granted': True, 'item': box.item})
                await chat_manager.broadcast_to_uids(
                    [uid for uid in box.eligible if uid != user.id],
                    {'type': 'pvp_loot_removed', 'lootId': loot_id},
                )

            # ── Депозиты ресурсов: заявка на сбор общего узла комнаты — первый
            #    успешный клейм забирает и ставит respawn_at, остальным в комнате
            #    рассылаем "узел собран" (см. get_or_create_resources выше) ──
            elif msg_type == 'pvp_resource_claim':
                sector = pvp_room_manager.player_sector.get(user.id)
                node_id = data.get('resourceId')
                if not sector or not node_id:
                    continue
                node_id = str(node_id)[:40]
                node = pvp_room_manager.get_resource(sector, node_id)
                now_ts = time.time()
                if not node or not node.alive:
                    await ws.send_json({'type': 'pvp_resource_result', 'resourceId': node_id, 'granted': False})
                    continue
                node.alive = False
                node.respawn_at = now_ts + node.respawn_ms / 1000.0
                await ws.send_json({
                    'type': 'pvp_resource_result', 'resourceId': node_id, 'granted': True,
                    'resourceType': node.resource_type, 'amount': node.amount,
                })
                await chat_manager.broadcast_to_uids(
                    [p.user_id for p in pvp_room_manager.others(sector, user.id)],
                    {'type': 'pvp_resource_collected', 'resourceId': node_id},
                )

            # ── Друзья: добавить / принять авто ──────────────────────
            elif msg_type == 'friend_add':
                to_name = str(data.get('to', '')).strip()
                if not to_name or to_name == user.username:
                    await ws.send_json({'type': 'friend_error', 'text': 'Некорректное имя'})
                else:
                    async with SessionLocal() as db:
                        target = (await db.execute(select(User).where(User.username == to_name))).scalar_one_or_none()
                        if not target:
                            await ws.send_json({'type': 'friend_error', 'text': f'Игрок {to_name} не найден'})
                        else:
                            existing = (await db.execute(select(Friendship).where(
                                or_(
                                    and_(Friendship.user_a == user.username, Friendship.user_b == to_name),
                                    and_(Friendship.user_a == to_name,       Friendship.user_b == user.username),
                                )
                            ))).scalar_one_or_none()
                            if existing:
                                if existing.status == 'accepted':
                                    await ws.send_json({'type': 'friend_error', 'text': f'{to_name} уже в списке друзей'})
                                elif existing.user_a == user.username:
                                    await ws.send_json({'type': 'friend_error', 'text': 'Запрос уже отправлен'})
                                else:
                                    # They sent request first → auto-accept
                                    existing.status = 'accepted'
                                    await db.commit()
                                    fl = await _get_friend_list(user.username, db)
                                    await ws.send_json({'type': 'friend_list', 'friends': fl})
                                    if to_name in _online_names():
                                        fl2 = await _get_friend_list(to_name, db)
                                        await chat_manager.send_pm(to_name, {'type': 'friend_list', 'friends': fl2})
                            else:
                                db.add(Friendship(user_a=user.username, user_b=to_name, status='pending'))
                                await db.commit()
                                fl = await _get_friend_list(user.username, db)
                                await ws.send_json({'type': 'friend_list', 'friends': fl})
                                if to_name in _online_names():
                                    await chat_manager.send_pm(to_name, {
                                        'type': 'friend_request_in', 'from': user.username,
                                    })

            # ── Друзья: принять запрос ────────────────────────────────
            elif msg_type == 'friend_accept':
                from_name = str(data.get('from', '')).strip()
                if from_name:
                    async with SessionLocal() as db:
                        row = (await db.execute(select(Friendship).where(
                            Friendship.user_a == from_name,
                            Friendship.user_b == user.username,
                            Friendship.status == 'pending',
                        ))).scalar_one_or_none()
                        if row:
                            row.status = 'accepted'
                            await db.commit()
                            fl = await _get_friend_list(user.username, db)
                            await ws.send_json({'type': 'friend_list', 'friends': fl})
                            if from_name in _online_names():
                                fl2 = await _get_friend_list(from_name, db)
                                await chat_manager.send_pm(from_name, {'type': 'friend_list', 'friends': fl2})

            # ── Друзья: отклонить запрос ──────────────────────────────
            elif msg_type == 'friend_decline':
                from_name = str(data.get('from', '')).strip()
                if from_name:
                    async with SessionLocal() as db:
                        await db.execute(delete(Friendship).where(
                            Friendship.user_a == from_name,
                            Friendship.user_b == user.username,
                        ))
                        await db.commit()
                        fl = await _get_friend_list(user.username, db)
                    await ws.send_json({'type': 'friend_list', 'friends': fl})

            # ── Друзья: удалить из списка ─────────────────────────────
            elif msg_type == 'friend_remove':
                name = str(data.get('name', '')).strip()
                if name:
                    async with SessionLocal() as db:
                        await db.execute(delete(Friendship).where(
                            or_(
                                and_(Friendship.user_a == user.username, Friendship.user_b == name),
                                and_(Friendship.user_a == name,          Friendship.user_b == user.username),
                            )
                        ))
                        await db.commit()
                        fl = await _get_friend_list(user.username, db)
                    await ws.send_json({'type': 'friend_list', 'friends': fl})

    except Exception as e:
        # Раньше тут стоял except WebSocketDisconnect — любое ДРУГОЕ исключение внутри
        # обработки сообщения (баг в новом PvP-коде, невалидный payload и т.п.) пробивало
        # cleanup насквозь: pvp_room_manager/group_manager/chat_manager не чистились,
        # игрок оставался "призраком" в комнатах. Плюс трейсбек — иначе его не видно
        # в свёрнутом окне сервера (client/run.ps1 запускает backend в minimized-окне).
        if not isinstance(e, WebSocketDisconnect):
            import traceback
            traceback.print_exc()
        # Notify online friends that this user went offline
        try:
            async with SessionLocal() as db:
                fl = await _get_friend_list(user.username, db)
            for f in fl:
                if f['status'] == 'accepted' and f['online']:
                    await chat_manager.send_pm(f['name'], {'type': 'friend_offline', 'name': user.username})
        except Exception:
            pass
        group_manager.leave(user.username)
        # Арена: снять из очереди (если ждал матча) и запустить 2-минутный таймер void —
        # у арены нет оффлайн-путешествия (это боевой инстанс, не открытый мир), поэтому
        # НЕ снэпшотим в OfflineShipManager ниже для arena-комнат (см. ветку pending_sector
        # startswith('arena:')) — только сам факт дисконнекта до срабатывания watchdog'а
        # в _arena_tick_loop.
        arena_queue.dequeue(user.id)
        arena_matches.on_disconnect(user.id, time.time())
        # План Фаза 3.1 (offline-ship): раньше дисконнект просто удалял PvpPlayerState и
        # broadcast'ил pvp_player_left — остальные в комнате видели, что корабль исчезает.
        # Теперь снимаем снапшот в OfflineShipManager ПЕРЕД удалением: RemotePlayer у
        # остальных клиентов не деспавнится, а продолжает получать позицию из
        # pvp_offline_ship_update (см. _offline_ship_tick_loop) вместо pvp_pos_update —
        # никакого отдельного события для этого перехода не нужно, клиент не различает
        # источник. pvp_player_left остаётся как fallback на маловероятный случай
        # player_sector/rooms рассинхрона (defensive, не должно случаться).
        pending_sector = pvp_room_manager.player_sector.get(user.id)
        pending_state = pvp_room_manager.get(pending_sector, user.id) if pending_sector else None
        if pending_state and pending_sector and pending_sector.startswith('arena:'):
            pvp_sector = pvp_room_manager.leave(user.id)
            others = pvp_room_manager.others(pvp_sector, user.id) if pvp_sector else []
            try:
                await chat_manager.broadcast_to_uids(
                    [p.user_id for p in others],
                    {'type': 'pvp_player_left', 'userId': user.id},
                    exclude_uid=user.id,
                )
            except Exception:
                pass
        elif pending_state:
            offline_ship_manager.snapshot(pending_sector, user.id, user.username, pending_state)
            pvp_room_manager.leave(user.id)
        else:
            pvp_sector = pvp_room_manager.leave(user.id)
            if pvp_sector:
                others = pvp_room_manager.others(pvp_sector, user.id)
                try:
                    await chat_manager.broadcast_to_uids(
                        [p.user_id for p in others],
                        {'type': 'pvp_player_left', 'userId': user.id},
                        exclude_uid=user.id,
                    )
                except Exception:
                    pass
        chat_manager.disconnect(ws)
