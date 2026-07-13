import asyncio
import math
import random
import time

from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import or_, and_, select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from database import engine, get_db, SessionLocal, Base
from models import User, PlayerState, AuditLog, ChatMessage, Friendship, DungeonRun, DungeonLives, MiningBaseState
from schemas import (
    RegisterRequest, LoginRequest, TokenResponse, UserResponse,
    PlayerStateResponse, AuditEntryCreate, AuditEntryResponse,
    DungeonStatusResponse, DungeonEnterRequest, DungeonEnterResponse,
    DungeonMobKilledRequest, DungeonLootDropRequest, DungeonLootCollectedRequest,
    DungeonCorridorStateRequest, DungeonDeathRequest, DungeonDeathResponse,
    DungeonCompleteRequest, MiningBaseSaveRequest, MiningBaseSectorResponse,
)
from auth import hash_password, verify_password, create_token, decode_token

app = FastAPI(title="Stellar Drift API", version="0.1.0")


@app.on_event("startup")
async def _create_tables():
    # create_all — синхронный вызов metadata, run_sync прогоняет его через
    # обычное DBAPI-соединение движка (aiosqlite) без блокировки event loop
    # (см. диалог про переход на async SQLAlchemy).
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

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
        for uid in uids:
            if uid == exclude_uid:
                continue
            await self.send_to_uid(uid, data)


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
# Крит-шанс/множитель — по статам АТАКУЮЩЕГО игрока (loadout.critChance/critMult),
# а не фиксированные для всех: иначе билд с высоким личным крит-шансом ощущался бы
# так же, как билд без него вообще. Ролл всё равно решает сервер, не клиент —
# доверять client-claimed isCrit нельзя (свободный крит на каждый выстрел).
PVP_CRIT_CHANCE_CAP = 0.65   # потолок — тот же, что у клиента (Player.js:critChance)
PVP_CRIT_MULT_CAP   = 4.0    # потолок — тот же, что у клиента (Player.js:critMult)

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


