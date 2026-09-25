FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    curl \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY server/ server/
COPY shared/ shared/
COPY alembic/ alembic/
COPY alembic.ini .

# Create necessary directories
RUN mkdir -p /app/media /app/logs

EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# --proxy-headers: behind Caddy/Nginx all sockets arrive from the proxy IP.
# Without it websocket.client.host is identical for everyone and the WS
# limit (10/IP) becomes a GLOBAL 10-connection cap — the 11th concurrent
# user gets 4008. Trust X-Forwarded-For only from private nets (docker
# bridge, localhost), never from the open internet (else XFF spoofing
# dodges rate limits).
CMD ["uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log", "--timeout-keep-alive", "30", "--proxy-headers", "--forwarded-allow-ips", "127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"]
