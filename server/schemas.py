from pydantic import BaseModel, field_validator
from typing import Any, Optional
from datetime import datetime


class RegisterRequest(BaseModel):
    username: str
    password: str

    @field_validator("username")
    @classmethod
    def username_valid(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 3 or len(v) > 50:
            raise ValueError("Username must be 3–50 characters")
        if not v.replace("_", "").replace("-", "").isalnum():
            raise ValueError("Username: only letters, digits, _ and -")
        return v

    @field_validator("password")
    @classmethod
    def password_valid(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError("Password must be at least 6 characters")
        return v


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    username: str


class UserResponse(BaseModel):
    id: int
    username: str


class PlayerStateResponse(BaseModel):
    state: dict[str, Any]
    updated_at: Optional[datetime] = None


class AuditEntryCreate(BaseModel):
    action: str
    params: Optional[dict[str, Any]] = None
    sector: Optional[str] = None


class AuditEntryResponse(BaseModel):
    id: int
    action: str
    params: Optional[dict[str, Any]]
    sector: Optional[str]
    ts: datetime
    username: Optional[str] = None

    model_config = {"from_attributes": True}


# ── Данж-инстансы ────────────────────────────────────────────────────────

class DungeonStatusResponse(BaseModel):
    canEnter: bool
    livesUsed: int
    livesRemaining: int
    lockedOut: bool
    reason: Optional[str] = None


class DungeonEnterRequest(BaseModel):
    key: str
    difficulty: str = "normal"
    dayKey: str
    ownerKind: str          # 'solo' | 'group'
    ownerKey: str           # 'user:<id>' | groupInstanceId
    variantIndex: int = 0


class DungeonEnterResponse(BaseModel):
    ok: bool
    reason: Optional[str] = None
    runId: Optional[int] = None
    difficulty: str = "normal"
    variantIndex: int = 0
    killedMobIds: list[str] = []
    floorLoot: list[dict[str, Any]] = []
    corridorState: Optional[dict[str, Any]] = None
    bossAlive: bool = True
    completed: bool = False
    livesUsed: int = 0
    livesRemaining: int = 7


class DungeonMobKilledRequest(BaseModel):
    runId: int
    mobId: str


class DungeonLootDropRequest(BaseModel):
    runId: int
    loot: dict[str, Any]     # {id, x, y, item}


class DungeonLootCollectedRequest(BaseModel):
    runId: int
    lootId: str


class DungeonCorridorStateRequest(BaseModel):
    runId: int
    state: dict[str, Any]


class DungeonDeathRequest(BaseModel):
    key: str
    dayKey: str


class DungeonDeathResponse(BaseModel):
    livesUsed: int
    livesRemaining: int
    lockedOut: bool


class DungeonCompleteRequest(BaseModel):
    runId: int
    key: str
    dayKey: str
    memberUsernames: list[str] = []
