/**
 * ?relay= — ссылка-приглашение ставит релей вместо молчаливого localhost.
 * Чистая функция parseRelayParam: мусор отклоняем, http — только LAN.
 */
import { describe, it, expect } from "vitest"
import { parseRelayParam } from "../config"

describe("parseRelayParam", () => {
  it("голый host", () => {
    expect(parseRelayParam("?relay=relay.example.com")).toEqual({
      host: "relay.example.com",
      protocol: "https",
    })
  })

  it("полный URL с портом и путём", () => {
    expect(parseRelayParam("?relay=https://abc-123.trycloudflare.com:8000/health?x=1")).toEqual({
      host: "abc-123.trycloudflare.com:8000",
      protocol: "https",
    })
  })

  it("пара relayHost + relayProtocol", () => {
    expect(parseRelayParam("?relayHost=10.0.0.5:8000&relayProtocol=http")).toEqual({
      host: "10.0.0.5:8000",
      protocol: "http",
    })
  })

  it("публичный хост насильно на https", () => {
    expect(parseRelayParam("?relay=http://evil.example.com")).toEqual({
      host: "evil.example.com",
      protocol: "https",
    })
    expect(parseRelayParam("?relayHost=evil.example.com&relayProtocol=http")).toEqual({
      host: "evil.example.com",
      protocol: "https",
    })
  })

  it("loopback/LAN на http можно", () => {
    expect(parseRelayParam("?relay=http://127.0.0.1:8000"))?.toMatchObject({ protocol: "http" })
    expect(parseRelayParam("?relayHost=192.168.1.10&relayProtocol=http"))?.toMatchObject({ protocol: "http" })
  })

  it("мусор отклоняется", () => {
    expect(parseRelayParam("")).toBeNull()
    expect(parseRelayParam("?foo=1")).toBeNull()
    expect(parseRelayParam("?relay=")).toBeNull()
    expect(parseRelayParam("?relay=user:pass@host.com")).toBeNull()
    expect(parseRelayParam("?relay=ftp://host.com")).toBeNull()
    expect(parseRelayParam("?relay=host com")).toBeNull()
    expect(parseRelayParam("?relay=javascript:alert(1)")).toBeNull()
  })
})
