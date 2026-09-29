"""WS subprotocol auth helper.

Browsers cannot set an `Authorization` header on the WebSocket upgrade
request, so historically the JWT travelled in `?token=` (URL → leaks into
proxy logs, history, crash reports). The header-less alternative that
browsers DO support is `Sec-WebSocket-Protocol`: the client offers the
JWT as a subprotocol, the server echoes exactly that value back.

Server side: `main.py` extracts the token (subprotocol first, `?token=`
fallback for old clients) and stashes the negotiated value in
`websocket.scope["nurchat.ws_subprotocol"]`. Accept sites use
`accept_ws()` below so the handshake echoes the subprotocol — otherwise
browsers fail the connection with a protocol mismatch.
"""

from fastapi import WebSocket

SCOPE_KEY = "nurchat.ws_subprotocol"
MAX_TOKEN_LEN = 2048


def extract_ws_token(websocket: WebSocket, query_token: str | None) -> tuple[str | None, str | None]:
    """Return (effective_token, negotiated_subprotocol).

    Subprotocol wins over query param: new clients never put the token
    in the URL at all.
    """
    offered = websocket.headers.get("sec-websocket-protocol", "")
    subprotocol: str | None = None
    if offered:
        # Client offers exactly one protocol: the JWT. Take the first.
        candidate = offered.split(",")[0].strip()
        if candidate and len(candidate) <= MAX_TOKEN_LEN:
            subprotocol = candidate
    token = subprotocol or (query_token or None)
    if token and len(token) > MAX_TOKEN_LEN:
        return None, None
    if subprotocol is not None:
        websocket.scope[SCOPE_KEY] = subprotocol
    return token, subprotocol


async def accept_ws(websocket: WebSocket) -> None:
    """Accept the socket, echoing the negotiated subprotocol when present."""
    subprotocol = websocket.scope.get(SCOPE_KEY)
    if subprotocol:
        await websocket.accept(subprotocol=subprotocol)
    else:
        await websocket.accept()
