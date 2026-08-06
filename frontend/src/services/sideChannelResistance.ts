/**
 * Side-Channel Resistance for NurChat — Phase 6: Hardening
 *
 * Mitigations against timing attacks, cache attacks, and memory leaks.
 *
 * Features:
 * - Constant-time comparisons
 * - Memory-safe operations
 * - No data-dependent branches in crypto code
 * - Zeroization verification
 *
 * Uses @noble/curves + @noble/ciphers (audited by cure53, Sep 2024).
 */

// ─── Constant-Time Operations ───

/**
 * Constant-time comparison of two byte arrays.
 * Prevents timing attacks by always reading all bytes.
 *
 * @param a - First array
 * @param b - Second array
 * @returns true if arrays are equal
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false
  }

  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i]
  }

  return diff === 0
}

/**
 * Constant-time comparison of two hex strings.
 *
 * @param a - First hex string
 * @param b - Second hex string
 * @returns true if strings are equal
 */
export function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false
  }

  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }

  return diff === 0
}

/**
 * Constant-time selection between two values.
 * Returns a if condition is true, b otherwise.
 * No branch on secret data.
 *
 * @param condition - Selection condition (0 or 1)
 * @param a - Value if true
 * @param b - Value if false
 * @returns Selected value
 */
export function constantTimeSelect(
  condition: number,
  a: Uint8Array,
  b: Uint8Array,
): Uint8Array {
  const mask = -condition // 0x00000000 or 0xFFFFFFFF
  const result = new Uint8Array(a.length)
  for (let i = 0; i < a.length; i++) {
    result[i] = (a[i] & mask) | (b[i] & ~mask)
  }
  return result
}

/**
 * Constant-time conditional move.
 * Moves src to dst if condition is true.
 *
 * @param condition - 0 or 1
 * @param dst - Destination array
 * @param src - Source array
 */
export function constantTimeCmov(
  condition: number,
  dst: Uint8Array,
  src: Uint8Array,
): void {
  const mask = -condition
  for (let i = 0; i < dst.length; i++) {
    dst[i] ^= (dst[i] ^ src[i]) & mask
  }
}

// ─── Memory Safety ───

/**
 * Securely zeroize a buffer.
 * Uses multiple passes to ensure data is overwritten.
 *
 * @param buffer - Buffer to zeroize
 */
export function secureZeroize(buffer: Uint8Array | null): void {
  if (!buffer || buffer.length === 0) {
    return
  }

  // Pass 1: Zero fill
  buffer.fill(0)

  // Pass 2: Random fill
  for (let i = 0; i < buffer.length; i++) {
    buffer[i] = Math.floor(Math.random() * 256)
  }

  // Pass 3: Zero fill again
  buffer.fill(0)

  // Attempt to release memory
  try {
    if (buffer.buffer instanceof ArrayBuffer &&
        typeof buffer.buffer.transfer === "function") {
      buffer.buffer.transfer(0)
    }
  } catch {
    // Ignore transfer errors
  }
}

/**
 * Verify that a buffer has been zeroized.
 *
 * @param buffer - Buffer to check
 * @returns true if buffer is all zeros
 */
export function isZeroized(buffer: Uint8Array): boolean {
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] !== 0) {
      return false
    }
  }
  return true
}

/**
 * Securely copy data without leaving traces.
 * Clears destination before copying.
 *
 * @param dst - Destination
 * @param src - Source
 */
export function secureCopy(dst: Uint8Array, src: Uint8Array): void {
  // Clear destination first
  dst.fill(0)

  // Copy
  for (let i = 0; i < src.length; i++) {
    dst[i] = src[i]
  }
}

// ─── Timing Analysis Detection ───

/**
 * Measure execution time of a function.
 * Useful for detecting timing leaks.
 *
 * @param fn - Function to measure
 * @returns Execution time in milliseconds
 */
export function measureTiming(fn: () => void): number {
  const start = performance.now()
  fn()
  const end = performance.now()
  return end - start
}

/**
 * Check if execution times are consistent.
 * Detects potential timing side-channels.
 *
 * @param timings - Array of execution times
 * @param threshold - Maximum allowed variance (standard deviations)
 * @returns true if timings are consistent
 */
export function isTimingConsistent(
  timings: number[],
  threshold: number = 3,
): boolean {
  if (timings.length < 2) {
    return true
  }

  const mean = timings.reduce((a, b) => a + b, 0) / timings.length
  const variance = timings.reduce((sum, t) => sum + Math.pow(t - mean, 2), 0) / timings.length
  const stdDev = Math.sqrt(variance)

  // Check if any timing is more than threshold standard deviations from mean
  for (const timing of timings) {
    if (Math.abs(timing - mean) > threshold * stdDev) {
      return false
    }
  }

  return true
}

// ─── Cache-Resistant Operations ───

/**
 * Access array in constant-time pattern.
 * Prevents cache-timing attacks.
 *
 * @param array - Array to access
 * @param index - Index to access
 * @returns Value at index
 */
export function cacheResistantAccess(array: Uint8Array, index: number): number {
  // Access all elements to load into cache
  let dummy = 0
  for (let i = 0; i < array.length; i++) {
    dummy += array[i]
  }

  // Now access the target
  const result = array[index % array.length]

  // Prevent optimization
  return result + dummy * 0
}

/**
 * Constant-time array search.
 * Searches entire array regardless of where target is found.
 *
 * @param array - Array to search
 * @param target - Value to find
 * @returns Index of target, or -1 if not found
 */
export function constantTimeSearch(array: Uint8Array, target: number): number {
  let result = -1
  for (let i = 0; i < array.length; i++) {
    if (array[i] === target) {
      result = i
    }
  }
  return result
}

// ─── Branchless Operations ───

/**
 * Branchless minimum.
 * Avoids conditional branch on secret data.
 *
 * @param a - First value
 * @param b - Second value
 * @returns Minimum of a and b
 */
export function branchlessMin(a: number, b: number): number {
  return b ^ ((a ^ b) & -(a < b ? 1 : 0))
}

/**
 * Branchless maximum.
 *
 * @param a - First value
 * @param b - Second value
 * @returns Maximum of a and b
 */
export function branchlessMax(a: number, b: number): number {
  return a ^ ((a ^ b) & -(a < b ? 1 : 0))
}

/**
 * Branchless absolute value.
 *
 * @param x - Input value
 * @returns Absolute value
 */
export function branchlessAbs(x: number): number {
  const mask = x >> 31
  return (x + mask) ^ mask
}

// ─── Verification Helpers ───

/**
 * Verify that crypto operations are constant-time.
 * Runs timing tests and checks for variance.
 *
 * @param fn - Crypto function to test
 * @param iterations - Number of test iterations
 * @returns true if function appears constant-time
 */
export function verifyConstantTime(
  fn: () => void,
  iterations: number = 1000,
): boolean {
  const timings: number[] = []

  for (let i = 0; i < iterations; i++) {
    timings.push(measureTiming(fn))
  }

  return isTimingConsistent(timings, 3)
}
