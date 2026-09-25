const DEFAULT_API_HOST = "127.0.0.1:8000"
const DEFAULT_API_PROTOCOL = "http"

const RELAY_HOST_KEY = "nurchat_relay_host"
const RELAY_PROTOCOL_KEY = "nurchat_relay_protocol"
// Set after resolveDefaultRelay() picks a healthy public relay at startup
const RELAY_RESOLVED_KEY = "nurchat_relay_resolved"
// Явно выбранный релей (env/?relay=/ручной ввод) против молчаливого
// дефолта на localhost. Неявный дефолт никого никуда не ведёт: у тестера
// без своего релея localhost мёртв, а регистрация ушла бы не на тот relay.
const RELAY_EXPLICIT_KEY = "nurchat_relay_explicit"

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
 *
 * Probe order is SHUFFLED on every fresh resolve so load spreads across
 * community relays instead of hammering the first entry. The winner is
 * then sticky (cached in localStorage) — accounts live on ONE relay,
 * so re-rolling randomly on every launch would log the user out.
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

  const shuffled = [...PUBLIC_RELAYS]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }

  for (const candidate of shuffled) {
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

/**
 * Парсинг ?relay= из ссылки-приглашения (чистая функция — покрыта тестами).
 * Принимает `?relay=host[:port]`, полный URL `?relay=https://host[:port]/...`
 * или пару `?relayHost=` + `?relayProtocol=http|https`.
 * Возвращает null, если параметр отсутствует или мусор.
 *
 * Безопасность: http разрешён только для loopback/LAN (иначе токены и
 * E2E-конверты ушли бы открытым текстом через чужую сеть) — публичный
 * хост насильно переводится на https.
 */
export function parseRelayParam(search: string): RelayConfig | null {
  let params: URLSearchParams
  try {
    params = new URLSearchParams(search.startsWith("?") ? search : `?${search}`)
  } catch {
    return null
  }
  let raw = (params.get("relay") || params.get("relayHost") || "").trim()
  if (!raw) return null

  let schemeProto: "http" | "https" | null = null
  const schemeMatch = raw.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/(.+)$/)
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase()
    if (scheme !== "http" && scheme !== "https") return null
    schemeProto = scheme
    raw = schemeMatch[2]
  }
  // Отрезаем путь/query/fragment, чистим слэши и пробелы.
  raw = raw.split(/[/?#]/)[0].trim().replace(/\/+$/, "").toLowerCase()
  // Запрещаем credentials/userinfo и мусор: только host[:port].
  if (!raw || raw.includes("@") || !/^[a-z0-9.-]+(?::\d{1,5})?$/.test(raw)) return null

  const hostOnly = raw.split(":")[0]
  const isLocal =
    hostOnly === "localhost" ||
    hostOnly === "127.0.0.1" ||
    hostOnly === "::1" ||
    hostOnly.endsWith(".local") ||
    /^10\./.test(hostOnly) ||
    /^192\.168\./.test(hostOnly) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostOnly)

  const paramProto = params.get("relayProtocol")
  let protocol: "http" | "https" =
    schemeProto ??
    (paramProto === "http" || paramProto === "https" ? paramProto : "https")
  if (!isLocal) protocol = "https"
  return { host: raw, protocol }
}

/** True, если релей выбран явно (env/?relay=/ручной ввод), а не дефолт. */
export function isRelayExplicit(): boolean {
  if (import.meta.env.VITE_API_HOST) return true
  try {
    if (localStorage.getItem(RELAY_EXPLICIT_KEY) === "1") return true
    // Совместимость: старый сохранённый выбор тоже явный.
    if (localStorage.getItem(RELAY_HOST_KEY)) return true
  } catch { /* ignore */ }
  return false
}

function markRelayExplicit(): void {
  try {
    localStorage.setItem(RELAY_EXPLICIT_KEY, "1")
  } catch { /* ignore */ }
}

