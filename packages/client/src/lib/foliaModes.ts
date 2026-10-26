// Folia's upstream classic id is luminous here, keeping the host classic player distinct.
export const FOLIA_MODES = [
  { id: 'sonnet', upstreamId: 'sonnet', label: '商籁', description: '分镜排版、图形与文字的 Pixi 动画', order: 100 },
  { id: 'tempera', upstreamId: 'tempera', label: '凝彩', description: '色块拼贴、反色文字与场景转场', order: 110 },
  { id: 'lumiere', upstreamId: 'lumiere', label: '绘光', description: '光场、辉光与歌词的动态构图', order: 120 },
  { id: 'hanabi', upstreamId: 'hanabi', label: '花火', description: '日式歌词 PV：色块字、烟花与持续上升的画面', order: 125 },
  { id: 'luminous', upstreamId: 'classic', label: '流光', description: '逐词辉光与漂浮排布', order: 130 },
  { id: 'cadenza', upstreamId: 'cadenza', label: '心象', description: '语义片段、镜像光束与文字层次', order: 140 },
  { id: 'partita', upstreamId: 'partita', label: '云阶', description: '分栏逐词歌词、错峰入场', order: 150 },
  { id: 'fume', upstreamId: 'fume', label: '浮名', description: '歌词化为文章，镜头沿文字移动', order: 160 },
  { id: 'tilt', upstreamId: 'tilt', label: '倾诉', description: '语义切句、大小字错落与脉冲', order: 170 },
  { id: 'claddagh', upstreamId: 'claddagh', label: '回环', description: '椭圆歌词环与音频响应', order: 180 },
  { id: 'monet', upstreamId: 'monet', label: '莫奈', description: '封面海报、滚动歌词与频谱', order: 190 },
  { id: 'pendolo', upstreamId: 'pendolo', label: '时计', description: '机械齿轮、摆轮与圆弧歌词', order: 200 },
  { id: 'cappella', upstreamId: 'cappella', label: '群唱', description: '歌词聊天气泡、头像与表情', order: 210 },
  { id: 'diorama', upstreamId: 'diorama', label: '镜台', description: '沿 3D 歌词走廊飞行的镜头', order: 220 },
  { id: 'still', upstreamId: 'still', label: '静止', description: '静态三行歌词，低资源模式', order: 230 },
] as const
export type FoliaModeId = (typeof FOLIA_MODES)[number]['id']
export type FoliaModeMeta = (typeof FOLIA_MODES)[number]
export function isFoliaModeId(value: string): value is FoliaModeId {
  return FOLIA_MODES.some((mode) => mode.id === value)
}
export function getFoliaMode(id: FoliaModeId): FoliaModeMeta {
  return FOLIA_MODES.find((mode) => mode.id === id) ?? FOLIA_MODES[0]
}
