import { platform } from "./platform"
import { getSettings } from "./userSettings"
import { initPushNotifications } from "./push"

let audioCtx: AudioContext | null = null

function ensureAudioContext(): AudioContext | null {
  try {
    if (!audioCtx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      audioCtx = new Ctor()
    }
    if (audioCtx.state === "suspended") void audioCtx.resume()
    return audioCtx
  } catch {
    return null
  }
}

export function playMessageSound(): void {
  if (!getSettings().messageSound) return
  const ctx = ensureAudioContext()
  if (!ctx) return
  try {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = "sine"
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.12, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2)
    osc.connect(gain).connect(ctx.destination)
    osc.onended = () => {
      osc.disconnect()
      gain.disconnect()
    }
    osc.start()
    osc.stop(ctx.currentTime + 0.2)
  } catch {
    /* ignore audio errors */
  }
}

export async function initNotifications(): Promise<boolean> {
  const granted = await requestNotificationPermission()
  // Initialize Web Push in background (non-blocking)
  initPushNotifications().catch(() => {})
  return granted
}

export async function requestNotificationPermission(): Promise<boolean> {
  return platform.requestNotificationPermission()
}

export async function showNotification(title: string, body: string): Promise<void> {
  if (!getSettings().desktopNotifications) return
  await platform.showNotification(title, getSettings().messagePreview ? body : "…")
}
