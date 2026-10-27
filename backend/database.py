import os
from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base, sessionmaker

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{os.path.join(BASE_DIR, 'skill_exchange.db')}")

connect_args = {"check_same_thread": False} if SQLALCHEMY_DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args=connect_args)

if SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _enable_foreign_keys(dbapi_connection, _record):
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# Columns added after the first release. create_all() only creates missing tables,
# so existing SQLite databases get these columns added in place.
_ADDED_COLUMNS = {
    "users": {"account_type": "VARCHAR NOT NULL DEFAULT 'STUDENT'"},
    "notifications": {"course_id": "INTEGER REFERENCES courses(id)"},
    "sessions": {
        "learner_confirmed_at": "DATETIME",
        "mentor_confirmed_at": "DATETIME",
        "cancelled_by": "INTEGER REFERENCES users(id)",
        "cancelled_at": "DATETIME",
        "no_show_user_id": "INTEGER REFERENCES users(id)",
    },
}


def migrate():
    from sqlalchemy import inspect, text
    insp = inspect(engine)
    with engine.begin() as conn:
        for table, cols in _ADDED_COLUMNS.items():
            if not insp.has_table(table):
                continue
            existing = {c["name"] for c in insp.get_columns(table)}
            for name, ddl in cols.items():
                if name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
