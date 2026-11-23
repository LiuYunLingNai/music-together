import test from 'node:test'
import assert from 'node:assert/strict'
import { listeningSampleSchema, type ListeningObservation, type LocalListeningSource } from '@music-together/shared'
import { KugouListeningSessions } from '../src/services/kugouListeningSession.js'
import { SoloListeningService, type SoloBinding } from '../src/services/soloListeningService.js'
import type { RemoteListeningWriter } from '../src/services/remoteListeningWriter.js'

const recording = {
  accountId: '11',
  albumAudioId: '22',
  fileHash: 'f'.repeat(32),
  fileSizeBytes: 1_000_000,
  bitrateKbps: 128,
  device: { mid: '33', uuid: BigInt(33).toString(16).padStart(32, '0'), dfid: '-' },
}
const next = { ownerId: 'owner', recording: { ...recording, albumAudioId: '33' }, title: 'Next', durationMs: 180_000 }
const environment = {
  model: 'MusicTogetherWeb',
  os: 'Windows',
  width: 1920,
  height: 1080,
  network: 'wifi',
}

function setup(startResult?: Promise<boolean>) {
  let now = 0
  let wall = 1_700_000_000_000
  let authorized = true
  const writes: Parameters<RemoteListeningWriter['submit']>[0][] = []
  const starts: Parameters<RemoteListeningWriter['start']>[0][] = []
  const invitations: (ListeningObservation | null)[] = []
  const sessions = new KugouListeningSessions(
    {
      start: async (listen) => {
        starts.push(listen)
        return startResult ?? true
      },
      submit: async (listen) => {
        writes.push(listen)
      },
      cancel: () => {},
    },
    () => now,
    () => wall,
  )
  const binding = {
    roomId: 'room',
    ownerId: 'owner',
    socketId: 'socket',
    trackId: 'entry',
    streamUrl: 'audio',
    durationMs: 180_000,
    recording,
    title: 'Track',
    resolveCookie: () => 'token=secret;userid=11',
    stillAuthorized: () => authorized,
    observe: (msg: ListeningObservation | null) => {
      invitations.push(msg)
    },
  }
  sessions.begin(binding)
  const sessionId = invitations[0]!.sessionId
  const sample = (positionMs: number, segment = 0, socket = 'socket', owner = 'owner', url = 'audio') => {
    sessions.sample(
      'room',
      owner,
      socket,
      { id: 'entry', streamUrl: url },
      { sessionId, segment, positionMs, durationMs: 180_000, environment },
    )
  }
  const advance = (ms: number) => {
    now += ms
    wall += ms
  }
  const final = (positionMs: number, segment = 0, socket = 'socket', naturallyEnded = false) =>
    sessions.finalSample('room', 'owner', socket, {
      sessionId,
      segment,
      positionMs,
      durationMs: 180_000,
      environment,
      final: true,
      ...(naturallyEnded ? { naturallyEnded: true as const } : {}),
    })
  const play = (start: number, length: number, segment = 0) => {
    sample(start, segment)
    for (let ms = 1000; ms <= length; ms += 1000) {
      advance(1000)
      sample(start + ms, segment)
    }
  }
  return {
    sessions,
    writes,
    starts,
    binding,
    invitations,
    advance,
    play,
    sample,
    final,
    revoke: () => {
      authorized = false
    },
  }
}

