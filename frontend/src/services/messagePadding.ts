/**
 * Message Padding for NurChat — Phase 2: Metadata Protection
 *
 * Fixed-size message chunks prevent size-based traffic analysis.
 * Messages are padded to standard sizes before encryption.
 *
 * Padding strategy:
 * - Messages padded to nearest standard size
 * - Random noise added to prevent exact length detection
 * - Padding removed after decryption
 *
 * Uses @noble/curves + @noble/ciphers (audited by cure53, Sep 2024).
 */

import { randomBytes } from "./cryptoAdapter"

// ─── Types ───

export interface PaddedMessage {
  /** Original message content */
  content: string
  /** Padded size in bytes */
  paddedSize: number
  /** Original size in bytes */
  originalSize: number
  /** Random noise bytes (for padding) */
  padding: number
}

// ─── Constants ───

/**
 * Standard message sizes in bytes.
 * Messages are padded to the nearest size.
 * Sizes follow a geometric progression for efficient padding.
 */
export const STANDARD_SIZES = [
  256,        // Short messages (< 200 chars)
  512,        // Medium messages (< 450 chars)
  1024,       // Long messages (< 900 chars)
  2048,       // Extended messages (< 1800 chars)
  4096,       // Long documents (< 3600 chars)
  8192,       // Very long documents (< 7200 chars)
  16384,      // Large documents (< 14000 chars)
  32768,      // Very large documents (< 28000 chars)
  65536,      // Maximum size (< 56000 chars)
] as const

/**
 * Maximum allowed message size (64KB)
 */
export const MAX_MESSAGE_SIZE = 65536

/**
 * Overhead for padding header (4 bytes for original size)
 */
const PADDING_HEADER_SIZE = 4

// ─── Core Functions ───

/**
 * Calculate the padded size for a message.
 * Rounds up to the nearest standard size with random noise.
 *
 * @param originalSize - Original message size in bytes
 * @returns Padded size in bytes
 */
export function calculatePaddedSize(originalSize: number): number {
  // Find the nearest standard size
  for (const size of STANDARD_SIZES) {
    if (originalSize + PADDING_HEADER_SIZE <= size) {
      // Add some random noise (5-15% of the size)
      const noisePercent = 0.05 + Math.random() * 0.10
      const noise = Math.floor(size * noisePercent)
      const targetSize = size + noise

      // Round up to the nearest standard size
      for (const s of STANDARD_SIZES) {
        if (targetSize <= s) {
          return s
        }
      }
      return size
    }
  }

  // If larger than all standard sizes, use maximum
  return MAX_MESSAGE_SIZE
}

/**
 * Pad a message to standard size.
 * Adds padding bytes to reach the target size.
 *
 * @param content - Original message content
 * @returns PaddedMessage with padding applied
 */
export function padMessage(content: string): PaddedMessage {
  const originalBytes = new TextEncoder().encode(content)
  const originalSize = originalBytes.length

  if (originalSize > MAX_MESSAGE_SIZE) {
    throw new Error(`Message too large: ${originalSize} > ${MAX_MESSAGE_SIZE}`)
  }

  // Calculate padded size
  const paddedSize = calculatePaddedSize(originalSize)

  // Calculate padding needed
  const paddingNeeded = paddedSize - originalSize - PADDING_HEADER_SIZE
  if (paddingNeeded < 0) {
    throw new Error(`Padding calculation error: ${paddingNeeded}`)
  }

  // Generate random padding
  const paddingBytes = randomBytes(paddingNeeded)

  // Create padded message: [original_size (4 bytes)] [content] [padding]
  const padded = new Uint8Array(paddedSize)
  const view = new DataView(padded.buffer)
  view.setUint32(0, originalSize, false) // Big-endian
  padded.set(originalBytes, PADDING_HEADER_SIZE)
  padded.set(paddingBytes, originalSize + PADDING_HEADER_SIZE)

  return {
    content: btoa(String.fromCharCode(...padded)),
    paddedSize,
    originalSize,
    padding: paddingNeeded,
  }
}

/**
 * Remove padding from a message.
 * Extracts the original content from padded data.
 *
 * @param paddedContent - Base64-encoded padded message
 * @returns Original unpadded content
 */
export function unpadMessage(paddedContent: string): string {
  try {
    // Decode base64
    const padded = new Uint8Array(
      atob(paddedContent).split("").map((c) => c.charCodeAt(0))
    )

    // Read original size from header
    const view = new DataView(padded.buffer)
    const originalSize = view.getUint32(0, false) // Big-endian

    // Validate
    if (originalSize > MAX_MESSAGE_SIZE) {
      throw new Error(`Invalid original size: ${originalSize}`)
    }

    if (padded.length < originalSize + PADDING_HEADER_SIZE) {
      throw new Error(`Padded message too short: ${padded.length}`)
    }

    // Extract original content
    const contentBytes = padded.subarray(PADDING_HEADER_SIZE, PADDING_HEADER_SIZE + originalSize)
    return new TextDecoder().decode(contentBytes)
  } catch (err) {
    console.warn("[Padding] Failed to unpad message:", err)
    throw err
  }
}

/**
 * Check if a message is padded.
 * Heuristic check based on padding header presence.
 *
 * @param content - Message content to check
 * @returns true if message appears to be padded
 */
export function isPaddedMessage(content: string): boolean {
  try {
    const bytes = new Uint8Array(
      atob(content).split("").map((c) => c.charCodeAt(0))
    )

    if (bytes.length < PADDING_HEADER_SIZE) {
      return false
    }

    // Read potential original size
    const view = new DataView(bytes.buffer)
    const originalSize = view.getUint32(0, false)

    // Check if size is valid and message is padded
    return (
      originalSize > 0 &&
      originalSize <= MAX_MESSAGE_SIZE &&
      bytes.length > originalSize + PADDING_HEADER_SIZE
    )
  } catch {
    return false
  }
}

/**
 * Get padding statistics for a message.
 * Useful for debugging and analysis.
 *
 * @param paddedContent - Base64-encoded padded message
 * @returns Padding statistics
 */
export function getPaddingStats(paddedContent: string): {
  totalSize: number
  originalSize: number
  paddingSize: number
  paddingPercent: number
} {
  try {
    const padded = new Uint8Array(
      atob(paddedContent).split("").map((c) => c.charCodeAt(0))
    )

    const view = new DataView(padded.buffer)
    const originalSize = view.getUint32(0, false)
    const paddingSize = padded.length - originalSize - PADDING_HEADER_SIZE

    return {
      totalSize: padded.length,
      originalSize,
      paddingSize,
      paddingPercent: (paddingSize / padded.length) * 100,
    }
  } catch {
    return {
      totalSize: 0,
      originalSize: 0,
      paddingSize: 0,
      paddingPercent: 0,
    }
  }
}
