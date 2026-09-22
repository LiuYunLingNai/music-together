import type { VisualStageSetting } from './storage'

/**
 * 视觉舞台（Mineradio）在**本设备**上是否可用 —— 移动端入口开关。
 *
 * ============================ 为什么要有这一层 ============================
 *
 * Mineradio 视觉舞台是**重 GPU / 重功耗**的：全屏 three.js 场景 + 封面采样
 * 粒子（出厂 183² ≈ 33,489 个）+ 逐帧音频分析 + 逐行歌词纹理。它在桌面端
 * 是特性，在手机上则是**电量与发烫**的主要来源 —— 上游 Mineradio 是
 * Electron 桌面应用，**从来没有**为移动端做沉浸视界适配；本项目此前只是
 * 用"低功耗档"（见 `RenderPolicy` 的 `PowerContext`）压低粒子密度，但那
 * 仍然要建 WebGL 上下文、跑完整场景。用户决定：**Web 移动端直接不提供入口**。
 *
 * ============================ 判据：触摸设备 ============================
 *
 * 用 `(pointer: coarse)`（**主指针**为触摸 / 笔）判定，与窗口宽窄**无关**：
 *
 *   手机 / 平板（触屏为主）  → 主指针 coarse → 隐藏
 *   桌面（鼠标 / 触摸板为主） → 主指针 fine   → **保留**（哪怕窗口拖得很窄）
 *
 * ★ 刻意**不**用窗口宽度：按宽度判会让桌面用户把窗口拖窄时入口凭空消失，
 *   那属于"影响 web 桌面端的正常入口"，正是用户明确要求不要发生的事。
 *
 * ★ 也刻意**不**用 `navigator.maxTouchPoints > 0`：那会让所有带触摸屏的
 *   笔记本（乃至部分一体机）都被判成移动端。这里要的是"**主**输入是触摸"。
 *
 * ★ 与 `RenderPolicy.detectPowerContext()` 的 `(pointer: coarse)` **必须是
 *   同一个判据** —— 两处若用了不同判据，会出现"入口可见但按低功耗跑"或
 *   反之的矛盾状态。改这里必须同时改那里（`visualStageSupport.test.ts`
 *   会读源码钉住这一点）。
 *
 * 已知未覆盖（诚实记录，非缺陷）：接了触控板 / 鼠标的平板（iPad + 妙控键盘）
 * 主指针会变成 fine，因此仍会显示入口；触屏笔记本同理。这两类设备的算力与
 * 供电都接近桌面，保留入口是可接受的取舍 —— 若要收紧，需要改用设备型号
 * 或 `maxTouchPoints` 一类更激进的判据，那会真正误伤桌面端。
 */
export const VISUAL_STAGE_DISABLED_QUERY = '(pointer: coarse)'

/** 主指针是触摸设备时应禁用视觉舞台。纯函数，便于测试与复用。 */
export function isVisualStageDisabled(coarsePointer: boolean): boolean {
  return coarsePointer
}

/**
 * 持久化选择 → 本设备**实际渲染**的舞台。
 *
 * 禁用时一律回落到 `classic`。注意调用方**同时**要把持久化值写回 `classic`
 * （用户决策）：只做渲染层回落的话，存储里仍留着 `emily`，用户下次进设置
 * 会看到"已选 Emily、画面却是经典播放器"的矛盾状态。
 */
export function resolveEffectiveVisualStage(stored: VisualStageSetting, disabled: boolean): VisualStageSetting {
  return disabled ? 'classic' : stored
}
