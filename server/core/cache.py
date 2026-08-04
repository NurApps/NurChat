import time
from collections.abc import Callable
from typing import Any, TypeVar, cast

T = TypeVar("T")


class TTLCache:
    def __init__(self, default_ttl: int = 60):
        self._default_ttl = default_ttl
        self._store: dict[str, tuple[float, Any]] = {}

    def get(self, key: str) -> Any | None:
        data = self._store.get(key)
        if data is None:
            return None
        expires, value = data
        if time.monotonic() > expires:
            del self._store[key]
            return None
        return value

    def set(self, key: str, value: Any, ttl: int | None = None) -> None:
        expires = time.monotonic() + (ttl if ttl is not None else self._default_ttl)
        self._store[key] = (expires, value)

    def invalidate(self, key: str) -> None:
        self._store.pop(key, None)

    def invalidate_pattern(self, prefix: str) -> None:
        keys = [k for k in self._store if k.startswith(prefix)]
        for k in keys:
            del self._store[k]

    def clear(self) -> None:
        self._store.clear()

    def memoize(self, ttl: int | None = None) -> Callable[[Callable[..., T]], Callable[..., T]]:
        def decorator(fn: Callable[..., T]) -> Callable[..., T]:
            def wrapper(*args: Any, **kwargs: Any) -> T:
                key = f"{fn.__name__}:{args}:{kwargs}"
                cached = self.get(key)
                if cached is not None:
                    return cast(T, cached)
                result = fn(*args, **kwargs)
                self.set(key, result, ttl)
                return result
            return wrapper
        return decorator


user_cache = TTLCache(default_ttl=300)
chat_cache = TTLCache(default_ttl=300)
