export interface UserResponse {
  id: string
  username: string
  first_name: string
  last_name?: string
  created_at?: string
  last_seen?: string
  is_online?: boolean
  public_key?: string
  signing_public_key?: string
  avatar_path?: string
  status?: string
  bio?: string
}

export interface MessageResponse {
  id: string
  content: string
  user_id: string
  chat_id: string
  message_type: string
  file_id?: string
  file?: { id: string; filename: string; file_type: string; file_size: number; ipfs_hash?: string; uploaded_at: string; user_id: string }
  encrypted_content?: string
  signature?: string
  user: UserResponse
  created_at: string
  is_read?: boolean
  is_deleted?: boolean
  deleted_for_all?: boolean
  forwarded_from?: string
  reactions?: Record<string, string[]>
  expires_at?: string
  is_pinned?: boolean
}

export interface ReactionResponse {
  id: number
  message_id: string
  user_id: string
  emoji: string
  created_at: string
  user: UserResponse
}

export interface ChatResponse {
  id: string
  name?: string
  is_group: boolean
  created_at?: string
  participants: UserResponse[]
  last_message?: MessageResponse
  unread_count?: number
  is_pinned?: boolean
  is_muted?: boolean
  is_secret?: boolean
  secret_ttl?: number
  disappears_after_seconds?: number
  pinned_messages?: MessageResponse[]
}

export interface ContactResponse {
  id: string
  user_id?: string
  contact_user_id?: string
  created_at?: string
  user?: UserResponse
  contact_user: UserResponse
}

export interface GroupInviteResponse {
  id: string
  group_id?: string
  group: { id: string; name: string }
  inviter_id?: string
  inviter: { id: string; username: string }
  invitee_id?: string
  invitee?: { id: string; username: string }
  status?: string
  created_at?: string
}

export interface FileUploadResponse {
  id: string
  filename: string
  file_type: string
  file_size: number
  file_path: string
  ipfs_hash?: string
  ttl_days: number
  uploaded_at: string
  user_id: string
}
