import { EVENTS } from '../domain/events'
import { canDirectly, canManageQueueAction } from '../domain/permissions'
import { playbackSyncAdjustment } from '../domain/playback-sync'
import { markMemberOffline, markMemberOnline, nextUnreadChatCount, normalizeRoomState, updateMemberRole, type RoomStatePayload } from '../domain/room-state'
import { reduceVote } from '../domain/vote'
import type { AudioProxyPolicy, AudioQuality, ChatMessage, MusicSource, MyPlatformAuth, PlatformAuthStatus, PlayState, Playlist, RoomAutoFallbackEvent, RoomListItem, RoomState, Track, User, UserRole, VoteAction, VoteState } from '../domain/types'
import { prepareLyricGroups } from '../lyrics/engine'
import { parseServerLyrics, parseTtml } from '../lyrics/parser'
import { normalizeServerUrl, storage } from '../lib/storage'
import { useAppStore } from '../store/app-store'
import { bootstrapIdentity, fetchCurrentProfile, fetchRecommendations, fetchServerLyrics, logoutIdentity, recoverIdentity, searchTracks, setInitialPassword, updateAccountId, updateCurrentProfile, uploadCurrentAvatar } from './api'
import { DesktopAudioPlayer } from './audio-player'
import { shouldSendAutoNext } from './auto-next'
import { MusicTogetherSocket } from './socket'

let socket: MusicTogetherSocket | null = null
let activeTrackId = ''
let activePlaybackKey = ''
let autoNextSentPlaybackKey = ''
let scheduledTimer = 0
let syncIntervalTimer = 0
let serverOffsetMs = 0
let pendingQrPlatform: MusicSource = 'netease'
let reconnectRoomId = ''
let lastJoinRoomId = ''
const pingStarts = new Map<number, number>()

const audio = new DesktopAudioPlayer({
  onTime: (currentTime, duration, buffered) => useAppStore.getState().set({ currentTime, duration, buffered }),
  onPlaying: (isPlaying) => useAppStore.getState().set({ isPlaying }),
  onError: (message) => useAppStore.getState().notify(message, true),
  onEnded: () => handleAudioEnded(),
})
audio.setVolume(useAppStore.getState().volume)

if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => togglePlayback())
  navigator.mediaSession.setActionHandler('pause', () => togglePlayback())
  navigator.mediaSession.setActionHandler('nexttrack', () => nextTrack())
  navigator.mediaSession.setActionHandler('previoustrack', () => previousTrack())
  navigator.mediaSession.setActionHandler('seekto', (details) => {
    if (typeof details.seekTime === 'number') seekPlayback(details.seekTime)
  })
}

