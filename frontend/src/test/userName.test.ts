import { describe, expect, it } from "vitest"
import { userDisplayName } from "../utils/userName"

describe("userDisplayName", () => {
  it("имя и фамилия", () => {
    expect(userDisplayName({ username: "u", first_name: "Анна", last_name: "Петрова" })).toBe("Анна Петрова")
  })
  it("только имя", () => {
    expect(userDisplayName({ username: "u", first_name: "Анна" })).toBe("Анна")
  })
  it("без имени — username", () => {
    expect(userDisplayName({ username: "u", first_name: "" })).toBe("u")
  })
  it("нет пользователя — fallback", () => {
    expect(userDisplayName(undefined, "User")).toBe("User")
  })
})
