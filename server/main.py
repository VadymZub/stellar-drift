from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from database import engine, get_db, Base
from models import User, PlayerState, AuditLog
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
