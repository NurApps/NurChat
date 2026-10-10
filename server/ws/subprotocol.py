"""WS subprotocol auth helper.

Browsers cannot set an `Authorization` header on the WebSocket upgrade
request, so historically the JWT travelled in `?token=` (URL → leaks into
proxy logs, history, crash reports). The header-less alternative that
browsers DO support is `Sec-WebSocket-Protocol`: the client offers the
JWT as a subprotocol, the server echoes exactly that value back.

Server side: `main.py` requires the subprotocol and rejects `?token=`
with 4001 (query auth removed — proxy logs/history leak). Accept sites use
`accept_ws()` below so the handshake echoes the subprotocol — otherwise
browsers fail the connection with a protocol mismatch.
"""

from fastapi import WebSocket

SCOPE_KEY = "nurchat.ws_subprotocol"
MAX_TOKEN_LEN = 2048
QUERY_TOKEN_REMOVED_REASON = "Token in URL no longer accepted; use Sec-WebSocket-Protocol"


def extract_ws_token(
    websocket: WebSocket,
    query_token: str | None = None,
    *,
    allow_query_fallback: bool = False,
) -> tuple[str | None, str | None]:
    """Return (effective_token, negotiated_subprotocol).

    Query-param auth is OFF by default (URL tokens leak into proxy logs).
    `allow_query_fallback=True` exists only for tests of the old behaviour —
    production endpoints never pass it.
    """
    offered = websocket.headers.get("sec-websocket-protocol", "")
    subprotocol: str | None = None
    if offered:
        # Client offers exactly one protocol: the JWT. Take the first.
        candidate = offered.split(",")[0].strip()
        if candidate and len(candidate) <= MAX_TOKEN_LEN:
            subprotocol = candidate
    token = subprotocol or (query_token if allow_query_fallback else None)
    if token and len(token) > MAX_TOKEN_LEN:
        return None, None
    if subprotocol is not None:
        websocket.scope[SCOPE_KEY] = subprotocol
    return token, subprotocol


async def reject_legacy_query_token(websocket: WebSocket) -> bool:
    """Close when `?token=` is used: URL auth was removed (pentest #3).

    Explicit 4001 with a clear reason (instead of a confusing "Token
    required") so old clients log an actionable message. Returns True
    when the socket was closed — caller must release its rate-limit slot.
    """
    if websocket.query_params.get("token"):
        from server.utils.logger import logger

        logger.warning("WS ?token= rejected: query auth removed, use Sec-WebSocket-Protocol")
        await websocket.close(code=4001, reason=QUERY_TOKEN_REMOVED_REASON)
        return True
    return False


async def accept_ws(websocket: WebSocket) -> None:
    """Accept the socket, echoing the negotiated subprotocol when present."""
    subprotocol = websocket.scope.get(SCOPE_KEY)
    if subprotocol:
        await websocket.accept(subprotocol=subprotocol)
    else:
        await websocket.accept()
