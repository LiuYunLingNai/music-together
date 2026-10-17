/**
 * 酷狗歌曲字段解析 —— 同时兼容**标准版**与**概念版**两套命名。
 *
 * ============================ 为什么需要这一层 ============================
 *
 * 酷狗两个源走的接口不同，返回字段的大小写命名也不同：
 *
 *   标准版（mobilecdn `api/v3/search/song`）→ **小写**
 *     { hash, filename: '歌手 - 歌名', singername, album_name, duration, privilege, imgurl }
 *
 *   概念版（gateway `v3/search/song`，x-router: complexsearch）→ **PascalCase**
 *     { FileHash, FileName: '歌手 - 歌名', SingerName, AlbumName, Duration,
 *       PayType, Image, OriSongName, Singers: [{ name }] }
 *
 * 历史事故：概念版的解析只读了 `filename / songname / SongName`，三个全读空，于是
 * `title` 落到兜底的占位名（"Unknown" / "未知歌曲"），而歌手名因为有 `SingerName`
 * 兜底、专辑有 `AlbumName` 兜底、时长有 `Duration` 兜底，所以**只有歌名坏掉**，
 * 表现为"概念版搜出来的歌名是 unknown"。`PayType` 同样没读 → VIP 标记一并丢失。
 *
 * 因此这里把字段提取收敛成一个纯函数：两套命名都读，标准版行为保持不变。
 * 纯函数、无网络、无副作用，便于用真实抓包做回归测试。
 */

/** 酷狗一首歌解析出的、与接口版本无关的字段。`cover` 是原始 URL，归一化由调用方负责。 */
export interface KugouSongFields {
  /** 播放/歌词/封面都用的 hash（`FileHash` 是概念版写法）。缺省时为空串。 */
  hash: string
  /** 歌名。可能为空串（调用方决定是否落占位名）。 */
  title: string
  /** 歌手列表。空数组表示解析不出。 */
  artists: string[]
  /** 专辑名，可能为空串。 */
  album: string
  /** 时长（**秒**）。接口若给毫秒会被换算；缺失或非法为 0。 */
  duration: number
  /** 原始封面 URL（可能是 `{size}` 模板），未归一化。 */
  cover: string
  /** 是否需要 VIP/付费权限。 */
  vip: boolean
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** 取第一个非空字符串并 trim —— 字段兜底链的统一写法。 */
function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed) return trimmed
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value)
    }
  }
  return ''
}

/**
 * 歌手分隔符。
 *
 * ★ 两个分隔符集合**刻意不同**，与改造前的行为逐字一致：
 *   文件名前缀里 `&` 常用来并列歌手（"A & B - 歌名"），而 `SingerName` 字段里
 *   `&` 可能是名字本身的一部分（"Tom & Jerry"），拆开反而错。
 */
const ARTIST_SEPARATOR_IN_SINGER = /[、,，]/
const ARTIST_SEPARATOR_IN_FILENAME = /[、,，&]/

function splitArtists(value: string, separator: RegExp): string[] {
  if (!value) return []
  return value
    .split(separator)
    .map((artist) => artist.trim())
    .filter(Boolean)
}

/** 概念版的 `Singers: [{ name, id, ip_id }]`。 */
function singersFromArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => firstString(asRecord(entry)?.name, asRecord(entry)?.nickname))
    .filter(Boolean)
}

/**
 * 把酷狗原始歌曲对象解析成与接口版本无关的字段。
 *
 * 字段优先级均为「标准版写法优先、概念版写法兜底」，因此标准版结果与改造前完全一致。
 */
export function parseKugouSongFields(song: Record<string, unknown>): KugouSongFields {
  const audioInfo = asRecord(song.audio_info)
  const hash = firstString(song.hash, song.FileHash, audioInfo?.hash)

  // 歌名：标准版 filename / songname / SongName；概念版 FileName。
  const fileName = firstString(song.filename, song.FileName, song.songname, song.SongName, song.name)
  const parts = fileName.split(' - ')
  const hasArtistPrefix = parts.length >= 2
  const titleFromFileName = hasArtistPrefix ? parts.slice(1).join(' - ').trim() : fileName
  // 拆不出歌名（或压根没有文件名）时退概念版的 OriSongName —— 它是"原始歌名"，
  // 不含歌手前缀，正好是我们要的。
  const title = titleFromFileName || firstString(song.OriSongName, song.SongName)

  // 歌手：文件名前缀 > SingerName/singername > Singers 数组。
  // 保留「文件名前缀优先」是因为它按接口约定就是 `歌手 - 歌名`，比字段更可靠。
  const fromFileName = hasArtistPrefix ? splitArtists(parts[0], ARTIST_SEPARATOR_IN_FILENAME) : []
  const declared = splitArtists(firstString(song.SingerName, song.singername), ARTIST_SEPARATOR_IN_SINGER)
  const artists = fromFileName.length > 0 ? fromFileName : declared.length > 0 ? declared : singersFromArray(song.Singers)

  // 时长：酷狗多数接口返回秒，个别返回毫秒。阈值 100000（约 27 小时）安全区分两者。
  const rawDuration = Number(song.duration ?? song.Duration ?? song.timelen ?? 0)
  const duration = Number.isFinite(rawDuration)
    ? rawDuration > 100000
      ? Math.floor(rawDuration / 1000)
      : rawDuration
    : 0

  // VIP：标准版 privilege（位掩码）/ pay_type；概念版 PayType。
  // `& 8` 是上游的「付费位」，`> 0` 覆盖其余非零档位。
  const privilege = Number(song.privilege ?? song.pay_type ?? song.PayType ?? 0)

  const cover = firstString(
    asRecord(song.trans_param)?.union_cover,
    asRecord(audioInfo?.trans_param)?.union_cover,
    song.imgurl,
    song.Image,
    song.album_img,
  )

  return {
    hash,
    title,
    artists,
    album: firstString(song.album_name, song.AlbumName, song.remark),
    duration,
    cover,
    vip: Number.isFinite(privilege) ? (privilege & 8) !== 0 || privilege > 0 : false,
  }
}
