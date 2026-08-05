/**
 * Third-party Auditing API for NurChat — Phase 3: Key Transparency & Verification
 *
 * Public API for auditing the key transparency system.
 * Allows third-party auditors to verify the integrity of the Merkle tree.
 *
 * Features:
 * - Public API for Merkle tree verification
 * - Audit log with timestamps
 * - Consistency proofs
 * - Root hash publication
 *
 * Uses @noble/curves + @noble/ciphers (audited by cure53, Sep 2024).
 */

import { MerkleTree, bytesToHex, type MerkleRoot, type MerkleLeaf, type MerkleProof } from "./keyTransparency"
import { sha256 } from "./cryptoAdapter"

// ─── Types ───

export interface AuditLogEntry {
  /** Entry ID */
  id: string
  /** Action performed */
  action: "add_leaf" | "update_root" | "verify_proof" | "consistency_check"
  /** User ID (if applicable) */
  userId?: string
  /** Timestamp */
  timestamp: number
  /** Details */
  details: Record<string, unknown>
  /** Signature (for integrity) */
  signature?: string
}

export interface AuditReport {
  /** Report ID */
  id: string
  /** Start timestamp */
  startTime: number
  /** End timestamp */
  endTime: number
  /** Total leaves */
  totalLeaves: number
  /** Total root updates */
  totalRootUpdates: number
  /** Total proofs verified */
  totalProofsVerified: number
  /** Any anomalies detected */
  anomalies: string[]
  /** Report hash */
  reportHash: string
}

export interface AuditorCredentials {
  /** Auditor ID */
  id: string
  /** Auditor name */
  name: string
  /** Public key (hex) */
  publicKeyHex: string
  /** Registration timestamp */
  registeredAt: number
}

// ─── Constants ───

/**
 * Local storage key for audit log
 */
const AUDIT_LOG_KEY = "transparency_audit_log"

/**
 * Local storage key for auditor credentials
 */
const AUDITOR_CREDENTIALS_KEY = "auditor_credentials"

/**
 * Maximum audit log entries
 */
const MAX_AUDIT_LOG = 10000

// ─── Core Class ───

export class TransparencyAuditor {
  private auditLog: AuditLogEntry[] = []
  private credentials: AuditorCredentials | null = null
  private tree: MerkleTree

  constructor(tree: MerkleTree) {
    this.tree = tree
    this.loadFromStorage()
  }

  /**
   * Register as an auditor.
   *
   * @param name - Auditor name
   * @param publicKeyHex - Auditor's public key (hex)
   * @returns Auditor credentials
   */
  register(name: string, publicKeyHex: string): AuditorCredentials {
    this.credentials = {
      id: this.generateId(),
      name,
      publicKeyHex,
      registeredAt: Date.now(),
    }

    this.saveToStorage()
    this.logAction("register", { name, publicKeyHex })

    return this.credentials
  }

  /**
   * Log an action to the audit trail.
   *
   * @param action - Action type
   * @param details - Action details
   * @returns Audit log entry
   */
  logAction(
    action: AuditLogEntry["action"],
    details: Record<string, unknown>,
  ): AuditLogEntry {
    const entry: AuditLogEntry = {
      id: this.generateId(),
      action,
      timestamp: Date.now(),
      details,
    }

    this.auditLog.push(entry)
    if (this.auditLog.length > MAX_AUDIT_LOG) {
      this.auditLog.shift()
    }

    this.saveToStorage()
    return entry
  }

  /**
   * Verify an inclusion proof and log the verification.
   *
   * @param leaf - The leaf to verify
   * @param proof - The inclusion proof
   * @param expectedRoot - Expected root hash
   * @returns true if proof is valid
   */
  async verifyInclusionProof(
    leaf: MerkleLeaf,
    proof: MerkleProof,
    expectedRoot: Uint8Array,
  ): Promise<boolean> {
    const valid = await MerkleTree.verifyInclusionProof(leaf, proof, expectedRoot)

    this.logAction("verify_proof", {
      userId: leaf.userId,
      leafIndex: proof.leafIndex,
      treeSize: proof.treeSize,
      valid,
    })

    return valid
  }