test('credits two real 30s segments once; pause, forward seek and a second socket do not add time', async () => {
  const h = setup()
  h.sessions.begin({ ...h.binding, roomId: 'another-room', socketId: 'another-socket' })
  assert.equal(h.invitations.length, 1)
  h.play(0, 30_000)
  h.sessions.interrupt('room')
  h.advance(15_000)
  h.play(75_000, 29_000, 1)
  h.advance(1_000)
  h.sample(105_000, 1, 'second-socket')
  h.sample(105_000, 1, 'socket', 'other-owner')
  h.sample(105_000, 1, 'socket', 'owner', 'other-stream')
  h.sessions.finish('room', next)
  assert.equal(h.invitations.at(-1)?.final, true)
  await h.final(105_000, 1, 'second-socket')
  assert.equal(h.writes.length, 0)
  await Promise.all([h.final(105_000, 1), h.final(105_000, 1)])
  assert.equal(h.writes.length, 1)
  assert.equal(h.writes[0].netPlayedMs, 60_000)
  assert.equal(h.writes[0].finalPositionMs, 105_000)
  assert.equal(h.writes[0].next.recording.albumAudioId, '33')
})

test('wall clock, missing progress, a media jump, or a background gap cannot earn the 30s minimum', async () => {
  const h = setup()
  h.play(0, 28_000)
  h.advance(1_000)
  h.sample(28_000)
  h.advance(1_000)
  h.sample(60_000)
  h.advance(12_000)
  h.sample(72_000)
  await h.sessions.finish('room', next)
  await h.final(72_000)
  assert.deepEqual(h.writes, [])
  assert.equal(
    listeningSampleSchema.safeParse({
      sessionId: h.invitations[0]!.sessionId,
      segment: 0,
      positionMs: 10_000,
      durationMs: 5_000,
    }).success,
    false,
  )
  assert.equal(
    listeningSampleSchema.safeParse({
      sessionId: h.invitations[0]!.sessionId,
      segment: 0,
      positionMs: 180_000,
      durationMs: 180_000,
      naturallyEnded: true,
    }).success,
    false,
  )
})

test('requires a fresh owner sample and a verified next track under the same account', async () => {
  for (const reason of ['revoke', 'disconnect', 'missing-next', 'new-owner', 'new-account', 'stale', 'old-client']) {
    const h = setup()
    if (reason !== 'old-client') h.play(0, 40_000)
    if (reason === 'revoke') h.revoke()
    if (reason === 'disconnect') h.sessions.cancelSocket('room', 'socket')
    if (reason === 'stale') h.advance(10_000)
    await h.sessions.finish(
      'room',
      reason === 'missing-next'
        ? undefined
        : reason === 'new-owner'
          ? { ...next, ownerId: 'other' }
          : reason === 'new-account'
            ? { ...next, recording: { ...next.recording, accountId: '44' } }
            : next,
    )
    await h.final(40_000)
    assert.equal(h.writes.length, 0, reason)
  }
})

test('missing, late, discontinuous, or revoked final position never substitutes the last heartbeat', async () => {
  for (const reason of ['missing', 'late', 'seek', 'revoke']) {
    const h = setup()
    h.play(0, 40_000)
    h.sessions.finish('room', next)
    if (reason === 'late') h.advance(2_001)
    if (reason === 'revoke') h.revoke()
    if (reason !== 'missing') await h.final(40_000, reason === 'seek' ? 1 : 0)
    assert.equal(h.writes.length, 0, reason)
    h.sessions.cancel('room')
  }
})

test('preserves a confirmed segment when the owner pauses and then switches tracks', async () => {
  const h = setup()
  h.play(0, 40_000)
  h.sessions.pause('room')
  h.advance(15_000)
  h.sessions.finish('room', next)
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(h.writes.length, 1)
  assert.equal(h.writes[0].netPlayedMs, 40_000)
})

