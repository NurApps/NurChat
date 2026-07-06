from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)


class RateLimiter:
    def __init__(self, limiter=limiter):
        self.limiter = limiter
    def limit(self, limit: str):
        def decorator(func):
            return self.limiter.limit(limit)(func)
        return decorator
    def get_limiter(self):
        return self.limiter
    def set_limiter(self , limiter):
        self.limiter = limiter
        return self.limiter
    def get_key_func(self, key_func=None):
        if key_func is not None:
            self.limiter._key_func = key_func
        return self.limiter._key_func
    def set_key_func(self, key_func):
        self.limiter._key_func = key_func
        return self.limiter._key_func

