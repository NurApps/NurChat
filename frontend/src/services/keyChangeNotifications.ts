/**
 * Key Change Notifications for NurChat — Phase 3: Key Transparency & Verification
 *
 * Notifies users when a contact's public key changes.
 * Helps detect MITM attacks and key compromise.
 *
 * Features:
 * - Key change detection
 * - Verification status tracking
 * - Warning notifications
 * - Key rotation history
 *
 * Uses @noble/curves + @noble/ciphers (audited by cure53, Sep 2024).
 */

import { generateSafetyNumber } from "./safetyNumber"

// ─── Types ───

export interface KeyChangeNotification {
  /** Notification ID */
  id: string
  /** User ID whose key changed */
  userId: string
  /** Username */
  username: string
  /** Old public key (hex) */
  oldPublicKeyHex: string
  /** New public key (hex) */
  newPublicKeyHex: string
  /** Timestamp of change */
  timestamp: number
  /** Whether user has verified the new key */
  verified: boolean
  /** Safety number before change */
  oldSafetyNumber?: string
  /** Safety number after change */
  newSafetyNumber?: string
  /** Whether notification has been dismissed */
  dismissed: boolean
}

export interface KeyRotationEntry {
  /** User ID */
  userId: string
  /** Old public key (hex) */
  oldPublicKeyHex: string
  /** New public key (hex) */
  newPublicKeyHex: string
  /** Timestamp */
  timestamp: number
  /** Reason for rotation */
  reason?: string
}

export interface KeyChangeStats {
  /** Total key changes detected */
  totalChanges: number
  /** Changes verified by user */
  verifiedChanges: number
  /** Changes dismissed by user */
  dismissedChanges: number
  /** Pending changes */
  pendingChanges: number
}

// ─── Constants ───

/**
 * Local storage key for notifications
 */
const NOTIFICATIONS_KEY = "key_change_notifications"

/**
 * Local storage key for rotation history
 */
const ROTATION_HISTORY_KEY = "key_rotation_history"

/**
 * Maximum notifications to keep
 */
const MAX_NOTIFICATIONS = 100

/**
 * Maximum rotation history to keep
 */
const MAX_ROTATION_HISTORY = 1000

// ─── Core Class ───

export class KeyChangeManager {
  private notifications: KeyChangeNotification[] = []
  private rotationHistory: KeyRotationEntry[] = []

  constructor() {
    this.loadFromStorage()
  }

  /**
   * Detect a key change and create notification.
   *
   * @param userId - User ID whose key changed
   * @param username - Username
   * @param oldPublicKeyHex - Old public key (hex)
   * @param newPublicKeyHex - New public key (hex)
   * @param ourIdentityPubHex - Our identity public key (hex)
   * @returns Notification if key changed, null otherwise
   */
  async detectKeyChange(
    userId: string,
    username: string,
    oldPublicKeyHex: string,
    newPublicKeyHex: string,
    ourIdentityPubHex: string,
  ): Promise<KeyChangeNotification | null> {
    // Check if key actually changed
    if (oldPublicKeyHex === newPublicKeyHex) {
      return null
    }

    // Generate safety numbers
    const oldSafety = await generateSafetyNumber(ourIdentityPubHex, oldPublicKeyHex)
    const newSafety = await generateSafetyNumber(ourIdentityPubHex, newPublicKeyHex)

    // Create notification
    const notification: KeyChangeNotification = {
      id: this.generateNotificationId(),
      userId,
      username,
      oldPublicKeyHex,
      newPublicKeyHex,
      timestamp: Date.now(),
      verified: false,
      oldSafetyNumber: oldSafety.formatted,
      newSafetyNumber: newSafety.formatted,
      dismissed: false,
    }

    // Add to notifications
    this.notifications.unshift(notification)
    if (this.notifications.length > MAX_NOTIFICATIONS) {
      this.notifications.pop()
    }

    // Add to rotation history
    const entry: KeyRotationEntry = {
      userId,
      oldPublicKeyHex,
      newPublicKeyHex,
      timestamp: Date.now(),
    }
    this.rotationHistory.push(entry)
    if (this.rotationHistory.length > MAX_ROTATION_HISTORY) {
      this.rotationHistory.shift()
    }

    this.saveToStorage()

    return notification
  }

