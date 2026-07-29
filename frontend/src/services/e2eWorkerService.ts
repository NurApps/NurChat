/**
 * Сервис-обертка для работы с Web Worker криптографии
 * Предоставляет удобный API и fallback на основной поток при необходимости
 */

import type { E2EKeys, EncryptedEnvelope } from "./e2e"
import { encryptMessage as encryptMain, decryptMessage as decryptMain, generateKeys as generateKeysMain } from "./e2e"

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}

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
  groupKey: string
  senderId: string
}

interface DecryptGroupPayload {
  envelope: EncryptedEnvelope
  groupKey: string
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

class E2EWorkerService {
  private worker: Worker | null = null
  private requestCounter = 0
  private pendingRequests = new Map<string, {
    resolve: (data: any) => void
    reject: (error: Error) => void
    timeoutId?: ReturnType<typeof setTimeout>
  }>()
  private initialized = false
  private useWorker = true

  /**
   * Инициализация воркера
   * @returns true если воркер успешно инициализирован, false если используется fallback
   */
  async init(): Promise<boolean> {
    if (this.initialized) return this.useWorker
    this.initialized = true
    try {
      this.worker = new Worker(new URL('../workers/e2eWorker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.handleResponse(event.data)
      this.useWorker = true
    } catch (e) {
      console.warn('[E2EWorker] Failed to create worker, falling back to main thread:', e)
      this.useWorker = false
    }
    return this.useWorker
  }



  /**
   * Завершение работы воркера
   */
  terminate(): void {
    void this.handleResponse
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
    
    // Очищаем все ожидающие запросы
    for (const [, pending] of this.pendingRequests.entries()) {
      if (pending.timeoutId) clearTimeout(pending.timeoutId)
      pending.reject(new Error('Worker terminated'))
    }
    this.pendingRequests.clear()
    this.initialized = false
  }

  /**
   * Обработка ответа от воркера
   */
  private handleResponse(response: WorkerResponse): void {
    const pending = this.pendingRequests.get(response.requestId)
    if (!pending) {
      console.warn('[E2EWorker] Received response for unknown request:', response.requestId)
      return
    }

    // Очищаем таймаут
    if (pending.timeoutId) clearTimeout(pending.timeoutId)
    this.pendingRequests.delete(response.requestId)

    // Обрабатываем результат
    switch (response.type) {
      case 'encryptSuccess':
      case 'decryptSuccess':
      case 'generateKeysSuccess':
      case 'encryptGroupSuccess':
      case 'decryptGroupSuccess':
        pending.resolve(response.payload)
        break
      
      case 'encryptError':
      case 'decryptError':
      case 'generateKeysError':
      case 'encryptGroupError':
      case 'decryptGroupError':
        pending.reject(new Error(response.error))
        break
      
      default:
        pending.reject(new Error(`Unknown response type: ${(response as any).type}`))
    }
  }

  /**
   * Отправка запроса воркеру
   */
  private sendRequest<T>(type: WorkerRequest['type'], payload: any, timeoutMs = 10000): Promise<T> {
    return new Promise((resolve, reject) => {
      const requestId = `${type}-${++this.requestCounter}-${Date.now()}`
      
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        reject(new Error(`Request ${requestId} timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      this.pendingRequests.set(requestId, { resolve, reject, timeoutId })

      if (this.worker) {
        this.worker.postMessage({ type, payload, requestId })
      } else {
        reject(new Error('Worker not initialized'))
      }
    })
  }

  /**
   * Шифрование сообщения через воркер (или main thread fallback)
   */
  async encryptMessage(
    plaintext: string,
    myKeys: E2EKeys,
    theirPublicKeyHex: string,
    chatId: string,
    senderId: string,
  ): Promise<EncryptedEnvelope> {
    if (!this.useWorker) {
      return encryptMain(plaintext, myKeys, theirPublicKeyHex, chatId, senderId)
    }

    await this.ensureInitialized()
    
    return this.sendRequest<EncryptedEnvelope>('encrypt', {
      plaintext,
      myKeys,
      theirPublicKeyHex,
      chatId,
      senderId,
    })
  }

  /**
   * Дешифрование сообщения через воркер (или main thread fallback)
   */
  async decryptMessage(
    envelope: EncryptedEnvelope,
    myKeys: E2EKeys,
    senderPublicKeyHex: string,
    chatId: string,
  ): Promise<string | null> {
    if (!this.useWorker) {
      return decryptMain(envelope, myKeys, senderPublicKeyHex, chatId)
    }

    await this.ensureInitialized()
    
    return this.sendRequest<string | null>('decrypt', {
      envelope,
      myKeys,
      senderPublicKeyHex,
      chatId,
    })
  }

  /**
   * Генерация ключей через воркер (или main thread fallback)
   */
  async generateKeys(): Promise<E2EKeys> {
    if (!this.useWorker) {
      return generateKeysMain()
    }

    await this.ensureInitialized()
    
    return this.sendRequest<E2EKeys>('generateKeys', undefined)
  }

  /**
   * Шифрование группового сообщения
   */
  async encryptGroupMessage(
    plaintext: string,
    myKeys: E2EKeys,
    groupKey: Uint8Array,
    senderId: string,
  ): Promise<EncryptedEnvelope> {
    if (!this.useWorker) {
      const nacl = await import('tweetnacl')
      const { encode: base64Encode } = await import('base64-arraybuffer')
      
      const nonce = nacl.default.randomBytes(nacl.default.secretbox.nonceLength)
      const messageBytes = new TextEncoder().encode(plaintext)
      const ciphertext = nacl.default.secretbox(messageBytes, nonce, groupKey)
      
      const ciphertextWithNonce = new Uint8Array(nonce.length + ciphertext.length)
      ciphertextWithNonce.set(nonce)
      ciphertextWithNonce.set(ciphertext, nonce.length)
      
      const signature = nacl.default.sign.detached(
        messageBytes,
        new Uint8Array(hexToBytes(myKeys.signingPrivateHex)),
      )
      
      return {
        ciphertext: base64Encode(ciphertextWithNonce.buffer as ArrayBuffer),
        signature: base64Encode(signature.buffer as ArrayBuffer),
        timestamp: Date.now(),
        senderId,
      }
    }

    await this.ensureInitialized()
    
    // Конвертируем Uint8Array в base64 для передачи через postMessage
    const groupKeyBase64 = btoa(String.fromCharCode(...groupKey))
    
    return this.sendRequest<EncryptedEnvelope>('encryptGroup', {
      plaintext,
      myKeys,
      groupKey: groupKeyBase64,
      senderId,
    })
  }

  /**
   * Дешифрование группового сообщения
   */
  async decryptGroupMessage(
    envelope: EncryptedEnvelope,
    groupKey: Uint8Array,
  ): Promise<string | null> {
    if (!this.useWorker) {
      // Fallback для групповых сообщений
      const nacl = await import('tweetnacl')
      const { decode: base64Decode } = await import('base64-arraybuffer')
      
      try {
        const ciphertextBytes = new Uint8Array(base64Decode(envelope.ciphertext))
        const nonce = ciphertextBytes.subarray(0, nacl.default.secretbox.nonceLength)
        const ciphertext = ciphertextBytes.subarray(nacl.default.secretbox.nonceLength)
        const plaintext = nacl.default.secretbox.open(ciphertext, nonce, groupKey)
        return plaintext ? new TextDecoder().decode(new Uint8Array(plaintext)) : null
      } catch {
        return null
      }
    }

    await this.ensureInitialized()
    
    const groupKeyBase64 = btoa(String.fromCharCode(...groupKey))
    
    return this.sendRequest<string | null>('decryptGroup', {
      envelope,
      groupKey: groupKeyBase64,
    })
  }

  /**
   * Проверка и ожидание инициализации
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.init()
    }
  }

  /**
   * Статус использования воркера
   */
  isUsingWorker(): boolean {
    return this.useWorker && this.initialized
  }
}

// Экспортируем singleton экземпляр
export const e2eWorkerService = new E2EWorkerService()
export default e2eWorkerService
