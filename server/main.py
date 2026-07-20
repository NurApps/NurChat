import asyncio
import os
import sys

project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from shared.rate_limiter import limiter

from server.core.database import create_tables
from server.middleware.csrf import CSRFMiddleware

# Импорты routes
from server.routes import auth, calls, chat, contacts_groups, files, forward, keys, legal, p2p, ipfs, bookmarks, pins, stats, audit, federation
from server.utils.file_cleanup import file_cleanup_service
from server.utils.logger import logger
from server.ws.chat_manager import handle_websocket_connection
from server.ws.notifications import handle_notifications_websocket
from server.ws.p2p_manager import p2p_manager
from server.ws.signaling import call_manager
from shared.config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Starting NurChat Server...")

    # Создаем таблицы БД
    create_tables()
    logger.info("Database tables created")

    # Запускаем сервис очистки файлов
    file_cleanup_service.start_cleanup_scheduler()
    logger.info("File cleanup service started")

    # Auto-start IPFS daemon if enabled
    if settings.USE_IPFS:
        from server.core import ipfs_manager
        if ipfs_manager.is_installed() and not ipfs_manager.is_running():
            result = ipfs_manager.start_daemon()
            logger.info("IPFS auto-start: %s", result.get("message", "unknown"))
        elif ipfs_manager.is_running():
            logger.info("IPFS daemon already running")
        else:
            logger.info("IPFS enabled but not installed. Install via /api/ipfs/manager/install")

    yield

    # Shutdown: close all WebSocket connections gracefully
    from server.ws.chat_manager import connection_manager
    for user_id, ws in list(connection_manager.active_connections.items()):
        try:
            await ws.close(code=1001, reason="Server shutting down")
        except Exception:
            pass
    connection_manager.active_connections.clear()
    connection_manager.user_chats.clear()
    connection_manager.chat_users.clear()
    logger.info("All WebSocket connections closed")

    file_cleanup_service.stop_cleanup_scheduler()
    logger.info("NurChat Server stopped")

app = FastAPI(
    title="NurChat API",
    description="Анонимный мессенджер нового поколения от NurApps",
    version="1.0.0",
    lifespan=lifespan
)

# CSRF Protection (защита от подделки межсайтовых запросов)
app.add_middleware(
    CSRFMiddleware,
    secret_key=settings.JWT_SECRET_KEY,
    cookie_name="csrf_token",
    header_name="X-CSRF-Token",
    token_lifetime_hours=24,
    exempt_paths=[
        "/health",
        "/docs",
        "/redoc",
        "/openapi.json",
        "/api/captcha",
        "/api/auth/login",  # Login without CSRF for initial access
    ],
)

