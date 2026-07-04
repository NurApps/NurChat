from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

from shared.config import settings

# Создаем движок БД
engine = create_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False} if "sqlite" in settings.DATABASE_URL else {}
)

# Создаем фабрику сессий
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Базовый класс для моделей
Base = declarative_base()

# Dependency для FastAPI
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

from sqlalchemy import inspect, text


def create_tables():
    """
    Создаёт все таблицы, зарегистрированные в Base.metadata.
    ВАЖНО: все модели должны быть импортированы до вызова этой функции.
    """
    # Импорт моделей для создания таблиц

    Base.metadata.create_all(bind=engine)

    # Проверяем и добавляем новые столбцы, если их нет
    inspector = inspect(engine)
    columns = [col['name'] for col in inspector.get_columns('users')]

    columns_to_add = [
        ('first_name', 'VARCHAR'),
        ('last_name', 'VARCHAR'),
        ('bio', 'VARCHAR'),
        ('hashed_password', 'VARCHAR'),
        ('public_key', 'TEXT'),
        ('signing_public_key', 'TEXT'),
        ('avatar_path', 'VARCHAR'),
        ('status', 'VARCHAR'),
        ('is_online', 'BOOLEAN'),
    ]

    for col_name, col_type in columns_to_add:
        if col_name not in columns:
            try:
                print(f"Добавляем столбец {col_name} в таблицу users...")
                with engine.connect() as conn:
                    default_val = "DEFAULT 0" if col_type == 'BOOLEAN' else ""
                    conn.execute(text(f"ALTER TABLE users ADD COLUMN {col_name} {col_type} {default_val}"))
                    conn.commit()
                print(f"Столбец {col_name} успешно добавлен.")
            except Exception as e:
                print(f"Ошибка при добавлении столбца {col_name}: {e}")

    try:
        with engine.connect() as conn:
            conn.execute(text("UPDATE users SET first_name = username WHERE first_name IS NULL OR first_name = ''"))
            conn.commit()
    except Exception as e:
        print(f"Ошибка при обновлении first_name: {e}")

    # Ensure is_deleted and deleted_for_all are not NULL in messages table
    try:
        with engine.connect() as conn:
            conn.execute(text("UPDATE messages SET is_deleted = 0 WHERE is_deleted IS NULL"))
            conn.execute(text("UPDATE messages SET deleted_for_all = 0 WHERE deleted_for_all IS NULL"))
            conn.commit()
    except Exception as e:
        pass

    # Add is_admin to chat_participants if missing
    try:
        inspector2 = inspect(engine)
        if "chat_participants" in inspector2.get_table_names():
            cp_cols = [c['name'] for c in inspector2.get_columns('chat_participants')]
            if "is_admin" not in cp_cols:
                with engine.connect() as conn:
                    conn.execute(text("ALTER TABLE chat_participants ADD COLUMN is_admin BOOLEAN DEFAULT 0"))
                    conn.commit()
    except Exception:
        pass

    import sys
    if sys.stdout.encoding != 'utf-8':
        print("Tables created successfully.")
    else:
        print("Таблицы базы данных созданы.")
