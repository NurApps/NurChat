import os
import subprocess
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from pydantic import BaseModel

from server.core.database import get_db, engine, _is_sqlite
from server.routes.auth import verify_token_dependency

logger = logging.getLogger("nurchat")
router = APIRouter(prefix="/api/admin/db", tags=["admin-db"])


class DBStatus(BaseModel):
    dialect: str
    url_masked: str
    is_healthy: bool
    table_count: int
    size_info: str | None = None
    docker_available: bool = False
    docker_running: bool = False


class PGConnectRequest(BaseModel):
    host: str = "localhost"
    port: int = 5432
    user: str = "nurchat"
    password: str
    database: str = "nurchat"


@router.get("/status", response_model=DBStatus)
async def get_db_status(token: dict = Depends(verify_token_dependency)):
    """Get current database status"""
    from shared.config import settings
    url = settings.DATABASE_URL

    # Mask password in URL
    url_masked = url
    if "@" in url:
        scheme = url.split("://")[0]
        rest = url.split("://")[1]
        if ":" in rest.split("@")[0]:
            user = rest.split("@")[0].split(":")[0]
            url_masked = f"{scheme}://{user}:***@{rest.split('@')[1]}"

    # Check health
    is_healthy = False
    table_count = 0
    size_info = None
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            is_healthy = True
            result = conn.execute(text("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'"))
            table_count = result.scalar() or 0
    except Exception:
        # SQLite fallback
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
                is_healthy = True
                result = conn.execute(text("SELECT COUNT(*) FROM sqlite_master WHERE type='table'"))
                table_count = result.scalar() or 0
                if _is_sqlite:
                    db_path = url.replace("sqlite:///", "")
                    if os.path.exists(db_path):
                        size_bytes = os.path.getsize(db_path)
                        if size_bytes < 1024 * 1024:
                            size_info = f"{size_bytes / 1024:.1f} KB"
                        else:
                            size_info = f"{size_bytes / (1024 * 1024):.1f} MB"
        except Exception as e:
            logger.error(f"DB health check failed: {e}")

    # Check Docker
    docker_available = False
    docker_running = False
    try:
        result = subprocess.run(["docker", "info"], capture_output=True, timeout=5)
        docker_available = result.returncode == 0
        if docker_available:
            result = subprocess.run(
                ["docker", "ps", "--format", "{{.Names}}"],
                capture_output=True, text=True, timeout=5
            )
            docker_running = "nurchat-db-1" in (result.stdout or "") or "db" in (result.stdout or "")
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    return DBStatus(
        dialect="postgresql" if not _is_sqlite else "sqlite",
        url_masked=url_masked,
        is_healthy=is_healthy,
        table_count=table_count,
        size_info=size_info,
        docker_available=docker_available,
        docker_running=docker_running,
    )


@router.post("/test-pg")
async def test_postgres_connection(
    req: PGConnectRequest,
    token: dict = Depends(verify_token_dependency),
):
    """Test PostgreSQL connection before switching"""
    try:
        from sqlalchemy import create_engine
        test_url = f"postgresql://{req.user}:{req.password}@{req.host}:{req.port}/{req.database}"
        test_engine = create_engine(test_url, connect_args={"connect_timeout": 5})
        with test_engine.connect() as conn:
            result = conn.execute(text("SELECT version()"))
            version = result.scalar()
        test_engine.dispose()
        return {"ok": True, "version": version}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.post("/switch-to-pg")
async def switch_to_postgres(
    req: PGConnectRequest,
    token: dict = Depends(verify_token_dependency),
):
    """Switch DATABASE_URL to PostgreSQL and restart"""
    from shared.config import settings

    pg_url = f"postgresql://{req.user}:{req.password}@{req.host}:{req.port}/{req.database}"

    # Write to .env
    env_path = ".env"
    lines = []
    if os.path.exists(env_path):
        with open(env_path, "r") as f:
            lines = f.readlines()

    found = False
    for i, line in enumerate(lines):
        if line.startswith("DATABASE_URL="):
            lines[i] = f"DATABASE_URL={pg_url}\n"
            found = True
            break
    if not found:
        lines.append(f"\nDATABASE_URL={pg_url}\n")

    with open(env_path, "w") as f:
        f.writelines(lines)

    # Run Alembic migration on new DB
    try:
        from alembic.config import Config
        from alembic import command
        alembic_cfg = Config("alembic.ini")
        alembic_cfg.set_main_option("sqlalchemy.url", pg_url)
        command.upgrade(alembic_cfg, "head")
    except Exception as e:
        logger.warning(f"Alembic migration on new PG failed: {e}")

    return {
        "ok": True,
        "message": "Database URL updated. Restart the server to apply.",
        "restart_required": True,
    }


@router.post("/start-docker-pg")
async def start_docker_postgres(token: dict = Depends(verify_token_dependency)):
    """Start PostgreSQL via docker-compose"""
    try:
        result = subprocess.run(
            ["docker-compose", "up", "-d", "db", "redis"],
            capture_output=True, text=True, timeout=60,
            cwd=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        )
        if result.returncode == 0:
            return {"ok": True, "output": result.stdout}
        else:
            return {"ok": False, "error": result.stderr}
    except FileNotFoundError:
        return {"ok": False, "error": "docker-compose not found. Install Docker Desktop."}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "Docker start timed out"}
