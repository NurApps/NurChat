import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MobileMessageInput } from '../components/mobile/MobileMessageInput';
import { SwipeableRow } from '../components/mobile/SwipeableRow';
import { PullToRefresh } from '../components/mobile/PullToRefresh';
import { formatTime } from '../utils/format';
import { MobileMediaViewer } from '../components/mobile/MobileMediaViewer';
import { BottomTabs } from '../components/mobile/BottomTabs';
import { api } from '../services/api';
import type { MessageResponse } from '../types';

export default function MobileChatPage() {
  const navigate = useNavigate();
  const { chatId } = useParams<{ chatId: string }>();
  const [messages, setMessages] = useState<MessageResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<{
    src: string;
    type: 'image' | 'video' | 'audio';
  } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(async () => {
    if (!chatId) return;
    setLoading(true);
    try {
      const data = await api.getChatMessages(chatId);
      setMessages(data);
    } catch (err) {
      console.error('Failed to load messages:', err);
    } finally {
      setLoading(false);
    }
  }, [chatId]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(async (text: string) => {
    if (!chatId) return;
    try {
      await api.sendMessage(chatId, text);
      await loadMessages();
    } catch (err) {
      console.error('Failed to send:', err);
    }
  }, [chatId, loadMessages]);

  const handleRefresh = useCallback(async () => {
    await loadMessages();
  }, [loadMessages]);

  const handleDelete = useCallback(async (messageId: string) => {
    if (window.confirm('Удалить сообщение?')) {
      try {
        await api.deleteMessage(messageId);
        await loadMessages();
      } catch (err) {
        console.error('Failed to delete:', err);
      }
    }
  }, [loadMessages]);

  if (!chatId) {
    return (
      <div className="mobile-layout">
        <div className="mobile-chat-empty">
          <div className="mobile-chat-empty__icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <h2>Выберите чат</h2>
          <p>Начните общение, выбрав чат из списка</p>
        </div>
        <BottomTabs />
      </div>
    );
  }

  return (
    <div className="mobile-layout">
      <header className="mobile-chat__header">
        <button className="mobile-chat__back" onClick={() => navigate('/chat')} aria-label="Назад">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="mobile-chat__info">
          <h1 className="mobile-chat__title">Чат</h1>
        </div>
      </header>

      <PullToRefresh onRefresh={handleRefresh}>
        <div className="mobile-chat__messages">
          {messages.map((msg) => (
            <SwipeableRow key={msg.id} onDelete={() => handleDelete(msg.id)}>
              <div className={`message-bubble ${msg.sender_id === 'me' ? 'message-bubble--sent' : 'message-bubble--received'}`}>
                <div className="message-bubble__text">{msg.content}</div>
                <div className="message-bubble__time">
                  {formatTime(msg.created_at)}
                  {msg.is_edited && <span className="message-bubble__edited"> (ред.)</span>}
                </div>
              </div>
            </SwipeableRow>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </PullToRefresh>

      <MobileMessageInput onSend={handleSend} disabled={loading} />

      {selectedMedia && (
        <MobileMediaViewer
          src={selectedMedia.src}
          type={selectedMedia.type}
          onClose={() => setSelectedMedia(null)}
        />
      )}
    </div>
  );
}
