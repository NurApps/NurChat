import { describe, it, expect, beforeEach } from 'vitest'

describe('p2pBridge P2P-first contract', () => {
  let bridge: typeof import('../services/p2pBridge')

  beforeEach(async () => {
    vi.resetModules()
    localStorage.clear()
    bridge = await import('../services/p2pBridge')
  })

  it('sendP2PTextMessage returns false and queues when peer is not connected', () => {
    const sent = bridge.sendP2PTextMessage('user_unknown', 'msg_1', 'hello')
    expect(sent).toBe(false)
  })

  it('isPeerConnected returns false for unknown peers', () => {
    expect(bridge.isPeerConnected('user_unknown')).toBe(false)
  })
})