function registerSocketHandlers(nextSocket: MusicTogetherSocket): void {
  nextSocket.onStatus((connected, error) => {
    const state = useAppStore.getState()
    state.set({
      connectionStatus: connected ? 'connected' : state.room ? 'reconnecting' : 'disconnected',
      connectionError: error,
      ...(connected ? {} : { activeVote: null }),
    })
    if (connected) {
      nextSocket.emit(EVENTS.ROOM_LIST)
      if (state.room || reconnectRoomId) joinRoom(state.room?.id ?? reconnectRoomId)
      window.clearInterval(syncIntervalTimer)
      syncIntervalTimer = window.setInterval(() => {
        const current = useAppStore.getState()
        if (!current.isPlaying) return
        nextSocket.emit(EVENTS.PLAYER_SYNC_REQUEST)
        if (current.currentUserId === current.room?.hostId) {
          nextSocket.emit(EVENTS.PLAYER_SYNC, { currentTime: audio.currentTime, hostServerTime: Date.now() + serverOffsetMs })
        }
      }, useAppStore.getState().syncInterval * 1000)
      for (let index = 0; index < 3; index += 1) {
        window.setTimeout(() => {
          const id = Date.now() + index
          pingStarts.set(id, performance.now())
          nextSocket.emit(EVENTS.NTP_PING, { clientPingId: id })
        }, index * 180)
      }
    }
  })
  nextSocket.on<AudioProxyPolicy>(EVENTS.SERVER_AUDIO_PROXY_POLICY, (audioProxyPolicy) => useAppStore.getState().set({ audioProxyPolicy }))
  nextSocket.on<{ clientPingId: number; serverTime: number }>(EVENTS.NTP_PONG, ({ clientPingId, serverTime }) => {
    const started = pingStarts.get(clientPingId)
    if (started === undefined) return
    const elapsed = performance.now() - started
    useAppStore.getState().set({ rttMs: Math.round(elapsed) })
    serverOffsetMs = serverTime - (Date.now() - elapsed / 2)
    pingStarts.delete(clientPingId)
  })
  nextSocket.on<RoomListItem[]>(EVENTS.ROOM_LIST_UPDATE, (rooms) => useAppStore.getState().set({ rooms }))
  nextSocket.on<{ roomId: string; userId: string }>(EVENTS.ROOM_CREATED, ({ userId }) => {
    storage.setUserId(userId)
    useAppStore.getState().set({ currentUserId: userId })
  })
  nextSocket.on<RoomStatePayload>(EVENTS.ROOM_STATE, (payload) => {
    const state = useAppStore.getState()
    const room = normalizeRoomState(payload)
    reconnectRoomId = room.id
    state.set({ room })
    activePlaybackKey = playbackKey(room.currentTrack, room.playState)
    if (room.currentTrack) syncTrack(room.currentTrack, room.playState, room.id)
    else {
      activeTrackId = ''
      audio.pause()
    }
    for (const { platform, cookie } of storage.getAuthCookies()) {
      nextSocket.emit(EVENTS.AUTH_SET_COOKIE, { platform, cookie, persist: true })
    }
    nextSocket.emit(EVENTS.AUTH_GET_STATUS)
    void refreshProfile()
  })
  nextSocket.on<{ roomId: string; token: string; expiresAt: number }>(EVENTS.ROOM_REJOIN_TOKEN, (value) => {
    storage.setRejoinToken(value.roomId, value.token, value.expiresAt)
  })
  nextSocket.on<User>(EVENTS.ROOM_USER_JOINED, (user) => {
    const room = useAppStore.getState().room
    if (!room) return
    const now = Date.now()
    const users = room.users.some((candidate) => candidate.id === user.id) ? room.users.map((candidate) => candidate.id === user.id ? user : candidate) : [...room.users, user]
    const members = markMemberOnline(room.members, user, now)
    useAppStore.getState().updateRoom({ users, members })
  })
  nextSocket.on<User>(EVENTS.ROOM_USER_LEFT, (user) => {
    const room = useAppStore.getState().room
    if (room) useAppStore.getState().updateRoom({ users: room.users.filter((candidate) => candidate.id !== user.id), members: markMemberOffline(room.members, user) })
  })
  nextSocket.on<{ name: string; hasPassword: boolean; hidden: boolean; permanent: boolean; allowTemporaryAdminTrackRemoval?: boolean; allowTemporaryAdminQueueClear?: boolean; password?: string | null; audioQuality: AudioQuality }>(EVENTS.ROOM_SETTINGS, (settings) => {
    useAppStore.getState().updateRoom(settings)
  })
  nextSocket.on<{ userId: string; role: UserRole }>(EVENTS.ROOM_ROLE_CHANGED, ({ userId, role }) => {
    const room = useAppStore.getState().room
    if (!room) return
    useAppStore.getState().updateRoom({
      users: room.users.map((user) => user.id === userId ? { ...user, role } : user),
      members: updateMemberRole(room.members, userId, role),
    })
  })
  nextSocket.on<RoomAutoFallbackEvent>(EVENTS.ROOM_AUTO_FALLBACK, (event) => {
    const source = (value: MusicSource) => ({ netease: '网易云', tencent: 'QQ 音乐', kugou: '酷狗', kugou_concept: '酷狗概念版', bilibili: 'B 站' })[value]
    if (event.status === 'trying') useAppStore.getState().notify(`${source(event.fromSource)} 不可用，正在尝试 ${source(event.toSource)}…`)
    else if (event.status === 'success') useAppStore.getState().notify(`已切换到 ${source(event.toSource)}：${event.trackTitle}`)
    else useAppStore.getState().notify(`自动换源失败：${event.trackTitle}${event.reasonDetail ? `（${event.reasonDetail}）` : ''}`, true)
  })
  nextSocket.on<{ queue: Track[] }>(EVENTS.QUEUE_UPDATED, ({ queue }) => useAppStore.getState().updateRoom({ queue }))
  nextSocket.on<ChatMessage[]>(EVENTS.CHAT_HISTORY, (messages) => useAppStore.getState().set({ messages }))
  nextSocket.on<ChatMessage>(EVENTS.CHAT_MESSAGE, (message) => {
    const state = useAppStore.getState()
    state.set({ messages: [...state.messages.slice(-199), message], unreadChatCount: nextUnreadChatCount(state.unreadChatCount, state.chatOpen) })
  })
  nextSocket.on<{ code: string; message: string }>(EVENTS.ROOM_ERROR, ({ code, message }) => {
    const state = useAppStore.getState()
    if ((code === 'WRONG_PASSWORD' || /密码/.test(message)) && lastJoinRoomId) state.set({ passwordRetry: { roomId: lastJoinRoomId, message } })
    state.notify(message, true)
  })
  nextSocket.on<{ track: Track; playState: PlayState }>(EVENTS.PLAYER_PLAY, ({ track, playState }) => {
    const room = useAppStore.getState().room
    if (!room) return
    useAppStore.getState().updateRoom({ currentTrack: track, playState })
    activePlaybackKey = playbackKey(track, playState)
    syncTrack(track, playState, room.id, true)
  })
  nextSocket.on<{ playState: PlayState }>(EVENTS.PLAYER_PAUSE, ({ playState }) => schedule(playState, () => audio.pause(playState.currentTime)))
  nextSocket.on<{ playState: PlayState }>(EVENTS.PLAYER_RESUME, ({ playState }) => schedule(playState, () => {
    audio.seek(playState.currentTime)
    void audio.play()
  }))
  nextSocket.on<{ playState: PlayState }>(EVENTS.PLAYER_SEEK, ({ playState }) => schedule(playState, () => audio.seek(playState.currentTime)))
  nextSocket.on<{ track: Track }>(EVENTS.PLAYER_TRACK_METADATA_UPDATED, ({ track }) => {
    const room = useAppStore.getState().room
    if (room?.currentTrack?.id === track.id) {
      useAppStore.getState().updateRoom({ currentTrack: track })
      void loadLyrics(track)
    }
  })
  nextSocket.on<{ currentTime: number; isPlaying: boolean; serverTimestamp: number }>(EVENTS.PLAYER_SYNC_RESPONSE, (response) => {
    if (!response.isPlaying || !useAppStore.getState().isPlaying) return
    const expected = response.currentTime + Math.max(0, (Date.now() + serverOffsetMs - response.serverTimestamp) / 1000)
    const drift = audio.currentTime - expected
    useAppStore.getState().set({ syncDriftMs: Math.round(drift * 1000) })
    const current = useAppStore.getState()
    const adjustment = playbackSyncAdjustment(drift, current.playbackTempoSyncEnabled, current.playbackHardSeekSyncEnabled)
    audio.setPlaybackRate(adjustment.playbackRate)
    if (adjustment.shouldSeek) audio.seek(expected)
  })
  nextSocket.on<VoteState>(EVENTS.VOTE_STARTED, (vote) => {
    const state = useAppStore.getState()
    state.set({ activeVote: reduceVote({ active: state.activeVote }, { type: 'started', vote }).active })
  })
  nextSocket.on<{ passed: boolean; action: VoteAction; reason?: string }>(EVENTS.VOTE_RESULT, (result) => {
    const state = useAppStore.getState()
    state.set({ activeVote: reduceVote({ active: state.activeVote }, { type: 'result', ...result }).active })
    const reason = result.reason === 'host_veto' ? '（房主否决）' : result.reason === 'timeout' ? '（超时）' : ''
    state.notify(result.passed ? '投票已通过' : `投票未通过${reason}`, !result.passed)
  })
  nextSocket.on<PlatformAuthStatus[]>(EVENTS.AUTH_STATUS_UPDATE, (platformStatus) => useAppStore.getState().set({ platformStatus }))
  nextSocket.on<MyPlatformAuth[]>(EVENTS.AUTH_MY_STATUS, (myPlatformAuth) => useAppStore.getState().set({ myPlatformAuth }))
  nextSocket.on<{ key: string; qrimg: string }>(EVENTS.AUTH_QR_GENERATED, (data) => useAppStore.getState().set({ qrData: { ...data, platform: pendingQrPlatform }, qrStatus: { status: 801, message: '等待扫码' }, authBusy: false }))
  nextSocket.on<{ status: number; message: string }>(EVENTS.AUTH_QR_STATUS, (qrStatus) => useAppStore.getState().set({ qrStatus, authBusy: qrStatus.status !== 803 && qrStatus.status !== 800 }))
  nextSocket.on<{ success: boolean; message: string; platform?: MusicSource; cookie?: string }>(EVENTS.AUTH_SET_COOKIE_RESULT, (result) => {
    const state = useAppStore.getState()
    state.set({ authBusy: false })
    if (result.success && result.platform && result.cookie) storage.upsertAuthCookie(result.platform, result.cookie)
    state.notify(result.message, !result.success)
  })
  nextSocket.on<{ success: boolean; message: string }>(EVENTS.AUTH_CLAIM_KUGOU_CONCEPT_VIP_RESULT, (result) => useAppStore.getState().notify(result.message, !result.success))
  nextSocket.on<{ platform: MusicSource; playlists: Playlist[] }>(EVENTS.PLAYLIST_MY_LIST, ({ platform, playlists }) => {
    const state = useAppStore.getState()
    state.set({ playlists: { ...state.playlists, [platform]: playlists } })
  })
}

