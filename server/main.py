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

    except WebSocketDisconnect:
        chat_manager.disconnect(ws)
