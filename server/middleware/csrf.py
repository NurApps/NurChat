"""
CSRF Protection Middleware for NurChat
Generates and validates CSRF tokens for state-changing requests
"""
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Request, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from shared.config import settings


class CSRFMiddleware(BaseHTTPMiddleware):
    """
    CSRF Protection Middleware

    - Generates CSRF tokens stored in HttpOnly cookies
    - Validates X-CSRF-Token header for POST, PUT, PATCH, DELETE requests
    - Excludes paths: /health, /docs, /captcha, /auth/login, /auth/register
    """

    def __init__(
        self,
        app: ASGIApp,
        secret_key: str | None = None,
        cookie_name: str = "csrf_token",
        header_name: str = "X-CSRF-Token",
        token_lifetime_hours: int = 24,
        exempt_paths: list[str] | None = None,
    ):
        super().__init__(app)
        self.secret_key = secret_key or settings.JWT_SECRET_KEY or secrets.token_hex(32)
        self.cookie_name = cookie_name
        self.header_name = header_name
        self.token_lifetime = timedelta(hours=token_lifetime_hours)
        self.exempt_paths = exempt_paths or [
            "/health",
            "/docs",
            "/redoc",
            "/openapi.json",
            "/api/auth/captcha",
            "/api/auth/login",
            "/api/auth/register",
        ]

    def _generate_token(self) -> str:
        """Generate a new CSRF token with timestamp"""
        ts_int = int(datetime.now(timezone.utc).timestamp())
        timestamp = str(ts_int)
        random_part = secrets.token_hex(32)
        message = f"{timestamp}:{random_part}"
        signature = hmac.new(
            self.secret_key.encode(),
            message.encode(),
            hashlib.sha256
        ).hexdigest()
        return f"{message}:{signature}"

    def _validate_token(self, token: str) -> bool:
        """Validate CSRF token"""
        try:
            parts = token.rsplit(":", 2)
            if len(parts) != 3:
                return False

            timestamp_str, random_part, signature = parts
            message = f"{timestamp_str}:{random_part}"
            expected_signature = hmac.new(
                self.secret_key.encode(),
                message.encode(),
                hashlib.sha256
            ).hexdigest()

            if not hmac.compare_digest(signature, expected_signature):
                return False

            # Check token expiration
            try:
                timestamp = datetime.fromisoformat(timestamp_str)
            except ValueError:
                timestamp = datetime.fromtimestamp(float(timestamp_str), tz=timezone.utc)
            if datetime.now(timezone.utc) - timestamp > self.token_lifetime:
                return False

            return True
        except Exception:
            return False

    def _is_exempt_path(self, path: str) -> bool:
        """Check if path is exempt from CSRF protection"""
        for exempt in self.exempt_paths:
            if path.startswith(exempt):
                return True
        return False

    async def dispatch(self, request: Request, call_next):
        from starlette.responses import Response

        # Reuse existing valid CSRF token, or generate new one
        existing_token = request.cookies.get(self.cookie_name)
        if existing_token and self._validate_token(existing_token):
            new_token = existing_token
        else:
            new_token = self._generate_token()

        # Process the request
        response = await call_next(request)

        # Set CSRF token in cookie (non-HttpOnly so JS can read it for X-CSRF-Token header)
        if isinstance(response, Response):
            response.set_cookie(
                key=self.cookie_name,
                value=new_token,
                max_age=int(self.token_lifetime.total_seconds()),
                httponly=False,  # JS must read cookie for X-CSRF-Token header
                secure=not settings.DEBUG,
                samesite="lax",
                path="/",
            )

        # Only validate state-changing methods
        if request.method in ["POST", "PUT", "PATCH", "DELETE"]:
            if not self._is_exempt_path(request.url.path):
                csrf_token = request.headers.get(self.header_name)

                if not csrf_token:
                    return JSONResponse(
                        status_code=status.HTTP_403_FORBIDDEN,
                        content={"detail": "CSRF token missing"}
                    )

                if not self._validate_token(csrf_token):
                    return JSONResponse(
                        status_code=status.HTTP_403_FORBIDDEN,
                        content={"detail": "CSRF token missing or invalid"}
                    )

        return response


def generate_csrf_token() -> str:
    """Utility function to generate CSRF token"""
    middleware = CSRFMiddleware(app=lambda: None)
    return middleware._generate_token()


def validate_csrf_token(token: str) -> bool:
    """Utility function to validate CSRF token"""
    middleware = CSRFMiddleware(app=lambda: None)
    return middleware._validate_token(token)
