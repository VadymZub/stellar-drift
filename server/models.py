from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, JSON, DateTime, ForeignKey, UniqueConstraint, func
from database import Base


class User(Base):
    __tablename__ = "users"

    id           = Column(Integer, primary_key=True, index=True)
    username     = Column(String(50), unique=True, nullable=False, index=True)
    email        = Column(String(255), unique=True, nullable=True, index=True)
    email_verified = Column(Integer, nullable=False, default=0)  # bool as int (SQLite-friendly, см. DungeonRun.boss_alive)
    password_hash = Column(String(200), nullable=False)
    created_at   = Column(DateTime, default=datetime.utcnow)
    username_changed_at = Column(DateTime, nullable=True)  # для суточного кулдауна смены ника


class EmailVerificationToken(Base):
    # Один активный код на пользователя — при выпуске нового старый удаляется (см.
    # _issue_verification_code), а не помечается использованным: код одноразовый по
    # факту (email/password изменились или верификация прошла), лишнее поле не нужно.
    __tablename__ = "email_verification_tokens"

    id         = Column(Integer, primary_key=True)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    code       = Column(String(6), nullable=False)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class PlayerState(Base):
    __tablename__ = "player_state"

    id         = Column(Integer, primary_key=True)
    user_id    = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    state      = Column(JSON, nullable=False, default=dict)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class PlayerProfile(Base):
    # Публичная анкета игрока — отдельная таблица (не часть PlayerState.state), т.к.
    # это поля с явным белым списком для показа чужому игроку (см. GET /player/profile/{username}),
    # а PlayerState.state — непрозрачный клиент-доверенный блоб прогресса, который наружу
    # целиком отдавать нельзя. FK на users.id (как PlayerState), а не username-строкой
    # (как Friendship) — это данные одного владельца, а не связь между двумя игроками.
    __tablename__ = "player_profiles"

    id           = Column(Integer, primary_key=True)
    user_id      = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False, index=True)
    display_name = Column(String(50), nullable=True)
    country      = Column(String(2), nullable=True)
    city         = Column(String(80), nullable=True)
    goal         = Column(String(300), nullable=True)
    favorite_games = Column(String(300), nullable=True)
    social_links = Column(JSON, nullable=False, default=dict)
    favorite_ship_key      = Column(String(30), nullable=True)   # ручной выбор игрока
    favorite_ship_auto     = Column(String(30), nullable=True)   # авто-подсказка (клиент считает по shipPlayTimeSec)
    favorite_ship_is_manual = Column(Integer, nullable=False, default=0)  # bool as int (SQLite-friendly)
    privacy      = Column(String(10), nullable=False, default='everyone')  # 'everyone' | 'friends' | 'nobody'
    updated_at   = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


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


class PrivateMessage(Base):
    # FK-by-id (как ChatMessage), а не username-строкой (как Friendship/Blacklist) — это
    # лог сообщений с эффективными запросами "моя переписка с X", а не разовая проверка
    # отношения между парой ников. from_username/to_username денормализованы (та же
    # причина, что ChatMessage.username) — рендер истории без join.
    __tablename__ = "private_messages"

    id            = Column(Integer, primary_key=True)
    from_user_id  = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    from_username = Column(String(50), nullable=False)
    to_user_id    = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    to_username   = Column(String(50), nullable=False)
    text          = Column(String(500), nullable=False)
    ts            = Column(Float, nullable=False)
    read_at       = Column(DateTime, nullable=True)


class Blacklist(Base):
    # Направленная связь между двумя игроками (как Friendship) — username-строкой, а не
    # user_id FK, т.к. проверяется в тех же местах, что и Friendship (WS-пейлоады несут
    # только ники, не id). Блокировка однонаправленна и НЕ уведомляет заблокированного
    # (в отличие от друзей) — поэтому нет WS-сообщений, только REST CRUD (см. main.py).
    __tablename__ = "blacklist"

    id         = Column(Integer, primary_key=True)
    blocker    = Column(String(50), nullable=False, index=True)
    blocked    = Column(String(50), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint('blocker', 'blocked', name='uq_blacklist_pair'),)


