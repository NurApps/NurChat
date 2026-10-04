import { describe, it, expect, beforeEach } from 'vitest'
import {
  CUSTOM_VAR_KEYS,
  DEFAULT_CUSTOM_VARS,
  applyCustomTheme,
  clearCustomTheme,
  customSkinVariant,
  isCustomSkinId,
  isHexColor,
  isLightColor,
  loadCustomTheme,
  resetCustomThemeStorage,
  saveCustomTheme,
} from '../services/customTheme'

beforeEach(() => {
  localStorage.clear()
  clearCustomTheme()
})

describe('customTheme', () => {
  it('validates hex colors strictly', () => {
    expect(isHexColor('#0e7cb4')).toBe(true)
    expect(isHexColor('#0E7CB4')).toBe(true)
    expect(isHexColor('0e7cb4')).toBe(false)
    expect(isHexColor('#fff')).toBe(false)
    expect(isHexColor('#gggggg')).toBe(false)
    expect(isHexColor(null)).toBe(false)
  })

  it('recognizes custom skin ids', () => {
    expect(isCustomSkinId('custom-light')).toBe(true)
    expect(isCustomSkinId('custom-dark')).toBe(true)
    expect(isCustomSkinId('dark')).toBe(false)
    expect(customSkinVariant('custom-dark')).toBe('dark')
    expect(customSkinVariant('custom-light')).toBe('light')
  })

  it('round-trips through localStorage, rejects garbage', () => {
    expect(loadCustomTheme('dark')).toBeNull()
    saveCustomTheme('dark', { ...DEFAULT_CUSTOM_VARS.dark, accent: '#ff0000' })
    const loaded = loadCustomTheme('dark')
    expect(loaded?.accent).toBe('#ff0000')
    localStorage.setItem('theme-custom-dark', 'not json')
    expect(loadCustomTheme('dark')).toBeNull()
    localStorage.setItem('theme-custom-dark', JSON.stringify({ accent: 'red' }))
    expect(loadCustomTheme('dark')).toBeNull()
    resetCustomThemeStorage('dark')
    expect(loadCustomTheme('dark')).toBeNull()
  })

  it('matches stock on-* pairs (contrast sanity)', () => {
    // Светлая стоковая: белый текст на тёмно-синем акценте.
    expect(isLightColor('#0e7cb4')).toBe(false)
    // Тёмная стоковая: тёмный текст на ярком акценте.
    expect(isLightColor('#2aabee')).toBe(true)
  })

  it('applies vars inline and clears them fully', () => {
    applyCustomTheme(DEFAULT_CUSTOM_VARS.light, 'light')
    const style = document.documentElement.style
    expect(style.getPropertyValue('--accent')).toBe(DEFAULT_CUSTOM_VARS.light.accent)
    expect(style.getPropertyValue('--tg-blue')).toBe(DEFAULT_CUSTOM_VARS.light.accent)
    expect(style.getPropertyValue('--accent-rgb')).toBe('14, 124, 180')
    expect(style.getPropertyValue('--on-accent')).toBe('#ffffff')
    clearCustomTheme()
    for (const key of CUSTOM_VAR_KEYS) {
      expect(style.getPropertyValue(`--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`)).toBe('')
    }
    expect(style.getPropertyValue('--accent-rgb')).toBe('')
  })
})
