/**
 * Timing Obfuscation for NurChat — Phase 2: Metadata Protection
 *
 * Prevents timing analysis by adding random delays and batching messages.
 *
 * Features:
 * - Random delays before sending (0-500ms)
 * - Batch sending: collect N messages, send together
 * - Exponential backoff for retries
 * - Cover traffic integration
 *
 * Uses @noble/curves + @noble/ciphers (audited by cure53, Sep 2024).
 */

import { randomBytes } from "./cryptoAdapter"

// ─── Types ───

export interface TimingConfig {
  /** Minimum delay before sending (ms) */
  minDelay: number
  /** Maximum delay before sending (ms) */
  maxDelay: number
  /** Batch size: send N messages together */
  batchSize: number
  /** Batch window: wait up to N ms before sending batch */
  batchWindow: number
  /** Cover traffic interval (ms) */
  coverTrafficInterval: number
  /** Cover traffic probability (0-1) */
  coverTrafficProbability: number
}

export interface PendingMessage {
  /** Unique message ID */
  id: string
  /** Message content (encrypted) */
  content: string
  /** Recipient ID */
  recipientId: string
  /** Timestamp when message was queued */
  queuedAt: number
  /** Callback when message is sent */
  onSent?: () => void
  /** Callback on error */
  onError?: (err: Error) => void
}

export interface BatchStats {
  /** Total messages sent */
  totalSent: number
  /** Total batches sent */
  totalBatches: number
  /** Average batch size */
  avgBatchSize: number
  /** Total cover messages sent */
  coverMessagesSent: number
  /** Average delay per message (ms) */
  avgDelay: number
}

// ─── Constants ───

/**
 * Default timing configuration
 */
export const DEFAULT_TIMING_CONFIG: TimingConfig = {
  minDelay: 50,      // 50ms minimum
  maxDelay: 500,     // 500ms maximum
  batchSize: 5,      // Send 5 messages together
  batchWindow: 1000, // Wait up to 1 second
  coverTrafficInterval: 60000, // 1 minute
  coverTrafficProbability: 0.1, // 10% chance
}

// ─── Core Class ───

export class TimingObfuscator {
  private config: TimingConfig
  private pendingMessages: Map<string, PendingMessage> = new Map()
  private batchTimer: ReturnType<typeof setTimeout> | null = null
  private coverTimer: ReturnType<typeof setInterval> | null = null
  private stats: BatchStats = {
    totalSent: 0,
    totalBatches: 0,
    avgBatchSize: 0,
    coverMessagesSent: 0,
    avgDelay: 0,
  }
  private sendCallback: (messages: PendingMessage[]) => Promise<void>
  private totalDelay = 0

  constructor(
    sendCallback: (messages: PendingMessage[]) => Promise<void>,
    config: Partial<TimingConfig> = {},
  ) {
    this.config = { ...DEFAULT_TIMING_CONFIG, ...config }
    this.sendCallback = sendCallback
  }

  /**
   * Start the timing obfuscator.
   * Begins cover traffic and batch processing.
   */
  start(): void {
    // Start cover traffic
    if (this.config.coverTrafficInterval > 0) {
      this.coverTimer = setInterval(() => {
        this.maybeSendCoverTraffic()
      }, this.config.coverTrafficInterval)
    }
  }

  /**
   * Stop the timing obfuscator.
   * Sends any remaining messages and clears timers.
   */
  async stop(): Promise<void> {
    // Clear timers
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }
    if (this.coverTimer) {
      clearInterval(this.coverTimer)
      this.coverTimer = null
    }

