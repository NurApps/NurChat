/**
 * PIN-lock: gate hash (v2 PBKDF2 + legacy upgrade) and crypto wiring.
 *
 * Proves the PIN is a real wrapping-key secret, not a UI decoration:
 * enable → keystore unreadable without passphrase → unlock restores →
 * disable returns to unwrapped storage. Uses fake-indexeddb (setup.ts).
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

async function wipeIdb(): Promise<void> {
  // deleteDatabase hangs while older module instances still hold open
  // connections — clear stores instead (equivalent to fresh for tests).
  // Mirror secureStorage's schema init: a bare open() would pin an empty
  // v2 database WITHOUT stores and break every later getDB() upgrade.
  const { openDB } = await import("idb")
  const db = await openDB("nurchat-secure", 2, {
    upgrade(up) {
      for (const s of ["keys", "sessions", "meta"]) {
        if (!up.objectStoreNames.contains(s)) up.createObjectStore(s)
      }
    },
  })
  const tx = db.transaction(["keys", "sessions", "meta"], "readwrite")
  await Promise.all([
    tx.objectStore("keys").clear(),
    tx.objectStore("sessions").clear(),
    tx.objectStore("meta").clear(),
  ])
  await tx.done
  db.close()
}

async function legacyHash(pin: string): Promise<string> {
  const data = new TextEncoder().encode(pin + "nurchat_pin_salt")
  const digest = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  await wipeIdb()
})

describe("pin gate hash", () => {
  it("sets and verifies (v2 format)", async () => {
    const { setPin, verifyPin, isPinEnabled } = await import("../services/pinLock")
    expect(isPinEnabled()).toBe(false)
    await setPin("1234")
    expect(isPinEnabled()).toBe(true)
    expect(localStorage.getItem("pin_hash")).toMatch(/^v2\$/)
    expect(await verifyPin("1234")).toBe(true)
    expect(await verifyPin("0000")).toBe(false)
  })

  it("accepts legacy SHA-256 hash once and upgrades to v2", async () => {
    const { verifyPin } = await import("../services/pinLock")
    localStorage.setItem("pin_hash", await legacyHash("5678"))
    expect(await verifyPin("5678")).toBe(true)
    expect(localStorage.getItem("pin_hash")).toMatch(/^v2\$/)
    expect(await verifyPin("5678")).toBe(true)
    expect(await verifyPin("0000")).toBe(false)
  })

  it("rejects garbage stored hash", async () => {
    const { verifyPin } = await import("../services/pinLock")
    localStorage.setItem("pin_hash", "v2$broken")
    expect(await verifyPin("1234")).toBe(false)
  })
})

describe("pin crypto wiring", () => {
  it("enable → locked without passphrase → unlock restores", async () => {
    const pin = await import("../services/pinLock")
    const sec = await import("../services/secureStorage")
    await sec.storeSecureValue("probe", { secret: "s3cr3t" })
    await pin.enablePin("1234")

    // Simulate restart: drop memory, keep disk.
    pin.lockCrypto()
    expect(pin.isStorageLocked()).toBe(true)
    expect(await sec.loadSecureValue("probe")).toBeNull()

    expect(await pin.unlockWithPin("0000")).toBe(false)
    expect(pin.isStorageLocked()).toBe(true)
    expect(await pin.unlockWithPin("1234")).toBe(true)
    expect(pin.isStorageLocked()).toBe(false)
    expect(await sec.loadSecureValue("probe")).toEqual({ secret: "s3cr3t" })
  })

  it("failed rewrap leaves old data intact", async () => {
    const pin = await import("../services/pinLock")
    const sec = await import("../services/secureStorage")
    await sec.storeSecureValue("probe", { v: 1 })
    await pin.enablePin("1234")
    pin.lockCrypto()
    // Wrong current PIN for change: nothing happens, data still PIN-wrapped.
    expect(await pin.changePin("0000", "9999")).toBe(false)
    expect(await sec.loadSecureValue("probe")).toBeNull()
    expect(await pin.unlockWithPin("1234")).toBe(true)
    expect(await sec.loadSecureValue("probe")).toEqual({ v: 1 })
  })

  it("change and disable re-wrap both ways", async () => {
    const pin = await import("../services/pinLock")
    const sec = await import("../services/secureStorage")
    await sec.storeSecureValue("probe", { v: 2 })
    await pin.enablePin("1111")
    expect(await pin.changePin("1111", "2222")).toBe(true)
    pin.lockCrypto()
    expect(await pin.unlockWithPin("1111")).toBe(false)
    expect(await pin.unlockWithPin("2222")).toBe(true)
    expect(await sec.loadSecureValue("probe")).toEqual({ v: 2 })

    expect(await pin.disablePin("0000")).toBe(false)
    expect(await pin.disablePin("2222")).toBe(true)
    expect(pin.isStorageLocked()).toBe(false)
    pin.lockCrypto() // no passphrase involved anymore
    expect(await sec.loadSecureValue("probe")).toEqual({ v: 2 })
  })

  it("isStorageLocked is false without a PIN", async () => {
    const pin = await import("../services/pinLock")
    expect(pin.isStorageLocked()).toBe(false)
  })
})
