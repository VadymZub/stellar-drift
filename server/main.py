import math
import random
import time

from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import or_, and_
from sqlalchemy.orm import Session

from database import engine, get_db, Base
from models import User, PlayerState, AuditLog, ChatMessage, Friendship, DungeonRun, DungeonLives
from schemas import (
    RegisterRequest, LoginRequest, TokenResponse, UserResponse,
    PlayerStateResponse, AuditEntryCreate, AuditEntryResponse,
    DungeonStatusResponse, DungeonEnterRequest, DungeonEnterResponse,
    DungeonMobKilledRequest, DungeonLootDropRequest, DungeonLootCollectedRequest,
    DungeonCorridorStateRequest, DungeonDeathRequest, DungeonDeathResponse,
    DungeonCompleteRequest,
)
from auth import hash_password, verify_password, create_token, decode_token

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Stellar Drift API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

bearer = HTTPBearer()


# ── Chat ─────────────────────────────────────────────────────────────

class ChatManager:
    def __init__(self):
        self.active: dict = {}

    async def connect(self, ws: WebSocket, uid: int, name: str, corp_ch: str, clan_ch):
        await ws.accept()
        self.active[ws] = {'uid': uid, 'name': name, 'corp_ch': corp_ch, 'clan_ch': clan_ch, 'sector': ''}

    def disconnect(self, ws: WebSocket):
        self.active.pop(ws, None)

    async def _send(self, ws: WebSocket, data: dict) -> bool:
        try:
            await ws.send_json(data)
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

    # ── босс убит → пропорциональное распределение золота ────────────
    def boss_died(self, player: str, base_gold: int) -> dict[str, int]:
        inst = self.get_instance(player)
        if not inst:
            return {player: base_gold}
        inst.boss_alive = False
        inst.locked = True
        pool = {n: (v['damage'] + v['heal']) for n, v in inst.members.items()}
        total = sum(pool.values())
        if total == 0:
            share = 1.0 / len(pool)
            pool = {n: share for n in pool}
        else:
            pool = {n: v / total for n, v in pool.items()}
        return {n: max(1, round(base_gold * r)) for n, r in pool.items()}

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
PVP_MAX_DAMAGE = 6000.0          # потолок урона одного попадания — выше топовых крит-роллов не бывает
# Крит для PvP-попаданий — сервер решает сам (та же логика, что и isCrit у клиента
# для боссов, см. BOSS.critChance в constants.js), а не по заявке клиента в
# pvp_fire_claim: если довериться client-claimed isCrit, игрок мог бы заявлять
# крит на каждый выстрел и получить свободный ×crit к разрешённому потолку урона.
PVP_CRIT_CHANCE = 0.15
PVP_CRIT_MULT   = 2.0           # базовый critMult без бордов на клиенте (Player.js: 2.0 без BF('critMult'))


