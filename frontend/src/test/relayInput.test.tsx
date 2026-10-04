/**
 * Ручной ввод адреса релея: схема из вставленного URL переключает протокол,
 * а нерабочий адрес не сохраняется.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { useState } from "react"
import { render, screen, fireEvent } from "@testing-library/react"
import { parseRelayInput, applyRelayIfHealthy } from "../config"
import RelayAddressInput from "../components/RelayAddressInput"

describe("parseRelayInput", () => {
  it("голый host:port — протокол не трогаем", () => {
    expect(parseRelayInput("  10.0.0.5:8000 ")).toEqual({ host: "10.0.0.5:8000", protocol: null })
  })

  it("полный URL — схема отдельно, путь и слэши отрезаны", () => {
    expect(parseRelayInput("http://192.168.1.5:8000/health?x=1")).toEqual({ host: "192.168.1.5:8000", protocol: "http" })
    expect(parseRelayInput("HTTPS://relay.example.com/")).toEqual({ host: "relay.example.com", protocol: "https" })
  })

  it("пустой ввод", () => {
    expect(parseRelayInput("   ")).toEqual({ host: "", protocol: null })
  })
})

describe("applyRelayIfHealthy", () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.unstubAllGlobals())

  it("релей недоступен — ничего не сохраняет", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))
    const res = await applyRelayIfHealthy({ host: "dead.example.com", protocol: "https" })
    expect(res.ok).toBe(false)
    expect(localStorage.getItem("nurchat_relay_host")).toBeNull()
  })

  it("не-2xx — ничего не сохраняет", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 502 })))
    const res = await applyRelayIfHealthy({ host: "relay.example.com", protocol: "https" })
    expect(res).toEqual({ ok: false, status: 502 })
    expect(localStorage.getItem("nurchat_relay_host")).toBeNull()
  })

  it("релей жив — сохраняет host и протокол", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok", { status: 200 })))
    const res = await applyRelayIfHealthy({ host: "10.0.0.5:8000", protocol: "http" })
    expect(res.ok).toBe(true)
    expect(localStorage.getItem("nurchat_relay_host")).toBe("10.0.0.5:8000")
    expect(localStorage.getItem("nurchat_relay_protocol")).toBe("http")
  })
})

function Harness() {
  const [protocol, setProtocol] = useState<"http" | "https">("https")
  const [host, setHost] = useState("")
  return (
    <>
      <RelayAddressInput protocol={protocol} host={host} onProtocolChange={setProtocol} onHostChange={setHost} />
      <output data-testid="state">{`${protocol}|${host}`}</output>
    </>
  )
}

describe("RelayAddressInput", () => {
  it("вставка http:// URL переключает протокол вместо молчаливого отрезания", () => {
    render(<Harness />)
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "http://192.168.1.5:8000/" } })
    expect(screen.getByTestId("state").textContent).toBe("http|192.168.1.5:8000")
    expect(screen.getByRole("radio", { name: "http" })).toHaveAttribute("aria-checked", "true")
  })

  it("переключатель меняет протокол", () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole("radio", { name: "http" }))
    expect(screen.getByTestId("state").textContent).toBe("http|")
  })
})
