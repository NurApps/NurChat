import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers })

describe("refreshAccessToken", () => {
  beforeEach(() => {
    localStorage.clear()
    document.cookie = "csrf_token=; Max-Age=0"
    vi.resetModules()
  })
  afterEach(() => vi.unstubAllGlobals())

  it("sends X-CSRF-Token on /refresh, fetching one from /health after a reload", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
      if (url.endsWith("/health")) return json({ status: "healthy" }, { "X-CSRF-Token": "csrf-from-health" })
      return json({ access_token: "new-access", refresh_token: "new-refresh" })
    }))
    const { setSession } = await import("../services/tokenVault")
    setSession("old-access", "old-refresh")
    const { refreshAccessToken } = await import("../services/api")

    expect(await refreshAccessToken()).toBe(true)
    const refresh = calls.find((c) => c.url.endsWith("/api/auth/refresh"))!
    expect(refresh.headers["X-CSRF-Token"]).toBe("csrf-from-health")
  })
})
