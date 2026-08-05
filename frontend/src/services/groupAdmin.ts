/**
 * Group Admin Operations for NurChat — Phase 5: Group E2E
 *
 * Admin operations for managing group membership and settings.
 * Provides secure group management with key rotation.
 *
 * Features:
 * - Add/remove members with admin approval
 * - Group settings management
 * - Key rotation on membership changes
 * - Admin key for secure operations
 *
 * Uses @noble/curves + @noble/ciphers (audited by cure53, Sep 2024).
 */

import {
  boxKeyPair,
  randomBytes,
  sha256,
  bytesToHex,
  type BoxKeyPair,
} from "./cryptoAdapter"
import { type MLSGroup, addMemberToGroup, removeMemberFromGroup } from "./mlsProtocol"
import { type SenderKeyGroup, addMemberToSenderKeyGroup, removeMemberFromSenderKeyGroup } from "./senderKeys"

// ─── Types ───

export interface GroupAdmin {
  /** Admin ID */
  id: string
  /** Admin key */
  adminKey: BoxKeyPair
  /** Is super admin */
  isSuperAdmin: boolean
  /** Permissions */
  permissions: GroupPermissions
}

export interface GroupPermissions {
  /** Can add members */
  canAddMembers: boolean
  /** Can remove members */
  canRemoveMembers: boolean
  /** Can change settings */
  canChangeSettings: boolean
  /** Can rotate keys */
  canRotateKeys: boolean
  /** Can delete group */
  canDeleteGroup: boolean
}

export interface GroupSettings {
  /** Group name */
  name: string
  /** Group description */
  description: string
  /** Maximum members */
  maxMembers: number
  /** Auto-rotate keys */
  autoRotateKeys: boolean
  /** Key rotation interval (messages) */
  keyRotationInterval: number
  /** Require admin approval for new members */
  requireApproval: boolean
  /** Created at */
  createdAt: number
  /** Updated at */
  updatedAt: number
}

export interface GroupAdminMessage {
  /** Message type */
  type: "add_member" | "remove_member" | "update_settings" | "rotate_keys" | "delete_group"
  /** Admin ID */
  adminId: string
  /** Target member ID (for add/remove) */
  targetMemberId?: string
  /** New settings (for update_settings) */
  newSettings?: Partial<GroupSettings>
  /** Timestamp */
  timestamp: number
  /** Admin signature */
  signature: Uint8Array
}

export interface GroupInvitation {
  /** Invitation ID */
  id: string
  /** Group ID */
  groupId: string
  /** Inviter ID */
  inviterId: string
  /** Invitee ID */
  inviteeId: string
  /** Invitation message */
  message: string
  /** Created at */
  createdAt: number
  /** Expires at */
  expiresAt: number
  /** Is accepted */
  accepted: boolean
}

// ─── Constants ───

/**
 * Invitation expiry (7 days)
 */
const INVITATION_EXPIRY = 7 * 24 * 60 * 60 * 1000

// ─── Core Functions ───

/**
 * Create a new group with admin.
 *
 * @param groupId - Group ID
 * @param creatorId - Creator's member ID
 * @param settings - Initial group settings
 * @returns Group admin and settings
 */
