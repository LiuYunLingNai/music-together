/**
 * UI 命中检测（上游 `isPointerOverUi`，`02-visual/00-pointer-cover-particles.js:17-22`）。
 *
 * 上游用一个 `UI_HIT_SELECTOR` 枚举全部 HUD 容器，再对
 * `document.elementFromPoint()` 的结果做 `closest()`：
 *
 * ```js
 * var UI_HIT_SELECTOR = '#search-area,#upload-panel,#top-right,…,#drop-overlay';
 * function isPointerOverUi(e) {
 *   var el = document.elementFromPoint(e.clientX, e.clientY);
 *   return !!(el && el.closest && el.closest(UI_HIT_SELECTOR));
 * }
 * ```
 *
 * 本项目的 DOM 结构不同：画布是唯一的全屏层，HUD（控制台 / 歌词 / 投票 /
 * 暗角）都是它的**兄弟节点**。因此这里用等价的反向判断 —— 命中点落在画布
 * 自身才算舞台交互，落在任何覆盖其上的元素都算 UI。这比枚举选择器更稳：
 * 新增 HUD 不需要同步维护一张清单。
 *
 * 抽成独立模块是因为 `CameraRig`（轨道旋转 / 双击回正 / 滚轮缩放）与
 * `ParticleField`（指针推挤）都需要它，且两者必须用**同一套**判定，
 * 否则会出现"相机认为在 UI 上、粒子认为不在"的分叉。
 */
export function isPointerOverUi(event: { clientX: number; clientY: number }): boolean {
  if (typeof document === 'undefined') return false
  const el = document.elementFromPoint(event.clientX, event.clientY)
  if (!el) return false
  return !el.closest('.mt-mineradio-canvas-layer')
}
