from pydantic import BaseModel, EmailStr, field_validator
from typing import Any, Optional
from datetime import datetime


def validate_username_format(v: str) -> str:
    # Общее правило формата ника — используется и при регистрации, и при смене ника
    # (см. ChangeUsernameRequest), чтобы правила не могли разойтись между ними.
    v = v.strip()
    if len(v) < 3 or len(v) > 50:
        raise ValueError("Username must be 3–50 characters")
    if not v.replace("_", "").replace("-", "").isalnum():
        raise ValueError("Username: only letters, digits, _ and -")
    return v


class RegisterRequest(BaseModel):
    username: str
    email: EmailStr
    password: str

    @field_validator("username")
    @classmethod
    def username_valid(cls, v: str) -> str:
        return validate_username_format(v)

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
    email_verified: bool = True  # False только если у аккаунта есть email и он не подтверждён


class UserResponse(BaseModel):
    id: int
    username: str
    email: Optional[str] = None
    email_verified: bool = True


class VerifyEmailRequest(BaseModel):
    code: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def new_password_valid(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError("Password must be at least 6 characters")
        return v


class ChangeEmailRequest(BaseModel):
    current_password: str
    new_email: EmailStr


class ChangeUsernameRequest(BaseModel):
    new_username: str

    @field_validator("new_username")
    @classmethod
    def new_username_valid(cls, v: str) -> str:
        return validate_username_format(v)


class PlayerStateResponse(BaseModel):
    state: dict[str, Any]
    updated_at: Optional[datetime] = None


class SocialLinks(BaseModel):
    discord:  Optional[str] = None
    telegram: Optional[str] = None
    steam:    Optional[str] = None
    other:    Optional[str] = None


class ProfileUpdateRequest(BaseModel):
    display_name: Optional[str] = None
    country: Optional[str] = None
    city: Optional[str] = None
    goal: Optional[str] = None
    favorite_games: Optional[str] = None
    social_links: Optional[SocialLinks] = None
    favorite_ship_key: Optional[str] = None   # явный null от клиента = "снять ручной выбор, вернуться к авто"
    favorite_ship_auto: Optional[str] = None  # клиентская авто-подсказка (см. shipPlayTimeSec в GameScene)
    privacy: Optional[str] = None

    @field_validator("country")
    @classmethod
    def country_valid(cls, v):
        if v is None:
            return v
        v = v.strip().upper()
        if len(v) != 2 or not v.isalpha():
            raise ValueError("Country must be a 2-letter ISO code")
        return v

    @field_validator("privacy")
    @classmethod
    def privacy_valid(cls, v):
        if v is not None and v not in ("everyone", "friends", "nobody"):
            raise ValueError("privacy must be one of: everyone, friends, nobody")
        return v

    @field_validator("goal", "favorite_games")
    @classmethod
    def text_len(cls, v):
        if v is not None and len(v) > 300:
            raise ValueError("Must be at most 300 characters")
        return v


class ProfileSelfResponse(BaseModel):
    username: str
    display_name: Optional[str] = None
    country: Optional[str] = None
    city: Optional[str] = None
    goal: Optional[str] = None
    favorite_games: Optional[str] = None
    social_links: dict = {}
    favorite_ship_key: Optional[str] = None       # эффективный (ручной, если задан, иначе авто)
    favorite_ship_is_manual: bool = False
    privacy: str = "everyone"
    updated_at: Optional[datetime] = None
    pvp_wins: int = 0


class PmMessageResponse(BaseModel):
    id: int
    from_username: str
    to_username: str
    text: str
    ts: float
    read_at: Optional[datetime] = None


class PmHistoryResponse(BaseModel):
    messages: list[PmMessageResponse] = []
    unread_count: int = 0


class PmMarkReadRequest(BaseModel):
    message_ids: list[int]


class PmUnreadSummaryResponse(BaseModel):
    by_user: dict[str, int] = {}
    total: int = 0


class PmThreadResponse(BaseModel):
    username: str
    last_text: str
    last_ts: float
    unread_count: int = 0


class PmThreadsResponse(BaseModel):
    threads: list[PmThreadResponse] = []


class BlacklistAddRequest(BaseModel):
    username: str


class BlacklistEntryResponse(BaseModel):
    username: str
    created_at: datetime


class BlacklistListResponse(BaseModel):
    blocked: list[BlacklistEntryResponse] = []


class ProfilePublicResponse(BaseModel):
    username: str
    display_name: Optional[str] = None
    country: Optional[str] = None
    city: Optional[str] = None
    goal: Optional[str] = None
    favorite_games: Optional[str] = None
    social_links: dict = {}
    favorite_ship_key: Optional[str] = None
    level: Optional[int] = None
    xp: Optional[float] = None
    honor: Optional[int] = None
    corp: Optional[str] = None
    pvp_wins: int = 0
    playtime_hours: Optional[float] = None
    clan_name: Optional[str] = None
    clan_tag: Optional[str] = None


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


class MiningBaseSaveRequest(BaseModel):
    baseId: str
    sector: str
    state: dict[str, Any]


class MiningBaseSectorResponse(BaseModel):
    bases: dict[str, dict[str, Any]] = {}
