import WebSocket from 'ws'

const serverUrl = process.env.MT_SERVER_URL || 'https://0music.qqun.top:9872'
const nickname = `Windows-QA-${Date.now().toString(36).slice(-6)}`
const timeoutMs = 15_000

function assert(value, message) {
  if (!value) throw new Error(message)
}

async function createIdentity() {
  const response = await fetch(`${serverUrl}/api/auth/identity/bootstrap`, { method: 'POST' })
  assert(response.status === 204, `identity bootstrap returned ${response.status}`)
  const userId = response.headers.get('x-identity-userid')
  const setCookie = response.headers.get('set-cookie') || ''
  const token = /(?:^|[,;]\s*)mt_identity=([^;]+)/i.exec(setCookie)?.[1]
  assert(userId && token, 'identity response did not include user ID and cookie')
  return { userId, cookie: `mt_identity=${token}` }
}

class ProtocolClient {
  constructor(identity) {
    this.identity = identity
    this.messages = []
    this.waiters = []
  }

  async connect() {
    this.socket = new WebSocket(`${serverUrl.replace(/^http/, 'ws')}/ws`, { headers: { Cookie: this.identity.cookie } })
    this.socket.on('message', (raw) => {
      const message = JSON.parse(String(raw))
      this.messages.push(message)
      for (const waiter of [...this.waiters]) {
        if (waiter.event === message.event && (!waiter.predicate || waiter.predicate(message.data))) {
          waiter.resolve(message.data)
          this.waiters.splice(this.waiters.indexOf(waiter), 1)
        }
      }
    })
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('websocket connect timeout')), timeoutMs)
      this.socket.once('open', () => { clearTimeout(timer); resolve() })
      this.socket.once('error', (error) => { clearTimeout(timer); reject(error) })
    })
  }

  emit(event, data) {
    this.socket.send(JSON.stringify({ event, data }))
  }

  wait(event, predicate, timeout = timeoutMs) {
    const existing = this.messages.find((message) => message.event === event && (!predicate || predicate(message.data)))
    if (existing) return Promise.resolve(existing.data)
    return new Promise((resolve, reject) => {
      const waiter = { event, predicate, resolve: (data) => { clearTimeout(timer); resolve(data) } }
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter)
        if (index >= 0) this.waiters.splice(index, 1)
        reject(new Error(`timeout waiting for ${event}`))
      }, timeout)
      this.waiters.push(waiter)
    })
  }

  clear(event) {
    this.messages = this.messages.filter((message) => message.event !== event)
  }

  close() {
    this.socket?.close()
  }
}

async function searchTracks(cookie, roomId) {
  const params = new URLSearchParams({ source: 'netease', keyword: '晴天', limit: '5', page: '1', type: 'song', roomId })
  const response = await fetch(`${serverUrl}/api/music/search?${params}`, { headers: { Cookie: cookie } })
  assert(response.ok, `search returned ${response.status}`)
  const body = await response.json()
  assert(Array.isArray(body.tracks) && body.tracks.length >= 2, 'search returned fewer than two tracks')
  return body.tracks
}

