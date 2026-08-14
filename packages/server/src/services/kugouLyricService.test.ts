import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodeKrc, getKrcByHash, parseKrc } from './kugouLyricService.js'

const KEY = Buffer.from([64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105])

function encodeKrc(plainText: string): Buffer {
  const compressed = gzipSync(Buffer.from(plainText))
  const encrypted = Buffer.alloc(compressed.length + 4)
  encrypted.write('krc1')
  for (let index = 0; index < compressed.length; index += 1) {
    encrypted[index + 4] = compressed[index] ^ KEY[index % KEY.length]
  }
  return encrypted
}

afterEach(() => vi.unstubAllGlobals())

describe('Kugou KRC service', () => {
  it('parses metadata and word-level timing', () => {
    const parsed = parseKrc('[ti:Song]\n[ar:Artist]\n[1000,2000]<0,500,0>Hello <500,500,0>world')
    expect(parsed).toMatchObject({ title: 'Song', artist: 'Artist' })
    expect(parsed.items[0]).toEqual([
      { word: 'Hello ', offset: 1, duration: 0.5 },
      { word: 'world', offset: 1.5, duration: 0.5 },
    ])
  })

  it('decodes encrypted compressed KRC content', async () => {
    const plaintext = '[1000,1000]<0,1000,0>Hello'
    await expect(decodeKrc(encodeKrc(plaintext))).resolves.toBe(plaintext)
  })

  it('searches and downloads lyrics without the legacy request stack', async () => {
    const plaintext = '[1000,1000]<0,1000,0>Hello'
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ id: 'id', accesskey: 'key' }] })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ fmt: 'krc', content: encodeKrc(plaintext).toString('base64') })),
      )
    vi.stubGlobal('fetch', fetchMock)
    await expect(getKrcByHash('hash')).resolves.toMatchObject({ items: [[{ word: 'Hello', offset: 1, duration: 1 }]] })
  })
})
