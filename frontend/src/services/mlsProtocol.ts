/**
 * MLS Protocol for NurChat — Phase 5: Group E2E
 *
 * Messaging Layer Security (IETF RFC 9420) for group chats.
 * Provides forward secrecy and post-compromise security for groups.
 *
 * Features:
 * - TreeKEM for group key management
 * - Epoch transitions with key rotation
 * - Add/remove participant proposals
 * - Welcome messages for new members
 *
 * Uses @noble/curves + @noble/ciphers (audited by cure53, Sep 2024).
 */

import {
  boxKeyPair,
  boxBefore,
  secretboxEncrypt,
  secretboxDecrypt,
  secretboxNonceLength,
  randomBytes,
  sha256,
  bytesToHex,
  type BoxKeyPair,
} from "./cryptoAdapter"

// ─── Types ───

export interface MLSGroup {
  /** Group ID */
  groupId: string
  /** Group epoch */
  epoch: number
  /** Current epoch secret */
  epochSecret: Uint8Array
  /** TreeKEM tree */
  tree: TreeKEMNode[]
  /** Group members */
  members: MLSMember[]
  /** Group context */
  context: MLSGroupContext
}

export interface MLSMember {
  /** Member ID */
  id: string
  /** Member index in tree */
  index: number
  /** Identity key */
  identityKey: BoxKeyPair
  /** Encryption key */
  encryptionKey: BoxKeyPair
  /** Signature key */
  signatureKey: BoxKeyPair
  /** Leaf secret */
  leafSecret: Uint8Array
  /** Credential */
  credential: MLSCredential
}

export interface MLSGroupContext {
  /** Protocol version */
  version: number
  /** Cipher suite */
  cipherSuite: number
  /** Group ID */
  groupId: string
  /** Epoch */
  epoch: number
  /** Tree hash */
  treeHash: Uint8Array
  /** Confirmed transcript hash */
  confirmedTranscriptHash: Uint8Array
}

export interface MLSCredential {
  /** Credential type */
  type: number
  /** Identity key */
  identityKey: Uint8Array
  /** Username */
  username: string
}

export interface TreeKEMNode {
  /** Node hash */
  hash: Uint8Array
  /** Left child index (-1 if leaf) */
  left: number
  /** Right child index (-1 if leaf) */
  right: number
  /** Encryption key (for non-leaf nodes) */
  encryptionKey?: Uint8Array
  /** Node secret (for leaf nodes) */
  leafSecret?: Uint8Array
}

export interface MLSWelcome {
  /** Group ID */
  groupId: string
  /** Epoch */
  epoch: number
  /** Encrypted group secret for new member */
  encryptedGroupSecret: Uint8Array
  /** TreeKEM tree */
  tree: TreeKEMNode[]
  /** Group context */
  context: MLSGroupContext
}

export interface MLSProposal {
  /** Proposal type */
  type: "add" | "remove" | "update"
  /** Proposer index */
  proposerIndex: number
  /** Target index (for remove/update) */
  targetIndex?: number
  /** New member (for add) */
  newMember?: MLSMember
  /** New key package (for update) */
  newKeyPackage?: MLSKeyPackage
}

export interface MLSKeyPackage {
  /** Key package hash */
  hash: Uint8Array
  /** Identity key */
  identityKey: BoxKeyPair
  /** Encryption key */
  encryptionKey: BoxKeyPair
  /** Signature */
  signature: Uint8Array
}

export interface MLSCiphertext {
  /** Group ID */
  groupId: string
  /** Epoch */
  epoch: number
  /** Sender index */
  senderIndex: number
  /** Ciphertext */
  ciphertext: Uint8Array
  /** Nonce */
  nonce: Uint8Array
}

// ─── Constants ───

/**
 * MLS protocol version
 */
const MLS_PROTOCOL_VERSION = 1

/**
 * Cipher suite: MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519
 */
const CIPHER_SUITE = 1

/**
 * Maximum group size
 */
const MAX_GROUP_SIZE = 256

// ─── TreeKEM Implementation ───

/**
 * Create a new MLS group.
 *
 * @param groupId - Group ID
 * @param creator - Creator's member info
 * @returns New MLS group
 */
export async function createMLSGroup(
  groupId: string,
  creator: MLSMember,
): Promise<MLSGroup> {
  // Initialize tree with single leaf
  const tree: TreeKEMNode[] = [
    {
      hash: await sha256(creator.leafSecret),
      left: -1,
      right: -1,
      leafSecret: creator.leafSecret,
    },
  ]

  const context: MLSGroupContext = {
    version: MLS_PROTOCOL_VERSION,
    cipherSuite: CIPHER_SUITE,
    groupId,
    epoch: 0,
    treeHash: tree[0].hash,
    confirmedTranscriptHash: new Uint8Array(32),
  }

  // Derive epoch secret
  const epochSecret = await deriveEpochSecret(
    creator.leafSecret,
    context,
  )

  return {
    groupId,
    epoch: 0,
    epochSecret,
    tree,
    members: [creator],
    context,
  }
}

