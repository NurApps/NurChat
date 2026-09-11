"""Unit tests for DATABASE_URL normalization (Supabase passwords with special chars)."""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from shared.config import normalize_database_url


def test_sqlite_untouched():
    assert normalize_database_url("sqlite:///./nurchat.db") == "sqlite:///./nurchat.db"


def test_plain_password_untouched():
    url = "postgresql://postgres:simplepass123@db.xxx.supabase.co:5432/postgres"
    assert normalize_database_url(url) == url


def test_raw_special_chars_encoded():
    out = normalize_database_url("postgresql://postgres:p@ss#w?rd@db.xxx.supabase.co:5432/postgres")
    assert out == "postgresql://postgres:p%40ss%23w%3Frd@db.xxx.supabase.co:5432/postgres"


def test_already_encoded_not_double_encoded():
    url = "postgresql://postgres:p%40ss%23wrd@db.xxx.supabase.co:5432/postgres"
    assert normalize_database_url(url) == url


def test_bare_percent_encoded():
    out = normalize_database_url("postgresql://postgres:100%@db.h.co:5432/postgres")
    assert out == "postgresql://postgres:100%25@db.h.co:5432/postgres"


def test_pgbouncer_flag_dropped_others_kept():
    out = normalize_database_url(
        "postgresql://postgres:pw@db.h.co:5432/postgres?pgbouncer=true&sslmode=require"
    )
    assert out == "postgresql://postgres:pw@db.h.co:5432/postgres?sslmode=require"


def test_whitespace_and_quotes_stripped():
    out = normalize_database_url("  'postgresql://postgres:pw@db.h.co/postgres'  \n")
    assert out == "postgresql://postgres:pw@db.h.co/postgres"


def test_slash_in_password_survives():
    out = normalize_database_url("postgresql://postgres:a/b@db.h.co:5432/postgres")
    assert out == "postgresql://postgres:a%2Fb@db.h.co:5432/postgres"