class PvpPlayerState:
    def __init__(self, user_id: int, username: str, x: float, y: float, loadout: dict):
        self.user_id  = user_id
        self.username = username
        self.ship_key = str(loadout.get('shipKey', ''))[:40]  # только для рендера у др. клиентов, не участвует в валидации
        self.x = float(x)
        self.y = float(y)
        self.heading = 0.0
        self.hull        = float(loadout.get('hull', 1))
        self.max_hull    = max(1.0, float(loadout.get('maxHull', 1)))
        self.shield      = float(loadout.get('shield', 0))
        self.max_shield  = max(0.0, float(loadout.get('maxShield', 0)))
        # Потолки заявленного лоадаута — клиент репортит свои эффективные статы один
        # раз при входе, сервер их не пересчитывает (perks/skills/boards целиком на
        # клиенте), но зажимает в разумные границы для последующей валидации попаданий.
        self.loadout = {
            'dmg':         max(0.0, min(float(loadout.get('dmg', 0)), PVP_MAX_DAMAGE)),
            'range':       max(1.0, min(float(loadout.get('range', 800)), PVP_MAX_RANGE)),
            'cooldown':    max(PVP_FIRE_COOLDOWN_FLOOR, float(loadout.get('cooldown', 1.0))),
            'penetration': max(0.0, min(float(loadout.get('penetration', 0)), 0.6)),
            # Статическое уклонение (перки/скиллы/борды) — потолок 0.30, тот же, что и
            # у клиента (Player.js:this.evasion). Движение-based часть (до +0.12 от
            # скорости) не моделируем — сервер не знает скорость игрока, только позицию
            # раз в ~100мс, это отдельная неточность, принятая вместе с клиент-локальным
            # движением.
            'evasion':     max(0.0, min(float(loadout.get('evasion', 0)), 0.30)),
        }
        self.last_shot_at = 0.0
        # Кто наносил урон этой жизни игрока (uid → суммарный урон) — используется,
        # чтобы решить, кому будет виден лут-бокс после смерти (см. PvpLootBox). Сбрасывается
        # при килле в last_death_eligible.
        self.damage_by: dict[int, float] = {}
        self.last_death_eligible: list[int] = []

    def to_public(self) -> dict:
        return {
            'userId': self.user_id, 'name': self.username, 'shipKey': self.ship_key,
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


def _apply_pvp_damage(dmg_ceiling: float, penetration: float,
                       victim_hull: float, victim_shield: float,
                       victim_max_hull: float, victim_max_shield: float,
                       victim_evasion: float = 0.0) -> dict:
    """Мирроит shield/hull split из Player.takeDamage (client/src/entities/Player.js) —
    но крит, уклонение и итоговые числа решает сервер, а не заявка клиента (см.
    PVP_CRIT_CHANCE). Общий расчёт для игрок→игрок и игрок→моб — обе жертвы описываются
    просто парой hull/shield, дальше не важно, чьи они. victim_evasion=0 для мобов —
    их движение клиент-локальное, сервер не знает скорость, чтобы честно её учитывать."""
    if victim_evasion > 0 and random.random() < victim_evasion:
        return {'isCrit': False, 'dmg': 0, 'killed': False, 'dodged': True,
                'hull': victim_hull, 'shield': victim_shield}

    is_crit = random.random() < PVP_CRIT_CHANCE
    amount = dmg_ceiling * (PVP_CRIT_MULT if is_crit else 1.0)

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


def _resolve_pvp_hit(attacker: PvpPlayerState, victim: PvpPlayerState) -> dict:
    r = _apply_pvp_damage(attacker.loadout['dmg'], attacker.loadout['penetration'],
                           victim.hull, victim.shield, victim.max_hull, victim.max_shield,
                           victim.loadout['evasion'])
    victim.hull, victim.shield = r['hull'], r['shield']
    if not r['dodged'] and r['dmg'] > 0:
        victim.damage_by[attacker.user_id] = victim.damage_by.get(attacker.user_id, 0.0) + r['dmg']
    if r['killed']:
        # Снапшот "кто бил эту жизнь" для лут-бокса (см. pvp_loot_spawn) — победитель
        # и все, кто помогал, увидят коробку; сам victim — нет.
        victim.last_death_eligible = list(victim.damage_by.keys())
        victim.damage_by = {}
    return {**r, 'maxHull': victim.max_hull, 'maxShield': victim.max_shield}


# ── Friends helpers ───────────────────────────────────────────────────

def _online_names() -> set[str]:
    return {m['name'] for m in chat_manager.active.values()}


def _online_sectors() -> dict[str, str]:
    return {m['name']: m.get('sector', '') for m in chat_manager.active.values()}


def _get_friend_list(username: str, db: Session) -> list[dict]:
    online   = _online_names()
    sectors  = _online_sectors()
    rows = db.query(Friendship).filter(
        or_(Friendship.user_a == username, Friendship.user_b == username)
    ).all()
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


def _player_channels(user_id: int, db: Session):
    ps = db.query(PlayerState).filter(PlayerState.user_id == user_id).first()
    state = (ps.state or {}) if ps else {}
    corp = state.get('playerCorp') or 'helios'
    corp_ch = f'corp_{corp}' if corp != 'neutral' else 'corp_helios'
    clan_tag = state.get('clanTag')
    clan_ch = f'clan_{clan_tag}' if clan_tag else None
    return corp_ch, clan_ch


def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    user_id = decode_token(creds.credentials)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


# ── Auth ─────────────────────────────────────────────────────────────

@app.post("/auth/register", response_model=TokenResponse)
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == body.username).first():
        raise HTTPException(status_code=400, detail="Username already taken")
    user = User(username=body.username, password_hash=hash_password(body.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return TokenResponse(access_token=create_token(user.id), username=user.username)


@app.post("/auth/login", response_model=TokenResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == body.username).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    return TokenResponse(access_token=create_token(user.id), username=user.username)


@app.get("/auth/me", response_model=UserResponse)
def me(user: User = Depends(get_current_user)):
    return UserResponse(id=user.id, username=user.username)


# ── Player state ──────────────────────────────────────────────────────

@app.get("/player/state", response_model=PlayerStateResponse)
def get_state(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ps = db.query(PlayerState).filter(PlayerState.user_id == user.id).first()
    return PlayerStateResponse(
        state=ps.state if ps else {},
        updated_at=ps.updated_at if ps else None,
    )


@app.put("/player/state")
def save_state(
    body: dict,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ps = db.query(PlayerState).filter(PlayerState.user_id == user.id).first()
    if ps:
        ps.state = body
    else:
        ps = PlayerState(user_id=user.id, state=body)
        db.add(ps)
    db.commit()
    return {"ok": True}


# ── Audit log ─────────────────────────────────────────────────────────

@app.get("/audit", response_model=list[AuditEntryResponse])
def get_audit(
    limit: int = 200,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(AuditLog)
        .order_by(AuditLog.ts.desc())
        .limit(max(1, min(limit, 500)))
        .all()
    )
    result = []
    for row in rows:
        u = db.get(User, row.user_id) if row.user_id else None
        result.append(AuditEntryResponse(
            id=row.id, action=row.action, params=row.params,
            sector=row.sector, ts=row.ts,
            username=u.username if u else None,
        ))
    return result


@app.post("/audit")
def add_audit(
    body: AuditEntryCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    entry = AuditLog(user_id=user.id, action=body.action, params=body.params, sector=body.sector)
    db.add(entry)
    db.commit()
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


def _get_or_create_lives(db: Session, user_id: int, dungeon_key: str, day_key: str) -> DungeonLives:
    row = db.query(DungeonLives).filter(
        DungeonLives.user_id == user_id,
        DungeonLives.dungeon_key == dungeon_key,
        DungeonLives.day_key == day_key,
    ).first()
    if not row:
        row = DungeonLives(user_id=user_id, dungeon_key=dungeon_key, day_key=day_key, lives_used=0, locked_out=0)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


@app.get("/dungeon/status", response_model=DungeonStatusResponse)
def dungeon_status(
    key: str,
    dayKey: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    lives = _get_or_create_lives(db, user.id, key, dayKey)
    remaining = max(0, DUNGEON_LIVES_MAX - lives.lives_used)
    locked = bool(lives.locked_out)
    reason = "Данж уже пройден сегодня или жизни исчерпаны — доступ откроется в 01:00." if locked else None
    return DungeonStatusResponse(
        canEnter=not locked, livesUsed=lives.lives_used,
        livesRemaining=remaining, lockedOut=locked, reason=reason,
    )


@app.post("/dungeon/enter", response_model=DungeonEnterResponse)
def dungeon_enter(
    body: DungeonEnterRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    lives = _get_or_create_lives(db, user.id, body.key, body.dayKey)
    if lives.locked_out:
        return DungeonEnterResponse(ok=False, reason="Данж уже пройден сегодня или жизни исчерпаны.")

    # Ключ инстанса НЕ включает сложность: один выделенный инстанс на
    # (данж, сутки, соло-юзер/группа) — сложность фиксируется первым входом
    # и возвращается клиенту, чтобы модалка выбора не создавала второй инстанс.
    run = db.query(DungeonRun).filter(
        DungeonRun.dungeon_key == body.key,
        DungeonRun.day_key == body.dayKey,
        DungeonRun.owner_kind == body.ownerKind,
        DungeonRun.owner_key == body.ownerKey,
    ).first()
    if not run:
        run = DungeonRun(
            dungeon_key=body.key, difficulty=body.difficulty, day_key=body.dayKey,
            owner_kind=body.ownerKind, owner_key=body.ownerKey,
            variant_index=body.variantIndex, killed_mob_ids=[], floor_loot=[],
            corridor_state=None, boss_alive=1, completed=0,
        )
        db.add(run)
        db.commit()
        db.refresh(run)

    remaining = max(0, DUNGEON_LIVES_MAX - lives.lives_used)
    return DungeonEnterResponse(
        ok=True, runId=run.id, difficulty=run.difficulty, variantIndex=run.variant_index,
        killedMobIds=run.killed_mob_ids or [], floorLoot=run.floor_loot or [],
        corridorState=run.corridor_state, bossAlive=bool(run.boss_alive),
        completed=bool(run.completed), livesUsed=lives.lives_used, livesRemaining=remaining,
    )


@app.post("/dungeon/mob_killed")
def dungeon_mob_killed(
    body: DungeonMobKilledRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    run = db.get(DungeonRun, body.runId)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    ids = list(run.killed_mob_ids or [])
    if body.mobId not in ids:
        ids.append(body.mobId)
        run.killed_mob_ids = ids
        db.commit()
    return {"ok": True}


@app.post("/dungeon/loot_drop")
def dungeon_loot_drop(
    body: DungeonLootDropRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    run = db.get(DungeonRun, body.runId)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    loot = list(run.floor_loot or [])
    loot.append(body.loot)
    run.floor_loot = loot
    db.commit()
    return {"ok": True}


@app.post("/dungeon/loot_collected")
def dungeon_loot_collected(
    body: DungeonLootCollectedRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    run = db.get(DungeonRun, body.runId)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    run.floor_loot = [l for l in (run.floor_loot or []) if l.get('id') != body.lootId]
    db.commit()
    return {"ok": True}


@app.post("/dungeon/corridor_state")
def dungeon_corridor_state(
    body: DungeonCorridorStateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    run = db.get(DungeonRun, body.runId)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    run.corridor_state = body.state
    db.commit()
    return {"ok": True}


@app.post("/dungeon/death", response_model=DungeonDeathResponse)
def dungeon_death(
    body: DungeonDeathRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    lives = _get_or_create_lives(db, user.id, body.key, body.dayKey)
    # Аргус (админский слив) репортится с другим key, не относящимся к данжам —
    # клиент просто не вызывает этот эндпоинт для смертей вне sec.isDungeon.
    if not lives.locked_out:
        lives.lives_used = min(DUNGEON_LIVES_MAX, lives.lives_used + 1)
        if lives.lives_used >= DUNGEON_LIVES_MAX:
            lives.locked_out = 1
        db.commit()
    remaining = max(0, DUNGEON_LIVES_MAX - lives.lives_used)
    return DungeonDeathResponse(
        livesUsed=lives.lives_used, livesRemaining=remaining, lockedOut=bool(lives.locked_out),
    )


@app.post("/dungeon/complete")
def dungeon_complete(
    body: DungeonCompleteRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    run = db.get(DungeonRun, body.runId)
    if run:
        run.completed = 1
        run.boss_alive = 0
        db.commit()
    # Прохождение засчитывается всем участникам группы (или только себе, соло) —
    # суточная попытка расходуется за коллективный клир, не только у того,
    # чей клиент отправил событие.
    names = set(body.memberUsernames) | {user.username}
    for name in names:
        member = db.query(User).filter(User.username == name).first()
        if not member:
            continue
        lives = _get_or_create_lives(db, member.id, body.key, body.dayKey)
        lives.locked_out = 1
        db.commit()
    return {"ok": True}


# ── Chat REST ─────────────────────────────────────────────────────────

@app.get("/chat/history")
def chat_history(
    channel: str = Query('general'),
    limit: int = Query(50),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    corp_ch, clan_ch = _player_channels(current_user.id, db)
    db_ch = _to_db_ch(channel, corp_ch, clan_ch)
    msgs = (
        db.query(ChatMessage)
        .filter(ChatMessage.channel == db_ch)
        .order_by(ChatMessage.ts.desc())
        .limit(max(1, min(limit, 200)))
        .all()
    )
    return [{'from': m.username, 'text': m.text, 'time': _fmt_time(m.ts)} for m in reversed(msgs)]


# ── Chat WebSocket ────────────────────────────────────────────────────

@app.websocket("/ws/chat")
async def chat_ws(
    ws: WebSocket,
    token: str = Query(...),
    db: Session = Depends(get_db),
):
    user_id = decode_token(token)
    if not user_id:
        await ws.close(code=4001)
        return
    user = db.get(User, user_id)
    if not user:
        await ws.close(code=4001)
        return

    corp_ch, clan_ch = _player_channels(user.id, db)
    await chat_manager.connect(ws, user.id, user.username, corp_ch, clan_ch)

    # Клиент не знает свой числовой user.id (в токене/логине только username) — а он
    # нужен, чтобы сверять msg.targetUserId в pvp_hit_result с "это я" на своей стороне.
    await ws.send_json({'type': 'session_info', 'userId': user.id})

    # Send history for each reachable channel
    history_pairs = [('general', 'general'), (corp_ch, 'corp')]
    if clan_ch:
        history_pairs.append((clan_ch, 'clan'))

    for db_ch, fe_ch in history_pairs:
        msgs = (
            db.query(ChatMessage)
            .filter(ChatMessage.channel == db_ch)
            .order_by(ChatMessage.ts.desc())
            .limit(50)
            .all()
        )
        await ws.send_json({
            'type': 'history',
            'channel': fe_ch,
            'messages': [{'from': m.username, 'text': m.text, 'time': _fmt_time(m.ts)} for m in reversed(msgs)],
        })

    # Send friend list on connect; notify online friends that this user came online
    friend_list = _get_friend_list(user.username, db)
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
                db.add(ChatMessage(channel=db_ch, user_id=user.id, username=user.username, text=text, ts=ts))
                db.commit()
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

            # ── Группа: босс убит → распределить золото ───────────────
            elif msg_type == 'group_boss_dead':
                base_gold = int(data.get('baseGold', 0))
                rewards   = group_manager.boss_died(user.username, base_gold)
                # Отправить каждому его долю + уведомить о смерти босса
                for name, gold in rewards.items():
                    if name == user.username:
                        await ws.send_json({'type': 'group_gold_reward', 'gold': gold})
                    else:
                        await chat_manager.send_pm(name, {'type': 'group_gold_reward', 'gold': gold})
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
                fl = _get_friend_list(user.username, db)
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
                attacker = pvp_room_manager.get(sector, user.id)
                victim = pvp_room_manager.get(sector, int(target_id))
                if not attacker or not victim or victim.user_id == attacker.user_id:
                    continue
                now_ts = time.time()
                if now_ts - attacker.last_shot_at < attacker.loadout['cooldown']:
                    continue  # чаще заявленного КД — молча игнорируем (см. план: без ложных банов)
                dist = math.hypot(victim.x - attacker.x, victim.y - attacker.y)
                if dist > attacker.loadout['range']:
                    continue  # вне заявленной дальности — молча игнорируем
                attacker.last_shot_at = now_ts

                result = _resolve_pvp_hit(attacker, victim)
                out = {
                    'type': 'pvp_hit_result',
                    'attackerUserId': attacker.user_id, 'targetUserId': victim.user_id,
                    'weaponType': str(data.get('weaponType', 'cannon'))[:20],
                    **result,
                }
                room_uids = [attacker.user_id] + [p.user_id for p in pvp_room_manager.others(sector, attacker.user_id)]
                await chat_manager.broadcast_to_uids(room_uids, out)

                if result['killed']:
                    db.add(AuditLog(user_id=victim.user_id, action='pvp_kill', params={
                        'killer': attacker.username, 'victim': victim.username, 'sector': sector,
                    }, sector=sector))
                    db.commit()

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
                max_hull = max(1.0, float(data.get('maxHull', 1)))
                max_shield = max(0.0, float(data.get('maxShield', 0)))
                mob_state = pvp_room_manager.get_or_create_mob(sector, mob_id, max_hull, max_shield)
                result = _apply_pvp_damage(
                    attacker.loadout['dmg'], attacker.loadout['penetration'],
                    mob_state.hull, mob_state.shield, mob_state.max_hull, mob_state.max_shield,
                )
                mob_state.hull, mob_state.shield = result['hull'], result['shield']
                if result['killed']:
                    pvp_room_manager.remove_mob(sector, mob_id)  # следующий, кто попадёт — лениво пересоздаст запись

                out = {
                    'type': 'pvp_mob_hit_result', 'mobId': mob_id, 'attackerUserId': attacker.user_id,
                    'weaponType': str(data.get('weaponType', 'cannon'))[:20],
                    'maxHull': mob_state.max_hull, 'maxShield': mob_state.max_shield,
                    **result,
                }
                room_uids = [attacker.user_id] + [p.user_id for p in pvp_room_manager.others(sector, attacker.user_id)]
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
                    target = db.query(User).filter(User.username == to_name).first()
                    if not target:
                        await ws.send_json({'type': 'friend_error', 'text': f'Игрок {to_name} не найден'})
                    else:
                        existing = db.query(Friendship).filter(
                            or_(
                                and_(Friendship.user_a == user.username, Friendship.user_b == to_name),
                                and_(Friendship.user_a == to_name,       Friendship.user_b == user.username),
                            )
                        ).first()
                        if existing:
                            if existing.status == 'accepted':
                                await ws.send_json({'type': 'friend_error', 'text': f'{to_name} уже в списке друзей'})
                            elif existing.user_a == user.username:
                                await ws.send_json({'type': 'friend_error', 'text': 'Запрос уже отправлен'})
                            else:
                                # They sent request first → auto-accept
                                existing.status = 'accepted'
                                db.commit()
                                fl = _get_friend_list(user.username, db)
                                await ws.send_json({'type': 'friend_list', 'friends': fl})
                                if to_name in _online_names():
                                    fl2 = _get_friend_list(to_name, db)
                                    await chat_manager.send_pm(to_name, {'type': 'friend_list', 'friends': fl2})
                        else:
                            db.add(Friendship(user_a=user.username, user_b=to_name, status='pending'))
                            db.commit()
                            fl = _get_friend_list(user.username, db)
                            await ws.send_json({'type': 'friend_list', 'friends': fl})
                            if to_name in _online_names():
                                await chat_manager.send_pm(to_name, {
                                    'type': 'friend_request_in', 'from': user.username,
                                })

            # ── Друзья: принять запрос ────────────────────────────────
            elif msg_type == 'friend_accept':
                from_name = str(data.get('from', '')).strip()
                if from_name:
                    row = db.query(Friendship).filter(
                        Friendship.user_a == from_name,
                        Friendship.user_b == user.username,
                        Friendship.status == 'pending',
                    ).first()
                    if row:
                        row.status = 'accepted'
                        db.commit()
                        fl = _get_friend_list(user.username, db)
                        await ws.send_json({'type': 'friend_list', 'friends': fl})
                        if from_name in _online_names():
                            fl2 = _get_friend_list(from_name, db)
                            await chat_manager.send_pm(from_name, {'type': 'friend_list', 'friends': fl2})

            # ── Друзья: отклонить запрос ──────────────────────────────
            elif msg_type == 'friend_decline':
                from_name = str(data.get('from', '')).strip()
                if from_name:
                    db.query(Friendship).filter(
                        Friendship.user_a == from_name,
                        Friendship.user_b == user.username,
                    ).delete()
                    db.commit()
                    fl = _get_friend_list(user.username, db)
                    await ws.send_json({'type': 'friend_list', 'friends': fl})

            # ── Друзья: удалить из списка ─────────────────────────────
            elif msg_type == 'friend_remove':
                name = str(data.get('name', '')).strip()
                if name:
                    db.query(Friendship).filter(
                        or_(
                            and_(Friendship.user_a == user.username, Friendship.user_b == name),
                            and_(Friendship.user_a == name,          Friendship.user_b == user.username),
                        )
                    ).delete()
                    db.commit()
                    fl = _get_friend_list(user.username, db)
                    await ws.send_json({'type': 'friend_list', 'friends': fl})

    except WebSocketDisconnect:
        # Notify online friends that this user went offline
        try:
            fl = _get_friend_list(user.username, db)
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
