import { platform } from "./platform"

interface UpdateInfo {
  has_update: boolean
  latest_version: string
  url: string
  body: string
}

export async function checkForUpdates(): Promise<UpdateInfo | null> {
  return platform.checkForUpdates()
}