# ── Данж-инстансы ────────────────────────────────────────────────────────
# Клиент-доверенная модель (как и весь остальной прогресс игрока в этом
# проекте — см. PlayerState.state): сервер хранит то, что репортит клиент,
# без независимой валидации симуляции. day_key вычисляется клиентом по той
# же границе 01:00 по местному времени, что и остальные суточные сбросы
# (missionDailyReset/plasmateDayReset), и передаётся явным параметром —
# сервер не завязан на часовой пояс клиента.

class DungeonRun(Base):
    __tablename__ = "dungeon_runs"

    id             = Column(Integer, primary_key=True)
    dungeon_key    = Column(String(30), nullable=False, index=True)   # 'dungeon_1'..'dungeon_5','dungeon_prem','R-1-boss'
    difficulty     = Column(String(10), nullable=False, default='normal')
    day_key        = Column(String(10), nullable=False, index=True)   # 'YYYY-MM-DD' (локальная дата клиента)
    owner_kind     = Column(String(10), nullable=False)                # 'solo' | 'group'
    owner_key      = Column(String(80), nullable=False, index=True)    # 'user:<id>' (solo) | groupInstanceId (group)
    variant_index  = Column(Integer, nullable=False, default=0)
    killed_mob_ids = Column(JSON, nullable=False, default=list)
    floor_loot     = Column(JSON, nullable=False, default=list)        # [{id,x,y,item}]
    corridor_state = Column(JSON, nullable=True)                       # R-1-boss: {clearedCorridors:[...], bossArenaOpen:bool}
    boss_alive     = Column(Integer, nullable=False, default=1)        # bool as int (SQLite-friendly)
    completed      = Column(Integer, nullable=False, default=0)
    created_at     = Column(DateTime, default=datetime.utcnow)
    updated_at     = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class DungeonLives(Base):
    __tablename__ = "dungeon_lives"

    id          = Column(Integer, primary_key=True)
    user_id     = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    dungeon_key = Column(String(30), nullable=False, index=True)
    day_key     = Column(String(10), nullable=False, index=True)
    lives_used  = Column(Integer, nullable=False, default=0)   # 0..7
    locked_out  = Column(Integer, nullable=False, default=0)   # bool as int — 7 жизней исчерпаны ИЛИ данж уже пройден сегодня
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ArenaDaily(Base):
    # Дневной счётчик награждённых арен — авторитетен на сервере (в отличие от чисто
    # клиентских суточных лимитов типа PLASMATE_DAILY_MAX), т.к. исход матча (win/draw/
    # void) сервер знает сам (он вёл матч), и лимит легко обойти при клиентском счётчике.
    # Один общий счётчик на все 4 варианта арены (флаг/точки/груз/дуэль) — см.
    # /arena/match-complete. day_key — как у DungeonLives (локальная дата клиента).
    __tablename__ = "arena_daily"

    id             = Column(Integer, primary_key=True)
    user_id        = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    day_key        = Column(String(10), nullable=False, index=True)
    rewarded_count = Column(Integer, nullable=False, default=0)   # 0..ARENA_DAILY_CAP
    updated_at     = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class MiningBaseState(Base):
    # Общий (не привязанный к юзеру) объект — база живёт в мире и её владеют/атакуют
    # разные игроки. Один JSON-блоб = ровно то, что клиент строит в
    # MiningBase._persist() (client/src/entities/MiningBase.js), сервер не разбирает
    # структуру, только хранит/отдаёт как есть (тот же подход, что PlayerState.state).
    __tablename__ = "mining_base_state"

    id         = Column(Integer, primary_key=True)
    base_id    = Column(String(80), unique=True, nullable=False, index=True)  # '<sector>_base_<idx>'
    sector     = Column(String(50), nullable=False, index=True)
    state      = Column(JSON, nullable=False, default=dict)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
