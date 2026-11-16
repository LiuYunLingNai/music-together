import type { MusicSource } from './types.js'

/** Sources that can supplement a track's lyric when the current source lacks usable timing. */
export const LYRIC_SUPPLEMENT_SOURCE_IDS = ['netease', 'kugou', 'tencent'] as const
export type LyricSupplementSource = (typeof LYRIC_SUPPLEMENT_SOURCE_IDS)[number]

export interface MusicSourceLyricCapabilities {
  lrc: boolean
  yrc: boolean
  krc: boolean
  qrc: boolean
  translation: boolean
  romanization: boolean
  wordByWord: boolean
  duet: boolean
  supplement: boolean
}

/**
 * Read-only capability matrix. Keep this aligned with the actual provider branches; it is
 * consumed by server-side source selection and, later, by client settings that need to know
 * which formats a source can really return.
 */
export interface MusicSourceCapabilities {
  search: boolean
  playlist: boolean
  album: boolean
  hotSongs: boolean
  roaming: boolean
  recommendations: boolean
  cover: boolean
  auth: boolean
  download: boolean
  lyrics: MusicSourceLyricCapabilities
}

const LRC_ONLY: MusicSourceLyricCapabilities = {
  lrc: true,
  yrc: false,
  krc: false,
  qrc: false,
  translation: true,
  romanization: false,
  wordByWord: false,
  duet: false,
  supplement: false,
}

export const MUSIC_SOURCE_CAPABILITIES: Record<MusicSource, MusicSourceCapabilities> = {
  netease: {
    search: true,
    playlist: true,
    album: true,
    hotSongs: true,
    roaming: true,
    recommendations: true,
    cover: true,
    auth: true,
    download: true,
    lyrics: {
      lrc: true,
      yrc: true,
      krc: false,
      qrc: false,
      translation: true,
      romanization: true,
      wordByWord: true,
      duet: false,
      supplement: true,
    },
  },
  tencent: {
    search: true,
    playlist: true,
    album: true,
    hotSongs: true,
    roaming: true,
    recommendations: true,
    cover: true,
    auth: true,
    download: true,
    lyrics: {
      ...LRC_ONLY,
      qrc: true,
      romanization: true,
      wordByWord: true,
      supplement: true,
    },
  },
  kugou: {
    search: true,
    playlist: true,
    album: true,
    hotSongs: true,
    roaming: true,
    recommendations: true,
    cover: true,
    auth: true,
    download: true,
    lyrics: {
      ...LRC_ONLY,
      krc: true,
      wordByWord: true,
      supplement: true,
    },
  },
  kugou_concept: {
    search: true,
    playlist: true,
    album: true,
    hotSongs: false,
    roaming: true,
    recommendations: true,
    cover: true,
    auth: true,
    download: true,
    lyrics: {
      ...LRC_ONLY,
      krc: true,
      wordByWord: true,
    },
  },
  bilibili: {
    search: true,
    playlist: false,
    album: false,
    hotSongs: false,
    roaming: false,
    recommendations: false,
    cover: true,
    auth: true,
    download: true,
    lyrics: {
      lrc: false,
      yrc: false,
      krc: false,
      qrc: false,
      translation: false,
      romanization: false,
      wordByWord: false,
      duet: false,
      supplement: false,
    },
  },
}
