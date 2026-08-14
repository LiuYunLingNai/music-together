import { promisify } from 'node:util'
import { unzip } from 'node:zlib'

const unzipAsync = promisify(unzip)
const KRC_ENCODE_KEY = Buffer.from([64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105])
const KUGOU_LYRIC_BASE_URL = 'https://lyrics.kugou.com'
const REQUEST_TIMEOUT_MS = 10_000

export interface KrcWord {
  word: string
  offset: number
  duration: number
}

export interface KrcInfo {
  title?: string
  artist?: string
  album?: string
  by?: string
  offset?: string
  items: KrcWord[][]
}

interface KugouLyricCandidate {
  id?: string
  accesskey?: string
}

interface KugouSearchResponse {
  candidates?: KugouLyricCandidate[]
}

interface KugouDownloadResponse {
  fmt?: string
  content?: string
}

function parseWords(input: string): KrcWord[] {
  const words: KrcWord[] = []
  const pattern = /<(\d+),(\d+),(\d+)>(.*?)(?=<\d+,\d+,\d+>|$)/g
  for (const match of input.matchAll(pattern)) {
    words.push({ word: match[4], offset: Number(match[1]), duration: Number(match[2]) })
  }
  return words
}

export function parseKrc(content: string): KrcInfo {
  const result: KrcInfo = { items: [] }
  const lines: Array<{ offset: number; words: KrcWord[] }> = []
  const metadata: Array<[keyof Omit<KrcInfo, 'items'>, RegExp]> = [
    ['title', /^\[ti:([\s\S]*?)\]/],
    ['artist', /^\[ar:([\s\S]*?)\]/],
    ['album', /^\[al:([\s\S]*?)\]/],
    ['by', /^\[by:([\s\S]*?)\]/],
    ['offset', /^\[offset:([\s\S]*?)\]/],
  ]

  for (const rawLine of content.split(/[\r\n]/)) {
    const line = rawLine.trim()
    if (!line) continue
    const metadataMatch = metadata.find(([, pattern]) => pattern.test(line))
    if (metadataMatch) {
      const [key, pattern] = metadataMatch
      result[key] = line.match(pattern)?.[1]
      continue
    }

    const lineMatch = line.match(/^((?:\[\d+,\d+\])+)([\s\S]+)$/)
    if (!lineMatch) continue
    const words = parseWords(lineMatch[2])
    for (const timeTag of lineMatch[1].match(/\[(\d+),(\d+)\]/g) ?? []) {
      const timeMatch = timeTag.match(/^\[(\d+),(\d+)\]$/)
      if (timeMatch) lines.push({ offset: Number(timeMatch[1]), words })
    }
  }

  lines.sort((left, right) => left.offset - right.offset)
  result.items = lines.map((line) =>
    line.words.map((word) => ({
      word: word.word,
      offset: (line.offset + word.offset) / 1000,
      duration: word.duration / 1000,
    })),
  )
  return result
}

export async function decodeKrc(content: Buffer): Promise<string> {
  if (content.length <= 4 || content.subarray(0, 4).toString() !== 'krc1') throw new Error('Invalid KRC content')
  const encrypted = content.subarray(4)
  const decoded = Buffer.alloc(encrypted.length)
  for (let index = 0; index < encrypted.length; index += 1) {
    decoded[index] = encrypted[index] ^ KRC_ENCODE_KEY[index % KRC_ENCODE_KEY.length]
  }
  return (await unzipAsync(decoded)).toString('utf8')
}

async function fetchJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`Kugou lyric HTTP ${response.status}`)
  return (await response.json()) as T
}

export async function getKrcByHash(hash: string): Promise<KrcInfo | null> {
  const searchUrl = new URL('/search', KUGOU_LYRIC_BASE_URL)
  searchUrl.search = new URLSearchParams({ ver: '1', man: 'yes', client: 'pc', hash }).toString()
  const searchResult = await fetchJson<KugouSearchResponse>(searchUrl)
  const candidate = searchResult.candidates?.find((item) => item.id && item.accesskey)
  if (!candidate?.id || !candidate.accesskey) return null

  const downloadUrl = new URL('/download', KUGOU_LYRIC_BASE_URL)
  downloadUrl.search = new URLSearchParams({
    ver: '1',
    client: 'pc',
    charset: 'utf8',
    id: candidate.id,
    accesskey: candidate.accesskey,
    fmt: 'krc',
  }).toString()
  const downloadResult = await fetchJson<KugouDownloadResponse>(downloadUrl)
  if (downloadResult.fmt !== 'krc' || !downloadResult.content) return null
  return parseKrc(await decodeKrc(Buffer.from(downloadResult.content, 'base64')))
}