/** ?relay= из адресной строки (ссылка-приглашение). Одноразовый: применили — съели. */
function consumeRelayParam(): RelayConfig | null {
  try {
    if (typeof window === "undefined") return null
    const parsed = parseRelayParam(window.location.search)
    if (!parsed) return null
    // Применили — параметр из URL убираем, чтобы перезагрузка/репост
    // ссылки не перетирали осознанный выбор в настройках.
    window.history.replaceState(null, "", window.location.pathname)
    return parsed
  } catch {
    return null
  }
}

export function getRelayConfig(): RelayConfig {
  // Приоритет: ?relay= (ссылка) > сохранённый выбор > env > дефолт.
  // ?relay= сразу персистим: перезагрузка не должна ронять тестера
  // обратно на localhost.
  const fromLink = consumeRelayParam()
  if (fromLink) {
    try {
      localStorage.setItem(RELAY_HOST_KEY, fromLink.host)
      localStorage.setItem(RELAY_PROTOCOL_KEY, fromLink.protocol)
      localStorage.removeItem(RELAY_RESOLVED_KEY)
      localStorage.removeItem(RELAY_RESOLVED_KEY + "_proto")
    } catch { /* ignore */ }
    markRelayExplicit()
    return fromLink
  }
  if (import.meta.env.VITE_API_HOST) {
    markRelayExplicit()
  }
  let host = import.meta.env.VITE_API_HOST || DEFAULT_API_HOST
  let protocol: "http" | "https" = import.meta.env.VITE_API_PROTOCOL === "https" ? "https" : "http"
  try {
    const savedHost = localStorage.getItem(RELAY_HOST_KEY)
    const savedProtocol = localStorage.getItem(RELAY_PROTOCOL_KEY)
    if (savedHost) {
      host = savedHost
      markRelayExplicit()
    }
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
  markRelayExplicit()
  apply(config)
}

export function resetRelayConfig() {
  try {
    localStorage.removeItem(RELAY_HOST_KEY)
    localStorage.removeItem(RELAY_PROTOCOL_KEY)
    localStorage.removeItem(RELAY_RESOLVED_KEY)
    localStorage.removeItem(RELAY_RESOLVED_KEY + "_proto")
    localStorage.removeItem(RELAY_EXPLICIT_KEY)
  } catch { /* ignore */ }
  // Re-resolve on next startup; keep current session values until then
}

// Mutable module state — updated by resolution below.
// IMPORTANT: seed from getRelayConfig() (env + saved localStorage override),
// not from env alone — otherwise a relay picked in ServerBootOverlay/Settings
// is forgotten on every reload and the app loops on 127.0.0.1:8000 forever.
const _initialRelay = getRelayConfig()
let apiHost = _initialRelay.host
let apiProtocol: "http" | "https" = _initialRelay.protocol

export function getApiHost(): string { return apiHost }
export function getApiProtocol(): "http" | "https" { return apiProtocol }

// Top-level await: relay probing completes BEFORE any consumer computes
// BASE_URL, so the whole app uses the resolved relay from the first render.
// Skipped entirely when the host is set explicitly (env / user override).
// Desktop-only: the app always runs inside Tauri, never as a hosted page.
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
  const normalized = path.replace(/\\/g, "/")
  // Allowlist: сервер кладёт аватары только в
  // media/avatars/<user_id>/avatar_<ts>.<ext> (см. auth.py:531).
  // Чужой/битый путь (схемы, .., кавычки) URL не получает — вместо картинки
  // показывается буквенный аватар. Заодно закрывает CodeQL
  // js/xss-through-dom на всех <img src={avatarUrl(...)}>: src всегда
  // собирается из доверенного BASE_URL + безопасного относительного пути,
  // javascript:-схема невозможна, а React ставит src как DOM-свойство
  // без парсинга HTML.
  if (!/^media\/avatars\/[A-Za-z0-9_-]+\/avatar_\d+\.(jpg|jpeg|png|webp)$/i.test(normalized)) return null
  return `${BASE_URL}/${normalized}`
}
