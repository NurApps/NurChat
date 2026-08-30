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
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from server.core.database import create_tables
from server.middleware.csrf import CSRFMiddleware

# Импорты routes
from server.routes import (
    audit,
    auth,
    bookmarks,
    calls,
    chat,
    contact_requests,
    contacts_groups,
    discovery,
    files,
    forward,
    group_calls,
    keys,
    legal,
    p2p,
    pins,
    polls,
    push,
    stats,
    transparency,
    webhooks,
)
from server.utils.file_cleanup import file_cleanup_service
from server.utils.logger import generate_request_id, logger, request_id_var
from server.ws.chat_manager import handle_websocket_connection
from server.ws.group_call_signaling import group_call_manager
from server.ws.notifications import handle_notifications_websocket
from server.ws.p2p_manager import p2p_manager
from server.ws.signaling import call_manager
from server.ws.signaling_p2p import signaling_manager
from shared.config import settings
from shared.rate_limiter import limiter


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

    # Start background tasks
    from server.core.background_tasks import start_background_tasks
    start_background_tasks()
    logger.info("Background tasks started")

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

    from server.ws.signaling import call_manager
    for user_id, ws in list(call_manager.call_websockets.items()):
        try:
            await ws.close(code=1001, reason="Server shutting down")
        except Exception:
            pass
    call_manager.call_websockets.clear()

    logger.info("All WebSocket connections closed")

    file_cleanup_service.stop_cleanup_scheduler()
    logger.info("NurChat Server stopped")

app = FastAPI(
    title="NurChat API",
    description="Анонимный мессенджер нового поколения от NurApps",
    version="1.0.0",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
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
        "/api/auth/captcha",
        "/api/auth/login",
        "/api/auth/register",
        "/api/files/upload",
    ],
)

# Rate limiting (защита от брутфорса)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]

# Custom exception handlers —TogetherException → proper HTTP codes
from shared.exceptions import AuthenticationError, ChatNotFoundError, MessageNotFoundError, TogetherException


@app.exception_handler(ChatNotFoundError)
async def chat_not_found_handler(request: Request, exc: ChatNotFoundError):
    return JSONResponse(status_code=404, content={"detail": str(exc) or "Чат не найден"})

@app.exception_handler(MessageNotFoundError)
async def message_not_found_handler(request: Request, exc: MessageNotFoundError):
    return JSONResponse(status_code=404, content={"detail": str(exc) or "Сообщение не найдено"})

@app.exception_handler(AuthenticationError)
async def auth_error_handler(request: Request, exc: AuthenticationError):
    return JSONResponse(status_code=401, content={"detail": str(exc) or "Ошибка аутентификации"})

@app.exception_handler(TogetherException)
async def together_exception_handler(request: Request, exc: TogetherException):
    return JSONResponse(status_code=400, content={"detail": str(exc) or "Bad request"})

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
    allow_headers=["Content-Type", "Authorization", "X-CSRF-Token", "X-Password-Confirmation", "Accept"],
    expose_headers=["X-CSRF-Token"],
)

# Глобальный обработчик исключений
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    global _error_count, _request_count
    _error_count += 1
    _request_count += 1
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    # Check error rate threshold
    if _request_count > 100:
        error_rate = (_error_count / _request_count) * 100
        if error_rate > settings.ERROR_RATE_WARN:
            logger.warning(f"Error rate ({error_rate:.1f}%) exceeds threshold ({settings.ERROR_RATE_WARN}%)")
    return JSONResponse(
        status_code=500,
        content={"detail": "Внутренняя ошибка сервера"},
    )

@app.middleware("http")
async def add_request_id(request: Request, call_next):
    rid = request.headers.get("X-Request-ID") or generate_request_id()
    request_id_var.set(rid)
    response = await call_next(request)
    response.headers["X-Request-ID"] = rid
    return response

# Host header validation — reject poisoned Host headers
@app.middleware("http")
async def validate_host_header(request: Request, call_next):
    host = request.headers.get("host", "")
    if not host:
        return await call_next(request)
    # Allow: localhost, 127.0.0.1, tauri, testserver, any IP/domain with dots
    allowed_prefixes = ("localhost", "127.0.0.1", "tauri", "testserver")
    if any(host.lower().startswith(p) for p in allowed_prefixes):
        return await call_next(request)
    if "." in host:
        return await call_next(request)
    return JSONResponse(status_code=400, content={"detail": "Invalid Host header"})

