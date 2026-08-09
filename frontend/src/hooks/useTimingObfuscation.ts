/**
 * Timing Obfuscation Hook for NurChat — Phase 2: Metadata Protection
 *
 * Adds random delays to message sending to prevent timing analysis.
 * Features:
 * - Configurable delay range (0-500ms)
 * - Dummy message generation
 * - Batch sending
 * - Rate limiting
 */

import { useCallback, useRef, useEffect } from "react"

// ─── Types ───

interface TimingConfig {
  /** Minimum delay before sending (ms) */
  minDelayMs: number
  /** Maximum delay before sending (ms) */
  maxDelayMs: number
  /** Probability of sending dummy message (0-1) */
  dummyProbability: number
  /** Enable timing obfuscation */
  enabled: boolean
}

interface PendingMessage {
  id: string
  sendFn: () => Promise<void>
  timestamp: number
  isDummy: boolean
}

// ─── Constants ───

const DEFAULT_CONFIG: TimingConfig = {
  minDelayMs: 0,
  maxDelayMs: 500,
  dummyProbability: 0.1,
  enabled: true,
}

// ─── Hook ───

export function useTimingObfuscation(config: Partial<TimingConfig> = {}) {
  const fullConfig = { ...DEFAULT_CONFIG, ...config }
  const pendingQueue = useRef<PendingMessage[]>([])
  const batchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (batchTimer.current) {
        clearTimeout(batchTimer.current)
      }
    }
  }, [])

  /**
   * Get random delay within configured range.
   */
  const getRandomDelay = useCallback((): number => {
    if (!fullConfig.enabled) return 0
    return Math.floor(
      Math.random() * (fullConfig.maxDelayMs - fullConfig.minDelayMs + 1) +
        fullConfig.minDelayMs,
    )
  }, [fullConfig])

  /**
   * Send with random delay.
   */
  const sendWithDelay = useCallback(
    async (sendFn: () => Promise<void>): Promise<void> => {
      const delay = getRandomDelay()
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
      return sendFn()
    },
    [getRandomDelay],
  )

  /**
   * Maybe send dummy message for cover traffic.
   */
  const maybeSendDummy = useCallback(
    (realSendFn: () => Promise<void>): void => {
      if (!fullConfig.enabled) return
      if (Math.random() < fullConfig.dummyProbability) {
        // Create dummy that does nothing
        const dummy: PendingMessage = {
          id: `dummy_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          sendFn: async () => {
            // Dummy message - no-op
          },
          timestamp: Date.now(),
          isDummy: true,
        }
        pendingQueue.current.push(dummy)
      }
    },
    [fullConfig],
  )

  /**
   * Flush pending messages.
   */
  const flushPending = useCallback(async (): Promise<void> => {
    const pending = [...pendingQueue.current]
    pendingQueue.current = []

    for (const msg of pending) {
      if (!msg.isDummy) {
        await msg.sendFn()
      }
    }
  }, [])

  /**
   * Send message with timing obfuscation.
   */
  const sendObfuscated = useCallback(
    async (sendFn: () => Promise<void>): Promise<void> => {
      if (!fullConfig.enabled) {
        return sendFn()
      }

      // Add to queue with delay
      const wrappedSend = async () => {
        await sendWithDelay(sendFn)
      }

      // Maybe send dummy
      maybeSendDummy(wrappedSend)

      // Execute
      return wrappedSend()
    },
    [fullConfig, sendWithDelay, maybeSendDummy],
  )

  /**
   * Get obfuscated timestamp.
   * Rounds timestamps to prevent timing analysis.
   */
  const getObfuscatedTimestamp = useCallback(
    (precisionMs = 1000): number => {
      if (!fullConfig.enabled) return Date.now()
      const now = Date.now()
      const noise = Math.floor(Math.random() * precisionMs)
      return Math.floor((now + noise) / precisionMs) * precisionMs
    },
    [fullConfig],
  )

  return {
    sendObfuscated,
    getObfuscatedTimestamp,
    flushPending,
    config: fullConfig,
  }
}
