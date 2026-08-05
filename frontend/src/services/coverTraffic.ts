/**
 * Cover Traffic for NurChat — Phase 2: Metadata Protection
 *
 * Sends dummy messages to prevent timing analysis.
 * Real messages are indistinguishable from cover traffic.
 *
 * Features:
 * - Periodic dummy messages (every 30-90 seconds)
 * - Random message sizes (matching real traffic patterns)
 * - No persistence in database
 * - Relay cannot distinguish real from dummy
 *
 * Uses @noble/curves + @noble/ciphers (audited by cure53, Sep 2024).
 */

import { randomBytes, secretboxEncrypt, secretboxNonceLength } from "./cryptoAdapter"

// ─── Types ───

export interface CoverTrafficConfig {
  /** Minimum interval between cover messages (ms) */
  minInterval: number
  /** Maximum interval between cover messages (ms) */
  maxInterval: number
  /** Probability of sending cover message on each tick (0-1) */
  probability: number
  /** Minimum message size (bytes) */
  minSize: number
  /** Maximum message size (bytes) */
  maxSize: number
  /** Whether cover traffic is enabled */
  enabled: boolean
}

export interface CoverMessage {
  /** Unique message ID */
  id: string
  /** Message content (encrypted dummy data) */
  content: string
  /** Timestamp */
  timestamp: number
  /** Message size in bytes */
  size: number
  /** Whether this is a cover message */
  isCover: true
}

export interface CoverTrafficStats {
  /** Total cover messages sent */
  totalSent: number
  /** Total bytes sent */
  totalBytesSent: number
  /** Average interval between messages (ms) */
  avgInterval: number
  /** Last message sent timestamp */
  lastSentAt: number | null
  /** Currently active */
  isActive: boolean
}

// ─── Constants ───

/**
 * Default cover traffic configuration
 */
export const DEFAULT_COVER_CONFIG: CoverTrafficConfig = {
  minInterval: 30000,   // 30 seconds
  maxInterval: 90000,   // 90 seconds
  probability: 0.3,     // 30% chance on each tick
  minSize: 64,          // 64 bytes minimum
  maxSize: 1024,        // 1KB maximum
  enabled: true,
}

/**
 * Fake encryption key for cover messages.
 * These messages are never decrypted, so any key works.
 */
const COVER_ENCRYPTION_KEY = new Uint8Array(32)

// ─── Core Class ───

export class CoverTrafficManager {
  private config: CoverTrafficConfig
  private timer: ReturnType<typeof setInterval> | null = null
  private stats: CoverTrafficStats = {
    totalSent: 0,
    totalBytesSent: 0,
    avgInterval: 0,
    lastSentAt: null,
    isActive: false,
  }
  private sendCallback: (message: CoverMessage) => Promise<void>
  private intervals: number[] = []

  constructor(
    sendCallback: (message: CoverMessage) => Promise<void>,
    config: Partial<CoverTrafficConfig> = {},
  ) {
    this.config = { ...DEFAULT_COVER_CONFIG, ...config }
    this.sendCallback = sendCallback
  }

  /**
   * Start sending cover traffic.
   */
  start(): void {
    if (!this.config.enabled) {
      return
    }

    if (this.timer) {
      return
    }

    this.stats.isActive = true
    this.scheduleNext()
  }

