import { DISCOVER_SOURCES } from '@music-together/shared'
import type { Artist, DiscoverHome, DiscoverHomeBlock, MusicSource, Playlist } from '@music-together/shared'
import ncmApi from '@neteasecloudmusicapienhanced/api'
import { logger } from '../utils/logger.js'
import {
  CatalogError,
  count,
  createNcmCaller,
  isRecord,
  neteaseAlbum,
  neteaseArtist,
  neteaseCover,
  numericId,
  pick,
  sharedCache,
  text,
  type Raw,
} from './catalogUtils.js'

const HOME_LIMIT = 12
const REQUEST_TIMEOUT_MS = 10_000
const RADAR_TTL_MS = 60 * 60_000
const CHART_TTL_MS = 60 * 60_000

/** 网易云雷达歌单的固定 ID（私人、会员、时光、粉丝、宝藏、新歌、神秘雷达）；其曲目是个性化的，用账号走普通歌单接口读取。 */
export const RADAR_PLAYLIST_IDS = [
  '3136952023',
  '8402996200',
  '5320167908',
  '5327906368',
  '5362359247',
  '5300458264',
  '5341776086',
] as const

type NcmMethod = (query: Record<string, unknown>) => Promise<{ body?: Record<string, unknown> }>

export interface DiscoverNcm {
  playlist_detail: NcmMethod
  top_artists: NcmMethod
  album_new: NcmMethod
}

interface DiscoverDependencies {
  ncm: DiscoverNcm
  timeoutMs: number
}

export class DiscoverError extends CatalogError {
  constructor(code: 'DISCOVER_UNSUPPORTED' | 'DISCOVER_UPSTREAM') {
    const unsupported = code === 'DISCOVER_UNSUPPORTED'
    super(unsupported ? 'unsupported' : 'upstream', code, unsupported ? 400 : 503)
    this.name = 'DiscoverError'
  }
}

function toRadar(raw: Raw): Playlist | null {
  const id = numericId(raw.id)
  const name = text(raw.name)
  if (!id || !name) return null
  return {
    id,
    name,
    ...neteaseCover(raw),
    trackCount: count(raw.trackCount) ?? 0,
    source: 'netease',
    creator: isRecord(raw.creator) ? text(raw.creator.nickname) : '',
    description: text(raw.description) || undefined,
  }
}

export function createDiscoverService(overrides: Partial<DiscoverDependencies> = {}) {
  const deps: DiscoverDependencies = {
    ncm: ncmApi as unknown as DiscoverNcm,
    timeoutMs: REQUEST_TIMEOUT_MS,
    ...overrides,
  }
  const cachedRadar = sharedCache<Playlist[]>(2, RADAR_TTL_MS)
  const cachedArtists = sharedCache<Artist[]>(2, CHART_TTL_MS)
  const cachedAlbums = sharedCache<Playlist[]>(2, CHART_TTL_MS)
  const upstream = () => new DiscoverError('DISCOVER_UPSTREAM')
  const call = createNcmCaller(
    deps.timeoutMs,
    { upstream, notFound: upstream },
    (label, code) => logger.warn(`NetEase ${label} failed`, code === undefined ? undefined : { code }),
  )

  const radar = () =>
    cachedRadar('radar', async () => {
      const settled = await Promise.allSettled(
        RADAR_PLAYLIST_IDS.map((id) =>
          call('playlist_detail(radar)', deps.ncm.playlist_detail, { id, timestamp: Date.now() }),
        ),
      )
      const lists = settled.flatMap((result) => {
        if (result.status !== 'fulfilled' || !isRecord(result.value.playlist)) return []
        const list = toRadar(result.value.playlist)
        return list ? [list] : []
      })
      if (lists.length === 0) throw upstream()
      return lists
    })

  const artists = () =>
    cachedArtists('top', async () => {
      const body = await call('top_artists', deps.ncm.top_artists, { limit: HOME_LIMIT })
      return pick(body.artists, (raw) => neteaseArtist(raw))
    })

  const albums = () =>
    cachedAlbums('new', async () => {
      const body = await call('album_new', deps.ncm.album_new, { limit: HOME_LIMIT })
      return pick(body.albums, neteaseAlbum)
    })

  return {
    /** 雷达歌单、热门歌手与新碟，均为匿名公共内容；各区块独立失败，全部失败才整体报错。 */
    async getHome(source: MusicSource): Promise<DiscoverHome> {
      if (!DISCOVER_SOURCES.includes(source)) throw new DiscoverError('DISCOVER_UNSUPPORTED')
      const blocks: DiscoverHomeBlock[] = ['radar', 'artists', 'albums']
      const settled = await Promise.allSettled([radar(), artists(), albums()])
      if (settled.every((result) => result.status === 'rejected')) throw upstream()
      const value = <T>(index: number): T[] => {
        const result = settled[index]!
        return result.status === 'fulfilled' ? (result.value as T[]) : []
      }
      return {
        radar: value<Playlist>(0),
        artists: value<Artist>(1),
        albums: value<Playlist>(2),
        failed: blocks.filter((_, index) => settled[index]!.status === 'rejected'),
      }
    },
  }
}

export const discoverService = createDiscoverService()