function playbackKey(track: Track | null, playState: PlayState): string {
  return track ? `${track.id}:${playState.serverTimestamp}` : ''
}

function handleAudioEnded(): void {
  const state = useAppStore.getState()
  if (!shouldSendAutoNext({
    currentUserId: state.currentUserId,
    hostId: state.room?.hostId,
    playbackKey: activePlaybackKey,
    sentPlaybackKey: autoNextSentPlaybackKey,
  })) return

  if (!socket?.connected) return
  if (socket.emit(EVENTS.PLAYER_NEXT)) {
    autoNextSentPlaybackKey = activePlaybackKey
  }
}

function schedule(playState: PlayState, action: () => void): void {
  window.clearTimeout(scheduledTimer)
  const delay = Math.max(0, (playState.serverTimeToExecute ?? Date.now() + serverOffsetMs) - (Date.now() + serverOffsetMs))
  scheduledTimer = window.setTimeout(action, delay)
  audio.setPlaybackRate(1)
  useAppStore.getState().updateRoom({ playState })
}

function expectedPosition(playState: PlayState): number {
  if (!playState.isPlaying) return playState.currentTime
  return playState.currentTime + Math.max(0, (Date.now() + serverOffsetMs - playState.serverTimestamp) / 1000)
}

function syncTrack(track: Track | null, playState: PlayState, roomId: string, force = false): void {
  if (!track) return
  if (force || activeTrackId !== track.id) {
    activeTrackId = track.id
    audio.setPlaybackRate(1)
    audio.load(track, useAppStore.getState().serverUrl, roomId, expectedPosition(playState), playState.isPlaying)
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist.join(' / '),
        album: track.album,
        artwork: track.cover ? [{ src: track.cover }] : [],
      })
    }
    void loadLyrics(track)
  }
}

