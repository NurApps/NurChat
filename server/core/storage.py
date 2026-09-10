import logging
import os
from datetime import datetime, timedelta
from pathlib import Path

import aiofiles
from fastapi import UploadFile

from shared.config import settings
from shared.exceptions import FileTooLargeError

from .security import SecurityManager

logger = logging.getLogger("nurchat")


def _safe_path(base: Path, *parts: str) -> Path:
    """Resolve path and ensure it stays inside base directory."""
    resolved = (base / Path(*parts)).resolve()
    if not resolved.is_relative_to(base.resolve()):
        raise ValueError("Path traversal detected")
    return resolved


def _strip_image_metadata(path: Path) -> None:
    """Remove EXIF/XMP metadata (GPS coords, device model, timestamps).

    - Animated images (GIF/WebP) are left untouched (re-save would kill frames).
    - Images without EXIF are left byte-identical (no recompression loss).
    - Orientation is baked into pixels first, so photos don't rotate.
    Never raises — upload must not fail because of metadata cleaning.
    """
    try:
        from PIL import Image, ImageOps

        with Image.open(path) as img:
            if getattr(img, "is_animated", False):
                return
            try:
                exif = img.getexif()
            except Exception:
                return
            if not exif:
                return
            img = ImageOps.exif_transpose(img)
            fmt = (img.format or path.suffix.lstrip(".") or "JPEG").upper()
            if fmt == "JPG":
                fmt = "JPEG"
            if fmt not in ("JPEG", "PNG", "WEBP", "BMP"):
                return
            kwargs = {"quality": 92} if fmt == "JPEG" else {}
            img.save(path, format=fmt, **kwargs)
            logger.debug("Stripped EXIF from %s", path.name)
    except Exception as e:
        logger.warning("EXIF strip failed for %s: %s", path.name, e)


class FileStorage:
    """Менеджер хранения файлов на сервере"""

    def __init__(self):
        self.media_root = Path(settings.MEDIA_ROOT).resolve()
        self.max_file_size = settings.MAX_FILE_SIZE
        self.create_directories()

    def create_directories(self):
        directories = [
            self.media_root,
            self.media_root / "images",
            self.media_root / "videos",
            self.media_root / "voice",
            self.media_root / "documents",
            self.media_root / "video_circles",
        ]
        for directory in directories:
            directory.mkdir(parents=True, exist_ok=True)

    def get_user_directory(self, user_id: str, file_type: str) -> Path:
        if "/" in user_id or "\\" in user_id or ".." in user_id:
            raise ValueError(f"Invalid user_id: {user_id}")

        type_folders = {
            "image": "images",
            "video": "videos",
            "voice": "voice",
            "document": "documents",
            "video_circle": "video_circles",
        }
        folder = type_folders.get(file_type, "documents")
        user_dir = _safe_path(self.media_root, folder, user_id)
        user_dir.mkdir(parents=True, exist_ok=True)
        return user_dir

    async def save_file(self, file: UploadFile, user_id: str, file_type: str) -> dict:
        await file.seek(0)

        file_id = SecurityManager.generate_file_id()
        file_extension = Path(file.filename).suffix if file.filename else ".bin"
        if len(file_extension) > 10:
            file_extension = ".bin"
        filename = f"{file_id}{file_extension}"

        user_dir = self.get_user_directory(user_id, file_type)
        file_path = _safe_path(user_dir, filename)

        chunk_size = 64 * 1024
        file_size = 0
        async with aiofiles.open(file_path, "wb") as f:
            while True:
                chunk = await file.read(chunk_size)
                if not chunk:
                    break
                file_size += len(chunk)
                if file_size > self.max_file_size:
                    await f.close()
                    file_path.unlink(missing_ok=True)
                    raise FileTooLargeError(f"Файл слишком большой. Максимум: {self.max_file_size} байт")
                await f.write(chunk)

        # Privacy: strip EXIF/XMP metadata (GPS, device info) from photos.
        # Relay must see pixels, not where/when/with-what they were taken.
        if file_type == "image":
            _strip_image_metadata(file_path)

        return {
            "file_id": file_id,
            "filename": filename,
            "file_path": str(file_path),
            "file_size": file_size,
            "file_type": file_type,
        }

    async def get_file_path(self, file_id: str, user_id: str) -> Path:
        for file_type in ["images", "videos", "voice", "documents", "video_circles"]:
            user_dir = _safe_path(self.media_root, file_type, user_id)
            if user_dir.exists():
                for file_path in user_dir.iterdir():
                    if file_path.is_file() and file_path.stem == file_id:
                        return file_path
        raise FileNotFoundError(f"Файл {file_id} не найден")

    async def delete_file(self, file_id: str, user_id: str, file_path: str | None = None) -> bool:
        try:
            if file_path:
                path = Path(file_path).resolve()
                if not path.is_relative_to(self.media_root):
                    raise ValueError("Path traversal detected")
            else:
                path = await self.get_file_path(file_id, user_id)
            path.unlink(missing_ok=True)
            return True
        except FileNotFoundError:
            return False

    async def cleanup_expired_files(self):
        cutoff_date = datetime.now() - timedelta(days=settings.FILE_TTL_DAYS)
        for root, dirs, files in os.walk(self.media_root):
            for file in files:
                file_path = Path(root) / file
                file_time = datetime.fromtimestamp(file_path.stat().st_mtime)
                if file_time < cutoff_date:
                    file_path.unlink()


file_storage = FileStorage()
