/** Folia's `detectChorusLines`: the most repeated lyric text is treated as the chorus. */
const TIME_TAG = /\[(\d{2,3}):(\d{2})[.:](\d{2,3})\]/g

export function detectChorusLines(lrc: string): Set<string> {
  const counts = new Map<string, number>()
  for (const rawLine of lrc.split('\n')) {
    const text = rawLine.replace(TIME_TAG, '').trim()
    if (!text || text === '......' || text.length < 2) continue
    counts.set(text, (counts.get(text) ?? 0) + 1)
  }

  let maxCount = 0
  for (const count of counts.values()) {
    if (count > maxCount) maxCount = count
  }

  const chorus = new Set<string>()
  if (maxCount <= 1) return chorus
  for (const [text, count] of counts) {
    if (count === maxCount) chorus.add(text)
  }
  return chorus
}
