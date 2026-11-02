/**
 * Экран «Свой сервер» (инструкция) не должен закрываться сам: фоновый опрос
 * /health каждые 5 с раньше возвращал фазу "failed" поверх "setup".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import i18n from "i18next"

vi.mock("../components/HostModePanel", () => ({
  default: () => <div data-testid="host-panel" />,
}))

import ServerBootOverlay from "../components/ServerBootOverlay"

describe("ServerBootOverlay: экран инструкции", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("остаётся открытым, пока релей недоступен и идёт фоновый опрос", async () => {
    render(<ServerBootOverlay onReady={vi.fn()} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })

    fireEvent.click(screen.getByText(i18n.t("serverBoot.setupGuide")))
    expect(screen.getByTestId("host-panel")).toBeInTheDocument()

    // Несколько циклов опроса (интервал 5 с).
    await act(async () => { await vi.advanceTimersByTimeAsync(16000) })
    expect(screen.getByTestId("host-panel")).toBeInTheDocument()
    expect(screen.getByText(i18n.t("serverBoot.setupTitle"))).toBeInTheDocument()
  })

  it("кнопка «Назад» по-прежнему возвращает к выбору релея", async () => {
    render(<ServerBootOverlay onReady={vi.fn()} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })

    fireEvent.click(screen.getByText(i18n.t("serverBoot.setupGuide")))
    fireEvent.click(screen.getByText(i18n.t("serverBoot.back")))
    expect(screen.queryByTestId("host-panel")).not.toBeInTheDocument()
    expect(screen.getByText(i18n.t("serverBoot.retry"))).toBeInTheDocument()
  })
})
