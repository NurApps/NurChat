import AddContactModal from "./AddContactModal"
import CreateChatModal from "./CreateChatModal"
import ForwardModal from "./ForwardModal"
import UserProfileModal from "./UserProfileModal"
import GroupSettings from "./GroupSettings"
import GlobalSearch from "./GlobalSearch"
import MessageInfoModal from "./MessageInfoModal"
import InviteModal from "./InviteModal"
import { PinnedMessagesModal } from "./PinnedMessagesModal"
import type { UserResponse, ChatResponse, ContactResponse } from "../types"

interface Props {
  showAddContact: boolean
  contacts: ContactResponse[]
  currentUser: UserResponse
  onAddContact: (userId: string) => void
  onCloseAddContact: () => void
  showCreateChat: boolean
  onCreateChat: (name: string, participantIds: string[], isSecret: boolean, expiresAfter: number) => void
  onCloseCreateChat: () => void
  showForward: string | null
  selectedChatId: string | undefined
  onForward: (messageId: string, targetChatId: string) => void
  onCloseForward: () => void
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
  showPinnedModal: boolean
  onClosePinnedModal: () => void
  onPinnedMessageClick: (msgId: string) => void
}

export default function ChatModals({
  showAddContact, contacts, currentUser, onAddContact, onCloseAddContact,
  showCreateChat, onCreateChat, onCloseCreateChat,
  showForward, selectedChatId, onForward, onCloseForward,
  profileUser, onCloseProfile,
  showGroupSettings, selectedChat, onCloseGroupSettings, onGroupUpdated,
  showGlobalSearch, chats, onSelectGlobalSearch, onCloseGlobalSearch,
  showMessageInfo, onCloseMessageInfo,
  showInviteModal, onCloseInviteModal,
  showPinnedModal, onClosePinnedModal, onPinnedMessageClick,
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
      {showForward && (
        <ForwardModal
          messageId={showForward}
          sourceChatId={selectedChatId}
          currentUserId={currentUser.id}
          onForward={onForward}
          onClose={onCloseForward}
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
      {showPinnedModal && selectedChat && (
        <PinnedMessagesModal
          chatId={selectedChat.id}
          isOpen={showPinnedModal}
          onClose={onClosePinnedModal}
          onMessageClick={onPinnedMessageClick}
        />
      )}
    </>
  )
}
