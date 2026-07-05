import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification"

let permissionGranted = false

export async function initNotifications() {
  try {
    permissionGranted = await isPermissionGranted()
    if (!permissionGranted) {
      const result = await requestPermission()
      permissionGranted = result === "granted"
    }
  } catch {
    // Tauri not available (dev mode / browser) — use browser Notification API
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission()
    }
  }
}

export function sendDesktopNotification(title: string, body: string, chatId?: string) {
  const doSend = () => {
    try {
      // Prefer Tauri plugin
      sendNotification({ title, body })
    } catch {
      // Fallback to browser API
      if ("Notification" in window && Notification.permission === "granted") {
        const n = new Notification(title, { body, icon: "/nurchat.png" })
        if (chatId) {
          n.onclick = () => {
            window.location.hash = `#/chat`
            n.close()
          }
        }
      }
    }
  }

  // Only notify if window is not focused
  if (!document.hasFocus()) {
    doSend()
  }
}
