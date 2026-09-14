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

export function encryptFileBytes(plain: Uint8Array, fileKey: Uint8Array): Uint8Array {
  const nonce = randomBytes(secretboxNonceLength)
  const box = secretboxEncrypt(plain, nonce, fileKey)
  const out = new Uint8Array(nonce.length + box.length)
  out.set(nonce)
  out.set(box, nonce.length)
  return out
}

export function decryptFileBytes(cipherWithNonce: Uint8Array, fileKey: Uint8Array): Uint8Array | null {
  if (cipherWithNonce.length < secretboxNonceLength + 16) return null
  const nonce = cipherWithNonce.subarray(0, secretboxNonceLength)
  const box = cipherWithNonce.subarray(secretboxNonceLength)
  return secretboxDecrypt(box, nonce, fileKey)
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
