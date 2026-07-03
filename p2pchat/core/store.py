from __future__ import annotations

import sqlite3
from pathlib import Path

DB = Path.home() / ".p2pchat" / "idb.sqlite"


class LocalStore:
    def __init__(self):
        DB.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(DB), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS me(
              id TEXT PRIMARY KEY,
              username TEXT UNIQUE,
              display_name TEXT,
              public_key TEXT NOT NULL,
              private_key TEXT NOT NULL,
              created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS peers(
              id TEXT PRIMARY KEY,
              username TEXT,
              display_name TEXT,
              public_key TEXT,
              host TEXT,
              port INTEGER,
              last_seen TEXT DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS chats(
              id TEXT PRIMARY KEY,
              name TEXT,
              is_group INTEGER DEFAULT 0,
              created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS members(
              chat_id TEXT,
              peer_id TEXT,
              PRIMARY KEY (chat_id, peer_id)
            );
            CREATE TABLE IF NOT EXISTS messages(
              id TEXT PRIMARY KEY,
              chat_id TEXT NOT NULL,
              sender TEXT NOT NULL,
              content TEXT NOT NULL,
              kind TEXT DEFAULT 'text',
              ts TEXT DEFAULT CURRENT_TIMESTAMP,
              file_path TEXT,
              file_type TEXT,
              reply_to TEXT
            );
            CREATE TABLE IF NOT EXISTS chat_keys(
              chat_id TEXT PRIMARY KEY,
              peers_json TEXT NOT NULL,
              key_digest TEXT NOT NULL,
              enc_for_me TEXT,
              created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_msg_chat ON messages(chat_id, ts);
            """
        )
        self.conn.commit()

    def save_me(self, pid, username, pub, priv, display_name=None):
        self.conn.execute(
            "INSERT OR REPLACE INTO me VALUES (?,?,?,?,?,COALESCE((SELECT created_at FROM me WHERE id=?), CURRENT_TIMESTAMP))",
            (pid, username, display_name, pub, priv, pid),
        )
        self.conn.commit()

    def me(self) -> dict | None:
        r = self.conn.execute("SELECT * FROM me LIMIT 1").fetchone()
        return dict(r) if r else None

    def peers(self) -> list[dict]:
        return [dict(r) for r in self.conn.execute("SELECT * FROM peers")]

    def upsert_peer(self, pid, username, pub, host=None, port=None, display_name=None):
        self.conn.execute(
            "INSERT OR REPLACE INTO peers (id, username, display_name, public_key, host, port) "
            "VALUES (?,?,?,?,?,?)",
            (pid, username, display_name, pub, host, port),
        )
        self.conn.commit()

    def touch_peer(self, pid, host=None, port=None):
        self.conn.execute(
            "UPDATE peers SET last_seen=CURRENT_TIMESTAMP, host=COALESCE(?,host), port=COALESCE(?,port) WHERE id=?",
            (host, port, pid),
        )
        self.conn.commit()

    def save_chat(self, cid, name, is_group, peer_ids):
        self.conn.execute("INSERT OR REPLACE INTO chats (id, name, is_group) VALUES (?,?,?)", (cid, name, int(is_group)))
        self.conn.execute("DELETE FROM members WHERE chat_id=?", (cid,))
        self.conn.executemany("INSERT OR IGNORE INTO members VALUES (?,?)", [(cid, p) for p in peer_ids])
        self.conn.commit()

    def chats(self) -> list[dict]:
        return [dict(r) for r in self.conn.execute("SELECT * FROM chats ORDER BY created_at DESC")]

    def members(self, chat_id):
        return [dict(r)["peer_id"] for r in self.conn.execute("SELECT peer_id FROM members WHERE chat_id=?", (chat_id,))]

    def log(self, mid, chat_id, sender, content, kind="text", file_path=None, file_type=None, reply_to=None):
        self.conn.execute(
            "INSERT OR REPLACE INTO messages VALUES (?,?,?,?,?,COALESCE((SELECT ts FROM messages WHERE id=?), CURRENT_TIMESTAMP),?,?,?)",
            (mid, chat_id, sender, content, kind, mid, file_path, file_type, reply_to),
        )
        self.conn.commit()

    def history(self, chat_id, limit=200):
        return [
            dict(r)
            for r in self.conn.execute(
                "SELECT * FROM messages WHERE chat_id=? ORDER BY ts DESC LIMIT ?", (chat_id, limit)
            )
        ][::-1]
