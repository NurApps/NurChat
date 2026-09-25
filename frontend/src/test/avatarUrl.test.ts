/**
 * avatarUrl(): только серверная форма media/avatars/<uid>/avatar_<ts>.<ext>
 * получает URL. Всё остальное (схемы, .., кавычки, чужие пути) — null,
 * вместо картинки рисуется буквенный аватар. Закрывает CodeQL
 * js/xss-through-dom на <img src={avatarUrl(...)}>: javascript:-схема
 * в src невозможна по построению.
 */
import { describe, it, expect } from "vitest"
import { avatarUrl } from "../config"

describe("avatarUrl", () => {
  it("пусто → null", () => {
    expect(avatarUrl(null)).toBeNull()
    expect(avatarUrl(undefined)).toBeNull()
    expect(avatarUrl("")).toBeNull()
  })

  it("серверная форма → URL", () => {
    const url = avatarUrl("media/avatars/user_abc123/avatar_1727251200.png")
    expect(url).toContain("/media/avatars/user_abc123/avatar_1727251200.png")
  })

  it("мусор отклоняется", () => {
    expect(avatarUrl("javascript:alert(1)")).toBeNull()
    expect(avatarUrl("https://evil.example.com/x.png")).toBeNull()
    expect(avatarUrl("media/avatars/x/../../.env")).toBeNull()
    expect(avatarUrl('media/avatars/x/avatar_1.png" onerror="alert(1)')).toBeNull()
    expect(avatarUrl("media/other/file.png")).toBeNull()
    expect(avatarUrl("media/avatars/x/avatar_1.exe")).toBeNull()
  })
})
