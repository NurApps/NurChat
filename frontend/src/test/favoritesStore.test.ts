import { describe, it, expect, beforeEach } from "vitest"
import { useFavoritesStore } from "../store/favoritesStore"
import type { MessageResponse } from "../types"

function makeMessage(id: string, overrides: Partial<MessageResponse> = {}): MessageResponse {
  return {
    id,
    content: `text-${id}`,
    user_id: "u1",
    chat_id: "c1",
    message_type: "text",
    user: { id: "u1", username: "alice", first_name: "Alice" },
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
  useFavoritesStore.getState().clear()
})

describe("favoritesStore", () => {
  it("adds a text note", () => {
    useFavoritesStore.getState().addNote("купить молоко")
    const items = useFavoritesStore.getState().items
    expect(items).toHaveLength(1)
    expect(items[0].content).toBe("купить молоко")
    expect(items[0].forwardedFromName).toBeUndefined()
  })

  it("ignores empty/whitespace-only notes", () => {
    useFavoritesStore.getState().addNote("   ")
    expect(useFavoritesStore.getState().items).toHaveLength(0)
  })

  it("adds a forwarded message with sender name preserved", () => {
    useFavoritesStore.getState().addForwarded(makeMessage("m1"))
    const items = useFavoritesStore.getState().items
    expect(items).toHaveLength(1)
    expect(items[0].content).toBe("text-m1")
    expect(items[0].forwardedFromName).toBe("Alice")
  })

  it("appends multiple entries preserving order", () => {
    useFavoritesStore.getState().addNote("first")
    useFavoritesStore.getState().addForwarded(makeMessage("m1"))
    useFavoritesStore.getState().addNote("last")
    expect(useFavoritesStore.getState().items.map((i) => i.content)).toEqual(["first", "text-m1", "last"])
  })

  it("removes a single entry by id", () => {
    useFavoritesStore.getState().addNote("keep me")
    useFavoritesStore.getState().addNote("delete me")
    const toDelete = useFavoritesStore.getState().items[1].id
    useFavoritesStore.getState().remove(toDelete)
    expect(useFavoritesStore.getState().items.map((i) => i.content)).toEqual(["keep me"])
  })

  it("clear empties the list and persists the empty state", () => {
    useFavoritesStore.getState().addNote("a")
    useFavoritesStore.getState().addNote("b")
    useFavoritesStore.getState().clear()
    expect(useFavoritesStore.getState().items).toEqual([])
    expect(JSON.parse(localStorage.getItem("nurchat_favorites_v1") || "[]")).toEqual([])
  })

  it("persists across store reloads via localStorage", () => {
    useFavoritesStore.getState().addNote("persisted note")
    const raw = localStorage.getItem("nurchat_favorites_v1")
    expect(raw).toContain("persisted note")
  })
})
