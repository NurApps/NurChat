export type Runtime = "tauri" | "capacitor" | "web" | "unknown"

export interface P2PPeerInfo {
  peer_id: string
  public_key: string
  address: string
  port: number
}

export interface UpdateInfo {
  has_update: boolean
  latest_version: string
  url: string
  body: string
}

const WEB_APP_VERSION = "0.15.0"

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

  readonly supportsP2PHost = this.isTauri

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

  async downloadAndOpenFile(url: string, token: string, filename: string): Promise<void> {
    if (this.isTauri) {
      await this.invoke("download_and_open_file", { url, token, filename })
      return
    }
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error("Download failed")
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = objectUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(objectUrl)
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
    if (this.isTauri) {
      const { open } = await import("@tauri-apps/plugin-shell")
      await open(url)
      return
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

  async initP2P(listenPort?: number): Promise<number | null> {
    if (!this.supportsP2PHost) return null
    try {
      return await this.invoke<number>("init_p2p", { listen_port: listenPort })
    } catch (e) {
      console.error("P2P init failed:", e)
      return null
    }
  }

  async getP2PPeers(): Promise<P2PPeerInfo[]> {
    if (!this.supportsP2PHost) return []
    try {
      return await this.invoke<P2PPeerInfo[]>("p2p_get_peers")
    } catch (e) {
      console.error("P2P get peers failed:", e)
      return []
    }
  }

  async getP2PPeerCount(): Promise<number> {
    if (!this.supportsP2PHost) return 0
    try {
      return await this.invoke<number>("p2p_get_peer_count")
    } catch (e) {
      console.error("P2P get peer count failed:", e)
      return 0
    }
  }
}

export const platform = new Platform()
