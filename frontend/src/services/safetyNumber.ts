/**
 * Safety number / key fingerprint verification
 * Users can compare these numbers to verify E2E keys
 */
import { loadKeys } from "./e2e"

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}

/**
 * Generate safety number from two users' public keys
 * This is a fingerprint that both users can compare
 */
export async function generateSafetyNumber(
  myPublicKeyHex: string,
  theirPublicKeyHex: string,
): Promise<string> {
  // Sort keys deterministically so both users get same number
  const [key1, key2] = [myPublicKeyHex, theirPublicKeyHex].sort()
  const combined = hexToBytes(key1 + key2)
  // SHA-256 hash
  const hash = await crypto.subtle.digest("SHA-256", combined.buffer as ArrayBuffer)
  const hashArray = new Uint8Array(hash)
  // Format as groups of 5 digits (like Signal)
  const digits = Array.from(hashArray)
    .map((b) => b.toString().padStart(3, "0"))
    .join("")
  // Take first 30 digits, group into 5-digit blocks
  return digits.slice(0, 30).replace(/(\d{5})/g, "$1 ").trim()
}

/**
 * Generate QR code data for safety number
 */
export async function generateSafetyNumberQR(
  myPublicKeyHex: string,
  theirPublicKeyHex: string,
): Promise<string> {
  const safetyNumber = await generateSafetyNumber(myPublicKeyHex, theirPublicKeyHex)
  return `nurchat-verify:${safetyNumber.replace(/\s/g, "")}`
}

/**
 * Verify that safety numbers match
 */
export async function verifySafetyNumber(
  myPublicKeyHex: string,
  theirPublicKeyHex: string,
  receivedSafetyNumber: string,
): Promise<boolean> {
  const localNumber = await generateSafetyNumber(myPublicKeyHex, theirPublicKeyHex)
  return localNumber.replace(/\s/g, "") === receivedSafetyNumber.replace(/\s/g, "")
}

/**
 * Get own safety number for display
 */
export async function getMySafetyNumber(theirPublicKeyHex: string): Promise<string | null> {
  const keys = loadKeys()
  if (!keys) return null
  return generateSafetyNumber(keys.publicKeyHex, theirPublicKeyHex)
}
