import type { PlaybackFailure, PlaybackFailureReason } from '@music-together/shared'

export type PlaybackFailureTone = 'amber' | 'red' | 'sky'

export interface PlaybackFailureCopy {
  title: string
  note: string
  tone: PlaybackFailureTone
  /** Primary action the dialog should emphasize. */
  primary: 'login' | 'switch' | 'retry' | 'skip'
}

export function playbackFailureCopy(failure: PlaybackFailure, platformLabel: string): PlaybackFailureCopy {
  const reason: PlaybackFailureReason = failure.reason
  switch (reason) {
    case 'sign-in-needed':
      return {
        title: `${platformLabel}需要登录`,
        note: '登录对应平台后即可继续；也可以直接换一个音源。',
        tone: 'amber',
        primary: 'login',
      }
    case 'subscription-required':
      return {
        title: '这首需要会员',
        note: '当前账号没有该曲目的会员权益，登录会员账号或换源后再试。',
        tone: 'amber',
        primary: 'login',
      }
    case 'purchase-required':
      return {
        title: '这首需要购买',
        note: '平台要求单独购买单曲或专辑；换一个音源通常可以直接播放。',
        tone: 'amber',
        primary: 'switch',
      }
    case 'region-restricted':
      return {
        title: '当前地区无法播放',
        note: '版权限制了该地区；换一个音源或换一首歌。',
        tone: 'amber',
        primary: 'switch',
      }
    case 'taken-down':
      return {
        title: '歌曲已下架',
        note: '平台已经没有这首歌的可用音频，建议换源或跳过。',
        tone: 'red',
        primary: 'switch',
      }
    case 'no-audio':
      return {
        title: '没有可播放的音频',
        note: '平台返回的曲目没有音频轨道，建议换源或跳过。',
        tone: 'red',
        primary: 'switch',
      }
    case 'not-playable':
      return {
        title: '这首歌暂时无法播放',
        note: '可以重试、换一个音源，或直接跳过。',
        tone: 'red',
        primary: 'switch',
      }
    case 'unsupported-quality':
      return {
        title: '当前音质不可用',
        note: '可以降一档音质重试，或换一个音源。',
        tone: 'amber',
        primary: 'retry',
      }
    case 'upstream-unreachable':
      return {
        title: `${platformLabel}暂时连不上`,
        note: '平台没有及时响应；稍后重试通常可以恢复。',
        tone: 'sky',
        primary: 'retry',
      }
    case 'rate-limited':
      return {
        title: '请求过于频繁',
        note: '平台限制了请求频率；稍等片刻再重试。',
        tone: 'sky',
        primary: 'retry',
      }
    default:
      return {
        title: '播放失败',
        note: '可以重试、换一个音源，或直接跳过。',
        tone: 'red',
        primary: 'retry',
      }
  }
}
