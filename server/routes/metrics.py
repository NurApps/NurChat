"""Prometheus metrics endpoints for NurChat."""
from fastapi import APIRouter
from starlette.responses import Response

from shared.config import settings

router = APIRouter()


@router.get("/metrics")
async def metrics():
    """Prometheus metrics endpoint."""
    if not settings.ENABLE_METRICS:
        return Response(
            content='{"error": "Metrics disabled"}',
            status_code=404,
            media_type="application/json",
        )

    from prometheus_client import REGISTRY, generate_latest

    return Response(
        content=generate_latest(REGISTRY),
        media_type="text/plain; version=0.0.4; charset=utf-8",
    )
