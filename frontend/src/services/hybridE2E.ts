/**
 * Hybrid E2E Integration for NurChat — Phase 4: Post-Quantum
 *
 * Integrates post-quantum key exchange into the E2E flow.
 * Falls back to classical X25519 if PQ is unavailable.
 *
 * Protocol:
 * 1. Try hybrid X3DH: X25519 + ML-KEM-768
 * 2. If PQ unavailable, use classical X3DH
 * 3. Always use Double Ratchet for message encryption
 *
 * Uses @oqs/liboqs-js (WASM) for ML-KEM-768.
 */

import {
  boxKeyPair,
  boxBefore,
  secretboxEncrypt,
  secretboxDecrypt,
  secretboxNonceLength,
  randomBytes,
  sha256,
  bytesToHex,
  hexToBytes,
  type BoxKeyPair,
} from "./cryptoAdapter"
import {
  hybridInit,
  hybridRespond,
  hybridComplete,
  type HybridKeyExchange,
  type HybridSharedSecret,
} from "./postQuantum"
import { hkdf } from "./doubleRatchet"

// ─── Types ───

export interface HybridSessionInit {
  /** Classical X25519 shared secret */
  x25519Secret: Uint8Array
  /** PQ ML-KEM shared secret (if available) */
  pqSecret?: Uint8Array
  /** ML-KEM ciphertext (to send to responder) */
  mlkemCiphertext?: Uint8Array
  /** Whether PQ was used */
  pqUsed: boolean
  /** Ephemeral public key (hex) */
  ephemeralPubHex: string
}

export interface HybridPreKeyBundle {
  /** User ID */
  userId: string
  /** Identity public key (hex) */
  identityPublicKeyHex: string
  /** Signed prekey public (hex) */
  signedPrekeyHex: string
  /** Signed prekey signature (hex) */
  signedPrekeySignatureHex: string
  /** One-time prekey public (hex) */
  oneTimePrekeyHex?: string
  /** ML-KEM encapsulation key (hex) — for PQ */
  mlkemEkHex?: string
  /** Whether this bundle supports PQ */
  pqSupported: boolean
}

// ─── Capability Detection ───

let _pqAvailable: boolean | null = null

/**
 * Check if post-quantum is available.
 */
export async function isPQAvailable(): Promise<boolean> {
  if (_pqAvailable !== null) return _pqAvailable

  try {
    const { hybridInit: init } = await import("./postQuantum")
    const test = await init()
    // If we got here, PQ is available
    _pqAvailable = !!(test.mlkemEk && test.mlkemEk.length > 0)
  } catch {
    _pqAvailable = false
  }

  return _pqAvailable
}

// ─── Hybrid Key Exchange ───

/**
 * Initiate hybrid key exchange (Alice side).
 *
 * @param ourIdentityKey - Our identity keypair
 * @param theirBundle - Their pre-key bundle (classical + optional PQ)
 * @returns Session init data to send to responder
 */
export async function hybridX3DHInit(
  ourIdentityKey: BoxKeyPair,
  theirBundle: HybridPreKeyBundle,
): Promise<HybridSessionInit> {
  const pqAvailable = await isPQAvailable()

  if (pqAvailable && theirBundle.pqSupported && theirBundle.mlkemEkHex) {
    // Hybrid X3DH: X25519 + ML-KEM
    try {
      const pqInit = await hybridInit()

      // Perform hybrid key exchange
      const x25519Secret = boxBefore(
        hexToBytes(theirBundle.signedPrekeyHex),
        ourIdentityKey.secretKey,
      )

      // ML-KEM encaps
      const mlkemEk = hexToBytes(theirBundle.mlkemEkHex)
      const { ct: mlkemCiphertext, sharedSecret: pqSecret } = await (await import("./postQuantum")).mlkemEncaps(mlkemEk)

      // Combine secrets
      const combinedSecret = await combineSecrets(x25519Secret, pqSecret)

      // Zeroize intermediates
      x25519Secret.fill(0)

      return {
        x25519Secret: combinedSecret,
        pqSecret,
        mlkemCiphertext,
        pqUsed: true,
        ephemeralPubHex: bytesToHex(pqInit.x25519Pub),
      }
    } catch (err) {
      console.warn("[Hybrid] PQ key exchange failed, falling back to classical:", err)
    }
  }

  // Classical X3DH fallback
  const x25519Secret = boxBefore(
    hexToBytes(theirBundle.signedPrekeyHex),
    ourIdentityKey.secretKey,
  )

  return {
    x25519Secret,
    pqUsed: false,
    ephemeralPubHex: bytesToHex(ourIdentityKey.publicKey),
  }
}

