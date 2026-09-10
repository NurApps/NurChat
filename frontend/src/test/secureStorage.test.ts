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
    // After zeroize with ArrayBuffer.transfer(0), buffer is detached
    // Check that the buffer is detached (byteLength === 0)
    expect(buf.byteLength).toBe(0)
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
    // After zeroize with ArrayBuffer.transfer(0), buffers are detached
    expect(buf1.byteLength).toBe(0)
    expect(buf2.byteLength).toBe(0)
    expect(buf3.byteLength).toBe(0)
  })

  it("should handle null in buffer list", () => {
    const buf1 = new Uint8Array([1, 2])
    zeroizeAll(buf1, null)
    // After zeroize with ArrayBuffer.transfer(0), buffer is detached
    expect(buf1.byteLength).toBe(0)
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
