import { create } from 'zustand'
import type { AccountProfile, AppUpdateStatus, AudioProxyPolicy, ChatMessage, LyricGroup, LyricSettings, MusicSource, MyPlatformAuth, PlatformAuthStatus, PlatformRecommendation, Playlist, RoomListItem, RoomState, Track, VoteState } from '../domain/types'
import { storage } from '../lib/storage'
import type { ResolvedTheme, ThemePreference } from '../lib/theme'
import { resolveTheme } from '../lib/theme'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
export type CenterView = 'lyrics' | 'artwork'

interface AppState {
  serverUrl: string
  nickname: string
  currentUserId: string
  profile: AccountProfile | null
  themePreference: ThemePreference
  resolvedTheme: ResolvedTheme
  uiScale: number
  connectionStatus: ConnectionStatus
  connectionError?: string
  rooms: RoomListItem[]
  room: RoomState | null
  messages: ChatMessage[]
  lyricGroups: LyricGroup[]
  lyricSource?: string
  lyricsLoading: boolean
  lyricsError?: string
  currentTime: number
  duration: number
  isPlaying: boolean
  volume: number
  buffered: number
  centerView: CenterView
  searchOpen: boolean
  searchLoading: boolean
  searchResults: Array<Track | Playlist>
  searchError?: string
  recommendations: PlatformRecommendation[]
  recommendationsLoading: boolean
  recommendationsLoaded: boolean
  settingsOpen: boolean
  chatOpen: boolean
  unreadChatCount: number
  activeVote: VoteState | null
  platformStatus: PlatformAuthStatus[]
  myPlatformAuth: MyPlatformAuth[]
  qrData: { key: string; qrimg: string; platform: MusicSource } | null
  qrStatus: { status: number; message: string } | null
  authBusy: boolean
  playlists: Record<MusicSource, Playlist[]>
  audioProxyPolicy: AudioProxyPolicy
  updateStatus: AppUpdateStatus
  syncDriftMs: number
  rttMs: number
  syncInterval: number
  playbackTempoSyncEnabled: boolean
  playbackHardSeekSyncEnabled: boolean
  backgroundFps: number
  backgroundFlowSpeed: number
  backgroundRenderScale: number
  deepLinkRoomId?: string
  passwordRetry?: { roomId: string; message: string }
  lyricSettings: LyricSettings
  notice?: { id: number; text: string; error?: boolean }
  set: (partial: Partial<Omit<AppState, 'set'>>) => void
  updateRoom: (partial: Partial<RoomState>) => void
  notify: (text: string, error?: boolean) => void
  resetSession: () => void
}

export const useAppStore = create<AppState>((set) => ({
  serverUrl: storage.getServerUrl(),
  nickname: storage.getNickname(),
  currentUserId: '',
  profile: null,
  themePreference: storage.getThemePreference(),
  resolvedTheme: resolveTheme(storage.getThemePreference()),
  uiScale: storage.getUiScale(),
  connectionStatus: 'disconnected',
  rooms: [],
  room: null,
  messages: [],
  lyricGroups: [],
  lyricsLoading: false,
  currentTime: 0,
  duration: 0,
  isPlaying: false,
  volume: storage.getVolume(),
  buffered: 0,
  centerView: 'lyrics',
  searchOpen: false,
  searchLoading: false,
  searchResults: [],
  recommendations: [],
  recommendationsLoading: false,
  recommendationsLoaded: false,
  settingsOpen: false,
  chatOpen: false,
  unreadChatCount: 0,
  activeVote: null,
  platformStatus: [],
  myPlatformAuth: [],
  qrData: null,
  qrStatus: null,
  authBusy: false,
  playlists: { netease: [], tencent: [], kugou: [], kugou_concept: [], bilibili: [] },
  audioProxyPolicy: { kugouForceProxy: true },
  updateStatus: { state: 'idle', currentVersion: '未知' },
  syncDriftMs: 0,
  rttMs: 0,
  syncInterval: storage.getSyncInterval(),
  playbackTempoSyncEnabled: storage.getPlaybackTempoSyncEnabled(),
  playbackHardSeekSyncEnabled: storage.getPlaybackHardSeekSyncEnabled(),
  backgroundFps: storage.getBackgroundFps(),
  backgroundFlowSpeed: storage.getBackgroundFlowSpeed(),
  backgroundRenderScale: storage.getBackgroundRenderScale(),
  lyricSettings: storage.getLyricSettings(),
  set: (partial) => set(partial),
  updateRoom: (partial) => set((state) => state.room ? { room: { ...state.room, ...partial } } : {}),
  notify: (text, error) => set({ notice: { id: Date.now(), text, error } }),
  resetSession: () => set({
    connectionStatus: 'disconnected',
    currentUserId: '',
    profile: null,
    room: null,
    rooms: [],
    messages: [],
    lyricGroups: [],
    currentTime: 0,
    duration: 0,
    isPlaying: false,
    activeVote: null,
    recommendations: [],
    recommendationsLoading: false,
    recommendationsLoaded: false,
    chatOpen: false,
    unreadChatCount: 0,
    platformStatus: [],
    myPlatformAuth: [],
    qrData: null,
    qrStatus: null,
    authBusy: false,
  }),
}))
