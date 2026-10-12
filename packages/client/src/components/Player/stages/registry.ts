/**
 * 播放器舞台的**统一目录** —— 把两个并列的舞台族合成一个可持久化的 id 空间。
 *
 * ============================ 为什么要有这一层 ============================
 *
 * 本项目的播放器有三种形态：
 *
 *   1. `classic`  —— 经典播放器（始终可用，无损回退）；
 *   2. mineradio —— 全屏 three.js 粒子舞台（`mineradio/shared/VisualMode.ts`）；
 *   3. folia     —— 从 folia-major 移植的 DOM/CSS 歌词模式
 *                   （`folia/registry.ts`）。
 *
 * 三者共用**同一个**持久化字段 `visualStage`（`lib/storage.ts` 的
 * `VISUAL_STAGES` 白名单），因此需要一处把两个族的 id 合起来、并回答
 * "这个 id 属于哪个族"。这就是本模块。
 *
 * ★ **纯数据，不得 import 任何舞台组件。** 本模块被 `AudioPlayer.tsx`
 *   （在经典播放器路径上同步加载）、设置面板与切换菜单共同引用；一旦它
 *   import 了 `mineradio/*` 或 `folia/modes/*`，经典路径就会连带拉进
 *   three.js 与全部歌词布局代码，破坏按需加载红线
 *   （`lib/visualStageSupport.test.ts` 专门钉住这一点）。
 *   真正的组件入口在各自的懒加载宿主里。
 */

import { VISUAL_MODES, type VisualModeId } from '../mineradio/shared/VisualMode'
import { isFoliaModeId, type FoliaModeId } from '../folia/registry'

/** 舞台族。`classic` 不属于任何族 —— 它是回退项，不是可切换的"视觉"模式。 */
export type StageFamily = 'mineradio' | 'folia'

export type VisualStageId = VisualModeId | FoliaModeId

/**
 * 某个视觉舞台 id 属于哪个族。
 *
 * ★ 判据用 `isFoliaModeId` 而不是"不在 mineradio 里就算 folia"：反过来写会让
 *   任何拼错的 id 静默落进 folia 分支，进而在懒加载映射里取到 `undefined`
 *   组件并抛错。显式两向判断，未知 id 返回 `null`，由调用方回退 classic。
 */
export function resolveStageFamily(id: string): StageFamily | null {
  if (isFoliaModeId(id)) return 'folia'
  if (VISUAL_MODES.some((mode) => mode.id === id)) return 'mineradio'
  return null
}
