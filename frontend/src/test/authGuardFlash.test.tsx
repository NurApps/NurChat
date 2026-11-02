/**
 * AuthGuard: повторное монтирование (переход на другой маршрут) не должно
 * заново ждать сетевой getCurrentUser() под полноэкранным спиннером — это
 * давало 0,5–1 с белого экрана при каждом открытии настроек.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, act } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

let resolveUser: (u: unknown) => void = () => {}
const getCurrentUser = vi.fn(
  () => new Promise((resolve) => { resolveUser = resolve }),
)

vi.mock("../services/api", () => ({ api: { getCurrentUser: () => getCurrentUser() } }))
vi.mock("../services/tokenVault", () => ({
  hasSession: () => true,
  vaultReady: Promise.resolve(),
  writeStoredUserRaw: vi.fn(),
}))
vi.mock("../services/pinLock", () => ({ isPinEnabled: () => false }))
vi.mock("../services/e2e", () => ({ initSecureStorage: vi.fn() }))
vi.mock("../services/localSession", () => ({ performLogout: vi.fn() }))
vi.mock("../store/chatStore", () => ({
  useChatStore: { getState: () => ({ refreshCurrentUser: vi.fn() }) },
}))
vi.mock("../components/PinLock", () => ({ default: () => null }))

import AuthGuard from "../components/AuthGuard"

const mount = () => render(
  <MemoryRouter>
    <AuthGuard><div data-testid="page">страница</div></AuthGuard>
  </MemoryRouter>,
)

describe("AuthGuard: белый экран при переходе между маршрутами", () => {
  beforeEach(() => { getCurrentUser.mockClear() })

  it("первый вход ждёт проверку сессии, повторный — показывает страницу сразу", async () => {
    // Первый запуск: страницы нет, пока сервер не ответил.
    const first = mount()
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByTestId("page")).not.toBeInTheDocument()
    await act(async () => { resolveUser({ id: "u1", username: "alice" }) })
    await waitFor(() => expect(screen.getByTestId("page")).toBeInTheDocument())
    first.unmount()

    // Переход на другой маршрут: новый AuthGuard, ответа сервера ещё нет —
    // но страница уже на экране, а не спиннер.
    mount()
    expect(screen.getByTestId("page")).toBeInTheDocument()
    expect(document.querySelector(".auth-loading")).toBeNull()

    // Проверка при этом всё равно идёт (в фоне).
    await act(async () => { await Promise.resolve() })
    expect(getCurrentUser).toHaveBeenCalledTimes(2)
  })
})
