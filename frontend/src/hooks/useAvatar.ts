import { useState, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { BASE_URL } from "../config"
import { csrfHeader } from "../services/api"
import type { UserResponse } from "../types"

export function useAvatar(onUserUpdate?: (user: UserResponse) => void) {
  const { t } = useTranslation()
  const [uploading, setUploading] = useState(false)
  const [msg, _setMsg] = useState("")
  const [msgKind, setMsgKind] = useState<"ok" | "err" | "">("")

  // Direct setMsg calls (settings flows) reset kind to neutral — the page
  // falls back to its legacy rule. Avatar flows use setOk/setErr instead.
  const setMsg = (m: string) => { _setMsg(m); setMsgKind("") }
  const setOk = (m: string) => { _setMsg(m); setMsgKind("ok") }
  const setErr = (m: string) => { _setMsg(m); setMsgKind("err") }

  const uploadAvatar = useCallback(async (file: File) => {
    setUploading(true)
    setMsg("")
    setMsgKind("")
    try {
      const token = localStorage.getItem("token")
      const form = new FormData()
      form.append("file", file)
      const res = await fetch(`${BASE_URL}/api/auth/profile/avatar`, {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(csrfHeader() ? { "X-CSRF-Token": csrfHeader()! } : {}),
        },
        body: form,
      })
      if (!res.ok) throw new Error(await res.text())
      const updated: UserResponse = await res.json()
      localStorage.setItem("user", JSON.stringify(updated))
      onUserUpdate?.(updated)
      setOk(t("profile.avatarUpdated"))
    } catch (e: any) {
      setErr(e.message || t("profile.avatarUploadError"))
    } finally {
      setUploading(false)
    }
  }, [onUserUpdate, t])

  const deleteAvatar = useCallback(async () => {
    setUploading(true)
    setMsg("")
    setMsgKind("")
    try {
      const token = localStorage.getItem("token")
      const res = await fetch(`${BASE_URL}/api/auth/profile/avatar`, {
        method: "DELETE",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(csrfHeader() ? { "X-CSRF-Token": csrfHeader()! } : {}),
        },
      })
      if (!res.ok) throw new Error(await res.text())
      const updated: UserResponse = await res.json()
      localStorage.setItem("user", JSON.stringify(updated))
      onUserUpdate?.(updated)
      setOk(t("profile.avatarDeleted"))
    } catch (e: any) {
      setErr(e.message || t("profile.avatarDeleteError"))
    } finally {
      setUploading(false)
    }
  }, [onUserUpdate, t])

  return { uploading, msg, msgKind, setMsg, uploadAvatar, deleteAvatar }
}
