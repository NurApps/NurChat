const DEFAULT_API_HOST = "127.0.0.1:8000"
const DEFAULT_API_PROTOCOL = "http"

const RELAY_HOST_KEY = "nurchat_relay_host"
const RELAY_PROTOCOL_KEY = "nurchat_relay_protocol"
// Set after resolveDefaultRelay() picks a healthy public relay at startup
const RELAY_RESOLVED_KEY = "nurchat_relay_resolved"

export interface RelayConfig {
  host: string
  protocol: "http" | "https"
}

/**
 * Public relays hosted by the project (like Tox community bootstrap nodes).
 * Order matters — probed top-down at startup when the user has no manual
 * override. Add/remove entries here as infrastructure changes.
 *
 * NOTE: empty by default — the old workers.dev entry never resolved (DNS),
 * and a dead entry only adds a 4s startup hang before fallback to local.
 * Add your relay here once DEPLOY.md section 1 is done, e.g.:
 *   { host: "relay.example.com", protocol: "https" },
 */
export const PUBLIC_RELAYS: RelayConfig[] = [
  // { host: "relay.nurchat.app", protocol: "https" },
]

/**
 * Probe PUBLIC_RELAYS and return the first healthy one (or null).
 */
async function probePublicRelays(): Promise<RelayConfig | null> {
  // Previously resolved relay — use without re-probing
  try {
    const resolvedHost = localStorage.getItem(RELAY_RESOLVED_KEY)
    const resolvedProto = localStorage.getItem(RELAY_RESOLVED_KEY + "_proto")
    if (resolvedHost) {
      return { host: resolvedHost, protocol: resolvedProto === "https" ? "https" : "http" }
    }
  } catch { /* ignore */ }

  for (const candidate of PUBLIC_RELAYS) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 4000)
      const resp = await fetch(`https://${candidate.host}/health`, { signal: controller.signal })
      clearTimeout(timer)
      if (resp.ok) {
        try {
          localStorage.setItem(RELAY_RESOLVED_KEY, candidate.host)
          localStorage.setItem(RELAY_RESOLVED_KEY + "_proto", candidate.protocol)
        } catch { /* ignore */ }
        return candidate
      }
    } catch { /* next candidate */ }
  }
  return null
}

function apply(config: RelayConfig): void {
  apiHost = config.host
  apiProtocol = config.protocol
}

export function getRelayConfig(): RelayConfig {
  let host = import.meta.env.VITE_API_HOST || DEFAULT_API_HOST
  let protocol: "http" | "https" = import.meta.env.VITE_API_PROTOCOL === "https" ? "https" : "http"
  try {
    const savedHost = localStorage.getItem(RELAY_HOST_KEY)
    const savedProtocol = localStorage.getItem(RELAY_PROTOCOL_KEY)
    if (savedHost) host = savedHost
    if (savedProtocol === "https" || savedProtocol === "http") protocol = savedProtocol
  } catch { /* localStorage недоступен — используем env */ }
  return { host, protocol }
}

export function setRelayConfig(config: RelayConfig) {
  try {
    localStorage.setItem(RELAY_HOST_KEY, config.host)
    localStorage.setItem(RELAY_PROTOCOL_KEY, config.protocol)
    localStorage.removeItem(RELAY_RESOLVED_KEY)
    localStorage.removeItem(RELAY_RESOLVED_KEY + "_proto")
  } catch { /* ignore */ }
  apply(config)
}

export function resetRelayConfig() {
  try {
    localStorage.removeItem(RELAY_HOST_KEY)
    localStorage.removeItem(RELAY_PROTOCOL_KEY)
    localStorage.removeItem(RELAY_RESOLVED_KEY)
    localStorage.removeItem(RELAY_RESOLVED_KEY + "_proto")
  } catch { /* ignore */ }
  // Re-resolve on next startup; keep current session values until then
}

// Mutable module state — updated by resolution below.
let apiHost = import.meta.env.VITE_API_HOST || DEFAULT_API_HOST
let apiProtocol: "http" | "https" =
  import.meta.env.VITE_API_PROTOCOL === "https" ? "https" : "http"

export function getApiHost(): string { return apiHost }
export function getApiProtocol(): "http" | "https" { return apiProtocol }

// Top-level await: relay probing completes BEFORE any consumer computes
// BASE_URL, so the whole app uses the resolved relay from the first render.
// Skipped entirely when the host is set explicitly (env / user override).
if (!import.meta.env.VITE_API_HOST) {
  const hasOverride = (() => {
    try { return !!localStorage.getItem(RELAY_HOST_KEY) } catch { return false }
  })()
  if (!hasOverride) {
    const resolved = await probePublicRelays()
    if (resolved) apply(resolved)
  }
}

export const BASE_URL = `${apiProtocol}://${apiHost}`
export const WS_BASE = `${WS_PROTOCOL_FOR(apiProtocol)}://${apiHost}/ws`
export const MEDIA_URL = BASE_URL

function WS_PROTOCOL_FOR(p: "http" | "https"): "ws" | "wss" {
  return p === "https" ? "wss" : "ws"
}

export function avatarUrl(path: string | null | undefined): string | null {
  if (!path) return null
  return `${BASE_URL}/${path.replace(/\\/g, "/")}`
}
