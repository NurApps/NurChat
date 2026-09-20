import { describe, it, expect } from 'vitest'
import {
  DoubleRatchetSession,
} from '../services/doubleRatchet'
import { boxKeyPair } from '../services/cryptoAdapter'

// Full 1-1 conversation through DoubleRatchetSession: the exact "new
// messages" path. Catches systematic breakers (detached buffers,
// serialize crashes, ratchet desync) that unit tests on primitives miss.
describe('1-1 conversation Alice <-> Bob', () => {
  async function setupPair() {
    const aliceIdentity = boxKeyPair()
    const bobIdentity = boxKeyPair()
    const bobSpk = boxKeyPair()

    const alice = new DoubleRatchetSession()
    await alice.initializeAsAlice({
      ourIdentitySecret: aliceIdentity.secretKey,
      theirIdentityPublic: bobIdentity.publicKey,
      theirSignedPrekeyPublic: bobSpk.publicKey,
    })
    // Alice's first envelope header carries the ephemeral for Bob init.
    const first = await alice.encryptMessage('hello-0')
    const bob = new DoubleRatchetSession()
    await bob.initializeAsBob({
      ourIdentitySecret: bobIdentity.secretKey,
      ourSignedPrekeySecret: bobSpk.secretKey,
      ourOneTimePrekeySecret: null,
      theirIdentityPublic: aliceIdentity.publicKey,
      theirEphemeralPublic: hexToBytes(first.header.dh),
    })
    return { alice, bob }
  }

  function hexToBytes(hex: string): Uint8Array {
    const b = new Uint8Array(hex.length / 2)
    for (let i = 0; i < hex.length; i += 2) b[i / 2] = parseInt(hex.substring(i, i + 2), 16)
    return b
  }

  it('alternating conversation survives DH ratchets both ways', async () => {
    const { alice, bob } = await setupPair()
    for (let i = 0; i < 6; i++) {
      const aEnv = await alice.encryptMessage(`a-msg-${i}`)
      await expect(bob.decryptMessage(aEnv)).resolves.toBe(`a-msg-${i}`)
      const bEnv = await bob.encryptMessage(`b-msg-${i}`)
      await expect(alice.decryptMessage(bEnv)).resolves.toBe(`b-msg-${i}`)
    }
  })

  it('survives serialize/persist roundtrip mid-conversation', async () => {
    const { alice, bob } = await setupPair()
    await bob.decryptMessage(await alice.encryptMessage('m1'))
    await alice.decryptMessage(await bob.encryptMessage('r1'))
    // This exact line crashed on detached buffers (bytesToHex throw).
    const snapA = alice.serialize()
    const snapB = bob.serialize()
    expect(snapA.DHs).toBeTruthy()
    const alice2 = DoubleRatchetSession.deserialize(snapA)
    const bob2 = DoubleRatchetSession.deserialize(snapB)
    await expect(bob2.decryptMessage(await alice2.encryptMessage('m2'))).resolves.toBe('m2')
    await expect(alice2.decryptMessage(await bob2.encryptMessage('r2'))).resolves.toBe('r2')
  })

  it('duplicate delivery throws instead of corrupting state', async () => {
    const { alice, bob } = await setupPair()
    const env = await alice.encryptMessage('once')
    await expect(bob.decryptMessage(env)).resolves.toBe('once')
    await expect(bob.decryptMessage(env)).rejects.toThrow()
    // Session still usable for the next fresh message.
    await expect(bob.decryptMessage(await alice.encryptMessage('twice'))).resolves.toBe('twice')
  })

  it('rotation past 100 messages keeps working', async () => {
    const { alice, bob } = await setupPair()
    for (let i = 0; i < 110; i++) {
      await expect(bob.decryptMessage(await alice.encryptMessage(`bulk-${i}`))).resolves.toBe(`bulk-${i}`)
    }
  }, 60000)
})
