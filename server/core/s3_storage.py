import io
import logging
from pathlib import Path

from fastapi import UploadFile

from shared.config import settings

logger = logging.getLogger("nurchat_s3")


class S3Storage:
    def __init__(self):
        self.client = None
        self.bucket = settings.S3_BUCKET if hasattr(settings, "S3_BUCKET") else "nurchat-media"
        self._init_client()

    def _init_client(self):
        if not getattr(settings, "USE_S3_STORAGE", False):
            return
        try:
            import boto3
            self.client = boto3.client(
                "s3",
                endpoint_url=settings.S3_ENDPOINT,
                aws_access_key_id=settings.S3_ACCESS_KEY,
                aws_secret_access_key=settings.S3_SECRET_KEY,
                region_name=getattr(settings, "S3_REGION", "us-east-1"),
            )
            self.client.head_bucket(Bucket=self.bucket)
            logger.info("S3 connected: %s/%s", settings.S3_ENDPOINT, self.bucket)
        except Exception as exc:
            logger.warning("S3 unavailable, falling back to local storage: %s", exc)
            self.client = None

    async def save_file(self, file: UploadFile, file_id: str, file_type: str) -> dict:
        if self.client is None:
            raise RuntimeError("S3 not configured")

        await file.seek(0)
        content = await file.read()

        key = f"{file_type}/{file_id}/{file.filename}"

        extra_args = {}
        if file.content_type:
            extra_args["ContentType"] = file.content_type

        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=content,
            **extra_args,
        )

        url = f"{settings.S3_ENDPOINT}/{self.bucket}/{key}"
        return {
            "file_id": file_id,
            "filename": file.filename,
            "url": url,
            "key": key,
            "file_size": len(content),
            "file_type": file_type,
        }

    async def get_file_url(self, key: str) -> str:
        if self.client is None:
            raise RuntimeError("S3 not configured")
        return f"{settings.S3_ENDPOINT}/{self.bucket}/{key}"

    async def delete_file(self, key: str) -> bool:
        if self.client is None:
            return False
        try:
            self.client.delete_object(Bucket=self.bucket, Key=key)
            return True
        except Exception as exc:
            logger.error("S3 delete error: %s", exc)
            return False
