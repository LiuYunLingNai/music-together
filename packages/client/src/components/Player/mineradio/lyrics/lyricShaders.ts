/**
 * 歌词网格着色器。
 *
 * 遮罩纹理通道约定（来自 `rasterizeLyricMask`）：A 通道 = 文字形状遮罩。
 *
 * 逐行分层架构（上游 12-lyrics-row-layers.js）下每行一张纹理，激活态由
 * uniform `uActiveMix` 逐帧驱动（上游 isActive = rowLineIndex === presentation），
 * 不从纹理 R 通道读取 —— 单行栅格里所有行共享同一白色栅格，R 通道恒 255，
 * 无法区分激活与否。
 *
 * 特效（glitch / sweep / shimmer / solar）参照
 * Mineradio 的 `11-lyrics-shaders.js`。
 */

export const LYRIC_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const LYRIC_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform sampler2D uMap;
uniform float uProgress;      // 0..1 逐字进度
uniform float uTextMin;       // 文字区域起止（UV.x）
uniform float uTextMax;
uniform float uOpacity;
uniform float uActiveMix;     // 0..1 当前激活行门控（逐帧，上游 isActive 语义）
uniform float uFeather;
uniform float uTime;

// 特效强度
uniform float uSweep;         // 扫光
uniform float uShimmer;       // 微光细线
uniform float uGlitch;        // 故障
uniform float uGlitchSlice;
uniform float uGlitchChroma;
uniform float uGlitchRate;
uniform float uGlitchSeed;
uniform float uGlitchBurst;
uniform float uSolar;         // 节拍泛光
uniform float uEdgeBoost;

uniform vec3  uBaseColor;     // 未唱到的字色
uniform vec3  uHiColor;       // 已唱到的字色
uniform vec3  uGlowColor;
uniform vec3  uSolarColor;

varying vec2 vUv;

float hash(float n) { return fract(sin(n) * 43758.5453123); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

void main() {
  // ★ 背面可读（上游 11-lyrics-shaders.js:101）：
  //   vec2 uv = gl_FrontFacing ? vUv : vec2(1.0 - vUv.x, vUv.y);
  //   材质是 DoubleSide（上游 :140），因此相机绕到歌词平面背后时文字要
  //   水平镜像回来才读得正 —— 上游把这个材质叫
  //   makeLyricBackfaceReadableMaterial，是本项目的交互前提：拖拽旋转的是
  //   **物体组**（含歌词），用户可以把歌词转到背面看。
  //   此前本项目材质是默认的 FrontSide 且没有这行翻转，背面既看不到字、
  //   也拿不到镜像，与上游不符。
  vec2 uv = gl_FrontFacing ? vUv : vec2(1.0 - vUv.x, vUv.y);

  // ---------------------------------------------------------------- 故障
  // 横向切条位移 + RGB 色散
  float sliceRows = mix(16.0, 38.0, clamp(uGlitchSlice / 1.4, 0.0, 1.0));
  float row = floor((uv.y + hash(uGlitchSeed) * 0.035) * sliceRows);
  float timeSlot = floor(uTime * mix(7.0, 24.0, clamp(uGlitchRate / 2.2, 0.0, 1.0)) + hash(uGlitchSeed * 1.37) * 5.0);
  float rowRnd = hash2(vec2(row + uGlitchSeed, timeSlot));
  float phaseRnd = hash2(vec2(timeSlot + uGlitchSeed * 0.71, row * 3.17));

  float glitchGate = smoothstep(0.74, 0.99, rowRnd + uGlitchBurst * 0.28) * step(0.001, uGlitch);
  float glitchDir = hash2(vec2(row * 5.11, timeSlot + uGlitchSeed)) < 0.5 ? -1.0 : 1.0;
  float micro = hash2(vec2(floor(uv.x * 19.0) + row, timeSlot * 1.31 + uGlitchSeed));
  float glitchWave = (phaseRnd * 2.0 - 1.0) * (0.55 + micro * 0.95);
  float glitchWidth = (0.0020 + rowRnd * rowRnd * 0.0085) * (0.55 + uGlitchBurst * 1.85);

  vec2 sampleUv = uv + vec2(glitchGate * glitchDir * glitchWave * uGlitch * uGlitchSlice * glitchWidth, 0.0);

  vec4 texel = texture2D(uMap, sampleUv);
  float mask = texel.a;
  if (mask < 0.01) discard;

  // 激活门控（上游 uActiveMix）：逐字高亮、扫光、节拍泛光只作用于当前行
  float activeMix = clamp(uActiveMix, 0.0, 1.0);

  // ---------------------------------------------------------------- 逐字
  float denom = max(0.001, uTextMax - uTextMin);
  float p = clamp((uv.x - uTextMin) / denom, 0.0, 1.0);
  float filled = (1.0 - smoothstep(uProgress, uProgress + uFeather, p)) * activeMix;
  float edge = (1.0 - smoothstep(0.0, uFeather * 2.8, abs(p - uProgress))) * activeMix;

  // ---------------------------------------------------------------- 扫光/微光
  float sweepPhase = fract(uTime * (0.28 + uSweep * 0.10));
  float sweepLine = (1.0 - smoothstep(0.0, 0.080, abs((uv.x + uv.y * 0.42) - (sweepPhase * 1.42 - 0.18)))) * activeMix;
  float fineLine = pow(max(0.0, sin((uv.x - uv.y * 0.18 + uTime * 0.82) * 42.0)), 24.0) * uShimmer * activeMix;

  // ---------------------------------------------------------------- 色散
  float chromaR = mask;
  float chromaB = mask;
  if (uGlitch > 0.001) {
    float chromaOffset = (0.0028 + phaseRnd * 0.0048 + uGlitchBurst * 0.0038) * uGlitch * uGlitchChroma;
    chromaR = texture2D(uMap, sampleUv + vec2(chromaOffset * glitchDir, 0.0)).a;
    chromaB = texture2D(uMap, sampleUv - vec2(chromaOffset * glitchDir, 0.0)).a;
  }

  // ---------------------------------------------------------------- 合成
  vec3 color = mix(uBaseColor, uHiColor, filled * 0.88);
  color += uGlowColor * edge * 0.14 * uEdgeBoost;
  color += uSolarColor * sweepLine * uSweep * (0.12 + filled * 0.30);
  color += uGlowColor * fineLine * (0.08 + filled * 0.18);
  color += vec3(chromaR, mask * 0.18, chromaB) * glitchGate * uGlitch * uGlitchChroma * activeMix * (0.20 + uGlitchBurst * 0.22);

  // 节拍驱动的泛光
  color = mix(color, color + uSolarColor * 0.34, uSolar * activeMix * (0.25 + filled * 0.45));
  color += uSolarColor * edge * uSolar * 0.22;

  // 保证暗色文字也有最低亮度
  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  color += vec3(max(0.0, 0.30 - lum));

  float alpha = max(mask, max(chromaR, chromaB) * glitchGate * uGlitch * (0.30 + uGlitchBurst * 0.32));
  alpha *= uOpacity;

  gl_FragColor = vec4(color, alpha);
}
`
