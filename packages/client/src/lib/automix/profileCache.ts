import type { AutomixTrackProfile } from '@music-together/shared'
import { TRACK_PROFILE_VERSION } from './upstream/trackProfile'

const PREFIX = `mt-automix-profile-v${TRACK_PROFILE_VERSION}:`
const INDEX_KEY = `${PREFIX}index`
const MAX_ENTRIES = 80

const readIndex = (): string[] => {
  try {
    const raw = localStorage.getItem(INDEX_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : []
  } catch {
    return []
  }
}

/** 画像只按稳定曲目身份缓存，流地址会过期，不能进 key。 */
export function readCachedProfile(trackKey: string): AutomixTrackProfile | null {
  try {
    const raw = localStorage.getItem(`${PREFIX}${trackKey}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AutomixTrackProfile
    return parsed?.version === TRACK_PROFILE_VERSION ? parsed : null
  } catch {
    return null
  }
}

export function writeCachedProfile(trackKey: string, profile: AutomixTrackProfile): void {
  if (profile.version !== TRACK_PROFILE_VERSION) return
  try {
    localStorage.setItem(`${PREFIX}${trackKey}`, JSON.stringify(profile))
    // 只写不淘汰最终会吃满配额，之后每次写入都静默失败、缓存形同虚设。
    const index = [trackKey, ...readIndex().filter((key) => key !== trackKey)]
    for (const stale of index.slice(MAX_ENTRIES)) localStorage.removeItem(`${PREFIX}${stale}`)
    localStorage.setItem(INDEX_KEY, JSON.stringify(index.slice(0, MAX_ENTRIES)))
  } catch {
    // 配额不足/隐私模式：缓存只是优化，分析结果仍然可用。
  }
}
