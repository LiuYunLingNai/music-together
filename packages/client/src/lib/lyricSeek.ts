import type { LyricLine } from '@applemusic-like-lyrics/core'

export function getLyricSeekTime(line: LyricLine, offsetMs: number, durationSeconds: number): number | null {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null

  const firstWordStartMs = line.words[0]?.startTime
  const lineStartMs = Number.isFinite(firstWordStartMs) ? firstWordStartMs : line.startTime
  if (!Number.isFinite(lineStartMs)) return null

  const safeOffsetMs = Number.isFinite(offsetMs) ? offsetMs : 0
  const targetSeconds = (lineStartMs + safeOffsetMs) / 1000
  return Math.min(durationSeconds, Math.max(0, targetSeconds))
}
