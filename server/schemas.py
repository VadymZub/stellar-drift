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
