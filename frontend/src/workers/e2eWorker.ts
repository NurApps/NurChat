/**
 * Web Worker для E2E криптографии в NurChat
 * Выносит тяжелые операции шифрования/дешифрования из основного потока UI
 */

import nacl from "tweetnacl"
import {
  encode as base64Encode,
  decode as base64Decode,
} from "base64-arraybuffer"

// ─── Types ───

interface E2EKeys {
  privateKeyHex: string
  publicKeyHex: string
  signingPrivateHex: string
  signingPublicHex: string
}

interface EncryptedEnvelope {
  ciphertext: string
  signature: string
  timestamp: number
  senderId: string
}

// ─── Message Types ───

type WorkerRequest = 
  | { type: 'encrypt'; payload: EncryptPayload }
  | { type: 'decrypt'; payload: DecryptPayload }
  | { type: 'generateKeys'; payload: void }
  | { type: 'encryptGroup'; payload: EncryptGroupPayload }
  | { type: 'decryptGroup'; payload: DecryptGroupPayload }

interface EncryptPayload {
  plaintext: string
  myKeys: E2EKeys
  theirPublicKeyHex: string
  chatId: string
  senderId: string
}

interface DecryptPayload {
  envelope: EncryptedEnvelope
  myKeys: E2EKeys
  senderPublicKeyHex: string
  chatId: string
}

interface EncryptGroupPayload {
  plaintext: string
  myKeys: E2EKeys
  groupKey: string // base64 encoded
  senderId: string
}

interface DecryptGroupPayload {
  envelope: EncryptedEnvelope
  groupKey: string // base64 encoded
}

type WorkerResponse =
  | { type: 'encryptSuccess'; payload: EncryptedEnvelope; requestId: string }
  | { type: 'encryptError'; error: string; requestId: string }
  | { type: 'decryptSuccess'; payload: string | null; requestId: string }
  | { type: 'decryptError'; error: string; requestId: string }
  | { type: 'generateKeysSuccess'; payload: E2EKeys; requestId: string }
  | { type: 'generateKeysError'; error: string; requestId: string }
  | { type: 'encryptGroupSuccess'; payload: EncryptedEnvelope; requestId: string }
  | { type: 'encryptGroupError'; error: string; requestId: string }
  | { type: 'decryptGroupSuccess'; payload: string | null; requestId: string }
  | { type: 'decryptGroupError'; error: string; requestId: string }

// ─── Helpers ───

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")
}

// ─── DH Key Agreement ───

function deriveSharedSecret(
  myPrivateKeyHex: string,
  theirPublicKeyHex: string,
): Uint8Array {
  const myPrivate = nacl.box.keyPair.fromSecretKey(hexToBytes(myPrivateKeyHex))
  const theirPublic = hexToBytes(theirPublicKeyHex)
  return nacl.box.before(theirPublic, myPrivate.secretKey)
}

async function deriveChatKey(
  myPrivateKeyHex: string,
  theirPublicKeyHex: string,
  chatId: string,
): Promise<Uint8Array> {
  const sharedSecret = deriveSharedSecret(myPrivateKeyHex, theirPublicKeyHex)
  const data = new Uint8Array([...sharedSecret, ...new TextEncoder().encode(chatId)])
  const hash = await crypto.subtle.digest("SHA-256", data)
  return new Uint8Array(hash)
}

// ─── Encrypt / Decrypt ───

async function encryptMessage(
  plaintext: string,
  myKeys: E2EKeys,
  theirPublicKeyHex: string,
  chatId: string,
  senderId: string,
): Promise<EncryptedEnvelope> {
  const symmetricKey = await deriveChatKey(
    myKeys.privateKeyHex,
    theirPublicKeyHex,
    chatId,
  )
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength)
  const messageBytes = new TextEncoder().encode(plaintext)
  const ciphertext = nacl.secretbox(messageBytes, nonce, symmetricKey)
  
  const ciphertextWithNonce = new Uint8Array(nonce.length + ciphertext.length)
  ciphertextWithNonce.set(nonce)
  ciphertextWithNonce.set(ciphertext, nonce.length)
  
  const signature = nacl.sign.detached(
    messageBytes,
    hexToBytes(myKeys.signingPrivateHex),
  )
  
  return {
    ciphertext: base64Encode(ciphertextWithNonce.buffer as ArrayBuffer),
    signature: base64Encode(signature.buffer as ArrayBuffer),
    timestamp: Date.now(),
    senderId,
  }
}

