import logging
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy.orm import Session

from shared.config import settings

from ..core import models
from ..core.database import SessionLocal
from ..core.storage import file_storage

logger = logging.getLogger("nurchat")

class FileCleanupService:
    """Сервис автоматической очистки файлов для NurChat"""

    def __init__(self):
        self.scheduler = AsyncIOScheduler()
        self.is_running = False

    async def cleanup_expired_files(self):
        """Очистка просроченных файлов"""
        logger.info("Starting expired files cleanup...")

        db: Session = SessionLocal()
        try:
            # Рассчитываем дату истечения срока
            expiry_date = datetime.now(timezone.utc) - timedelta(days=settings.FILE_TTL_DAYS)

            # Находим просроченные файлы
            expired_files = db.query(models.File).filter(
                models.File.uploaded_at < expiry_date
            ).all()

            deleted_count = 0
            error_count = 0

            for file in expired_files:
                try:
                    # Удаляем физический файл
                    success = await file_storage.delete_file(file.id, file.user_id, file.file_path)

                    if success:
                        # Удаляем запись из БД
                        db.delete(file)
                        deleted_count += 1
                        logger.debug(f"File deleted: {file.filename} (user: {file.user_id})")
                    else:
                        error_count += 1
                        logger.warning(f"Не удалось удалить файл: {file.filename}")

                except Exception as e:
                    error_count += 1
                    logger.error(f"Ошибка при удалении файла {file.id}: {e}")

            db.commit()

            logger.info(f"Cleanup completed. Deleted: {deleted_count}, Errors: {error_count}")

        except Exception as e:
            logger.error(f"Error in cleanup service: {e}")
            db.rollback()
        finally:
            db.close()

    async def cleanup_orphaned_files(self):
        """Очистка файлов, не привязанных к сообщениям"""
        logger.info("Starting orphaned files cleanup...")

        db: Session = SessionLocal()
        try:
            # Находим файлы, которые не привязаны к сообщениям
            orphaned_files = db.query(models.File).outerjoin(
                models.Message, models.Message.file_id == models.File.id
            ).filter(
                models.Message.id.is_(None),
                models.File.uploaded_at < datetime.now(timezone.utc) - timedelta(hours=24)  # Старее 24 часов
            ).all()

            deleted_count = 0

            for file in orphaned_files:
                try:
                    success = await file_storage.delete_file(file.id, file.user_id, file.file_path)
                    if success:
                        db.delete(file)
                        deleted_count += 1
                except Exception as e:
                    logger.error(f"Ошибка при удалении orphaned файла {file.id}: {e}")

            db.commit()
            logger.info(f"Orphaned files deleted: {deleted_count}")

        except Exception as e:
            logger.error(f"Error in orphaned files cleanup: {e}")
            db.rollback()
        finally:
            db.close()

    async def cleanup_expired_ephemeral_messages(self):
        """Очистка просроченных эфемерных сообщений"""
        logger.info("Starting ephemeral messages cleanup...")

        db: Session = SessionLocal()
        try:
            now = datetime.now(timezone.utc)
            expired_messages = db.query(models.Message).filter(
                models.Message.expires_at.isnot(None),
                models.Message.expires_at < now,
                models.Message.is_deleted.is_(False)
            ).all()

            deleted_count = 0
            for msg in expired_messages:
                msg.is_deleted = True
                msg.deleted_for_all = True
                msg.content = "[удалено]"
                deleted_count += 1

            db.commit()
            logger.info(f"Ephemeral messages expired: {deleted_count}")

        except Exception as e:
            logger.error(f"Error in ephemeral messages cleanup: {e}")
            db.rollback()
        finally:
            db.close()

    async def cleanup_expired_p2p_messages(self):
        """Очистка невостребованных офлайн P2P-сообщений (глухой relay: не хранить дольше TTL)"""
        logger.info("Starting expired P2P pending messages cleanup...")

        db: Session = SessionLocal()
        try:
            expiry_date = datetime.now(timezone.utc) - timedelta(days=settings.P2P_PENDING_TTL_DAYS)
            deleted = db.query(models.P2PMessage).filter(
                models.P2PMessage.created_at < expiry_date
            ).delete(synchronize_session=False)
            # Delivered-but-unacked messages get a shorter grace period (24h)
            # so clients have time to ack before the relay discards them.
            delivered_cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
            deleted += db.query(models.P2PMessage).filter(
                models.P2PMessage.delivered_at.isnot(None),
                models.P2PMessage.delivered_at < delivered_cutoff,
            ).delete(synchronize_session=False)
            db.commit()
            logger.info(f"Expired P2P pending messages deleted: {deleted}")
        except Exception as e:
            logger.error(f"Error in P2P pending messages cleanup: {e}")
            db.rollback()
        finally:
            db.close()

    def start_cleanup_scheduler(self):
        """Запуск планировщика очистки"""
        if self.is_running:
            logger.warning("Cleanup scheduler already running")
            return

        # Очистка просроченных файлов каждые 6 часов
        self.scheduler.add_job(
            self.cleanup_expired_files,
            trigger=IntervalTrigger(hours=6),
            id="expired_files_cleanup"
        )

        # Очистка orphaned файлов каждые 12 часов
        self.scheduler.add_job(
            self.cleanup_orphaned_files,
            trigger=IntervalTrigger(hours=12),
            id="orphaned_files_cleanup"
        )

        # Очистка эфемерных сообщений каждые 60 секунд
        self.scheduler.add_job(
            self.cleanup_expired_ephemeral_messages,
            trigger=IntervalTrigger(seconds=60),
            id="ephemeral_messages_cleanup"
        )

        # Очистка просроченных P2P pending сообщений каждые 6 часов
        self.scheduler.add_job(
            self.cleanup_expired_p2p_messages,
            trigger=IntervalTrigger(hours=6),
            id="p2p_pending_cleanup"
        )

        self.scheduler.start()
        self.is_running = True
        logger.info("File cleanup scheduler started")

    def stop_cleanup_scheduler(self):
        """Остановка планировщика очистки"""
        if self.scheduler.running:
            self.scheduler.shutdown()
            self.is_running = False
            logger.info("File cleanup scheduler stopped")

# Глобальный экземпляр
file_cleanup_service = FileCleanupService()
