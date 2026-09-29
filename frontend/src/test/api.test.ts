import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockUser = { id: 'user_1', username: 'test', first_name: 'Test' }

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  // Pentest #1: access token lives in memory (tokenVault), never on disk.
  const { setSession } = await import('../services/tokenVault')
  setSession('test-token')
  localStorage.setItem('user', JSON.stringify(mockUser))
})

describe('api', () => {
  it('should set and clear session via vault (access never on disk)', async () => {
    const { api } = await import('../services/api')
    const { getAccessToken } = await import('../services/tokenVault')
    api.setToken('new-token', 'new-refresh')
    expect(getAccessToken()).toBe('new-token')
    expect(localStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem('refresh_token')).toBe('new-refresh')
    api.clearToken()
    expect(getAccessToken()).toBeNull()
    expect(api.isAuthenticated()).toBe(false)
    expect(localStorage.getItem('refresh_token')).toBeNull()
    expect(localStorage.getItem('user')).toBeNull()
  })

  it('should check authentication status', async () => {
    const { api } = await import('../services/api')
    expect(api.isAuthenticated()).toBe(true)
    api.clearToken()
    expect(api.isAuthenticated()).toBe(false)
  })

  it('should generate correct file URLs', async () => {
    const { api } = await import('../services/api')
    const url = api.getFileUrl('file_123')
    expect(url).toContain('file_123')
    expect(url).toContain('token=')
  })
})

describe('i18n', () => {
  it('should have Russian translations', async () => {
    const i18n = await import('../i18n')
    await i18n.default.changeLanguage('ru')
    const t = i18n.default.t
    expect(t('common.appName')).toBe('NurChat')
    expect(t('auth.login')).toBe('Войти')
    expect(t('chat.chats')).toBe('Чаты')
  })

  it('should switch to English', async () => {
    const i18n = await import('../i18n')
    await i18n.default.changeLanguage('en')
    expect(i18n.default.t('auth.login')).toBe('Sign In')
    expect(i18n.default.t('chat.chats')).toBe('Chats')
    await i18n.default.changeLanguage('ru')
    expect(i18n.default.t('auth.login')).toBe('Войти')
  })
})
