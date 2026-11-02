import { platform } from "./platform"
import { getSettings, type MessageSoundId, type RingtoneId } from "./userSettings"
import { initPushNotifications } from "./push"

const MESSAGE_FILES: Partial<Record<MessageSoundId, string>> = { notify: "sounds/notify.ogg" }
const RINGTONE_FILES: Record<RingtoneId, string> = { wave: "sounds/wave.ogg", nokia: "sounds/nokia.ogg" }

// Короткие звуки сообщений без файлов: [частота Гц, старт с, длительность с].
const MESSAGE_TONES: Partial<Record<MessageSoundId, [number, number, number][]>> = {
  pop: [[880, 0, 0.09], [1320, 0.07, 0.12]],
  chime: [[1046, 0, 0.18], [1568, 0.14, 0.32]],
}

const audioCache = new Map<string, HTMLAudioElement>()
function getAudio(path: string, loop = false): HTMLAudioElement {
  let a = audioCache.get(path)
  if (!a) {
    a = new Audio(`${import.meta.env.BASE_URL}${path}`)
    a.loop = loop
    audioCache.set(path, a)
  }
  return a
}

let audioCtx: AudioContext | null = null
function playTones(notes: [number, number, number][]): void {
  try {
    audioCtx ??= new AudioContext()
    const ctx = audioCtx
    void ctx.resume()
    const t0 = ctx.currentTime
    for (const [freq, start, dur] of notes) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = "sine"
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t0 + start)
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + start + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t0 + start)
      osc.stop(t0 + start + dur + 0.02)
    }
  } catch { /* AudioContext недоступен — тихо пропускаем */ }
}

function playMessageSoundById(id: MessageSoundId): void {
  const tones = MESSAGE_TONES[id]
  if (tones) { playTones(tones); return }
  const a = getAudio(MESSAGE_FILES[id] ?? MESSAGE_FILES.notify!)
  a.currentTime = 0
  a.play().catch(() => {})
}

export function playMessageSound(): void {
  const s = getSettings()
  if (!s.messageSound) return
  playMessageSoundById(s.messageSoundId)
}

/** Прослушивание выбранного звука в настройках — работает и при выключенном переключателе. */
export function previewMessageSound(id: MessageSoundId): void {
  playMessageSoundById(id)
}

let activeRingtone: HTMLAudioElement | null = null

function playRingtoneById(id: RingtoneId): void {
  stopCallRingtone()
  const a = getAudio(RINGTONE_FILES[id], true)
  activeRingtone = a
  a.play().catch(() => {})
}

/** Зацикленный рингтон входящего — остановить через stopCallRingtone. */
export function startCallRingtone(): void {
  const s = getSettings()
  if (!s.callSound || (activeRingtone && !activeRingtone.paused)) return
  playRingtoneById(s.ringtoneId)
}

/** Прослушивание рингтона в настройках: играет до stopCallRingtone. */
export function previewRingtone(id: RingtoneId): void {
  playRingtoneById(id)
}

export function stopCallRingtone(): void {
  if (!activeRingtone) return
  activeRingtone.pause()
  activeRingtone.currentTime = 0
  activeRingtone = null
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
