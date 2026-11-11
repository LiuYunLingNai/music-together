import { ARTIST_SOURCES } from '@music-together/shared'
import type { ArtistHome, ArtistPage, MusicSource, Playlist, Track } from '@music-together/shared'
import ncmApi from '@neteasecloudmusicapienhanced/api'
import { logger } from '../utils/logger.js'
import { CatalogError, createNcmCaller, count, isRecord, neteaseAlbum, neteaseArtist, pick, sharedCache } from './catalogUtils.js'
import { musicProvider } from './musicProvider.js'

const REQUEST_TIMEOUT_MS = 10_000
const PROFILE_TTL_MS = 15 * 60_000
const PAGE_TTL_MS = 10 * 60_000
const SONG_PAGE_DEFAULT = 50
const ALBUM_PAGE_DEFAULT = 30

type NcmMethod = (query: Record<string, unknown>) => Promise<{ body?: Record<string, unknown> }>

export interface ArtistNcm {
  artists: NcmMethod
  artist_songs: NcmMethod
  artist_album: NcmMethod
}

interface ArtistDependencies {
  ncm: ArtistNcm
  ingestSongs: (songs: unknown) => Track[]
  timeoutMs: number
}

export class ArtistError extends CatalogError {
  constructor(code: 'ARTIST_UNSUPPORTED' | 'ARTIST_NOT_FOUND' | 'ARTIST_UPSTREAM') {
    const kind = code === 'ARTIST_UNSUPPORTED' ? 'unsupported' : code === 'ARTIST_NOT_FOUND' ? 'not-found' : 'upstream'
    const status = kind === 'unsupported' ? 400 : kind === 'not-found' ? 404 : 503
    super(kind, code, status)
    this.name = 'ArtistError'
  }
}

export function createArtistService(overrides: Partial<ArtistDependencies> = {}) {
  const deps: ArtistDependencies = {
    ncm: ncmApi as unknown as ArtistNcm,
    ingestSongs: (songs) => musicProvider.ingestNeteaseSongs(songs),
    timeoutMs: REQUEST_TIMEOUT_MS,
    ...overrides,
  }
  const cachedHome = sharedCache<ArtistHome>(100, PROFILE_TTL_MS)
  const cachedSongs = sharedCache<ArtistPage<Track>>(200, PAGE_TTL_MS)
  const cachedAlbums = sharedCache<ArtistPage<Playlist>>(200, PAGE_TTL_MS)
  const call = createNcmCaller(
    deps.timeoutMs,
    { upstream: () => new ArtistError('ARTIST_UPSTREAM'), notFound: () => new ArtistError('ARTIST_NOT_FOUND') },
    (label, code) => logger.warn(`NetEase ${label} failed`, code === undefined ? undefined : { code }),
  )

  function requireSupported(source: MusicSource): void {
    if (!ARTIST_SOURCES.includes(source)) throw new ArtistError('ARTIST_UNSUPPORTED')
  }

  async function loadSongs(id: string, offset: number, limit: number): Promise<ArtistPage<Track>> {
    const body = await call('artist_songs', deps.ncm.artist_songs, {
      id,
      offset,
      limit,
      order: 'hot',
      timestamp: Date.now(),
    })
    return { items: deps.ingestSongs(body.songs), hasMore: body.more === true, total: count(body.total) }
  }

  async function loadAlbums(id: string, offset: number, limit: number): Promise<ArtistPage<Playlist>> {
    const body = await call('artist_album', deps.ncm.artist_album, { id, offset, limit, timestamp: Date.now() })
    return { items: pick(body.hotAlbums, neteaseAlbum), hasMore: body.more === true }
  }

  return {
    async getArtist(source: MusicSource, id: string): Promise<ArtistHome> {
      requireSupported(source)
      return cachedHome(id, async () => {
        const [profile, songs, albums] = await Promise.all([
          call('artists', deps.ncm.artists, { id, timestamp: Date.now() }),
          loadSongs(id, 0, SONG_PAGE_DEFAULT),
          loadAlbums(id, 0, ALBUM_PAGE_DEFAULT),
        ])
        const artist = isRecord(profile.artist) ? neteaseArtist(profile.artist, { description: true }) : null
        if (!artist) throw new ArtistError('ARTIST_NOT_FOUND')
        return { artist, songs, albums }
      })
    },

    async getSongs(source: MusicSource, id: string, offset: number, limit: number): Promise<ArtistPage<Track>> {
      requireSupported(source)
      return cachedSongs(`${id}:${offset}:${limit}`, () => loadSongs(id, offset, limit))
    },

    async getAlbums(source: MusicSource, id: string, offset: number, limit: number): Promise<ArtistPage<Playlist>> {
      requireSupported(source)
      return cachedAlbums(`${id}:${offset}:${limit}`, () => loadAlbums(id, offset, limit))
    },
  }
}

export const artistService = createArtistService()
