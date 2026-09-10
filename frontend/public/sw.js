/* NurChat Service Worker — Web Push + Background Notifications */

const CACHE_NAME = "nurchat-v1"

self.addEventListener("install", (event) => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Remove stale caches from previous versions
      const names = await caches.keys()
      await Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      )
      await clients.claim()
    })()
  )
})

// Handle push notifications
self.addEventListener("push", (event) => {
  if (!event.data) return

  let payload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: "NurChat", body: event.data.text() }
  }

  const title = payload.title || "NurChat"
  const options = {
    body: payload.body || "",
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    tag: payload.data?.chat_id || "nurchat",
    renotify: true,
    requireInteraction: false,
    data: payload.data || {},
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

// Handle notification click
self.addEventListener("notificationclick", (event) => {
  event.notification.close()

  const data = event.notification.data
  const chatId = data?.chat_id

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // If app window is already open, focus it
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          if (chatId) {
            client.postMessage({ type: "NOTIFICATION_CLICK", chatId })
          }
          return client.focus()
        }
      }
      // Otherwise open new window
      const url = chatId ? `/chat/${chatId}` : "/"
      return clients.openWindow(url)
    })
  )
})

// Handle messages from the main thread
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting()
  }
})
