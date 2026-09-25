import { platform } from "./platform"
import { getSettings } from "./userSettings"
import { initPushNotifications } from "./push"

const messageAudio = new Audio(`${import.meta.env.BASE_URL}sounds/notify.ogg`)
const ringtoneAudio = new Audio(`${import.meta.env.BASE_URL}sounds/wave.ogg`)
ringtoneAudio.loop = true

function playAudio(audio: HTMLAudioElement): void {
  audio.currentTime = 0
  audio.play().catch(() => {})
}

export function playMessageSound(): void {
  if (!getSettings().messageSound) return
  playAudio(messageAudio)
}

/** Зацикленный рингтон входящего — остановить через stopCallRingtone. */
export function startCallRingtone(): void {
  if (!getSettings().callSound || !ringtoneAudio.paused) return
  ringtoneAudio.play().catch(() => {})
}

export function stopCallRingtone(): void {
  ringtoneAudio.pause()
  ringtoneAudio.currentTime = 0
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
