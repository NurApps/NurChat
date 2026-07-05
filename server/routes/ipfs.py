from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from server.core.database import get_db
from server.core.security import verify_token_dependency
from server.utils.logger import logger
from shared.config import settings

router = APIRouter()


@router.get("/status")
async def ipfs_status(token: dict = Depends(verify_token_dependency)):
    """Проверка статуса IPFS-демона"""
    if not settings.USE_IPFS:
        return {"enabled": False, "online": False, "message": "IPFS отключён в конфигурации"}

    try:
        from server.core.ipfs_client import ipfs_client
        online = await ipfs_client.is_online()
        return {
            "enabled": True,
            "online": online,
            "api_url": settings.IPFS_API_URL,
            "message": "IPFS-демон работает" if online else "IPFS-демон недоступен. Запустите Kubo.",
        }
    except Exception as e:
        logger.error("IPFS status check error: %s", e)
        return {"enabled": True, "online": False, "message": f"Ошибка: {e}"}


@router.get("/gateway-url/{ipfs_hash}")
async def get_gateway_url(ipfs_hash: str, token: dict = Depends(verify_token_dependency)):
    """Получение URL файла через IPFS Gateway"""
    if not settings.USE_IPFS:
        return {"url": None, "message": "IPFS отключён"}

    gateway_url = f"http://127.0.0.1:8080/ipfs/{ipfs_hash}"
    return {"url": gateway_url, "hash": ipfs_hash}


@router.post("/pin/{ipfs_hash}")
async def pin_file(ipfs_hash: str, token: dict = Depends(verify_token_dependency)):
    """Закрепление файла в IPFS"""
    if not settings.USE_IPFS:
        return {"success": False, "message": "IPFS отключён"}

    try:
        from server.core.ipfs_client import ipfs_client
        success = await ipfs_client.pin(ipfs_hash)
        return {"success": success, "hash": ipfs_hash, "message": "Файл закреплён" if success else "Ошибка закрепления"}
    except Exception as e:
        logger.error("IPFS pin error: %s", e)
        return {"success": False, "message": str(e)}


@router.delete("/pin/{ipfs_hash}")
async def unpin_file(ipfs_hash: str, token: dict = Depends(verify_token_dependency)):
    """Открепление файла из IPFS"""
    if not settings.USE_IPFS:
        return {"success": False, "message": "IPFS отключён"}

    try:
        from server.core.ipfs_client import ipfs_client
        success = await ipfs_client.unpin(ipfs_hash)
        return {"success": success, "hash": ipfs_hash, "message": "Файл откреплён" if success else "Ошибка открепления"}
    except Exception as e:
        logger.error("IPFS unpin error: %s", e)
        return {"success": False, "message": str(e)}
