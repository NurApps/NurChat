import asyncio
import io
import os
import sys

project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from shared.rate_limiter import limiter

from server.core.database import create_tables
from server.middleware.csrf import CSRFMiddleware

# Импорты routes
from server.routes import auth, calls, chat, contacts_groups, files, forward, keys, legal, p2p, bookmarks, pins, stats, audit, federation, discovery
from server.utils.file_cleanup import file_cleanup_service
from server.utils.logger import logger
from server.ws.chat_manager import handle_websocket_connection
from server.ws.notifications import handle_notifications_websocket
from server.ws.p2p_manager import p2p_manager
from server.ws.signaling import call_manager
from server.ws.signaling_p2p import signaling_manager
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

    # Start LAN discovery
    from server.core.discovery import start_discovery
    await start_discovery()
    logger.info("LAN discovery service started")

    yield

    # Shutdown LAN discovery
    from server.core.discovery import stop_discovery
    await stop_discovery()
    logger.info("LAN discovery service stopped")

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
        "/api/auth/captcha",
        "/api/auth/login",
        "/api/auth/register",
    ],
)

# Rate limiting (защита от брутфорса)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS — строгий белый список из .env (CORS_ORIGINS) или дефолтные
import os
_cors_origins_env = os.getenv("CORS_ORIGINS", "")
if _cors_origins_env:
    _cors_origins = [o.strip() for o in _cors_origins_env.split(",") if o.strip()]
else:
    _cors_origins = [
        "http://localhost:5173",
        "http://localhost:8000",
        "tauri://localhost",
        "https://tauri.localhost",
    ]
if settings.DEBUG:
    logger.info("Allowed origins: %s", _cors_origins)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-CSRF-Token", "Accept"],
)

# Глобальный обработчик исключений
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Внутренняя ошибка сервера"},
    )

# Security headers
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    if "Content-Security-Policy" not in response.headers:
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*; "
            "img-src 'self' data: blob: http://localhost:* http://127.0.0.1:*; "
            "media-src 'self' blob: http://localhost:* http://127.0.0.1:*; "
            "style-src 'self' 'unsafe-inline'; "
            "script-src 'self'; "
            "frame-ancestors 'none'; "
            "form-action 'self'"
        )
    return response

# Body size limit
MAX_BODY_SIZE = 10 * 1024 * 1024

@app.middleware("http")
async def limit_body_size(request: Request, call_next):
    if request.method in ("POST", "PUT", "PATCH"):
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > MAX_BODY_SIZE:
            from fastapi.responses import JSONResponse
            return JSONResponse(status_code=413, content={"detail": "Тело запроса слишком большое (макс. 10MB)"})
    return await call_next(request)

# Роуты
app.include_router(auth.router, prefix="/api/auth", tags=["Authentication"])
app.include_router(chat.router, prefix="/api/chat", tags=["Chat"])
app.include_router(calls.router, prefix="/api/calls", tags=["Calls"])
app.include_router(files.router, prefix="/api/files", tags=["Files"])
app.include_router(forward.router, prefix="/api/forward", tags=["Forward"])
app.include_router(legal.router, prefix="/api/legal", tags=["Legal"])
app.include_router(contacts_groups.router, prefix="/api/contacts-groups", tags=["Contacts and Groups"])
app.include_router(p2p.router, prefix="/api/p2p", tags=["P2P"])
app.include_router(bookmarks.router, prefix="/api/bookmarks", tags=["Bookmarks"])
app.include_router(pins.router, tags=["Pinned Messages"])
app.include_router(stats.router, tags=["Statistics"])
app.include_router(audit.router, prefix="/api/audit", tags=["Audit Logs"])
app.include_router(federation.router, tags=["Federation"])
app.include_router(keys.router, prefix="/api/keys", tags=["Keys"])
app.include_router(discovery.router, prefix="/api/discover", tags=["LAN Discovery"])

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

# WebSocket для P2P signaling (только offer/answer/ICE)
@app.websocket("/ws/signaling/{user_id}")
async def websocket_signaling_endpoint(websocket: WebSocket, user_id: str, token: str | None = None):
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
        await signaling_manager.handle(websocket, user_id)
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

# WebSocket для удалённых P2P пиров (прямое соединение сервер-сервер)
@app.websocket("/ws/remote/{node_id}")
async def websocket_remote_endpoint(websocket: WebSocket, node_id: str):
    await websocket.accept()
    try:
        hello = await asyncio.wait_for(websocket.receive_json(), timeout=10)
        if not isinstance(hello, dict) or hello.get("type") != "remote_hello":
            await websocket.send_json({"type": "error", "message": "Expected remote_hello"})
            await websocket.close()
            return
        address = hello.get("address", "unknown")
        user_id = hello.get("user_id", "")
        is_relay = bool(hello.get("is_relay", False))
        relay_for = hello.get("relay_for", "")
        if not user_id:
            await websocket.send_json({"type": "error", "message": "user_id required"})
            await websocket.close()
            return
        from server.ws.remote import remote_manager

        # If connecting as relay client, find the target through the relay's peer connection
        if is_relay and relay_for:
            peer = remote_manager.get_peer_by_user(relay_for)
            if not peer:
                await websocket.send_json({"type": "error", "message": "Relay target not connected"})
                await websocket.close()
                return
            # Register as relay client
            await remote_manager.connect(node_id, websocket, address, user_id, is_relay=True)
            await websocket.send_json({"type": "remote_ack", "node_id": node_id, "relayed": True})
        else:
            await remote_manager.connect(node_id, websocket, address, user_id, is_relay=is_relay)
            await websocket.send_json({"type": "remote_ack", "node_id": node_id})
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")
            if msg_type == "relay_message":
                target = data.get("target_user_id", "")
                payload = data.get("payload", {})
                sent = await remote_manager.relay_message(target, payload)
                await websocket.send_json({
                    "type": "relay_ack",
                    "target": target,
                    "delivered": sent,
                })
            elif msg_type == "relay_register":
                peer = remote_manager.get_peer_by_node(node_id)
                if peer:
                    peer.is_relay = True
                await websocket.send_json({"type": "relay_registered"})
            elif msg_type == "ping":
                await websocket.send_json({"type": "pong"})
    except asyncio.TimeoutError:
        await websocket.send_json({"type": "error", "message": "Handshake timeout"})
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"Remote peer error: {e}")
    finally:
        from server.ws.remote import remote_manager
        remote_manager.disconnect(node_id)

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
    # PyInstaller fix: в --noconsole sys.stderr = None, валится uvicorn
    if sys.stderr is None:
        sys.stderr = io.StringIO()

    uvicorn.run(
        app,
        host=settings.SERVER_HOST,
        port=settings.SERVER_PORT,
        reload=False,
        log_level="info",
        log_config=None
    )
