from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from server.utils.logger import logger
from shared.config import settings
from shared.constants import FILE_TYPES
from shared.exceptions import FileTooLargeError, FileTypeNotAllowedError
from shared.rate_limiter import limiter

from ..core import models, schemas
from ..core.database import get_db
from ..core.security import verify_token_dependency
from ..core.storage import file_storage
from ..ws.notifications import notification_manager

router = APIRouter()

MAGIC_BYTES = {
    b'\xff\xd8\xff': 'image/jpeg',
    b'\x89PNG': 'image/png',
    b'GIF87a': 'image/gif',
    b'GIF89a': 'image/gif',
    b'RIFF': 'audio/webm',
    b'ID3': 'audio/mpeg',
    b'\x1a\x45\xdf\xa3': 'video/webm',
    b'\x00\x00\x00': None,
    b'%PDF': 'application/pdf',
    b'PK': 'application/zip',
    b'Rar!': 'application/x-rar',
}

def _detect_mime_type(header: bytes, filename: str) -> str:
    for magic, mime in MAGIC_BYTES.items():
        if header[:len(magic)] == magic and mime:
            return mime
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    # Active content formats are never allowed regardless of claimed type
    if ext in {"svg", "html", "htm", "xhtml", "js", "swf"}:
        return "blocked/active-content"
    ext_map = {
        "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
        "gif": "image/gif", "webp": "image/webp", "bmp": "image/bmp",
        "mp4": "video/mp4", "webm": "video/webm", "avi": "video/x-msvideo",
        "mp3": "audio/mpeg", "ogg": "audio/ogg", "wav": "audio/wav",
        "aac": "audio/aac", "m4a": "audio/x-m4a", "pdf": "application/pdf",
        "txt": "text/plain", "doc": "application/msword",
        "zip": "application/zip", "rar": "application/x-rar",
    }
    return ext_map.get(ext, "")


@router.post("/upload", response_model=schemas.FileUploadResponse)
@limiter.limit("10/minute")
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    file_type: str = Form(...),
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    try:
        logger.info(f"File upload started by user: {token['sub']}, filename: {file.filename}")

        if file_type not in FILE_TYPES.values():
            logger.warning(f"User {token['sub']} tried to upload unsupported file type: {file_type}")
            raise FileTypeNotAllowedError("Неподдерживаемый тип файла")

        # MIME type validation: read first bytes to detect actual type
        header = await file.read(16)
        await file.seek(0)
        detected_type = _detect_mime_type(header, file.filename or "")

        allowed_mimes = {
            "image": {"image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp"},
            "video": {"video/mp4", "video/webm", "video/quicktime", "video/x-msvideo", "video/avi"},
            "audio": {"audio/mpeg", "audio/ogg", "audio/wav", "audio/webm", "audio/aac", "audio/x-m4a"},
            "voice": {"audio/mpeg", "audio/ogg", "audio/wav", "audio/webm", "audio/mp4", "audio/x-m4a"},
            "document": {"application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument",
                         "text/plain", "application/zip", "application/x-rar"},
            "file": set(),
        }

        expected_mimes = allowed_mimes.get(file_type, set())
        if expected_mimes and detected_type and detected_type not in expected_mimes:
            logger.warning(f"User {token['sub']} MIME mismatch: claimed {file_type}, detected {detected_type}")
            raise FileTypeNotAllowedError(f"Файл не соответствует типу {file_type}")

        file.file.seek(0, 2)
        file_size = file.file.tell()
        file.file.seek(0)

        max_file_size = settings.MAX_FILE_SIZE
        if file_size > max_file_size:
            logger.warning(f"User {token['sub']} tried to upload file too large: {file_size} bytes")
            raise FileTooLargeError(f"Файл слишком большой. Максимум: {max_file_size} байт")

        user_id = token["sub"]

        file_info = await file_storage.save_file(file, user_id, file_type)
        file_id = file_info["file_id"]
        file_path = file_info["file_path"]

        now = datetime.now(timezone.utc)
        db_file = models.File(
            id=file_id,
            user_id=user_id,
            filename=file.filename,
            file_path=file_path,
            file_type=file_type,
            file_size=file_info["file_size"],
            ttl_days=30,
            uploaded_at=now,
        )
        db.add(db_file)
        db.commit()
        db.refresh(db_file)

        response = schemas.FileUploadResponse(
            id=file_id,
            filename=file.filename,
            file_path=file_path,
            file_type=file_type,
            file_size=file_info["file_size"],
            uploaded_at=now,
            user_id=user_id,
            ttl_days=30,
        )

        try:
            await notification_manager.send_file_upload_notification(
                user_id,
                response.model_dump()
            )
        except Exception as notify_error:
            logger.error(f"Failed to send file upload notification: {notify_error}")

        logger.info(f"File uploaded successfully: {file_id} by user: {user_id}")
        return response

    except FileTooLargeError as e:
        logger.warning(f"File too large error for user {token['sub']}: {e}")
        raise HTTPException(status_code=413, detail=str(e))
    except FileTypeNotAllowedError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Upload file error: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Ошибка загрузки: {str(e)}")


