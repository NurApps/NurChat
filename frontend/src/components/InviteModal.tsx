import { useState, useEffect } from "react"
import { generateInviteLink, initP2P, getLocalIP } from "../services/p2pService"
import { loadKeys } from "../services/e2e"

interface InviteModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function InviteModal({ isOpen, onClose }: InviteModalProps) {
  const [inviteLink, setInviteLink] = useState("")
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (isOpen) {
      const keys = loadKeys()
      if (keys) {
        ;(async () => {
          try {
            const port = await initP2P()
            const ip = await getLocalIP()
            setInviteLink(generateInviteLink(keys.publicKeyHex, port, ip))
          } catch (err) {
            console.error("[Invite] failed to build link:", err)
          }
        })()
      }
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
          title: "Приглашение в NurChat",
          text: "Присоединяйся ко мне в NurChat!",
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
        background: "#161b22", borderRadius: 12, padding: 24,
        maxWidth: 400, width: "90%", border: "1px solid #30363d",
      }}>
        <h3 style={{ marginBottom: 16, fontSize: 18 }}>Пригласить друга</h3>
        
        <p style={{ fontSize: 14, color: "#8b949e", marginBottom: 16 }}>
          Скопируйте ссылку и отправьте другу любым способом:
        </p>

        {/* Invite Link */}
        <div style={{
          padding: 12, background: "#0d1117", borderRadius: 8,
          fontFamily: "monospace", fontSize: 11, wordBreak: "break-all",
          border: "1px solid #333", marginBottom: 16, color: "#c9d1d9",
          maxHeight: 80, overflow: "auto",
        }}>
          {inviteLink}
        </div>

        {/* Buttons */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button
            onClick={handleCopy}
            style={{
              flex: 1, padding: "12px 16px", background: copied ? "#238636" : "#21262d",
              color: "#fff", border: "1px solid #30363d", borderRadius: 6,
              cursor: "pointer", fontSize: 14, fontWeight: 500,
            }}
          >
            {copied ? "✓ Скопировано" : "Копировать"}
          </button>
          
          <button
            onClick={handleShare}
            style={{
              flex: 1, padding: "12px 16px", background: "#1f6feb", color: "#fff",
              border: "none", borderRadius: 6, cursor: "pointer",
              fontSize: 14, fontWeight: 500,
            }}
          >
            Отправить
          </button>
        </div>

        {/* Close */}
        <button
          onClick={onClose}
          style={{
            width: "100%", padding: "10px", background: "transparent",
            color: "#8b949e", border: "1px solid #30363d", borderRadius: 6,
            cursor: "pointer", fontSize: 14,
          }}
        >
          Закрыть
        </button>
      </div>
    </div>
  )
}
