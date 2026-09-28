import { describe, it, expect, vi, beforeEach } from 'vitest'

const clearKeys = vi.fn(async () => {})
const resetMemoryCaches = vi.fn()
const clearToken = vi.fn()

vi.mock('../services/e2e', () => ({ clearKeys, resetMemoryCaches }))
vi.mock('../services/api', () => ({ api: { clearToken } }))

const { claimLocalKeys, performLogout, releaseLocalKeys } = await import('../services/localSession')
const { savePlaintext, getPlaintext } = await import('../services/plaintextCache')
const { useChatStore } = await import('../store/chatStore')

describe('localSession', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('first login adopts the keys without wiping', async () => {
    expect(await claimLocalKeys('a')).toBe(false)
    expect(clearKeys).not.toHaveBeenCalled()
    expect(localStorage.getItem('e2e_keys_owner')).toBe('a')
  })

  it('same user logging back in keeps keys and plaintext cache', async () => {
    await claimLocalKeys('a')
    savePlaintext('m1', 'hello')
    expect(await claimLocalKeys('a')).toBe(false)
    expect(clearKeys).not.toHaveBeenCalled()
    expect(getPlaintext('m1')).toBe('hello')
  })

  it('a different user wipes keys and plaintext cache, then owns the device', async () => {
    await claimLocalKeys('a')
    savePlaintext('m1', 'hello')
    expect(await claimLocalKeys('b')).toBe(true)
    expect(clearKeys).toHaveBeenCalledTimes(1)
    expect(getPlaintext('m1')).toBeNull()
    expect(localStorage.getItem('e2e_keys_owner')).toBe('b')
  })

  it('performLogout clears token, memory caches and the chat store', () => {
    useChatStore.setState({ chats: [{ id: 'c1' } as never], chatsLoaded: true, input: 'draft' })
    performLogout()
    expect(clearToken).toHaveBeenCalled()
    expect(resetMemoryCaches).toHaveBeenCalled()
    const s = useChatStore.getState()
    expect(s.chats).toEqual([])
    expect(s.chatsLoaded).toBe(false)
    expect(s.input).toBe('')
  })

  it('releaseLocalKeys forgets the owner and the plaintext cache', async () => {
    await claimLocalKeys('a')
    savePlaintext('m1', 'hello')
    releaseLocalKeys()
    expect(localStorage.getItem('e2e_keys_owner')).toBeNull()
    expect(getPlaintext('m1')).toBeNull()
  })
})
