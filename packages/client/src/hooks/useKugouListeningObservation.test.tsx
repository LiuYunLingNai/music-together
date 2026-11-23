// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { EVENTS, soloProgressSchema, type RoomState, type SoloSettlement, type Track } from '@music-together/shared'
import { SoloListeningService } from '../../../server/src/services/soloListeningService'
import type { Howl } from 'howler'
import { SocketContext } from '@/providers/socket-context'
import { useRoomStore } from '@/stores/roomStore'
import { usePlayerStore } from '@/stores/playerStore'
import { playbackUrlFor } from '@/lib/playbackSource'
import { useKugouListeningObservation } from './useKugouListeningObservation'
import { useLocalListeningProgress } from './useLocalListeningProgress'
import { LocalListeningProgress, pageListening, type LocalOutput } from '@/lib/localListeningProgress'

vi.mock('@/lib/timeStretch', () => ({ hasListeningOutput: () => true, hasLocalListeningOutput: () => true }))

it('observes only the invited live sound and breaks continuity across short seeks, buffering and mute', () => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  const track: Track = {
    id: 'entry',
    urlId: 'file',
    sourceId: 'file',
    source: 'kugou',
    title: 'Track',
    artist: [],
    album: '',
    cover: '',
    duration: 180,
    streamUrl: 'https://cdn.invalid/full.mp3',
  }
  const request = { sessionId: 'd2e302d7-1bb7-4b12-9469-a48be6da6899', trackId: track.id, streamUrl: track.streamUrl! }
  const playerBefore = usePlayerStore.getState()
  const roomBefore = useRoomStore.getState()
  usePlayerStore.setState({ currentTrack: track, volume: 1 })
  useRoomStore.setState({ room: { id: 'room', currentTrack: track, playState: { isPlaying: true } } as RoomState })
  const node = document.createElement('audio')
  const expectedUrl = new URL(playbackUrlFor(track, request.streamUrl), location.href).href
  const media = {
    currentSrc: expectedUrl,
    currentTime: 0,
    duration: 180,
    readyState: 4,
    paused: false,
    muted: false,
    ended: false,
  }
  for (const key of Object.keys(media) as (keyof typeof media)[])
    Object.defineProperty(node, key, { get: () => media[key] })
  const byEvent = new Map<string, (data?: unknown) => void>()
  const socket = {
    connected: true,
    emit: vi.fn(),
    on: (event: string, cb: (data?: unknown) => void) => byEvent.set(event, cb),
    off: (event: string) => byEvent.delete(event),
  }
  const howl = {
    _sounds: [
      { _id: 1, _node: document.createElement('audio') },
      { _id: 2, _node: node },
    ],
    playing: () => true,
  }
  function Probe() {
    useKugouListeningObservation({ current: howl as unknown as Howl }, { current: 2 })
    return null
  }
  const root = createRoot(document.createElement('div'))
  try {
    act(() =>
      root.render(
        <SocketContext.Provider value={{ socket: socket as never, isConnected: true }}>
          <Probe />
        </SocketContext.Provider>,
      ),
    )
    vi.advanceTimersByTime(5_000)
    expect(socket.emit).not.toHaveBeenCalled()
    byEvent.get(EVENTS.PLAYER_LISTENING_OBSERVE)!(request)
    media.currentTime = 1
    vi.advanceTimersByTime(1_000)
    const [event, first] = socket.emit.mock.lastCall!
    expect(event).toBe(EVENTS.PLAYER_LISTENING_SAMPLE)
    expect(first.positionMs).toBe(1_000)
    expect(first.environment).toMatchObject({ model: 'MusicTogetherWeb', width: 1024, height: 768 })
    node.dispatchEvent(new Event('seeking'))
    media.currentTime = 46
    node.dispatchEvent(new Event('seeked'))
    vi.advanceTimersByTime(1_000)
    const afterSeek = socket.emit.mock.lastCall![1]
    expect(afterSeek.segment).toBeGreaterThan(first.segment)
    socket.emit.mockClear()
    media.readyState = 2
    vi.advanceTimersByTime(2_000)
    media.readyState = 4
    media.muted = true
    vi.advanceTimersByTime(2_000)
    media.muted = false
    media.currentSrc = 'blob:local-copy'
    vi.advanceTimersByTime(2_000)
    media.currentSrc = expectedUrl
    media.paused = true
    vi.advanceTimersByTime(2_000)
    expect(socket.emit).not.toHaveBeenCalled()
    media.paused = false
    vi.advanceTimersByTime(1_000)
    expect(socket.emit.mock.lastCall![1].segment).toBeGreaterThan(afterSeek.segment)
    media.currentTime = 180
    media.ended = true
    media.readyState = 2
    node.dispatchEvent(new Event('ended'))
    expect(socket.emit.mock.lastCall![1]).toMatchObject({ final: true, naturallyEnded: true, positionMs: 180_000 })
    socket.emit.mockClear()
    byEvent.get(EVENTS.PLAYER_LISTENING_OBSERVE)!({ ...request, final: true })
    expect(socket.emit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(3_000)
    expect(socket.emit).not.toHaveBeenCalled()
    media.currentTime = 42
    media.ended = false
    media.readyState = 4
    byEvent.get(EVENTS.PLAYER_LISTENING_OBSERVE)!(request)
    usePlayerStore.setState({ currentTrack: { ...track, id: 'next', streamUrl: 'https://cdn.invalid/next.mp3' } })
    byEvent.get(EVENTS.PLAYER_LISTENING_OBSERVE)!({ ...request, final: true })
    expect(socket.emit).toHaveBeenLastCalledWith(
      EVENTS.PLAYER_LISTENING_SAMPLE,
      expect.objectContaining({ final: true, positionMs: 42_000 }),
    )
    byEvent.get(EVENTS.PLAYER_LISTENING_OBSERVE)!(request)
    byEvent.get('disconnect')!()
    socket.emit.mockClear()
    vi.advanceTimersByTime(10_000)
    expect(socket.emit).not.toHaveBeenCalled()
  } finally {
    act(() => root.unmount())
    usePlayerStore.setState(playerBefore)
    useRoomStore.setState(roomBefore)
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
})

it('measures the continuous span, without accumulating arrival jitter or adding time across pauses and seeks', () => {
  const clock = new LocalListeningProgress()
  clock.sample(0, 0)
  for (let i = 1; i <= 60; i++) {
    clock.sample(i * 1000 + (i % 2) * 200, i * 1000)
    if (i === 30) expect(clock.totalMs).toBe(30_000)
  }
  expect(clock.totalMs).toBe(60_000)
  clock.interrupt()
  clock.sample(75_000, 105_000)
  clock.sample(76_000, 106_000)
  clock.sample(92_000, 122_000)
  expect(clock.totalMs).toBe(61_000)
})

it.each([false, true])('keeps actual solo playback and excludes overlap (server invitation: %s)', (serverInvited) => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  const before = useRoomStore.getState()
  const playerBefore = usePlayerStore.getState()
  useRoomStore.setState({ room: { id: 'room', playState: { isPlaying: true }, automixEnabled: true } as RoomState })
  usePlayerStore.setState({ volume: 1 })
  function deck(id: string) {
    const track: Track = {
      id,
      urlId: id,
      sourceId: id,
      source: 'kugou',
      title: id,
      artist: [],
      album: '',
      cover: '',
      duration: 180,
      streamUrl: `https://example.invalid/${id}`,
    }
    const node = document.createElement('audio')
    const media = {
      currentSrc: new URL(playbackUrlFor(track, track.streamUrl!), location.href).href,
      currentTime: 0,
      duration: 180,
      readyState: 4,
      paused: false,
      ended: false,
    }
    for (const key of Object.keys(media) as (keyof typeof media)[])
      Object.defineProperty(node, key, { get: () => media[key] })
    return { track, node, media, playing: true, instance: {} }
  }
  const a = deck('a'),
    b = deck('b'),
    c = deck('c')
  const output: LocalOutput = { revision: 0, stems: false, decks: [a] }
  const readOutput = () => output
  const callbacks = new Map<string, (data?: unknown) => void>()
  const server = new SoloListeningService(() => performance.now())
  const receipts: SoloSettlement[] = []
  const invitedSessions = new Map<string, string | undefined>()
  const socket = {
    connected: true,
    emit: vi.fn((event: string, data: unknown) => {
      expect(event).toBe(EVENTS.PLAYER_SOLO_PROGRESS)
      server.accept('room', 'owner', 'web', soloProgressSchema.parse(data))
    }),
    on: (key: string, fn: (data?: unknown) => void) => callbacks.set(key, fn),
    off: (key: string) => callbacks.delete(key),
  }
  const invite = (d: typeof a) => {
    const soloSessionId = serverInvited
      ? server.offer('room', {
          ownerId: 'owner',
          accountId: '123',
          version: 'v1',
          trackId: d.track.id,
          albumAudioId: String(d.track.id.charCodeAt(0)),
          sockets: new Set(['web']),
          durationMs: 180_000,
          authorized: () => true,
          source: {
            ownerId: 'owner',
            title: d.track.title,
            durationMs: 180_000,
            recording: {
              accountId: '123',
              albumAudioId: String(d.track.id.charCodeAt(0)),
              fileHash: 'f'.repeat(32),
              fileSizeBytes: 1_000_000,
              bitrateKbps: 128,
              device: { mid: '33', uuid: BigInt(33).toString(16).padStart(32, '0'), dfid: '-' },
            },
          },
          start: async () => true,
          cancel: () => {},
          settled: (receipt) => {
            receipts.push(receipt)
            callbacks.get(EVENTS.PLAYER_SOLO_SETTLED)?.(receipt)
          },
        })
      : undefined
    invitedSessions.set(d.track.id, soloSessionId)
    callbacks.get(EVENTS.PLAYER_LOCAL_LISTENING_SOURCE)!({
      roomId: 'room',
      trackId: d.track.id,
      streamUrl: d.track.streamUrl,
      soloSessionId,
    })
  }
  const advance = (seconds: number, ...playing: (typeof a)[]) => {
    for (let i = 0; i < seconds; i++) {
      for (const d of playing) d.media.currentTime++
      vi.advanceTimersByTime(1_000)
    }
  }
  function Probe() {
    useLocalListeningProgress(readOutput)
    return null
  }
  const root = createRoot(document.createElement('div'))
  try {
    act(() =>
      root.render(
        <SocketContext.Provider value={{ socket: socket as never, isConnected: true }}>
          <Probe />
        </SocketContext.Provider>,
      ),
    )
    invite(a)
    advance(2, a)
    output.decks = [b]
    output.revision++
    invite(b)
    advance(40, b)
    expect(pageListening.read()).toEqual({ seconds: 40, previous: 2 })
    b.media.paused = true
    b.node.dispatchEvent(new Event('pause'))
    advance(15)
    expect(pageListening.read()?.seconds).toBe(40)
    b.media.currentTime = 100
    b.node.dispatchEvent(new Event('seeked'))
    b.media.paused = false
    b.node.dispatchEvent(new Event('timeupdate'))
    advance(10, b)
    expect(pageListening.read()?.seconds).toBe(50)
    output.decks = [b, c]
    output.revision++
    invite(c)
    advance(4, b, c)
    expect(pageListening.read()?.seconds).toBe(50)
    output.decks = [c]
    output.revision++
    c.node.dispatchEvent(new Event('timeupdate'))
    advance(40, c)
    if (serverInvited) {
      callbacks.get(EVENTS.PLAYER_SOLO_SETTLED)!({
        sessionId: invitedSessions.get('b'),
        trackId: 'b',
        milliseconds: 50_000,
      })
    }
    expect(pageListening.read()).toEqual({ seconds: 40, previous: 50, ...(serverInvited && { verifiedPrevious: 50 }) })
    c.node.dispatchEvent(new Event('seeking'))
    c.media.currentTime = 179
    c.node.dispatchEvent(new Event('seeked'))
    c.node.dispatchEvent(new Event('timeupdate'))
    vi.advanceTimersByTime(1_000)
    c.media.currentTime = 180
    c.media.ended = true
    c.media.paused = true
    c.node.dispatchEvent(new Event('ended'))
    c.media.currentTime = 0
    advance(4)
    expect(pageListening.read()?.seconds).toBe(41)
    c.media.ended = false
    const d = deck('d')
    output.decks = [d]
    output.revision++
    invite(d)
    advance(40, d)
    d.media.paused = true
    d.node.dispatchEvent(new Event('pause'))
    advance(15)
    const e = deck('e')
    output.decks = [e]
    output.revision++
    invite(e)
    if (serverInvited) {
      callbacks.get(EVENTS.PLAYER_SOLO_SETTLED)!({
        sessionId: invitedSessions.get('d'),
        trackId: 'd',
        milliseconds: 40_000,
      })
    }
    expect(pageListening.read()).toEqual({ seconds: 0, previous: 40, ...(serverInvited && { verifiedPrevious: 40 }) })
    advance(40, e)
    const f = deck('f')
    output.decks = [e, f]
    output.revision++
    invite(f)
    advance(4, e, f)
    output.decks = [f]
    output.revision++
    f.node.dispatchEvent(new Event('timeupdate'))
    advance(40, f)
    const g = deck('g')
    output.decks = [g]
    output.revision++
    invite(g)
    callbacks.get(EVENTS.PLAYER_LOCAL_LISTENING_SOURCE)!(null)
    expect(pageListening.read()).toBeNull()
    if (!serverInvited) expect(socket.emit).not.toHaveBeenCalled()
  } finally {
    act(() => root.unmount())
    usePlayerStore.setState(playerBefore)
    useRoomStore.setState(before)
    visibility.mockRestore()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
})
