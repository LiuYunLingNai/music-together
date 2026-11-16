import type Meting from '@meting/core'
import { MUSIC_SOURCE_CAPABILITIES, type LyricPayloadSource, type LyricWordFormat, type MusicSource } from '@music-together/shared'
import ncmApi from '@neteasecloudmusicapienhanced/api'
import { logger } from '../utils/logger.js'
import { getKrcByHash, type KrcInfo } from './kugouLyricService.js'
import { qrcDecrypt } from './qqQrcDecrypt.js'

type MetingInstance = InstanceType<typeof Meting>
type MetingJson = Record<string, unknown>
import { withTimeoutOrNull as withTimeout } from '../utils/withTimeout.js'

/** AMLL LyricLine 格式（与 @applemusic-like-lyrics/core 一致，避免引入 client 依赖） */
export interface AmllLyricLine {
  words: Array<{ word: string; startTime: number; endTime: number; romanWord: string; obscene: boolean }>
  translatedLyric: string
  romanLyric: string
  startTime: number
  endTime: number
  isBG: boolean
  isDuet: boolean
}

export interface LyricResult {
  lyric: string
  tlyric: string
  romalrc: string
  yrc: string
  wordByWord?: AmllLyricLine[]
  /** Raw word-timing payload; clients parse it according to `wordFormat`. */
  wordLyric?: string
  wordFormat?: LyricWordFormat
  source?: LyricPayloadSource
}

/** 将 KRC 解析结果转为 AMLL LyricLine 格式 */
function krcToAmllLines(krcInfo: KrcInfo): AmllLyricLine[] {
  if (!krcInfo.items?.length) return []
  return krcInfo.items.map((line) => {
    if (!line.length) {
      return {
        words: [],
        translatedLyric: '',
        romanLyric: '',
        startTime: 0,
        endTime: 0,
        isBG: false,
        isDuet: false,
      }
    }
    const words = line.map((w) => ({
      word: w.word,
      startTime: Math.round(w.offset * 1000),
      endTime: Math.round((w.offset + w.duration) * 1000),
      romanWord: '',
      obscene: false,
    }))
    const first = words[0]!
    const last = words[words.length - 1]!
    return {
      words,
      translatedLyric: '',
      romanLyric: '',
      startTime: first.startTime,
      endTime: last.endTime,
      isBG: false,
      isDuet: false,
    }
  })
}

const QQ_LYRIC_MAX_CHARS = 2 * 1024 * 1024

/** QQ returns word-by-word lyrics (QRC XML) encrypted from the same lyric endpoint. */
async function getTencentQrcLyric(
  songMid: string,
): Promise<{ lyric: string; translation: string; romanization: string } | null> {
  const response = await fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Referer: 'https://y.qq.com/',
    },
    body: JSON.stringify({
      comm: { ct: 24, cv: 0 },
      lyric: {
        module: 'music.musichallSong.PlayLyricInfo',
        method: 'GetPlayLyricInfo',
        param: {
          songMid,
          type: 0,
          crypt: 1,
          qrc: 1,
          qrc_t: 0,
          lrc_t: 0,
          trans: 1,
          trans_t: 0,
          roma: 1,
          roma_t: 0,
        },
      },
    }),
    signal: AbortSignal.timeout(8_000),
  })
  if (!response.ok) throw new Error(`QQ QRC HTTP ${response.status}`)
  const raw = await response.text()
  if (raw.length > QQ_LYRIC_MAX_CHARS) throw new Error('QQ QRC payload is too large')
  const body = JSON.parse(raw) as {
    lyric?: { code?: number; data?: { lyric?: string; trans?: string; roma?: string } }
  }
  if (body.lyric?.code !== 0) return null
  const data = body.lyric?.data
  if (!data?.lyric) return null
  const lyric = await qrcDecrypt(data.lyric)
  if (!/\[\d+,\d+\]/.test(lyric)) return null
  const [translation, romanization] = await Promise.all([
    data.trans ? qrcDecrypt(data.trans).catch(() => '') : '',
    data.roma ? qrcDecrypt(data.roma).catch(() => '') : '',
  ])
  return { lyric, translation, romanization }
}

/** QQ's legacy lyric endpoint can omit translations that its explicit lyric request provides. */
async function getTencentTranslatedLyric(songMid: string): Promise<string> {
  const response = await fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Referer: 'https://y.qq.com/',
    },
    body: JSON.stringify({
      comm: { ct: 24, cv: 0 },
      lyric: {
        module: 'music.musichallSong.PlayLyricInfo',
        method: 'GetPlayLyricInfo',
        param: { songMid, type: 1, crypt: 0, trans: 1, trans_t: 0, lrc_t: 0 },
      },
    }),
    signal: AbortSignal.timeout(8_000),
  })
  if (!response.ok) throw new Error(`QQ lyric HTTP ${response.status}`)
  const body = (await response.json()) as {
    lyric?: { code?: number; data?: { trans?: string } }
  }
  if (body.lyric?.code !== 0) return ''
  const encoded = body.lyric.data?.trans
  if (!encoded || !/^[A-Za-z0-9+/=]+$/.test(encoded)) return ''
  const translated = Buffer.from(encoded, 'base64').toString('utf8')
  return /\[\d{2}:\d{2}(?:\.\d+)?\]/.test(translated) ? translated : ''
}

