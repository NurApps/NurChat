import { describe, it, expect, beforeEach } from 'vitest'
import {
  TRANSFER_FORMAT,
  TRANSFER_VERSION,
  decryptTransferBundle,
  encryptTransferPayload,
  type TransferPayload,
} from '../services/transferBundle'
import { replacePlaintextCache, loadPlaintextCache } from '../services/plaintextCache'

beforeEach(() => {
  localStorage.clear()
})

function samplePayload(): TransferPayload {
  return {
    format: TRANSFER_FORMAT,
    version: TRANSFER_VERSION,
    exportedAt: Date.now(),
    relayHost: '127.0.0.1:8000',
    relayProtocol: 'http',
    username: 'alice',
    userId: 'user_1',
    identity: {
      privateKeyHex: 'a'.repeat(64),
      publicKeyHex: 'b'.repeat(64),
      signingPrivateHex: 'c'.repeat(64),
      signingPublicHex: 'd'.repeat(64),
      createdAt: Date.now(),
    },
    spk: null,
    opks: [],
    sessions: null,
    groupStates: null,
    outbox: null,
  }
}

describe('transferBundle crypto', () => {
  it('round-trips through password encryption', async () => {
    const payload = samplePayload()
    const envelope = await encryptTransferPayload(payload, 'correct-horse-8')
    expect(envelope.format).toBe(TRANSFER_FORMAT)
    const back = await decryptTransferBundle(envelope, 'correct-horse-8')
    expect(back.username).toBe('alice')
    expect(back.userId).toBe('user_1')
    expect(back.identity.publicKeyHex).toBe('b'.repeat(64))
  })

  it('rejects a wrong password without leaking', async () => {
    const envelope = await encryptTransferPayload(samplePayload(), 'correct-horse-8')
    await expect(decryptTransferBundle(envelope, 'wrong-password')).rejects.toThrow('bad-password')
  })

  it('rejects garbage envelopes', async () => {
    await expect(decryptTransferBundle(null, 'x')).rejects.toThrow('bad-format')
    await expect(decryptTransferBundle({ format: TRANSFER_FORMAT, version: 999 }, 'x')).rejects.toThrow('bad-format')
    await expect(decryptTransferBundle('not-json', 'x')).rejects.toThrow('bad-format')
  })

  it('carries own-message history and accepts legacy bundles', async () => {
    const payload = { ...samplePayload(), plaintext: { msg_1: 'hello', msg_2: 'world' } }
    const back = await decryptTransferBundle(await encryptTransferPayload(payload, 'pw-12345678'), 'pw-12345678')
    expect(back.plaintext).toEqual({ msg_1: 'hello', msg_2: 'world' })
    // Bundle without plaintext (created before history support) still imports.
    const { plaintext: _dropped, ...legacy } = payload
    const backLegacy = await decryptTransferBundle(await encryptTransferPayload(legacy as TransferPayload, 'pw-12345678'), 'pw-12345678')
    expect(backLegacy.plaintext).toBeUndefined()
  })

  it('replacePlaintextCache validates shape', () => {
    expect(replacePlaintextCache({ a: 'x', b: 1, c: null })).toBe(true)
    expect(loadPlaintextCache()).toEqual({ a: 'x' })
    expect(replacePlaintextCache(['not', 'an', 'object'])).toBe(false)
    expect(replacePlaintextCache(null)).toBe(false)
  })
})
