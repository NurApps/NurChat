import type { UserResponse } from "../types"

type NameParts = Pick<UserResponse, "username" | "first_name" | "last_name">

/** Отображаемое имя: «Имя Фамилия», иначе username. Для поиска/упоминаний используется username. */
export function userDisplayName(user: Partial<NameParts> | null | undefined, fallback = ""): string {
  if (!user) return fallback
  return [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || user.username || fallback
}