# Security headers
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    if not settings.DEBUG:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    if "Content-Security-Policy" not in response.headers:
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "connect-src 'self' http://localhost:5173 http://localhost:8000 http://127.0.0.1:8000 "
            "ws://localhost:5173 ws://localhost:8000 ws://127.0.0.1:8000 "
            "https://api.qrserver.com; "
            "img-src 'self' data: blob: http://localhost:5173 http://localhost:8000 http://127.0.0.1:8000; "
            "media-src 'self' blob: http://localhost:5173 http://localhost:8000 http://127.0.0.1:8000; "
            "style-src 'self' 'unsafe-inline'; "
            "script-src 'self'; "
            "frame-ancestors 'none'; "
            "form-action 'self'"
        )
    return response

# Body size limit
MAX_BODY_SIZE = settings.MAX_FILE_SIZE

@app.middleware("http")
async def limit_body_size(request: Request, call_next):
    if request.method in ("POST", "PUT", "PATCH"):
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > MAX_BODY_SIZE:
            from fastapi.responses import JSONResponse
            max_mb = MAX_BODY_SIZE // (1024 * 1024)
            return JSONResponse(status_code=413, content={"detail": f"Тело запроса слишком большое (макс. {max_mb}MB)"})
    return await call_next(request)

# Роуты
app.include_router(auth.router, prefix="/api/auth", tags=["Authentication"])
app.include_router(chat.router, prefix="/api/chat", tags=["Chat"])
app.include_router(calls.router, prefix="/api/calls", tags=["Calls"])
app.include_router(group_calls.router, prefix="/api/group-calls", tags=["Group Calls"])
app.include_router(files.router, prefix="/api/files", tags=["Files"])
app.include_router(forward.router, prefix="/api/forward", tags=["Forward"])
app.include_router(legal.router, prefix="/api/legal", tags=["Legal"])
app.include_router(contacts_groups.router, prefix="/api/contacts-groups", tags=["Contacts and Groups"])
app.include_router(p2p.router, prefix="/api/p2p", tags=["P2P"])
app.include_router(bookmarks.router, tags=["Bookmarks"])
app.include_router(pins.router, tags=["Pinned Messages"])
app.include_router(stats.router, tags=["Statistics"])
app.include_router(audit.router, prefix="/api/audit", tags=["Audit Logs"])
app.include_router(keys.router, prefix="/api/keys", tags=["Keys"])
app.include_router(discovery.router, prefix="/api/discover", tags=["LAN Discovery"])
app.include_router(webhooks.router, prefix="/api", tags=["Webhooks"])
app.include_router(transparency.router, tags=["Transparency"])
app.include_router(polls.router, tags=["Polls"])
app.include_router(push.router)
app.include_router(contact_requests.router, tags=["Contact Requests"])

# WS rate limiting: max connections per IP
_ws_connections: dict[str, int] = {}
WS_MAX_PER_IP = 10
_ws_lock = asyncio.Lock()

_error_count = 0
_request_count = 0


async def check_ws_rate_limit(ip: str) -> bool:
    global _request_count
    _request_count += 1
    async with _ws_lock:
        count = _ws_connections.get(ip, 0)
        if count >= WS_MAX_PER_IP:
            return False
        _ws_connections[ip] = count + 1
        total_ws = sum(_ws_connections.values())
    # Check WS connection threshold (outside lock — logging only)
    if total_ws > settings.WS_CONNECTIONS_WARN:
        logger.warning(f"WS connections ({total_ws}) exceed threshold ({settings.WS_CONNECTIONS_WARN})")
    return True

async def release_ws_connection(ip: str):
    async with _ws_lock:
        _ws_connections[ip] = max(0, _ws_connections.get(ip, 1) - 1)

async def _verify_ws_token(websocket: WebSocket, token: str | None, client_ip: str,
                           expected_user_id: str | None = None) -> dict | None:
    # NOTE: does NOT release the ws connection slot on failure —
    # the caller's finally/release path owns that to avoid double-decrement.
    if not token:
        await websocket.close(code=4001, reason="Token required")
        return None
    from server.core.security import AuthenticationError
    from server.core.security import security as sec
    try:
        payload = sec.verify_token(token)
        if expected_user_id is not None and payload.get("sub") != expected_user_id:
            logger.warning(f"WS token subject mismatch for {expected_user_id} from {client_ip}")
            await websocket.close(code=4003, reason="Token does not match user")
            return None
        return payload
    except AuthenticationError:
        await websocket.close(code=4001, reason="Invalid token")
        return None

# WebSocket для чатов
@app.websocket("/ws/chat/{user_id}")
async def websocket_chat_endpoint(websocket: WebSocket, user_id: str, token: str):
    client_ip = websocket.client.host if websocket.client else "unknown"
    if not await check_ws_rate_limit(client_ip):
        await websocket.close(code=4008)
        return
    if not await _verify_ws_token(websocket, token, client_ip, user_id):
        await release_ws_connection(client_ip)
        return
    try:
        await handle_websocket_connection(websocket, user_id, token)
    finally:
        await release_ws_connection(client_ip)

