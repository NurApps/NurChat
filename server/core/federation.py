import json
import logging
import time
from pathlib import Path
from typing import Any

import httpx
from nacl.signing import SigningKey, VerifyKey
from nacl.encoding import HexEncoder

from shared.config import settings

logger = logging.getLogger(__name__)


class FederationManager:
    """Server-to-server federation: key management, signing, verification, relay."""

    def __init__(self):
        self._signing_key: SigningKey | None = None
        self._verify_key: VerifyKey | None = None
        self._server_name: str = settings.FEDERATION_SERVER_NAME
        self._enabled: bool = settings.USE_FEDERATION
        self._allowed_servers: set[str] = set()
        if settings.FEDERATION_ALLOWED_SERVERS.strip():
            self._allowed_servers = {
                s.strip() for s in settings.FEDERATION_ALLOWED_SERVERS.split(",") if s.strip()
            }

    @property
    def enabled(self) -> bool:
        return self._enabled

    @property
    def server_name(self) -> str:
        return self._server_name

    @property
    def public_key_hex(self) -> str:
        if not self._verify_key:
            self._load_or_generate_keys()
        return self._verify_key.encode(HexEncoder).decode()

    def _load_or_generate_keys(self):
        key_path = Path(settings.FEDERATION_SERVER_KEY_PATH)
        if key_path.exists():
            data = json.loads(key_path.read_text())
            self._signing_key = SigningKey(data["signing_key"], encoder=HexEncoder)
            self._verify_key = self._signing_key.verify_key
            logger.info("Loaded federation keys from %s", key_path)
        else:
            self._signing_key = SigningKey.generate()
            self._verify_key = self._signing_key.verify_key
            key_data = {
                "signing_key": self._signing_key.encode(HexEncoder).decode(),
                "verify_key": self._verify_key.encode(HexEncoder).decode(),
                "server_name": self._server_name,
            }
            key_path.write_text(json.dumps(key_data, indent=2))
            logger.info("Generated new federation keys -> %s", key_path)

    def sign(self, data: str) -> str:
        if not self._signing_key:
            self._load_or_generate_keys()
        signed = self._signing_key.sign(data.encode())
        return signed.signature.hex()

    def verify(self, data: str, signature_hex: str, server_name: str) -> bool:
        """Verify a signature using the remote server's public key."""
        import asyncio

        async def _fetch_key():
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(f"http://{server_name}/.well-known/nurchat.json")
                resp.raise_for_status()
                return resp.json()

        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as pool:
                    info = pool.submit(asyncio.run, _fetch_key()).result()
            else:
                info = loop.run_until_complete(_fetch_key())
        except Exception as e:
            logger.warning("Cannot fetch public key for %s: %s", server_name, e)
            return False

        remote_key_hex = info.get("public_key")
        if not remote_key_hex:
            return False

        try:
            vk = VerifyKey(bytes.fromhex(remote_key_hex))
            vk.verify(data.encode(), bytes.fromhex(signature_hex))
            return True
        except Exception:
            return False

    def is_server_allowed(self, server_name: str) -> bool:
        if not self._allowed_servers:
            return True
        return server_name in self._allowed_servers

    async def deliver_activity(self, target_server: str, activity: dict[str, Any]) -> bool:
        """Send a signed activity to a remote server's inbox."""
        if not self._enabled:
            logger.warning("Federation disabled, cannot deliver to %s", target_server)
            return False

        if not self.is_server_allowed(target_server):
            logger.warning("Server %s not in allowed list", target_server)
            return False

        payload_str = json.dumps(activity, sort_keys=True, separators=(",", ":"))
        signature = self.sign(payload_str)
        activity["signature"] = signature

        url = f"http://{target_server}/federation/inbox"
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(url, json=activity)
                if resp.status_code == 200:
                    logger.info("Delivered activity to %s", target_server)
                    return True
                else:
                    logger.warning("Delivery to %s failed: %s", target_server, resp.status_code)
                    return False
        except Exception as e:
            logger.warning("Delivery to %s error: %s", target_server, e)
            return False

    async def fetch_user_profile(self, server_name: str, username: str) -> dict | None:
        """Fetch a remote user's public profile."""
        if not self.is_server_allowed(server_name):
            return None

        url = f"http://{server_name}/federation/user/{username}"
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(url)
                if resp.status_code == 200:
                    return resp.json()
        except Exception as e:
            logger.warning("Failed to fetch user %s@%s: %s", username, server_name, e)
        return None

    def parse_address(self, address: str) -> tuple[str, str] | None:
        """Parse 'username@host:port' -> (username, host:port)."""
        if "@" not in address:
            return None
        parts = address.rsplit("@", 1)
        if len(parts) != 2 or not parts[0] or not parts[1]:
            return None
        return parts[0], parts[1]

    def make_address(self, username: str, server_name: str) -> str:
        return f"{username}@{server_name}"


# Global instance
federation = FederationManager()
