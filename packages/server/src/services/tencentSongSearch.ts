import type { Track } from '@music-together/shared'
import { nanoid } from 'nanoid'
import { z } from 'zod/v4'
import { API_TIMEOUT_MS } from '../utils/withTimeout.js'
import { count, isRecord, pick, SearchError, text, type Raw } from './catalogUtils.js'
import { parseTencentCredential } from './tencentAuthService.js'
import { tencentDurationSeconds } from './trackMapping.js'

const searchReply = z.object({
  code: z.literal(0).optional(),
  music: z.object({
    code: z.literal(0),
    data: z.object({ body: z.object({ song: z.object({ list: z.array(z.unknown()) }) }) }),
  }),
})

function toSearchTrack(song: Raw): Track | null {
  const mid = text(song.mid)
  if (!mid) return null

  const name = text(song.name)
  const title = text(song.title)
  const artists = pick(song.singer, (singer) => text(singer.name) || null)
  const album = isRecord(song.album) ? song.album : {}
  const albumMid = text(album.mid) || text(album.pmid)
  const pay = isRecord(song.pay) ? song.pay : {}
  const action = isRecord(song.action) ? song.action : {}
  return {
    id: nanoid(),
    source: 'tencent',
    sourceId: mid,
    urlId: mid,
    lyricId: mid,
    title: name || title || 'Unknown',
    artist: artists.length ? artists : ['Unknown'],
    album: text(album.name) || text(album.title),
    duration: tencentDurationSeconds(song.interval),
    cover: albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${encodeURIComponent(albumMid)}.jpg` : '',
    picId: albumMid,
    vip:
      pay.pay_month === 1 ||
      pay.pay_down === 1 ||
      pay.pay_play === 1 ||
      (count(action.msgpay) ?? 0) > 0 ||
      (count(pay.price_track) ?? 0) > 0,
    ...(name && title && name !== title ? { lyricAliases: { title } } : {}),
  }
}

export async function searchTencentSongs(
  keyword: string,
  limit: number,
  page: number,
  cookie?: string | null,
): Promise<Track[]> {
  if (!keyword.trim()) return []
  const credential = cookie ? parseTencentCredential(cookie) : null
  try {
    const response = await fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        ...(credential ? { Cookie: `uin=${credential.musicid}; qm_keyst=${credential.musickey}` } : {}),
      },
      body: JSON.stringify({
        comm: { ct: '19', cv: '1910' },
        music: {
          module: 'music.search.SearchCgiService',
          method: 'DoSearchForQQMusicDesktop',
          param: { grp: 1, num_per_page: limit, page_num: page, query: keyword },
        },
      }),
    })
    if (!response.ok) throw new SearchError()
    const { music } = searchReply.parse(await response.json())
    const songs = music.data.body.song.list
    const tracks = pick(songs, toSearchTrack)
    if (songs.length && !tracks.length) throw new SearchError()
    return tracks
  } catch {
    throw new SearchError()
  }
}
