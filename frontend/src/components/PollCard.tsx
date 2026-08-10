import { useState } from "react"
import { useTranslation } from "react-i18next"
import type { PollResponse } from "../types"
import { api } from "../services/api"

interface Props {
  poll: PollResponse
  currentUserId: string
  onVote?: () => void
}

export default function PollCard({ poll, currentUserId, onVote }: Props) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<number[]>(poll.my_votes || [])
  const [voting, setVoting] = useState(false)

  const isExpired = poll.expires_at && new Date(poll.expires_at) < new Date()
  const canVote = !isExpired && !voting

  const handleToggle = (optionId: number) => {
    if (!canVote) return
    if (poll.allow_multiple) {
      setSelected(prev =>
        prev.includes(optionId)
          ? prev.filter(id => id !== optionId)
          : [...prev, optionId]
      )
    } else {
      setSelected([optionId])
    }
  }

  const handleVote = async () => {
    if (selected.length === 0 || !canVote) return
    setVoting(true)
    try {
      await api.votePoll(poll.id, selected)
      onVote?.()
    } catch (e) {
      console.error("Vote failed:", e)
    } finally {
      setVoting(false)
    }
  }

  const maxVotes = Math.max(...poll.options.map(o => o.vote_count), 1)

  return (
    <div className="poll-card">
      <div className="poll-question">{poll.question}</div>
      <div className="poll-options">
        {poll.options.map(opt => {
          const pct = poll.total_votes > 0 ? Math.round((opt.vote_count / poll.total_votes) * 100) : 0
          const isSelected = selected.includes(opt.id)
          const showResults = poll.my_votes && poll.my_votes.length > 0

          return (
            <button
              key={opt.id}
              className={`poll-option ${isSelected ? "selected" : ""} ${showResults ? "show-results" : ""}`}
              onClick={() => handleToggle(opt.id)}
              disabled={!canVote}
            >
              {showResults && (
                <div className="poll-option-bar" style={{ width: `${pct}%` }} />
              )}
              <span className="poll-option-text">{opt.text}</span>
              {showResults && (
                <span className="poll-option-count">{opt.vote_count} ({pct}%)</span>
              )}
              {isSelected && !showResults && <span className="poll-option-check">&#10003;</span>}
            </button>
          )
        })}
      </div>
      <div className="poll-footer">
        <span className="poll-total">{poll.total_votes} {t("poll.votes")}</span>
        {selected.length > 0 && !poll.my_votes?.length && (
          <button className="poll-vote-btn" onClick={handleVote} disabled={!canVote}>
            {t("poll.vote")}
          </button>
        )}
        {isExpired && <span className="poll-expired">{t("poll.expired")}</span>}
      </div>
    </div>
  )
}
