import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('../services/api', () => ({
  api: {
    getFileUrl: vi.fn((id: string) => `http://test/files/${id}?token=mock`),
    getReadCount: vi.fn(() => Promise.resolve({ read_count: 2, total_participants: 5 })),
  },
}))

vi.mock('dompurify', () => ({
  default: {
    sanitize: vi.fn((text: string) => text),
  },
}))

vi.mock('./MediaViewer', () => ({
  default: ({ type, url, onClose }: { type: string; url: string; onClose: () => void }) =>
    <div data-testid="media-viewer">{type}:{url}<button onClick={onClose}>close</button></div>,
}))

vi.mock('./VoiceMessage', () => ({
  default: ({ src }: { src: string }) => <div data-testid="voice-message">{src}</div>,
}))

import MessageBubble from './MessageBubble'
import type { MessageResponse, UserResponse } from '../types'

const currentUser: UserResponse = {
  id: 'user_me',
  username: 'me',
  first_name: 'Me',
}

const otherUser: UserResponse = {
  id: 'user_other',
  username: 'other',
  first_name: 'Other',
}

function makeMessage(overrides: Partial<MessageResponse> = {}): MessageResponse {
  return {
    id: 'msg_1',
    content: 'Hello world',
    user_id: 'user_me',
    chat_id: 'chat_1',
    message_type: 'text',
    user: currentUser,
    created_at: '2026-07-27T12:00:00Z',
    is_read: false,
    is_deleted: false,
    deleted_for_all: false,
    reactions: {},
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-07-27T14:00:00Z'))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('MessageBubble', () => {
  it('renders text message content', () => {
    render(<MessageBubble message={makeMessage()} currentUser={currentUser} isMyMessage={false} />)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('shows sender avatar for other user messages', () => {
    render(<MessageBubble message={makeMessage({ user: otherUser })} currentUser={currentUser} isMyMessage={false} />)
    expect(screen.getByText('O')).toBeInTheDocument()
  })

  it('applies "mine" class for own messages', () => {
    const { container } = render(<MessageBubble message={makeMessage()} currentUser={currentUser} isMyMessage={true} />)
    expect(container.querySelector('.msg-bubble.mine')).toBeInTheDocument()
  })

  it('applies "other" class for others messages', () => {
    const { container } = render(<MessageBubble message={makeMessage()} currentUser={currentUser} isMyMessage={false} />)
    expect(container.querySelector('.msg-bubble.other')).toBeInTheDocument()
  })

  it('shows deleted state', () => {
    render(<MessageBubble message={makeMessage({ is_deleted: true })} currentUser={currentUser} isMyMessage={false} />)
    expect(screen.getByText('Сообщение удалено')).toBeInTheDocument()
  })

  it('shows deleted_for_all state', () => {
    render(<MessageBubble message={makeMessage({ deleted_for_all: true })} currentUser={currentUser} isMyMessage={false} />)
    expect(screen.getByText('Сообщение удалено')).toBeInTheDocument()
  })

  it('renders status icons for my messages', () => {
    const statuses = ['sending', 'sent', 'delivered', 'failed']
    for (const status of statuses) {
      cleanup()
      const { container } = render(
        <MessageBubble message={makeMessage()} currentUser={currentUser} isMyMessage={true} status={status} />
      )
      expect(container.querySelector(`.msg-status.${status}`)).toBeInTheDocument()
    }
  })

  it('renders read status icon when isRead is true', () => {
    const { container } = render(
      <MessageBubble message={makeMessage()} currentUser={currentUser} isMyMessage={true} isRead={true} />
    )
    expect(container.querySelector('.msg-status.read')).toBeInTheDocument()
  })

  it('renders reaction bar when reactions exist', () => {
    const reactions = { '👍': ['user_me', 'user_other'] }
    const { container } = render(
      <MessageBubble
        message={makeMessage()}
        currentUser={currentUser}
        isMyMessage={false}
        reactions={reactions}
      />
    )
    expect(container.querySelector('.reaction-bar')).toBeInTheDocument()
    expect(container.querySelector('.reaction-emoji')?.textContent).toBe('👍')
    expect(container.querySelector('.reaction-count')?.textContent).toBe('2')
  })

  it('calls onReaction when reaction button clicked', () => {
    const onReaction = vi.fn()
    const reactions = { '👍': ['user_other'] }
    const { container } = render(
      <MessageBubble
        message={makeMessage()}
        currentUser={currentUser}
        isMyMessage={false}
        reactions={reactions}
        onReaction={onReaction}
      />
    )
    const btn = container.querySelector('.reaction-btn')!
    fireEvent.click(btn)
    expect(onReaction).toHaveBeenCalledWith('msg_1', '👍', true)
  })

  it('opens context menu on menu button click', () => {
    render(
      <MessageBubble message={makeMessage()} currentUser={currentUser} isMyMessage={true} />
    )
    const menuBtn = document.querySelector('.msg-menu-btn')
    expect(menuBtn).toBeInTheDocument()
    if (menuBtn) {
      fireEvent.click(menuBtn)
      expect(screen.getByText('Копировать')).toBeInTheDocument()
      expect(screen.getByText('Редактировать')).toBeInTheDocument()
      expect(screen.getByText('Ответить')).toBeInTheDocument()
    }
  })

  it('calls onDelete when delete menu item clicked', () => {
    const onDelete = vi.fn()
    render(
      <MessageBubble message={makeMessage()} currentUser={currentUser} isMyMessage={true} onDelete={onDelete} />
    )
    fireEvent.click(document.querySelector('.msg-menu-btn')!)
    fireEvent.click(screen.getByText('Удалить'))
    fireEvent.click(screen.getByText('Удалить у себя'))
    expect(onDelete).toHaveBeenCalledWith('msg_1', false)
  })

  it('enters edit mode on edit menu click', () => {
    render(
      <MessageBubble message={makeMessage({ content: 'Edit me' })} currentUser={currentUser} isMyMessage={true} />
    )
    fireEvent.click(document.querySelector('.msg-menu-btn')!)
    fireEvent.click(screen.getByText('Редактировать'))
    const textarea = document.querySelector('.msg-edit-input') as HTMLTextAreaElement
    expect(textarea).toBeInTheDocument()
    expect(textarea.value).toBe('Edit me')
  })

  it('shows forwarded indicator', () => {
    render(
      <MessageBubble
        message={makeMessage({ forwarded_from: 'user_other' })}
        currentUser={currentUser}
        isMyMessage={false}
      />
    )
    expect(screen.getByText('⟳ Переслано')).toBeInTheDocument()
  })
})