async function loadLyrics(track: Track): Promise<void> {
  const state = useAppStore.getState()
  state.set({ lyricsLoading: true, lyricsError: undefined, lyricGroups: [] })
  const source = track.metadataSource ?? track.source
  const ttmlId = track.metadataSource ? track.lyricId : track.sourceId
  const settings = state.lyricSettings
  const ttmlUrl = source === 'netease'
    ? settings.ttmlDbUrl.replace('%s', encodeURIComponent(ttmlId ?? ''))
    : source === 'tencent'
      ? `https://amlldb.bikonoo.com/qq-lyrics/${encodeURIComponent(ttmlId ?? '')}.ttml`
      : ''
  if (settings.ttmlEnabled && ttmlUrl && ttmlId) {
    try {
      const response = await fetch(ttmlUrl)
      if (response.ok) {
        const lines = parseTtml(await response.text())
        if (lines.length && activeTrackId === track.id) {
          state.set({ lyricGroups: prepareLyricGroups(lines), lyricSource: 'TTML', lyricsLoading: false })
          return
        }
      }
    } catch {
      // Platform lyrics below are the offline-compatible fallback.
    }
  }
  if (!track.lyricId) {
    state.set({ lyricsLoading: false, lyricsError: '这首歌暂无歌词' })
    return
  }
  try {
    const parsed = parseServerLyrics(await fetchServerLyrics(state.serverUrl, source, track.lyricId))
    if (activeTrackId === track.id) state.set({ lyricGroups: prepareLyricGroups(parsed.lines), lyricSource: parsed.source, lyricsLoading: false })
  } catch (error) {
    if (activeTrackId === track.id) state.set({ lyricsLoading: false, lyricsError: error instanceof Error ? error.message : '歌词加载失败' })
  }
}

