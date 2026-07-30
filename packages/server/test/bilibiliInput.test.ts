import assert from 'node:assert/strict'
import test from 'node:test'
import { parseBilibiliDirectInput, resolveBilibiliVideoId } from '../src/services/bilibiliInput.js'

test('recognizes a BV id and preserves its case-sensitive payload', () => {
  assert.deepEqual(parseBilibiliDirectInput('  BV1373n6rEcP  '), {
    kind: 'bvid',
    bvid: 'BV1373n6rEcP',
  })
  assert.equal(parseBilibiliDirectInput('BV1373n6rEcP-extra'), null)
})

test('extracts BV ids only from trusted Bilibili video URLs', () => {
  assert.deepEqual(
    parseBilibiliDirectInput('https://www.bilibili.com/video/BV1373n6rEcP?p=1&share_source=copy_web'),
    { kind: 'bvid', bvid: 'BV1373n6rEcP' },
  )
  assert.deepEqual(parseBilibiliDirectInput('分享视频：https://m.bilibili.com/video/BV1373n6rEcP。'), {
    kind: 'bvid',
    bvid: 'BV1373n6rEcP',
  })
  assert.equal(parseBilibiliDirectInput('https://example.com/video/BV1373n6rEcP'), null)
  assert.equal(parseBilibiliDirectInput('https://bilibili.com.evil.test/video/BV1373n6rEcP'), null)
})

test('recognizes b23.tv links in share text', () => {
  assert.deepEqual(parseBilibiliDirectInput('推荐一下 https://b23.tv/Hd7SG8Y'), {
    kind: 'short-url',
    url: 'https://b23.tv/Hd7SG8Y',
  })
  assert.deepEqual(parseBilibiliDirectInput('b23.tv/Hd7SG8Y'), {
    kind: 'short-url',
    url: 'https://b23.tv/Hd7SG8Y',
  })
  assert.equal(parseBilibiliDirectInput('https://b23.tv.evil.test/Hd7SG8Y'), null)
  assert.equal(parseBilibiliDirectInput('https://b23.tv:8443/Hd7SG8Y'), null)
})

test('resolves a b23.tv redirect to its BV id without requesting the destination', async () => {
  const requested: string[] = []
  const fetcher = (async (input: string | URL | Request) => {
    requested.push(String(input))
    return new Response(null, {
      status: 302,
      headers: { location: 'https://www.bilibili.com/video/BV1373n6rEcP?p=1' },
    })
  }) as typeof fetch

  assert.equal(await resolveBilibiliVideoId('https://b23.tv/Hd7SG8Y', fetcher), 'BV1373n6rEcP')
  assert.deepEqual(requested, ['https://b23.tv/Hd7SG8Y'])
})

test('rejects a b23.tv redirect to an unrelated host', async () => {
  const fetcher = (async () =>
    new Response(null, {
      status: 302,
      headers: { location: 'https://example.com/video/BV1373n6rEcP' },
    })) as typeof fetch

  assert.equal(await resolveBilibiliVideoId('https://b23.tv/Hd7SG8Y', fetcher), null)
})
