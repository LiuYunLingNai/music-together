import { Transform } from 'node:stream'
import { LRUCache } from 'lru-cache'

export type KugouDecryptedFormat = 'flac' | 'ogg' | 'mp3' | 'm4a'

interface KugouQmcCipher {
  decrypt(data: Uint8Array, offset: number): void
}

export interface KugouEncryptedAudio {
  cipher: KugouQmcCipher
  format: KugouDecryptedFormat
  fileSize?: number
}

const encryptedAudio = new LRUCache<string, KugouEncryptedAudio>({ max: 500, ttl: 2 * 60 * 60 * 1000 })
const QMC_V2_PREFIX = Buffer.from('QQMusic EncV2,Key:')
const QMC_V2_KEY_1 = Buffer.from('386ZJY!@#*$%^&)(')
const QMC_V2_KEY_2 = Buffer.from('**#!(#$%&^a1cZ,T')
const QMC_RC4_FIRST_SEGMENT_SIZE = 128
const QMC_RC4_SEGMENT_SIZE = 5120

function teaDecryptBlock(data: Uint8Array, key: Uint8Array): Buffer {
  const input = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  const keyBuffer = Buffer.from(key.buffer, key.byteOffset, key.byteLength)
  let left = input.readUInt32BE(0)
  let right = input.readUInt32BE(4)
  const keys = [0, 4, 8, 12].map((offset) => keyBuffer.readUInt32BE(offset))
  const delta = 0x9e3779b9
  let sum = Math.imul(delta, 16) >>> 0

  for (let round = 0; round < 16; round += 1) {
    const rightMix =
      (((((left << 4) >>> 0) + keys[2]!) >>> 0) ^ ((left + sum) >>> 0) ^ ((left >>> 5) + keys[3]!)) >>> 0
    right = (right - rightMix) >>> 0
    const leftMix =
      (((((right << 4) >>> 0) + keys[0]!) >>> 0) ^ ((right + sum) >>> 0) ^ ((right >>> 5) + keys[1]!)) >>> 0
    left = (left - leftMix) >>> 0
    sum = (sum - delta) >>> 0
  }

  const output = Buffer.allocUnsafe(8)
  output.writeUInt32BE(left, 0)
  output.writeUInt32BE(right, 4)
  return output
}

export function decryptKugouTeaEnvelope(data: Uint8Array, key: Uint8Array): Buffer {
  if (key.length !== 16 || data.length < 16 || data.length % 8 !== 0) {
    throw new Error('Invalid QMC TEA payload')
  }

  const input = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  let block = teaDecryptBlock(input.subarray(0, 8), key)
  const paddingLength = block[0]! & 0x07
  const outputLength = input.length - 1 - paddingLength - 2 - 7
  if (outputLength < 0) throw new Error('Invalid QMC TEA padding')

  let previousCipher: Uint8Array = Buffer.alloc(8)
  let currentCipher: Uint8Array = input.subarray(0, 8)
  let inputOffset = 8
  let blockOffset = 1 + paddingLength

  const nextBlock = () => {
    if (inputOffset + 8 > input.length) throw new Error('Truncated QMC TEA payload')
    previousCipher = currentCipher
    currentCipher = input.subarray(inputOffset, inputOffset + 8)
    for (let i = 0; i < 8; i += 1) block[i] = block[i]! ^ currentCipher[i]!
    block = teaDecryptBlock(block, key)
    inputOffset += 8
    blockOffset = 0
  }

  for (let skipped = 0; skipped < 2; ) {
    if (blockOffset < 8) {
      blockOffset += 1
      skipped += 1
    } else {
      nextBlock()
    }
  }

  const output = Buffer.allocUnsafe(outputLength)
  for (let outputOffset = 0; outputOffset < output.length; ) {
    if (blockOffset < 8) {
      output[outputOffset] = block[blockOffset]! ^ previousCipher[blockOffset]!
      outputOffset += 1
      blockOffset += 1
    } else {
      nextBlock()
    }
  }

  for (let checked = 0; checked < 7; checked += 1) {
    if (blockOffset === 8) nextBlock()
    if (block[blockOffset] !== previousCipher[blockOffset]) throw new Error('Invalid QMC TEA checksum')
    blockOffset += 1
  }

  return output
}

function decodeBase64(value: Uint8Array | string): Buffer {
  const text = typeof value === 'string' ? value : Buffer.from(value).toString('ascii')
  const normalized = text.replace(/\0+$/g, '').trim()
  if (!normalized || normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new Error('Invalid QMC ekey encoding')
  }
  return Buffer.from(normalized, 'base64')
}

