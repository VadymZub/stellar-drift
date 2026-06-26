import time

from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from database import engine, get_db, Base
from models import User, PlayerState, AuditLog, ChatMessage
from schemas import (
    RegisterRequest, LoginRequest, TokenResponse, UserResponse,
    PlayerStateResponse, AuditEntryCreate, AuditEntryResponse,
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
        self.active[ws] = {'uid': uid, 'name': name, 'corp_ch': corp_ch, 'clan_ch': clan_ch}

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

    except WebSocketDisconnect:
        group_manager.leave(user.username)
        chat_manager.disconnect(ws)
