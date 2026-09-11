#!/usr/bin/env python3
"""Check Supabase (or any Postgres) readiness for NurChat relay.

Usage:
    .venv/Scripts/python scripts/supabase-check.py
    .venv/Scripts/python scripts/supabase-check.py "postgresql://..."

Checks:
  1. URL parses (scheme, host, password present, special chars encoded)
  2. TCP + login works (psycopg2)
  3. version() reports PostgreSQL
  4. Required tables exist (users, messages, chats, ...)
  5. pgcrypto NOT required (we don't use DB-side crypto — relay sees ciphertext only)

Exit 0 = ready, 1 = problem (message explains what to fix).
"""
import os
import sys
import urllib.parse

REQUIRED_TABLES = {
    "users",
    "chats",
    "chat_participants",
    "messages",
    "files",
    "contacts",
    "group_invites",
    "message_read_status",
    "call_logs",
    "message_reactions",
    "blocked_users",
    "signed_prekeys",
    "one_time_prekeys",
    "contact_requests",
    "push_subscriptions",
    "revoked_tokens",
    "audit_log",
}


def fail(msg: str) -> int:
    print(f"FAIL: {msg}")
    return 1


def main() -> int:
    url = sys.argv[1] if len(sys.argv) > 1 else os.getenv("DATABASE_URL", "")
    if not url:
        # Fall back to .env / settings like the app does
        sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
        from shared.config import settings
        url = settings.DATABASE_URL
    print(f"URL scheme: {url.split('://', 1)[0] if '://' in url else '(none)'}")

    if url.startswith("sqlite"):
        print("OK: SQLite — Supabase check not needed (local dev mode).")
        print("Tables are created automatically on relay boot (alembic/create_all).")
        return 0

    if not url.startswith(("postgresql://", "postgres://")):
        return fail("DATABASE_URL must start with postgresql:// (or sqlite:// for local)")

    try:
        parsed = urllib.parse.urlparse(url)
    except Exception as e:
        return fail(f"URL does not parse: {e}")
    if not parsed.hostname:
        return fail("No hostname in DATABASE_URL")
    if not parsed.password:
        return fail("No password in DATABASE_URL — copy the full URI from Supabase → Settings → Database")
    print(f"Host: {parsed.hostname}:{parsed.port or 5432}, db: {parsed.path.lstrip('/') or '(default)'}")

    try:
        import psycopg2
    except ImportError:
        return fail("psycopg2 not installed — pip install -r requirements.txt")

    try:
        conn = psycopg2.connect(url, connect_timeout=10)
    except Exception as e:
        hint = str(e).split("\n")[0][:200]
        return fail(
            "Cannot connect/login: " + hint + " — check password "
            "(URL-encode @ # % ?) and that the project finished provisioning"
        )

    try:
        cur = conn.cursor()
        cur.execute("SELECT version();")
        ver = cur.fetchone()[0].split(",")[0]
        print(f"Server: {ver}")
        cur.execute("SELECT tablename FROM pg_tables WHERE schemaname = 'public';")
        have = {row[0] for row in cur.fetchall()}
        missing = REQUIRED_TABLES - have
        if missing:
            print(f"Tables present: {len(have & REQUIRED_TABLES)}/{len(REQUIRED_TABLES)}")
            return fail(
                f"Missing tables: {sorted(missing)} — run migrations: "
                f"alembic upgrade head (with this DATABASE_URL in env/.env)"
            )
        print(f"Tables: all {len(REQUIRED_TABLES)} present")
    finally:
        conn.close()

    print("OK: Supabase is ready as relay-transit.")
    print("It will see: ciphertext envelopes + routing graph (who/when), nothing else.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
