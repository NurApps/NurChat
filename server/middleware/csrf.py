"""
CSRF Protection Middleware for NurChat
Generates and validates CSRF tokens for state-changing requests
"""
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from shared.config import settings


class CSRFMiddleware(BaseHTTPMiddleware):
    """
    CSRF Protection Middleware
    
    - Generates CSRF tokens stored in HttpOnly cookies
    - Validates X-CSRF-Token header for POST, PUT, PATCH, DELETE requests
    - Excludes paths: /health, /docs, /captcha, /auth/login
    """
    
    def __init__(
        self,
        app: ASGIApp,
        secret_key: Optional[str] = None,
        cookie_name: str = "csrf_token",
        header_name: str = "X-CSRF-Token",
        token_lifetime_hours: int = 24,
        exempt_paths: Optional[list[str]] = None,
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
            "/api/captcha",
            "/api/auth/login",
        ]
    
    def _generate_token(self) -> str:
        """Generate a new CSRF token with timestamp"""
        timestamp = datetime.now(timezone.utc).isoformat()
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
            parts = token.split(":")
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
            timestamp = datetime.fromisoformat(timestamp_str)
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
        
        # Generate a new CSRF token for all requests
        new_token = self._generate_token()
        
        # Process the request
        response = await call_next(request)
        
        # Set CSRF token in HttpOnly cookie
        if isinstance(response, Response):
            response.set_cookie(
                key=self.cookie_name,
                value=new_token,
                max_age=int(self.token_lifetime.total_seconds()),
                httponly=True,
                secure=not settings.DEBUG,  # Secure only in production
                samesite="lax",
                path="/",
            )
        
        # Only validate state-changing methods
        if request.method in ["POST", "PUT", "PATCH", "DELETE"]:
            if not self._is_exempt_path(request.url.path):
                csrf_token = request.headers.get(self.header_name)
                
                if not csrf_token:
                    # Try to get token from cookie as fallback
                    csrf_token = request.cookies.get(self.cookie_name)
                
                if not csrf_token or not self._validate_token(csrf_token):
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
