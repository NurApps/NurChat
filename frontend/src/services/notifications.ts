import { platform } from "./platform"

export async function initNotifications(): Promise<boolean> {
  return requestNotificationPermission()
}

export async function requestNotificationPermission(): Promise<boolean> {
  return platform.requestNotificationPermission()
}

export async function showNotification(title: string, body: string): Promise<void> {
  await platform.showNotification(title, body)
}
