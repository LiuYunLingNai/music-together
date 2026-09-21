/**
 * 粒子材质 / 几何的契约常量（实现与测试共享）。
 *
 * 目的：把几条"踩过坑、绝不能再犯"的写法固化成常量，
 * 由实现侧直接引用、由测试侧断言，避免回归。
 *
 * ============================ 背景事故 ============================
 *
 * 【事故 A —— 最隐蔽、代价最大】
 *
 * 错误写法：
 *   <points geometry={geometry}>
 *     <shaderMaterial uniforms={uniforms} vertexShader={...} />
 *   </points>
 *
 * R3F 把 `uniforms` 当构造参数处理并重新包装，导致
 *   material.uniforms !== uniforms
 *
 * 于是 `useFrame` 里所有 `u.uAlpha.value = ...` 都写进了**游离对象**，
 * 真正参与渲染的材质永远停在初始值：
 *   uAlpha = 0 → alpha = tex.a * 0 * ... = 0 → 每个粒子完全透明
 *
 * 症状：改了任何着色器参数都没有任何视觉变化，极难定位 ——
 * 因为几何、相机、uniform 计算、纹理全部验证正常，唯独材质被换掉。
 *
 * 实测证据：sameUniformsObject=false / matUAlpha=0（期望 1）
 * 修复效果：maxV 36→197，非黑覆盖率 2.9%→29.2%
 *
 * 【事故 B】uPixel 上游取 `gl.getPixelRatio()`，
 * 早期误用 `size.y / 900`（≈0.80），点尺寸偏小。
 *
 * 【事故 C】几何 position 上游写入真实坐标
 * `(px - 0.5) * PLANE_SIZE`（PLANE_SIZE = 4.8）；
 * 早期写入全 0 数组，坐标在着色器内由 UV 反算，构图与上游不符。
 */

/** 粒子平面世界尺寸 —— 上游 `particleGeometry.ts` 的 PLANE_SIZE */
export const PARTICLE_PLANE_SIZE = 4.8

/**
 * 材质创建方式。
 *
 * `mainMaterial` / `bloomMaterial` 必须用 `new THREE.ShaderMaterial` 命令式
 * 创建，并通过 `material={...}` 挂载 —— 这样 R3F 不会介入 uniforms 的引用，
 * `material.uniforms === uniforms` 成立，逐帧写入才真正生效。
 */
export const PARTICLE_MATERIAL_COUNT = 2

/** 全局淡入：上游要求「暂停时进入沉浸也必须让粒子可见，否则 uAlpha 停在 0 会黑屏」 */
export const ALPHA_FADE_DURATION_SECONDS = 0.26

/** 点尺寸基准：上游用 devicePixelRatio 而非视口比例 */
export const POINT_SIZE_BASE = 36.0
export const POINT_SIZE_MIN = 1.05
export const POINT_SIZE_MAX = 4.95

/** 上游 `DEFAULT_ROOM_VISUAL_FX` 的默认值（roomVisualPreset.ts） */
export const DEFAULT_FX = {
  intensity: 0.85,
  depth: 0.2,
  point: 1.0,
  colorBoost: 1.1,
  scatter: 0.0,
  bgFade: 0.2,
  bloomStrength: 0.62,
} as const

/**
 * 本项目实际使用的强度参数 —— 与上游出厂值一致。
 *
 * ============================ 关于 depth 的一处旧错误 ============================
 *
 * 此前这里把 `depth` 从 0.2 抬到 0.7，理由是"没有滑杆、立体感不足"。
 * 那是**误判**：深度位移项是
 *
 *   depthZ = (depthVal - 0.5) * uAiBoost * uDepth * 1.40 * uHasDepth
 *
 * 上游 `uAiBoost` 出厂为 **0**（`00-pointer-cover-particles.js:358`），
 * 只有真正生成深度图时才升到 0.55（启发式）或 1（AI）。
 * 也就是说 **静止时上游的 depthZ 恒为 0 —— 封面本来就是平的**，
 * depth 这个滑杆在 AI 深度缺位时不产生任何效果。
 *
 * 把 depth 抬到 0.7、又把 uAiBoost 硬编码成 1，会让启发式深度图
 * 产生约 ±0.49 的静态 z 位移；而点尺寸公式是 `36 / -mvPos.z`，
 * 外圈粒子因此被渲染成不同大小 —— 表现为**静止时封面边缘参差**。
 * 这正是用户报告的问题。现全部回落到上游出厂值。
 */
export const RENDER_FX = {
  ...DEFAULT_FX,
} as const
