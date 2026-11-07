import type { MusicSource, PlaybackFailure, PlaybackFailureReason, Track } from '@music-together/shared'
import type { ProviderStreamFailure } from './musicProvider.js'

/** User can resolve these by signing in, buying, or switching region/source. */
const ACTIONABLE = new Set<PlaybackFailureReason>([
  'sign-in-needed',
  'subscription-required',
  'purchase-required',
  'region-restricted',
  'unsupported-quality',
])

/** Worth retrying later; the same request may succeed. */
const RETRYABLE = new Set<PlaybackFailureReason>(['upstream-unreachable', 'rate-limited', 'unknown'])

/** The platform says the audio itself is gone; skipping is usually the only option. */
const UNPLAYABLE = new Set<PlaybackFailureReason>(['taken-down', 'no-audio', 'not-playable'])

export function toPlaybackFailure(source: MusicSource, info: ProviderStreamFailure): PlaybackFailure {
  return {
    source,
    reason: info.reason,
    retryable: RETRYABLE.has(info.reason),
    actionable: ACTIONABLE.has(info.reason),
    providerCode: info.providerCode,
    providerMessage: info.providerMessage?.slice(0, 200),
    httpStatus: info.httpStatus,
    retryAfterMs: info.retryAfterMs,
  }
}

/**
 * 媒体元素已经拿到地址却放不出来时，服务端能推断出的原因。
 * 地址解析成功但 CDN 拒绝，最常见的是 VIP/登录问题；否则按“平台没有可用音频”处理。
 */
export function inferMediaFailure(track: Track, authenticated: boolean): PlaybackFailure {
  const reason: PlaybackFailureReason = track.vip
    ? authenticated
      ? 'subscription-required'
      : 'sign-in-needed'
    : 'not-playable'
  return toPlaybackFailure(track.source, {
    reason,
    providerMessage: 'media element rejected the resolved stream',
  })
}

export interface FailureAction {
  nextAction: 'stop' | 'skip'
  autoActionInMs?: number
}

/**
 * 房间层面的收尾动作：能靠用户动作解决的失败、以及值得重试的失败，停在原地等处理；
 * 平台明确没有音频的失败倒计时后自动跳过，避免整个房间卡死在一首下架歌曲上。
 */
export function decideFailureAction(failure: PlaybackFailure, autoSkipUnplayable: boolean): FailureAction {
  if (ACTIONABLE.has(failure.reason) || failure.retryable) return { nextAction: 'stop' }
  if (UNPLAYABLE.has(failure.reason) && autoSkipUnplayable) {
    return { nextAction: 'skip', autoActionInMs: 8_000 }
  }
  return { nextAction: 'stop' }
}
