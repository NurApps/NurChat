export type Runtime = "tauri" | "capacitor" | "web" | "unknown"

export interface UpdateInfo {
  has_update: boolean
  latest_version: string
  url: string
  body: string
}

const WEB_APP_VERSION = "0.16.2"

function detectRuntime(): Runtime {
  if (typeof window === "undefined") return "unknown"
  const win = window as unknown as Record<string, unknown>
  if (win.__TAURI_INTERNALS__) return "tauri"
  if (win.Capacitor) return "capacitor"
  return "web"
}

async function importTauriInvoke() {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke
}

export class Platform {
  readonly runtime: Runtime = detectRuntime()
  readonly isTauri = this.runtime === "tauri"
  readonly isCapacitor = this.runtime === "capacitor"
  readonly isWeb = this.runtime === "web"

  async invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    if (!this.isTauri) {
      throw new Error(`Command "${cmd}" is not available on ${this.runtime}`)
    }
    const tauriInvoke = await importTauriInvoke()
    return tauriInvoke<T>(cmd, args)
  }

  async showMainWindow(): Promise<void> {
    if (!this.isTauri) return
    await this.invoke("show_main_window").catch(() => {})
  }

  async minimizeToTray(): Promise<void> {
    if (!this.isTauri) return
    await this.invoke("minimize_to_tray").catch(() => {})
  }

  async shareInvite(uri: string): Promise<void> {
    if (typeof navigator !== "undefined" && navigator.share) {
      await navigator.share({ text: uri })
      return
    }
    await navigator.clipboard.writeText(uri)
  }

  async getAppVersion(): Promise<string> {
    if (this.isTauri) {
      try {
        const { getVersion } = await import("@tauri-apps/api/app")
        return await getVersion()
      } catch {
        return WEB_APP_VERSION
      }
    }
    return WEB_APP_VERSION
  }

  async openExternal(url: string): Promise<void> {
    if (!/^(https?:|mailto:)/i.test(url.trim())) return
    if (this.isTauri) {
      try {
        await this.invoke("open_external", { url })
        return
      } catch {
        /* fall through to window.open */
      }
    }
    window.open(url, "_blank", "noopener")
  }

  async requestNotificationPermission(): Promise<boolean> {
    if (this.isTauri) {
      try {
        const { isPermissionGranted, requestPermission } = await import("@tauri-apps/plugin-notification")
        let granted = await isPermissionGranted()
        if (!granted) {
          const permission = await requestPermission()
          granted = permission === "granted"
        }
        return granted
      } catch {
        return false
      }
    }
    if (!("Notification" in window)) return false
    if (Notification.permission === "granted") return true
    if (Notification.permission === "denied") return false
    try {
      const permission = await Notification.requestPermission()
      return permission === "granted"
    } catch {
      return false
    }
  }

  async showNotification(title: string, body: string): Promise<void> {
    if (this.isTauri) {
      try {
        const { sendNotification } = await import("@tauri-apps/plugin-notification")
        sendNotification({ title, body })
      } catch {
        /* ignore */
      }
      return
    }
    if (!("Notification" in window) || Notification.permission !== "granted") return
    try {
      new Notification(title, { body })
    } catch {
      /* ignore */
    }
  }

  async checkForUpdates(): Promise<UpdateInfo | null> {
    if (!this.isTauri) return null
    try {
      const currentVersion = await this.getAppVersion()
      return await this.invoke<UpdateInfo>("check_update", { currentVersion })
    } catch {
      return null
    }
  }

  async relaunchApp(): Promise<void> {
    if (!this.isTauri) return
    const { relaunch } = await import("@tauri-apps/plugin-process")
    await relaunch()
  }
}

export const platform = new Platform()
