import { useTranslation } from "react-i18next"
import { isMixedContentBlocked, parseRelayInput } from "../config"

type Protocol = "http" | "https"

interface Props {
  protocol: Protocol
  host: string
  onProtocolChange: (p: Protocol) => void
  onHostChange: (host: string) => void
  onSubmit?: () => void
  placeholder?: string
  autoFocus?: boolean
  /** Класс поля ввода — чтобы форма вписывалась в стиль экрана (login/settings). */
  inputClassName?: string
}

/**
 * Единое поле адреса релея: сегментный переключатель http/https + host[:port].
 * Вставка полного URL переключает протокол по его схеме, а не отрезает её молча.
 */
export default function RelayAddressInput({
  protocol, host, onProtocolChange, onHostChange, onSubmit, placeholder, autoFocus, inputClassName = "settings-input",
}: Props) {
  const { t } = useTranslation()

  const handleChange = (value: string) => {
    const parsed = parseRelayInput(value)
    if (parsed.protocol) {
      onProtocolChange(parsed.protocol)
      onHostChange(parsed.host)
    } else {
      onHostChange(value)
    }
  }

  return (
    <div className="relay-address">
      <div className="relay-address-row">
        <div className="relay-protocol-switch" role="radiogroup" aria-label={t("settings.relayProtocol")}>
          {(["https", "http"] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={protocol === p}
              className={`relay-protocol-option${protocol === p ? " active" : ""}`}
              onClick={() => onProtocolChange(p)}
            >
              {p}
            </button>
          ))}
        </div>
        <input
          className={`${inputClassName} relay-host-input`}
          placeholder={placeholder ?? "relay.example.com:8000"}
          value={host}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && onSubmit) onSubmit() }}
          autoFocus={autoFocus}
          aria-label={t("settings.relayHost")}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
      </div>
      {isMixedContentBlocked(protocol) && (
        <p className="relay-address-hint">{t("settings.relayMixedContent")}</p>
      )}
    </div>
  )
}
