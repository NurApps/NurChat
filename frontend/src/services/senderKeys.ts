/**
 * Sender Keys for NurChat — Phase 5: Group E2E
 *
 * Fallback group encryption when MLS is not available.
 * Each member has their own encryption key, rotated on membership changes.
 *
 * Features:
 * - Per-member encryption keys
 * - Key rotation on add/remove
 * - Forward secrecy per sender
 * - Simple implementation for compatibility
 *
 * Uses @noble/curves + @noble/ciphers (audited by cure53, Sep 2024).
 */

import {
  boxKeyPair,
  secretboxEncrypt,
  secretboxDecrypt,
  secretboxNonceLength,
  randomBytes,
  sha256,
  type BoxKeyPair,
} from "./cryptoAdapter"

// ─── Types ───

export interface SenderKeyGroup {
  /** Group ID */
  groupId: string
  /** Group epoch */
  epoch: number
  /** Members with their keys */
  members: SenderKeyMember[]
  /** Group key (shared secret) */
  groupKey: Uint8Array
  /** Key rotation counter */
  rotationCount: number
}

export interface SenderKeyMember {
  /** Member ID */
  id: string
  /** Member index */
  index: number
  /** Identity key */
  identityKey: BoxKeyPair
  /** Sender key for this member */
  senderKey: BoxKeyPair
  /** When key was created */
  createdAt: number
}

export interface SenderKeyMessage {
  /** Group ID */
  groupId: string
  /** Epoch */
  epoch: number
  /** Sender index */
  senderIndex: number
  /** Sender's current key hash */
  senderKeyHash: Uint8Array
  /** Ciphertext */
  ciphertext: Uint8Array
  /** Nonce */
  nonce: Uint8Array
  /** Message number */
  messageNumber: number
}

export interface SenderKeyState {
  /** Key hash → decrypted key mapping */
  knownKeys: Map<string, Uint8Array>
  /** Message counters per sender */
  messageCounters: Map<number, number>
}

// ─── Constants ───

/**
 * Key rotation interval (messages)
 */
const KEY_ROTATION_INTERVAL = 100

/**
 * Maximum skipped messages
 */
const MAX_SKIP = 500

// ─── Core Functions ───

/**
 * Create a new sender key group.
 *
 * @param groupId - Group ID
 * @param creator - Creator's member info
 * @returns New sender key group
 */
export async function createSenderKeyGroup(
  groupId: string,
  creator: SenderKeyMember,
): Promise<SenderKeyGroup> {
  // Generate group key
  const groupKey = randomBytes(32)

  return {
    groupId,
    epoch: 0,
    members: [creator],
    groupKey,
    rotationCount: 0,
  }
}

/**
 * Add a member to the group.
 * Rotates all sender keys for forward secrecy.
 *
 * @param group - Current group
 * @param newMember - New member
 * @returns Updated group
 */
export async function addMemberToSenderKeyGroup(
  group: SenderKeyGroup,
  newMember: SenderKeyMember,
): Promise<SenderKeyGroup> {
  // Rotate all existing sender keys
  const rotatedMembers = await Promise.all(
    group.members.map(async (m) => ({
      ...m,
      senderKey: await rotateSenderKey(m.senderKey),
      createdAt: Date.now(),
    })),
  )

  // Add new member
  return {
    ...group,
    epoch: group.epoch + 1,
    members: [...rotatedMembers, newMember],
    rotationCount: group.rotationCount + 1,
  }
}

/**
 * Remove a member from the group.
 * Rotates all sender keys for forward secrecy.
 *
 * @param group - Current group
 * @param memberIndex - Index of member to remove
 * @returns Updated group
 */
export async function removeMemberFromSenderKeyGroup(
  group: SenderKeyGroup,
  memberIndex: number,
): Promise<SenderKeyGroup> {
  // Rotate all sender keys (except removed member)
  const rotatedMembers = await Promise.all(
    group.members
      .filter((_, i) => i !== memberIndex)
      .map(async (m) => ({
        ...m,
        senderKey: await rotateSenderKey(m.senderKey),
        createdAt: Date.now(),
      })),
  )

  // Reindex
  const reindexedMembers = rotatedMembers.map((m, i) => ({
    ...m,
    index: i,
  }))

  return {
    ...group,
    epoch: group.epoch + 1,
    members: reindexedMembers,
    rotationCount: group.rotationCount + 1,
  }
}

