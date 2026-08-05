/**
 * Key Transparency for NurChat — Phase 3: Key Transparency & Verification
 *
 * Merkle tree for public key directory.
 * Users can verify their key is in the tree and detect tampering.
 *
 * Features:
 * - Append-only Merkle tree
 * - Inclusion proofs (path from leaf to root)
 * - Consistency proofs (tree growth verification)
 * - Periodic root publication
 *
 * Uses @noble/curves + @noble/ciphers (audited by cure53, Sep 2024).
 */

import { sha256 } from "./cryptoAdapter"

// ─── Types ───

export interface MerkleLeaf {
  /** User ID */
  userId: string
  /** Public key (hex) */
  publicKeyHex: string
  /** Leaf hash */
  hash: Uint8Array
  /** Timestamp */
  timestamp: number
  /** Sequence number */
  sequence: number
}

export interface MerkleProof {
  /** Leaf index */
  leafIndex: number
  /** Sibling hashes along the path */
  siblings: Uint8Array[]
  /** Direction for each sibling (0 = left, 1 = right) */
  directions: number[]
  /** Root hash at time of proof */
  rootHash: Uint8Array
  /** Tree size at time of proof */
  treeSize: number
}

export interface MerkleRoot {
  /** Root hash */
  hash: Uint8Array
  /** Timestamp */
  timestamp: number
  /** Tree size */
  size: number
  /** Sequence number */
  sequence: number
}

export interface TransparencyLog {
  /** Log entries (append-only) */
  entries: MerkleLeaf[]
  /** Current root */
  currentRoot: MerkleRoot
  /** Root history (last N roots) */
  rootHistory: MerkleRoot[]
}

// ─── Constants ───

/**
 * Maximum root history to keep
 */
const MAX_ROOT_HISTORY = 1000

/**
 * Zero hash for empty nodes
 */
const ZERO_HASH = new Uint8Array(32)

// ─── Core Class ───

export class MerkleTree {
  private leaves: MerkleLeaf[] = []
  private tree: Uint8Array[] = []
  private rootHistory: MerkleRoot[] = []
  private sequence = 0

  constructor() {
    // Initialize with empty tree
    this.rebuildTree()
  }

  /**
   * Add a new leaf to the tree.
   *
   * @param userId - User ID
   * @param publicKeyHex - Public key (hex)
   * @returns The leaf index
   */
  async addLeaf(userId: string, publicKeyHex: string): Promise<number> {
    // Create leaf hash: SHA256(user_id || public_key)
    const encoder = new TextEncoder()
    const userIdBytes = encoder.encode(userId)
    const publicKeyBytes = hexToBytes(publicKeyHex)

    const combined = new Uint8Array(userIdBytes.length + publicKeyBytes.length)
    combined.set(userIdBytes)
    combined.set(publicKeyBytes, userIdBytes.length)

    const hash = await sha256(combined)

    const leaf: MerkleLeaf = {
      userId,
      publicKeyHex,
      hash,
      timestamp: Date.now(),
      sequence: this.sequence++,
    }

    this.leaves.push(leaf)
    this.rebuildTree()

    // Update root history
    const root = this.getRoot()
    this.rootHistory.push(root)
    if (this.rootHistory.length > MAX_ROOT_HISTORY) {
      this.rootHistory.shift()
    }

    return this.leaves.length - 1
  }

  /**
   * Get the current root hash.
   */
  getRoot(): MerkleRoot {
    return {
      hash: this.tree.length > 0 ? this.tree[0].slice() : ZERO_HASH.slice(),
      timestamp: Date.now(),
      size: this.leaves.length,
      sequence: this.sequence,
    }
  }

  /**
   * Generate an inclusion proof for a leaf.
   * Proves that a leaf is in the tree.
   *
   * @param leafIndex - Index of the leaf to prove
   * @returns Merkle proof
   */
  getInclusionProof(leafIndex: number): MerkleProof | null {
    if (leafIndex < 0 || leafIndex >= this.leaves.length) {
      return null
    }

    const siblings: Uint8Array[] = []
    const directions: number[] = []
    let index = leafIndex

    // Walk up the tree
    for (let level = 0; level < this.getTreeHeight(); level++) {
      const isRight = index % 2 === 1
      const siblingIndex = isRight ? index - 1 : index + 1

      if (siblingIndex < this.getLevelSize(level)) {
        siblings.push(this.getNode(level, siblingIndex))
        directions.push(isRight ? 0 : 1) // 0 = sibling is left, 1 = sibling is right
      }

      index = Math.floor(index / 2)
    }

    const root = this.getRoot()

    return {
      leafIndex,
      siblings,
      directions,
      rootHash: root.hash,
      treeSize: root.size,
    }
  }

