import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Refresh cycle: 401 → POST /refresh → retry once; dead refresh → logout.
describe('api refresh cycle', () => {
  const calls: string[] = []
  let refreshCalls = 0

  function mockFetch(refreshOk: boolean) {
    refreshCalls = 0
    calls.length = 0
    let chatsCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      calls.push(`${init?.method || 'GET'} ${u.split('/').slice(3).join('/')}`)
      if (u.includes('/api/auth/refresh')) {
        refreshCalls++
        if (!refreshOk) return new Response('{"detail":"bad"}', { status: 401 })
        return new Response(
          JSON.stringify({ access_token: 'new-access', refresh_token: 'new-refresh' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (u.includes('/api/chat/chats')) {
        chatsCalls++
        const auth = (init?.headers as Record<string, string> | undefined)?.['Authorization'] || ''
        // First call rides the stale in-memory access token → 401.
        if (chatsCalls === 1 && auth === 'Bearer old-access') {
          return new Response('{"detail":"expired"}', { status: 401 })
        }
        return new Response(JSON.stringify([]), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('{}', { status: 200 })
    }))
  }

  beforeEach(async () => {
    localStorage.clear()
    vi.resetModules()
    // Pentest #1: session seeds memory (vault), refresh persists for reload.
    const { setSession } = await import('../services/tokenVault')
    setSession('old-access', 'good-refresh')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('retries once after refresh on 401', async () => {
    mockFetch(true)
    const { api } = await import('../services/api')
    const { getAccessToken, peekRefreshToken } = await import('../services/tokenVault')
    const chats = await api.getChats()
    expect(chats).toEqual([])
    expect(getAccessToken()).toBe('new-access')
    expect(peekRefreshToken()).toBe('new-refresh')
    expect(localStorage.getItem('token')).toBeNull()
    expect(refreshCalls).toBe(1)
  })

  it('clears session and fires event when refresh is dead', async () => {
    mockFetch(false)
    const { api } = await import('../services/api')
    const { getAccessToken, peekRefreshToken } = await import('../services/tokenVault')
    const events: string[] = []
    const handler = (e: Event) => events.push(e.type)
    window.addEventListener('nurchat:auth-expired', handler)
    try {
      await expect(api.getChats()).rejects.toMatchObject({ status: 401 })
    } finally {
      window.removeEventListener('nurchat:auth-expired', handler)
    }
    expect(getAccessToken()).toBeNull()
    expect(peekRefreshToken()).toBeNull()
    expect(localStorage.getItem('refresh_token')).toBeNull()
    expect(events).toEqual(['nurchat:auth-expired'])
  })

  it('never auto-refreshes login itself', async () => {
    mockFetch(true)
    const { api } = await import('../services/api')
    // login 401 (wrong password) must surface, not trigger refresh
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })))
    await expect(api.login('u', 'wrong')).rejects.toMatchObject({ status: 401 })
    expect(refreshCalls).toBe(0)
  })
})

// Cross-tab single-flight: one tab POSTs, siblings adopt via BroadcastChannel.
// Access-JWT never touches localStorage — only the lock/seq signals do.
describe('api cross-tab refresh', () => {
  class FakeBC {
    static peers = new Map<string, Set<FakeBC>>()
    onmessage: ((ev: { data: unknown }) => void) | null = null
    constructor(private name: string) {
      if (!FakeBC.peers.has(name)) FakeBC.peers.set(name, new Set())
      FakeBC.peers.get(name)!.add(this)
    }
    postMessage(data: unknown) {
      for (const peer of FakeBC.peers.get(this.name) ?? []) {
        if (peer !== this) peer.onmessage?.({ data })
      }
    }
    close() {
      FakeBC.peers.get(this.name)?.delete(this)
    }
  }

  const winnerMsg = (access: string, refresh: string) => ({
    type: 'nurchat:refreshed',
    profile: null, // no active profile in tests
    access,
    refresh,
    at: Date.now(),
  })

  beforeEach(async () => {
    FakeBC.peers.clear()
    vi.stubGlobal('BroadcastChannel', FakeBC)
    localStorage.clear()
    vi.resetModules()
    const { setSession } = await import('../services/tokenVault')
    setSession('old-access', 'good-refresh')
  })

  it('adopts sibling tokens without POSTing /refresh', async () => {
    const { namespacedLSKey } = await import('../services/profiles')
    // Foreign tab holds the lock right now.
    localStorage.setItem(
      namespacedLSKey('refresh_lock'),
      JSON.stringify({ owner: 'other-tab', exp: Date.now() + 15000 }),
    )
    let refreshCalls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      refreshCalls++
      return new Response('{}', { status: 500 })
    }))
    const { refreshAccessToken } = await import('../services/api')
    const { getAccessToken, peekRefreshToken } = await import('../services/tokenVault')
    const p = refreshAccessToken()
    // Winner delivers while we wait.
    new FakeBC('nurchat:refresh').postMessage(winnerMsg('sib-access', 'sib-refresh'))
    expect(await p).toBe(true)
    expect(refreshCalls).toBe(0)
    expect(getAccessToken()).toBe('sib-access')
    expect(peekRefreshToken()).toBe('sib-refresh')
    expect(localStorage.getItem('token')).toBeNull()
  })

  it('proceeds alone when the lock is stale', async () => {
    const { namespacedLSKey } = await import('../services/profiles')
    localStorage.setItem(
      namespacedLSKey('refresh_lock'),
      JSON.stringify({ owner: 'dead-tab', exp: Date.now() - 1000 }),
    )
    let refreshCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/auth/refresh')) {
        refreshCalls++
        return new Response(
          JSON.stringify({ access_token: 'fresh-access', refresh_token: 'fresh-refresh' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 200 })
    }))
    const { refreshAccessToken } = await import('../services/api')
    const { getAccessToken } = await import('../services/tokenVault')
    expect(await refreshAccessToken()).toBe(true)
    expect(refreshCalls).toBe(1)
    expect(getAccessToken()).toBe('fresh-access')
  })

  it('adopts a sibling win after losing the POST race', async () => {
    const { namespacedLSKey } = await import('../services/profiles')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/auth/refresh')) {
        // Sibling rotated first: seq bumped, its repeat arrives shortly.
        localStorage.setItem(namespacedLSKey('refresh_seq'), '1')
        setTimeout(
          () => new FakeBC('nurchat:refresh').postMessage(winnerMsg('race-access', 'race-refresh')),
          50,
        )
        return new Response('{"detail":"revoked"}', { status: 401 })
      }
      return new Response('{}', { status: 200 })
    }))
    const { refreshAccessToken } = await import('../services/api')
    const { getAccessToken } = await import('../services/tokenVault')
    expect(await refreshAccessToken()).toBe(true)
    expect(getAccessToken()).toBe('race-access')
  })
})
