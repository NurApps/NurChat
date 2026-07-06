/**
 * Key verification store — tracks known public keys and warns on changes
 */

const KNOWN_KEYS_KEY = "known_public_keys"

interface KnownKey {
  userId: string
  publicKey: string
  verified: boolean
  firstSeen: string
  lastSeen: string
}

function getKnownKeys(): KnownKey[] {
  try {
    return JSON.parse(localStorage.getItem(KNOWN_KEYS_KEY) || "[]")
  } catch {
    return []
  }
}

function saveKnownKeys(keys: KnownKey[]) {
  localStorage.setItem(KNOWN_KEYS_KEY, JSON.stringify(keys))
}

/**
 * Check if a user's key has changed since we last saw it
 * Returns: "new" | "changed" | "verified" | "unknown"
 */
export function checkKeyStatus(
  userId: string,
  publicKey: string,
): "new" | "changed" | "verified" | "unknown" {
  const keys = getKnownKeys()
  const existing = keys.find((k) => k.userId === userId)

  if (!existing) {
    // New key — store it
    keys.push({
      userId,
      publicKey,
      verified: false,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    })
    saveKnownKeys(keys)
    return "new"
  }

  if (existing.publicKey === publicKey) {
    // Same key — update last seen
    existing.lastSeen = new Date().toISOString()
    saveKnownKeys(keys)
    return existing.verified ? "verified" : "unknown"
  }

  // Key changed!
  existing.publicKey = publicKey
  existing.verified = false
  existing.lastSeen = new Date().toISOString()
  saveKnownKeys(keys)
  return "changed"
}

/**
 * Mark a user's key as verified (safety number matched)
 */
export function markKeyVerified(userId: string) {
  const keys = getKnownKeys()
  const existing = keys.find((k) => k.userId === userId)
  if (existing) {
    existing.verified = true
    saveKnownKeys(keys)
  }
}

/**
 * Get verification status for a user
 */
export function getKeyVerificationStatus(userId: string): {
  verified: boolean
  firstSeen: string
  lastSeen: string
} | null {
  const keys = getKnownKeys()
  const existing = keys.find((k) => k.userId === userId)
  if (!existing) return null
  return {
    verified: existing.verified,
    firstSeen: existing.firstSeen,
    lastSeen: existing.lastSeen,
  }
}

/**
 * Get all known keys
 */
export function getAllKnownKeys(): KnownKey[] {
  return getKnownKeys()
}