export async function connectClient(serverInput: string, nicknameInput: string): Promise<void> {
  const state = useAppStore.getState()
  try {
    const serverUrl = normalizeServerUrl(serverInput)
    const nickname = nicknameInput.trim()
    if (!nickname) throw new Error('请输入昵称')
    socket?.disconnect()
    state.set({ serverUrl, nickname, connectionStatus: 'connecting', connectionError: undefined })
    storage.setServerUrl(serverUrl)
    storage.setNickname(nickname)
    const identity = await bootstrapIdentity(serverUrl)
    storage.setUserId(identity.userId)
    const profile = await fetchCurrentProfile(serverUrl).catch(() => undefined)
    state.set({ currentUserId: identity.userId, profile: profile ?? null })
    socket = new MusicTogetherSocket(serverUrl)
    registerSocketHandlers(socket)
    socket.connect()
  } catch (error) {
    state.set({ connectionStatus: 'disconnected', connectionError: error instanceof Error ? error.message : '连接失败' })
  }
}

export function disconnectClient(): void {
  socket?.disconnect()
  socket = null
  activeTrackId = ''
  activePlaybackKey = ''
  autoNextSentPlaybackKey = ''
  reconnectRoomId = ''
  window.clearInterval(syncIntervalTimer)
  audio.pause()
  useAppStore.getState().resetSession()
}