async function decryptMessage(
  envelope: EncryptedEnvelope,
  myKeys: E2EKeys,
  senderPublicKeyHex: string,
  chatId: string,
): Promise<string | null> {
  try {
    const symmetricKey = await deriveChatKey(
      myKeys.privateKeyHex,
      senderPublicKeyHex,
      chatId,
    )
    const ciphertextBytes = new Uint8Array(base64Decode(envelope.ciphertext))
    const nonce = ciphertextBytes.subarray(0, nacl.secretbox.nonceLength)
    const ciphertext = ciphertextBytes.subarray(nacl.secretbox.nonceLength)
    const plaintext = nacl.secretbox.open(ciphertext, nonce, symmetricKey)
    
    if (!plaintext) return null
    
    const messageBytes = new Uint8Array(plaintext)
    const signatureBytes = new Uint8Array(base64Decode(envelope.signature))
    const valid = nacl.sign.detached.verify(
      messageBytes,
      signatureBytes,
      hexToBytes(senderPublicKeyHex),
    )
    
    return valid ? new TextDecoder().decode(plaintext) : null
  } catch {
    return null
  }
}

function encryptGroupMessage(
  plaintext: string,
  myKeys: E2EKeys,
  groupKey: Uint8Array,
  senderId: string,
): EncryptedEnvelope {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength)
  const messageBytes = new TextEncoder().encode(plaintext)
  const ciphertext = nacl.secretbox(messageBytes, nonce, groupKey)
  
  const ciphertextWithNonce = new Uint8Array(nonce.length + ciphertext.length)
  ciphertextWithNonce.set(nonce)
  ciphertextWithNonce.set(ciphertext, nonce.length)
  
  const signature = nacl.sign.detached(
    messageBytes,
    hexToBytes(myKeys.signingPrivateHex),
  )
  
  return {
    ciphertext: base64Encode(ciphertextWithNonce.buffer as ArrayBuffer),
    signature: base64Encode(signature.buffer as ArrayBuffer),
    timestamp: Date.now(),
    senderId,
  }
}

function decryptGroupMessage(
  envelope: EncryptedEnvelope,
  groupKey: Uint8Array,
): string | null {
  try {
    const ciphertextBytes = new Uint8Array(base64Decode(envelope.ciphertext))
    const nonce = ciphertextBytes.subarray(0, nacl.secretbox.nonceLength)
    const ciphertext = ciphertextBytes.subarray(nacl.secretbox.nonceLength)
    const plaintext = nacl.secretbox.open(ciphertext, nonce, groupKey)
    return plaintext ? new TextDecoder().decode(new Uint8Array(plaintext)) : null
  } catch {
    return null
  }
}

function generateKeys(): E2EKeys {
  const boxKp = nacl.box.keyPair()
  const signKp = nacl.sign.keyPair()

  return {
    privateKeyHex: bytesToHex(boxKp.secretKey),
    publicKeyHex: bytesToHex(boxKp.publicKey),
    signingPrivateHex: bytesToHex(signKp.secretKey),
    signingPublicHex: bytesToHex(signKp.publicKey),
  }
}

// ─── Message Handler ───

self.onmessage = async (event: MessageEvent<WorkerRequest & { requestId: string }>) => {
  const { type, payload, requestId } = event.data
  
  try {
    switch (type) {
      case 'encrypt': {
        const result = await encryptMessage(
          payload.plaintext,
          payload.myKeys,
          payload.theirPublicKeyHex,
          payload.chatId,
          payload.senderId,
        )
        const response: WorkerResponse = {
          type: 'encryptSuccess',
          payload: result,
          requestId,
        }
        self.postMessage(response)
        break
      }
      
      case 'decrypt': {
        const result = await decryptMessage(
          payload.envelope,
          payload.myKeys,
          payload.senderPublicKeyHex,
          payload.chatId,
        )
        const response: WorkerResponse = {
          type: 'decryptSuccess',
          payload: result,
          requestId,
        }
        self.postMessage(response)
        break
      }
      
      case 'generateKeys': {
        const result = generateKeys()
        const response: WorkerResponse = {
          type: 'generateKeysSuccess',
          payload: result,
          requestId,
        }
        self.postMessage(response)
        break
      }
      
      case 'encryptGroup': {
        const groupKeyBytes = new Uint8Array(base64Decode(payload.groupKey))
        const result = encryptGroupMessage(
          payload.plaintext,
          payload.myKeys,
          groupKeyBytes,
          payload.senderId,
        )
        const response: WorkerResponse = {
          type: 'encryptGroupSuccess',
          payload: result,
          requestId,
        }
        self.postMessage(response)
        break
      }
      
      case 'decryptGroup': {
        const groupKeyBytes = new Uint8Array(base64Decode(payload.groupKey))
        const result = decryptGroupMessage(
          payload.envelope,
          groupKeyBytes,
        )
        const response: WorkerResponse = {
          type: 'decryptGroupSuccess',
          payload: result,
          requestId,
        }
        self.postMessage(response)
        break
      }
      
      default:
        throw new Error(`Unknown message type: ${type}`)
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    
    const response: WorkerResponse = {
      type: `${type}Error` as any,
      error: errorMessage,
      requestId,
    }
    self.postMessage(response)
  }
}

export {}
