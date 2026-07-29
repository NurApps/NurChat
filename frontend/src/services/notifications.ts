let initialized = false

export async function initNotifications(): Promise<boolean> {
  return requestNotificationPermission()
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (initialized) return true
  try {
    const { isPermissionGranted, requestPermission, sendNotification } = await import("@tauri-apps/plugin-notification")
    let granted = await isPermissionGranted()
    if (!granted) {
      const permission = await requestPermission()
      granted = permission === "granted"
    }
    initialized = granted
    return granted
  } catch {
    return false
  }
}

export async function showNotification(title: string, body: string): Promise<void> {
  try {
    const { sendNotification, isPermissionGranted } = await import("@tauri-apps/plugin-notification")
    const granted = await isPermissionGranted()
    if (granted) {
      sendNotification({ title, body })
    }
  } catch {
  }
}
