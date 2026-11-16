import type { Track } from '@music-together/shared'

const UPGRADABLE_CDN = /(^|\.)(music\.126\.net|qq\.com|kugou\.com|hdslb\.com)$/i

function safeCover(cover: string | undefined): string | undefined {
  if (!cover || cover.startsWith('/')) return cover
  try {
    const url = new URL(cover)
    if (url.protocol === 'https:') return cover
    if (url.protocol === 'http:' && UPGRADABLE_CDN.test(url.hostname)) {
      url.protocol = 'https:'
      return url.toString()
    }
  } catch {
    // 非法地址按无封面处理
  }
  return undefined
}

/** 客户端带来的曲目不可信：播放地址只能由服务端解析，封面只接受 https。 */
export function sanitizeIncomingTrack<T extends Track>(track: T): T {
  const { streamUrl: _dropped, thumbnailCover: rawThumbnail, ...rest } = track
  const cover = safeCover(rest.cover)
  const thumbnailCover = safeCover(rawThumbnail)
  return { ...rest, cover: cover ?? '', ...(thumbnailCover ? { thumbnailCover } : {}) } as T
}
