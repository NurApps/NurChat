import { describe, it, expect } from "vitest"
import { identiconData, identiconColors } from "../utils/identicon"

describe("identiconData", () => {
  it("детерминирован: один seed — один узор", () => {
    const a = identiconData("user_abc123")
    const b = identiconData("user_abc123")
    expect(b).toEqual(a)
    expect(a.cells).toHaveLength(15)
  })

  it("разные юзеры — разные иконки", () => {
    const a = identiconData("user_aaa")
    const b = identiconData("user_bbb")
    expect(b.hue !== a.hue || JSON.stringify(b.cells) !== JSON.stringify(a.cells)).toBe(true)
  })

  it("поле никогда не пустое", () => {
    for (const seed of ["", "?", "a", "user_x", "0", "group_1"]) {
      expect(identiconData(seed).cells.some(Boolean)).toBe(true)
    }
  })

  it("hue в диапазоне, цвета — валидные hsl", () => {
    const { hue } = identiconData("user_test")
    expect(hue).toBeGreaterThanOrEqual(0)
    expect(hue).toBeLessThan(360)
    const { fg, bg } = identiconColors(hue)
    expect(fg).toMatch(/^hsl\(\d+, 62%, 44%\)$/)
    expect(bg).toMatch(/^hsl\(\d+, 32%, 93%\)$/)
  })
})