# Rate limiting (защита от брутфорса)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS
_cors_origins = [
    "http://localhost:5173",
    "http://localhost:8000",
    "tauri://localhost",
    "https://tauri.localhost",
]
if settings.DEBUG:
    _cors_origins.append("*")
    logger.warning(
        "⚠️  DEBUG mode: CORS allows all origins (*). "
        "Disable DEBUG or restrict origins for production use."
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Роуты
app.include_router(auth.router, prefix="/api/auth", tags=["Authentication"])
app.include_router(chat.router, prefix="/api/chat", tags=["Chat"])
app.include_router(calls.router, prefix="/api/calls", tags=["Calls"])
app.include_router(files.router, prefix="/api/files", tags=["Files"])
app.include_router(forward.router, prefix="/api/forward", tags=["Forward"])
app.include_router(legal.router, prefix="/api/legal", tags=["Legal"])
app.include_router(contacts_groups.router, prefix="/api/contacts-groups", tags=["Contacts and Groups"])
app.include_router(p2p.router, prefix="/api/p2p", tags=["P2P"])
app.include_router(ipfs.router, prefix="/api/ipfs", tags=["IPFS"])
app.include_router(bookmarks.router, prefix="/api/bookmarks", tags=["Bookmarks"])
app.include_router(pins.router, tags=["Pinned Messages"])
app.include_router(stats.router, tags=["Statistics"])
app.include_router(audit.router, prefix="/api/audit", tags=["Audit Logs"])
app.include_router(federation.router, tags=["Federation"])
app.include_router(keys.router, prefix="/api/keys", tags=["Keys"])

# WS rate limiting: max connections per IP
_ws_connections: dict[str, int] = {}
WS_MAX_PER_IP = 10

def check_ws_rate_limit(ip: str) -> bool:
    count = _ws_connections.get(ip, 0)
    if count >= WS_MAX_PER_IP:
        return False
    _ws_connections[ip] = count + 1
    return True

def release_ws_connection(ip: str):
    _ws_connections[ip] = max(0, _ws_connections.get(ip, 1) - 1)

# WebSocket для чатов
@app.websocket("/ws/chat/{user_id}")
async def websocket_chat_endpoint(websocket: WebSocket, user_id: str, token: str | None = None):
    client_ip = websocket.client.host if websocket.client else "unknown"
    if not check_ws_rate_limit(client_ip):
        await websocket.close(code=4008)
        return
    if token:
        from server.core.security import security as sec, AuthenticationError
        try:
            sec.verify_token(token)
        except AuthenticationError:
            release_ws_connection(client_ip)
            await websocket.close(code=4001)
            return
    try:
        await handle_websocket_connection(websocket, user_id)
    finally:
        release_ws_connection(client_ip)

# WebSocket для звонков
@app.websocket("/ws/calls/{user_id}")
async def websocket_calls_endpoint(websocket: WebSocket, user_id: str, token: str | None = None):
    client_ip = websocket.client.host if websocket.client else "unknown"
    if not check_ws_rate_limit(client_ip):
        await websocket.close(code=4008)
        return
    if token:
        from server.core.security import security as sec, AuthenticationError
        try:
            sec.verify_token(token)
        except AuthenticationError:
            release_ws_connection(client_ip)
            await websocket.close(code=4001)
            return
    try:
        await call_manager.handle_signaling(websocket, user_id)
    finally:
        release_ws_connection(client_ip)

# WebSocket для P2P signalling и relay
@app.websocket(settings.P2P_SIGNALING_PATH + "/{user_id}")
async def websocket_p2p_endpoint(websocket: WebSocket, user_id: str, token: str | None = None):
    client_ip = websocket.client.host if websocket.client else "unknown"
    if not check_ws_rate_limit(client_ip):
        await websocket.close(code=4008)
        return
    if token:
        from server.core.security import security as sec, AuthenticationError
        try:
            sec.verify_token(token)
        except AuthenticationError:
            release_ws_connection(client_ip)
            await websocket.close(code=4001)
            return
    try:
        await p2p_manager.handle_connection(websocket, user_id)
    finally:
        release_ws_connection(client_ip)

# WebSocket для уведомлений
@app.websocket("/ws/notifications/{user_id}")
async def websocket_notifications_endpoint(websocket: WebSocket, user_id: str, token: str | None = None):
    client_ip = websocket.client.host if websocket.client else "unknown"
    if not check_ws_rate_limit(client_ip):
        await websocket.close(code=4008)
        return
    if token:
        from server.core.security import security as sec, AuthenticationError
        try:
            sec.verify_token(token)
        except AuthenticationError:
            release_ws_connection(client_ip)
            await websocket.close(code=4001)
            return
    try:
        await handle_notifications_websocket(websocket, user_id)
    finally:
        release_ws_connection(client_ip)

# Статические файлы — НЕ монтируем /media напрямую (безопасность)
# Файлы доступны только через авторизованный эндпоинт /api/files/download/{file_id}

# Health check
@app.get("/health")
async def health_check():
    db_ok = False
    redis_ok = False
    try:
        from sqlalchemy import text
        from server.core.database import SessionLocal
        db = SessionLocal()
        try:
            db.execute(text("SELECT 1"))
            db_ok = True
        finally:
            db.close()
    except Exception as e:
        logger.warning("Database health check failed: %s", e)
    try:
        from server.core.redis_manager import get_redis
        r = get_redis()
        if r:
            r.ping()
            redis_ok = True
    except Exception as e:
        logger.debug("Redis health check failed: %s", e)
    return {
        "status": "healthy" if db_ok else "degraded",
        "database": "connected" if db_ok else "error",
        "redis": "connected" if redis_ok else "disconnected",
        "service": "NurChat Server",
        "version": "1.0.0"
    }

# Prometheus metrics
if settings.ENABLE_METRICS:
    from prometheus_client import generate_latest, REGISTRY, Counter, Histogram, Gauge

    http_requests = Counter("nurchat_http_requests_total", "Total HTTP requests", ["method", "endpoint"])
    http_duration = Histogram("nurchat_http_request_duration_seconds", "HTTP request duration", ["endpoint"])
    active_connections = Gauge("nurchat_ws_active_connections", "Active WebSocket connections")

    @app.middleware("http")
    async def metrics_middleware(request, call_next):
        http_requests.labels(method=request.method, endpoint=request.url.path).inc()
        with http_duration.labels(endpoint=request.url.path).time():
            response = await call_next(request)
        return response

    @app.get("/metrics")
    async def metrics():
        from starlette.responses import Response
        return Response(content=generate_latest(REGISTRY), media_type="text/plain; version=0.0.4; charset=utf-8")

@app.get("/")
async def root():
    return {
        "message": "Welcome to NurChat API",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/health"
    }

if __name__ == "__main__":
    uvicorn.run(
        app,
        host=settings.SERVER_HOST,
        port=settings.SERVER_PORT,
        reload=False,
        log_level="info"
    )
