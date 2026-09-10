import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('../utils/drafts', () => ({
  getDraftForChat: vi.fn(() => ''),
}))

import ChatListItem from './ChatListItem'
import type { ChatResponse, UserResponse } from '../types'

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

function makeChat(overrides: Partial<ChatResponse> = {}): ChatResponse {
  return {
    id: 'chat_1',
    name: 'Test Chat',
    is_group: false,
    participants: [currentUser, otherUser],
    unread_count: 0,
    is_pinned: false,
    is_muted: false,
    last_message: {
      id: 'msg_1',
      content: 'Last message',
      user_id: 'user_other',
      chat_id: 'chat_1',
      message_type: 'text',
      user: otherUser,
      created_at: '2026-07-27T12:00:00Z',
    },
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
})

describe('ChatListItem', () => {
  it('shows other user username for direct chat', () => {
    render(<ChatListItem chat={makeChat()} currentUser={currentUser} onClick={vi.fn()} />)
    expect(screen.getByText('other')).toBeInTheDocument()
  })

  it('shows other user username for direct chat without name', () => {
    const chat = makeChat({ name: '' })
    render(<ChatListItem chat={chat} currentUser={currentUser} onClick={vi.fn()} />)
    expect(screen.getByText('other')).toBeInTheDocument()
  })

  it('shows group name for group chat', () => {
    const chat = makeChat({ is_group: true, name: 'Group Name' })
    render(<ChatListItem chat={chat} currentUser={currentUser} onClick={vi.fn()} />)
    expect(screen.getByText('Group Name')).toBeInTheDocument()
  })

  it('shows last message preview', () => {
    render(<ChatListItem chat={makeChat()} currentUser={currentUser} onClick={vi.fn()} />)
    expect(screen.getByText('Last message')).toBeInTheDocument()
  })

  it('shows "Нет сообщений" when no last message', () => {
    const chat = makeChat({ last_message: undefined })
    render(<ChatListItem chat={chat} currentUser={currentUser} onClick={vi.fn()} />)
    expect(screen.getByText('Нет сообщений')).toBeInTheDocument()
  })

  it('shows unread badge', () => {
    const chat = makeChat({ unread_count: 5 })
    render(<ChatListItem chat={chat} currentUser={currentUser} onClick={vi.fn()} />)
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('shows "99+" for 100+ unread', () => {
    const chat = makeChat({ unread_count: 100 })
    render(<ChatListItem chat={chat} currentUser={currentUser} onClick={vi.fn()} />)
    expect(screen.getByText('99+')).toBeInTheDocument()
  })

  it('shows online dot for direct chat with online user', () => {
    const onlineOther = { ...otherUser, is_online: true }
    const chat = makeChat({ participants: [currentUser, onlineOther] })
    const { container } = render(<ChatListItem chat={chat} currentUser={currentUser} onClick={vi.fn()} />)
    expect(container.querySelector('.cli-online-dot')).toBeInTheDocument()
  })

  it('shows group icon for group chats', () => {
    const chat = makeChat({ is_group: true, name: 'Group' })
    const { container } = render(<ChatListItem chat={chat} currentUser={currentUser} onClick={vi.fn()} />)
    const svg = container.querySelector('.cli-icon')
    expect(svg).toBeInTheDocument()
  })

  it('opens menu on menu button click', () => {
    render(<ChatListItem chat={makeChat()} currentUser={currentUser} onClick={vi.fn()} onPin={vi.fn()} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Закрепить')).toBeInTheDocument()
  })

  it('calls onClick when item is clicked', () => {
    const onClick = vi.fn()
    render(<ChatListItem chat={makeChat()} currentUser={currentUser} onClick={onClick} />)
    fireEvent.click(document.querySelector('.chat-list-item')!)
    expect(onClick).toHaveBeenCalledWith('chat_1')
  })

  it('calls onPin from menu', () => {
    const onPin = vi.fn()
    render(<ChatListItem chat={makeChat()} currentUser={currentUser} onClick={vi.fn()} onPin={onPin} />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText('Закрепить'))
    expect(onPin).toHaveBeenCalledWith('chat_1', expect.any(Boolean))
  })

  it('calls onMute from menu', () => {
    const onMute = vi.fn()
    render(<ChatListItem chat={makeChat()} currentUser={currentUser} onClick={vi.fn()} onMute={onMute} />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText('Отключить уведомления'))
    expect(onMute).toHaveBeenCalledWith('chat_1', false)
  })

  it('calls onDelete from menu', () => {
    const onDelete = vi.fn()
    render(<ChatListItem chat={makeChat()} currentUser={currentUser} onClick={vi.fn()} onDelete={onDelete} />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByRole('button', { name: /Удалить/i }))
    expect(onDelete).toHaveBeenCalledWith('chat_1')
  })
})
