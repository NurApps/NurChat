import { useState, useCallback } from "react"
import { BASE_URL } from "../config"
import type { UserResponse } from "../types"

export function useAvatar(onUserUpdate?: (user: UserResponse) => void) {
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg] = useState("")

  const uploadAvatar = useCallback(async (file: File) => {
    setUploading(true)
    setMsg("")
    try {
      const token = localStorage.getItem("token")
      const form = new FormData()
      form.append("file", file)
      const res = await fetch(`${BASE_URL}/api/auth/profile/avatar`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      })
      if (!res.ok) throw new Error(await res.text())
      const updated: UserResponse = await res.json()
      localStorage.setItem("user", JSON.stringify(updated))
      onUserUpdate?.(updated)
      setMsg("Аватар обновлён")
    } catch (e: any) {
      setMsg(e.message || "Ошибка загрузки")
    } finally {
      setUploading(false)
    }
  }, [onUserUpdate])

  const deleteAvatar = useCallback(async () => {
    setUploading(true)
    setMsg("")
    try {
      const token = localStorage.getItem("token")
      const res = await fetch(`${BASE_URL}/api/auth/profile/avatar`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error(await res.text())
      const updated: UserResponse = await res.json()
      localStorage.setItem("user", JSON.stringify(updated))
      onUserUpdate?.(updated)
      setMsg("Аватар удалён")
    } catch (e: any) {
      setMsg(e.message || "Ошибка удаления")
    } finally {
      setUploading(false)
    }
  }, [onUserUpdate])

  return { uploading, msg, setMsg, uploadAvatar, deleteAvatar }
}
