"""
IPFS Manager — автоустановка и запуск Kubo
"""
import os
import sys
import subprocess
import zipfile
import shutil
import logging
from pathlib import Path
import httpx

logger = logging.getLogger(__name__)

KUBO_VERSION = "0.33.0"
KUBO_DIR = Path(__file__).resolve().parent.parent.parent / "ipfs_bin"
KUBO_EXE = KUBO_DIR / "kubo" / "ipfs.exe" if sys.platform == "win32" else KUBO_DIR / "kubo" / "ipfs"

IPFS_API_URL = "http://127.0.0.1:5001"
IPFS_GATEWAY_URL = "http://127.0.0.1:8080"


def get_platform_url() -> str:
    """Get Kubo download URL for current platform"""
    if sys.platform == "win32":
        return f"https://dist.ipfs.tech/kubo/v{KUBO_VERSION}/kubo_v{KUBO_VERSION}_windows-amd64.zip"
    elif sys.platform == "darwin":
        return f"https://dist.ipfs.tech/kubo/v{KUBO_VERSION}/kubo_v{KUBO_VERSION}_darwin-amd64.zip"
    else:
        return f"https://dist.ipfs.tech/kubo/v{KUBO_VERSION}/kubo_v{KUBO_VERSION}_linux-amd64.zip"


def is_installed() -> bool:
    """Check if Kubo is installed"""
    return KUBO_EXE.exists()


def is_running() -> bool:
    """Check if IPFS daemon is running"""
    try:
        resp = httpx.post(f"{IPFS_API_URL}/api/v0/id", timeout=3.0)
        return resp.status_code == 200
    except Exception:
        return False


def get_status() -> dict:
    """Get IPFS status"""
    installed = is_installed()
    running = is_running()

    if not installed:
        return {
            "installed": False,
            "running": False,
            "message": "IPFS не установлен. Нажмите 'Установить' для скачивания.",
            "version": KUBO_VERSION,
        }
    elif not running:
        return {
            "installed": True,
            "running": False,
            "message": "IPFS установлен, но демон не запущен. Нажмите 'Запустить'.",
            "version": KUBO_VERSION,
        }
    else:
        return {
            "installed": True,
            "running": True,
            "message": "IPFS работает",
            "version": KUBO_VERSION,
            "api_url": IPFS_API_URL,
            "gateway_url": IPFS_GATEWAY_URL,
        }


async def install_kubo(progress_callback=None) -> dict:
    """Download and install Kubo"""
    try:
        if progress_callback:
            progress_callback("Создание директории...")
        KUBO_DIR.mkdir(parents=True, exist_ok=True)

        url = get_platform_url()
        zip_path = KUBO_DIR / "kubo.zip"

        if progress_callback:
            progress_callback(f"Скачивание Kubo v{KUBO_VERSION}...")
        async with httpx.AsyncClient(timeout=300.0, follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            zip_path.write_bytes(resp.content)

        if progress_callback:
            progress_callback("Распаковка...")
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(KUBO_DIR)
        zip_path.unlink()

        # Init IPFS repo
        if progress_callback:
            progress_callback("Инициализация IPFS...")
        repo_dir = Path.home() / ".ipfs"
        repo_dir.mkdir(exist_ok=True)

        subprocess.run(
            [str(KUBO_EXE), "init"],
            capture_output=True,
            timeout=30,
            env={**os.environ, "IPFS_PATH": str(repo_dir)},
        )

        if progress_callback:
            progress_callback("Готово!")
        return {"success": True, "message": f"Kubo v{KUBO_VERSION} установлен"}
    except Exception as e:
        logger.error(f"Kubo install error: {e}")
        return {"success": False, "message": f"Ошибка установки: {e}"}


def start_daemon() -> dict:
    """Start IPFS daemon in background"""
    try:
        if is_running():
            return {"success": True, "message": "IPFS уже запущен"}

        if not is_installed():
            return {"success": False, "message": "IPFS не установлен"}

        repo_dir = Path.home() / ".ipfs"
        repo_dir.mkdir(exist_ok=True)

        # Start daemon
        subprocess.Popen(
            [str(KUBO_EXE), "daemon"],
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
            env={**os.environ, "IPFS_PATH": str(repo_dir)},
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        return {"success": True, "message": "IPFS демон запущен"}
    except Exception as e:
        logger.error(f"IPFS start error: {e}")
        return {"success": False, "message": f"Ошибка запуска: {e}"}


def stop_daemon() -> dict:
    """Stop IPFS daemon"""
    try:
        if not is_running():
            return {"success": True, "message": "IPFS уже остановлен"}

        subprocess.run(
            [str(KUBO_EXE), "shutdown"],
            capture_output=True,
            timeout=10,
            env={**os.environ, "IPFS_PATH": str(Path.home() / ".ipfs")},
        )
        return {"success": True, "message": "IPFS остановлен"}
    except Exception as e:
        logger.error(f"IPFS stop error: {e}")
        return {"success": False, "message": f"Ошибка остановки: {e}"}


def uninstall() -> dict:
    """Remove Kubo binary"""
    try:
        if KUBO_DIR.exists():
            shutil.rmtree(KUBO_DIR)
        return {"success": True, "message": "IPFS удалён"}
    except Exception as e:
        return {"success": False, "message": f"Ошибка удаления: {e}"}
