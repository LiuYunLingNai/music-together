import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import test from 'node:test'
import type { KugouListeningReport, Track } from '@music-together/shared'
import { kugouListeningSchema } from '@music-together/shared'
import { createKugouListeningApi } from '../src/services/kugouListeningApi.js'
import { createKugouListeningService } from '../src/services/kugouListeningService.js'
import { createKugouListeningRouter } from '../src/controllers/kugouListeningController.js'
import express from 'express'

// Synthetic credentials are generated, never printed or sent to a live platform.
const cookie = `token=${randomBytes(16).toString('hex')};userid=12345`
function harness() {
  let time = 1000
  const submissions: { baseline: number; seconds: number }[] = []
  let fail = false
  let queries = 0
  const service = createKugouListeningService(
    {
      async query() {
        queries++
        return 100
      },
      async submit(_cookie, baseline, seconds) {
        submissions.push({ baseline, seconds })
        if (fail) throw new Error('simulated upstream failure')
        return baseline
      },
    },
    () => time,
  )
  const input: KugouListeningReport = {
    roomId: 'room',
    trackId: 'track',
    sessionId: randomUUID(),
    listenedMs: 0,
    ended: false,
  }
  const context = { userId: 'user', cookie, currentTrackId: 'track' }
  return {
    service,
    submissions,
    input,
    context,
    advance: (ms: number) => {
      time += ms
    },
    fail: () => {
      fail = true
    },
    queries: () => queries,
  }
}

test('requires an authenticated zero baseline and a current standard Kugou track', async () => {
  const h = harness()
  assert.equal((await h.service.report({ ...h.input, listenedMs: 10 }, h.context)).status, 'invalid_session')
  assert.equal((await h.service.report(h.input, { ...h.context, currentTrackId: null })).status, 'invalid_session')
  assert.equal((await h.service.report(h.input, { ...h.context, cookie: '' })).status, 'not_logged_in')
  assert.equal(h.queries(), 0)
})

test('flushes real increments on pause/end, ignores duplicates and maintains a nondecreasing baseline', async () => {
  const h = harness()
  await h.service.report(h.input, h.context)
  h.advance(15_000)
  const paused = { ...h.input, listenedMs: 12_000, flush: true }
  assert.equal((await h.service.report(paused, h.context)).status, 'submitted')
  await h.service.report(paused, h.context)
  h.advance(15_000)
  const end = { ...h.input, listenedMs: 22_000, ended: true }
  await h.service.report(end, { ...h.context, currentTrackId: 'next-track' })
  await h.service.report(end, h.context)
  assert.deepEqual(h.submissions, [
    { baseline: 100, seconds: 12 },
    { baseline: 112, seconds: 10 },
  ])
})

test('caps elapsed time and deduplicates the same platform account across identities and devices', async () => {
  const h = harness()
  const other = { ...h.input, sessionId: randomUUID() }
  const otherContext = { ...h.context, userId: 'another-identity' }
  await h.service.report(h.input, h.context)
  await h.service.report(other, otherContext)
  h.advance(15_000)
  await h.service.report({ ...h.input, listenedMs: 99_000, ended: true }, h.context)
  await h.service.report({ ...other, listenedMs: 99_000, ended: true }, otherContext)
  assert.equal(
    h.submissions.reduce((sum, row) => sum + row.seconds, 0),
    15,
  )
})

test('batches minute updates, limits disconnected backfill and expires sessions', async () => {
  const h = harness()
  await h.service.report(h.input, h.context)
  for (let i = 1; i <= 4; i++) {
    h.advance(15_000)
    await h.service.report({ ...h.input, listenedMs: i * 15_000 }, h.context)
  }
  assert.deepEqual(h.submissions, [{ baseline: 100, seconds: 60 }])
  h.advance(120_000)
  await h.service.report({ ...h.input, listenedMs: 180_000, ended: true }, h.context)
  assert.equal(h.submissions[1]?.seconds, 30)
  h.advance(601_000)
  assert.equal(
    (await h.service.report({ ...h.input, listenedMs: 180_000, ended: true }, h.context)).status,
    'invalid_session',
  )
})