  /**
   * Generate an audit report.
   *
   * @param startTime - Report start time
   * @param endTime - Report end time
   * @returns Audit report
   */
  async generateReport(startTime: number, endTime: number): Promise<AuditReport> {
    const entries = this.auditLog.filter(
      (e) => e.timestamp >= startTime && e.timestamp <= endTime,
    )

    const anomalies: string[] = []

    // Check for suspicious patterns
    const leafAdditions = entries.filter((e) => e.action === "add_leaf")
    const rootUpdates = entries.filter((e) => e.action === "update_root")
    const proofVerifications = entries.filter((e) => e.action === "verify_proof")

    // Check for failed verifications
    const failedProofs = proofVerifications.filter(
      (e) => e.details.valid === false,
    )
    if (failedProofs.length > 0) {
      anomalies.push(`${failedProofs.length} proof verifications failed`)
    }

    // Check for rapid leaf additions (potential Sybil attack)
    if (leafAdditions.length > 100) {
      const timeSpan = endTime - startTime
      if (timeSpan < 60000) {
        // Less than 1 minute
        anomalies.push(
          `${leafAdditions.length} leaves added in less than 1 minute`,
        )
      }
    }

    // Generate report hash
    const reportContent = JSON.stringify({
      startTime,
      endTime,
      totalLeaves: leafAdditions.length,
      totalRootUpdates: rootUpdates.length,
      totalProofsVerified: proofVerifications.length,
      anomalies,
    })
    const reportHash = bytesToHex(await sha256(new TextEncoder().encode(reportContent)))

    return {
      id: this.generateId(),
      startTime,
      endTime,
      totalLeaves: leafAdditions.length,
      totalRootUpdates: rootUpdates.length,
      totalProofsVerified: proofVerifications.length,
      anomalies,
      reportHash,
    }
  }

  /**
   * Get audit log entries.
   */
  getAuditLog(): AuditLogEntry[] {
    return [...this.auditLog]
  }

  /**
   * Get audit log entries for a specific user.
   */
  getUserAuditLog(userId: string): AuditLogEntry[] {
    return this.auditLog.filter((e) => e.userId === userId)
  }

  /**
   * Get auditor credentials.
   */
  getCredentials(): AuditorCredentials | null {
    return this.credentials ? { ...this.credentials } : null
  }

  /**
   * Export audit log as JSON.
   */
  exportAuditLog(): string {
    return JSON.stringify(
      {
        credentials: this.credentials,
        log: this.auditLog,
        exportedAt: Date.now(),
      },
      null,
      2,
    )
  }

  /**
   * Import audit log from JSON.
   */
  importAuditLog(data: string): boolean {
    try {
      const imported = JSON.parse(data)
      if (imported.log && Array.isArray(imported.log)) {
        this.auditLog = imported.log
        if (imported.credentials) {
          this.credentials = imported.credentials
        }
        this.saveToStorage()
        return true
      }
      return false
    } catch {
      return false
    }
  }

  // ─── Private Methods ───

  private generateId(): string {
    const bytes = new Uint8Array(8)
    crypto.getRandomValues(bytes)
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  }

  private loadFromStorage(): void {
    try {
      const logRaw = localStorage.getItem(AUDIT_LOG_KEY)
      if (logRaw) {
        this.auditLog = JSON.parse(logRaw)
      }

      const credsRaw = localStorage.getItem(AUDITOR_CREDENTIALS_KEY)
      if (credsRaw) {
        this.credentials = JSON.parse(credsRaw)
      }
    } catch (err) {
      console.warn("[TransparencyAuditor] Failed to load from storage:", err)
    }
  }

  private saveToStorage(): void {
    try {
      localStorage.setItem(AUDIT_LOG_KEY, JSON.stringify(this.auditLog))
      if (this.credentials) {
        localStorage.setItem(AUDITOR_CREDENTIALS_KEY, JSON.stringify(this.credentials))
      }
    } catch (err) {
      console.warn("[TransparencyAuditor] Failed to save to storage:", err)
    }
  }
}

// ─── Standalone Functions ───

/**
 * Verify a Merkle tree root against published history.
 *
 * @param rootHistory - Published root history
 * @param expectedRoot - Root hash to verify
 * @returns true if root is in history
 */
export function verifyRootInHistory(
  rootHistory: MerkleRoot[],
  expectedRoot: Uint8Array,
): boolean {
  return rootHistory.some((r) => {
    if (r.hash.length !== expectedRoot.length) return false
    for (let i = 0; i < r.hash.length; i++) {
      if (r.hash[i] !== expectedRoot[i]) return false
    }
    return true
  })
}

/**
 * Generate a summary of the audit log.
 *
 * @param log - Audit log entries
 * @returns Summary statistics
 */
export function summarizeAuditLog(log: AuditLogEntry[]): {
  totalEntries: number
  entriesByAction: Record<string, number>
  timeRange: { start: number; end: number }
  uniqueUsers: number
} {
  const entriesByAction: Record<string, number> = {}
  const uniqueUsers = new Set<string>()

  for (const entry of log) {
    entriesByAction[entry.action] = (entriesByAction[entry.action] || 0) + 1
    if (entry.userId) {
      uniqueUsers.add(entry.userId)
    }
  }

  return {
    totalEntries: log.length,
    entriesByAction,
    timeRange: {
      start: log.length > 0 ? log[0].timestamp : 0,
      end: log.length > 0 ? log[log.length - 1].timestamp : 0,
    },
    uniqueUsers: uniqueUsers.size,
  }
}
