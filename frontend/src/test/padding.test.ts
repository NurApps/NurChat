import { describe, it, expect } from 'vitest'
import { padBytes, unpadBytes } from '../services/e2e'
import {
  padBytes as padGroup,
  unpadBytes as unpadGroup,
} from '../services/groupE2E'
import {
  generateFileKey,
  encryptFileBytes,
  decryptFileBytes,
  unpadFileBytes,
  FILE_PAD_BLOCK,
} from '../services/fileE2E'
import { secretboxEncrypt, randomBytes, secretboxNonceLength } from '../services/cryptoAdapter'

const enc = new TextEncoder()
const dec = new TextDecoder()

// Stage-1 deafening: bucketed sizes, legacy readability.
describe('text padding (1-1)', () => {
  it('buckets short texts to 512B', () => {
    expect(padBytes(enc.encode('да')).length).toBe(512)
    expect(padBytes(enc.encode('x'.repeat(500))).length).toBe(512)
    expect(padBytes(enc.encode('x'.repeat(600))).length).toBe(1024)
  })

  it('roundtrips', () => {
    const orig = enc.encode('привет, релей ничего не видит')
    expect(dec.decode(unpadBytes(padBytes(orig))!)).toBe(dec.decode(orig))
  })

  it('still reads pre-512 legacy 128B buckets', () => {
    const data = enc.encode('legacy')
    const out = new Uint8Array(128)
    new DataView(out.buffer).setUint32(0, data.length, false)
    out.set(data, 4)
    out.subarray(4 + data.length).set(randomBytes(128 - 4 - data.length))
    expect(dec.decode(unpadBytes(out)!)).toBe('legacy')
  })

  it('rejects garbage', () => {
    expect(unpadBytes(new Uint8Array([1, 2, 3]))).toBeNull()
    expect(unpadBytes(randomBytes(100))).toBeNull()
  })
})

describe('text padding (groups)', () => {
  it('buckets to 512B and reads legacy 128B', () => {
    expect(padGroup(enc.encode('да')).length).toBe(512)
    const data = enc.encode('old-group')
    const out = new Uint8Array(128)
    new DataView(out.buffer).setUint32(0, data.length, false)
    out.set(data, 4)
    expect(dec.decode(unpadGroup(out)!)).toBe('old-group')
  })
})

// getRandomValues caps a single call at 64KB — chunk large fixtures.
function bigRandom(size: number): Uint8Array {
  const out = new Uint8Array(size)
  let off = 0
  while (off < size) {
    const chunk = randomBytes(Math.min(32768, size - off))
    out.set(chunk, off)
    off += chunk.length
  }
  return out
}

describe('file padding', () => {
  it('buckets file bytes to 64KB and roundtrips', () => {
    const key = generateFileKey()
    for (const size of [0, 100, 65500, 70000]) {
      const orig = bigRandom(size)
      const stored = encryptFileBytes(orig, key)
      // nonce(24) + mac(16) + bucketed frame
      const frameLen = 8 + size
      const bucket = Math.ceil(frameLen / FILE_PAD_BLOCK) * FILE_PAD_BLOCK
      expect(stored.length).toBe(secretboxNonceLength + 16 + bucket)
      const back = decryptFileBytes(stored, key)!
      expect(back.length).toBe(size)
      expect(back).toEqual(orig)
    }
  })

  it('passes through legacy unframed files', () => {
    const key = generateFileKey()
    const orig = randomBytes(1234)
    const nonce = randomBytes(secretboxNonceLength)
    // legacy path: encrypted WITHOUT the NCF1 frame
    const box = secretboxEncrypt(orig, nonce, key)
    const stored = new Uint8Array(nonce.length + box.length)
    stored.set(nonce)
    stored.set(box, nonce.length)
    expect(decryptFileBytes(stored, key)).toEqual(orig)
  })

  it('rejects wrong key', () => {
    const stored = encryptFileBytes(randomBytes(50), generateFileKey())
    expect(decryptFileBytes(stored, generateFileKey())).toBeNull()
  })

  it('unpadFileBytes rejects non-frame', () => {
    expect(unpadFileBytes(randomBytes(FILE_PAD_BLOCK))).toBeNull()
  })
})
