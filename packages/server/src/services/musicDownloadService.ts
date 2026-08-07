import type {
  AudioQuality,
  DownloadOptionsResponse,
  DownloadQualityOption,
  MusicSource,
  Track,
} from '@music-together/shared'
import type { Request, Response } from 'express'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import pLimit from 'p-limit'
import * as authService from './authService.js'
import { getAvailableAudioQualities, providerQualityRank, type MembershipTier } from './audioQualityPolicy.js'
import { createKugouDecryptStream, getKugouEncryptedAudio, kugouAudioContentType } from './kugouEncryptedAudio.js'
import { normalizeKugouAudioUrl } from './kugouAudioUrl.js'
import { parseBilibiliStreamId } from './bilibiliInput.js'
import { musicProvider, type StreamUrlResult } from './musicProvider.js'

const resolveLimit = pLimit(3)
const UPSTREAM_CONNECT_TIMEOUT_MS = 15_000

export class MusicDownloadError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message)
  }
}

function getRoomAuth(source: MusicSource, roomId: string) {
  return authService.getBestAuth(source, roomId)
}

function inferExtension(stream: StreamUrlResult, contentType?: string | null): string {
  const encrypted = getKugouEncryptedAudio(stream.url)
  if (encrypted) return encrypted.format
  if (stream.streamFormat) return stream.streamFormat

  try {
    const extension = new URL(stream.url).pathname.match(/\.([a-z0-9]{2,6})$/i)?.[1]?.toLowerCase()
    if (extension === 'mflac') return 'flac'
    if (extension === 'mgg') return 'ogg'
    if (extension && ['mp3', 'flac', 'm4a', 'aac', 'ogg', 'wav'].includes(extension)) return extension
  } catch {
    // The provider URL was already validated while resolving the stream.
  }

  if (stream.providerFormat?.startsWith('AI00') || stream.providerFormat?.startsWith('F000')) return 'flac'
  if (stream.providerFormat?.startsWith('C600')) return 'm4a'
  if (stream.providerFormat?.startsWith('M')) return 'mp3'

  const mime = contentType?.split(';')[0].trim().toLowerCase()
  if (mime === 'audio/flac' || mime === 'audio/x-flac') return 'flac'
  if (mime === 'audio/mp4' || mime === 'audio/aac') return 'm4a'
  if (mime === 'audio/ogg') return 'ogg'
  if (mime === 'audio/wav' || mime === 'audio/x-wav') return 'wav'
  if (
    stream.actualQuality === 999 ||
    stream.actualQuality === 'netease_dolby' ||
    stream.actualQuality === 'netease_hires' ||
    stream.actualQuality === 'netease_jyeffect' ||
    stream.actualQuality === 'netease_master' ||
    stream.actualQuality === 'netease_spatial'
  ) {
    return 'flac'
  }
  return 'mp3'
}

function toDownloadOption(quality: AudioQuality, stream: StreamUrlResult): DownloadQualityOption {
  return {
    quality: stream.actualQuality ?? quality,
    actualBitrate: stream.actualBitrate,
    format: inferExtension(stream).toUpperCase(),
    fileSize: stream.fileSize,
  }
}

/** Probe the song itself because account entitlement alone does not guarantee that every file tier exists. */
export async function resolveDownloadOptions(roomId: string, track: Track): Promise<DownloadOptionsResponse> {
  const auth = getRoomAuth(track.source, roomId)
  const vipType = auth?.vipType ?? 0
  const qualities = getAvailableAudioQualities(track.source, vipType)
  const resolved = await Promise.all(
    qualities.map((quality) =>
      resolveLimit(async () => ({
        requestedQuality: quality,
        stream: await musicProvider.getStreamInfo(track.source, track.urlId, quality, auth?.cookie, false, vipType),
      })),
    ),
  )

  const options = new Map<string, DownloadQualityOption>()
  for (const { requestedQuality, stream } of resolved) {
    if (!stream) continue
    const option = toDownloadOption(requestedQuality, stream)
    if (!qualities.includes(option.quality)) continue
    const key = String(option.quality)
    if (!options.has(key)) options.set(key, option)
  }

  return {
    trackId: track.id,
    options: [...options.values()].sort(
      (left, right) =>
        providerQualityRank(track.source, left.quality) - providerQualityRank(track.source, right.quality),
    ),
  }
}

async function resolveDownloadStream(
  roomId: string,
  track: Track,
  quality: AudioQuality,
): Promise<{ stream: StreamUrlResult; cookie?: string }> {
  const auth = getRoomAuth(track.source, roomId)
  const vipType: MembershipTier = auth?.vipType ?? 0
  if (!getAvailableAudioQualities(track.source, vipType).includes(quality)) {
    throw new MusicDownloadError('当前房间账号无权下载该音质', 403)
  }

  const stream = await musicProvider.getStreamInfo(track.source, track.urlId, quality, auth?.cookie, true, vipType)
  if (!stream) throw new MusicDownloadError('该音质暂时无法下载', 502)
  if (
    stream.actualQuality &&
    providerQualityRank(track.source, stream.actualQuality) < providerQualityRank(track.source, quality)
  ) {
    throw new MusicDownloadError('该音质已不可用，请刷新音质列表', 409)
  }
  return { stream, cookie: auth?.cookie }
}