test('never retries an uncertain increment and rejects account/session rebinding', async () => {
  const h = harness()
  await h.service.report(h.input, h.context)
  h.fail()
  h.advance(15_000)
  const end = { ...h.input, listenedMs: 15_000, ended: true }
  assert.equal((await h.service.report(end, h.context)).status, 'upstream_unavailable')
  await h.service.report(end, h.context)
  assert.equal(h.submissions.length, 1)
  assert.equal(
    (await h.service.report(end, { ...h.context, cookie: cookie.replace('12345', '54321') })).status,
    'invalid_session',
  )
  assert.equal((await h.service.report({ ...end, roomId: 'other-room' }, h.context)).status, 'invalid_session')
})

test('grade protocol queries before submitting and encrypts authorization without sending a raw token', async () => {
  const bodies: Record<string, unknown>[] = []
  const api = createKugouListeningApi(async (url, options) => {
    assert.equal(new URL(String(url)).protocol, 'https:')
    const data = JSON.parse(String(options?.body)) as Record<string, unknown>
    bodies.push(data)
    assert.match(String(data.p), /^[0-9A-F]{256}$/)
    assert.equal(String(options?.body).includes(cookie.split(';')[0].split('=')[1]), false)
    return Response.json({ status: 1, error_code: 0, data: { d_sec: 100 } })
  })
  const baseline = await api.query(cookie)
  await api.submit(cookie, baseline, 15)
  assert.equal(bodies[0].diff_sec, undefined)
  assert.equal(bodies[1].d_sec, 100)
  assert.equal(bodies[1].diff_sec, 15)
  assert.equal(bodies[1].appid, '3116')
})

test('serializes account submissions while accepting later samples', async () => {
  let time = 0
  let release!: (value: number) => void
  let queryCount = 0
  const submissions: number[] = []
  const service = createKugouListeningService(
    {
      query: () =>
        ++queryCount === 1
          ? new Promise<number>((resolve) => {
              release = resolve
            })
          : Promise.resolve(100),
      submit: async (_cookie, _baseline, seconds) => {
        submissions.push(seconds)
        return 100
      },
    },
    () => time,
  )
  const input = harness().input
  const context = { userId: 'user', cookie, currentTrackId: 'track' }
  await service.report(input, context)
  time = 15_000
  const pending = service.report({ ...input, listenedMs: 15_000, flush: true }, context)
  time = 30_000
  await service.report({ ...input, listenedMs: 30_000, flush: true }, context)
  assert.equal(queryCount, 1)
  release(100)
  await pending
  await service.report({ ...input, listenedMs: 30_000, ended: true }, context)
  assert.deepEqual(submissions, [15, 15])
})

test('grade protocol rejects malformed baselines, HTTP errors and business failures', async () => {
  for (const response of [
    Response.json({ status: 1, data: {} }),
    Response.json({ status: 1, data: { d_sec: [] } }),
    Response.json({ status: 1, data: { d_sec: '' } }),
    Response.json({ status: 0 }),
    new Response('', { status: 502 }),
  ]) {
    const api = createKugouListeningApi(async () => response)
    await assert.rejects(api.query(cookie))
  }
})

test('REST checks identity, membership, own authorization and standard-only tracks', async () => {
  const h = harness()
  const track = { id: 'track', source: 'kugou_concept' } as Track
  let authenticated = false
  let member = false
  let authorized = false
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    if (authenticated) req.identityUserId = 'user'
    next()
  })
  app.use(
    createKugouListeningRouter({
      getRoom: () => ({ users: member ? [{ id: 'user' }] : [], currentTrack: track }),
      getCookie: (userId) => {
        assert.equal(userId, 'user')
        return authorized ? cookie : null
      },
      service: h.service,
    }),
  )
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/kugou-listening`
  const post = (body: unknown = h.input) =>
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  try {
    assert.equal((await post()).status, 401)
    authenticated = true
    assert.equal((await post()).status, 403)
    member = true
    assert.equal((await (await post()).json()).status, 'not_logged_in')
    authorized = true
    assert.equal((await (await post()).json()).status, 'invalid_session')
    track.source = 'kugou'
    assert.equal((await (await post()).json()).status, 'accepted')
    assert.equal((await post({ ...h.input, listenedMs: -1 })).status, 400)
    assert.equal(h.queries(), 0)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
})

test('shared input bounds reject NaN, negative totals and unbounded identifiers', () => {
  const { input } = harness()
  for (const patch of [
    { listenedMs: NaN },
    { listenedMs: -1 },
    { listenedMs: 43_200_001 },
    { trackId: 'x'.repeat(201) },
    { sessionId: 'invalid' },
  ]) {
    assert.equal(kugouListeningSchema.safeParse({ ...input, ...patch }).success, false)
  }
})
