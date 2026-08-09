import { useState, useRef, useCallback, useEffect } from 'react';

interface MobileMessageInputProps {
  onSend: (text: string) => void;
  onAttach?: () => void;
  onVoice?: () => void;
  placeholder?: string;
  disabled?: boolean;
}

export function MobileMessageInput({
  onSend,
  onAttach,
  onVoice,
  placeholder = 'Сообщение...',
  disabled = false,
}: MobileMessageInputProps) {
  const [text, setText] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  }, [text]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;

    onSend(trimmed);
    setText('');

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Send on Enter (without Shift)
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
  }, []);

  return (
    <div className={`message-input ${isFocused ? 'message-input--focused' : ''}`}>
      {/* Attach button */}
      {onAttach && (
        <button
          className="message-input__btn message-input__btn--attach"
          onClick={onAttach}
          disabled={disabled}
          aria-label="Прикрепить файл"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
      )}

      {/* Text input */}
      <textarea
        ref={textareaRef}
        className="message-input__field"
        value={text}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        maxLength={4000}
        aria-label="Введите сообщение"
      />

      {/* Send or Voice button */}
      {text.trim() ? (
        <button
          className="message-input__btn message-input__btn--send"
          onClick={handleSend}
          disabled={disabled}
          aria-label="Отправить"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      ) : (
        onVoice && (
          <button
            className="message-input__btn message-input__btn--voice"
            onClick={onVoice}
            disabled={disabled}
            aria-label="Голосовое сообщение"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </button>
        )
      )}

      <style>{`
        .message-input--focused .message-input__field {
          border-color: var(--accent-color);
        }

        .message-input__btn--voice {
          background: transparent;
          color: var(--text-secondary);
        }

        .message-input__btn--voice:active {
          color: var(--accent-color);
        }
      `}</style>
    </div>
  );
}
