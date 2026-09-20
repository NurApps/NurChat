/**
 * Tests for secureStorage module — Phase 1: Key Storage Hardening
 *
 * Note: IndexedDB tests are skipped in jsdom (no native IndexedDB).
 * These test the pure utility functions only.
 * Full integration tests should run in a real browser or with fake-indexeddb.
 */
import { describe, it, expect, beforeEach } from "vitest"
import {
  zeroize,
  zeroizeAll,
  secureCompare,
  bytesToHex,
  hexToBytesSecure,
  secureRandom,
  hasLegacyKeys,
} from "../services/secureStorage"

describe("zeroize", () => {
  it("should zero out a buffer", () => {
    const buf = new Uint8Array([1, 2, 3, 4, 5])
    zeroize(buf)
    // Bytes wiped, buffer NOT detached (detaching shared/live buffers
    // destroyed session material — see cryptoAdapter boxKeyPairFromSecretKey).
    expect(Array.from(buf)).toEqual([0, 0, 0, 0, 0])
    expect(buf.byteLength).toBe(5)
  })

  it("should handle null gracefully", () => {
    expect(() => zeroize(null)).not.toThrow()
  })

  it("should handle empty buffer", () => {
    const buf = new Uint8Array(0)
    expect(() => zeroize(buf)).not.toThrow()
  })
})

describe("zeroizeAll", () => {
  it("should zero out multiple buffers", () => {
    const buf1 = new Uint8Array([1, 2])
    const buf2 = new Uint8Array([3, 4])
    const buf3 = new Uint8Array([5, 6])
    zeroizeAll(buf1, buf2, buf3)
    // Wiped in place, not detached (see above).
    expect(Array.from(buf1)).toEqual([0, 0])
    expect(Array.from(buf2)).toEqual([0, 0])
    expect(Array.from(buf3)).toEqual([0, 0])
  })

  it("should handle null in buffer list", () => {
    const buf1 = new Uint8Array([1, 2])
    zeroizeAll(buf1, null)
    expect(Array.from(buf1)).toEqual([0, 0])
  })
})

describe("secureCompare", () => {
  it("should return true for equal buffers", () => {
    const a = new Uint8Array([1, 2, 3])
    const b = new Uint8Array([1, 2, 3])
    expect(secureCompare(a, b)).toBe(true)
  })

  it("should return false for different buffers", () => {
    const a = new Uint8Array([1, 2, 3])
    const b = new Uint8Array([1, 2, 4])
    expect(secureCompare(a, b)).toBe(false)
  })

  it("should return false for different lengths", () => {
    const a = new Uint8Array([1, 2, 3])
    const b = new Uint8Array([1, 2])
    expect(secureCompare(a, b)).toBe(false)
  })
})

describe("hexToBytesSecure / bytesToHex", () => {
  it("should convert hex to bytes and back", () => {
    const hex = "deadbeef0123456789abcdef"
    const bytes = hexToBytesSecure(hex)
    expect(bytesToHex(bytes)).toBe(hex)
  })

  it("should handle empty hex", () => {
    const bytes = hexToBytesSecure("")
    expect(bytes.length).toBe(0)
  })

  it("should handle uppercase hex", () => {
    const hex = "DEADBEEF"
    const bytes = hexToBytesSecure(hex)
    expect(bytesToHex(bytes)).toBe(hex.toLowerCase())
  })
})

describe("secureRandom", () => {
  it("should generate random bytes of correct length", () => {
    const buf = secureRandom(32)
    expect(buf.length).toBe(32)
  })

  it("should generate different values each time", () => {
    const buf1 = secureRandom(32)
    const buf2 = secureRandom(32)
    expect(secureCompare(buf1, buf2)).toBe(false)
  })

  it("should generate 16 bytes for nonces", () => {
    const buf = secureRandom(16)
    expect(buf.length).toBe(16)
  })
})

describe("hasLegacyKeys", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("should return false when no legacy keys exist", () => {
    expect(hasLegacyKeys()).toBe(false)
  })

  it("should return true when legacy keys exist", () => {
    localStorage.setItem("e2e_keys", "some-encrypted-data")
    expect(hasLegacyKeys()).toBe(true)
  })
})

describe("keypair-from-secret aliasing", () => {
  it("boxKeyPairFromSecretKey returns an independent copy", async () => {
    const { boxKeyPairFromSecretKey, boxBefore } = await import("../services/cryptoAdapter")
    const secret = new Uint8Array(32).fill(7)
    const kp = boxKeyPairFromSecretKey(secret)
    // Zeroizing the input (standard practice after init) must NOT destroy
    // the pair: regression test for detached-buffer session corruption.
    zeroize(secret)
    expect(Array.from(secret)).toEqual(new Array(32).fill(0))
    expect(kp.secretKey.length).toBe(32)
    expect(() => Array.from(kp.secretKey)).not.toThrow()
    // And the copy must still be usable (shared secret derivable).
    const probe = boxBefore(kp.publicKey, kp.secretKey)
    expect(probe.length).toBe(32)
  })
})
