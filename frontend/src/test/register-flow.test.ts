import { describe, it, expect } from "vitest"
import { generateKeys, saveKeys, setupPreKeys, loadKeys } from "../services/e2e"
import { api } from "../services/api"

// Живой relay нужен только для этого файла — пропускаем, если он не запущен.
const relayUp = await fetch("http://127.0.0.1:8000/health").then(() => true).catch(() => false)

describe.skipIf(!relayUp)("registration flow (live relay)", () => {
  it("generateKeys -> register -> saveKeys -> setupPreKeys", async () => {
    const keys = await generateKeys()
    expect(keys.publicKeyHex).toHaveLength(64)
    expect(keys.signingPublicHex).toHaveLength(64)

    const cap = await api.getCaptcha()
    const nums = cap.question.match(/\d+/g)!.map(Number)
    let ans: number
    if (cap.question.includes("\u00d7") || cap.question.includes("x")) ans = nums[0] * nums[1]
    else if (cap.question.includes("-")) ans = nums[0] - nums[1]
    else ans = nums[0] + nums[1]

    const uname = `vitest_${Date.now()}`
    const reg = await api.register(
      uname, "TestPass123", "Vitest", "",
      cap.captcha_id, String(ans),
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
