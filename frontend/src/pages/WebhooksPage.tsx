import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "../services/api"
import type { WebhookResponse } from "../types"

const EVENT_OPTIONS = [
  { value: "message.new", label: "Новое сообщение" },
  { value: "message.edited", label: "Сообщение изменено" },
  { value: "message.deleted", label: "Сообщение удалено" },
]

export default function WebhooksPage() {
  const navigate = useNavigate()
  const [webhooks, setWebhooks] = useState<WebhookResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [secret, setSecret] = useState("")
  const [events, setEvents] = useState<string[]>(["message.new"])
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)

  useEffect(() => {
    loadWebhooks()
  }, [])

  const loadWebhooks = async () => {
    setLoading(true)
    setError("")
    try {
      const data = await api.getWebhooks()
      setWebhooks(data)
    } catch (e: any) {
      setError(e.message || "Ошибка загрузки")
    } finally {
      setLoading(false)
    }
  }

  const toggleEvent = (ev: string) => {
    setEvents((prev) =>
      prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]
    )
  }

  const handleCreate = async () => {
    if (!name.trim() || !url.trim()) return
    if (events.length === 0) return
    setSaving(true)
    try {
      await api.createWebhook({
        name: name.trim(),
        url: url.trim(),
        events,
        secret: secret.trim() || undefined,
      })
      setName("")
      setUrl("")
      setSecret("")
      setEvents(["message.new"])
      setCreating(false)
      await loadWebhooks()
    } catch (e: any) {
      setError(e.message || "Ошибка создания")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm("Удалить этот webhook?")) return
    try {
      await api.deleteWebhook(id)
      setWebhooks((prev) => prev.filter((w) => w.id !== id))
    } catch (e: any) {
      setError(e.message || "Ошибка удаления")
    }
  }

  const handleTest = async (id: string) => {
    setTesting(id)
    try {
      await api.testWebhook(id)
      alert("Webhook успешно доставлен!")
    } catch (e: any) {
      alert(e.message || "Ошибка доставки")
    } finally {
      setTesting(null)
    }
  }

  const handleToggleActive = async (w: WebhookResponse) => {
    try {
      const updated = await api.updateWebhook(w.id, { is_active: !w.is_active })
      setWebhooks((prev) => prev.map((x) => (x.id === w.id ? updated : x)))
    } catch (e: any) {
      setError(e.message || "Ошибка обновления")
    }
  }

  return (
    <div className="settings-page">
      <div className="settings-header">
        <button className="settings-back" onClick={() => navigate("/settings")}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h2>Webhooks</h2>
      </div>

      <div className="settings-body" style={{ padding: 16 }}>
        {error && <p className="settings-msg err">{error}</p>}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <p style={{ fontSize: 13, color: "#888" }}>
            Webhooks позволяют получать HTTP уведомления о событиях в чате.
          </p>
          <button className="settings-save-btn" onClick={() => setCreating(true)} style={{ width: "auto", padding: "8px 16px" }}>
            + Создать
          </button>
        </div>

        {creating && (
          <div style={{
            background: "var(--card-bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 16,
            marginBottom: 16,
          }}>
            <h3 style={{ marginBottom: 12, fontSize: 15 }}>Новый webhook</h3>
            <label className="settings-label">Название</label>
            <input className="settings-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Мой webhook" style={{ marginBottom: 12 }} />

            <label className="settings-label">URL</label>
            <input className="settings-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hook" style={{ marginBottom: 12 }} />

            <label className="settings-label">Секрет (опционально)</label>
            <input className="settings-input" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="HMAC секрет для подписи" style={{ marginBottom: 12 }} />

            <label className="settings-label">События</label>
            <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
              {EVENT_OPTIONS.map((opt) => (
                <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={events.includes(opt.value)} onChange={() => toggleEvent(opt.value)} />
                  {opt.label}
                </label>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button className="settings-save-btn" onClick={handleCreate} disabled={saving || !name.trim() || !url.trim() || events.length === 0}>
                {saving ? "Сохранение..." : "Создать"}
              </button>
              <button className="avatar-btn" onClick={() => { setCreating(false); setName(""); setUrl(""); setSecret(""); setEvents(["message.new"]) }}>Отмена</button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="auth-loading"><div className="spinner" /></div>
        ) : webhooks.length === 0 ? (
          <p style={{ textAlign: "center", color: "#888", padding: 32 }}>У вас нет webhook'ов</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {webhooks.map((w) => (
              <div key={w.id} style={{
                background: "var(--card-bg)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "12px 16px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div>
                    <strong style={{ fontSize: 14 }}>{w.name}</strong>
                    <span style={{ fontSize: 12, color: "#888", marginLeft: 8 }}>{w.url}</span>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <label className="settings-toggle" style={{ margin: 0 }}>
                      <input type="checkbox" checked={w.is_active} onChange={() => handleToggleActive(w)} />
                      <span className="settings-toggle-slider" />
                    </label>
                    <button className="settings-action-btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => handleTest(w.id)} disabled={testing === w.id}>
                      {testing === w.id ? "..." : "Тест"}
                    </button>
                    <button className="settings-action-btn danger" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => handleDelete(w.id)}>
                      Удалить
                    </button>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {w.events.map((ev) => (
                    <span key={ev} style={{
                      fontSize: 11,
                      padding: "2px 8px",
                      borderRadius: 4,
                      background: "var(--accent)",
                      color: "#fff",
                      opacity: w.is_active ? 1 : 0.5,
                    }}>{EVENT_OPTIONS.find((o) => o.value === ev)?.label || ev}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
