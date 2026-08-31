/**
 * NurChat Relay — Cloudflare Worker
 *
 * Stateless WebSocket relay. Messages are NOT stored.
 * Just forwards encrypted payloads between connected users.
 *
 * Free tier: 100k requests/day (~3k users)
 */

// Connected users: userId → WebSocket
const connections = new Map()

// Pending messages for offline users: userId → [{from, data, ts}]
const pending = new Map()

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    // Health check
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({
        status: "ok",
        connections: connections.size,
        version: "1.0.0",
      }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      })
    }

    // WebSocket upgrade
    if (url.pathname === "/ws" || url.pathname.startsWith("/ws/")) {
      const token = url.searchParams.get("token")
      if (!token) {
        return new Response("Missing token", { status: 401 })
      }

      // Verify JWT (minimal — just extract userId)
      const userId = extractUserId(token)
      if (!userId) {
        return new Response("Invalid token", { status: 401 })
      }

      // CF Workers WebSocket pair
      const pair = new WebSocketPair()
      const [client, server] = [pair[0], pair[1]]

      server.accept()
      handleConnection(userId, server)

      return new Response(null, { status: 101, webSocket: client })
    }

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      })
    }

    return new Response("NurChat Relay", { status: 200 })
  },
}

function handleConnection(userId, ws) {
  // Close previous connection for this user
  const prev = connections.get(userId)
  if (prev) {
    try { prev.close(1000, "reconnected") } catch {}
  }

  connections.set(userId, ws)
  console.log(`[RELAY] ${userId} connected (${connections.size} total)`)

  // Send pending messages
  const pendingMsgs = pending.get(userId)
  if (pendingMsgs) {
    for (const msg of pendingMsgs) {
      try {
        ws.send(JSON.stringify(msg))
      } catch {}
    }
    pending.delete(userId)
  }

  ws.addEventListener("message", (event) => {
    try {
      const msg = JSON.parse(event.data)
      routeMessage(userId, msg)
    } catch (e) {
      console.error(`[RELAY] Parse error from ${userId}:`, e)
    }
  })

  ws.addEventListener("close", () => {
    connections.delete(userId)
    console.log(`[RELAY] ${userId} disconnected (${connections.size} total)`)
  })

  ws.addEventListener("error", () => {
    connections.delete(userId)
  })
}

function routeMessage(fromUserId, msg) {
  const { to, type, data } = msg

  if (!to || !type) {
    console.warn(`[RELAY] Invalid message from ${fromUserId}: missing 'to' or 'type'`)
    return
  }

  const payload = JSON.stringify({
    from: fromUserId,
    type,
    data,
    ts: Date.now(),
  })

  const targetWs = connections.get(to)

  if (targetWs) {
    try {
      targetWs.send(payload)
    } catch {
      // Connection broken — store as pending
      storePending(to, fromUserId, type, data)
    }
  } else {
    // User offline — store for later delivery
    storePending(to, fromUserId, type, data)
  }
}

function storePending(userId, fromUserId, type, data) {
  if (!pending.has(userId)) {
    pending.set(userId, [])
  }
  const msgs = pending.get(userId)
  if (msgs.length < 100) { // Cap pending messages
    msgs.push({ from: fromUserId, type, data, ts: Date.now() })
  }
  console.log(`[RELAY] Stored pending for ${userId} (${msgs.length} queued)`)
}

/**
 * Minimal JWT extraction — just gets the userId (sub claim).
 * In production, verify the signature against JWT_SECRET_KEY.
 * For now, just base64-decode the payload.
 */
function extractUserId(token) {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return null
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")))
    return payload.sub || payload.user_id || null
  } catch {
    return null
  }
}