test('request cooldown delays the next track without poisoning its session', async () => {
  const h = setup()
  h.play(0, 2_000)
  h.sessions.finish('room', next)
  h.sessions.begin({
    ...h.binding,
    trackId: 'second',
    streamUrl: 'audio-second',
    recording: { ...recording, albumAudioId: '44' },
  })
  const sessionId = h.invitations.at(-1)!.sessionId
  h.sessions.sample(
    'room',
    'owner',
    'socket',
    { id: 'second', streamUrl: 'audio-second' },
    { sessionId, segment: 0, positionMs: 0, durationMs: 180_000, environment },
  )
  for (let second = 1; second <= 40; second++) {
    h.advance(1_000)
    h.sessions.sample(
      'room',
      'owner',
      'socket',
      { id: 'second', streamUrl: 'audio-second' },
      { sessionId, segment: 0, positionMs: second * 1_000, durationMs: 180_000, environment },
    )
  }
  h.sessions.finish('room', {
    ...next,
    recording: { ...recording, albumAudioId: '55' },
  })
  await h.sessions.finalSample('room', 'owner', 'socket', {
    sessionId,
    segment: 0,
    positionMs: 40_000,
    durationMs: 180_000,
    environment,
    final: true,
  })
  assert.equal(h.starts.length, 2)
  assert.equal(h.starts.at(-1)?.recording.albumAudioId, '44')
  assert.equal(h.writes.length, 1)
  assert.equal(h.writes[0].netPlayedMs, 40_000)
})

test('continuous-span accounting does not lose time when sample arrival jitters', async () => {
  const h = setup()
  h.sample(0)
  for (let second = 1; second <= 60; second++) {
    h.advance(1_000 + (second % 2) * 200)
    h.sample(second * 1_000)
  }
  h.sessions.finish('room', next)
  await h.final(60_000)
  assert.equal(h.writes.length, 1)
  assert.equal(h.writes[0].netPlayedMs, 60_000)
})

test('captures a native ended signal before automatic track change clears the media position', async () => {
  const h = setup()
  h.play(0, 40_000)
  h.advance(1_000)
  h.sessions.seek('room', true)
  h.sample(179_000, 1)
  h.advance(1_000)
  await h.sessions.finalSample('room', 'owner', 'socket', {
    sessionId: h.invitations[0]!.sessionId,
    segment: 1,
    positionMs: 180_000,
    durationMs: 180_000,
    environment,
    final: true,
    naturallyEnded: true,
  })
  h.sessions.finish('room', next)
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(h.writes.length, 1)
  assert.equal(h.writes[0].netPlayedMs, 41_000)
  assert.equal(h.writes[0].finalPositionMs, 180_000)
})

test('accepts a naturally ended track only when the final media position proves completion', async () => {
  const h = setup()
  h.play(0, 40_000)
  h.sessions.finish('room', next)
  h.advance(1_000)
  await h.final(180_000, 1, 'socket', true)
  assert.equal(h.writes.length, 0)

  const completed = setup()
  completed.play(0, 179_000)
  completed.sessions.finish('room', next)
  completed.advance(1_000)
  await completed.final(180_000, 1, 'socket', true)
  assert.equal(completed.writes.length, 1)
  assert.equal(completed.writes[0].netPlayedMs, 180_000)
  assert.equal(completed.writes[0].finalPositionMs, 180_000)
})

test('unconfigured service never requests observation', async () => {
  const { binding } = setup()
  const disabled = new KugouListeningSessions()
  disabled.begin({ ...binding, observe: () => assert.fail('unexpected observation') })
  assert.equal(disabled.available, false)
  await disabled.finish('room', next)
})

test('revocation, leaving, or losing the socket while the start is pending prevents settlement', async () => {
  for (const reason of ['revoke', 'socket', 'room', 'owner']) {
    let release!: (ok: boolean) => void
    const h = setup(
      new Promise<boolean>((resolve) => {
        release = resolve
      }),
    )
    h.play(0, 40_000)
    h.sessions.finish('room', next)
    const settling = h.final(40_000)
    if (reason === 'revoke') h.revoke()
    if (reason === 'room') h.sessions.cancel('room')
    if (reason === 'socket') h.sessions.cancelSocket('room', 'socket')
    if (reason === 'owner') h.sessions.cancelOwner('owner')
    release(true)
    await settling
    assert.equal(h.writes.length, 0, reason)
  }
})

