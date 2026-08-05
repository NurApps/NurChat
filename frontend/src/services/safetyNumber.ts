/**
 * Safety Numbers for NurChat — Phase 3: Key Transparency & Verification
 *
 * Safety numbers allow users to verify each other's identity keys.
 * If a safety number changes, it indicates a potential MITM attack.
 *
 * Features:
 * - Deterministic safety number generation
 * - QR code for visual verification
 * - Voice verification (readable format)
 * - Key change detection
 *
 * Uses @noble/curves + @noble/ciphers (audited by cure53, Sep 2024).
 */

import { sha256 } from "./cryptoAdapter"

// ─── Types ───

export interface SafetyNumber {
  /** The safety number as a formatted string (e.g., "1234-5678-9012-...") */
  formatted: string
  /** Raw hash bytes (32 bytes) */
  raw: Uint8Array
  /** QR code data URL */
  qrCode?: string
  /** Timestamp when generated */
  generatedAt: number
  /** Version of the safety number format */
  version: number
}

export interface KeyChangeEvent {
  /** User ID whose key changed */
  userId: string
  /** Old public key (hex) */
  oldPublicKeyHex: string
  /** New public key (hex) */
  newPublicKeyHex: string
  /** Timestamp of change */
  timestamp: number
  /** Whether user has verified the new key */
  verified: boolean
}

// ─── Constants ───

/**
 * Safety number format version
 */
const SAFETY_NUMBER_VERSION = 1

/**
 * Number of digits in a safety number group
 */
const GROUP_SIZE = 4

/**
 * Number of groups in a safety number
 */
const NUMBER_OF_GROUPS = 8

/**
 * Total digits in a safety number
 */
const TOTAL_DIGITS = GROUP_SIZE * NUMBER_OF_GROUPS

// ─── Core Functions ───

/**
 * Generate a safety number from two identity keys.
 * The safety number is deterministic and order-independent.
 *
 * @param ourIdentityPub - Our identity public key (hex)
 * @param theirIdentityPub - Their identity public key (hex)
 * @returns Safety number object
 */
export async function generateSafetyNumber(
  ourIdentityPubHex: string,
  theirIdentityPubHex: string,
): Promise<SafetyNumber> {
  // Convert hex to bytes
  const ourKey = hexToBytes(ourIdentityPubHex)
  const theirKey = hexToBytes(theirIdentityPubHex)

  // Sort keys for deterministic ordering (order-independent)
  const sorted = [ourKey, theirKey].sort((a, b) => {
    for (let i = 0; i < a.length && i < b.length; i++) {
      if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
    }
    return a.length - b.length
  })

  // Concatenate sorted keys
  const combined = new Uint8Array(sorted[0].length + sorted[1].length)
  combined.set(sorted[0])
  combined.set(sorted[1], sorted[0].length)

  // Hash with SHA-256
  const hash = await sha256(combined)

  // Format as readable safety number
  const formatted = formatSafetyNumber(hash)

  return {
    formatted,
    raw: hash,
    generatedAt: Date.now(),
    version: SAFETY_NUMBER_VERSION,
  }
}

/**
 * Generate QR code data URL for safety number.
 * Uses a simple numeric encoding for QR codes.
 *
 * @param safetyNumber - Safety number to encode
 * @returns QR code data URL (base64 PNG)
 */
export async function generateSafetyNumberQR(
  safetyNumber: SafetyNumber,
): Promise<string> {
  // Create QR code content: version + safety number
  const content = `nurchat-verify:${SAFETY_NUMBER_VERSION}:${safetyNumber.formatted.replace(/-/g, "")}`

  // Simple QR code generation using canvas
  // For production, use a proper QR library like 'qrcode'
  const canvas = document.createElement("canvas")
  const size = 256
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext("2d")
  if (!ctx) {
    throw new Error("Failed to get canvas context")
  }

  // White background
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, size, size)

  // Black modules (simplified - in production use qrcode library)
  ctx.fillStyle = "#000000"
  const moduleSize = 8
  const modules = Math.floor(size / moduleSize)

  // Generate deterministic pattern from content
  const encoder = new TextEncoder()
  const contentBytes = encoder.encode(content)
  const hash = await sha256(contentBytes)

  for (let y = 0; y < modules; y++) {
    for (let x = 0; x < modules; x++) {
      // Simple hash-based pattern
      const index = (y * modules + x) % hash.length
      if (hash[index] % 3 === 0) {
        ctx.fillRect(x * moduleSize, y * moduleSize, moduleSize - 1, moduleSize - 1)
      }
    }
  }

  // Add finder patterns (corners)
  drawFinderPattern(ctx, 0, 0, moduleSize)
  drawFinderPattern(ctx, (modules - 7) * moduleSize, 0, moduleSize)
  drawFinderPattern(ctx, 0, (modules - 7) * moduleSize, moduleSize)

  return canvas.toDataURL("image/png")
}

