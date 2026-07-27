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
    { value: 'tencent_flac', label: 'QQ 无损', platform: 'tencent' },
    { value: 'tencent_master', label: 'QQ 臻品母带', platform: 'tencent' },
  ],
  kugou: [
    { value: 'kugou_hires', label: '酷狗 Hi-Res', platform: 'kugou' },
    { value: 'kugou_master', label: '酷狗臻品母带', platform: 'kugou' },
  ],
}

export function getAudioQualityOptions(statuses: PlatformAuthStatus[]): AudioQualityOption[] {
  const options = [...BASE_OPTIONS]
  for (const status of statuses) {
    if (status.hasVip) options.push(...PLATFORM_OPTIONS[status.platform])
  }
  if (!options.some((option) => option.value === 999)) {
    options.push({ value: 999, label: '无损 SQ', description: '需要 VIP 账号' })
  }
  return options
}

export function getAudioQualityLabel(quality: AudioQuality, statuses: PlatformAuthStatus[] = []): string {
  const allOptions = [...BASE_OPTIONS, ...Object.values(PLATFORM_OPTIONS).flat()]
  return (
    [...getAudioQualityOptions(statuses), ...allOptions].find((option) => option.value === quality)?.label ??
    String(quality)
  )
}
