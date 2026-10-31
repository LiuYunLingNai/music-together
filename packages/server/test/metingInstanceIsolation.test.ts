import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

const testDataDir = mkdtempSync(path.join(tmpdir(), 'music-together-meting-isolation-'))
process.env.DATABASE_URL = `file:${path.join(testDataDir, 'test.db')}`
process.env.LOG_LEVEL = 'silent'

const { musicProvider } = await import('../src/services/musicProvider.js')
const { db } = await import('../src/repositories/database.js')

after(() => {
  db.close()
  rmSync(testDataDir, { recursive: true, force: true })
})

interface ProviderInternals {
  getInstance(source: 'kugou'): { format(value: boolean): unknown }
  createInstance(source: 'kugou'): { format(value: boolean): unknown }
}
const internals = musicProvider as unknown as ProviderInternals

test('lyric and cover lookups no longer share one Meting instance per platform', () => {
  // 共享实例仍然存在（不带 Cookie 的播放地址解析用它），但封面和歌词必须各自新建：
  // 酷狗的 pic() 会在 await 前后保存/恢复实例上的 isFormat，并发时会把它永久写成 false，
  // 之后所有酷狗歌词都返回未解析数据（空歌词还会被缓存 24 小时）。
  const shared1 = internals.getInstance('kugou')
  const shared2 = internals.getInstance('kugou')
  assert.equal(shared1, shared2, 'getInstance 仍按平台复用')

  const fresh1 = internals.createInstance('kugou')
  const fresh2 = internals.createInstance('kugou')
  assert.notEqual(fresh1, fresh2, '每次调用都必须是新实例')
  assert.notEqual(fresh1, shared1, '不能返回共享实例')
})

interface LyricInternals {
  createInstance(source: string): unknown
  lyricCache: { getRemainingTTL(key: string): number; clear(): void }
}

test('an empty lyric result is cached briefly, a real one for the full TTL', async () => {
  const provider = musicProvider as unknown as LyricInternals
  const originalCreate = provider.createInstance
  let payload = '{"lyric":""}'
  // 换掉 Meting 实例：歌词解析不触达线上接口
  provider.createInstance = () => ({
    format: () => undefined,
    lyric: async () => payload,
  })

  try {
    provider.lyricCache.clear()
    const empty = await musicProvider.getLyric('tencent', 'empty-song')
    assert.equal(empty.lyric, '')
    const emptyTtl = provider.lyricCache.getRemainingTTL('tencent:empty-song')
    assert.ok(
      emptyTtl > 0 && emptyTtl <= 5 * 60 * 1000,
      `空歌词多半是上游抖动，TTL 应不超过 5 分钟，实际 ${emptyTtl}`,
    )

    // 带上 tlyric：否则 QQ 分支会去补取译文，测试不应依赖线上接口
    payload = JSON.stringify({ lyric: '[00:01.00]有歌词', tlyric: '[00:01.00]translated' })
    const filled = await musicProvider.getLyric('tencent', 'real-song')
    assert.equal(filled.lyric, '[00:01.00]有歌词')
    assert.ok(
      provider.lyricCache.getRemainingTTL('tencent:real-song') > 60 * 60 * 1000,
      '取到歌词后仍使用默认的长 TTL',
    )
  } finally {
    provider.createInstance = originalCreate
    provider.lyricCache.clear()
  }
})
