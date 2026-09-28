import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import ProfilePage from "../pages/ProfilePage"
import { api } from "../services/api"

const baseUser = {
  id: "user_1", username: "alice", first_name: "Алиса", last_name: "Тестова",
  status: "в сети", bio: "о себе", avatar_path: null, created_at: "2026-01-01T00:00:00Z",
}

vi.mock("../services/api", async (orig) => {
  const actual = await orig<typeof import("../services/api")>()
  return {
    ...actual,
    api: { ...actual.api, getCurrentUser: vi.fn(), updateProfile: vi.fn() },
  }
})

const renderPage = () => render(<MemoryRouter><ProfilePage /></MemoryRouter>)

describe("ProfilePage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.getCurrentUser).mockResolvedValue(baseUser as never)
  })

  it("shows retry instead of redirecting when the profile fails to load", async () => {
    vi.mocked(api.getCurrentUser).mockRejectedValueOnce(new Error("net"))
    renderPage()
    expect(await screen.findByRole("alert")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Повторить" }))
    expect(await screen.findByText("Алиса")).toBeInTheDocument()
  })

  it("sends empty status and bio so they can be cleared", async () => {
    vi.mocked(api.updateProfile).mockResolvedValue({ ...baseUser, status: "", bio: "" } as never)
    renderPage()
    await userEvent.click(await screen.findByRole("button", { name: "Редактировать профиль" }))
    await userEvent.clear(screen.getByLabelText("Статус"))
    await userEvent.clear(screen.getByLabelText("О себе"))
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledWith({
      first_name: "Алиса", last_name: "Тестова", status: "", bio: "",
    }))
    expect(await screen.findByText("Сохранено")).toBeInTheDocument()
  })

  it("blocks saving a too-short first name and when nothing changed", async () => {
    renderPage()
    await userEvent.click(await screen.findByRole("button", { name: "Редактировать профиль" }))
    const save = screen.getByRole("button", { name: "Сохранить" })
    expect(save).toBeDisabled()
    const first = screen.getByLabelText("Имя")
    await userEvent.clear(first)
    await userEvent.type(first, "А")
    expect(save).toBeDisabled()
  })

  it("shows the server detail rather than raw JSON on save error", async () => {
    vi.mocked(api.updateProfile).mockRejectedValue(new Error(JSON.stringify({ detail: "Имя должно содержать минимум 2 символа" })))
    renderPage()
    await userEvent.click(await screen.findByRole("button", { name: "Редактировать профиль" }))
    await userEvent.type(screen.getByLabelText("Статус"), "!")
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    expect(await screen.findByText("Имя должно содержать минимум 2 символа")).toBeInTheDocument()
  })
})
