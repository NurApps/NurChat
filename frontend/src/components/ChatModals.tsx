import AddContactModal from "./AddContactModal"
import CreateChatModal from "./CreateChatModal"
import UserProfileModal from "./UserProfileModal"
import GroupSettings from "./GroupSettings"
import GlobalSearch from "./GlobalSearch"
import MessageInfoModal from "./MessageInfoModal"
import InviteModal from "./InviteModal"
import type { UserResponse, ChatResponse, ContactResponse } from "../types"

interface Props {
  showAddContact: boolean
  contacts: ContactResponse[]
  currentUser: UserResponse
  onAddContact: (userId: string) => void
  onCloseAddContact: () => void
  showCreateChat: boolean
  onCreateChat: (participantIds: string[], name: string | null, isSecret?: boolean, secretTtl?: number) => void
  onCloseCreateChat: () => void
  profileUser: UserResponse | null
  onCloseProfile: () => void
  showGroupSettings: boolean
  selectedChat: ChatResponse | null
  onCloseGroupSettings: () => void
  onGroupUpdated: () => void
  showGlobalSearch: boolean
  chats: ChatResponse[]
  onSelectGlobalSearch: (chatId: string, messageId?: string) => void
  onCloseGlobalSearch: () => void
  showMessageInfo: string | null
  onCloseMessageInfo: () => void
  showInviteModal: boolean
  onCloseInviteModal: () => void
}

export default function ChatModals({
  showAddContact, contacts, currentUser, onAddContact, onCloseAddContact,
  showCreateChat, onCreateChat, onCloseCreateChat,
  profileUser, onCloseProfile,
  showGroupSettings, selectedChat, onCloseGroupSettings, onGroupUpdated,
  showGlobalSearch, chats, onSelectGlobalSearch, onCloseGlobalSearch,
  showMessageInfo, onCloseMessageInfo,
  showInviteModal, onCloseInviteModal,
}: Props) {
  return (
    <>
      {showAddContact && (
        <AddContactModal
          existingContactIds={contacts.map((c) => c.contact_user?.id).filter(Boolean) as string[]}
          currentUserId={currentUser.id}
          onAdd={onAddContact}
          onClose={onCloseAddContact}
        />
      )}
      {showCreateChat && (
        <CreateChatModal
          currentUserId={currentUser.id}
          onCreate={onCreateChat}
          onClose={onCloseCreateChat}
        />
      )}
      {profileUser && (
        <UserProfileModal user={profileUser} onClose={onCloseProfile} />
      )}
      {showGroupSettings && selectedChat?.is_group && (
        <GroupSettings chat={selectedChat} currentUser={currentUser} onClose={onCloseGroupSettings} onUpdated={onGroupUpdated} />
      )}
      {showGlobalSearch && (
        <GlobalSearch chats={chats} onSelect={onSelectGlobalSearch} onClose={onCloseGlobalSearch} />
      )}
      {showMessageInfo && (
        <MessageInfoModal messageId={showMessageInfo} onClose={onCloseMessageInfo} />
      )}
      {showInviteModal && (
        <InviteModal isOpen={showInviteModal} onClose={onCloseInviteModal} />
      )}
    </>
  )
}
