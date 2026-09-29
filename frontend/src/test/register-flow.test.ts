import { describe, it, expect } from "vitest"
import { generateKeys, saveKeys, setupPreKeys, loadKeys } from "../services/e2e"
import { api } from "../services/api"

// Живой relay нужен только для этого файла — пропускаем, если он не запущен.
// Relay проверяет настоящий одноразовый Turnstile-токен, из Node его не получить:
// передайте свежий токен в NURCHAT_TURNSTILE_TOKEN, иначе тест пропускается.
const relayUp = await fetch("http://127.0.0.1:8000/health").then(() => true).catch(() => false)
const turnstileToken = process.env.NURCHAT_TURNSTILE_TOKEN ?? ""

describe.skipIf(!relayUp || !turnstileToken)("registration flow (live relay)", () => {
  it("generateKeys -> register -> saveKeys -> setupPreKeys", async () => {
    const keys = await generateKeys()
    expect(keys.publicKeyHex).toHaveLength(64)
    expect(keys.signingPublicHex).toHaveLength(64)

    const uname = `vitest_${Date.now()}`
    const reg = await api.register(
      uname, "TestPass123", "Vitest", "",
      turnstileToken,
      keys.publicKeyHex, keys.signingPublicHex,
    )
    expect(reg.access_token).toBeTruthy()
    api.setToken(reg.access_token)

    await saveKeys(keys)
    const loaded = await loadKeys()
    expect(loaded?.publicKeyHex).toBe(keys.publicKeyHex)

    await setupPreKeys(keys) // must not throw

    const bundle = await api.getBundle(reg.user.id)
    expect(bundle.identity_key).toBeTruthy()
  }, 30000)
})
