/**
 * Mineradio 舞台模式定义 —— 单一事实来源。
 *
 * 前六种共用同一套几何与着色器程序，切换只改 `uPreset` uniform，
 * 不重建 BufferGeometry，也不重新编译 shader。
 *
 * `topography`（声波地形）是**独立模块**：它不属于 `uPreset` 分支，
 * 而是一整片 instanced 地形网格，有自己的几何与材质
 * （见 `topography/TopographyScene.tsx`）。因此它没有着色器预设编号。
 */

export type VisualModeId = 'emily' | 'tunnel' | 'planet' | 'vinyl' | 'galaxy' | 'topography'

/** 走粒子着色器分支的模式集合（`topography` 之外全部）。 */
export type ParticlePresetModeId = Exclude<VisualModeId, 'topography'>

/**
 * 着色器的预设编号。
 *
 * 与上游 Mineradio 的 `uPreset` 编号一一对应。
 * 上游的 3 号槽位是「虚空」（VOID，给自定义背景用的刻意空实现）——
 * 本项目没有自定义背景功能，且「封面视界」（曾复用该槽位的自创模式）
 * 已按用户决策于第九轮删除，因此 3 号槽位**留空**，不做分支。
 *
 * 注意：`topography` 刻意**不在**此表中 —— 它不走着色器分支。
 */
export const PRESET_INDEX: Record<Exclude<VisualModeId, 'topography'>, number> = {
  emily: 0,
  tunnel: 1,
  planet: 2,
  vinyl: 4,
  galaxy: 5,
}

export interface VisualModeMeta {
  id: VisualModeId
  /** 菜单中显示的名称 */
  label: string
  /** 是否启用鼠标视差 */
  pointerParallax: boolean
  /** 环境色（无封面主色时使用） */
  ambient: string
  /** 雾与背景色 */
  background: string
}

export const VISUAL_MODES: readonly VisualModeMeta[] = [
  {
    id: 'emily',
    label: 'Emily 专辑封面',
    pointerParallax: true,
    ambient: '#8fb6d8',
    background: '#05070b',
  },
  {
    id: 'tunnel',
    label: '滚筒',
    pointerParallax: false,
    ambient: '#7aa2c8',
    background: '#04060a',
  },
  {
    id: 'planet',
    label: '星球',
    pointerParallax: false,
    ambient: '#89a9d0',
    background: '#05070b',
  },
  {
    id: 'vinyl',
    label: '唱片',
    pointerParallax: false,
    ambient: '#c9b48f',
    background: '#07070a',
  },
  {
    id: 'galaxy',
    label: '星河',
    pointerParallax: false,
    ambient: '#93b2dd',
    background: '#03050c',
  },
  {
    // 对应 Mineradio sonic-topography（OpenMusic 显示名「声波地形」）。
    id: 'topography',
    label: '声波地形',
    pointerParallax: false,
    ambient: '#7fa8d8',
    background: '#05070c',
  },
] as const

export function getVisualMode(id: VisualModeId): VisualModeMeta {
  return VISUAL_MODES.find((mode) => mode.id === id) ?? VISUAL_MODES[0]
}

/**
 * 该模式是否使用粒子着色器分支。
 *
 * **只有 `topography` 不走** —— 它是独立地形模块，没有 `uPreset` 编号。
 */
export function usesParticlePreset(id: VisualModeId): id is Exclude<VisualModeId, 'topography'> {
  return id !== 'topography'
}

/** 该模式是否由独立的地形模块渲染（而非粒子层）。 */
export function isTopographyMode(id: VisualModeId): boolean {
  return id === 'topography'
}

/** 校验一个持久化的舞台值是否对应某个视觉模式。 */
export function isVisualStageId(value: string): value is VisualModeId {
  return VISUAL_MODES.some((mode) => mode.id === value)
}