@router.get("/download/{file_id}")
async def download_file(
    file_id: str,
    token: str | None = None,
    db: Session = Depends(get_db),
):
    try:
        if not token:
            raise HTTPException(status_code=401, detail="Требуется токен")

        from server.core.security import AuthenticationError
        from server.core.security import security as sec
        try:
            payload = sec.verify_token(token)
        except AuthenticationError:
            raise HTTPException(status_code=401, detail="Неверный токен")
        user_id = payload.get("sub")

        logger.info(f"File download requested by user: {user_id}, file_id: {file_id}")

        file_record = db.query(models.File).filter(models.File.id == file_id).first()
        if not file_record:
            raise HTTPException(status_code=404, detail="Файл не найден")

        if file_record.user_id != user_id:
            message_with_file = db.query(models.Message).filter(
                models.Message.file_id == file_id,
                models.Message.is_deleted.is_(False)
            ).first()
            if message_with_file:
                participant = db.query(models.ChatParticipant).filter(
                    models.ChatParticipant.chat_id == message_with_file.chat_id,
                    models.ChatParticipant.user_id == user_id
                ).first()
                if not participant:
                    raise HTTPException(status_code=403, detail="Доступ к файлу запрещен")
            else:
                raise HTTPException(status_code=403, detail="Доступ к файлу запрещен")

        from pathlib import Path
        file_path = Path(file_record.file_path).resolve()
        media_root = Path(settings.MEDIA_ROOT).resolve()
        if not file_path.is_relative_to(media_root):
            logger.warning(f"Path traversal attempt by user {user_id}: {file_record.file_path}")
            raise HTTPException(status_code=403, detail="Доступ запрещен")

        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Файл не найден")

        import mimetypes
        mime_type = mimetypes.guess_type(file_record.filename or "")[0] or "application/octet-stream"

        return FileResponse(path=file_path, filename=file_record.filename, media_type=mime_type)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Download file error: {e}")
        raise


@router.delete("/delete/{file_id}")
async def delete_file(
    file_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    try:
        user_id = token["sub"]
        logger.info(f"File deletion requested by user: {user_id}, file_id: {file_id}")

        file_record = db.query(models.File).filter(models.File.id == file_id, models.File.user_id == user_id).first()
        if not file_record:
            raise HTTPException(status_code=404, detail="Файл не найден")

        success = await file_storage.delete_file(file_id, user_id, file_record.file_path)
        if success:
            db.delete(file_record)
            db.commit()
            return {"message": "Файл успешно удален"}
        raise HTTPException(status_code=500, detail="Ошибка удаления файла")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Delete file error: {e}")
        db.rollback()
        raise


@router.get("/my-files", response_model=list[schemas.FileResponse])
async def get_my_files(
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    user_id = token["sub"]
    logger.info(f"Getting files for user: {user_id}, skip: {skip}, limit: {limit}")

    if limit > 100:
        limit = 100

    files = (
        db.query(models.File).filter(models.File.user_id == user_id)
        .order_by(models.File.uploaded_at.desc())
        .offset(skip).limit(limit).all()
    )
    return [schemas.FileResponse.model_validate(f) for f in files]


@router.get("/storage-info", response_model=schemas.StorageInfo)
async def get_storage_info(
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    user_id = token["sub"]
    logger.info(f"Getting storage info for user: {user_id}")

    total_size = db.query(func.sum(models.File.file_size)).filter(models.File.user_id == user_id).scalar() or 0
    files_by_type = (
        db.query(models.File.file_type, func.count(models.File.id), func.sum(models.File.file_size))
        .filter(models.File.user_id == user_id)
        .group_by(models.File.file_type).all()
    )
    max_storage = 1024 * 1024 * 1024
    storage_info = schemas.StorageInfo(
        total_size=total_size,
        file_count=sum(count for _, count, _ in files_by_type),
        files_by_type=[
            {"type": file_type, "count": count, "size": size or 0}
            for file_type, count, size in files_by_type
        ],
        max_storage=max_storage,
        storage_used_percent=round((total_size / max_storage) * 100, 2),
    )
    return storage_info


@router.post("/cleanup-expired", response_model=schemas.CleanupResponse)
async def cleanup_expired_files(
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    try:
        user_id = token["sub"]
        logger.info(f"Manual cleanup requested by user: {user_id}")

        expiry_date = datetime.now(timezone.utc) - timedelta(days=30)
        expired_files = (
            db.query(models.File).filter(models.File.user_id == user_id, models.File.uploaded_at < expiry_date).all()
        )
        deleted_count = 0
        for file in expired_files:
            try:
                success = await file_storage.delete_file(file.id, user_id, file.file_path)
                if success:
                    db.delete(file)
                    deleted_count += 1
            except Exception as file_error:
                logger.error(f"Error deleting expired file {file.id}: {file_error}")
                continue
        db.commit()
        try:
            await notification_manager.send_system_notification(
                user_id,
                "Очистка файлов завершена",
                f"Удалено {deleted_count} просроченных файлов",
            )
        except Exception as notify_error:
            logger.error(f"Failed to send cleanup notification: {notify_error}")
        return schemas.CleanupResponse(
            message=f"Удалено {deleted_count} просроченных файлов", deleted_count=deleted_count
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Manual cleanup error: {e}")
        db.rollback()
        raise


@router.get("/all", response_model=list[schemas.FileResponse])
async def get_all_user_files(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    user_id = token["sub"]
    logger.info(f"Getting all files for user: {user_id}")

    if limit > 500:
        limit = 500

    files = (
        db.query(models.File).filter(models.File.user_id == user_id)
        .order_by(models.File.uploaded_at.desc())
        .offset(skip).limit(limit).all()
    )
    return [schemas.FileResponse.model_validate(f) for f in files]