export const EMPTY_LYRIC: LyricResult = { lyric: '', tlyric: '', romalrc: '', yrc: '' }

export async function fetchLyric(
  source: MusicSource,
  lyricId: string,
  createInstance: (source: MusicSource) => MetingInstance,
): Promise<LyricResult | null> {

  try {
    const lyricCapabilities = MUSIC_SOURCE_CAPABILITIES[source].lyrics
    if (!lyricCapabilities.lrc && !lyricCapabilities.wordByWord) return null

    let result: LyricResult = { ...EMPTY_LYRIC }

    if (source === 'netease') {
      // 使用 ncmApi.lyric_new 获取包含逐词歌词 (YRC) 的完整响应
      const res = await withTimeout(ncmApi.lyric_new({ id: lyricId }))
      if (!res?.body) {
        logger.warn(`Lyric fetch timeout for ${source}: ${lyricId}`)
        return null
      }
      const body = res.body
      result = {
        lyric: (body.lrc?.lyric as string) || '',
        tlyric: (body.tlyric?.lyric as string) || '',
        romalrc: ((body.romalrc as Record<string, unknown> | undefined)?.lyric as string) || '',
        yrc: (body.yrc?.lyric as string) || '',
      }
      if (result.yrc) {
        result.wordLyric = result.yrc
        result.wordFormat = 'yrc'
        result.source = 'platform'
        logger.debug('已获取网易云逐字歌词', { source: 'netease', lyricId })
      }
    } else if (source === 'kugou' || source === 'kugou_concept') {
      // 酷狗：Meting 获取 LRC + kugou-lrc 获取 KRC 逐字歌词
      const meting = createInstance('kugou')
      const raw = await withTimeout(meting.lyric(lyricId))
      if (raw === null || raw === undefined) {
        logger.warn(`Lyric fetch timeout for ${source}: ${lyricId}`)
        return null
      }
      try {
        const data = JSON.parse(raw as string) as MetingJson
        result = {
          lyric: (data.lyric as string) || '',
          tlyric: (data.tlyric as string) || '',
          romalrc: '',
          yrc: '',
        }
      } catch {
        return null
      }
      // 尝试获取 KRC 逐字歌词
      try {
        const krcInfo = await withTimeout(getKrcByHash(lyricId))
        if (krcInfo?.items?.length) {
          result.wordByWord = krcToAmllLines(krcInfo)
          result.source = 'platform'
          if (krcInfo.raw) {
            result.wordLyric = krcInfo.raw
            result.wordFormat = 'krc'
          }
          logger.debug('已获取酷狗逐字歌词', { source: 'kugou', lyricId })
        }
      } catch {
        /* 静默回退到 LRC */
      }
    } else {
      // QQ 音乐：Meting 提供 LRC/译文，QQ 歌词接口额外提供加密 QRC 逐字轨
      const meting = createInstance(source)
      const raw = await withTimeout(meting.lyric(lyricId))
      if (raw === null || raw === undefined) {
        logger.warn(`Lyric fetch timeout for ${source}: ${lyricId}`)
        return null
      }
      try {
        const data = JSON.parse(raw as string) as MetingJson
        result = {
          lyric: (data.lyric as string) || '',
          tlyric: (data.tlyric as string) || '',
          romalrc: '',
          yrc: '',
        }
      } catch {
        return null
      }
      if (source === 'tencent') {
        const [qrcResult, translationResult] = await Promise.allSettled([
          getTencentQrcLyric(lyricId),
          result.lyric && !result.tlyric ? getTencentTranslatedLyric(lyricId) : Promise.resolve(''),
        ])
        if (qrcResult.status === 'fulfilled' && qrcResult.value) {
          result.wordLyric = qrcResult.value.lyric
          result.wordFormat = 'qrc'
          result.source = 'platform'
          if (qrcResult.value.translation) result.tlyric = qrcResult.value.translation
          if (qrcResult.value.romanization) result.romalrc = qrcResult.value.romanization
          logger.debug('已获取 QQ 逐字歌词', { lyricId })
        } else if (qrcResult.status === 'rejected') {
          logger.debug('QQ 逐字歌词获取失败，保留 LRC', { lyricId, err: qrcResult.reason })
        }
        if (translationResult.status === 'fulfilled' && translationResult.value && !result.tlyric) {
          result.tlyric = translationResult.value
        } else if (translationResult.status === 'rejected') {
          logger.debug('QQ 译文补取失败，保留原歌词', { lyricId, err: translationResult.reason })
        }
      }
      if (!result.source) result.source = 'lrc'
    }

    if (!result.source) result.source = result.wordFormat ? 'platform' : 'lrc'

    return result
  } catch (err) {
    logger.error(`Get lyric failed for ${source}:`, err)
    return null
  }
}

