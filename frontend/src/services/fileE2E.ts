/**
 * File E2E — true end-to-end encryption for file bytes.
 *
 * Each file gets a random 32B fileKey (XSalsa20-Poly1305). The key is
 * wrapped per-recipient via X25519 ECDH + secretbox (same as groupE2E.wrap).
 * Ciphertext stored on relay is nonce(24) || box -> relay sees only ciphertext.
 *
 * For groups: wrap with group-style per-user ECDH (sender secret + recipient pub).
 * For 1-1: same mechanism; also supports future ratchet-derived key if needed.
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

export function generateFileKey(): Uint8Array {
  return randomBytes(32)
}

// ─── Size bucketing (hide exact file size from relay) ───
// Plaintext is framed as [magic "NCF1"][4B BE len][data][random tail] and
// padded to 64KB buckets BEFORE encryption. Relay sees only the bucket.
// decryptFileBytes strips the frame; files stored before framing (no magic)
// pass through untouched (legacy path).
export const FILE_PAD_BLOCK = 64 * 1024
const FILE_PAD_MAGIC_0 = 0x4e // "NCF1"
const FILE_PAD_MAGIC_1 = 0x43
const FILE_PAD_MAGIC_2 = 0x46
const FILE_PAD_MAGIC_3 = 0x31

export function padFileBytes(plain: Uint8Array): Uint8Array {
  const frameLen = 8 + plain.length
  const paddedLen = Math.ceil(frameLen / FILE_PAD_BLOCK) * FILE_PAD_BLOCK
  const out = new Uint8Array(paddedLen)
  out[0] = FILE_PAD_MAGIC_0
  out[1] = FILE_PAD_MAGIC_1
  out[2] = FILE_PAD_MAGIC_2
  out[3] = FILE_PAD_MAGIC_3
  new DataView(out.buffer).setUint32(4, plain.length, false)
  out.set(plain, 8)
  if (paddedLen > frameLen) {
    const tail = out.subarray(frameLen)
    tail.set(randomBytes(tail.length))
  }
  return out
}

export function unpadFileBytes(framed: Uint8Array): Uint8Array | null {
  if (framed.length < 8) return null
  if (framed.length % FILE_PAD_BLOCK !== 0) return null
  if (framed[0] !== FILE_PAD_MAGIC_0 || framed[1] !== FILE_PAD_MAGIC_1
    || framed[2] !== FILE_PAD_MAGIC_2 || framed[3] !== FILE_PAD_MAGIC_3) return null
  const len = new DataView(framed.buffer, framed.byteOffset, 8).getUint32(4, false)
  if (len > framed.length - 8) return null
  return framed.subarray(8, 8 + len)
}

export function encryptFileBytes(plain: Uint8Array, fileKey: Uint8Array): Uint8Array {
  const nonce = randomBytes(secretboxNonceLength)
  const box = secretboxEncrypt(padFileBytes(plain), nonce, fileKey)
  const out = new Uint8Array(nonce.length + box.length)
  out.set(nonce)
  out.set(box, nonce.length)
  return out
}

export function decryptFileBytes(cipherWithNonce: Uint8Array, fileKey: Uint8Array): Uint8Array | null {
  if (cipherWithNonce.length < secretboxNonceLength + 16) return null
  const nonce = cipherWithNonce.subarray(0, secretboxNonceLength)
  const box = cipherWithNonce.subarray(secretboxNonceLength)
  const plain = secretboxDecrypt(box, nonce, fileKey)
  if (!plain) return null
  return unpadFileBytes(plain) ?? plain
}

export function wrapFileKey(fileKey: Uint8Array, mySecretHex: string, theirPublicHex: string): string {
  const mySec = hexToBytes(mySecretHex)
  const theirPub = hexToBytes(theirPublicHex)
  const shared = boxBefore(theirPub, mySec)
  const nonce = randomBytes(secretboxNonceLength)
  const box = secretboxEncrypt(fileKey, nonce, shared)
  const combined = new Uint8Array(nonce.length + box.length)
  combined.set(nonce)
  combined.set(box, nonce.length)
  return base64Encode(combined.buffer as ArrayBuffer)
}

export function unwrapFileKey(wrappedB64: string, mySecretHex: string, theirPublicHex: string): Uint8Array | null {
  try {
    const mySec = hexToBytes(mySecretHex)
    const theirPub = hexToBytes(theirPublicHex)
    const shared = boxBefore(theirPub, mySec)
    const combined = new Uint8Array(base64Decode(wrappedB64))
    const nonce = combined.subarray(0, secretboxNonceLength)
    const box = combined.subarray(secretboxNonceLength)
    return secretboxDecrypt(box, nonce, shared)
  } catch {
    return null
  }
}

export interface FileKeyEnvelope {
  v: 1
  // per-recipient wrapped keys: userId -> base64(nonce||box)
  wrapped: Record<string, string>
  // sender pub to help receiver unwrap (needed when sender != creator)
  senderPublicKey?: string
}

/**
 * Decrypt file bytes given envelope and my private key + sender public key.
 * Tries to find my userId entry, else fails.
 */
export function unwrapMyFileKey(
  envelope: FileKeyEnvelope,
  myUserId: string,
  mySecretHex: string,
  senderPublicHex: string
): Uint8Array | null {
  const wrapped = envelope.wrapped[myUserId]
  if (!wrapped) return null
  return unwrapFileKey(wrapped, mySecretHex, senderPublicHex)
}