async function main() {
  const ownerIdentity = await createIdentity()
  let owner = new ProtocolClient(ownerIdentity)
  let member
  let roomId
  try {
    await owner.connect()
    owner.emit('room:list')
    const rooms = await owner.wait('room:list_update', Array.isArray)
    console.log(`OK lobby: ${rooms.length} public room(s)`)

    owner.emit('room:create', { nickname, roomName: `Windows Smoke ${Date.now().toString().slice(-6)}` })
    const created = await owner.wait('room:created', (data) => data?.userId === ownerIdentity.userId)
    roomId = created.roomId
    const initialRoom = await owner.wait('room:state', (room) => room?.id === roomId)
    assert(initialRoom.hostId === ownerIdentity.userId, 'created room hostId does not match identity userId')
    assert(initialRoom.users.find((user) => user.id === ownerIdentity.userId)?.role === 'owner', 'creator is not owner')
    const rejoin = await owner.wait('room:rejoin_token', (data) => data?.roomId === roomId)
    console.log(`OK room create/identity: ${roomId}`)

    const tracks = await searchTracks(ownerIdentity.cookie, roomId)
    owner.emit('queue:add', { track: tracks[0] })
    await owner.wait('queue:updated', (data) => data?.queue?.some((track) => track.id === tracks[0].id))
    const firstPlay = await owner.wait('player:play', (data) => data?.track?.id === tracks[0].id, 30_000)
    assert(firstPlay.track.streamUrl, 'playing track has no stream URL')
    owner.clear('queue:updated')
    owner.emit('queue:add', { track: tracks[1] })
    const twoTrackQueue = await owner.wait('queue:updated', (data) => data?.queue?.length >= 2)
    console.log('OK search, queue add, and playback start')

    owner.clear('player:pause')
    owner.emit('player:pause')
    await owner.wait('player:pause', (data) => data?.playState?.isPlaying === false)
    owner.clear('player:resume')
    owner.emit('player:play')
    await owner.wait('player:resume', (data) => data?.playState?.isPlaying === true)
    owner.clear('player:seek')
    owner.emit('player:seek', { currentTime: 1 })
    await owner.wait('player:seek', (data) => Math.abs(data?.playState?.currentTime - 1) < 0.2)
    owner.clear('room:state')
    owner.emit('player:set_mode', { mode: 'loop-all' })
    await owner.wait('room:state', (room) => room?.playMode === 'loop-all')
    owner.clear('queue:updated')
    owner.emit('queue:reorder', { trackIds: [...twoTrackQueue.queue].reverse().map((track) => track.id) })
    await owner.wait('queue:updated', (data) => data?.queue?.[0]?.id === twoTrackQueue.queue.at(-1)?.id)
    console.log('OK owner playback controls and queue reorder')

    const memberIdentity = await createIdentity()
    member = new ProtocolClient(memberIdentity)
    await member.connect()
    member.emit('room:join', { roomId, nickname: `${nickname}-member` })
    await member.wait('room:state', (room) => room?.users?.some((user) => user.id === memberIdentity.userId))

    owner.clear('room:role_changed')
    owner.emit('room:set_role', { userId: memberIdentity.userId, role: 'admin' })
    await owner.wait('room:role_changed', (data) => data?.userId === memberIdentity.userId && data?.role === 'admin')
    member.clear('player:pause')
    member.emit('player:pause')
    await member.wait('player:pause')

    owner.clear('room:role_changed')
    owner.emit('room:set_role', { userId: memberIdentity.userId, role: 'member' })
    await owner.wait('room:role_changed', (data) => data?.userId === memberIdentity.userId && data?.role === 'member')
    member.clear('room:error')
    member.emit('player:pause')
    await member.wait('room:error', (error) => error?.code === 'NO_PERMISSION')
    console.log('OK admin direct control and member direct-control denial')

    member.clear('vote:started')
    member.emit('vote:start', { action: 'next' })
    await member.wait('vote:started', (vote) => vote?.action === 'next')
    owner.clear('vote:result')
    owner.emit('vote:cast', { approve: false })
    await owner.wait('vote:result', (result) => result?.passed === false && result?.reason === 'host_veto')
    console.log('OK vote start and host veto')

    member.emit('room:leave')
    member.close()
    member = undefined
    await owner.wait('room:user_left', (user) => user?.id === memberIdentity.userId)
    owner.clear('player:play')
    owner.emit('player:next')
    await owner.wait('player:play', (data) => data?.track?.id && data.track.id !== firstPlay.track.id, 30_000)
    const nextMessages = owner.messages.filter((message) => message.event === 'player:play')
    assert(nextMessages.length === 1, `single next produced ${nextMessages.length} PLAYER_PLAY events`)
    console.log('OK owner-only single auto-next protocol transition')

    owner.emit('auth:get_status')
    await owner.wait('auth:my_status', Array.isArray)
    owner.emit('playlist:get_my', { platform: 'netease' })
    await owner.wait('playlist:my_list', (data) => data?.platform === 'netease')
    owner.clear('room:settings')
    owner.emit('room:settings', { hidden: true, name: `Windows Smoke Hidden ${Date.now().toString().slice(-4)}` })
    await owner.wait('room:settings', (settings) => settings?.hidden === true)
    owner.clear('room:settings')
    owner.emit('room:settings', { hidden: false })
    await owner.wait('room:settings', (settings) => settings?.hidden === false)
    console.log('OK auth status, playlist event, and room settings')

    owner.close()
    owner = new ProtocolClient(ownerIdentity)
    await owner.connect()
    owner.emit('room:join', { roomId, nickname, rejoinToken: rejoin.token })
    const recovered = await owner.wait('room:state', (room) => room?.id === roomId)
    assert(recovered.users.some((user) => user.id === ownerIdentity.userId), 'reconnected identity missing from room')
    console.log('OK disconnect/rejoin recovery')

    owner.emit('queue:clear')
    await owner.wait('queue:updated', (data) => data?.queue?.length === 0)
    owner.emit('room:leave')
    console.log('ONLINE_SMOKE_OK')
  } finally {
    member?.close()
    owner?.close()
  }
}

main().catch((error) => {
  console.error(`ONLINE_SMOKE_FAILED: ${error.message}`)
  process.exitCode = 1
})