/**
 * Respond to hybrid key exchange (Bob side).
 *
 * @param ourIdentityKey - Our identity keypair
 * @param ourSignedPrekey - Our signed prekey
 * @param ourOneTimePrekey - Our one-time prekey (optional)
 * @param theirEphemeralPub - Their ephemeral public key (hex)
 * @param mlkemCiphertext - ML-KEM ciphertext (if PQ was used)
 * @returns Combined shared secret
 */
export async function hybridX3DHRespond(
  ourIdentityKey: BoxKeyPair,
  ourSignedPrekey: BoxKeyPair,
  ourOneTimePrekey: BoxKeyPair | null,
  theirEphemeralPubHex: string,
  mlkemCiphertext?: Uint8Array,
): Promise<HybridSessionInit> {
  const pqAvailable = await isPQAvailable()

  if (pqAvailable && mlkemCiphertext) {
    // Hybrid response
    try {
      const theirEphemeralPub = hexToBytes(theirEphemeralPubHex)

      // X25519 ECDH
      const x25519Secret = boxBefore(theirEphemeralPub, ourSignedPrekey.secretKey)

      // ML-KEM decaps (we need the decapsulation key)
      // This is a simplified version — in production, store ML-KEM dk
      const pqSecret = randomBytes(32) // Placeholder

      // Combine secrets
      const combinedSecret = await combineSecrets(x25519Secret, pqSecret)

      // Zeroize
      x25519Secret.fill(0)

      return {
        x25519Secret: combinedSecret,
        pqSecret,
        pqUsed: true,
        ephemeralPubHex: theirEphemeralPubHex,
      }
    } catch (err) {
      console.warn("[Hybrid] PQ response failed, falling back to classical:", err)
    }
  }

  // Classical response
  const theirEphemeralPub = hexToBytes(theirEphemeralPubHex)
  const x25519Secret = boxBefore(theirEphemeralPub, ourSignedPrekey.secretKey)

  return {
    x25519Secret,
    pqUsed: false,
    ephemeralPubHex: theirEphemeralPubHex,
  }
}

// ─── Secret Combination ───

/**
 * Combine X25519 and PQ shared secrets using HKDF.
 *
 * @param x25519Secret - Classical shared secret
 * @param pqSecret - Post-quantum shared secret
 * @returns Combined 32-byte shared secret
 */
async function combineSecrets(
  x25519Secret: Uint8Array,
  pqSecret: Uint8Array,
): Promise<Uint8Array> {
  // Concatenate secrets
  const combined = new Uint8Array(x25519Secret.length + pqSecret.length)
  combined.set(x25519Secret)
  combined.set(pqSecret, x25519Secret.length)

  // Derive final key using HKDF
  const salt = new Uint8Array(32)
  const info = new TextEncoder().encode("nurchat-hybrid-x3dh")
  return hkdf(salt, combined, info, 32)
}

// ─── Bundle Conversion ───

/**
 * Convert classical pre-key bundle to hybrid bundle.
 * Adds PQ fields if available.
 */
export async function toHybridBundle(
  classicalBundle: {
    identity_key: string
    signed_prekey: string
    signed_prekey_signature: string
    one_time_prekey?: string
  },
  mlkemEkHex?: string,
): Promise<HybridPreKeyBundle> {
  const pqAvailable = await isPQAvailable()

  return {
    userId: "", // Will be set by caller
    identityPublicKeyHex: classicalBundle.identity_key,
    signedPrekeyHex: classicalBundle.signed_prekey,
    signedPrekeySignatureHex: classicalBundle.signed_prekey_signature,
    oneTimePrekeyHex: classicalBundle.one_time_prekey,
    mlkemEkHex: mlkemEkHex,
    pqSupported: pqAvailable && !!mlkemEkHex,
  }
}
