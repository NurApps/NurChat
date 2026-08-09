/**
 * Cover Traffic & Timing Obfuscation for NurChat — Phase 2: Metadata Protection
 *
 * Makes traffic analysis harder by:
 * 1. Random delays before sending
 * 2. Dummy messages (cover traffic)
 * 3. Constant-rate sending
 *
 * Features:
 * - Configurable delay range (0-500ms)
 * - Dummy messages with random content
 * - Probability-based dummy insertion (10%)
 * - Batch sending for timing normalization
 *
 * Uses @noble/curves + @noble/ciphers (audited by cure53, Sep 2024).
 */

import { randomBytes } from "./cryptoAdapter"

// ─── Types ───

export interface TimingConfig {
  /** Minimum delay before sending (ms) */
  minDelayMs: number
  /** Maximum delay before sending (ms) */
  maxDelayMs: number
  /** Probability of sending dummy message (0-1) */
  dummyProbability: number
  /** Batch size for grouped sending */
  batchSize: number
  /** Max time to wait before flushing batch (ms) */
  batchTimeoutMs: number
  /** Constant rate target (messages per second) */
  constantRate: number
}

export interface PendingMessage {
  /** Message ID */
  id: string
  /** Encrypted ciphertext */
  ciphertext: string
  /** Timestamp when created */
  createdAt: number
  /** Whether this is a dummy message */
  isDummy: boolean
  /** Callback when sent */
  onSent?: () => void
}

// ─── Constants ───

const DEFAULT_CONFIG: TimingConfig = {
  minDelayMs: 0,
  maxDelayMs: 500,
  dummyProbability: 0.1,
  batchSize: 5,
  batchTimeoutMs: 1000,
  constantRate: 0.5, // 0.5 messages per second
}

// ─── Core Class ───

export class CoverTrafficManager {
  private config: TimingConfig
  private pendingQueue: PendingMessage[] = []
  private batchTimer: ReturnType<typeof setTimeout> | null = null
  private rateLimiter: RateLimiter | null = null
  private isRunning = false

  constructor(config: Partial<TimingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }

    if (this.config.constantRate > 0) {
      this.rateLimiter = new RateLimiter(this.config.constantRate)
    }
  }

  /**
   * Start the cover traffic manager.
   */
  start(): void {
    this.isRunning = true
    this.startBatchTimer()
  }

  /**
   * Stop the cover traffic manager.
   */
  stop(): void {
    this.isRunning = false
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }
    this.flushBatch()
  }

  /**
   * Queue a message for sending with obfuscated timing.
   *
   * @param ciphertext - Encrypted message
   * @param onSent - Callback when message is sent
   * @returns Message ID
   */
  async queueMessage(ciphertext: string, onSent?: () => void): Promise<string> {
    const id = bytesToHex(randomBytes(16))

    const message: PendingMessage = {
      id,
      ciphertext,
      createdAt: Date.now(),
      isDummy: false,
      onSent,
    }

    // Apply random delay
    const delay = this.randomDelay()
    await sleep(delay)

    // Add to queue
    this.pendingQueue.push(message)

    // Maybe send dummy
    if (Math.random() < this.config.dummyProbability) {
      this.sendDummy()
    }

    // Check if batch is ready
    if (this.pendingQueue.length >= this.config.batchSize) {
      this.flushBatch()
    }

    return id
  }

  /**
   * Get queue statistics.
   */
  getStats(): {
    pending: number
    sent: number
    dummies: number
  } {
    return {
      pending: this.pendingQueue.length,
      sent: 0, // Would need to track this
      dummies: 0,
    }
  }

  // ─── Private Methods ───

  private randomDelay(): number {
    return Math.floor(
      Math.random() * (this.config.maxDelayMs - this.config.minDelayMs + 1) +
        this.config.minDelayMs,
    )
  }

  private async sendDummy(): Promise<void> {
    const dummyContent = bytesToHex(randomBytes(32))
    const dummy: PendingMessage = {
      id: bytesToHex(randomBytes(16)),
      ciphertext: dummyContent,
      createdAt: Date.now(),
      isDummy: true,
    }

    this.pendingQueue.push(dummy)
  }

  private startBatchTimer(): void {
    if (!this.isRunning) return

    this.batchTimer = setTimeout(() => {
      this.flushBatch()
      this.startBatchTimer()
    }, this.config.batchTimeoutMs)
  }

  private flushBatch(): void {
    if (this.pendingQueue.length === 0) return

    const batch = [...this.pendingQueue]
    this.pendingQueue = []

    // Apply rate limiting
    if (this.rateLimiter) {
      this.rateLimiter.waitForSlot()
    }

    // Send batch (would call API in production)
    for (const msg of batch) {
      if (!msg.isDummy && msg.onSent) {
        msg.onSent()
      }
    }
  }
}

// ─── Rate Limiter ───

class RateLimiter {
  private tokens: number
  private maxTokens: number
  private refillRate: number
  private lastRefill: number

  constructor(rate: number) {
    this.maxTokens = Math.max(1, Math.ceil(rate * 2))
    this.tokens = this.maxTokens
    this.refillRate = rate
    this.lastRefill = Date.now()
  }

  async waitForSlot(): Promise<void> {
    this.refill()

    while (this.tokens <= 0) {
      await sleep(100)
      this.refill()
    }

    this.tokens--
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = (now - this.lastRefill) / 1000
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate)
    this.lastRefill = now
  }
}

// ─── Timing Obfuscation Helpers ───

/**
 * Apply random delay to a promise.
 *
 * @param promise - Original promise
 * @param minMs - Minimum delay
 * @param maxMs - Maximum delay
 * @returns Promise with random delay
 */
export async function withRandomDelay<T>(
  promise: Promise<T>,
  minMs = 0,
  maxMs = 500,
): Promise<T> {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1) + minMs)
  await sleep(delay)
  return promise
}

/**
 * Constant-rate message sender.
 * Sends messages at a fixed rate regardless of input.
 *
 * @param messages - Messages to send
 * @param rate - Messages per second
 * @param sendFn - Function to send a message
 */
export async function constantRateSend<T>(
  messages: T[],
  rate: number,
  sendFn: (msg: T) => Promise<void>,
): Promise<void> {
  const intervalMs = 1000 / rate

  for (const msg of messages) {
    await sendFn(msg)
    await sleep(intervalMs)
  }
}

/**
 * Add noise to message timestamps.
 * Rounds timestamps to random intervals to prevent timing analysis.
 *
 * @param timestamp - Original timestamp
 * @param precisionMs - Rounding precision (default: 1 second)
 * @returns Noised timestamp
 */
export function noiceTimestamp(timestamp: number, precisionMs = 1000): number {
  const noise = Math.floor(Math.random() * precisionMs)
  return Math.floor((timestamp + noise) / precisionMs) * precisionMs
}

// ─── Helpers ───

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}