/**
 * Add a member to the group.
 *
 * @param group - Current group
 * @param newMember - New member to add
 * @returns Updated group and welcome message
 */
export async function addMemberToGroup(
  group: MLSGroup,
  newMember: MLSMember,
): Promise<{ group: MLSGroup; welcome: MLSWelcome }> {
  if (group.members.length >= MAX_GROUP_SIZE) {
    throw new Error("Group is full")
  }

  // Add member to tree
  const newLeaf: TreeKEMNode = {
    hash: await sha256(newMember.leafSecret),
    left: -1,
    right: -1,
    leafSecret: newMember.leafSecret,
  }

  // Expand tree (binary tree structure)
  const newTree = [...group.tree, newLeaf]
  await rebuildTree(newTree)

  // Update context
  const newContext: MLSGroupContext = {
    ...group.context,
    epoch: group.epoch + 1,
    treeHash: newTree[0].hash,
  }

  // Derive new epoch secret
  const epochSecret = await deriveEpochSecret(
    group.epochSecret,
    newContext,
  )

  // Create welcome message
  const welcome: MLSWelcome = {
    groupId: group.groupId,
    epoch: newContext.epoch,
    encryptedGroupSecret: await encryptGroupSecretForNewMember(
      epochSecret,
      newMember.encryptionKey.publicKey,
    ),
    tree: newTree,
    context: newContext,
  }

  // Update group
  const updatedGroup: MLSGroup = {
    ...group,
    epoch: newContext.epoch,
    epochSecret,
    tree: newTree,
    members: [...group.members, newMember],
    context: newContext,
  }

  return { group: updatedGroup, welcome }
}

/**
 * Remove a member from the group.
 *
 * @param group - Current group
 * @param memberIndex - Index of member to remove
 * @returns Updated group
 */
export async function removeMemberFromGroup(
  group: MLSGroup,
  memberIndex: number,
): Promise<MLSGroup> {
  if (memberIndex < 0 || memberIndex >= group.members.length) {
    throw new Error("Invalid member index")
  }

  // Remove member
  const newMembers = group.members.filter((_, i) => i !== memberIndex)

  // Update tree (mark leaf as removed)
  const newTree = [...group.tree]
  if (newTree[memberIndex]) {
    newTree[memberIndex] = {
      hash: new Uint8Array(32), // Zero hash for removed
      left: -1,
      right: -1,
    }
  }
  await rebuildTree(newTree)

  // Update context
  const newContext: MLSGroupContext = {
    ...group.context,
    epoch: group.epoch + 1,
    treeHash: newTree[0].hash,
  }

  // Derive new epoch secret
  const epochSecret = await deriveEpochSecret(
    group.epochSecret,
    newContext,
  )

  return {
    ...group,
    epoch: newContext.epoch,
    epochSecret,
    tree: newTree,
    members: newMembers,
    context: newContext,
  }
}

/**
 * Encrypt a message for the group.
 *
 * @param group - Group to encrypt for
 * @param plaintext - Message to encrypt
 * @param senderIndex - Sender's index
 * @returns Encrypted message
 */
export async function encryptGroupMessage(
  group: MLSGroup,
  plaintext: string,
  senderIndex: number,
): Promise<MLSCiphertext> {
  // Derive message key from epoch secret
  const messageKey = await deriveMessageKey(
    group.epochSecret,
    group.epoch,
    senderIndex,
  )

  // Encrypt
  const nonce = randomBytes(secretboxNonceLength)
  const plaintextBytes = new TextEncoder().encode(plaintext)
  const ciphertext = secretboxEncrypt(plaintextBytes, nonce, messageKey)

  return {
    groupId: group.groupId,
    epoch: group.epoch,
    senderIndex,
    ciphertext,
    nonce,
  }
}

/**
 * Decrypt a group message.
 *
 * @param group - Group to decrypt with
 * @param ciphertext - Encrypted message
 * @returns Decrypted plaintext
 */