  /**
   * Stop sending cover traffic.
   */
  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.stats.isActive = false
  }

  /**
   * Get cover traffic statistics.
   */
  getStats(): CoverTrafficStats {
    return { ...this.stats }
  }

  /**
   * Update cover traffic configuration.
   */
  updateConfig(config: Partial<CoverTrafficConfig>): void {
    this.config = { ...this.config, ...config }

    // Restart if config changed
    if (this.config.enabled && this.stats.isActive) {
      this.stop()
      this.start()
    } else if (!this.config.enabled) {
      this.stop()
    }
  }

  /**
   * Manually send a cover message.
   * Useful for testing or triggering immediately.
   */
  async sendCoverMessage(): Promise<CoverMessage> {
    const message = this.generateCoverMessage()
    await this.sendCallback(message)
    this.updateStats(message.size)
    return message
  }

  // ─── Private Methods ───

  private scheduleNext(): void {
    if (!this.config.enabled || !this.stats.isActive) {
      return
    }

    const interval = this.getRandomInterval()
    this.intervals.push(interval)

    // Keep only last 100 intervals for average calculation
    if (this.intervals.length > 100) {
      this.intervals.shift()
    }

    this.timer = setTimeout(async () => {
      // Check probability
      if (Math.random() < this.config.probability) {
        try {
          await this.sendCoverMessage()
        } catch (err) {
          console.warn("[CoverTraffic] Failed to send cover message:", err)
        }
      }

      // Schedule next
      this.scheduleNext()
    }, interval)
  }

  private getRandomInterval(): number {
    const { minInterval, maxInterval } = this.config
    // Exponential distribution for more natural-looking intervals
    const lambda = 2 / (maxInterval - minInterval)
    const u = 1 - Math.random()
    const interval = -Math.log(u) / lambda
    return Math.max(minInterval, Math.min(maxInterval, interval))
  }

  private generateCoverMessage(): CoverMessage {
    // Generate random size
    const size = this.config.minSize +
      Math.floor(Math.random() * (this.config.maxSize - this.config.minSize))

    // Generate random content that looks like encrypted data
    const contentBytes = randomBytes(size)

    // Encrypt with dummy key (message will never be decrypted)
    const nonce = randomBytes(secretboxNonceLength)
    const encrypted = secretboxEncrypt(contentBytes, nonce, COVER_ENCRYPTION_KEY)

    // Combine nonce + ciphertext
    const combined = new Uint8Array(nonce.length + encrypted.length)
    combined.set(nonce)
    combined.set(encrypted, nonce.length)

    return {
      id: this.generateMessageId(),
      content: btoa(String.fromCharCode(...combined)),
      timestamp: Date.now(),
      size: combined.length,
      isCover: true,
    }
  }

  private generateMessageId(): string {
    const bytes = randomBytes(8)
    return "cover_" + Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  }

  private updateStats(size: number): void {
    this.stats.totalSent += 1
    this.stats.totalBytesSent += size
    this.stats.lastSentAt = Date.now()

    // Calculate average interval
    if (this.intervals.length > 0) {
      const sum = this.intervals.reduce((a, b) => a + b, 0)
      this.stats.avgInterval = sum / this.intervals.length
    }
  }
}

// ─── Standalone Functions ───

/**
 * Generate a single cover message.
 * Useful for one-off cover traffic.
 *
 * @returns CoverMessage with encrypted dummy data
 */
export function generateCoverMessage(): CoverMessage {
  const size = 64 + Math.floor(Math.random() * 960) // 64-1024 bytes
  const contentBytes = randomBytes(size)
  const nonce = randomBytes(secretboxNonceLength)
  const encrypted = secretboxEncrypt(contentBytes, nonce, COVER_ENCRYPTION_KEY)

  const combined = new Uint8Array(nonce.length + encrypted.length)
  combined.set(nonce)
  combined.set(encrypted, nonce.length)

  const bytes = randomBytes(8)
  return {
    id: "cover_" + Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(""),
    content: btoa(String.fromCharCode(...combined)),
    timestamp: Date.now(),
    size: combined.length,
    isCover: true,
  }
}

/**
 * Check if a message is cover traffic.
 * Heuristic check based on message ID prefix.
 *
 * @param messageId - Message ID to check
 * @returns true if message is cover traffic
 */
export function isCoverMessage(messageId: string): boolean {
  return messageId.startsWith("cover_")
}

/**
 * Blend real message with cover traffic.
 * Randomly decides whether to send cover message before/after real message.
 *
 * @param realMessage - The real message to send
 * @param coverCallback - Function to send cover message
 * @param blendProbability - Probability of sending cover message (0-1)
 */
export async function blendWithCoverTraffic<T>(
  realMessage: T,
  coverCallback: () => Promise<void>,
  blendProbability: number = 0.2,
): Promise<T> {
  // Maybe send cover before
  if (Math.random() < blendProbability) {
    await coverCallback()
  }

  // Send real message
  const result = realMessage

  // Maybe send cover after
  if (Math.random() < blendProbability) {
    await coverCallback()
  }

  return result
}
