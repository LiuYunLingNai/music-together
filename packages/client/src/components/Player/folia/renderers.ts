import { lazy, type ComponentType } from 'react'
import type { FoliaSharedProps } from './definition'
import type { FoliaModeId } from './registry'

/**
 * folia 模式组件 → 懒加载映射。
 *
 * ★ 与 `registry.ts`（纯数据）分开的理由见该文件说明：这个模块一旦被经典
 *   播放器路径引用，就会把全部模式组件拉进首屏包。它**只**被
 *   `FoliaPlayerStage` 引用，而后者本身是懒加载的。
 *
 * ★ 五个模式各自 `lazy()`：切到某个模式时只请求那一个 chunk。cappella 还带
 *   26 张 PNG（约 3.5 MB），单独成块尤其重要 —— 不 lazy 的话它们会跟着
 *   任何一个 folia 模式一起下载。
 *
 * `Suspense` 边界由 `FoliaPlayerStage` 提供（懒加载组件必须的调用方义务）。
 */
export const FOLIA_MODE_RENDERERS: Record<FoliaModeId, ComponentType<FoliaSharedProps>> = {
  cadenza: lazy(() => import('./upstream/components/visualizer/cadenza/VisualizerCadenza')),
  claddagh: lazy(() => import('./upstream/components/visualizer/claddagh/VisualizerCladdagh')),
  diorama: lazy(() => import('./upstream/components/visualizer/diorama/VisualizerDiorama')),
  fume: lazy(() => import('./upstream/components/visualizer/fume/VisualizerFume')),
  lumiere: lazy(() => import('./upstream/components/visualizer/lumiere/VisualizerLumiere')),
  monet: lazy(() => import('./upstream/components/visualizer/monet/VisualizerMonet')),
  pendolo: lazy(() => import('./upstream/components/visualizer/pendolo/VisualizerPendolo')),
  sonnet: lazy(() => import('./upstream/components/visualizer/sonnet/VisualizerSonnet')),
  tempera: lazy(() => import('./upstream/components/visualizer/tempera/VisualizerTempera')),
  // 这五个模式同样来自上游目录（`classic` 在本项目叫 `luminous`，id 映射见 `lib/foliaModes`）。
  still: lazy(() => import('./upstream/components/visualizer/still/VisualizerStill')),
  luminous: lazy(() => import('./upstream/components/visualizer/classic/Visualizer')),
  partita: lazy(() => import('./upstream/components/visualizer/partita/VisualizerPartita')),
  tilt: lazy(() => import('./upstream/components/visualizer/tilt/VisualizerTilt')),
  cappella: lazy(() => import('./upstream/components/visualizer/cappella/VisualizerCappella')),
}