export function joinRoom(roomId: string, password?: string): void {
  const state = useAppStore.getState()
  const normalized = roomId.trim().replace(/^.*\/room\//i, '').split(/[?#/]/)[0]
  if (!normalized) return
  lastJoinRoomId = normalized
  socket?.emit(EVENTS.ROOM_JOIN, { roomId: normalized, nickname: state.nickname, password, rejoinToken: storage.getRejoinToken(normalized) })
}

export function createRoom(name?: string, password?: string): void {
  socket?.emit(EVENTS.ROOM_CREATE, { nickname: useAppStore.getState().nickname, roomName: name?.trim() || undefined, password })
}

export function leaveRoom(): void {
  socket?.emit(EVENTS.ROOM_LEAVE)
  audio.pause()
  activeTrackId = ''
  activePlaybackKey = ''
  autoNextSentPlaybackKey = ''
  reconnectRoomId = ''
  useAppStore.getState().set({ room: null, messages: [], lyricGroups: [], activeVote: null })
}

function currentRoomUser(): User | undefined {
  const state = useAppStore.getState()
  return state.room?.users.find((user) => user.id === state.currentUserId)
}

function hasDirectPermission(action: Parameters<typeof canDirectly>[1]): boolean {
  const state = useAppStore.getState()
  return canDirectly(currentRoomUser()?.role, action, state.profile?.role === 'admin' || currentRoomUser()?.isServerAdmin)
}

function canManageQueue(action: 'remove-track' | 'clear-queue'): boolean {
  const state = useAppStore.getState()
  const user = currentRoomUser()
  return canManageQueueAction(user?.role, action, {
    userId: state.currentUserId,
    temporaryAdminUserId: state.room?.temporaryAdminUserId,
    allowTemporaryAdminTrackRemoval: state.room?.allowTemporaryAdminTrackRemoval,
    allowTemporaryAdminQueueClear: state.room?.allowTemporaryAdminQueueClear,
    isServerAdmin: state.profile?.role === 'admin' || user?.isServerAdmin,
  })
}

function startVote(action: VoteAction, payload?: Record<string, unknown>): void {
  if (useAppStore.getState().activeVote) {
    useAppStore.getState().notify('已有投票正在进行中', true)
    return
  }
  socket?.emit(EVENTS.VOTE_START, { action, payload })
}

export function togglePlayback(): void {
  const state = useAppStore.getState()
  const action = state.isPlaying ? 'pause' : 'play'
  if (hasDirectPermission(action)) socket?.emit(state.isPlaying ? EVENTS.PLAYER_PAUSE : EVENTS.PLAYER_PLAY)
  else startVote(state.isPlaying ? 'pause' : 'resume')
}

export function seekPlayback(seconds: number): void {
  if (!hasDirectPermission('seek')) {
    useAppStore.getState().notify('成员不能直接调整房间进度', true)
    return
  }
  audio.seek(seconds)
  socket?.emit(EVENTS.PLAYER_SEEK, { currentTime: seconds })
}

export function setVolume(value: number): void {
  audio.setVolume(value)
  storage.setVolume(value)
  useAppStore.getState().set({ volume: value })
}

export function nextTrack(): void { if (hasDirectPermission('next')) socket?.emit(EVENTS.PLAYER_NEXT); else startVote('next') }
export function previousTrack(): void { if (hasDirectPermission('prev')) socket?.emit(EVENTS.PLAYER_PREV); else startVote('prev') }
export function setPlayMode(mode: RoomState['playMode']): void { if (hasDirectPermission('set-mode')) socket?.emit(EVENTS.PLAYER_SET_MODE, { mode }); else startVote('set-mode', { mode }) }
export function addToQueue(track: Track, playNext = false): void { socket?.emit(playNext ? EVENTS.QUEUE_INSERT_AFTER_CURRENT : EVENTS.QUEUE_ADD, { track }) }
export function addBatchToQueue(tracks: Track[], playlistName?: string): void {
  for (let offset = 0; offset < tracks.length; offset += 100) socket?.emit(EVENTS.QUEUE_ADD_BATCH, { tracks: tracks.slice(offset, offset + 100), playlistName })
}
export function removeFromQueue(trackId: string, title?: string): void { if (canManageQueue('remove-track')) socket?.emit(EVENTS.QUEUE_REMOVE, { trackId }); else startVote('remove-track', { trackId, trackTitle: title }) }
export function playQueuedTrack(track: Track): void { if (hasDirectPermission('play')) socket?.emit(EVENTS.PLAYER_PLAY, { track }); else startVote('play-track', { trackId: track.id, trackTitle: track.title }) }
export function reorderQueue(trackIds: string[]): void { if (hasDirectPermission('reorder')) socket?.emit(EVENTS.QUEUE_REORDER, { trackIds }); else useAppStore.getState().notify('只有房主或管理员可以调整队列顺序', true) }
export function clearQueue(): void { if (canManageQueue('clear-queue')) socket?.emit(EVENTS.QUEUE_CLEAR); else useAppStore.getState().notify('当前房主未允许临时管理员清空队列', true) }
export function updateQueueMetadata(trackId: string, metadata: { metadataSource?: 'netease' | 'tencent' | 'kugou' | 'kugou_concept'; lyricId?: string; picId?: string; cover?: string; clearMetadata?: boolean }): void { socket?.emit(EVENTS.QUEUE_UPDATE_METADATA, { trackId, ...metadata }) }
export function updateRoomSettings(settings: { name?: string; password?: string | null; audioQuality?: AudioQuality; hidden?: boolean; permanent?: boolean; allowTemporaryAdminTrackRemoval?: boolean; allowTemporaryAdminQueueClear?: boolean }): void { socket?.emit(EVENTS.ROOM_SETTINGS, settings) }
export function setRoomUserRole(userId: string, role: 'admin' | 'member'): void { if (hasDirectPermission('set-role')) socket?.emit(EVENTS.ROOM_SET_ROLE, { userId, role }); else useAppStore.getState().notify('只有房主可以设置成员角色', true) }
export function castVote(approve: boolean): void { socket?.emit(EVENTS.VOTE_CAST, { approve }) }
export function sendChat(content: string): void { if (content.trim()) socket?.emit(EVENTS.CHAT_MESSAGE, { content: content.trim() }) }

export function requestPlatformQr(platform: MusicSource): void {
  pendingQrPlatform = platform
  useAppStore.getState().set({ authBusy: true, qrData: null, qrStatus: null })
  socket?.emit(EVENTS.AUTH_REQUEST_QR, { platform })
}
export function checkPlatformQr(key: string, platform: MusicSource): void { socket?.emit(EVENTS.AUTH_CHECK_QR, { key, platform }) }
export function setPlatformCookie(platform: MusicSource, cookie: string): void {
  useAppStore.getState().set({ authBusy: true })
  socket?.emit(EVENTS.AUTH_SET_COOKIE, { platform, cookie, persist: true })
}
export function logoutPlatform(platform: MusicSource): void {
  storage.removeAuthCookie(platform)
  socket?.emit(EVENTS.AUTH_LOGOUT, { platform })
}
export function requestMyPlaylists(platform: MusicSource): void { socket?.emit(EVENTS.PLAYLIST_GET_MY, { platform }) }
export function claimKugouConceptVip(): void { socket?.emit(EVENTS.AUTH_CLAIM_KUGOU_CONCEPT_VIP) }

export async function search(source: MusicSource, keyword: string, page = 1, type: 'song' | 'album' | 'playlist' = 'song', append = false): Promise<boolean> {
  const state = useAppStore.getState()
  if (!state.room || !keyword.trim()) return false
  state.set({ searchLoading: true, searchError: undefined })
  try {
    const result = await searchTracks(state.serverUrl, state.room.id, source, keyword.trim(), page, type)
    state.set({ searchResults: append ? [...state.searchResults, ...result.items] : result.items, searchLoading: false })
    return result.hasMore
  } catch (error) {
    state.set({ searchLoading: false, searchError: error instanceof Error ? error.message : '搜索失败' })
    return false
  }
}

export async function loadRecommendations(): Promise<void> {
  const state = useAppStore.getState()
  if (!state.room) return
  state.set({ recommendationsLoading: true, recommendationsLoaded: false, searchError: undefined })
  try {
    const recommendations = await fetchRecommendations(state.serverUrl, state.room.id)
    state.set({ recommendations, recommendationsLoading: false, recommendationsLoaded: true })
  } catch (error) {
    state.set({ recommendations: [], recommendationsLoading: false, recommendationsLoaded: true, searchError: error instanceof Error ? error.message : '推荐加载失败' })
  }
}

export function updatePlaybackSyncSettings(settings: { playbackTempoSyncEnabled?: boolean; playbackHardSeekSyncEnabled?: boolean }): void {
  if (settings.playbackTempoSyncEnabled !== undefined) storage.setPlaybackTempoSyncEnabled(settings.playbackTempoSyncEnabled)
  if (settings.playbackHardSeekSyncEnabled !== undefined) storage.setPlaybackHardSeekSyncEnabled(settings.playbackHardSeekSyncEnabled)
  useAppStore.getState().set(settings)
}

export function updateBackgroundSettings(settings: { backgroundFps?: number; backgroundFlowSpeed?: number; backgroundRenderScale?: number }): void {
  const next = {
    ...(settings.backgroundFps === undefined ? {} : { backgroundFps: Math.min(60, Math.max(15, Math.round(settings.backgroundFps))) }),
    ...(settings.backgroundFlowSpeed === undefined ? {} : { backgroundFlowSpeed: Math.min(2, Math.max(0.1, settings.backgroundFlowSpeed)) }),
    ...(settings.backgroundRenderScale === undefined ? {} : { backgroundRenderScale: Math.min(1, Math.max(0.25, settings.backgroundRenderScale)) }),
  }
  if (next.backgroundFps !== undefined) storage.setBackgroundFps(next.backgroundFps)
  if (next.backgroundFlowSpeed !== undefined) storage.setBackgroundFlowSpeed(next.backgroundFlowSpeed)
  if (next.backgroundRenderScale !== undefined) storage.setBackgroundRenderScale(next.backgroundRenderScale)
  useAppStore.getState().set(next)
}

export async function refreshProfile(): Promise<void> {
  const state = useAppStore.getState()
  const profile = await fetchCurrentProfile(state.serverUrl)
  state.set({ profile: profile ?? null })
  if (profile) {
    state.set({ currentUserId: profile.id, nickname: profile.nickname || state.nickname })
    storage.setUserId(profile.id)
    if (profile.nickname) storage.setNickname(profile.nickname)
  }
}

export async function saveNickname(nickname: string): Promise<void> {
  const state = useAppStore.getState()
  const profile = await updateCurrentProfile(state.serverUrl, nickname)
  storage.setNickname(profile.nickname)
  state.set({ profile, nickname: profile.nickname, currentUserId: profile.id })
}

export async function saveAvatar(image: string): Promise<void> {
  const state = useAppStore.getState()
  state.set({ profile: await uploadCurrentAvatar(state.serverUrl, image) })
}

function rebuildSocket(preserveRoom: boolean): void {
  const state = useAppStore.getState()
  reconnectRoomId = preserveRoom ? state.room?.id ?? '' : ''
  socket?.disconnect()
  if (!preserveRoom) state.set({ room: null, messages: [], lyricGroups: [], activeVote: null })
  state.set({ connectionStatus: 'reconnecting' })
  const nextSocket = new MusicTogetherSocket(state.serverUrl)
  socket = nextSocket
  registerSocketHandlers(nextSocket)
  nextSocket.connect()
}

export async function protectAccount(password: string): Promise<void> {
  await setInitialPassword(useAppStore.getState().serverUrl, password)
  await refreshProfile()
}

export async function renameAccountId(accountId: string, currentPassword?: string): Promise<void> {
  const state = useAppStore.getState()
  const profile = await updateAccountId(state.serverUrl, accountId, currentPassword)
  storage.setUserId(profile.id)
  state.set({ currentUserId: profile.id, profile })
  rebuildSocket(true)
}

export async function loginAccount(accountId: string, password: string): Promise<void> {
  const state = useAppStore.getState()
  const result = await recoverIdentity(state.serverUrl, accountId, password)
  storage.clearAuthCookies()
  if (state.room) storage.clearRejoinToken(state.room.id)
  storage.setUserId(result.userId)
  state.set({ currentUserId: result.userId })
  await refreshProfile()
  rebuildSocket(false)
  const profile = useAppStore.getState().profile
  useAppStore.getState().notify(`已登录账号 ${profile?.nickname || profile?.id || result.userId}`)
}

export async function logoutAccount(): Promise<void> {
  const state = useAppStore.getState()
  const result = await logoutIdentity(state.serverUrl)
  storage.clearAuthCookies()
  if (state.room) storage.clearRejoinToken(state.room.id)
  storage.clearNickname()
  storage.setUserId(result.userId)
  state.set({ currentUserId: result.userId, profile: null, nickname: '' })
  rebuildSocket(false)
}

export function updateLyricSettings(settings: Partial<ReturnType<typeof storage.getLyricSettings>>): void {
  const state = useAppStore.getState()
  const lyricSettings = { ...state.lyricSettings, ...settings }
  storage.setLyricSettings(lyricSettings)
  state.set({ lyricSettings })
  if (state.room?.currentTrack) void loadLyrics(state.room.currentTrack)
}

export function updateSyncInterval(seconds: number): void {
  const value = Math.min(60, Math.max(1, Math.round(seconds)))
  storage.setSyncInterval(value)
  useAppStore.getState().set({ syncInterval: value })
  window.clearInterval(syncIntervalTimer)
  syncIntervalTimer = window.setInterval(() => {
    const current = useAppStore.getState()
    if (!current.isPlaying) return
    socket?.emit(EVENTS.PLAYER_SYNC_REQUEST)
    if (current.currentUserId === current.room?.hostId) socket?.emit(EVENTS.PLAYER_SYNC, { currentTime: audio.currentTime, hostServerTime: Date.now() + serverOffsetMs })
  }, value * 1000)
}