  /**
   * Mark a notification as verified.
   *
   * @param notificationId - Notification ID
   * @returns true if successful
   */
  markVerified(notificationId: string): boolean {
    const notification = this.notifications.find((n) => n.id === notificationId)
    if (!notification) {
      return false
    }

    notification.verified = true
    this.saveToStorage()
    return true
  }

  /**
   * Dismiss a notification.
   *
   * @param notificationId - Notification ID
   * @returns true if successful
   */
  dismiss(notificationId: string): boolean {
    const notification = this.notifications.find((n) => n.id === notificationId)
    if (!notification) {
      return false
    }

    notification.dismissed = true
    this.saveToStorage()
    return true
  }

  /**
   * Get all notifications.
   */
  getNotifications(): KeyChangeNotification[] {
    return [...this.notifications]
  }

  /**
   * Get pending notifications (not verified or dismissed).
   */
  getPendingNotifications(): KeyChangeNotification[] {
    return this.notifications.filter((n) => !n.verified && !n.dismissed)
  }

  /**
   * Get key rotation history for a user.
   */
  getRotationHistory(userId: string): KeyRotationEntry[] {
    return this.rotationHistory.filter((e) => e.userId === userId)
  }

  /**
   * Get key change statistics.
   */
  getStats(): KeyChangeStats {
    const total = this.notifications.length
    const verified = this.notifications.filter((n) => n.verified).length
    const dismissed = this.notifications.filter((n) => n.dismissed).length

    return {
      totalChanges: total,
      verifiedChanges: verified,
      dismissedChanges: dismissed,
      pendingChanges: total - verified - dismissed,
    }
  }

  /**
   * Check if a key is new (not seen before).
   *
   * @param userId - User ID
   * @param publicKeyHex - Public key (hex)
   * @returns true if key is new
   */
  isNewKey(userId: string, publicKeyHex: string): boolean {
    const history = this.getRotationHistory(userId)
    return !history.some((e) => e.newPublicKeyHex === publicKeyHex)
  }

  /**
   * Get the last known key for a user.
   */
  getLastKnownKey(userId: string): string | null {
    const history = this.getRotationHistory(userId)
    if (history.length === 0) {
      return null
    }
    return history[history.length - 1].newPublicKeyHex
  }

  // ─── Private Methods ───

  private generateNotificationId(): string {
    const bytes = new Uint8Array(8)
    crypto.getRandomValues(bytes)
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  }

  private loadFromStorage(): void {
    try {
      const notificationsRaw = localStorage.getItem(NOTIFICATIONS_KEY)
      if (notificationsRaw) {
        this.notifications = JSON.parse(notificationsRaw)
      }

      const historyRaw = localStorage.getItem(ROTATION_HISTORY_KEY)
      if (historyRaw) {
        this.rotationHistory = JSON.parse(historyRaw)
      }
    } catch (err) {
      console.warn("[KeyChangeManager] Failed to load from storage:", err)
    }
  }

  private saveToStorage(): void {
    try {
      localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(this.notifications))
      localStorage.setItem(ROTATION_HISTORY_KEY, JSON.stringify(this.rotationHistory))
    } catch (err) {
      console.warn("[KeyChangeManager] Failed to save to storage:", err)
    }
  }
}

// ─── Standalone Functions ───

/**
 * Check if a public key has changed for a contact.
 *
 * @param userId - User ID
 * @param currentPublicKeyHex - Current public key from server
 * @param storedPublicKeyHex - Public key stored locally
 * @returns true if key has changed
 */
export function hasKeyChanged(
  userId: string,
  currentPublicKeyHex: string,
  storedPublicKeyHex: string | null,
): boolean {
  if (storedPublicKeyHex === null) {
    return false // First time seeing this user
  }
  return currentPublicKeyHex !== storedPublicKeyHex
}

/**
 * Generate a warning message for key change.
 *
 * @param username - Username
 * @param oldSafetyNumber - Old safety number
 * @param newSafetyNumber - New safety number
 * @returns Warning message
 */
export function generateKeyChangeWarning(
  username: string,
  oldSafetyNumber: string,
  newSafetyNumber: string,
): string {
  return `⚠️ Key change detected for ${username}!\n\n` +
    `Old safety number: ${oldSafetyNumber}\n` +
    `New safety number: ${newSafetyNumber}\n\n` +
    `If you didn't expect this change, the user may have been compromised. ` +
    `Please verify the new safety number with them before continuing.`
}
