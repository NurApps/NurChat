import { describe, it, expect, beforeEach } from 'vitest'

const mockToken = 'test-token'
const mockUser = { id: 'user_1', username: 'test', first_name: 'Test' }

beforeEach(() => {
  localStorage.setItem('token', mockToken)
  localStorage.setItem('user', JSON.stringify(mockUser))
})

describe('api', () => {
  it('should set and clear token in localStorage', async () => {
    const { api } = await import('../services/api')
    api.setToken('new-token')
    expect(localStorage.getItem('token')).toBe('new-token')
    api.clearToken()
    expect(localStorage.getItem('token')).toBeNull()
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
