import type { MusicSource, MyPlatformAuth, PlatformAuthStatus } from '@music-together/shared'

/** Full platform display names (used in dialogs, titles, descriptions) */
export const PLATFORM_LABELS: Record<MusicSource, string> = {
  netease: '网易云音乐',
  tencent: 'QQ 音乐',
  kugou: '酷狗音乐',
  kugou_concept: '酷狗概念版',
  bilibili: 'B站',
}

/** Short platform labels (used in compact UI like tabs) */
export const PLATFORM_SHORT_LABELS: Record<MusicSource, string> = {
  netease: '网易云',
  tencent: 'QQ 音乐',
  kugou: '酷狗',
  kugou_concept: '概念版',
  bilibili: 'B站',
}

/** Tab highlight colors per platform */
export const PLATFORM_COLORS: Record<MusicSource, string> = {
  netease: 'data-[state=active]:text-red-500',
  tencent: 'data-[state=active]:text-green-500',
  kugou: 'data-[state=active]:text-blue-500',
  kugou_concept: 'data-[state=active]:text-sky-500',
  bilibili: 'data-[state=active]:text-pink-500',
}

/** Active platform selector styles */
export const PLATFORM_ACTIVE: Record<MusicSource, string> = {
  netease: 'bg-red-500/15',
  tencent: 'bg-green-500/15',
  kugou: 'bg-blue-500/15',
  kugou_concept: 'bg-sky-500/15',
  bilibili: 'bg-pink-500/15',
}

/** Active platform text color */
export const PLATFORM_TEXT: Record<MusicSource, string> = {
  netease: 'text-red-500',
  tencent: 'text-green-500',
  kugou: 'text-blue-500',
  kugou_concept: 'text-sky-500',
  bilibili: 'text-pink-500',
}

/** VIP level display labels (Netease vipType values) */
export const VIP_LABELS: Record<number, string> = {
  0: '',
  1: 'VIP',
  10: '黑胶VIP',
  11: '黑胶VIP',
}

/** Find a platform's auth status from the room-wide status list */
export function getPlatformStatus(
  platform: MusicSource,
  statusList: PlatformAuthStatus[],
): PlatformAuthStatus | undefined {
  return statusList.find((s) => s.platform === platform)
}

/** Find the current user's auth status for a platform */
export function getMyPlatformStatus(platform: MusicSource, myStatusList: MyPlatformAuth[]): MyPlatformAuth | undefined {
  return myStatusList.find((s) => s.platform === platform)
}