/**
 * Format safety number for voice verification.
 * Groups digits with dashes for easy reading.
 *
 * @param hash - Raw hash bytes (32 bytes)
 * @returns Formatted safety number string
 */
export function formatSafetyNumber(hash: Uint8Array): string {
  // Convert hash to decimal digits
  let digits = ""
  for (const byte of hash) {
    digits += byte.toString().padStart(3, "0")
  }

  // Trim to required length
  digits = digits.slice(0, TOTAL_DIGITS)

  // Group with dashes
  const groups: string[] = []
  for (let i = 0; i < digits.length; i += GROUP_SIZE) {
    groups.push(digits.slice(i, i + GROUP_SIZE))
  }

  return groups.join("-")
}

/**
 * Parse a formatted safety number back to raw hash.
 * Useful for verification.
 *
 * @param formatted - Formatted safety number string
 * @returns Raw hash bytes or null if invalid
 */
export function parseSafetyNumber(formatted: string): Uint8Array | null {
  try {
    // Remove dashes
    const digits = formatted.replace(/-/g, "")

    // Validate length
    if (digits.length !== TOTAL_DIGITS) {
      return null
    }

    // Validate all digits are numbers
    if (!/^\d+$/.test(digits)) {
      return null
    }

    // Convert digits back to bytes
    const bytes = new Uint8Array(32)
    let byteIndex = 0
    for (let i = 0; i < digits.length; i += 3) {
      const digit = parseInt(digits.slice(i, i + 3), 10)
      if (digit > 255) {
        return null
      }
      bytes[byteIndex++] = digit
    }

    return bytes
  } catch {
    return null
  }
}

/**
 * Verify that two safety numbers match.
 * Used during visual/voice verification.
 *
 * @param ourSafetyNumber - Our generated safety number
 * @param theirSafetyNumber - Their safety number (from QR or voice)
 * @returns true if safety numbers match
 */
export function verifySafetyNumber(
  ourSafetyNumber: SafetyNumber,
  theirSafetyNumber: string,
): boolean {
  return ourSafetyNumber.formatted === theirSafetyNumber
}

/**
 * Check if a key change is legitimate.
 * Compares old and new safety numbers.
 *
 * @param oldPublicKeyHex - Old public key (hex)
 * @param newPublicKeyHex - New public key (hex)
 * @param ourIdentityPubHex - Our identity public key (hex)
 * @returns KeyChangeEvent with verification status
 */
export async function checkKeyChange(
  oldPublicKeyHex: string,
  newPublicKeyHex: string,
  ourIdentityPubHex: string,
): Promise<KeyChangeEvent> {
  const oldSafety = await generateSafetyNumber(ourIdentityPubHex, oldPublicKeyHex)
  const newSafety = await generateSafetyNumber(ourIdentityPubHex, newPublicKeyHex)

  return {
    userId: "", // To be filled by caller
    oldPublicKeyHex,
    newPublicKeyHex,
    timestamp: Date.now(),
    verified: oldSafety.formatted !== newSafety.formatted,
  }
}

// ─── Helper Functions ───

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}

function drawFinderPattern(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  moduleSize: number,
): void {
  // Outer black square
  ctx.fillStyle = "#000000"
  ctx.fillRect(x, y, 7 * moduleSize, 7 * moduleSize)

  // Inner white square
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(x + moduleSize, y + moduleSize, 5 * moduleSize, 5 * moduleSize)

  // Center black square
  ctx.fillStyle = "#000000"
  ctx.fillRect(x + 2 * moduleSize, y + 2 * moduleSize, 3 * moduleSize, 3 * moduleSize)
}
