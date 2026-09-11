import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MobileMessageInput } from '../components/mobile/MobileMessageInput';
import { SwipeableRow } from '../components/mobile/SwipeableRow';
import { PullToRefresh } from '../components/mobile/PullToRefresh';
import { formatTime } from '../utils/format';
import { MobileMediaViewer } from '../components/mobile/MobileMediaViewer';
import { BottomTabs } from '../components/mobile/BottomTabs';
import { api } from '../services/api';
import { loadKeys as loadE2EKeys, decryptMessage, isE2EEnabled, type E2EKeys } from '../services/e2e';
import { fetchGroupKey, decryptGroupMessageRatcheted } from '../services/groupE2E';
import type { MessageResponse, ChatResponse } from '../types';

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export default function MobileChatPage() {
  const navigate = useNavigate();
  const { chatId } = useParams<{ chatId?: string }>();
  const [messages, setMessages] = useState<MessageResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatResponse | null>(null);
  const [e2eKeys, setE2eKeys] = useState<E2EKeys | null>(null);
  const [selectedMedia, setSelectedMedia] = useState<{
    src: string;
    type: 'image' | 'video' | 'audio';
  } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadE2EKeys().then(setE2eKeys).catch(() => setE2eKeys(null));
    try {
      const raw = localStorage.getItem("user");
      if (raw) setCurrentUserId((JSON.parse(raw) as { id?: string }).id ?? null);
    } catch { /* ignore */ }
  }, []);

  const decryptMessages = useCallback(async (
    msgs: MessageResponse[], chatObj: ChatResponse, keys: E2EKeys | null, selfId: string | null,
  ): Promise<MessageResponse[]> => {
    if (!keys || !selfId || !isE2EEnabled(chatObj.participants, keys)) return msgs;
    const peer = chatObj.participants.find(p => p.id !== selfId);
    let groupKey: Uint8Array | null = null;
    if (chatObj.is_group) {
      try { groupKey = await fetchGroupKey(chatObj.id, hexToBytes(keys.privateKeyHex)); } catch { /* no key yet */ }
    }
    const out: MessageResponse[] = [];
    for (const msg of msgs) {
      if (!msg.encrypted_content) { out.push(msg); continue; }
      try {
        const envelope = JSON.parse(msg.encrypted_content);
        if (envelope.group_encrypted && groupKey) {
          const plain = await decryptGroupMessageRatcheted(envelope.group_encrypted, groupKey, chatObj.id);
          out.push({ ...msg, content: plain || '[не удалось расшифровать]' });
        } else if (peer?.public_key && !envelope.group_encrypted) {
          const plain = await decryptMessage(envelope, keys, peer.public_key, chatObj.id);
          out.push({ ...msg, content: plain || '[не удалось расшифровать]' });
        } else {
          out.push(msg);
        }
      } catch {
        out.push({ ...msg, content: '[ошибка расшифровки]' });
      }
    }
    return out;
  }, []);

  const loadMessages = useCallback(async () => {
    if (!chatId) return;
    setLoading(true);
    try {
      const chats = await api.getChats();
      const current = chats.find(c => c.id === chatId) ?? null;
      setChat(current);
      const data = await api.getChatMessages(chatId);
      if (current) {
        const keys = await loadE2EKeys().catch(() => null);
        if (keys) setE2eKeys(keys);
        const raw = localStorage.getItem("user");
        const selfId = raw ? ((JSON.parse(raw) as { id?: string }).id ?? null) : null;
        setMessages(await decryptMessages(data, current, keys, selfId));
      } else {
        setMessages(data);
      }
    } catch (err) {
      console.error('Failed to load messages:', err);
    } finally {
      setLoading(false);
    }
  }, [chatId, decryptMessages]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Отправка через тот же E2E-маршрут, что и десктоп (группы — групповой
  // ключ, лички — 1-1). Раньше слался plaintext и глухой relay отвечал 400.
  const handleSend = useCallback(async (text: string) => {
    if (!chatId || !text.trim()) return;
    try {
      const chats = await api.getChats();
      const current = chats.find(c => c.id === chatId);
      if (!current) return;
      const keys = e2eKeys ?? await loadE2EKeys().catch(() => null);
      let content = text.trim();
      let encryptedContent: string | undefined;
      let signature: string | undefined;
      const raw = localStorage.getItem("user");
      const selfId = raw ? ((JSON.parse(raw) as { id?: string }).id ?? null) : null;
      if (keys && current.is_group) {
        const groupKey = await fetchGroupKey(current.id, hexToBytes(keys.privateKeyHex)).catch(() => null);
        if (groupKey) {
          const { encryptGroupMessageRatcheted } = await import('../services/groupE2E');
          encryptedContent = JSON.stringify({ group_encrypted: await encryptGroupMessageRatcheted(content, groupKey, current.id) });
          content = '[encrypted]';
        }
      } else if (keys && selfId && isE2EEnabled(current.participants, keys)) {
        const { encryptMessage } = await import('../services/e2e');
        const peer = current.participants.find(p => p.id !== selfId);
        if (peer?.public_key) {
          const envelope = await encryptMessage(content, keys, peer.public_key, current.id, selfId, peer.id);
          encryptedContent = JSON.stringify(envelope);
          signature = envelope.signature;
          content = '[encrypted]';
        }
      }
      await api.sendMessage(chatId, content, "text", undefined, encryptedContent, signature);
      await loadMessages();
    } catch (err) {
      console.error('Failed to send:', err);
    }
  }, [chatId, e2eKeys, loadMessages]);

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

  const peer = chat && !chat.is_group
    ? chat.participants.find(p => p.id !== currentUserId)
    : null;
  const peerId = peer?.id ?? null;

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
          <h1 className="mobile-chat__title">
            {chat ? (chat.is_group ? chat.name : (peer?.username || peer?.first_name || 'Чат')) : 'Чат'}
          </h1>
        </div>
        {peerId && (
          <>
            <button
              className="mobile-chat__back"
              onClick={() => navigate(`/call/${peerId}/audio`)}
              aria-label="Аудиозвонок"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
            </button>
            <button
              className="mobile-chat__back"
              onClick={() => navigate(`/call/${peerId}/video`)}
              aria-label="Видеозвонок"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
            </button>
          </>
        )}
      </header>

      <PullToRefresh onRefresh={handleRefresh}>
        <div className="mobile-chat__messages">
          {messages.map((msg) => (
            <SwipeableRow key={msg.id} onDelete={() => handleDelete(msg.id)}>
              <div className={`message-bubble ${msg.user_id === currentUserId ? 'message-bubble--sent' : 'message-bubble--received'}`}>
                <div className="message-bubble__text">{msg.content}</div>
                <div className="message-bubble__time">
                  {formatTime(msg.created_at)}
                  {msg.edited_at && <span className="message-bubble__edited"> (изм.)</span>}
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
