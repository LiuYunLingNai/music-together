import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import type { MusicSource, Track } from '@music-together/shared'

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

interface CoverInternals {
  createInstance(source: MusicSource): unknown
  batchResolveCover(tracks: Track[], source: MusicSource): Promise<void>
  coverCache: { clear(): void }
  coverInFlight: Map<string, Promise<string>>
}
const covers = musicProvider as unknown as CoverInternals
const coverTrack = (id: string, picId = id): Track => ({
  id,
  title: id,
  artist: [],
  album: '',
  duration: 180,
  cover: '',
  source: 'kugou',
  sourceId: id,
  urlId: id,
  picId,
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve))

test('single and batch cover requests share one lookup and fill thumbnails on cache hits', async () => {
  const original = covers.createInstance
  const pending = deferred<string>()
  let calls = 0
  covers.coverCache.clear()
  covers.createInstance = () => ({
    pic: () => {
      calls += 1
      return pending.promise
    },
  })
  try {
    const single = musicProvider.getCover('kugou', 'shared-cover')
    const tracks = [coverTrack('first', 'shared-cover'), coverTrack('second', 'shared-cover')]
    const batch = covers.batchResolveCover(tracks, 'kugou')
    await nextTurn()
    assert.equal(calls, 1)
    pending.resolve(JSON.stringify({ url: 'http://imge.kugou.com/stdmusic/5000/cover.jpg' }))
    const cover = await single
    await batch
    assert.match(cover, /^https:/)
    assert.ok(
      tracks.every((track) => track.cover === cover && track.thumbnailCover?.includes('/120/')),
    )
    const cached = [coverTrack('cached', 'shared-cover')]
    await covers.batchResolveCover(cached, 'kugou')
    assert.equal(calls, 1)
    assert.equal(cached[0].thumbnailCover, tracks[0].thumbnailCover)
    assert.equal(covers.coverInFlight.size, 0)
  } finally {
    covers.createInstance = original
    covers.coverCache.clear()
  }
})

test('cover request keys keep source and size separate and map concept only at the provider', async () => {
  const original = covers.createInstance
  const sources: MusicSource[] = []
  const sizes: number[] = []
  const pending = deferred<string>()
  covers.coverCache.clear()
  covers.createInstance = (source) => {
    sources.push(source)
    return {
      pic: (_id: string, size: number) => {
        sizes.push(size)
        return pending.promise
      },
    }
  }
  try {
    const requests = [
      musicProvider.getCover('kugou', 'same', 800),
      musicProvider.getCover('kugou', 'same', 5000),
      musicProvider.getCover('kugou_concept', 'same', 5000),
    ]
    assert.deepEqual(sources, ['kugou', 'kugou', 'kugou'])
    assert.deepEqual(sizes, [800, 5000, 5000])
    assert.equal(covers.coverInFlight.size, 3)
    pending.resolve(JSON.stringify({ url: 'https://example.test/cover.jpg' }))
    await Promise.all(requests)
    assert.equal(covers.coverInFlight.size, 0)
  } finally {
    covers.createInstance = original
    covers.coverCache.clear()
  }
})

test('failed and timed-out cover lookups release in-flight entries for retry', async (t) => {
  const original = covers.createInstance
  covers.coverCache.clear()
  try {
    covers.createInstance = () => ({
      pic: async () => {
        throw new Error('mock upstream failure')
      },
    })
    assert.equal(await musicProvider.getCover('kugou', 'retry'), '')
    assert.equal(covers.coverInFlight.size, 0)
    t.mock.timers.enable({ apis: ['setTimeout'] })
    covers.createInstance = () => ({ pic: () => new Promise<string>(() => {}) })
    const tracks = [coverTrack('retry')]
    const batch = covers.batchResolveCover(tracks, 'kugou')
    await nextTurn()
    t.mock.timers.tick(15_000)
    await batch
    assert.equal(tracks[0].cover, '')
    assert.equal(covers.coverInFlight.size, 0)
    t.mock.timers.reset()
    covers.createInstance = () => ({
      pic: async () => JSON.stringify({ url: 'https://example.test/recovered.jpg' }),
    })
    assert.equal(
      await musicProvider.getCover('kugou', 'retry'),
      'https://example.test/recovered.jpg',
    )
  } finally {
    t.mock.timers.reset()
    covers.createInstance = original
    covers.coverCache.clear()
  }
})

test('batch cover resolution keeps three upstream requests active and leaves existing artwork alone', async () => {
  const original = covers.createInstance
  const pending: Array<ReturnType<typeof deferred<string>>> = []
  let active = 0
  let maximum = 0
  covers.coverCache.clear()
  covers.createInstance = () => ({
    pic: () => {
      active += 1
      maximum = Math.max(maximum, active)
      const task = deferred<string>()
      pending.push(task)
      return task.promise.finally(() => {
        active -= 1
      })
    },
  })
  try {
    const existing = {
      ...coverTrack('existing'),
      cover: 'http://imge.kugou.com/stdmusic/5000/existing.jpg',
    }
    const tracks = [...Array.from({ length: 5 }, (_, i) => coverTrack(String(i))), existing]
    const batch = covers.batchResolveCover(tracks, 'kugou')
    await nextTurn()
    assert.equal(pending.length, 3)
    assert.equal(maximum, 3)
    const response = JSON.stringify({ url: 'https://imge.kugou.com/stdmusic/5000/cover.jpg' })
    for (const task of pending.slice()) task.resolve(response)
    await nextTurn()
    assert.equal(pending.length, 5)
    for (const task of pending) task.resolve(response)
    await batch
    assert.equal(maximum, 3)
    assert.match(existing.cover, /^https:/)
    assert.ok(existing.thumbnailCover?.includes('/120/'))
  } finally {
    covers.createInstance = original
    covers.coverCache.clear()
  }
})
