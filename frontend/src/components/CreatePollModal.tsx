import { useState } from "react"
import { useTranslation } from "react-i18next"

interface Props {
  onCreate: (data: {
    question: string
    options: { text: string }[]
    is_anonymous?: boolean
    allow_multiple?: boolean
  }) => void
  onClose: () => void
}

export default function CreatePollModal({ onCreate, onClose }: Props) {
  const { t } = useTranslation()
  const [question, setQuestion] = useState("")
  const [options, setOptions] = useState<string[]>(["", ""])
  const [isAnonymous, setIsAnonymous] = useState(false)
  const [allowMultiple, setIsMultiple] = useState(false)

  const validOptions = options.filter((o) => o.trim().length > 0)

  const handleAddOption = () => {
    if (options.length >= 10) return
    setOptions((prev) => [...prev, ""])
  }

  const handleRemoveOption = (index: number) => {
    if (options.length <= 2) return
    setOptions((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = () => {
    if (!question.trim() || validOptions.length < 2) return
    onCreate({
      question: question.trim(),
      options: validOptions.map((o) => ({ text: o.trim() })),
      is_anonymous: isAnonymous,
      allow_multiple: allowMultiple,
    })
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={t("poll.create")} onClick={onClose}>
      <div className="forward-modal poll-modal" onClick={(e) => e.stopPropagation()}>
        <div className="forward-header">
          <h3>{t("poll.create")}</h3>
          <button className="modal-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="forward-list poll-form">
          <input
            className="poll-input"
            placeholder={t("poll.question")}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={200}
          />
          {options.map((opt, i) => (
            <div key={i} className="poll-option-row">
              <input
                className="poll-input"
                placeholder={`${t("poll.option")} ${i + 1}`}
                value={opt}
                onChange={(e) =>
                  setOptions((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))
                }
                maxLength={100}
              />
              {options.length > 2 && (
                <button className="poll-remove-btn" onClick={() => handleRemoveOption(i)} title={t("common.delete")}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
          ))}
          {options.length < 10 && (
            <button className="poll-add-btn" onClick={handleAddOption}>{t("poll.addOption")}</button>
          )}
          <label className="poll-check">
            <input type="checkbox" checked={isAnonymous} onChange={(e) => setIsAnonymous(e.target.checked)} />
            <span>{t("poll.anonymous")}</span>
          </label>
          <label className="poll-check">
            <input type="checkbox" checked={allowMultiple} onChange={(e) => setIsMultiple(e.target.checked)} />
            <span>{t("poll.allowMultiple")}</span>
          </label>
        </div>
        <button
          className="forward-send"
          disabled={!question.trim() || validOptions.length < 2}
          onClick={handleSubmit}
        >
          {t("poll.create")}
        </button>
      </div>
    </div>
  )
}