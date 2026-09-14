/**
 * Call signaling E2E.
 *
 * WebRTC media is already E2E (DTLS-SRTP, relay never sees it), but
 * SDP offer/answer + ICE candidates went through the relay in plaintext:
 * SDP fingerprints and host IPs (host candidates) leak to the relay.
 *
 * This module encrypts only the *bodies* (sdp / candidate objects) with
 * X25519 ECDH (my secret + peer public) + XSalsa20-Poly1305. Routing fields
 * (type, call_id, target_user_id) stay plaintext — the relay needs them to
 * route, and they reveal only who-called-whom + timing (unavoidable for a
 * relay, documented honestly).
 *
 * Wire format (backward compatible):
 *   { type: "offer", sdp: {...} }                    — legacy plaintext
 *   { type: "offer", enc: "base64(nonce||box)" }      — E2E ciphertext
 * Receivers try `enc` first (via ECDH), fall back to plaintext fields.
 */

import {
  boxBefore,
  secretboxEncrypt,
  secretboxDecrypt,
  secretboxNonceLength,
  randomBytes,
} from "./cryptoAdapter"
import { encode as base64Encode, decode as base64Decode } from "base64-arraybuffer"

function hexToBytes(hex: string): Uint8Array {
  const b = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) b[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  return b
}

export function encryptSignalingBody(
  body: unknown,
  mySecretHex: string,
  theirPublicHex: string,
): string | null {
  try {
    const shared = boxBefore(hexToBytes(theirPublicHex), hexToBytes(mySecretHex))
    const plain = new TextEncoder().encode(JSON.stringify(body))
    const nonce = randomBytes(secretboxNonceLength)
    const box = secretboxEncrypt(plain, nonce, shared)
    const out = new Uint8Array(nonce.length + box.length)
    out.set(nonce)
    out.set(box, nonce.length)
    return base64Encode(out.buffer as ArrayBuffer)
  } catch {
    return null
  }
}

export function decryptSignalingBody<T = unknown>(
  encB64: string,
  mySecretHex: string,
  theirPublicHex: string,
): T | null {
  try {
    const shared = boxBefore(hexToBytes(theirPublicHex), hexToBytes(mySecretHex))
    const combined = new Uint8Array(base64Decode(encB64))
    if (combined.length < secretboxNonceLength + 16) return null
    const nonce = combined.subarray(0, secretboxNonceLength)
    const box = combined.subarray(secretboxNonceLength)
    const plain = secretboxDecrypt(box, nonce, shared)
    if (!plain) return null
    return JSON.parse(new TextDecoder().decode(plain)) as T
  } catch {
    return null
  }
}

/** Wrap an outgoing signaling message: encrypt sdp/candidate into `enc`. */
export function sealSignalingMessage(
  msg: Record<string, unknown>,
  mySecretHex: string,
  theirPublicHex: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if ("sdp" in msg) body.sdp = msg.sdp
  if ("candidate" in msg) body.candidate = msg.candidate
  if (Object.keys(body).length === 0) return msg
  const enc = encryptSignalingBody(body, mySecretHex, theirPublicHex)
  if (!enc) return msg // crypto unavailable — legacy plaintext fallback
  const { sdp: _s, candidate: _c, ...rest } = msg
  return { ...rest, enc, e2e: true }
}

/** Unseal an incoming signaling message. Returns msg with sdp/candidate restored. */
export function unsealSignalingMessage(
  msg: { type: string; enc?: string; sdp?: unknown; candidate?: unknown; [k: string]: unknown },
  mySecretHex: string,
  theirPublicHex: string,
): typeof msg {
  if (typeof msg.enc !== "string" || !msg.enc) return msg
  const body = decryptSignalingBody<{ sdp?: unknown; candidate?: unknown }>(
    msg.enc, mySecretHex, theirPublicHex,
  )
  if (!body) return msg // wrong key or corrupt — let caller try plaintext fields
  const { enc: _e, e2e: _2, ...rest } = msg
  return { ...rest, ...body }
}
