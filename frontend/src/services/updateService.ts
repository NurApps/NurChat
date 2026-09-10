import { invoke } from "@tauri-apps/api/core"
import { getVersion } from "@tauri-apps/api/app"

import { platform } from "./platform"

interface UpdateInfo {
  has_update: boolean
  latest_version: string
  url: string
  body: string
}

export async function checkForUpdates(): Promise<UpdateInfo | null> {
  try {
    const currentVersion = await getVersion()
    const result = await invoke<UpdateInfo>("check_update", {
      currentVersion,
    })
    return result
  } catch {
    return null
  }

  return platform.checkForUpdates()
}