/** Decode a standard QMC2 ekey when the tracker returns that public format. */
export function deriveKugouQmcKey(ekey: string): Buffer {
  let encryptedKey = decodeBase64(ekey)
  if (encryptedKey.subarray(0, QMC_V2_PREFIX.length).equals(QMC_V2_PREFIX)) {
    encryptedKey = decryptKugouTeaEnvelope(encryptedKey.subarray(QMC_V2_PREFIX.length), QMC_V2_KEY_1)
    encryptedKey = decryptKugouTeaEnvelope(encryptedKey, QMC_V2_KEY_2)
    encryptedKey = decodeBase64(encryptedKey)
  }

  const deriveV1 = (value: Buffer) => {
    if (value.length < 16 || value.length % 8 !== 0) throw new Error('Invalid QMC ekey length')
    const teaKey = Buffer.allocUnsafe(16)
    for (let i = 0; i < 8; i += 1) {
      teaKey[i * 2] = Math.floor(Math.abs(Math.tan(106 + i * 0.1)) * 100) & 0xff
      teaKey[i * 2 + 1] = value[i]!
    }
    return Buffer.concat([value.subarray(0, 8), decryptKugouTeaEnvelope(value.subarray(8), teaKey)])
  }

  // Only accept the two formats implemented by the public QMC decoders. In
  // particular, do not guess at tracker-specific trailers or nested TEA
  // envelopes: a plausible-looking key would silently corrupt every byte.
  return deriveV1(encryptedKey)
}

class QmcMapCipher implements KugouQmcCipher {
  constructor(private readonly key: Uint8Array) {}

  decrypt(data: Uint8Array, offset: number): void {
    for (let i = 0; i < data.length; i += 1) {
      let position = offset + i
      if (position > 0x7fff) position %= 0x7fff
      const keyIndex = (position * position + 71214) % this.key.length
      const rotation = (keyIndex + 4) % 8
      const value = this.key[keyIndex]!
      const mask = ((value << rotation) | (value >>> rotation)) & 0xff
      data[i] = data[i]! ^ mask
    }
  }
}

class QmcRc4Cipher implements KugouQmcCipher {
  private readonly hash: number
  private readonly keyStream: Uint8Array

  constructor(private readonly key: Uint8Array) {
    let hash = 1
    for (const value of key) {
      if (value === 0) continue
      const next = Math.imul(hash, value) >>> 0
      if (next === 0 || next <= hash) break
      hash = next
    }
    this.hash = hash

    const box = Uint8Array.from({ length: key.length }, (_, index) => index)
    let swapIndex = 0
    for (let index = 0; index < box.length; index += 1) {
      swapIndex = (swapIndex + box[index]! + key[index]!) % box.length
      ;[box[index], box[swapIndex]] = [box[swapIndex]!, box[index]!]
    }

    this.keyStream = new Uint8Array(QMC_RC4_SEGMENT_SIZE + 512)
    let left = 0
    let right = 0
    for (let index = 0; index < this.keyStream.length; index += 1) {
      left = (left + 1) % box.length
      right = (right + box[left]!) % box.length
      ;[box[left], box[right]] = [box[right]!, box[left]!]
      this.keyStream[index] = box[(box[left]! + box[right]!) % box.length]!
    }
  }

  private segmentSkip(segment: number, seed: number): number {
    if (seed === 0) return 0
    return Math.floor((this.hash / ((segment + 1) * seed)) * 100) % this.key.length
  }

  decrypt(data: Uint8Array, startOffset: number): void {
    let processed = 0
    let offset = startOffset

    if (offset < QMC_RC4_FIRST_SEGMENT_SIZE) {
      const length = Math.min(data.length, QMC_RC4_FIRST_SEGMENT_SIZE - offset)
      for (let i = 0; i < length; i += 1) {
        data[i] = data[i]! ^ this.key[this.segmentSkip(offset + i, this.key[(offset + i) % this.key.length]!)]!
      }
      processed += length
      offset += length
    }

    while (processed < data.length) {
      const segment = Math.floor(offset / QMC_RC4_SEGMENT_SIZE)
      const segmentOffset = offset % QMC_RC4_SEGMENT_SIZE
      const length = Math.min(data.length - processed, QMC_RC4_SEGMENT_SIZE - segmentOffset)
      const streamOffset = (this.segmentSkip(segment, this.key[segment % this.key.length]!) & 0x1ff) + segmentOffset
      for (let i = 0; i < length; i += 1) {
        data[processed + i] = data[processed + i]! ^ this.keyStream[streamOffset + i]!
      }
      processed += length
      offset += length
    }
  }
}

export function createKugouQmcCipher(ekey: string): KugouQmcCipher {
  const key = deriveKugouQmcKey(ekey)
  return key.length > 300 ? new QmcRc4Cipher(key) : new QmcMapCipher(key)
}

export function registerKugouEncryptedAudio(
  url: string,
  ekey: string,
  format: KugouDecryptedFormat,
  fileSize?: number,
): void {
  encryptedAudio.set(url, { cipher: createKugouQmcCipher(ekey), format, fileSize })
}

export function getKugouEncryptedAudio(url: string): KugouEncryptedAudio | undefined {
  return encryptedAudio.get(url)
}

export function createKugouDecryptStream(cipher: KugouQmcCipher, startOffset: number): Transform {
  let offset = startOffset
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        const decrypted = Buffer.from(chunk)
        cipher.decrypt(decrypted, offset)
        offset += decrypted.length
        callback(null, decrypted)
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)))
      }
    },
  })
}

export function kugouAudioContentType(format: KugouDecryptedFormat): string {
  if (format === 'flac') return 'audio/flac'
  if (format === 'ogg') return 'audio/ogg'
  if (format === 'm4a') return 'audio/mp4'
  return 'audio/mpeg'
}
