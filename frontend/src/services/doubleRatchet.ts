/**
 * Double Ratchet implementation for NurChat (TypeScript)
 * Mirrors shared/double_ratchet.py — X3DH + Double Ratchet (Signal Protocol)
 *
 * Provides forward secrecy, automatic key rotation, and replay protection.
 *
 * Uses @noble/curves + @noble/ciphers (audited by cure53, Sep 2024).
 * Replaces tweetnacl for better security and performance (1.5x faster).
 */

import {
  boxKeyPair,
  boxKeyPairFromSecretKey,
  boxBefore,
  secretboxEncrypt,
  secretboxDecrypt,
  secretboxNonceLength,
  randomBytes,
  bytesToHex,
  hexToBytes,
  type BoxKeyPair,
} from "./cryptoAdapter"

const MAX_SKIP_GAP = 2000
const MAX_SKIPPED = 1000
const PROTOCOL_VERSION = 3
const KEY_ROTATION_INTERVAL = 100

// ─── Helpers ───

function u8Concat(...arrays: Uint8Array[]): Uint8Array {
  let total = 0
  for (const a of arrays) total += a.length
  const result = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) {
    result.set(a, offset)
    offset += a.length
  }
  return result
}

export function toBase64(bytes: Uint8Array): string {
  const CHUNK = 8192
  let binary = ""
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// ─── HKDF (SHA-256 based) ───

// WebCrypto rejects empty HMAC keys. HKDF spec allows empty salt, so we use
// an all-zero 32-byte salt (equivalent to empty per RFC 5869 §2.2).
const HKDF_SALT = new Uint8Array(32)

async function hkdfExtract(salt: Uint8Array, ikm: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", salt as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const result = await crypto.subtle.sign("HMAC", key, ikm as BufferSource)
  return new Uint8Array(result)
}

async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const N = Math.ceil(length / 32)
  let t = new Uint8Array(0)
  const okmParts: Uint8Array[] = []
  for (let i = 1; i <= N; i++) {
    const key = await crypto.subtle.importKey("raw", prk as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
    const input = u8Concat(t, info, new Uint8Array([i]))
    t = new Uint8Array(await crypto.subtle.sign("HMAC", key, input as BufferSource))
    okmParts.push(t)
  }
  return u8Concat(...okmParts).slice(0, length)
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const prk = await hkdfExtract(salt, ikm)
  return hkdfExpand(prk, info, length)
}

// ─── KDF Chain ───

class KDFChain {
  key: Uint8Array
  step: number
  constructor(key: Uint8Array, step: number = 0) {
    this.key = key
    this.step = step
  }

  async nextMessageKey(ad: Uint8Array): Promise<{ msgKey: Uint8Array; chain: KDFChain }> {
    const infoMsg = u8Concat(ad, new TextEncoder().encode("|nurchat:msg"))
    const infoChain = u8Concat(ad, new TextEncoder().encode("|nurchat:chain"))
    const msgKey = await hkdf(HKDF_SALT, this.key, infoMsg, 32)
    const nextKey = await hkdf(HKDF_SALT, this.key, infoChain, 32)
    return { msgKey, chain: new KDFChain(nextKey, this.step + 1) }
  }
}

// ─── Session Types ───

export interface RatchetHeader {
  dh: string   // hex-encoded public key
  pn: number   // previous message count
  ns: number   // message number in current sending chain
}

export interface RatchetEnvelope {
  header: RatchetHeader
  ciphertext: string   // base64 (encrypted ad + plaintext)
}

export interface SerializedSession {
  version: number
  DHs: string | null
  DHr: string | null
  RK: string | null
  CKs: string | null
  CKr: string | null
  CKs_step: number
  CKr_step: number
  Ns: number
  Nr: number
  PN: number
  our_id: string | null
  their_id: string | null
  skipped: Record<string, string>
  seen: string[]
}

// ─── Double Ratchet Session ───

export class DoubleRatchetSession {
  DHs: BoxKeyPair | null = null
  DHr: Uint8Array | null = null
  RK: Uint8Array | null = null
  CKs: KDFChain | null = null
  CKr: KDFChain | null = null
  Ns = 0
  Nr = 0
  PN = 0
  ourIdentityPublic: Uint8Array | null = null
  theirIdentityPublic: Uint8Array | null = null
  private seenMessageIds = new Set<string>()
  private skippedKeys = new Map<string, Uint8Array>()
  // Set after receiving a new remote ratchet key: our NEXT outgoing message
  // must perform a DH ratchet step. Do NOT regenerate DHs inside
  // dhRatchetRecv — otherwise the next message would be encrypted with the
  // old sending chain but carry an unknown-to-peer public key in its header.
  private pendingSendRatchet = false
  // True when DHs was freshly generated in dhRatchetRecv and the pending
  // send ratchet must reuse it instead of generating another keypair.
  private dhFresh = false

  private associatedData(): Uint8Array {
    const a = this.ourIdentityPublic || new Uint8Array(0)
    const b = this.theirIdentityPublic || new Uint8Array(0)
    return u8Compare(a, b) < 0 ? u8Concat(a, b) : u8Concat(b, a)
  }

  static async x3dhInitialize(
    ourIdentitySecret: Uint8Array,
    theirIdentityPublic: Uint8Array,
    theirSignedPrekeyPublic: Uint8Array,
    theirOneTimePrekeyPublic?: Uint8Array,
  ): Promise<{ sk: Uint8Array; ephemeralSecret: Uint8Array }> {
    const ephemeralKp = boxKeyPair()

    const dh1 = boxBefore(theirSignedPrekeyPublic, ourIdentitySecret)
    const dh2 = boxBefore(theirIdentityPublic, ephemeralKp.secretKey)
    const dh3 = boxBefore(theirSignedPrekeyPublic, ephemeralKp.secretKey)

    let dhInput = u8Concat(dh1, dh2, dh3)
    if (theirOneTimePrekeyPublic) {
      const dh4 = boxBefore(theirOneTimePrekeyPublic, ephemeralKp.secretKey)
      dhInput = u8Concat(dhInput, dh4)
    }

    const sk = await hkdf(HKDF_SALT, dhInput, new TextEncoder().encode("X3DH_SK"), 32)
    return { sk, ephemeralSecret: ephemeralKp.secretKey }
  }

  static async x3dhReceive(
    ourIdentitySecret: Uint8Array,
    ourSignedPrekeySecret: Uint8Array,
    ourOneTimePrekeySecret: Uint8Array | null,
    theirIdentityPublic: Uint8Array,
    theirEphemeralPublic: Uint8Array,
  ): Promise<Uint8Array> {
    const dh1 = boxBefore(theirIdentityPublic, ourSignedPrekeySecret)
    const dh2 = boxBefore(theirEphemeralPublic, ourIdentitySecret)
    const dh3 = boxBefore(theirEphemeralPublic, ourSignedPrekeySecret)

    let dhInput = u8Concat(dh1, dh2, dh3)
    if (ourOneTimePrekeySecret) {
      const dh4 = boxBefore(theirEphemeralPublic, ourOneTimePrekeySecret)
      dhInput = u8Concat(dhInput, dh4)
    }

    return hkdf(HKDF_SALT, dhInput, new TextEncoder().encode("X3DH_SK"), 32)
  }

  async initializeAsAlice(params: {
    ourIdentitySecret: Uint8Array
    theirIdentityPublic: Uint8Array
    theirSignedPrekeyPublic: Uint8Array
    theirOneTimePrekeyPublic?: Uint8Array
  }): Promise<void> {
    const { sk, ephemeralSecret } = await DoubleRatchetSession.x3dhInitialize(
      params.ourIdentitySecret,
      params.theirIdentityPublic,
      params.theirSignedPrekeyPublic,
      params.theirOneTimePrekeyPublic,
    )

    const ephemeralKp = boxKeyPairFromSecretKey(ephemeralSecret)
    const ourIdentityKp = boxKeyPairFromSecretKey(params.ourIdentitySecret)

    this.DHs = ephemeralKp
    this.DHr = params.theirSignedPrekeyPublic
    this.ourIdentityPublic = ourIdentityKp.publicKey
    this.theirIdentityPublic = params.theirIdentityPublic

    const derived = await hkdf(sk, new Uint8Array(0), new TextEncoder().encode("DoubleRatchet_Init"), 64)
    this.RK = derived.slice(0, 32)
    this.CKs = new KDFChain(derived.slice(32))
    this.CKr = null
    this.Ns = 0
    this.Nr = 0
    this.PN = 0
    this.seenMessageIds = new Set()
  }

  async initializeAsBob(params: {
    ourIdentitySecret: Uint8Array
    ourSignedPrekeySecret: Uint8Array
    ourOneTimePrekeySecret: Uint8Array | null
    theirIdentityPublic: Uint8Array
    theirEphemeralPublic: Uint8Array
  }): Promise<void> {
    const sk = await DoubleRatchetSession.x3dhReceive(
      params.ourIdentitySecret,
      params.ourSignedPrekeySecret,
      params.ourOneTimePrekeySecret,
      params.theirIdentityPublic,
      params.theirEphemeralPublic,
    )

    const ourIdentityKp = boxKeyPairFromSecretKey(params.ourIdentitySecret)

    this.DHr = params.theirEphemeralPublic
    this.DHs = boxKeyPairFromSecretKey(params.ourSignedPrekeySecret)
    this.ourIdentityPublic = ourIdentityKp.publicKey
    this.theirIdentityPublic = params.theirIdentityPublic

    const derived = await hkdf(sk, new Uint8Array(0), new TextEncoder().encode("DoubleRatchet_Init"), 64)
    this.RK = derived.slice(0, 32)
    this.CKr = new KDFChain(derived.slice(32))
    this.CKs = null
    this.Ns = 0
    this.Nr = 0
    this.PN = 0
    this.seenMessageIds = new Set()
  }

  private async dhRatchetSend(): Promise<void> {
    if (!this.DHr) throw new Error("No remote DH key for ratchet")

    // Reuse the keypair generated in dhRatchetRecv if it is fresh;
    // otherwise generate a brand-new one.
    let newDHs: BoxKeyPair
    if (this.dhFresh && this.DHs) {
      newDHs = this.DHs
      this.dhFresh = false
    } else {
      if (this.DHs) {
        this.zeroizeKeypair(this.DHs)
      }
      newDHs = boxKeyPair()
    }
    const dhShared = boxBefore(this.DHr, newDHs.secretKey)
    const derived = await hkdf(
      this.RK || new Uint8Array(32),
      dhShared,
      new TextEncoder().encode("DoubleRatchet_Ratchet"),
      64,
    )
    this.RK = derived.slice(0, 32)

    this.CKs = new KDFChain(derived.slice(32))

    this.PN = this.Ns
    this.Ns = 0
    this.Nr = 0
    this.DHs = newDHs
    this.pendingSendRatchet = false

    // Zeroize intermediate secrets
    this.zeroizeBytes(dhShared)
    this.zeroizeBytes(derived)
  }

  private async dhRatchetRecv(theirPublic: Uint8Array): Promise<void> {
    if (!this.DHs) throw new Error("No local DH key for ratchet")
    const dhShared = boxBefore(theirPublic, this.DHs.secretKey)
    const derived = await hkdf(
      this.RK || new Uint8Array(32),
      dhShared,
      new TextEncoder().encode("DoubleRatchet_Ratchet"),
      64,
    )
    this.RK = derived.slice(0, 32)

    this.CKr = new KDFChain(derived.slice(32))

    this.PN = this.Ns
    this.Nr = 0
    this.DHr = theirPublic

    // Generate the next DH keypair now (Signal spec): the pending send
    // ratchet will reuse it so the header public key stays consistent
    // with the sending chain derived from it.
    if (this.DHs) {
      this.zeroizeKeypair(this.DHs)
    }
    this.DHs = boxKeyPair()
    this.dhFresh = true
    this.pendingSendRatchet = true

    // Zeroize intermediate secrets
    this.zeroizeBytes(dhShared)
    this.zeroizeBytes(derived)
  }

  async encryptMessage(plaintext: string): Promise<RatchetEnvelope> {
    if (this.pendingSendRatchet && this.DHr) {
      await this.dhRatchetSend()
      this.pendingSendRatchet = false
    }
    if (!this.CKs) {
      if (this.CKr && this.DHr) {
        await this.dhRatchetSend()
      } else {
        throw new Error("No sending chain available — ratchet first")
      }
    }

    // Force DH ratchet every KEY_ROTATION_INTERVAL messages for extra forward secrecy
    if (this.CKs && this.CKs.step >= KEY_ROTATION_INTERVAL && this.CKr && this.DHr) {
      await this.dhRatchetSend()
    }

    if (!this.CKs) throw new Error("Sending chain still null after ratchet")

    const ad = this.associatedData()
    const { msgKey, chain } = await this.CKs.nextMessageKey(ad)
    this.CKs = chain

    const nonce = randomBytes(secretboxNonceLength)
    const msgBytes = u8Concat(ad, new TextEncoder().encode(plaintext))
    const ciphertext = secretboxEncrypt(msgBytes, nonce, msgKey)

    // Zeroize sensitive intermediates after encryption
    this.zeroizeBytes(msgKey)
    this.zeroizeBytes(msgBytes)

    const ciphertextWithNonce = new Uint8Array(nonce.length + ciphertext.length)
    ciphertextWithNonce.set(nonce)
    ciphertextWithNonce.set(ciphertext, nonce.length)

    const dhPubHex = bytesToHex(this.DHs!.publicKey)

    const header: RatchetHeader = {
      dh: dhPubHex,
      pn: this.PN,
      ns: this.Ns,
    }

    this.Ns += 1

    return {
      header,
      ciphertext: toBase64(ciphertextWithNonce),
    }
  }

  async decryptMessage(envelope: RatchetEnvelope): Promise<string> {
    const { dh, pn, ns } = envelope.header

    const ad = this.associatedData()
    const msgId = `${dh}:${ns}`

    const skipped = this.skippedKeys.get(msgId)
    if (skipped) {
      if (this.seenMessageIds.has(msgId)) throw new Error("Replay attack detected")
      this.skippedKeys.delete(msgId)
      this.seenMessageIds.add(msgId)
      return this.decryptWithKey(envelope, skipped, msgId)
    }

    const theirRatchet = hexToBytes(dh)

    if (!this.DHr || !bytesEqual(this.DHr, theirRatchet)) {
      this.PN = pn
      await this.dhRatchetRecv(theirRatchet)
    }

    if (!this.CKr) throw new Error("No receiving chain available")

    if (ns < this.CKr.step) {
      throw new Error(`Message number ${ns} is in the past (chain at ${this.CKr.step})`)
    }

    if (ns - this.CKr.step > MAX_SKIP_GAP) {
      throw new Error("Message gap too large")
    }

    while (this.CKr.step < ns) {
      const res = await this.CKr.nextMessageKey(ad)
      this.CKr = res.chain
      const skipId = `${dh}:${this.CKr.step - 1}`
      if (!this.seenMessageIds.has(skipId) && !this.skippedKeys.has(skipId)) {
        this.skippedKeys.set(skipId, res.msgKey)
        if (this.skippedKeys.size > MAX_SKIPPED) {
          const oldest = this.skippedKeys.keys().next().value as string
          const oldestKey = this.skippedKeys.get(oldest)
          this.skippedKeys.delete(oldest)
          // Zeroize evicted key material instead of leaving it for GC
          if (oldestKey) this.zeroizeBytes(oldestKey)
        }
      }
    }

    const res = await this.CKr.nextMessageKey(ad)
    this.CKr = res.chain
    return this.decryptWithKey(envelope, res.msgKey, msgId)
  }

  private async decryptWithKey(envelope: RatchetEnvelope, msgKey: Uint8Array, msgId: string): Promise<string> {
    if (this.seenMessageIds.has(msgId)) {
      throw new Error("Replay attack detected")
    }
    this.seenMessageIds.add(msgId)
    if (this.seenMessageIds.size > 10000) {
      this.trimSeen()
    }

    const ciphertextBytes = fromBase64(envelope.ciphertext)
    const nonce = ciphertextBytes.subarray(0, secretboxNonceLength)
    const ciphertext = ciphertextBytes.subarray(secretboxNonceLength)

    const payload = secretboxDecrypt(ciphertext, nonce, msgKey)

    // Zeroize msgKey immediately after use
    this.zeroizeBytes(msgKey)

    if (!payload) throw new Error("Decryption failed")

    const ad = this.associatedData()
    if (payload.length < ad.length || !u8Equal(payload.subarray(0, ad.length), ad)) {
      throw new Error("Associated data mismatch")
    }
    return new TextDecoder().decode(payload.subarray(ad.length))
  }

  private trimSeen(): void {
    const sorted = [...this.seenMessageIds].sort((a, b) => {
      const nsA = parseInt(a.split(":")[1], 10)
      const nsB = parseInt(b.split(":")[1], 10)
      return nsA - nsB
    })
    this.seenMessageIds = new Set(sorted.slice(-5000))
  }

  /**
   * Zeroize a Uint8Array buffer and release memory.
   */
  private zeroizeBytes(buffer: Uint8Array | null): void {
    if (!buffer) return
    buffer.fill(0)
    try {
      if (buffer.buffer instanceof ArrayBuffer && typeof buffer.buffer.transfer === "function") {
        buffer.buffer.transfer(0)
      }
    } catch {
      // ignore transfer errors
    }
  }

  /**
   * Zeroize a BoxKeyPair.
   */
  private zeroizeKeypair(kp: BoxKeyPair): void {
    this.zeroizeBytes(kp.secretKey)
  }

  serialize(): SerializedSession {
    const skipped: Record<string, string> = {}
    this.skippedKeys.forEach((v, k) => {
      skipped[k] = toBase64(v)
    })
    return {
      version: PROTOCOL_VERSION,
      DHs: this.DHs ? bytesToHex(this.DHs.publicKey) + ":" + bytesToHex(this.DHs.secretKey) : null,
      DHr: this.DHr ? bytesToHex(this.DHr) : null,
      RK: this.RK ? toBase64(this.RK) : null,
      CKs: this.CKs ? toBase64(this.CKs.key) : null,
      CKr: this.CKr ? toBase64(this.CKr.key) : null,
      CKs_step: this.CKs?.step ?? 0,
      CKr_step: this.CKr?.step ?? 0,
      Ns: this.Ns,
      Nr: this.Nr,
      PN: this.PN,
      our_id: this.ourIdentityPublic ? toBase64(this.ourIdentityPublic) : null,
      their_id: this.theirIdentityPublic ? toBase64(this.theirIdentityPublic) : null,
      skipped,
      seen: [...this.seenMessageIds]
        .sort((a, b) => parseInt(a.split(":")[1], 10) - parseInt(b.split(":")[1], 10))
        .slice(-2000),
      pendingSendRatchet: this.pendingSendRatchet,
      dhFresh: this.dhFresh,
    }
  }

  static deserialize(data: SerializedSession): DoubleRatchetSession {
    if (data.version !== PROTOCOL_VERSION) {
      throw new Error("Session protocol version mismatch")
    }
    const s = new DoubleRatchetSession()

    if (data.DHs) {
      const secHex = data.DHs.split(":")[1]
      s.DHs = boxKeyPairFromSecretKey(hexToBytes(secHex))
    }
    if (data.DHr) {
      s.DHr = hexToBytes(data.DHr)
    }
    if (data.RK) {
      s.RK = fromBase64(data.RK)
    }
    if (data.CKs) {
      s.CKs = new KDFChain(fromBase64(data.CKs), data.CKs_step)
    }
    if (data.CKr) {
      s.CKr = new KDFChain(fromBase64(data.CKr), data.CKr_step)
    }
    s.Ns = data.Ns
    s.Nr = data.Nr
    s.PN = data.PN
    if (data.our_id) {
      s.ourIdentityPublic = fromBase64(data.our_id)
    }
    if (data.their_id) {
      s.theirIdentityPublic = fromBase64(data.their_id)
    }
    if (data.skipped) {
      for (const [k, v] of Object.entries(data.skipped)) {
        try {
          s.skippedKeys.set(k, fromBase64(v))
        } catch {
          /* ignore */
        }
      }
    }
    if (data.seen) {
      s.seenMessageIds = new Set(data.seen)
    }
    s.pendingSendRatchet = Boolean((data as SerializedSession & { pendingSendRatchet?: boolean }).pendingSendRatchet)
    s.dhFresh = Boolean((data as SerializedSession & { dhFresh?: boolean }).dhFresh)
    return s
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

const u8Equal = bytesEqual

function u8Compare(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < a.length && i < b.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  }
  return a.length - b.length
}