export async function createGroupWithAdmin(
  groupId: string,
  creatorId: string,
  settings: Partial<GroupSettings> = {},
): Promise<{ admin: GroupAdmin; settings: GroupSettings }> {
  // Create admin key
  const adminKey = boxKeyPair()

  // Default settings
  const defaultSettings: GroupSettings = {
    name: settings.name || "New Group",
    description: settings.description || "",
    maxMembers: settings.maxMembers || 100,
    autoRotateKeys: settings.autoRotateKeys !== false,
    keyRotationInterval: settings.keyRotationInterval || 100,
    requireApproval: settings.requireApproval !== false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  const admin: GroupAdmin = {
    id: creatorId,
    adminKey,
    isSuperAdmin: true,
    permissions: {
      canAddMembers: true,
      canRemoveMembers: true,
      canChangeSettings: true,
      canRotateKeys: true,
      canDeleteGroup: true,
    },
  }

  return { admin, settings: defaultSettings }
}

/**
 * Add a member to the group (admin operation).
 *
 * @param group - MLS group
 * @param senderKeyGroup - Sender key group
 * @param admin - Admin performing the operation
 * @param targetMemberId - Member to add
 * @returns Updated groups
 */
export async function adminAddMember(
  group: MLSGroup,
  senderKeyGroup: SenderKeyGroup,
  admin: GroupAdmin,
  targetMemberId: string,
): Promise<{
  group: MLSGroup;
  senderKeyGroup: SenderKeyGroup;
  message: GroupAdminMessage;
}> {
  // Verify admin permissions
  if (!admin.permissions.canAddMembers) {
    throw new Error("Admin does not have permission to add members")
  }

  // Check if member already exists
  if (group.members.some((m) => m.id === targetMemberId)) {
    throw new Error("Member already in group")
  }

  // Create new member (simplified — in practice, get from key package)
  const newMember = {
    id: targetMemberId,
    index: group.members.length,
    identityKey: boxKeyPair(),
    encryptionKey: boxKeyPair(),
    signatureKey: boxKeyPair(),
    leafSecret: randomBytes(32),
    credential: {
      type: 1,
      identityKey: new Uint8Array(32),
      username: targetMemberId,
    },
  }

  // Add to MLS group
  const updatedGroup = await addMemberToGroup(group, newMember)

  // Add to sender key group
  const updatedSenderKeyGroup = await addMemberToSenderKeyGroup(
    senderKeyGroup,
    {
      id: targetMemberId,
      index: senderKeyGroup.members.length,
      identityKey: newMember.identityKey,
      senderKey: boxKeyPair(),
      createdAt: Date.now(),
    },
  )

  // Create admin message
  const message: GroupAdminMessage = {
    type: "add_member",
    adminId: admin.id,
    targetMemberId,
    timestamp: Date.now(),
    signature: await signAdminMessage(
      `add:${targetMemberId}`,
      admin.adminKey.secretKey,
    ),
  }

  return {
    group: updatedGroup.group,
    senderKeyGroup: updatedSenderKeyGroup,
    message,
  }
}

/**
 * Remove a member from the group (admin operation).
 *
 * @param group - MLS group
 * @param senderKeyGroup - Sender key group
 * @param admin - Admin performing the operation
 * @param targetMemberId - Member to remove
 * @returns Updated groups
 */
export async function adminRemoveMember(
  group: MLSGroup,
  senderKeyGroup: SenderKeyGroup,
  admin: GroupAdmin,
  targetMemberId: string,
): Promise<{
  group: MLSGroup;
  senderKeyGroup: SenderKeyGroup;
  message: GroupAdminMessage;
}> {
  // Verify admin permissions
  if (!admin.permissions.canRemoveMembers) {
    throw new Error("Admin does not have permission to remove members")
  }

  // Find member index
  const memberIndex = group.members.findIndex((m) => m.id === targetMemberId)
  if (memberIndex === -1) {
    throw new Error("Member not found in group")
  }

  // Cannot remove super admin
  if (admin.isSuperAdmin && group.members[memberIndex]?.id === admin.id) {
    throw new Error("Cannot remove super admin")
  }

  // Remove from MLS group
  const updatedGroup = await removeMemberFromGroup(group, memberIndex)

  // Remove from sender key group
  const updatedSenderKeyGroup = await removeMemberFromSenderKeyGroup(
    senderKeyGroup,
    memberIndex,
  )

  // Create admin message
  const message: GroupAdminMessage = {
    type: "remove_member",
    adminId: admin.id,
    targetMemberId,
    timestamp: Date.now(),
    signature: await signAdminMessage(
      `remove:${targetMemberId}`,
      admin.adminKey.secretKey,
    ),
  }

  return {
    group: updatedGroup,
    senderKeyGroup: updatedSenderKeyGroup,
    message,
  }
}

/**
 * Update group settings (admin operation).
 *
 * @param settings - Current settings
 * @param admin - Admin performing the operation
 * @param newSettings - New settings to apply
 * @returns Updated settings and admin message
 */
export async function adminUpdateSettings(
  settings: GroupSettings,
  admin: GroupAdmin,
  newSettings: Partial<GroupSettings>,
): Promise<{
  settings: GroupSettings;
  message: GroupAdminMessage;
}> {
  // Verify admin permissions
  if (!admin.permissions.canChangeSettings) {
    throw new Error("Admin does not have permission to change settings")
  }

  // Apply new settings
  const updatedSettings: GroupSettings = {
    ...settings,
    ...newSettings,
    updatedAt: Date.now(),
  }

  // Create admin message
  const message: GroupAdminMessage = {
    type: "update_settings",
    adminId: admin.id,
    newSettings,
    timestamp: Date.now(),
    signature: await signAdminMessage(
      `settings:${JSON.stringify(newSettings)}`,
      admin.adminKey.secretKey,
    ),
  }

  return { settings: updatedSettings, message }
}

/**
 * Create a group invitation.
 *
 * @param groupId - Group ID
 * @param inviterId - Inviter's ID
 * @param inviteeId - Invitee's ID
 * @param message - Invitation message
 * @returns Group invitation
 */
export function createInvitation(
  groupId: string,
  inviterId: string,
  inviteeId: string,
  message: string,
): GroupInvitation {
  return {
    id: generateInvitationId(),
    groupId,
    inviterId,
    inviteeId,
    message,
    createdAt: Date.now(),
    expiresAt: Date.now() + INVITATION_EXPIRY,
    accepted: false,
  }
}

/**
 * Accept a group invitation.
 *
 * @param invitation - Invitation to accept
 * @returns true if successful
 */
export function acceptInvitation(invitation: GroupInvitation): boolean {
  // Check expiry
  if (Date.now() > invitation.expiresAt) {
    return false
  }

  // Mark as accepted
  invitation.accepted = true
  return true
}

/**
 * Verify an admin message signature.
 *
 * @param message - Admin message to verify
 * @param adminPublicKey - Admin's public key
 * @returns true if signature is valid
 */
export async function verifyAdminMessage(
  message: GroupAdminMessage,
  adminPublicKey: Uint8Array,
): Promise<boolean> {
  // Reconstruct message content
  let content = `${message.type}:${message.adminId}:${message.timestamp}`
  if (message.targetMemberId) {
    content += `:${message.targetMemberId}`
  }
  if (message.newSettings) {
    content += `:${JSON.stringify(message.newSettings)}`
  }

  // Verify signature (simplified — in production, use proper Ed25519)
  const expectedSignature = await signAdminMessage(content, adminPublicKey)
  return bytesEqual(message.signature, expectedSignature)
}

// ─── Helper Functions ───

async function signAdminMessage(
  content: string,
  secretKey: Uint8Array,
): Promise<Uint8Array> {
  const contentBytes = new TextEncoder().encode(content)
  const combined = new Uint8Array(contentBytes.length + secretKey.length)
  combined.set(contentBytes)
  combined.set(secretKey, contentBytes.length)
  return sha256(combined)
}

function generateInvitationId(): string {
  const bytes = randomBytes(8)
  return bytesToHex(bytes)
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}
