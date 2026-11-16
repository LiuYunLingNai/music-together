const LRC_TAG_PATTERN = /\[[^\]]*]/g
const WORD_TIMING_TAG_PATTERN = /<[\d:.,\s]*>|\(\d+,\d+,\d+\)/g
const JSON_LINE_PATTERN = /^\s*\{.*}\s*$/
const NOTICE_IGNORED_CHARS_PATTERN = /[\s\p{P}\p{S}]+/gu
const NOTICE_PREFIX = '(?:[此本](?:首)?(?:歌曲|曲目|作品|乐曲|曲)?[为是]?)?(?:(?:没有|无)(?:填词|歌词)的)?'
const PURE_MUSIC_NOTICE_LINE = new RegExp(`^${NOTICE_PREFIX}[纯純]音[乐樂]敬?[请請][您你]?欣[赏賞]$`)
const HEADER_LINE_PATTERN = /\s[-–—]\s/
const STAFF_LINE_PATTERN =
  /^(?:作词|作曲|编曲|制作人?|出品人?|发行|版权|录音|混音|母带|演唱|和声|吉他|贝斯|鼓|弦乐|监制|企划|设计|歌词|音乐|producer|composer|arranger|lyricist|mixing|mastering|recording|vocal|guitar|bass|lyrics|music)\s*[:：]\s*\S/i
const SPACED_STAFF_PATTERN =
  /^(?:作词|作曲|编曲|制作|出品|发行|录音|混音|母带|演唱|和声|吉他|贝斯|鼓|弦乐|监制|producer|composer|arranger|lyricist|mixing|mastering|recording|vocal|guitar|bass)\s+\S/i
const COLON_SHAPED_PATTERN = /^[^:：]{1,16}[:：]/
const FILLER_LINE_PATTERN = /^[\s.·•…\-—_=*]*$/

function cleanLyricLines(text: string): string[] {
  return text
    .replace(/﻿/g, '')
    .split(/\r?\n/)
    .map((line) => line.replace(LRC_TAG_PATTERN, '').replace(WORD_TIMING_TAG_PATTERN, '').trim())
    .filter((line) => line && !JSON_LINE_PATTERN.test(line))
}

function isNoticeCompanionLine(line: string): boolean {
  return (
    STAFF_LINE_PATTERN.test(line) ||
    SPACED_STAFF_PATTERN.test(line) ||
    COLON_SHAPED_PATTERN.test(line) ||
    FILLER_LINE_PATTERN.test(line) ||
    HEADER_LINE_PATTERN.test(line)
  )
}

/** True only when the whole lyric is a pure-music notice plus credits/metadata. Empty text is not pure music. */
export function isPureMusicLyricText(text?: string | null): boolean {
  if (!text) return false
  let hasNotice = false
  for (const line of cleanLyricLines(text)) {
    if (PURE_MUSIC_NOTICE_LINE.test(line.replace(NOTICE_IGNORED_CHARS_PATTERN, ''))) {
      hasNotice = true
      continue
    }
    if (!isNoticeCompanionLine(line)) return false
  }
  return hasNotice
}
