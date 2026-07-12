import os
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

# SQLite (через aiosqlite — синхронный sqlite3-драйвер блокировал бы event loop на
# каждый запрос, см. диалог про зависание /ws/chat под нагрузкой) по умолчанию.
# Для PostgreSQL: DATABASE_URL=postgresql+asyncpg://user:pass@host/stellar_drift
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./stellar_drift.db")
_is_sqlite = DATABASE_URL.startswith("sqlite")

# WAL: без него дефолтный rollback-journal сериализует ЛЮБОЙ writer против ВСЕХ
# readers на файле — под 100 параллельных /ws/chat это душило хендшейки задолго
# до исчерпания пула соединений. NullPool — пул соединений не даёт SQLite ничего
# (файл один), только держит лишние открытые дескрипторы/потоки aiosqlite.
_engine_kwargs = {"poolclass": NullPool} if _is_sqlite else {}
engine = create_async_engine(DATABASE_URL, **_engine_kwargs)


if _is_sqlite:
    @event.listens_for(engine.sync_engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _record):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.execute("PRAGMA busy_timeout=10000")
        cur.close()

SessionLocal = async_sessionmaker(autocommit=False, autoflush=False, bind=engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with SessionLocal() as db:
        yield db