function safeUpstreamUrl(value: string, source: MusicSource): string {
  const normalized = source === 'kugou' || source === 'kugou_concept' ? normalizeKugouAudioUrl(value) : value
  let url: URL
  try {
    url = new URL(normalized)
  } catch {
    throw new MusicDownloadError('无效的上游音频地址', 502)
  }
  if (!['http:', 'https:'].includes(url.protocol) || !['', '80', '443'].includes(url.port)) {
    throw new MusicDownloadError('不安全的上游音频地址', 502)
  }
  const hostname = url.hostname.toLowerCase()
  const allowedSuffixes =
    source === 'bilibili'
      ? ['bilivideo.com', 'bilivideo.cn']
      : source === 'kugou' || source === 'kugou_concept'
        ? ['kugou.com', 'kugou.net']
        : null
  if (allowedSuffixes && !allowedSuffixes.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))) {
    throw new MusicDownloadError('不安全的上游音频地址', 502)
  }
  return url.toString()
}

function buildUpstreamHeaders(source: MusicSource, track: Track, cookie?: string, range?: string) {
  const headers: Record<string, string> = {
    Accept: '*/*',
    'Accept-Encoding': 'identity',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  }
  if (range && /^bytes=\d*-\d*$/.test(range)) headers.Range = range
  if (source === 'bilibili') {
    const bvid = parseBilibiliStreamId(track.urlId)?.bvid
    if (bvid) headers.Referer = `https://www.bilibili.com/video/${bvid}/`
    if (cookie) headers.Cookie = cookie
  } else if (source === 'tencent') {
    headers.Referer = 'https://y.qq.com/'
  } else if (source === 'netease') {
    headers.Referer = 'https://music.163.com/'
  } else {
    headers.Referer = 'https://www.kugou.com/'
  }
  return headers
}

async function fetchUpstream(
  stream: StreamUrlResult,
  source: MusicSource,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<globalThis.Response> {
  let upstreamUrl = safeUpstreamUrl(stream.url, source)
  for (let redirects = 0; redirects < 5; redirects += 1) {
    const response = await fetch(upstreamUrl, { headers, signal, redirect: 'manual' })
    if (response.status < 300 || response.status >= 400) return response
    const location = response.headers.get('location')
    await response.body?.cancel()
    if (!location) throw new MusicDownloadError('上游音频重定向无效', 502)
    upstreamUrl = safeUpstreamUrl(new URL(location, upstreamUrl).toString(), source)
  }
  throw new MusicDownloadError('上游音频重定向过多', 502)
}

function sanitizeFilenamePart(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
}

function contentDisposition(track: Track, extension: string): string {
  const base = sanitizeFilenamePart(`${track.title} - ${track.artist.join(', ')}`) || 'music'
  const unicodeFilename = `${base.slice(0, 180)}.${extension}`
  const asciiBase = sanitizeFilenamePart(base.normalize('NFKD').replace(/[^\x20-\x7e]/g, '')) || 'music'
  const asciiFilename = `${asciiBase.slice(0, 120)}.${extension}`.replace(/["\\]/g, '_')
  const encoded = encodeURIComponent(unicodeFilename).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encoded}`
}

/** Resolve the selected tier again and stream it as an attachment without exposing room credentials. */
export async function streamDownload(
  req: Request,
  res: Response,
  roomId: string,
  track: Track,
  quality: AudioQuality,
): Promise<void> {
  const { stream, cookie } = await resolveDownloadStream(roomId, track, quality)
  const controller = new AbortController()
  req.once('aborted', () => controller.abort())
  let connectTimedOut = false
  const connectTimeout = setTimeout(() => {
    connectTimedOut = true
    controller.abort()
  }, UPSTREAM_CONNECT_TIMEOUT_MS)

  try {
    const upstream = await fetchUpstream(
      stream,
      track.source,
      buildUpstreamHeaders(track.source, track, cookie, req.headers.range),
      controller.signal,
    )
    clearTimeout(connectTimeout)
    if ((!upstream.ok && upstream.status !== 206) || !upstream.body) {
      await upstream.body?.cancel()
      throw new MusicDownloadError('上游音频下载失败', 502)
    }

    const encrypted = getKugouEncryptedAudio(stream.url)
    const contentType = encrypted
      ? kugouAudioContentType(encrypted.format)
      : upstream.headers.get('content-type') || 'application/octet-stream'
    const extension = inferExtension(stream, contentType)

    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Disposition', contentDisposition(track, extension))
    res.setHeader('Cache-Control', 'private, no-store')
    for (const header of ['content-length', 'content-range', 'accept-ranges']) {
      const value = upstream.headers.get(header)
      if (value) res.setHeader(header, value)
    }
    res.status(upstream.status)

    const source = Readable.fromWeb(upstream.body as unknown as import('node:stream/web').ReadableStream)
    if (encrypted) {
      const rangeStart = upstream.headers.get('content-range')?.match(/^bytes (\d+)-\d+\/\d+$/i)?.[1]
      await pipeline(source, createKugouDecryptStream(encrypted.cipher, rangeStart ? Number(rangeStart) : 0), res)
    } else {
      await pipeline(source, res)
    }
  } catch (error) {
    if (connectTimedOut) throw new MusicDownloadError('连接上游音频超时', 504)
    throw error
  } finally {
    clearTimeout(connectTimeout)
  }
}