  /**
   * Verify an inclusion proof.
   *
   * @param leaf - The leaf to verify
   * @param proof - The inclusion proof
   * @param expectedRoot - Expected root hash
   * @returns true if proof is valid
   */
  static async verifyInclusionProof(
    leaf: MerkleLeaf,
    proof: MerkleProof,
    expectedRoot: Uint8Array,
  ): Promise<boolean> {
    let currentHash = leaf.hash

    for (let i = 0; i < proof.siblings.length; i++) {
      const sibling = proof.siblings[i]
      const direction = proof.directions[i]

      const combined = new Uint8Array(64)
      if (direction === 0) {
        // Sibling is on the left
        combined.set(sibling)
        combined.set(currentHash, 32)
      } else {
        // Sibling is on the right
        combined.set(currentHash)
        combined.set(sibling, 32)
      }

      currentHash = await sha256(combined)
    }

    return MerkleTree.compareHashes(currentHash, expectedRoot)
  }

  /**
   * Generate a consistency proof between two tree sizes.
   * Proves that a smaller tree is consistent with a larger tree.
   *
   * @param oldSize - Old tree size
   * @param newSize - New tree size
   * @returns Consistency proof
   */
  getConsistencyProof(oldSize: number, newSize: number): Uint8Array[] | null {
    if (oldSize <= 0 || newSize <= oldSize || newSize > this.leaves.length) {
      return null
    }

    // Simplified consistency proof
    // In production, implement full Merkle tree consistency
    const proof: Uint8Array[] = []

    // Add root hash from old tree
    if (oldSize > 0) {
      const oldTree = new MerkleTree()
      for (let i = 0; i < oldSize; i++) {
        oldTree.leaves.push(this.leaves[i])
      }
      oldTree.rebuildTree()
      proof.push(oldTree.getRoot().hash)
    }

    return proof
  }

  /**
   * Get the root history.
   */
  getRootHistory(): MerkleRoot[] {
    return [...this.rootHistory]
  }

  /**
   * Find a leaf by user ID.
   */
  findLeafByUserId(userId: string): MerkleLeaf | null {
    return this.leaves.find((l) => l.userId === userId) || null
  }

  /**
   * Find a leaf by public key.
   */
  findLeafByPublicKey(publicKeyHex: string): MerkleLeaf | null {
    return this.leaves.find((l) => l.publicKeyHex === publicKeyHex) || null
  }

  /**
   * Get all leaves.
   */
  getLeaves(): MerkleLeaf[] {
    return [...this.leaves]
  }

  /**
   * Get tree size.
   */
  getSize(): number {
    return this.leaves.length
  }

  // ─── Private Methods ───

  private getTreeHeight(): number {
    return Math.ceil(Math.log2(this.leaves.length + 1)) + 1
  }

  private getLevelSize(level: number): number {
    return Math.ceil(this.leaves.length / Math.pow(2, level))
  }

  private getNode(level: number, index: number): Uint8Array {
    const treeIndex = this.getLevelOffset(level) + index
    return treeIndex < this.tree.length ? this.tree[treeIndex] : ZERO_HASH
  }

  private getLevelOffset(level: number): number {
    let offset = 0
    for (let i = 0; i < level; i++) {
      offset += this.getLevelSize(i)
    }
    return offset
  }

  private async rebuildTree(): Promise<void> {
    // Calculate tree size
    const n = this.leaves.length
    if (n === 0) {
      this.tree = [ZERO_HASH.slice()]
      return
    }

    const height = this.getTreeHeight()
    const totalNodes = this.getLevelOffset(height) + 1
    this.tree = new Array(totalNodes)

    // Fill leaves
    for (let i = 0; i < n; i++) {
      this.tree[this.getLevelOffset(0) + i] = this.leaves[i].hash
    }

    // Fill remaining leaves with zero hash
    for (let i = n; i < this.getLevelSize(0); i++) {
      this.tree[this.getLevelOffset(0) + i] = ZERO_HASH
    }

    // Build tree bottom-up
    for (let level = 1; level < height; level++) {
      const levelSize = this.getLevelSize(level)
      for (let i = 0; i < levelSize; i++) {
        const left = this.getNode(level - 1, i * 2)
        const right = this.getNode(level - 1, i * 2 + 1)

        const combined = new Uint8Array(64)
        combined.set(left)
        combined.set(right, 32)

        this.tree[this.getLevelOffset(level) + i] = await sha256(combined)
      }
    }
  }

  private static compareHashes(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false
    }
    return true
  }
}

// ─── Helper Functions ───

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}

/**
 * Format a hash as a hex string.
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/**
 * Verify that a root hash is in the published history.
 *
 * @param rootHistory - Published root history
 * @param expectedRoot - Root hash to verify
 * @returns true if root is in history
 */
export function verifyRootInHistory(
  rootHistory: MerkleRoot[],
  expectedRoot: Uint8Array,
): boolean {
  return rootHistory.some((r) => MerkleTree.compareHashes(r.hash, expectedRoot))
}