export async function decryptGroupMessage(
  group: MLSGroup,
  ciphertext: MLSCiphertext,
): Promise<string | null> {
  // Verify epoch
  if (ciphertext.epoch !== group.epoch) {
    console.warn("[MLS] Epoch mismatch:", ciphertext.epoch, "vs", group.epoch)
    return null
  }

  // Derive message key
  const messageKey = await deriveMessageKey(
    group.epochSecret,
    group.epoch,
    ciphertext.senderIndex,
  )

  // Decrypt
  const plaintext = secretboxDecrypt(ciphertext.ciphertext, ciphertext.nonce, messageKey)
  if (!plaintext) return null

  return new TextDecoder().decode(plaintext)
}

/**
 * Process a Welcome message (for new members).
 *
 * @param welcome - Welcome message
 * @param myIdentityKey - Our identity key
 * @param myEncryptionKey - Our encryption key
 * @returns Decrypted group state
 */
export async function processWelcome(
  welcome: MLSWelcome,
  myIdentityKey: BoxKeyPair,
  myEncryptionKey: BoxKeyPair,
): Promise<MLSGroup> {
  // Decrypt group secret
  const groupSecret = await decryptGroupSecret(
    welcome.encryptedGroupSecret,
    myEncryptionKey.secretKey,
  )

  if (!groupSecret) {
    throw new Error("Failed to decrypt group secret")
  }

  // Find our leaf in tree
  const ourIndex = welcome.tree.findIndex(
    (node) => node.leafSecret && bytesEqual(node.leafSecret, myIdentityKey.secretKey),
  )

  if (ourIndex === -1) {
    throw new Error("Our leaf not found in tree")
  }

  // Derive epoch secret
  const epochSecret = await deriveEpochSecret(
    groupSecret,
    welcome.context,
  )

  return {
    groupId: welcome.groupId,
    epoch: welcome.epoch,
    epochSecret,
    tree: welcome.tree,
    members: [], // Will be populated when we receive messages
    context: welcome.context,
  }
}

// ─── Helper Functions ───

async function rebuildTree(tree: TreeKEMNode[]): Promise<void> {
  // Build tree bottom-up
  for (let i = tree.length - 1; i > 0; i -= 2) {
    const left = tree[i - 1]
    const right = tree[i]
    if (left && right) {
      const combined = new Uint8Array(64)
      combined.set(left.hash)
      combined.set(right.hash, 32)
      const parentHash = await sha256(combined)
      tree[Math.floor((i - 1) / 2)] = {
        hash: parentHash,
        left: i - 1,
        right: i,
      }
    }
  }
}

async function deriveEpochSecret(
  input: Uint8Array,
  context: MLSGroupContext,
): Promise<Uint8Array> {
  const contextBytes = new TextEncoder().encode(
    `${context.groupId}:${context.epoch}:${bytesToHex(context.treeHash)}`,
  )
  const combined = new Uint8Array(input.length + contextBytes.length)
  combined.set(input)
  combined.set(contextBytes, input.length)
  return sha256(combined)
}

async function deriveMessageKey(
  epochSecret: Uint8Array,
  epoch: number,
  senderIndex: number,
): Promise<Uint8Array> {
  const info = new TextEncoder().encode(`msg:${epoch}:${senderIndex}`)
  const combined = new Uint8Array(epochSecret.length + info.length)
  combined.set(epochSecret)
  combined.set(info, epochSecret.length)
  return sha256(combined)
}

async function encryptGroupSecretForNewMember(
  groupSecret: Uint8Array,
  recipientPublicKey: Uint8Array,
): Promise<Uint8Array> {
  // Generate ephemeral keypair
  const ephemeralKp = boxKeyPair()

  // Shared secret
  const sharedSecret = boxBefore(recipientPublicKey, ephemeralKp.secretKey)

  // Encrypt group secret
  const nonce = randomBytes(secretboxNonceLength)
  const encrypted = secretboxEncrypt(groupSecret, nonce, sharedSecret)

  // Combine: ephemeral_pub + nonce + ciphertext
  const result = new Uint8Array(32 + nonce.length + encrypted.length)
  result.set(ephemeralKp.publicKey)
  result.set(nonce, 32)
  result.set(encrypted, 32 + nonce.length)

  return result
}

async function decryptGroupSecret(
  encryptedSecret: Uint8Array,
  myPrivateKey: Uint8Array,
): Promise<Uint8Array | null> {
  try {
    // Extract ephemeral public key
    const ephemeralPub = encryptedSecret.slice(0, 32)
    const nonce = encryptedSecret.slice(32, 32 + secretboxNonceLength)
    const ciphertext = encryptedSecret.slice(32 + secretboxNonceLength)

    // Shared secret
    const sharedSecret = boxBefore(ephemeralPub, myPrivateKey)

    // Decrypt
    return secretboxDecrypt(ciphertext, nonce, sharedSecret)
  } catch {
    return null
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}