# WebSocket для звонков
@app.websocket("/ws/calls/{user_id}")
async def websocket_calls_endpoint(websocket: WebSocket, user_id: str, token: str):
    client_ip = websocket.client.host if websocket.client else "unknown"
    if not await check_ws_rate_limit(client_ip):
        await websocket.close(code=4008)
        return
    if not await _verify_ws_token(websocket, token, client_ip, user_id):
        await release_ws_connection(client_ip)
        return
    try:
        await call_manager.handle_signaling(websocket, user_id)
    finally:
        await release_ws_connection(client_ip)


@app.websocket("/ws/group-calls/{user_id}")
async def websocket_group_calls_endpoint(websocket: WebSocket, user_id: str, token: str):
    client_ip = websocket.client.host if websocket.client else "unknown"
    if not await check_ws_rate_limit(client_ip):
        await websocket.close(code=4008)
        return
    if not await _verify_ws_token(websocket, token, client_ip, user_id):
        await release_ws_connection(client_ip)
        return
    try:
        await group_call_manager.handle(websocket, user_id)
    finally:
        await release_ws_connection(client_ip)

# WebSocket для P2P signaling (только offer/answer/ICE)
@app.websocket("/ws/signaling/{user_id}")
async def websocket_signaling_endpoint(websocket: WebSocket, user_id: str, token: str):
    client_ip = websocket.client.host if websocket.client else "unknown"
    if not await check_ws_rate_limit(client_ip):
        await websocket.close(code=4008)
        return
    if not await _verify_ws_token(websocket, token, client_ip, user_id):
        await release_ws_connection(client_ip)
        return
    try:
        await signaling_manager.handle(websocket, user_id)
    finally:
        await release_ws_connection(client_ip)

# WebSocket для P2P signalling и relay
@app.websocket(settings.P2P_SIGNALING_PATH + "/{user_id}")
async def websocket_p2p_endpoint(websocket: WebSocket, user_id: str, token: str):
    client_ip = websocket.client.host if websocket.client else "unknown"
    if not await check_ws_rate_limit(client_ip):
        await websocket.close(code=4008)
        return
    if not await _verify_ws_token(websocket, token, client_ip, user_id):
        await release_ws_connection(client_ip)
        return
    try:
        await p2p_manager.handle_connection(websocket, user_id)
    finally:
        await release_ws_connection(client_ip)

# WebSocket для удалённых P2P пиров (прямое соединение сервер-сервер)
@app.websocket("/ws/remote/{node_id}")
async def websocket_remote_endpoint(websocket: WebSocket, node_id: str, token: str):
    client_ip = websocket.client.host if websocket.client else "unknown"
    if not await check_ws_rate_limit(client_ip):
        await websocket.close(code=4008)
        return
    if not token:
        await websocket.close(code=4001, reason="Token required")
        return
    from server.core.security import AuthenticationError
    from server.core.security import security as sec
    try:
        sec.verify_token(token)
    except AuthenticationError:
        await release_ws_connection(client_ip)
        await websocket.close(code=4001, reason="Invalid token")
        return

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

        if is_relay and relay_for:
            peer = remote_manager.get_peer_by_user(relay_for)
            if not peer:
                await websocket.send_json({"type": "error", "message": "Relay target not connected"})
                await websocket.close()
                return
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
        await release_ws_connection(client_ip)

# WebSocket для уведомлений
@app.websocket("/ws/notifications/{user_id}")
async def websocket_notifications_endpoint(websocket: WebSocket, user_id: str, token: str):
    client_ip = websocket.client.host if websocket.client else "unknown"
    if not await check_ws_rate_limit(client_ip):
        await websocket.close(code=4008)
        return
    if not await _verify_ws_token(websocket, token, client_ip):
        await release_ws_connection(client_ip)
        return
    try:
        await handle_notifications_websocket(websocket, user_id)
    finally:
        await release_ws_connection(client_ip)

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
    status = "healthy" if db_ok else "degraded"
    status_code = 200 if db_ok else 503
    return JSONResponse(
        status_code=status_code,
        content={
            "status": status,
            "database": "connected" if db_ok else "error",
            "redis": "connected" if redis_ok else "disconnected",
            "service": "NurChat Server",
            "version": "1.0.0",
        },
    )

# Prometheus metrics
if settings.ENABLE_METRICS:
    from prometheus_client import REGISTRY, Counter, Gauge, Histogram, generate_latest

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
