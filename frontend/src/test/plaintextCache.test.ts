import { describe, it, expect, beforeEach } from "vitest"
import { savePlaintext, getPlaintext, loadPlaintextCache } from "../services/plaintextCache"

beforeEach(() => {
  localStorage.clear()
})

describe("plaintextCache", () => {
  it("roundtrips own plaintext by message id", () => {
    savePlaintext("msg_1", "привет")
    expect(getPlaintext("msg_1")).toBe("привет")
  })

  it("returns null for unknown ids", () => {
    expect(getPlaintext("msg_nope")).toBeNull()
  })

  it("ignores empty id/text", () => {
    savePlaintext("", "x")
    savePlaintext("msg_2", "")
    expect(loadPlaintextCache()).toEqual({})
  })

  it("prunes oldest entries past the cap", () => {
    for (let i = 0; i < 2100; i++) savePlaintext(`msg_${i}`, `t${i}`)
    const cache = loadPlaintextCache()
    expect(Object.keys(cache).length).toBeLessThanOrEqual(2000)
    // newest survive
    expect(cache["msg_2099"]).toBe("t2099")
    // oldest evicted
    expect(cache["msg_0"]).toBeUndefined()
  })
})
