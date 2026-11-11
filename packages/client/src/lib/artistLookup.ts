import { getMusicJson } from '@/lib/musicApi'
import type { Artist, MusicSource, Track } from '@music-together/shared'

const LOOKUP_LIMIT = 5

function sameName(a: string, b: string): boolean {
  const key = (name: string) => name.normalize('NFKC').replace(/\s+/g, '').toLowerCase()
  return key(a) === key(b)
}

/** 按名字精确匹配歌手搜索结果；没有同名结果时返回 null，避免模糊命中打开别人的主页。 */
export async function findArtistByName(source: MusicSource, name: string, signal: AbortSignal): Promise<Artist | null> {
  const body = await getMusicJson<{ tracks?: Track[] }>(
    'search',
    { source, keyword: name, limit: LOOKUP_LIMIT, page: 1, type: 'artist' },
    signal,
  )
  const hit = (body.tracks ?? []).find((artist) => sameName(artist.title, name))
  return hit ? { id: hit.sourceId, name: hit.title, cover: hit.cover, source } : null
}