test('local observers clear on account change, revocation or disconnect without affecting another page', () => {
  const { sessions, starts, writes } = setup()
  const seen: (LocalListeningSource | null)[][] = [[], []]
  const pages = new Map(
    seen.map((events, i) => [
      `tab${i}`,
      (source: LocalListeningSource | null) => {
        events.push(source)
      },
    ]),
  )
  const binding = { ownerId: 'owner', accountId: 'A', version: 'v1', pages }
  const source = { roomId: 'room', trackId: 'track', streamUrl: 'audio' }
  sessions.setLocalPages('room', binding, source)
  sessions.setLocalPages('room', { ...binding, accountId: 'B', pages: new Map(pages) }, source)
  sessions.cancelSocket('room', 'tab1')
  sessions.cancelOwner('other')
  assert.deepEqual(seen[0], [source, null, source])
  assert.deepEqual(seen[1], [source, null, source, null])
  sessions.cancelOwner('owner')
  assert.deepEqual(seen[0], [source, null, source, null])
  assert.equal(starts.length + writes.length, 0)
})

test('a silent web tab cannot block the account owner tab that is actually listening', async () => {
  const h = setup()
  const idle: (ListeningObservation | null)[] = []
  const active: (ListeningObservation | null)[] = []
  h.sessions.cancel('room')
  h.sessions.begin([
    { ...h.binding, socketId: 'idle', observe: (request) => idle.push(request) },
    { ...h.binding, socketId: 'active', observe: (request) => active.push(request) },
  ])
  const sessionId = active[0]!.sessionId
  h.sessions.sample(
    'room',
    'owner',
    'active',
    { id: 'entry', streamUrl: 'audio' },
    {
      sessionId,
      segment: 0,
      positionMs: 0,
      durationMs: 180_000,
      environment,
    },
  )
  for (let second = 1; second <= 40; second++) {
    h.advance(1_000)
    h.sessions.sample(
      'room',
      'owner',
      'active',
      { id: 'entry', streamUrl: 'audio' },
      {
        sessionId,
        segment: 0,
        positionMs: second * 1_000,
        durationMs: 180_000,
        environment,
      },
    )
  }
  h.sessions.finish('room', next)
  await h.sessions.finalSample('room', 'owner', 'active', {
    sessionId,
    segment: 0,
    positionMs: 40_000,
    durationMs: 180_000,
    environment,
    final: true,
  })
  assert.equal(idle.at(-1), null)
  assert.equal(h.writes.length, 1)
  assert.equal(h.writes[0].netPlayedMs, 40_000)
})

test('only the invited account and one output at a time can settle; replay, overlap and late samples add nothing', async () => {
  let now = 0
  const service = new SoloListeningService(() => now)
  const settlements: number[] = []
  const source = { ownerId: 'owner', recording, title: 'A', durationMs: 180_000 }
  const binding: SoloBinding = {
    ownerId: 'owner',
    accountId: '123',
    version: 'v1',
    trackId: 'A',
    albumAudioId: '42',
    durationMs: 180_000,
    sockets: new Set(['web', 'other']),
    source,
    authorized: () => true,
    start: async () => true,
    cancel: () => {},
    settled: ({ milliseconds }) => settlements.push(milliseconds),
  }
  const a = service.offer('room', binding)!
  const another = service.offer('second-room', { ...binding, sockets: new Set(['second']) })!
  const sample = (id: string, pos: number, socket = 'web', owner = 'owner', room = 'room', segment = 0) =>
    service.accept(room, owner, socket, {
      kind: 'sample',
      sessionId: id,
      segment,
      positionMs: pos,
      durationMs: 180_000,
      environment,
    })
  const end = (id: string, socket = 'web') => service.accept('room', 'owner', socket, { kind: 'end', sessionId: id })
  for (let i = 0; i <= 40; i++) {
    now = 1_000 * i + (i % 2) * 200
    sample(a, i * 1_000, 'stranger')
    sample(a, i * 1_000, 'web', 'stranger')
    sample(a, i * 1_000)
    sample(a, i * 1_000, 'other')
    sample(another, i * 1_000, 'second', 'owner', 'second-room')
  }
  const b = service.offer('room', { ...binding, trackId: 'B', albumAudioId: '43' })!
  end(a, 'other')
  end(a, 'stranger')
  assert.deepEqual(settlements, [])
  now += 4_000
  end(a)
  end(a)
  sample(a, 44_000)
  sample(b, 4_000)
  for (let i = 1; i <= 40; i++) {
    now += 1000
    sample(b, 4_000 + i * 1000)
  }
  service.retire('room')
  end(b)
  end(b)
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual(settlements, [40_000, 40_000])
  service.retire('second-room')
  service.accept('second-room', 'owner', 'second', { kind: 'end', sessionId: another })
  assert.equal(settlements.length, 2)
})

