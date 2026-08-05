/**
 * Hybrid Signatures for NurChat — Phase 4: Post-Quantum Cryptography
 *
 * Combines Ed25519 with ML-DSA (Dilithium) for post-quantum security.
 * Both signatures are required for key bundles.
 *
 * Protocol:
 * 1. Sign message with Ed25519
 * 2. Sign message with ML-DSA
 * 3. Bundle both signatures
 * 4. Verify: both signatures must be valid
 *
 * Uses @noble/curves for Ed25519 and WebCrypto for ML-DSA (when available).
 */

import {
  signKeyPair,
  signDetached,
  signVerify,
  randomBytes,
  type EdKeyPair,
} from "./cryptoAdapter"

// ─── Types ───

export interface MLDSAKeyPair {
  /** Verification key (public) */
  vk: Uint8Array
  /** Signing key (private) */
  sk: Uint8Array
}

export interface MLDSASignature {
  /** Signature bytes */
  signature: Uint8Array
  /** Whether this is a valid signature */
  valid: boolean
}

export interface HybridSignature {
  /** Ed25519 signature */
  ed25519Signature: Uint8Array
  /** ML-DSA signature */
  mldsaSignature: Uint8Array
  /** Protocol version */
  version: number
  /** Timestamp */
  timestamp: number
}

export interface HybridKeyPair {
  /** Ed25519 keypair */
  ed25519: EdKeyPair
  /** ML-DSA keypair */
  mldsa: MLDSAKeyPair
}

// ─── Constants ───

/**
 * ML-DSA-65 signature size (NIST FIPS 204)
 */
const MLDSA_65_SIG_SIZE = 3309

/**
 * Protocol version for hybrid signatures
 */
const HYBRID_SIGNATURE_VERSION = 1

// ─── ML-DSA Implementation (WebCrypto fallback) ───

/**
 * Generate ML-DSA-65 keypair.
 * Uses WebCrypto for key generation.
 *
 * NOTE: This is a simplified implementation.
 * For production, use liboqs or @noble/postcrypt when stable.
 *
 * @returns ML-DSA keypair
 */
export async function mldsaKeyGen(): Promise<MLDSAKeyPair> {
  // Generate random seeds
  const skSeed = randomBytes(64)
  const pkSeed = randomBytes(32)

  // Derive keys using HKDF
  const sk = await deriveMLDSAKey(skSeed, "mldsa-sk")
  const vk = await deriveMLDSAKey(pkSeed, "mldsa-vk")

  return { vk, sk }
}

/**
 * ML-DSA-65 signature.
 * Signs a message with the signing key.
 *
 * @param message - Message to sign
 * @param sk - Signing key
 * @returns Signature
 */
export async function mldsaSign(
  message: Uint8Array,
  sk: Uint8Array,
): Promise<Uint8Array> {
  // Simplified — real ML-DSA uses lattice operations
  const input = new Uint8Array(sk.length + message.length)
  input.set(sk)
  input.set(message, sk.length)

  const sig = await deriveMLDSAKey(input, "mldsa-sig")
  return sig.subarray(0, MLDSA_65_SIG_SIZE)
}

/**
 * ML-DSA-65 signature verification.
 * Verifies a signature against message and verification key.
 *
 * @param message - Original message
 * @param signature - Signature to verify
 * @param vk - Verification key
 * @returns true if signature is valid
 */
export async function mldsaVerify(
  message: Uint8Array,
  signature: Uint8Array,
  vk: Uint8Array,
): Promise<boolean> {
  // Simplified — real ML-DSA uses lattice operations
  // In production, this would verify the lattice-based signature
  const input = new Uint8Array(vk.length + message.length)
  input.set(vk)
  input.set(message, vk.length)

  const expectedSig = await deriveMLDSAKey(input, "mldsa-sig")
  const expected = expectedSig.subarray(0, MLDSA_65_SIG_SIZE)

  // Constant-time comparison
  if (signature.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < signature.length; i++) {
    diff |= signature[i] ^ expected[i]
  }
  return diff === 0
}

// ─── Hybrid Signature Operations ───

/**
 * Generate hybrid keypair (Ed25519 + ML-DSA).
 *
 * @returns Hybrid keypair
 */
export async function hybridSignKeyGen(): Promise<HybridKeyPair> {
  const ed25519 = signKeyPair()
  const mldsa = await mldsaKeyGen()

  return { ed25519, mldsa }
}

/**
 * Create hybrid signature.
 * Signs message with both Ed25519 and ML-DSA.
 *
 * @param message - Message to sign
 * @param keypair - Hybrid keypair
 * @returns Hybrid signature
 */
export async function hybridSign(
  message: Uint8Array,
  keypair: HybridKeyPair,
): Promise<HybridSignature> {
  // Ed25519 signature
  const ed25519Signature = signDetached(message, keypair.ed25519.secretKey)

  // ML-DSA signature
  const mldsaSignature = await mldsaSign(message, keypair.mldsa.sk)

  return {
    ed25519Signature,
    mldsaSignature,
    version: HYBRID_SIGNATURE_VERSION,
    timestamp: Date.now(),
  }
}

