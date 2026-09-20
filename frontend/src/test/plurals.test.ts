import { describe, it, expect } from 'vitest'

// Locks Russian/English plural forms (LANGUAGE_PROBLEMS.md §3).
// i18next CLDR: ru → one/few/many, en → one/other.
describe('i18n plurals', () => {
  it('declines filesCount in Russian', async () => {
    const i18n = await import('../i18n')
    await i18n.default.changeLanguage('ru')
    const t = i18n.default.t
    expect(t('settings.filesCount', { count: 1 })).toBe('1 файл')
    expect(t('settings.filesCount', { count: 2 })).toBe('2 файла')
    expect(t('settings.filesCount', { count: 5 })).toBe('5 файлов')
    expect(t('settings.filesCount', { count: 21 })).toBe('21 файл')
  })

  it('declines filesCount in English', async () => {
    const i18n = await import('../i18n')
    await i18n.default.changeLanguage('en')
    const t = i18n.default.t
    expect(t('settings.filesCount', { count: 1 })).toBe('1 file')
    expect(t('settings.filesCount', { count: 5 })).toBe('5 files')
    await i18n.default.changeLanguage('ru')
  })

  it('declines group members in Russian', async () => {
    const i18n = await import('../i18n')
    await i18n.default.changeLanguage('ru')
    const t = i18n.default.t
    expect(t('group.members', { count: 1 })).toBe('1 участник')
    expect(t('group.members', { count: 3 })).toBe('3 участника')
    expect(t('group.members', { count: 7 })).toBe('7 участников')
  })

  it('declines syncing and wrongPin in Russian', async () => {
    const i18n = await import('../i18n')
    await i18n.default.changeLanguage('ru')
    const t = i18n.default.t
    expect(t('common.syncing', { count: 1 })).toBe('Синхронизация (1 сообщение)...')
    expect(t('common.syncing', { count: 5 })).toBe('Синхронизация (5 сообщений)...')
    expect(t('pinLock.wrongPin', { count: 1 })).toBe('Неверный PIN. Осталась 1 попытка')
    expect(t('pinLock.wrongPin', { count: 3 })).toBe('Неверный PIN. Осталось 3 попытки')
  })

  it('declines readByCount in Russian', async () => {
    const i18n = await import('../i18n')
    await i18n.default.changeLanguage('ru')
    const t = i18n.default.t
    expect(t('messageInfo.readByCount', { count: 1, total: 10 })).toBe('1 из 10 прочитал')
    expect(t('messageInfo.readByCount', { count: 5, total: 10 })).toBe('5 из 10 прочитали')
  })
})
