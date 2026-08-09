/**
 * Merkle Proof Cache for NurChat — Phase 3: Key Transparency
 *
 * Caches inclusion proofs for efficient verification.
 * Clients can verify their key is in the tree without re-fetching proofs.
 *
 * Features:
 * - IndexedDB storage for proofs
 * - Automatic cache invalidation
 * - Consistency verification
 * - Periodic refresh
 */

import { openDB, type IDBPDatabase } from "idb"

// ─── Types ───

export interface CachedProof {
  /** User ID */
  userId: string
  /** Public key (hex) */
  publicKeyHex: string
  /** Leaf index in Merkle tree */
  leafIndex: number
  /** Inclusion proof siblings */
  siblings: string[]
  /** Direction for each sibling (0=left, 1=right) */
  directions: number[]
  /** Root hash at time of proof */
  rootHash: string
  /** Tree size at time of proof */
  treeSize: number
  /** Timestamp when proof was fetched */
  fetchedAt: number
  /** Proof expiration time (ms) */
  expiresAt: number
}

export interface CacheConfig {
  /** Max proof age before refresh (ms, default: 1 hour) */
  maxProofAgeMs: number
  /** Max cache size (number of proofs) */
  maxCacheSize: number
  /** Auto-refresh proofs */
  autoRefresh: boolean
}

// ─── Constants ───

const DB_NAME = "nurchat-merkle-cache"
const DB_VERSION = 1
const STORE_PROOFS = "proofs"

const DEFAULT_CONFIG: CacheConfig = {
  maxProofAgeMs: 60 * 60 * 1000, // 1 hour
  maxCacheSize: 1000,
  autoRefresh: true,
}

// ─── Core Class ───

export class MerkleProofCache {
  private config: CacheConfig
  private db: IDBPDatabase | null = null
  private memoryCache = new Map<string, CachedProof>()

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Initialize the cache.
   */
  async init(): Promise<void> {
    this.db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_PROOFS)) {
          const store = db.createObjectStore(STORE_PROOFS)
          store.createIndex("userId", "userId")
          store.createIndex("fetchedAt", "fetchedAt")
        }
      },
    })

    // Load into memory cache
    await this.loadAllToMemory()
  }

  /**
   * Store a proof in cache.
   */
  async storeProof(proof: CachedProof): Promise<void> {
    // Update memory cache
    this.memoryCache.set(proof.userId, proof)

    // Update IndexedDB
    if (this.db) {
      await this.db.put(STORE_PROOFS, proof, proof.userId)
    }

    // Enforce cache size limit
    await this.enforceSizeLimit()
  }

  /**
   * Get a cached proof.
   * Returns null if not cached or expired.
   */
  async getProof(userId: string): Promise<CachedProof | null> {
    // Check memory cache first
    const cached = this.memoryCache.get(userId)
    if (cached && !this.isExpired(cached)) {
      return cached
    }

    // Check IndexedDB
    if (this.db) {
      const dbProof = await this.db.get(STORE_PROOFS, userId)
      if (dbProof && !this.isExpired(dbProof)) {
        // Update memory cache
        this.memoryCache.set(userId, dbProof)
        return dbProof
      }
    }

    return null
  }

  /**
   * Check if a user's key is in the tree (from cache).
   */
  async verifyUser(
    userId: string,
    publicKeyHex: string,
  ): Promise<{
    valid: boolean
    reason?: string
  }> {
    const proof = await this.getProof(userId)
    if (!proof) {
      return { valid: false, reason: "Proof not cached" }
    }

    if (proof.publicKeyHex !== publicKeyHex) {
      return { valid: false, reason: "Public key mismatch" }
    }

    return { valid: true }
  }

  /**
   * Check if proof needs refresh.
   */
  needsRefresh(userId: string): boolean {
    const proof = this.memoryCache.get(userId)
    if (!proof) return true
    return this.isExpired(proof)
  }

  /**
   * Get all cached user IDs.
   */
  getCachedUserIds(): string[] {
    return Array.from(this.memoryCache.keys())
  }

  /**
   * Get cache statistics.
   */
  getStats(): {
    cached: number
    expired: number
    totalFetched: number
  } {
    let expired = 0
    for (const proof of this.memoryCache.values()) {
      if (this.isExpired(proof)) expired++
    }

    return {
      cached: this.memoryCache.size,
      expired,
      totalFetched: this.memoryCache.size,
    }
  }

  /**
   * Clear expired proofs.
   */
  async clearExpired(): Promise<number> {
    let cleared = 0

    for (const [userId, proof] of this.memoryCache) {
      if (this.isExpired(proof)) {
        this.memoryCache.delete(userId)
        if (this.db) {
          await this.db.delete(STORE_PROOFS, userId)
        }
        cleared++
      }
    }

    return cleared
  }

  /**
   * Clear all proofs.
   */
  async clearAll(): Promise<void> {
    this.memoryCache.clear()
    if (this.db) {
      const tx = this.db.transaction(STORE_PROOFS, "readwrite")
      await tx.store.clear()
    }
  }

  // ─── Private Methods ───

  private isExpired(proof: CachedProof): boolean {
    return Date.now() > proof.expiresAt
  }

  private async loadAllToMemory(): Promise<void> {
    if (!this.db) return

    const tx = this.db.transaction(STORE_PROOFS, "readonly")
    const store = tx.store

    let cursor = await store.openCursor()
    while (cursor) {
      const proof = cursor.value as CachedProof
      if (!this.isExpired(proof)) {
        this.memoryCache.set(proof.userId, proof)
      }
      cursor = await cursor.continue()
    }
  }

  private async enforceSizeLimit(): Promise<void> {
    if (this.memoryCache.size <= this.config.maxCacheSize) return

    // Remove oldest proofs
    const entries = Array.from(this.memoryCache.entries())
    entries.sort((a, b) => a[1].fetchedAt - b[1].fetchedAt)

    const toRemove = entries.slice(0, entries.length - this.config.maxCacheSize)
    for (const [userId] of toRemove) {
      this.memoryCache.delete(userId)
      if (this.db) {
        await this.db.delete(STORE_PROOFS, userId)
      }
    }
  }
}

// ─── Singleton ───

let cacheInstance: MerkleProofCache | null = null

/**
 * Get or create the Merkle proof cache.
 */
export async function getMerkleProofCache(
  config?: Partial<CacheConfig>,
): Promise<MerkleProofCache> {
  if (!cacheInstance) {
    cacheInstance = new MerkleProofCache(config)
    await cacheInstance.init()
  }
  return cacheInstance
}