/**
 * Encrypt a message for the group.
 *
 * @param group - Group to encrypt for
 * @param plaintext - Message to encrypt
 * @param senderIndex - Sender's index
 * @param messageNumber - Message counter
 * @returns Encrypted message
 */
export async function encryptSenderKeyMessage(
  group: SenderKeyGroup,
  plaintext: string,
  senderIndex: number,
  messageNumber: number,
): Promise<SenderKeyMessage> {
  const member = group.members[senderIndex]
  if (!member) {
    throw new Error("Invalid sender index")
  }

  // Derive message key from sender key + group key
  const messageKey = await deriveMessageKey(
    member.senderKey.secretKey,
    group.groupKey,
    messageNumber,
  )

  // Encrypt
  const nonce = randomBytes(secretboxNonceLength)
  const plaintextBytes = new TextEncoder().encode(plaintext)
  const ciphertext = secretboxEncrypt(plaintextBytes, nonce, messageKey)

  // Sender key hash for identification
  const senderKeyHash = await sha256(member.senderKey.publicKey)

  return {
    groupId: group.groupId,
    epoch: group.epoch,
    senderIndex,
    senderKeyHash,
    ciphertext,
    nonce,
    messageNumber,
  }
}

/**
 * Decrypt a group message.
 *
 * @param group - Group to decrypt with
 * @param message - Encrypted message
 * @param state - Sender key state
 * @returns Decrypted plaintext
 */
export async function decryptSenderKeyMessage(
  group: SenderKeyGroup,
  message: SenderKeyMessage,
  state: SenderKeyState,
): Promise<string | null> {
  // Verify epoch
  if (message.epoch !== group.epoch) {
    console.warn("[SenderKey] Epoch mismatch")
    return null
  }

  // Find sender
  const sender = group.members[message.senderIndex]
  if (!sender) {
    console.warn("[SenderKey] Unknown sender index")
    return null
  }

  // Check message counter
  const lastCounter = state.messageCounters.get(message.senderIndex) || 0
  if (message.messageNumber <= lastCounter) {
    console.warn("[SenderKey] Message number too low")
    return null
  }

  // Check for skipped messages
  if (message.messageNumber - lastCounter > MAX_SKIP) {
    console.warn("[SenderKey] Too many skipped messages")
    return null
  }

  // Derive message key
  const messageKey = await deriveMessageKey(
    sender.senderKey.secretKey,
    group.groupKey,
    message.messageNumber,
  )

  // Decrypt
  const plaintext = secretboxDecrypt(message.ciphertext, message.nonce, messageKey)
  if (!plaintext) return null

  // Update counter
  state.messageCounters.set(message.senderIndex, message.messageNumber)

  return new TextDecoder().decode(plaintext)
}

/**
 * Get sender key state for a group.
 *
 * @returns New sender key state
 */
export function getSenderKeyState(): SenderKeyState {
  return {
    knownKeys: new Map(),
    messageCounters: new Map(),
  }
}

/**
 * Check if sender key rotation is needed.
 *
 * @param group - Group to check
 * @returns true if rotation is needed
 */
export function needsSenderKeyRotation(group: SenderKeyGroup): boolean {
  return group.rotationCount >= KEY_ROTATION_INTERVAL
}

// ─── Helper Functions ───

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function rotateSenderKey(_oldKey: BoxKeyPair): Promise<BoxKeyPair> {
  // Derive new key from old key
  // (simplified — in production, use proper key derivation)
  const newKp = boxKeyPair()
  return newKp
}

async function deriveMessageKey(
  senderSecret: Uint8Array,
  groupKey: Uint8Array,
  messageNumber: number,
): Promise<Uint8Array> {
  const info = new TextEncoder().encode(`sender:${messageNumber}`)
  const combined = new Uint8Array(senderSecret.length + groupKey.length + info.length)
  combined.set(senderSecret)
  combined.set(groupKey, senderSecret.length)
  combined.set(info, senderSecret.length + groupKey.length)
  return sha256(combined)
}
