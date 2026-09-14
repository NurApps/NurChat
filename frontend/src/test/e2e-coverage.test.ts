/**
 * E2E coverage: file bytes, call signaling bodies, blob URL codec,
 * group ratchet rekey binding.
 */
import { describe, it, expect } from "vitest"
import {
  generateFileKey,
  encryptFileBytes,
  decryptFileBytes,
  wrapFileKey,
  unwrapFileKey,
} from "../services/fileE2E"
import {
  encryptSignalingBody,
  decryptSignalingBody,
  sealSignalingMessage,
  unsealSignalingMessage,
} from "../services/callE2E"
import {
  encodeBlobUrlParams,
  decodeBlobUrlParams,
} from "../services/blobManager"
import { groupKeyHash } from "../services/groupE2E"
import { boxKeyPair, bytesToHex } from "../services/cryptoAdapter"

describe("fileE2E", () => {
  it("roundtrips file bytes", () => {
    const key = generateFileKey()
    const plain = new TextEncoder().encode("voice-bytes-payload")
    const enc = encryptFileBytes(plain, key)
    expect(enc.length).toBeGreaterThan(plain.length)
    const dec = decryptFileBytes(enc, key)
    expect(dec && new TextDecoder().decode(dec)).toBe("voice-bytes-payload")
  })

  it("wraps file key per-recipient (only recipient unwraps)", () => {
    const alice = boxKeyPair()
    const bob = boxKeyPair()
    const eve = boxKeyPair()
    const fileKey = generateFileKey()
    const wrapped = wrapFileKey(
      fileKey, bytesToHex(alice.secretKey), bytesToHex(bob.publicKey),
    )
    const opened = unwrapFileKey(
      wrapped, bytesToHex(bob.secretKey), bytesToHex(alice.publicKey),
    )
    expect(opened && Array.from(opened)).toEqual(Array.from(fileKey))
    // Eve with her own secret cannot open Bob's wrapped copy
    const eveTry = unwrapFileKey(
      wrapped, bytesToHex(eve.secretKey), bytesToHex(alice.publicKey),
    )
    expect(eveTry).toBeNull()
  })

  it("rejects truncated ciphertext", () => {
    const key = generateFileKey()
    expect(decryptFileBytes(new Uint8Array(10), key)).toBeNull()
  })
})

describe("callE2E", () => {
  it("roundtrips SDP body, hides IPs from relay envelope", () => {
    const alice = boxKeyPair()
    const bob = boxKeyPair()
    const sdp = { type: "offer", sdp: "v=0\r\no=- 1 1 IN IP4 192.168.1.5\r\n" }
    const enc = encryptSignalingBody(
      sdp, bytesToHex(alice.secretKey), bytesToHex(bob.publicKey),
    )
    expect(enc).toBeTruthy()
    expect(enc!).not.toContain("192.168")
    const dec = decryptSignalingBody<typeof sdp>(
      enc!, bytesToHex(bob.secretKey), bytesToHex(alice.publicKey),
    )
    expect(dec).toEqual(sdp)
  })

  it("seal/unseal keeps routing fields plaintext, encrypts body", () => {
    const alice = boxKeyPair()
    const bob = boxKeyPair()
    const sealed = sealSignalingMessage(
      { type: "ice-candidate", candidate: { candidate: "host 10.0.0.2" } },
      bytesToHex(alice.secretKey), bytesToHex(bob.publicKey),
    )
    expect(sealed.type).toBe("ice-candidate")
    expect(sealed.candidate).toBeUndefined()
    expect(typeof sealed.enc).toBe("string")
    const opened = unsealSignalingMessage(
      sealed as { type: string; enc: string },
      bytesToHex(bob.secretKey), bytesToHex(alice.publicKey),
    )
    expect(opened.candidate).toEqual({ candidate: "host 10.0.0.2" })
  })

  it("passes through messages without sdp/candidate untouched", () => {
    const alice = boxKeyPair()
    const bob = boxKeyPair()
    const msg = { type: "call-accept", call_id: "call_1" }
    expect(
      sealSignalingMessage(msg, bytesToHex(alice.secretKey), bytesToHex(bob.publicKey)),
    ).toEqual(msg)
  })
})

describe("blobManager codec", () => {
  it("encodes/decodes file params stably", () => {
    const token = encodeBlobUrlParams("file_abc123", "photo.jpg")
    expect(token).not.toContain("file_abc123") // opaque-ish, no raw id
    expect(decodeBlobUrlParams(token)).toEqual({ fileId: "file_abc123", filename: "photo.jpg" })
  })

  it("returns null on garbage", () => {
    expect(decodeBlobUrlParams("!!!not-base64!!!")).toBeNull()
  })
})

describe("group rekey binding", () => {
  it("different group keys hash differently (ratchet restarts)", async () => {
    const k1 = new Uint8Array(32).fill(1)
    const k2 = new Uint8Array(32).fill(2)
    const h1 = await groupKeyHash(k1)
    const h2 = await groupKeyHash(k2)
    expect(h1).not.toBe(h2)
    expect(await groupKeyHash(k1)).toBe(h1) // stable
  })
})