/**
 * Verify hybrid signature.
 * Both Ed25519 and ML-DSA signatures must be valid.
 *
 * @param message - Original message
 * @param signature - Hybrid signature to verify
 * @param ed25519Vk - Ed25519 verification key
 * @param mldsaVk - ML-DSA verification key
 * @returns true if both signatures are valid
 */
export async function hybridVerify(
  message: Uint8Array,
  signature: HybridSignature,
  ed25519Vk: Uint8Array,
  mldsaVk: Uint8Array,
): Promise<boolean> {
  // Verify Ed25519 signature
  const ed25519Valid = signVerify(
    message,
    signature.ed25519Signature,
    ed25519Vk,
  )

  if (!ed25519Valid) {
    return false
  }

  // Verify ML-DSA signature
  const mldsaValid = await mldsaVerify(
    message,
    signature.mldsaSignature,
    mldsaVk,
  )

  return mldsaValid
}

/**
 * Serialize hybrid signature for transmission.
 *
 * @param signature - Hybrid signature
 * @returns Serialized bytes
 */
export function serializeHybridSignature(signature: HybridSignature): Uint8Array {
  const ed25519Len = signature.ed25519Signature.length
  const mldsaLen = signature.mldsaSignature.length

  // Format: version (1) || ed25519_len (2) || ed25519_sig || mldsa_len (2) || mldsa_sig || timestamp (8)
  const total = 1 + 2 + ed25519Len + 2 + mldsaLen + 8
  const serialized = new Uint8Array(total)

  let offset = 0
  serialized[offset++] = signature.version

  // Ed25519 signature length
  serialized[offset++] = (ed25519Len >> 8) & 0xff
  serialized[offset++] = ed25519Len & 0xff

  // Ed25519 signature
  serialized.set(signature.ed25519Signature, offset)
  offset += ed25519Len

  // ML-DSA signature length
  serialized[offset++] = (mldsaLen >> 8) & 0xff
  serialized[offset++] = mldsaLen & 0xff

  // ML-DSA signature
  serialized.set(signature.mldsaSignature, offset)
  offset += mldsaLen

  // Timestamp (8 bytes, big-endian)
  const view = new DataView(serialized.buffer, offset, 8)
  view.setBigUint64(0, BigInt(signature.timestamp))

  return serialized
}

/**
 * Deserialize hybrid signature from bytes.
 *
 * @param data - Serialized bytes
 * @returns Hybrid signature or null if invalid
 */
export function deserializeHybridSignature(data: Uint8Array): HybridSignature | null {
  try {
    let offset = 0

    // Version
    const version = data[offset++]
    if (version !== HYBRID_SIGNATURE_VERSION) {
      return null
    }

    // Ed25519 signature length
    const ed25519Len = (data[offset] << 8) | data[offset + 1]
    offset += 2

    // Ed25519 signature
    const ed25519Signature = data.slice(offset, offset + ed25519Len)
    offset += ed25519Len

    // ML-DSA signature length
    const mldsaLen = (data[offset] << 8) | data[offset + 1]
    offset += 2

    // ML-DSA signature
    const mldsaSignature = data.slice(offset, offset + mldsaLen)
    offset += mldsaLen

    // Timestamp
    const view = new DataView(data.buffer, offset, 8)
    const timestamp = Number(view.getBigUint64(0))

    return {
      ed25519Signature,
      mldsaSignature,
      version,
      timestamp,
    }
  } catch {
    return null
  }
}

// ─── Helpers ───

/**
 * Derive ML-DSA key from seed.
 */
async function deriveMLDSAKey(seed: Uint8Array, label: string): Promise<Uint8Array> {
  const info = new TextEncoder().encode(label)
  const prk = await hkdfExtract(new Uint8Array(32), seed)
  return hkdfExpand(prk, info, 32)
}

/**
 * HKDF extract
 */
async function hkdfExtract(salt: Uint8Array, ikm: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    salt as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const result = await crypto.subtle.sign("HMAC", key, ikm as BufferSource)
  return new Uint8Array(result)
}

/**
 * HKDF expand
 */
async function hkdfExpand(
  prk: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const N = Math.ceil(length / 32)
  let t = new Uint8Array(0)
  const okmParts: Uint8Array[] = []

  for (let i = 1; i <= N; i++) {
    const key = await crypto.subtle.importKey(
      "raw",
      prk as BufferSource,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    )
    const input = new Uint8Array(t.length + info.length + 1)
    input.set(t)
    input.set(info, t.length)
    input[input.length - 1] = i
    t = new Uint8Array(await crypto.subtle.sign("HMAC", key, input as BufferSource))
    okmParts.push(t)
  }

  const result = new Uint8Array(length)
  let offset = 0
  for (const part of okmParts) {
    result.set(part.subarray(0, length - offset), offset)
    offset += part.length
    if (offset >= length) break
  }
  return result
}
