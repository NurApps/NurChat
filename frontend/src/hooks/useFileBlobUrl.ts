import { useEffect, useState } from "react"
import type { MessageResponse } from "../types"
import { loadKeys as loadE2EKeys } from "../services/e2e"

const EXT_MIME: Record<string, string> = {
  gif: "image/gif",
  png: "image/png",
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  opus: "audio/ogg",
}

function guessMime(message: MessageResponse): string {
  // Реальный тип — по расширению имени файла с сервера: раньше все image
  // типизировались как image/jpeg — гифки и webp отдавались с чужим MIME
  // (анимки/превью ломались там, где браузер не сниффит).
  const filename = message.file?.filename || ""
  const ext = filename.split(".").pop()?.toLowerCase() || ""
  if (ext && EXT_MIME[ext]) return EXT_MIME[ext]
  const mt = message.message_type
  if (mt === "image") return "image/jpeg"
  if (mt === "video") return "video/mp4"
  if (mt === "voice" || mt === "audio") return "audio/webm"
  return "application/octet-stream"
}

export function useFileBlobUrl(message: MessageResponse | null): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!message?.file_id) { setUrl(null); return }
    let cancelled = false
    let objectUrl: string | null = null

    async function load() {
      // Try E2E file decryption if envelope present
      let isEncryptedFile = false
      let fileEnvelope: { v: number; wrapped: Record<string, string>; senderPublicKey: string } | null = null
      if (message!.encrypted_content) {
        try {
          const parsed = JSON.parse(message!.encrypted_content)
          if (parsed?.file?.wrapped) {
            isEncryptedFile = true
            fileEnvelope = parsed.file
          }
        } catch {}
      }

      try {
        if (isEncryptedFile && fileEnvelope) {
          const myKeys = await loadE2EKeys()
          const currentUserId = (() => {
            try { return JSON.parse(localStorage.getItem("user") || "null")?.id as string } catch { return "" }
          })()
          const mySecret = myKeys?.privateKeyHex
          const senderPub = fileEnvelope.senderPublicKey || message!.user?.public_key || ""
          if (myKeys && mySecret && senderPub && currentUserId) {
            const { unwrapFileKey, decryptFileBytes } = await import("../services/fileE2E")
            // Find my wrapped key (try my id, fallback to any entry that decrypts)
            let fileKey: Uint8Array | null = null
            if (fileEnvelope.wrapped[currentUserId]) {
              fileKey = unwrapFileKey(fileEnvelope.wrapped[currentUserId], mySecret, senderPub)
            }
            if (!fileKey) {
              // Fallback: try all entries (sender may have used different id)
              for (const w of Object.values(fileEnvelope.wrapped)) {
                const k = unwrapFileKey(w, mySecret, senderPub)
                if (k) { fileKey = k; break }
              }
            }
            if (fileKey) {
              const { fetchFileBlob } = await import("../services/blobManager")
              const encBlob = await fetchFileBlob(message!.file_id!)
              const encBytes = new Uint8Array(await encBlob.arrayBuffer())
              const plain = decryptFileBytes(encBytes, fileKey)
              if (plain) {
                const mime = guessMime(message!)
                const blob = new Blob([plain as BlobPart], { type: mime })
                objectUrl = URL.createObjectURL(blob)
                if (!cancelled) setUrl(objectUrl)
                return
              }
            }
          }
        }
      } catch (e) {
        console.warn("[fileBlob] E2E decrypt failed, fallback to plain:", e)
      }

      // Fallback: plain fetch + blobManager cache
      try {
        const { getOrCreateBlobUrl } = await import("../services/blobManager")
        objectUrl = await getOrCreateBlobUrl(message!.file_id!)
        if (!cancelled) setUrl(objectUrl)
      } catch {
        // Last resort: direct token URL (leaks token in src but works for plain files)
        const token = localStorage.getItem("token") || ""
        const base = (await import("../config")).BASE_URL
        if (!cancelled) setUrl(`${base}/api/files/download/${encodeURIComponent(message!.file_id!)}?token=${encodeURIComponent(token)}`)
      }
    }

    load()
    return () => {
      cancelled = true
      if (objectUrl) {
        try { URL.revokeObjectURL(objectUrl) } catch {}
      }
    }
  }, [message?.file_id, message?.encrypted_content])

  return url
}
