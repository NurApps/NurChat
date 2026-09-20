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
        if (chatsCalls === 1 && localStorage.getItem('token') === 'old-access') {
          return new Response('{"detail":"expired"}', { status: 401 })
        }
        return new Response(JSON.stringify([]), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('{}', { status: 200 })
    }))
  }

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('token', 'old-access')
    localStorage.setItem('refresh_token', 'good-refresh')
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('retries once after refresh on 401', async () => {
    mockFetch(true)
    const { api } = await import('../services/api')
    const chats = await api.getChats()
    expect(chats).toEqual([])
    expect(localStorage.getItem('token')).toBe('new-access')
    expect(localStorage.getItem('refresh_token')).toBe('new-refresh')
    expect(refreshCalls).toBe(1)
  })

  it('clears session and fires event when refresh is dead', async () => {
    mockFetch(false)
    const { api } = await import('../services/api')
    const events: string[] = []
    const handler = (e: Event) => events.push(e.type)
    window.addEventListener('nurchat:auth-expired', handler)
    try {
      await expect(api.getChats()).rejects.toMatchObject({ status: 401 })
    } finally {
      window.removeEventListener('nurchat:auth-expired', handler)
    }
    expect(localStorage.getItem('token')).toBeNull()
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
