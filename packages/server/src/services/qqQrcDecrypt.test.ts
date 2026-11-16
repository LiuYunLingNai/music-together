import { describe, expect, it } from 'vitest'
import { qrcDecrypt } from './qqQrcDecrypt.js'

/** Real payload returned by GetPlayLyricInfo for a track without licensed lyrics. */
const FIXTURE = '20ACA477BC736D1A9FBD23B74E44D8DC898A1F98D2500D1430C8EA9973377445D9EFC8441215BDC7DF8A70B2506103BE'
const PLAIN = '未经许可,不得翻唱或使用'

describe('qrcDecrypt', () => {
  it('decrypts the 3DES + deflate payload QQ returns', async () => {
    await expect(qrcDecrypt(FIXTURE)).resolves.toBe(PLAIN)
  })

  it('accepts raw bytes as well as hexadecimal', async () => {
    await expect(qrcDecrypt(Uint8Array.from(Buffer.from(FIXTURE, 'hex')))).resolves.toBe(PLAIN)
  })

  it('rejects a payload that is not hexadecimal', async () => {
    await expect(qrcDecrypt('not-hex')).rejects.toThrow('Invalid QRC payload')
  })
})
