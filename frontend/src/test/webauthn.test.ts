import { describe, it, expect } from 'vitest'
import { b64urlToBytes, bytesToB64url, isPasskeySupported } from '../services/webauthn'

describe('webauthn helpers', () => {
  it('round-trips base64url without padding', () => {
    const original = new Uint8Array([1, 2, 250, 0, 255, 16, 32])
    const encoded = bytesToB64url(original)
    expect(encoded).not.toContain('+')
    expect(encoded).not.toContain('/')
    expect(encoded).not.toContain('=')
    expect(Array.from(b64urlToBytes(encoded))).toEqual(Array.from(original))
  })

  it('handles credential-id style unpadded input', () => {
    // "cred-id-1" без паддинга, как хранит сервер.
    expect(Buffer.from(b64urlToBytes('Y3JlZC1pZC0x')).toString()).toBe('cred-id-1')
  })

  it('reports unsupported in jsdom', () => {
    // В jsdom нет PublicKeyCredential — кнопка должна прятаться.
    expect(isPasskeySupported()).toBe(false)
  })
})
