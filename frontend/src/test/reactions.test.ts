import { describe, it, expect } from 'vitest'
import { reactionTag, groupReactionRows } from '../services/e2e'

// Blinded toggle tags: deterministic per user/message/emoji,
// unlinkable across messages, 64-hex.
describe('E2E reaction tags', () => {
  const secret = 'a'.repeat(64)

  it('is deterministic for the same input', () => {
    expect(reactionTag(secret, 'msg_1', '👍')).toBe(reactionTag(secret, 'msg_1', '👍'))
    expect(reactionTag(secret, 'msg_1', '👍')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('differs per message and per emoji (no cross-linkability)', () => {
    const a = reactionTag(secret, 'msg_1', '👍')
    expect(reactionTag(secret, 'msg_2', '👍')).not.toBe(a)
    expect(reactionTag(secret, 'msg_1', '❤️')).not.toBe(a)
  })

  it('differs per identity (no cross-user linkability)', () => {
    expect(reactionTag('b'.repeat(64), 'msg_1', '👍')).not.toBe(
      reactionTag(secret, 'msg_1', '👍'),
    )
  })
})

describe('reaction grouping', () => {
  const chat: any = { id: 'chat_1', is_group: false, participants: [] }
  const keys: any = { privateKeyHex: 'a'.repeat(64) }

  it('groups legacy plaintext rows without crypto', async () => {
    const grouped = await groupReactionRows(
      [
        { user_id: 'u1', emoji: '👍' },
        { user_id: 'u2', emoji: '👍' },
        { user_id: 'u1', emoji: '❤️' },
      ],
      chat,
      keys,
    )
    expect(grouped).toEqual({ '👍': ['u1', 'u2'], '❤️': ['u1'] })
  })

  it('skips undecryptable rows instead of crashing', async () => {
    const grouped = await groupReactionRows(
      [{ user_id: 'u1', enc_emoji: 'not-json' }],
      chat,
      keys,
    )
    expect(grouped).toEqual({})
  })
})