class PvpPlayerState:
    def __init__(self, user_id: int, username: str, x: float, y: float, loadout: dict):
        self.user_id  = user_id
        self.username = username
        self.ship_key = str(loadout.get('shipKey', ''))[:40]  # только для рендера у др. клиентов, не участвует в валидации
        self.corp = str(loadout.get('corp') or 'neutral')[:20]  # для запрета дружественного огня, см. pvp_fire_claim
        self.level = max(1, int(loadout.get('level') or 1))  # для честного тира чести (PVP_HIGHER/EQUAL/LOWER), см. pvp_fire_claim
        self.x = float(x)
        self.y = float(y)
        self.heading = 0.0
        self.hull        = float(loadout.get('hull', 1))
        self.max_hull    = max(1.0, float(loadout.get('maxHull', 1)))
        self.shield      = float(loadout.get('shield', 0))
        self.max_shield  = max(0.0, float(loadout.get('maxShield', 0)))
        self.loadout = _clamp_pvp_loadout(loadout)
        self.last_shot_at = 0.0
        # Кто наносил урон этой жизни игрока (uid → суммарный урон) — используется,
        # чтобы решить, кому будет виден лут-бокс после смерти (см. PvpLootBox). Сбрасывается
        # при килле в last_death_eligible.
        self.damage_by: dict[int, float] = {}
        self.last_death_eligible: list[int] = []

    def to_public(self) -> dict:
        return {
            'userId': self.user_id, 'name': self.username, 'shipKey': self.ship_key,
            'corp': self.corp, 'level': self.level,
            'x': self.x, 'y': self.y, 'heading': self.heading,
            'hull': self.hull, 'maxHull': self.max_hull,
            'shield': self.shield, 'maxShield': self.max_shield,
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


class PvpRoomManager:
    def __init__(self):
        self.rooms: dict[str, dict[int, PvpPlayerState]] = {}
        self.player_sector: dict[int, str] = {}   # user_id → sector, для leave на disconnect
        self.mob_rooms: dict[str, dict[str, PvpMobState]] = {}
        self.loot_rooms: dict[str, dict[str, PvpLootBox]] = {}
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

    def update_pos(self, sector: str, user_id: int, x: float, y: float, heading: float):
        p = self.get(sector, user_id)
        if p:
            p.x, p.y, p.heading = float(x), float(y), float(heading)

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
class ArmoredTrainManager:
    def __init__(self):
        self.destroyed: dict[str, set[int]] = {}  # train_key ("sector:startAt") → уничтоженные idx

    def is_vulnerable(self, train_key: str, wagon_idx: int) -> bool:
        d = self.destroyed.get(train_key, set())
        return all(i in d for i in range(wagon_idx))

    def mark_destroyed(self, train_key: str, wagon_idx: int):
        self.destroyed.setdefault(train_key, set()).add(wagon_idx)

    def cleanup(self, train_key: str):
        self.destroyed.pop(train_key, None)


armored_train_manager = ArmoredTrainManager()


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


def _apply_pvp_damage(claimed_dmg: float, ceiling: float, penetration: float,
                       victim_hull: float, victim_shield: float,
                       victim_max_hull: float, victim_max_shield: float,
                       crit_chance: float = 0.0, crit_mult: float = 2.0,
                       victim_evasion: float = 0.0) -> dict:
    """Мирроит shield/hull split из Player.takeDamage (client/src/entities/Player.js).
    Урон — заявка клиента (claimed_dmg, реальный посчитанный урон выстрела со всеми
    баффами/перками), зажатая потолком ceiling*PVP_BURST_MULT — не плоское число на
    весь визит в комнату, но и не слепое доверие. Крит и уклонение всё равно решает
    сервер своим роллом (по статам АТАКУЮЩЕГО — crit_chance/crit_mult, не фиксированные
    для всех), не заявка клиента. Общий расчёт для игрок→игрок и игрок→моб — обе жертвы
    описываются просто парой hull/shield, дальше не важно, чьи они. victim_evasion=0
    для мобов — их движение клиент-локальное, сервер не знает скорость, чтобы честно
    её учитывать."""
    if victim_evasion > 0 and random.random() < victim_evasion:
        return {'isCrit': False, 'dmg': 0, 'killed': False, 'dodged': True,
                'hull': victim_hull, 'shield': victim_shield}

    base = max(0.0, min(claimed_dmg, ceiling * PVP_BURST_MULT))
    is_crit = random.random() < crit_chance
    amount = base * (crit_mult if is_crit else 1.0)

    direct = amount * penetration
    to_shield_raw = amount - direct
    hull_hit = direct

    shield = victim_shield
    if shield > 0:
        if to_shield_raw <= shield:
            shield -= to_shield_raw
        else:
            hull_hit += (to_shield_raw - shield)
            shield = 0.0
    else:
        hull_hit = amount

    hull = max(0.0, victim_hull - hull_hit)
    killed = hull <= 0
    if killed:
        # Респавн в бухгалтерии сразу — для игрока это мирроит клиентский Player.respawn();
        # для моба записи просто удаляются после броадкаста (см. remove_mob), это поле
        # там не используется, но killed=True/hull=0 в самом сообщении уже отражает смерть.
        hull, shield = victim_max_hull, victim_max_shield

    return {'isCrit': is_crit, 'dmg': round(amount), 'killed': killed, 'dodged': False, 'hull': hull, 'shield': shield}


def _resolve_pvp_hit(attacker: PvpPlayerState, victim: PvpPlayerState, claimed_dmg: float) -> dict:
    r = _apply_pvp_damage(claimed_dmg, attacker.loadout['dmg'], attacker.loadout['penetration'],
                           victim.hull, victim.shield, victim.max_hull, victim.max_shield,
                           attacker.loadout['critChance'], attacker.loadout['critMult'],
                           victim.loadout['evasion'])
    victim.hull, victim.shield = r['hull'], r['shield']
    if not r['dodged'] and r['dmg'] > 0:
        victim.damage_by[attacker.user_id] = victim.damage_by.get(attacker.user_id, 0.0) + r['dmg']
    damage_by_out = None
    bounty_bonus = None
    if r['killed']:
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
    return {**r, 'maxHull': victim.max_hull, 'maxShield': victim.max_shield, 'damageBy': damage_by_out, 'bountyBonus': bounty_bonus}


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

@app.post("/auth/register", response_model=TokenResponse)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    existing = (await db.execute(select(User).where(User.username == body.username))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="Username already taken")
    # bcrypt намеренно медленный (CPU-bound) — в тред-пул, иначе блокирует event loop
    # на ~100-300мс на КАЖДУЮ регистрацию (см. диалог про нагрузочный тест).
    password_hash = await asyncio.to_thread(hash_password, body.password)
    user = User(username=body.username, password_hash=password_hash)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return TokenResponse(access_token=create_token(user.id), username=user.username)


@app.post("/auth/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    user = (await db.execute(select(User).where(User.username == body.username))).scalar_one_or_none()
    if not user or not await asyncio.to_thread(verify_password, body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    return TokenResponse(access_token=create_token(user.id), username=user.username)


@app.get("/auth/me", response_model=UserResponse)
def me(user: User = Depends(get_current_user)):
    return UserResponse(id=user.id, username=user.username)


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
    await ws.send_json({'type': 'friend_list', 'friends': friend_list})
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
                ts = time.time()
                out = {'type': 'pm', 'from': user.username, 'to': to_name, 'text': text, 'time': _fmt_time(ts)}
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
                pvp_room_manager.enter(sector, user.id, user.username, x, y, loadout)
                others = pvp_room_manager.others(sector, user.id)
                await ws.send_json({
                    'type': 'pvp_room_snapshot',
                    'players': [p.to_public() for p in others],
                    # Только мобы, по которым уже кто-то стрелял (см. PvpMobState) — не
                    # тронутые мобы у новых клиентов и так спавнятся на полном HP.
                    'mobs': pvp_room_manager.mob_snapshot(sector),
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
                if loadout.get('corp'):
                    state.corp = str(loadout['corp'])[:20]
                if loadout.get('level'):
                    state.level = max(1, int(loadout['level']))

            # ── PvP: обновление позиции (throttled клиентом, ~10Hz) ────
            elif msg_type == 'pvp_pos':
                sector = pvp_room_manager.player_sector.get(user.id)
                if not sector:
                    continue
                x = float(data.get('x', 0) or 0)
                y = float(data.get('y', 0) or 0)
                heading = float(data.get('heading', 0) or 0)
                pvp_room_manager.update_pos(sector, user.id, x, y, heading)
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

            # ── PvP: осознанный выход из сектора (не disconnect) ───────
            elif msg_type == 'pvp_leave':
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
                # Игрок-игрок бой — только в реальных PvP-секторах (room key начинается с
                # "pvp_"). Комнаты для дома/PvE/групповых данжей (room key = имя сектора
                # или "group:<instanceId>") тоже используют pvp_enter/pvp_pos для видимости
                # союзников, но там драться друг с другом нельзя — молча игнорируем попытку.
                if not sector.startswith('pvp_'):
                    continue
                attacker = pvp_room_manager.get(sector, user.id)
                victim = pvp_room_manager.get(sector, int(target_id))
                if not attacker or not victim or victim.user_id == attacker.user_id:
                    continue
                # Дружественный огонь между игроками одного корпа запрещён — единственное
                # исключение будет отдельная арена с записью/очередью (дуэли не по
                # корпам), которой пока нет как отдельного сектора. Проверяем на
                # сервере (не только скрытие/блок на клиенте), т.к. клиент не авторитетен.
                if attacker.corp == victim.corp:
                    continue
                now_ts = time.time()
                if now_ts - attacker.last_shot_at < attacker.loadout['cooldown']:
                    continue  # чаще заявленного КД — молча игнорируем (см. план: без ложных банов)
                dist = math.hypot(victim.x - attacker.x, victim.y - attacker.y)
                if dist > attacker.loadout['range']:
                    continue  # вне заявленной дальности — молча игнорируем
                attacker.last_shot_at = now_ts

                claimed_dmg = max(0.0, float(data.get('dmg', 0) or 0))
                result = _resolve_pvp_hit(attacker, victim, claimed_dmg)
                out = {
                    'type': 'pvp_hit_result',
                    'attackerUserId': attacker.user_id, 'targetUserId': victim.user_id,
                    'weaponType': str(data.get('weaponType', 'cannon'))[:20],
                    **result,
                }
                room_uids = [attacker.user_id] + [p.user_id for p in pvp_room_manager.others(sector, attacker.user_id)]
                await chat_manager.broadcast_to_uids(room_uids, out)

                if result['killed']:
                    async with SessionLocal() as db:
                        db.add(AuditLog(user_id=victim.user_id, action='pvp_kill', params={
                            'killer': attacker.username, 'victim': victim.username, 'sector': sector,
                        }, sector=sector))
                        await db.commit()
                    if result.get('bountyBonus'):
                        await chat_manager.broadcast('general', {'type': 'pvp_bounty_cleared', 'userId': victim.user_id})

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
                now_ts = time.time()
                if now_ts - attacker.last_shot_at < attacker.loadout['cooldown']:
                    continue
                mob_x, mob_y = data.get('mobX'), data.get('mobY')
                if mob_x is not None and mob_y is not None:
                    dist = math.hypot(float(mob_x) - attacker.x, float(mob_y) - attacker.y)
                    if dist > attacker.loadout['range']:
                        continue
                attacker.last_shot_at = now_ts

                mob_id = str(mob_id)[:80]
                # Бронепоезд: бить можно только текущий хвостовой вагон — читер не может
                # пропустить очередь, отправив fire_claim по mobId середины/головы напрямую.
                train_key = wagon_idx = None
                if mob_id.startswith('train:'):
                    parts = mob_id.split(':')
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
                result = _apply_pvp_damage(
                    claimed_dmg, attacker.loadout['dmg'], attacker.loadout['penetration'],
                    mob_state.hull, mob_state.shield, mob_state.max_hull, mob_state.max_shield,
                    attacker.loadout['critChance'], attacker.loadout['critMult'], evasion,
                )
                mob_state.hull, mob_state.shield = result['hull'], result['shield']
                if result['dmg'] > 0:
                    mob_state.damage_by[attacker.user_id] = mob_state.damage_by.get(attacker.user_id, 0.0) + result['dmg']
                if result['killed']:
                    pvp_room_manager.remove_mob(sector, mob_id)  # следующий, кто попадёт — лениво пересоздаст запись
                    if train_key is not None:
                        armored_train_manager.mark_destroyed(train_key, wagon_idx)
                        # wagonReward — тот же детерминированный (по ARMORED_TRAIN_SECTORS)
                        # пул у ВСЕХ атакующих клиентов, неважно чья заявка убила вагон.
                        pools = data.get('wagonReward') or {}
                        if isinstance(pools, dict) and pools:
                            shares = _split_reward_top5(mob_state.damage_by, {
                                k: float(v) for k, v in pools.items() if k in ('credits', 'xp', 'gold', 'biomech_fragment', 'quantum_shard', 'plasma_strand')
                            })
                            for uid, share in shares.items():
                                await chat_manager.send_to_uid(uid, {'type': 'pvp_wagon_reward', 'mobId': mob_id, **share})

                out = {
                    'type': 'pvp_mob_hit_result', 'mobId': mob_id, 'attackerUserId': attacker.user_id,
                    'weaponType': str(data.get('weaponType', 'cannon'))[:20],
                    'maxHull': mob_state.max_hull, 'maxShield': mob_state.max_shield,
                    **result,
                }
                room_uids = [attacker.user_id] + [p.user_id for p in pvp_room_manager.others(sector, attacker.user_id)]
                await chat_manager.broadcast_to_uids(room_uids, out)

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
