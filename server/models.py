from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, JSON, DateTime, ForeignKey, func
from database import Base


class User(Base):
    __tablename__ = "users"

    id           = Column(Integer, primary_key=True, index=True)
    username     = Column(String(50), unique=True, nullable=False, index=True)
    password_hash = Column(String(200), nullable=False)
    created_at   = Column(DateTime, default=datetime.utcnow)


class PlayerState(Base):
    __tablename__ = "player_state"

    id         = Column(Integer, primary_key=True)
    user_id    = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    state      = Column(JSON, nullable=False, default=dict)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id      = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    action  = Column(String(100), nullable=False)
    params  = Column(JSON, nullable=True)
    sector  = Column(String(50), nullable=True)
    ts      = Column(DateTime, default=datetime.utcnow)


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id       = Column(Integer, primary_key=True)
    channel  = Column(String(50), nullable=False, index=True)
    user_id  = Column(Integer, ForeignKey("users.id"), nullable=False)
    username = Column(String(50), nullable=False)
    text     = Column(String(500), nullable=False)
    ts       = Column(Float, nullable=False)


class Friendship(Base):
    __tablename__ = "friendships"

    id         = Column(Integer, primary_key=True)
    user_a     = Column(String(50), nullable=False, index=True)   # who sent the request
    user_b     = Column(String(50), nullable=False, index=True)   # recipient
    status     = Column(String(10), nullable=False, default='pending')  # 'pending' | 'accepted'
    created_at = Column(DateTime, default=datetime.utcnow)
