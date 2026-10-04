import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useTheme } from "../context/useTheme"
import {
  CUSTOM_VAR_KEYS,
  DEFAULT_CUSTOM_VARS,
  type CustomVarKey,
  type CustomVariant,
  type ThemeVars,
} from "../services/customTheme"

/**
 * Редактор пользовательской палитры. Изменения сохраняются сразу
 * (WYSIWYG, если кастомный скин активен), «Сбросить» — возврат к стоку.
 */
export default function CustomThemeEditor({ variant }: { variant: CustomVariant }) {
  const { t } = useTranslation()
  const { customLight, customDark, setCustomTheme, resetCustomTheme } = useTheme()
  const saved = variant === "dark" ? customDark : customLight
  const [draft, setDraft] = useState<ThemeVars>(saved ?? DEFAULT_CUSTOM_VARS[variant])

  const current = saved ?? draft

  const onPick = (key: CustomVarKey, value: string) => {
    const next = { ...current, [key]: value }
    setDraft(next)
    setCustomTheme(variant, next)
  }

  const onReset = () => {
    resetCustomTheme(variant)
    setDraft(DEFAULT_CUSTOM_VARS[variant])
  }

  return (
    <div className="custom-theme-editor">
      {CUSTOM_VAR_KEYS.map((key) => (
        <label key={key} className="custom-theme-row">
          <span className="custom-theme-label">{t(`settings.themeVars.${key}`)}</span>
          <span className="custom-theme-picker">
            <input
              type="color"
              value={current[key]}
              onChange={(e) => onPick(key, e.target.value)}
              aria-label={t(`settings.themeVars.${key}`)}
            />
            <code>{current[key]}</code>
          </span>
        </label>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button type="button" className="settings-action-btn" onClick={onReset}>
          {t("settings.customThemeReset")}
        </button>
      </div>
    </div>
  )
}
