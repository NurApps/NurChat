import { describe, it, expect, beforeEach } from 'vitest'
import {
  LEGACY_PROFILE_ID,
  activeNamespace,
  ensureActiveProfile,
  getActiveProfile,
  listProfiles,
  namespaceOf,
  namespacedLSKey,
  profileId,
  removeProfile,
  setActiveProfileId,
  upsertProfile,
} from '../services/profiles'

beforeEach(() => {
  localStorage.clear()
})

describe('profiles', () => {
  it('creates a legacy profile first, namespaced ones after', () => {
    const a = upsertProfile('http', '127.0.0.1:8000', 'user_1', 'alice')
    expect(a.id).toBe(LEGACY_PROFILE_ID)
    expect(getActiveProfile()?.id).toBe(LEGACY_PROFILE_ID)
    const b = upsertProfile('https', 'relay.example.com', 'user_9', 'bob')
    expect(b.id).toBe('https://relay.example.com::user_9')
    expect(listProfiles()).toHaveLength(2)
  })

  it('upserts the same account instead of duplicating', () => {
    upsertProfile('http', '127.0.0.1:8000', 'user_1', 'alice')
    const again = upsertProfile('http', '127.0.0.1:8000', 'user_1', 'alice2')
    expect(listProfiles()).toHaveLength(1)
    expect(again.username).toBe('alice2')
  })

  it('namespaces storage keys per active profile', () => {
    expect(activeNamespace()).toBe('')
    expect(namespacedLSKey('refresh_token')).toBe('refresh_token')
    upsertProfile('http', 'h1', 'u1', 'a')
    const pid = profileId('https', 'h2', 'u2')
    upsertProfile('https', 'h2', 'u2', 'b')
    expect(getActiveProfile()?.id).toBe(pid)
    expect(activeNamespace()).toBe(`${pid}::`)
    expect(namespacedLSKey('refresh_token')).toBe(`${pid}::refresh_token`)
    setActiveProfileId(LEGACY_PROFILE_ID)
    expect(activeNamespace()).toBe('')
  })

  it('removes profiles and clears the active pointer', () => {
    const a = upsertProfile('http', 'h1', 'u1', 'a')
    const b = upsertProfile('http', 'h2', 'u2', 'b')
    expect(getActiveProfile()?.id).toBe(b.id)
    removeProfile(b.id)
    expect(getActiveProfile()).toBeNull()
    expect(listProfiles()).toHaveLength(1)
    removeProfile(a.id)
    expect(listProfiles()).toHaveLength(0)
  })

  it('ensureActiveProfile returns active or creates legacy', () => {
    const created = ensureActiveProfile('http', 'h', 'u', 'n')
    expect(created.id).toBe(LEGACY_PROFILE_ID)
    expect(ensureActiveProfile('http', 'other', 'x', 'y').id).toBe(LEGACY_PROFILE_ID)
  })

  it('namespaceOf matches activeNamespace logic', () => {
    const profiles = [upsertProfile('http', 'h', 'u', 'n')]
    expect(namespaceOf(profiles[0])).toBe('')
  })
})
