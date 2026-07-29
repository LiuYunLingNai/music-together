import type { AudioQuality, MusicSource, PlatformAuthStatus } from '@music-together/shared'

export interface AudioQualityOption {
  value: AudioQuality
  label: string
  platform?: MusicSource
  description?: string
}

const BASE_OPTIONS: AudioQualityOption[] = [
  { value: 128, label: '标准 128kbps' },
  { value: 192, label: '较高 192kbps' },
  { value: 320, label: '高品质 320kbps' },
]

const PLATFORM_OPTIONS: Record<MusicSource, AudioQualityOption[]> = {
  netease: [
    { value: 999, label: '无损 SQ', platform: 'netease' },
    { value: 'netease_hires', label: 'Hi-Res', platform: 'netease' },
    { value: 'netease_jyeffect', label: '高清臻音', platform: 'netease' },
    { value: 'netease_spatial', label: '沉浸环绕声', platform: 'netease' },
    { value: 'netease_master', label: '超清母带', platform: 'netease' },
    { value: 'netease_dolby', label: '杜比全景声', platform: 'netease', description: '浏览器兼容性有限' },
  ],
  tencent: [
    { value: 'tencent_flac', label: '无损', platform: 'tencent' },
    { value: 'tencent_master', label: '臻品母带', platform: 'tencent' },
  ],
  kugou: [
    { value: 'kugou_hires', label: '酷狗 Hi-Res', platform: 'kugou' },
    { value: 'kugou_master', label: '酷狗臻品母带', platform: 'kugou' },
  ],
  kugou_concept: [
    { value: 'kugou_hires', label: '酷狗概念版 Hi-Res', platform: 'kugou_concept' },
    { value: 'kugou_master', label: '酷狗概念版 臻品母带', platform: 'kugou_concept' },
  ],
  bilibili: [],
}

export function getAudioQualityOptions(_statuses: PlatformAuthStatus[]): AudioQualityOption[] {
  // Room quality is shared by all providers. Provider-specific formats are
  // selected by the server from `highest`; exposing them here made a Tencent
  // or Kugou room appear to offer unrelated Netease formats.
  return [
    ...BASE_OPTIONS,
    { value: 999, label: '无损 SQ', description: '需要 VIP 账号' },
    { value: 'highest', label: '尽量高' },
  ]
}

export function getAudioQualityLabel(quality: AudioQuality, statuses: PlatformAuthStatus[] = []): string {
  const allOptions = [...BASE_OPTIONS, ...Object.values(PLATFORM_OPTIONS).flat()]
  return (
    [...getAudioQualityOptions(statuses), ...allOptions].find((option) => option.value === quality)?.label ??
    String(quality)
  )
}
