import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'

const testDataDir = mkdtempSync(path.join(tmpdir(), 'music-together-kugou-proxy-'))
process.env.DATABASE_URL = `file:${path.join(testDataDir, 'test.db')}`
process.env.LOG_LEVEL = 'silent'

const express = (await import('express')).default
const musicRoutes = (await import('../src/routes/music.js')).default
const { registerIssuedKugouAudio } = await import('../src/services/kugouAudioProxy.js')
const { db } = await import('../src/repositories/database.js')

const app = express()
app.use('/api/music', musicRoutes)

const realFetch = globalThis.fetch
const upstreamCalls: string[] = []
let upstreamContentType = 'audio/mpeg'
let baseUrl = ''
let server: ReturnType<typeof app.listen> | null = null

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve())
  })
  baseUrl = `http://127.0.0.1:${(server!.address() as { port: number }).port}`
  // 酷狗 CDN 一律 mock，只放行打到本地测试服务器的请求
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.startsWith(baseUrl)) return realFetch(input, init)
    upstreamCalls.push(url)
    return new Response('audio-bytes', {
      status: 200,
      headers: { 'content-type': upstreamContentType, 'content-length': '11' },
    })
  }
})

after(() => {
  globalThis.fetch = realFetch
  server?.close()
  db.close()
  rmSync(testDataDir, { recursive: true, force: true })
})

function proxyUrl(audioUrl: string): string {
  return `${baseUrl}/api/music/kugou-audio-proxy?url=${encodeURIComponent(audioUrl)}`
}

test('rejects Kugou URLs the server never resolved without contacting upstream', async () => {
  upstreamCalls.length = 0
  const response = await fetch(proxyUrl('https://www.kugou.com/any/page.html'))
  assert.equal(response.status, 403)
  assert.deepEqual(upstreamCalls, [])
})

test('proxies a resolved Kugou URL with nosniff and the upstream audio type', async () => {
  upstreamCalls.length = 0
  upstreamContentType = 'audio/mpeg'
  const audioUrl = 'https://webfs.kugou.com/issued/track-1.mp3'
  registerIssuedKugouAudio(audioUrl)

  const response = await fetch(proxyUrl(audioUrl))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'audio/mpeg')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(await response.text(), 'audio-bytes')
  assert.deepEqual(upstreamCalls, [audioUrl])
})

test('does not pass through non-audio upstream content types', async () => {
  upstreamContentType = 'text/html; charset=utf-8'
  const audioUrl = 'https://webfs.kugou.com/issued/track-2.mp3'
  registerIssuedKugouAudio(audioUrl)

  const response = await fetch(proxyUrl(audioUrl))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/octet-stream')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  await response.arrayBuffer()
})
