/**
 * Encrypted refresh vault: ciphertext at rest, reload survival,
 * legacy plaintext migration, PIN interplay.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
})

describe("encrypted refresh at rest", () => {
  it("persists ciphertext, never plaintext", async () => {
    const { setSession, peekRefreshToken } = await import("../services/tokenVault")
    await setSession("a1", "refresh-SECRET-123")
    expect(peekRefreshToken()).toBe("refresh-SECRET-123")
    expect(localStorage.getItem("refresh_token")).toBeNull()
    expect(localStorage.getItem("token")).toBeNull()
    const cipher = localStorage.getItem("refresh_token_enc")
    expect(cipher).toMatch(/^v1\$/)
    expect(cipher).not.toContain("refresh-SECRET-123")
  })

  it("survives a reload via unlockVault", async () => {
    const v1 = await import("../services/tokenVault")
    await v1.setSession("a1", "reload-me")
    // Fresh module = dead memory, same disk (reload simulation).
    vi.resetModules()
    const v2 = await import("../services/tokenVault")
    expect(v2.peekRefreshToken()).toBeNull()
    await v2.unlockVault()
    expect(v2.peekRefreshToken()).toBe("reload-me")
    expect(v2.hasSession()).toBe(true)
  })

  it("migrates legacy plaintext refresh and deletes it", async () => {
    localStorage.setItem("refresh_token", "legacy-plaintext-jwt")
    const v = await import("../services/tokenVault")
    await v.unlockVault()
    expect(v.peekRefreshToken()).toBe("legacy-plaintext-jwt")
    expect(localStorage.getItem("refresh_token")).toBeNull()
    const cipher = localStorage.getItem("refresh_token_enc")
    expect(cipher).toMatch(/^v1\$/)
    expect(cipher).not.toContain("legacy-plaintext-jwt")
  })

  it("vaultReady settles even with nothing stored", async () => {
    const v = await import("../services/tokenVault")
    await expect(v.vaultReady).resolves.toBeUndefined()
    expect(v.peekRefreshToken()).toBeNull()
  })
})

describe("vault + PIN", () => {
  it("PIN-wrapped refresh needs the PIN after restart", async () => {
    const vault = await import("../services/tokenVault")
    const pin = await import("../services/pinLock")
    await vault.setSession("a1", "pin-bound-refresh")
    await pin.enablePin("1234")

    // Restart: memory dies, disk stays PIN-wrapped.
    vi.resetModules()
    const vault2 = await import("../services/tokenVault")
    const pin2 = await import("../services/pinLock")
    await vault2.unlockVault()
    expect(vault2.peekRefreshToken()).toBeNull()
    expect(pin2.isStorageLocked()).toBe(true)

    expect(await pin2.unlockWithPin("1234")).toBe(true)
    expect(vault2.peekRefreshToken()).toBe("pin-bound-refresh")
  })

  it("PIN change keeps the session readable", async () => {
    const vault = await import("../services/tokenVault")
    const pin = await import("../services/pinLock")
    await vault.setSession("a1", "change-me-refresh")
    await pin.enablePin("1111")
    expect(await pin.changePin("1111", "2222")).toBe(true)

    vi.resetModules()
    const vault2 = await import("../services/tokenVault")
    const pin2 = await import("../services/pinLock")
    await vault2.unlockVault()
    expect(vault2.peekRefreshToken()).toBeNull()
    expect(await pin2.unlockWithPin("2222")).toBe(true)
    expect(vault2.peekRefreshToken()).toBe("change-me-refresh")
  })
})
