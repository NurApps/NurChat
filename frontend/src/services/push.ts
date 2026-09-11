/**
 * Web Push subscription service for browser notifications.
 *
 * Registers a service worker, subscribes to Web Push via PushManager,
 * and sends the subscription to the server.
 *
 * Only works in browser mode (not Tauri — Tauri uses native notifications).
 */

import { api } from "./api"
import { getSettings } from "./userSettings"

function isTauri(): boolean {
  try {
    return !!(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  } catch {
    return false
  }
}

let swRegistration: ServiceWorkerRegistration | null = null

export async function initPushNotifications(): Promise<void> {
  if (isTauri()) return
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return
  if (!getSettings().desktopNotifications) return

  try {
    swRegistration = await navigator.serviceWorker.register("/sw.js", { scope: "/" })
    console.log("[Push] Service worker registered")

    swRegistration.addEventListener("updatefound", () => {
      const newWorker = swRegistration?.installing
      if (newWorker) {
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            newWorker.postMessage({ type: "SKIP_WAITING" })
          }
        })
      }
    })

    await subscribePush()
  } catch (e) {
    console.error("[Push] SW registration failed:", e)
  }
}

export async function subscribePush(): Promise<void> {
  if (isTauri()) return
  if (!swRegistration) return
  if (!getSettings().desktopNotifications) return

  try {
    const permission = await Notification.requestPermission()
    if (permission !== "granted") return

    const { public_key } = await api.getVapidPublicKey()

    const existingSub = await swRegistration.pushManager.getSubscription()
    if (existingSub) {
      // Check if key changed — resubscribe
      const p256dh = existingSub.toJSON().keys?.p256dh
      if (p256dh) {
        await sendSubscriptionToServer(existingSub)
        return
      }
    }

    const subscription = await swRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(public_key),
    })

    await sendSubscriptionToServer(subscription)
    console.log("[Push] Subscribed successfully")
  } catch (e) {
    console.error("[Push] Subscribe failed:", e)
  }
}

export async function unsubscribePush(): Promise<void> {
  if (isTauri()) return
  if (!swRegistration) return

  try {
    const subscription = await swRegistration.pushManager.getSubscription()
    if (!subscription) return

    await api.unsubscribePush(subscription.endpoint)
    await subscription.unsubscribe()
    console.log("[Push] Unsubscribed")
  } catch (e) {
    console.error("[Push] Unsubscribe failed:", e)
  }
}

async function sendSubscriptionToServer(subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON()
  if (!json.keys?.p256dh || !json.keys?.auth || !json.endpoint) return

  await api.subscribePush({
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
  })
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

// Listen for notification clicks from the service worker
if (typeof navigator !== "undefined" && navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "NOTIFICATION_CLICK" && event.data?.chatId) {
      window.location.hash = ""
      window.history.pushState({}, "", `/chat/${event.data.chatId}`)
      window.dispatchEvent(new PopStateEvent("popstate"))
    }
  })
}