test('account change, disabled consent, stale replays or an unverifiable recording cannot settle a transition', () => {
  for (const cause of ['account', 'revoke', 'room', 'version', 'short', 'hash']) {
    let now = 0,
      allowed = true
    const service = new SoloListeningService(() => now)
    const binding: SoloBinding = {
      ownerId: 'owner',
      accountId: 'one',
      version: '1',
      durationMs: 180_000,
      trackId: 'A',
      albumAudioId: cause === 'hash' ? 'a'.repeat(32) : '42',
      sockets: new Set(['web']),
      source: { ownerId: 'owner', recording, title: 'A', durationMs: 180_000 },
      authorized: () => allowed,
      start: async () => true,
      cancel: () => {},
      settled: () => assert.fail(cause),
    }
    const first = service.offer('room', binding)
    if (cause === 'hash') {
      assert.equal(first, undefined)
      continue
    }
    assert.ok(first)
    for (let i = 0; i <= (cause === 'short' ? 29 : 40); i++) {
      now = i * 1000
      service.accept('room', 'owner', 'web', {
        kind: 'sample',
        sessionId: first,
        segment: 0,
        positionMs: now,
        durationMs: 180_000,
        environment,
      })
    }
    allowed = cause !== 'revoke'
    service.offer('room', {
      ...binding,
      trackId: 'B',
      albumAudioId: '43',
      accountId: cause === 'account' ? 'two' : 'one',
      version: cause === 'version' ? '2' : '1',
    })
    if (cause === 'room') service.clear('room')
    service.accept('room', 'owner', 'web', { kind: 'end', sessionId: first })
  }
})

test('a verified transition start and settlement reach the ordinary writer exactly once', async () => {
  const h = setup()
  const sourceA = { ownerId: 'owner', recording, title: 'A', durationMs: 180_000 }
  const sourceB = { ownerId: 'owner', recording: { ...recording, albumAudioId: '44' }, title: 'B', durationMs: 180_000 }
  const solo = h.sessions.solo
  const offer = (source: typeof sourceA, albumAudioId: string) =>
    solo.offer('room', {
      ownerId: 'owner',
      accountId: '11',
      version: 'v1',
      trackId: source.title,
      albumAudioId,
      durationMs: 180_000,
      sockets: new Set(['web']),
      source,
      authorized: () => true,
      start: (ctx) =>
        h.sessions.startSolo({
          ...source,
          roomId: 'room',
          sessionId: ctx.sessionId,
          cookie: 'token=secret;userid=11',
          positionMs: ctx.positionMs,
          startedAt: ctx.startedAt,
          environment: ctx.environment,
          stillAuthorized: () => true,
        }),
      settled: (ctx) => {
        if (ctx.next)
          void h.sessions.settleSolo({
            ...source,
            roomId: 'room',
            sessionId: ctx.sessionId,
            next: ctx.next,
            mediaDurationMs: ctx.mediaDurationMs,
            finalPositionMs: ctx.finalPositionMs,
            startedAt: ctx.startedAt,
            endedAt: ctx.endedAt,
            netPlayedMs: ctx.milliseconds,
          })
      },
      cancel: (sessionId) => h.sessions.cancelSolo(sessionId),
    })
  const a = offer(sourceA, '22')!
  for (let i = 0; i <= 40; i++) {
    if (i > 0) h.advance(1000)
    solo.accept('room', 'owner', 'web', {
      kind: 'sample',
      sessionId: a,
      segment: 0,
      positionMs: i * 1000,
      durationMs: 180_000,
      environment,
    })
  }
  const b = offer(sourceB, '44')!
  assert.ok(b)
  solo.accept('room', 'owner', 'web', { kind: 'end', sessionId: a })
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(h.starts.length, 1)
  assert.equal(h.starts[0].recording.albumAudioId, '22')
  assert.equal(h.writes.length, 1)
  assert.equal(h.writes[0].netPlayedMs, 40_000)
  assert.equal(h.writes[0].next.recording.albumAudioId, '44')
})

