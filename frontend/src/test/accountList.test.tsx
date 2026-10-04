import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import AccountList from "../components/AccountList"
import * as actions from "../services/accountActions"
import type { AccountProfile } from "../services/profiles"

const mk = (id: string, username: string, host = "relay.test"): AccountProfile => ({
  id, relayHost: host, relayProtocol: "https", userId: `u_${id}`, username, createdAt: 1, lastUsedAt: 1,
})
const a = mk("legacy", "alice")
const b = mk("https://relay.test::u_b", "bob")

vi.mock("../services/accountActions", () => ({
  loadAccounts: vi.fn(),
  switchToProfile: vi.fn(),
  startAddAccount: vi.fn(),
}))

const renderList = (props: Partial<React.ComponentProps<typeof AccountList>> = {}) =>
  render(<MemoryRouter><AccountList variant="settings" {...props} /></MemoryRouter>)

describe("AccountList", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(actions.loadAccounts).mockReturnValue({ profiles: [a, b], activeId: a.id })
  })

  it("marks the active account and hides the relay host when all share one relay", () => {
    renderList()
    expect(screen.getByRole("button", { name: /@alice/ })).toHaveAttribute("aria-current", "true")
    expect(screen.queryByText(/relay\.test/)).not.toBeInTheDocument()
  })

  it("shows the relay host when accounts live on different relays", () => {
    vi.mocked(actions.loadAccounts).mockReturnValue({ profiles: [a, mk("x", "bob", "other.test")], activeId: a.id })
    renderList()
    expect(screen.getByText("https://other.test")).toBeInTheDocument()
  })

  it("switches only to an inactive account", async () => {
    renderList()
    await userEvent.click(screen.getByRole("button", { name: /@alice/ }))
    expect(actions.switchToProfile).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole("button", { name: /@bob/ }))
    expect(actions.switchToProfile).toHaveBeenCalledWith(b)
  })

  it("asks for confirmation before adding an account", async () => {
    renderList()
    await userEvent.click(screen.getByRole("button", { name: "Добавить аккаунт" }))
    expect(actions.startAddAccount).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole("button", { name: "Добавить" }))
    expect(actions.startAddAccount).toHaveBeenCalled()
  })

  it("removes an account through the ⋯ menu after confirmation", async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined)
    renderList({ onRemove })
    await userEvent.click(screen.getAllByRole("button", { name: "Действия с аккаунтом" })[1])
    await userEvent.click(screen.getByRole("button", { name: "Убрать" }))
    expect(onRemove).not.toHaveBeenCalled()
    const dialog = screen.getByRole("dialog")
    await userEvent.click(Array.from(dialog.querySelectorAll("button")).find((x) => x.textContent === "Убрать")!)
    expect(onRemove).toHaveBeenCalledWith(b)
  })
})
