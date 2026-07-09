"""
Серверный IPFS клиент — загрузка и получение файлов через HTTP API
"""
import logging
from pathlib import Path

import httpx

from shared.config import settings

logger = logging.getLogger(__name__)


class IPFSClient:
    """Клиент для взаимодействия с локальным IPFS-демоном"""

    def __init__(self, api_url: str | None = None):
        self.api_url = (api_url or settings.IPFS_API_URL).rstrip("/")
        self._online: bool | None = None

    async def is_online(self) -> bool:
        """Проверка доступности IPFS-демона"""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.post(f"{self.api_url}/api/v0/id")
                self._online = r.status_code == 200
                return self._online
        except Exception as exc:
            logger.debug("IPFS offline: %s", exc)
            self._online = False
            return False

    async def add_file(self, file_path: str) -> dict | None:
        """
        Загрузка файла в IPFS.
        Возвращает {"name": ..., "hash": ..., "size": ...} или None при ошибке.
        """
        try:
            path = Path(file_path)
            if not path.exists():
                logger.warning("IPFS add: file not found: %s", file_path)
                return None

            async with httpx.AsyncClient(timeout=60.0) as client:
                with open(path, "rb") as f:
                    r = await client.post(
                        f"{self.api_url}/api/v0/add",
                        files={"file": (path.name, f)},
                    )
                if r.status_code == 200:
                    data = r.json()
                    result = {
                        "name": data.get("Name", path.name),
                        "hash": data.get("Hash", ""),
                        "size": data.get("Size", "0"),
                    }
                    logger.info("IPFS added: %s -> %s", path.name, result["hash"])
                    return result
                else:
                    logger.error("IPFS add failed: %s %s", r.status_code, r.text[:200])
                    return None
        except httpx.ConnectError:
            logger.debug("IPFS daemon not available at %s", self.api_url)
            return None
        except Exception as e:
            logger.error("IPFS add error: %s", e)
            return None

    async def cat(self, ipfs_hash: str) -> bytes | None:
        """Получение содержимого файла по IPFS-хешу"""
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                r = await client.post(f"{self.api_url}/api/v0/cat?arg={ipfs_hash}")
                if r.status_code == 200:
                    return r.content
                logger.error("IPFS cat failed: %s %s", r.status_code, r.text[:200])
                return None
        except Exception as e:
            logger.error("IPFS cat error: %s", e)
            return None

    async def pin(self, ipfs_hash: str) -> bool:
        """Закрепление файла в IPFS"""
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                r = await client.post(f"{self.api_url}/api/v0/pin/add?arg={ipfs_hash}")
                return r.status_code == 200
        except Exception as exc:
            logger.debug("IPFS pin error: %s", exc)
            return False

    async def unpin(self, ipfs_hash: str) -> bool:
        """Открепление файла из IPFS"""
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                r = await client.post(f"{self.api_url}/api/v0/pin/rm?arg={ipfs_hash}")
                return r.status_code == 200
        except Exception as exc:
            logger.debug("IPFS unpin error: %s", exc)
            return False


# Глобальный экземпляр
ipfs_client = IPFSClient()
