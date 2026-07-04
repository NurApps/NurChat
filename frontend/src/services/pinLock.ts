const PIN_HASH_KEY = "pin_hash"
const PIN_ATTEMPTS_KEY = "pin_attempts"
const PIN_LOCKED_UNTIL_KEY = "pin_locked_until"
const MAX_ATTEMPTS = 3
const LOCKOUT_DURATION_MS = 30000

async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(pin + "nurchat_pin_salt")
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
}

export async function setPin(pin: string): Promise<void> {
  const h = await hashPin(pin)
  localStorage.setItem(PIN_HASH_KEY, h)
  localStorage.removeItem(PIN_ATTEMPTS_KEY)
  localStorage.removeItem(PIN_LOCKED_UNTIL_KEY)
}

export async function verifyPin(pin: string): Promise<boolean> {
  const storedHash = localStorage.getItem(PIN_HASH_KEY)
  if (!storedHash) return true
  const h = await hashPin(pin)
  return h === storedHash
}

export function isPinEnabled(): boolean {
  return !!localStorage.getItem(PIN_HASH_KEY)
}

export function clearPin(): void {
  localStorage.removeItem(PIN_HASH_KEY)
  localStorage.removeItem(PIN_ATTEMPTS_KEY)
  localStorage.removeItem(PIN_LOCKED_UNTIL_KEY)
}

export function getRemainingAttempts(): number {
  const attempts = parseInt(localStorage.getItem(PIN_ATTEMPTS_KEY) || "0", 10)
  return Math.max(0, MAX_ATTEMPTS - attempts)
}

export function recordFailedAttempt(): number {
  const attempts = parseInt(localStorage.getItem(PIN_ATTEMPTS_KEY) || "0", 10) + 1
  localStorage.setItem(PIN_ATTEMPTS_KEY, String(attempts))
  if (attempts >= MAX_ATTEMPTS) {
    localStorage.setItem(PIN_LOCKED_UNTIL_KEY, String(Date.now() + LOCKOUT_DURATION_MS))
  }
  return MAX_ATTEMPTS - attempts
}

export function resetAttempts(): void {
  localStorage.removeItem(PIN_ATTEMPTS_KEY)
  localStorage.removeItem(PIN_LOCKED_UNTIL_KEY)
}

export function getLockoutTimeRemaining(): number {
  const until = parseInt(localStorage.getItem(PIN_LOCKED_UNTIL_KEY) || "0", 10)
  const remaining = until - Date.now()
  return Math.max(0, remaining)
}

export function isLockedOut(): boolean {
  return getLockoutTimeRemaining() > 0
}
