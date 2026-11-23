import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash, createHmac, generateKeyPairSync } from 'node:crypto'
import { HttpRemoteListeningWriter, type RemoteAdapterConfig } from '../src/services/remoteListeningWriter.js'

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2_048 })
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const now = Date.now()
const sessionId = 'd2e302d7-1bb7-4b12-9469-a48be6da6899'
const source = {
  ownerId: 'owner',
  recording: {
    accountId: '1234567890',
    albumAudioId: '615188888',
    fileHash: 'a'.repeat(32),
    fileSizeBytes: 3_179_554,
    bitrateKbps: 320,
    device: {
      mid: '12345678901234567890123456789012345678',
      uuid: BigInt('12345678901234567890123456789012345678').toString(16).padStart(32, '0'),
      dfid: '-',
    },
  },
  title: '晴天',
  durationMs: 198_000,
}
const startInput = {
  ...source,
  roomId: 'room',
  sessionId,
  cookie: `token=${'t'.repeat(160)};userid=1234567890`,
  positionMs: 1_000,
  startedAt: now - 1_000,
  environment: {
    model: 'MusicTogetherWeb',
    os: 'Windows',
    width: 1920,
    height: 1080,
    network: 'wifi',
  },
  stillAuthorized: () => true,
}
const finishInput = {
  ...source,
  roomId: 'room',
  sessionId,
  mediaDurationMs: 198_656,
  finalPositionMs: 112_087,
  startedAt: now - 60_000,
  endedAt: now,
  netPlayedMs: 60_000,
  next: {
    ownerId: 'owner',
    recording: { ...source.recording, albumAudioId: '356216045' },
    title: '小星星',
    durationMs: 71_448,
  },
}

function config(overrides: Partial<RemoteAdapterConfig> = {}): RemoteAdapterConfig {
  return {
    url: 'https://adapter.example.com',
    instanceId: 'instance-a',
    instanceSecret: 's'.repeat(48),
    cookiePublicKey: publicKeyPem,
    timeoutMs: 2_000,
    ...overrides,
  }
}

test('stays disabled unless every adapter setting is present', () => {
  const writer = new HttpRemoteListeningWriter(config({ instanceSecret: '' }))
  assert.equal(writer.available, false)
  assert.equal(new HttpRemoteListeningWriter(config({ cookiePublicKey: 'invalid' })).available, false)
  assert.equal(new HttpRemoteListeningWriter(config({ url: 'http://adapter.example.com' })).available, false)
})

test('signs start requests, encrypts cookies, and finishes only with an explicit accepted receipt', async () => {
  const requests: { path: string; headers: Headers; body: string }[] = []
  const writer = new HttpRemoteListeningWriter(config(), async (input, init) => {
    const url = new URL(String(input))
    const body = String(init?.body ?? '')
    requests.push({ path: url.pathname, headers: new Headers(init?.headers), body })
    if (url.pathname.endsWith('/start')) {
      return Response.json({
        accepted: true,
        outcome: 'accepted',
        resumeToken: 'r'.repeat(96),
        expiresAt: Date.now() + 60_000,
        gradeSynced: false,
      })
    }
    return Response.json({ accepted: true, outcome: 'accepted', gradeSynced: false })
  })

  assert.equal(await writer.start(startInput), true)
  assert.equal(requests.length, 1)
  const started = requests[0]!
  assert.equal(started.path, '/v1/kugou/start')
  assert.equal(started.body.includes(startInput.cookie), false)
  assert.match(started.body, /AES-256-GCM\+RSA-OAEP-SHA256/)
  const timestamp = started.headers.get('x-mt-timestamp')!
  const nonce = started.headers.get('x-mt-nonce')!
  const bodyHash = createHash('sha256').update(started.body).digest('hex')
  const expected = createHmac('sha256', config().instanceSecret)
    .update(`${timestamp}\n${nonce}\nPOST\n/v1/kugou/start\n${bodyHash}`)
    .digest('hex')
  assert.equal(started.headers.get('x-mt-signature'), expected)

  await writer.submit(finishInput)
  assert.equal(requests.length, 2)
  assert.equal(requests[1]!.path, '/v1/kugou/finish')
  await writer.submit(finishInput)
  assert.equal(requests.length, 2)
})

test('treats malformed, empty, and business-error responses as not accepted', async () => {
  for (const response of [
    new Response('{}', { status: 200 }),
    new Response('<html>ok</html>', { status: 200 }),
    new Response(null, { status: 204 }),
    Response.json({ accepted: false, outcome: 'rejected', code: 'UPSTREAM_REJECTED' }),
  ]) {
    const writer = new HttpRemoteListeningWriter(config(), async () => response.clone())
    assert.equal(await writer.start(startInput), false)
  }
})

test('withdrawal suppresses the pending completion even when the transport returns success', async () => {
  let authorized = true
  let release!: () => void
  let entered!: () => void
  const waiting = new Promise<void>((resolve) => {
    entered = resolve
  })
  const hold = new Promise<void>((resolve) => {
    release = resolve
  })
  const writer = new HttpRemoteListeningWriter(config(), async (_input, init) => {
    const path = new URL(String(_input)).pathname
    if (path.endsWith('/start')) {
      return Response.json({
        accepted: true,
        outcome: 'accepted',
        resumeToken: 'r'.repeat(96),
        expiresAt: Date.now() + 60_000,
        gradeSynced: false,
      })
    }
    entered()
    await hold
    assert.ok(init?.signal)
    return Response.json({ accepted: true, outcome: 'accepted', gradeSynced: false })
  })
  const input = { ...startInput, stillAuthorized: () => authorized }
  assert.equal(await writer.start(input), true)
  const submitting = writer.submit({
    ...finishInput,
    startedAt: input.startedAt,
    endedAt: input.startedAt + 60_000,
  })
  await waiting
  authorized = false
  writer.cancel(sessionId)
  release()
  await submitting
  writer.cancel(sessionId)
})

test('adapter timeouts fail closed without retaining a finish session', async () => {
  let calls = 0
  const writer = new HttpRemoteListeningWriter(config({ timeoutMs: 20 }), async (_input, init) => {
    calls += 1
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })
  })
  assert.equal(await writer.start(startInput), false)
  assert.equal(calls, 1)
  await writer.submit(finishInput)
  assert.equal(calls, 1)
})