test('a direct session survives a short page reconnect without counting the disconnected gap', async () => {
  const h = setup()
  h.play(0, 40_000)
  h.sessions.cancelSocket('room', 'socket')
  assert.ok(h.sessions.recoverable('room'))

  const secondInvites: (ListeningObservation | null)[] = []
  assert.equal(
    h.sessions.reattach({
      ...h.binding,
      socketId: 'socket-2',
      observe: (request) => secondInvites.push(request),
    }),
    true,
  )
  assert.equal(secondInvites[0]?.sessionId, h.invitations[0]!.sessionId)

  h.advance(15_000)
  h.sample(55_000, 0, 'socket-2')
  for (let position = 56_000; position <= 75_000; position += 1_000) {
    h.advance(1_000)
    h.sample(position, 0, 'socket-2')
  }
  h.sessions.pause('room')
  h.sessions.finish('room', next)
  await new Promise<void>((resolve) => setImmediate(resolve))

  assert.equal(h.writes.length, 1)
  assert.equal(h.writes[0].netPlayedMs, 60_000)
})

test('a transition session keeps its started writer and banks time across a page reconnect', async () => {
  let now = 0
  const service = new SoloListeningService(() => now)
  const settlements: number[] = []
  const source = { ownerId: 'owner', recording, title: 'A', durationMs: 180_000 }
  const binding: SoloBinding = {
    ownerId: 'owner',
    accountId: '11',
    version: 'v1',
    trackId: 'A',
    albumAudioId: '22',
    durationMs: 180_000,
    sockets: new Set(['web']),
    source,
    authorized: () => true,
    start: async () => true,
    cancel: () => {},
    settled: ({ milliseconds }) => settlements.push(milliseconds),
  }
  const a = service.offer('room', binding)!
  const sample = (positionMs: number, socket = 'web') =>
    service.accept('room', 'owner', socket, {
      kind: 'sample',
      sessionId: a,
      segment: 0,
      positionMs,
      durationMs: 180_000,
      environment,
    })
  for (let position = 0; position <= 40_000; position += 1_000) {
    if (position > 0) now += 1_000
    sample(position)
  }

  service.disconnect('room', 'web')
  assert.equal(service.needsReconnect('room'), true)
  assert.equal(service.attach('room', ['web-2']).current, a)
  service.offer('room', {
    ...binding,
    trackId: 'B',
    albumAudioId: '33',
    sockets: new Set(['web-2']),
    source: { ...source, title: 'B', recording: { ...recording, albumAudioId: '33' } },
  })
  sample(41_000, 'web-2')
  for (let position = 42_000; position <= 61_000; position += 1_000) {
    now += 1_000
    sample(position, 'web-2')
  }
  service.accept('room', 'owner', 'web-2', { kind: 'end', sessionId: a })
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual(settlements, [60_000])
})
