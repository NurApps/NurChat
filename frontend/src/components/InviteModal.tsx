import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { api } from "../services/api"

interface InviteModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function InviteModal({ isOpen, onClose }: InviteModalProps) {
  const { t } = useTranslation()
  const [inviteLink, setInviteLink] = useState("")
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (isOpen) {
      api.getP2PAddress()
        .then((data) => setInviteLink(data.uri || ""))
        .catch(() => setInviteLink(""))
    }
  }, [isOpen])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const el = document.createElement("textarea")
      el.value = inviteLink
      document.body.appendChild(el)
      el.select()
      document.execCommand("copy")
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: t("chat.inviteTitle"),
          text: t("chat.inviteText"),
          url: inviteLink,
        })
      } catch {}
    } else {
      handleCopy()
    }
  }

  if (!isOpen) return null

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center",
      justifyContent: "center", zIndex: 1000,
    }}>
      <div style={{
        background: "var(--surface, #161b22)", color: "var(--text-primary, #ffffff)",
        borderRadius: 12, padding: 24,
        maxWidth: 400, width: "90%", border: "1px solid var(--border-color, #30363d)",
      }}>
        <h3 style={{ marginBottom: 16, fontSize: 18 }}>{t("chat.invite")}</h3>
        
        <p style={{ fontSize: 14, color: "var(--text-secondary, #8b949e)", marginBottom: 16 }}>
          {t("invite.description")}
        </p>

        {/* Invite Link */}
        <div style={{
          padding: 12, background: "var(--input-bg, var(--surface-variant, #0d1117))", borderRadius: 8,
          fontFamily: "monospace", fontSize: 11, wordBreak: "break-all",
          border: "1px solid var(--border-color, #333)", marginBottom: 16, color: "var(--text-primary, #c9d1d9)",
          maxHeight: 80, overflow: "auto",
        }}>
          {inviteLink}
        </div>

        {/* Buttons */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button
            onClick={handleCopy}
            style={{
              flex: 1, padding: "12px 16px", background: copied ? "#238636" : "var(--hover, #21262d)",
              color: "#fff", border: "1px solid var(--border-color, #30363d)", borderRadius: 6,
              cursor: "pointer", fontSize: 14, fontWeight: 500,
            }}
          >
            {copied ? `✓ ${t("chat.copied")}` : t("chat.copyLink")}
          </button>
          
          <button
            onClick={handleShare}
            style={{
              flex: 1, padding: "12px 16px", background: "#1f6feb", color: "#fff",
              border: "none", borderRadius: 6, cursor: "pointer",
              fontSize: 14, fontWeight: 500,
            }}
          >
            {t("common.send")}
          </button>
        </div>

        {/* Close */}
        <button
          onClick={onClose}
          style={{
            width: "100%", padding: "10px", background: "transparent",
            color: "var(--text-secondary, #8b949e)", border: "1px solid var(--border-color, #30363d)", borderRadius: 6,
            cursor: "pointer", fontSize: 14,
          }}
        >
          {t("common.close")}
        </button>
      </div>
    </div>
  )
}
