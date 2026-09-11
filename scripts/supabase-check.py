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
    raw = sys.argv[1] if len(sys.argv) > 1 else os.getenv("DATABASE_URL", "")
    sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
    from shared.config import normalize_database_url

    if not raw:
        # Fall back to .env / settings like the app does (already normalized)
        from shared.config import settings
        url = settings.DATABASE_URL
        print("URL source: .env / settings")
    else:
        url = normalize_database_url(raw)
        if url != raw.strip().strip("'\""):
            print("NOTE: password contained raw reserved chars — auto-encoded for the driver.")
            print("      The app does this automatically too; no need to re-encode by hand.")
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
    lowered = (parsed.hostname or "").lower()
    if "xxx" in lowered or "example" in lowered or "your-" in lowered or "<" in (parsed.hostname or ""):
        return fail(
            "Hostname looks like a TEMPLATE (xxx/example). Copy the real URI: "
            "Supabase dashboard → your project → Settings (gear icon) → Database → "
            "Connection string → URI. Host looks like db.abcdefghijklm.supabase.co"
        )

    try:
        import psycopg2
    except ImportError:
        return fail("psycopg2 not installed — pip install -r requirements.txt")

    try:
        conn = psycopg2.connect(url, connect_timeout=10)
    except UnicodeDecodeError:
        # Windows + Russian locale: libpq returns the OS error (e.g. DNS
        # failure) in cp1251, psycopg2 tries utf-8 and crashes, hiding the
        # real reason. 99% of the time here: hostname doesn't resolve.
        return fail(
            "Hostname does not resolve (Windows hid the real error behind "
            "an encoding crash). Check the host part of DATABASE_URL letter "
            "by letter against Supabase → Settings → Database."
        )
    except Exception as e:
        hint = str(e).split("\n")[0][:200]
        msg = "Cannot connect/login: " + hint
        low = hint.lower()
        if "password authentication failed" in low or "password" in low and "failed" in low:
            msg += " — wrong DB password (Supabase → Settings → Database → reset if lost)"
        elif "could not connect" in low or "timeout" in low or "nodename" in low or "name resolution" in low:
            msg += " — host unreachable (project still provisioning? wrong ref? no internet?)"
        elif "database" in low and ("does not exist" in low or "not exist" in low):
            msg += " — database name wrong (default is 'postgres')"
        else:
            msg += " — if the project was just created, wait 2-3 min for provisioning"
        return fail(msg)

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