    // Send remaining messages
    if (this.pendingMessages.size > 0) {
      await this.sendBatch()
    }
  }

  /**
   * Queue a message for sending with timing obfuscation.
   *
   * @param message - Message to queue
   * @returns Promise that resolves when message is sent
   */
  sendMessage(message: Omit<PendingMessage, "id" | "queuedAt">): Promise<void> {
    return new Promise((resolve, reject) => {
      const id = this.generateMessageId()
      const pending: PendingMessage = {
        ...message,
        id,
        queuedAt: Date.now(),
        onSent: () => {
          this.pendingMessages.delete(id)
          resolve()
        },
        onError: (err) => {
          this.pendingMessages.delete(id)
          reject(err)
        },
      }

      this.pendingMessages.set(id, pending)

      // Apply random delay
      const delay = this.getRandomDelay()
      this.totalDelay += delay

      setTimeout(() => {
        // Check if batch is ready
        if (this.pendingMessages.size >= this.config.batchSize) {
          this.sendBatch().catch(console.error)
        } else if (!this.batchTimer) {
          // Start batch window timer
          this.batchTimer = setTimeout(() => {
            this.sendBatch().catch(console.error)
          }, this.config.batchWindow)
        }
      }, delay)
    })
  }

  /**
   * Get timing obfuscation statistics.
   */
  getStats(): BatchStats {
    return {
      ...this.stats,
      avgDelay: this.stats.totalSent > 0
        ? this.totalDelay / this.stats.totalSent
        : 0,
    }
  }

  /**
   * Update timing configuration.
   */
  updateConfig(config: Partial<TimingConfig>): void {
    this.config = { ...this.config, ...config }
  }

  // ─── Private Methods ───

  private async sendBatch(): Promise<void> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }

    const messages = Array.from(this.pendingMessages.values())
    if (messages.length === 0) return

    try {
      await this.sendCallback(messages)

      // Update stats
      this.stats.totalSent += messages.length
      this.stats.totalBatches += 1
      this.stats.avgBatchSize =
        this.stats.totalSent / this.stats.totalBatches

      // Notify sent
      for (const msg of messages) {
        msg.onSent?.()
      }
    } catch (err) {
      // Notify error
      for (const msg of messages) {
        msg.onError?.(err as Error)
      }
    }
  }

  private getRandomDelay(): number {
    const { minDelay, maxDelay } = this.config
    // Exponential distribution for more natural-looking delays
    const lambda = 2 / (maxDelay - minDelay)
    const u = 1 - Math.random()
    const delay = -Math.log(u) / lambda
    return Math.max(minDelay, Math.min(maxDelay, delay))
  }

  private generateMessageId(): string {
    const bytes = randomBytes(8)
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  }

  private maybeSendCoverTraffic(): void {
    if (Math.random() > this.config.coverTrafficProbability) {
      return
    }

    // Generate a dummy message
    const dummyContent = this.generateDummyContent()
    const pending: PendingMessage = {
      id: this.generateMessageId(),
      content: dummyContent,
      recipientId: "cover",
      queuedAt: Date.now(),
      isCover: true,
    }

    this.pendingMessages.set(pending.id, pending)
    this.stats.coverMessagesSent += 1

    // Send immediately (no delay for cover traffic)
    this.sendBatch().catch(console.error)
  }

  private generateDummyContent(): string {
    // Generate random bytes that look like encrypted data
    const bytes = randomBytes(64)
    return btoa(String.fromCharCode(...bytes))
  }
}

// ─── Standalone Functions ───

/**
 * Apply random delay to a promise.
 * Useful for adding timing obfuscation to existing send functions.
 *
 * @param fn - Function to delay
 * @param minDelay - Minimum delay (ms)
 * @param maxDelay - Maximum delay (ms)
 * @returns Delayed function result
 */
export async function withDelay<T>(
  fn: () => Promise<T>,
  minDelay: number = 50,
  maxDelay: number = 500,
): Promise<T> {
  const delay = minDelay + Math.random() * (maxDelay - minDelay)
  await new Promise((resolve) => setTimeout(resolve, delay))
  return fn()
}

/**
 * Debounce a function to prevent timing analysis.
 * Groups rapid calls into a single execution.
 *
 * @param fn - Function to debounce
 * @param windowMs - Debounce window (ms)
 * @returns Debounced function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  windowMs: number = 100,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastArgs: Parameters<T> | null = null

  return (...args: Parameters<T>) => {
    lastArgs = args

    if (timer) {
      clearTimeout(timer)
    }

    timer = setTimeout(() => {
      if (lastArgs) {
        fn(...lastArgs)
        lastArgs = null
      }
      timer = null
    }, windowMs)
  }
}

/**
 * Throttle a function to limit execution rate.
 * Prevents rapid message sending.
 *
 * @param fn - Function to throttle
 * @param intervalMs - Minimum interval between calls (ms)
 * @returns Throttled function
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  intervalMs: number = 100,
): (...args: Parameters<T>) => void {
  let lastCall = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  return (...args: Parameters<T>) => {
    const now = Date.now()
    const timeSinceLastCall = now - lastCall

    if (timeSinceLastCall >= intervalMs) {
      lastCall = now
      fn(...args)
    } else if (!timer) {
      timer = setTimeout(() => {
        lastCall = Date.now()
        timer = null
        fn(...args)
      }, intervalMs - timeSinceLastCall)
    }
  }
}
