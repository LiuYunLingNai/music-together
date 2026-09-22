/**
 * 粒子着色器 —— 对齐基准是 **Mineradio**。
 *
 * 视觉基准（唯一权威）：
 *   `%TEMP%\\music-together-player-refs\\Mineradio`，commit `328a087`
 *   `public/js/modules/02-visual/00-pointer-cover-particles.js`
 *     - 顶点着色器 602 行，预设 0-12
 *     - 主粒子 / 泛光片元
 *
 * 参考（仅限多人房间工程适配与 3D 卡片，**不作为视觉取舍依据**）：
 *   OpenMusic `client/src/components/galaxy/lib/visualVertexShader.ts`（478 行，预设 0-5）
 *
 * ============================ 基准更正记录 ============================
 *
 * 本文件早期版本的文件头写的是「严格对齐 OpenMusic」，与项目要求
 * （视觉语言以 Mineradio 为主）相反，导致实现继承了 OpenMusic 的
 * 6 预设结构，并在颜色管线上偏离 Mineradio：
 *
 * - `uColorBoost` 被当成**线性乘数**预乘进 coverColor（5 处分支各乘一遍）；
 *   Mineradio 全程只用一次，且是**反 gamma** `pow(c, 1/boost)`。
 * - 缺 `blackParticleGuard`、`vinylHiResGuard`、`uEdgeEnabled` 开关，
 *   以及 `uTintColor` / `uTintStrength` 染色链。
 * - `uScatter` / `uTwist` / `uLoading` 只有 uniform 声明、函数体零引用。
 * - 片元缺 `uBackdropAdapt`，亮底避光系数被写死。
 *
 * 以上已按 Mineradio 逐行修正。仍未移植的是 Mineradio 的预设 6-12
 * （安魂 / 音域回响 ×2 / 月蚀圣环 / 雨幕霓虹 / 折光蝶群 / 深海绽放）。
 * 预设编号保留 Mineradio 原值，便于日后逐行 diff。
 *
 * ============================ 为什么重写 ============================
 *
 * 此前的实现是「按参数与公式重实现」的简化版，结果**画面几乎全黑**
 * （实测 maxV=36/255，即最亮像素只有 14% 亮度），用户反馈「看不出变化」。
 * 逐条比对后发现三处**结构性**缺失，而不是参数调校问题：
 *
 * 1. **没有 `uAlpha` 全局淡入链。**
 *    上游片元是 `tex.a * uAlpha * uParticleDim * vAlpha`，
 *    并且 `GalaxyParticles.tsx` 里明确把 uAlpha 从 0 动画到 1：
 *
 *      // 淡入不能依赖播放状态：暂停时进入沉浸也必须让粒子可见，
 *      // 否则 uAlpha 停在 0 会黑屏。
 *      if (uniforms.uAlpha.value < 1) {
 *        uniforms.uAlpha.value = Math.min(1, uniforms.uAlpha.value + delta / 0.26);
 *        invalidate();
 *      }
 *
 *    上游自己踩过这个坑并留下了注释。本移植缺失整条链路。
 *
 * 2. **顶点着色器没有基准 `vAlpha = 1.0`。**
 *    上游在分叉前先 `vAlpha = 1.0`（第 132 行），只有少数预设覆盖它。
 *    此前的实现每个预设都用 `mix(0.55, 1.0, fgMask)` 之类压低 alpha，
 *    再乘 `uBgFade`，把整体透明度压到 0.2 左右。
 *
 * 3. **几何体没有真实坐标。**
 *    上游 `buildGalaxyParticleGeometry` 写入
 *    `positions = (px - 0.5) * PLANE_SIZE`（PLANE_SIZE = 4.8），
 *    SILK 预设直接 `pos = position`。此前实现写入全 0 数组，
 *    坐标全靠着色器内部由 UV 反算，构图与上游不一致。
 *
 * 另外补齐了上游参与公式、但此前缺失的 uniform：
 * `uAlpha` / `uBurstAmt` / `uEdgeBoost` / `uHasDepth` / `uAiBoost` / `uVinylSpin`。
 *
 * uniform 名称与上游保持一致，便于日后逐行比对。
 */

/**
 * Simplex 噪声（Ashima / Stefan Gustavson 的经典 3D 实现）。
 *
 * 上游 `visualVertexShader.ts:21-54` 原样内联。
 * 被 SILK 的 midDisp / trebleJ / bassBreath，以及 WALLPAPER 的
 * 星云条带大量使用 —— 没有它就无法照搬公式。
 */
const SIMPLEX_NOISE = /* glsl */ `
#define PI 3.14159265359

vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289v(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 perm(vec4 x){return mod289v(((x*34.0)+1.0)*x);}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=perm(perm(perm(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=inversesqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}

float hash11(float p) {
  return fract(sin(p * 127.1) * 43758.5453123);
}

vec2 safeCoverUv(vec2 uv) {
  return clamp(uv, vec2(0.0012), vec2(0.9988));
}

/**
 * 上游 samplePrevCoverColor（00-pointer-cover-particles.js:442）：旧封面采样。
 *
 * ★ 必须声明在 safeCoverUv **之后**：GLSL 不允许前向引用（函数须先声明后使用），
 *   把这两个 helper 放在文件顶部 uniform 区（在 SIMPLEX_NOISE 展开之前）会让
 *   safeCoverUv 找不到匹配重载 → 顶点着色器编译失败 → three 静默跳过整个
 *   draw call → **封面与所有粒子完全消失**（片元仍能编译，因此只有顶点报错）。
 *   上游 00-pointer-cover-particles.js 的 helper 顺序同为
 *   snoise → hash11 → safeCoverUv → samplePrevCoverColor → rippleSumAt（:397-450），
 *   这里保持一致。
 */
vec3 samplePrevCoverColor(vec2 uv) {
  return texture2D(uPrevCoverTex, safeCoverUv(uv)).rgb;
}

/** 上游 coverColor 交叉淡化（:485/:548/:621 三分支同式）。 */
vec3 mixCoverColor(vec3 newCol, vec2 uv) {
  return mix(samplePrevCoverColor(uv), newCol, clamp(uColorMixT, 0.0, 1.0));
}
`

/**
 * 顶点着色器。
 *
 * 结构完全对照上游：
 *   1. 采样封面 + 边缘纹理，得到 coverColor / depthVal / edgeVal / fgMask
 *   2. 先设基准 `vAlpha = 1.0`（上游 132 行）—— 这是亮度的关键前提
 *   3. 六个预设分支（0 SILK / 1 TUNNEL / 2 ORBIT / 3 VOID / 4 VINYL / 5 WALLPAPER）
 *   4. 统一的 vBright / vAlpha 收尾与点尺寸
 *
 * 3 号槽位保持上游 VOID 的原样（粒子挪到 z=-90 且 alpha=0）。
 * 曾复用该槽位的自创模式「封面视界」已按用户决策删除（第九轮），
 * 目前没有任何模式会选中 3 号分支 —— 保留 VOID 原样是为了与上游
 * 逐分支对应，且未来若移植自定义背景功能可直接启用。
 */
export const PARTICLE_VERTEX_SHADER = /* glsl */ `
precision highp float;

uniform float uTime, uBass, uMid, uTreble, uBeat, uEnergy, uBurstAmt;
uniform float uPreset, uIntensity, uDepth, uPointScale, uSpeed, uTwist;
uniform float uVinylSpin;
uniform float uColorBoost, uScatter, uCoverRes, uBgFade;
uniform float uHasCover, uHasDepth, uAiBoost, uEdgeEnabled;
uniform float uMouseActive, uPixel, uColorMixT, uLoading;
uniform sampler2D uCoverTex, uPrevCoverTex, uEdgeTex;

uniform vec2 uMouseXY;
uniform vec3 uTintColor;
uniform float uTintStrength;

attribute vec2 aUv;
attribute float aRand;

varying vec3 vColor;
varying float vBright, vRipple, vEdgeBoost, vAlpha, vSourceLum;

${SIMPLEX_NOISE}

/**
 * 涟漪位移。
 *
 * 上游用 uRippleTex 纹理承载 12 组涟漪（RGBA：xy=中心 / z=age / w=str），
 * 这里用 vec4 uniform 数组等价承载（最多 12 组），差异只在于数据来源。
 */
uniform vec4 uRipples[12];
uniform float uRippleCount;

float rippleSumAt(vec2 p, out float maxAmp) {
  float sum = 0.0;
  maxAmp = 0.0;
  for (int i = 0; i < 12; i++) {
    if (float(i) >= uRippleCount) break;
    vec4 r = uRipples[i];
    float rx = r.x;
    float ry = r.y;
    // 上游语义：z=age（秒，0..2），w=str（15-ripples-cover-depth.js:44
    // str = 0.65 + bass*1.4 + rand*0.25，强弱拍涟漪幅度不同）。
    float age = r.z;
    float str = r.w;
    if (str < 0.005 || age < 0.0 || age > 2.0) continue;
    float dx = p.x - rx, dy = p.y - ry;
    float dist = sqrt(dx*dx + dy*dy);
    float lifeN = age / 2.0;
    float fadeIn = smoothstep(0.0, 0.06, age);
    float fadeOut = 1.0 - smoothstep(0.7, 1.0, lifeN);
    float env = fadeIn * fadeOut;
    float bulgeW = 0.55 + age * 0.80;
    float bulge = exp(-dist*dist / (2.0 * bulgeW * bulgeW)) * (1.0 - smoothstep(0.0, 0.55, lifeN));
    float waveR = age * 2.10;
    float ringW = 0.40 + age * 0.22;
    float ring = exp(-pow((dist - waveR) / ringW, 2.0));
    float local = (bulge * 2.4 + ring * 1.30) * env * str;
    sum += local;
    maxAmp = max(maxAmp, abs(local));
  }
  return sum;
}

void main(){
  float t = uTime * uSpeed;
  vec3 pos;
  vec2 sampleUv = safeCoverUv(aUv);
  vec3 coverColor = mixCoverColor(texture2D(uCoverTex, sampleUv).rgb, sampleUv);
  vec4 edge = vec4(0.5, 0.0, 1.0, 0.5);
  if (uEdgeEnabled > 0.5) edge = texture2D(uEdgeTex, sampleUv);
  float depthVal = edge.r;
  float edgeVal = edge.g;
  float fgMask = edge.b;
  float lumVal = edge.a;
  float maxRippleAmp = 0.0;
  float rippleZ = 0.0;

  // 无封面时的兜底色：上游的紫蓝渐变，保证空房间也有色彩而不是纯黑
  vec3 defaultColor = mix(
    vec3(0.36, 0.28, 0.72),
    mix(vec3(0.85, 0.55, 0.95), vec3(0.45, 0.78, 0.95), aUv.x),
    aUv.y
  );
  // uColorBoost 不在这里参与。Mineradio 全片只在收尾段用它做**反 gamma**
  // （见文件末尾的颜色段），分支内一律使用未加权的 coverColor。
  vColor = mix(defaultColor, coverColor, uHasCover);

  // ★ 基准 alpha 是 1.0。
  //   此前的实现在这里就乘了各种衰减系数，是画面发暗的主因之一。
  vAlpha = 1.0;

  float K = uIntensity * 1.6;

  // ==================================================== Preset 0: SILK 丝绸
  if (uPreset < 0.5) {
    pos = position;
    rippleZ = rippleSumAt(pos.xy, maxRippleAmp);

    float midN = snoise(vec3(pos.x*1.4, pos.y*1.4, t*0.55)) * 0.6
               + snoise(vec3(pos.x*2.8+5.0, pos.y*2.8-3.0, t*0.85)) * 0.4;
    float midMask = 0.55 + 0.45 * snoise(vec3(pos.x*0.4, pos.y*0.4, t*0.18));
    float midDisp = midN * uMid * 0.55 * midMask * K;

    float trebleJ = snoise(vec3(pos.x*6.5, pos.y*6.5, t*3.5 + aRand*4.0)) * uTreble * 0.18 * K;
    float bassBreath = snoise(vec3(pos.x*0.35, pos.y*0.35, t*0.4)) * uBass * 0.42 * K;

    float depthZ = (depthVal - 0.5) * uAiBoost * uDepth * 1.40 * uHasDepth;

    pos.z = rippleZ * 1.30 + midDisp + trebleJ + bassBreath + depthZ;

    // 鼠标推动（仅 SILK）
    if (uMouseActive > 0.5) {
      float mdx = pos.x - uMouseXY.x;
      float mdy = pos.y - uMouseXY.y;
      float md = sqrt(mdx*mdx + mdy*mdy);
      if (md < 1.0) {
        float push = (1.0 - md) * (1.0 - md);
        pos.z += push * 0.55;
      }
    }
  }
  // ==================================================== Preset 1: TUNNEL 隧道
  else if (uPreset < 1.5) {
    float spin = t * 0.12;
    float angle = aUv.x * 2.0 * PI + spin;
    float flow = aUv.y - t * 0.08 * (1.0 + uBass * 0.55);
    flow = fract(flow);
    float zPos = (flow - 0.5) * 9.0;
    float baseR = 2.0 - uBass * 0.28 * K;
    float ripG = sin(angle * 5.0 + zPos * 1.4 + t * 2.2) * 0.10 * (uMid + uTreble) * K;
    float r = baseR + ripG;
    pos.x = cos(angle) * r;
    pos.y = sin(angle) * r;
    pos.z = zPos;

    sampleUv = safeCoverUv(vec2(aUv.x, flow));
    coverColor = mixCoverColor(texture2D(uCoverTex, sampleUv).rgb, sampleUv);
    vColor = mix(defaultColor, coverColor, uHasCover);

    float depthFade = smoothstep(-4.5, 4.5, zPos);
    vColor *= 0.4 + depthFade * 0.7;
  }
  // ==================================================== Preset 2: ORBIT 星球
  else if (uPreset < 2.5) {
    float theta = aUv.x * 2.0 * PI;
    float phi = (aUv.y - 0.5) * PI;
    float baseR = 2.2;
    float trebFlare = snoise(vec3(theta * 1.5, phi * 1.5, t * 0.7)) * uTreble * 0.85 * K;
    float bassExpand = uBass * 0.35 * K;
    float r = baseR * (1.0 + bassExpand) + trebFlare;

    pos.x = r * cos(phi) * cos(theta);
    pos.y = r * sin(phi);
    pos.z = r * cos(phi) * sin(theta);

    float yaw = t * 0.18;
    float cy = cos(yaw), sy = sin(yaw);
    pos.xz = mat2(cy, -sy, sy, cy) * pos.xz;
  }
  // ====================================================
  //  Preset 3: VOID — 虚空（上游原样：无粒子，适合自定义背景）
  //  「封面视界」已删除（第九轮用户决策），当前无模式选中此分支。
  // ====================================================
  else if (uPreset < 3.5) {
pos = vec3((aUv.x - 0.5) * 0.01, (aUv.y - 0.5) * 0.01, -90.0);
vAlpha = 0.0;
vColor = vec3(0.0);
maxRippleAmp = 0.0;
  }
  // ==================================================== Preset 4: VINYL 唱片
  else if (uPreset < 4.5) {
    float bassDrive = smoothstep(0.08, 0.78, uBass + uBeat * 0.82);
    float highDrive = smoothstep(0.05, 0.46, uTreble);
    float hiResGuard = smoothstep(1.08, 1.55, uCoverRes);
    float edgeGuard = mix(1.0, 0.38, hiResGuard);
    float depthGuard = mix(1.0, 0.44, hiResGuard);
    float grooveGuard = mix(1.0, 0.48, hiResGuard);
    float beatGuard = mix(1.0, 0.36, hiResGuard);

    vec2 p = (aUv - 0.5) * 5.12;
    float spin = uVinylSpin;
    float cs = cos(spin), sn = sin(spin);
    vec2 rp = mat2(cs, -sn, sn, cs) * p;
    float d = length(p);
    float angle0 = atan(p.y, p.x);
    float recordR = 2.46;
    float coverR = 1.18;
    float recordAlpha = 1.0 - smoothstep(recordR - 0.02, recordR + 0.05, d);
    float coverMask = 1.0 - smoothstep(coverR - 0.012, coverR + 0.018, d);
    float border = exp(-pow((d - coverR) / 0.064, 2.0)) * edgeGuard;
    float outerRim = exp(-pow((d - (recordR - 0.050)) / 0.055, 2.0)) * edgeGuard;
    float vinylN = clamp((d - coverR) / max(0.001, recordR - coverR), 0.0, 1.0);

    pos = vec3(rp * (1.0 + bassDrive * 0.012 * beatGuard + uBeat * 0.026 * beatGuard), 0.0);
    vAlpha = recordAlpha;

    if (coverMask > 0.02) {
      vec2 coverUv = safeCoverUv(p / (coverR * 2.0) + 0.5);
      coverColor = mixCoverColor(texture2D(uCoverTex, coverUv).rgb, coverUv);
      // 上游 hiResGuard 4-tap 软采样（:623-627）：高分辨率封面档用
      // 邻点平均柔化封面颜色，避免唱片纹路过锐。
      if (hiResGuard > 0.001) {
        vec2 sx = vec2(0.0026, 0.0);
        vec2 sy = vec2(0.0, 0.0026);
        vec3 softNew = (texture2D(uCoverTex, safeCoverUv(coverUv + sx)).rgb + texture2D(uCoverTex, safeCoverUv(coverUv - sx)).rgb + texture2D(uCoverTex, safeCoverUv(coverUv + sy)).rgb + texture2D(uCoverTex, safeCoverUv(coverUv - sy)).rgb) * 0.25;
        vec3 softPrev = (samplePrevCoverColor(coverUv + sx) + samplePrevCoverColor(coverUv - sx) + samplePrevCoverColor(coverUv + sy) + samplePrevCoverColor(coverUv - sy)) * 0.25;
        coverColor = mix(coverColor, mix(softPrev, softNew, clamp(uColorMixT, 0.0, 1.0)), hiResGuard * 0.42);
      }
      vColor = mix(defaultColor, coverColor, uHasCover);
      float coverShade = 1.02 + 0.10 * (1.0 - smoothstep(0.0, coverR, d));
      vColor *= coverShade;
      vColor = mix(vColor, vec3(1.0), border * 0.54);
      pos.z = 0.040 + border * 0.026 * depthGuard + uBeat * 0.018 * beatGuard;
      maxRippleAmp = max(maxRippleAmp, border * 0.30 + bassDrive * 0.075 * beatGuard + uBeat * 0.075 * beatGuard);
    } else {
      float groove = 0.5 + 0.5 * sin((d - coverR) * mix(98.0, 58.0, hiResGuard));
      float fineGroove = 0.5 + 0.5 * sin((d - coverR) * mix(170.0, 92.0, hiResGuard) + aRand * 3.0);
      float tick = smoothstep(0.82, 0.995, hash11(floor((angle0 + PI) * 38.0) + floor(d * 72.0) * 2.1));
      vec3 vinyl = vec3(0.052, 0.054, 0.058) + vec3(0.052 * grooveGuard) * groove + vec3(0.026 * grooveGuard) * fineGroove;
      vinyl = mix(vinyl, coverColor * 0.32, 0.18 * (1.0 - vinylN));
      float whiteRing = max(border * 0.92, outerRim * 0.26);
      vColor = mix(vinyl, vec3(0.92, 0.94, 0.94), whiteRing);
      vColor = mix(vColor, vec3(1.0), tick * highDrive * (0.06 + border * 0.12) * grooveGuard);
      pos.z = groove * 0.010 * grooveGuard + border * 0.024 * depthGuard + bassDrive * vinylN * 0.016 * K * beatGuard + tick * highDrive * 0.010 * grooveGuard;
      maxRippleAmp = max(maxRippleAmp, border * 0.32 + outerRim * 0.12 + bassDrive * vinylN * 0.11 * beatGuard + tick * highDrive * 0.10 * grooveGuard + uBeat * vinylN * 0.08 * beatGuard);
    }
  }
  // ==================================================== Preset 5: WALLPAPER 星河
  else {
    float bassGlow = smoothstep(0.07, 0.78, uBass) * 0.34 + uBeat * 0.014;
    float midGlow = smoothstep(0.07, 0.62, uMid) * 0.42;
    float highGlow = smoothstep(0.04, 0.46, uTreble) * 0.46;
    float lane = aUv.y;
    float transition = clamp(uBurstAmt, 0.0, 1.0);

    if (lane < 0.80) {
      // 极光丝带
      float laneWarp = snoise(vec3(aUv.x * 0.42, lane * 1.7, t * 0.026)) * 0.11 + (hash11(aRand * 73.1) - 0.5) * 0.045;
      float warpedLane = clamp(lane + laneWarp, 0.0, 0.80);
      float bandCoord = warpedLane / 0.80 * 5.65 + snoise(vec3(aUv.x * 0.82, lane * 2.25, t * 0.032)) * 0.62;
      float band = floor(bandCoord);
      float local = fract(bandCoord + hash11(band * 9.13 + aRand * 2.4) * 0.18);
      float bandN = clamp((band + 0.5) / 5.65, 0.0, 1.0);
      float seed = hash11(band * 19.17 + aRand * 31.0);
      float flow = fract(aUv.x + t * (0.0034 + bandN * 0.0038 + seed * 0.0022) + seed * 0.53);
      float arc = (flow - 0.5) * PI * (1.35 + bandN * 0.72 + seed * 0.24);
      float armCurve = sin(arc + bandN * 2.2 + seed * 5.3);
      float spiralRadius = 9.2 + bandN * 11.8 + seed * 6.0 + local * 2.9;
      float x = cos(arc * 0.72 + bandN * 0.92 + seed * 1.3) * spiralRadius + (flow - 0.5) * (13.5 + bandN * 9.5);
      float ribbonPhase = flow * PI * 2.0 * (0.55 + bandN * 0.24 + seed * 0.10) + t * (0.010 + bandN * 0.007) + seed * 5.7;
      float broadWave = sin(ribbonPhase) * 0.92;
      float fineWave = sin(ribbonPhase * (1.36 + seed * 0.62) - t * 0.044 + seed * 5.0) * 0.045;
      float yBase = (bandN - 0.5) * 13.2 + armCurve * (2.3 + bandN * 1.6) + (seed - 0.5) * 1.85 + snoise(vec3(bandN * 2.0, flow * 0.62, seed)) * 0.92;
      float ridgeCenter = 0.43 + (seed - 0.5) * 0.18;
      float ridge = exp(-pow((local - ridgeCenter) / (0.25 + seed * 0.04), 2.0));
      float softMask = smoothstep(0.010, 0.12, lane) * (1.0 - smoothstep(0.72, 0.81, lane));
      float ribbonNoise = snoise(vec3(flow * 1.18 + seed, bandN * 2.0, t * 0.018)) * 0.74;
      float zLayer = mix(-23.5, 15.5, bandN) + (seed - 0.5) * 6.0;

      pos.x = x + ribbonNoise * 1.40 + sin(t * 0.012 + seed * 8.0) * 0.22;
      pos.y = yBase + broadWave + fineWave + (local - 0.5) * (0.58 + ridge * 0.14);
      pos.z = zLayer + broadWave * 1.35 + ribbonNoise * 1.85;

      float pulseLine = 0.5 + 0.5 * sin(ribbonPhase * (1.7 + seed * 0.9) - t * 0.32 + seed * 6.0);
      vec3 aurora = mix(vec3(0.52, 0.86, 1.0), vec3(0.70, 0.58, 1.0), bandN);
      aurora = mix(aurora, vec3(0.96, 0.98, 0.92), bassGlow * 0.05);
      vAlpha = (0.18 + ridge * 0.78 + pulseLine * highGlow * 0.035 + bassGlow * 0.025) * softMask * (0.96 + transition * 0.02);
      vColor = mix(coverColor, aurora, 0.62 + ridge * 0.22) * (0.76 + ridge * 0.86 + pulseLine * highGlow * 0.05 + bassGlow * 0.04);
      maxRippleAmp = max(maxRippleAmp, ridge * (0.12 + midGlow * 0.05) + pulseLine * highGlow * 0.045 + bassGlow * 0.030);
    } else {
      // 远景尘埃
      float q = (lane - 0.80) / 0.20;
      float seed = hash11(aRand * 917.0 + floor(q * 130.0));
      float depth = mix(-32.0, 18.0, seed);
      float drift = fract(aUv.x + t * (0.0014 + seed * 0.0048) + seed * 0.63);
      float cluster = snoise(vec3(seed * 2.0, q * 3.2, t * 0.007));
      float x = (drift - 0.5) * (45.0 + seed * 22.0) + cluster * 3.4;
      float y = (hash11(aRand * 331.0 + seed * 5.0) - 0.5) * 22.0 + sin(t * (0.018 + seed * 0.028) + seed * 7.0) * 0.86;
      float z = depth + sin(t * (0.020 + seed * 0.032) + aRand * 8.0) * 1.05;
      float twinkle = pow(0.5 + 0.5 * sin(t * (0.24 + seed * 0.42) + aRand * 17.0), 5.0);
      float dust = smoothstep(0.22, 0.98, hash11(aRand * 661.0 + floor(q * 160.0)));

      pos = vec3(x, y, z);
      vAlpha = dust * (0.16 + twinkle * 0.46 + highGlow * 0.025 + bassGlow * 0.018) * (1.0 - q * 0.06);
      vColor = mix(coverColor, vec3(0.92, 0.97, 1.0), 0.62 + twinkle * 0.14) * (0.72 + twinkle * 0.62 + bassGlow * 0.025);
      maxRippleAmp = max(maxRippleAmp, twinkle * highGlow * 0.055 + dust * bassGlow * 0.030);
    }

    // 上游 preset 5 分支末尾的 burst 块（00-pointer-cover-particles.js:712-722）：
    // 切换到星河时的径向"炸开"脉冲 + 噪声位移 + z 抖动 + alpha 抬升。
    // 此前缺失该块，切换只剩 uScatter 一条路径，爆发比上游弱。
    if (transition > 0.001) {
      float bloom = smoothstep(0.0, 1.0, transition);
      vec2 burstVec = pos.xy + vec2(hash11(aRand * 31.0) - 0.5, hash11(aRand * 47.0) - 0.5) * 0.75;
      vec2 burstDir = burstVec / max(length(burstVec), 0.001);
      pos.xy += burstDir * bloom * 0.026;
      pos.xy += vec2(snoise(vec3(aRand, t * 0.014, 1.0)), snoise(vec3(aRand, t * 0.014, 5.0))) * bloom * 0.06;
      pos.xy *= 1.0 + bloom * 0.014;
      pos.z += (hash11(aRand * 123.0) - 0.5) * bloom * 0.18;
      vAlpha *= 0.86 + bloom * 0.22;
      maxRippleAmp = max(maxRippleAmp, bloom * 0.10);
    }
  }

  // ==================================================== 通用：离散感 / 扭曲
  //
  // Mineradio "00-pointer-cover-particles.js:886-898" 的两段通用形变。
  // 此前 uScatter / uTwist 只出现在 uniform 声明行、函数体内零引用 ——
  // 即这两个参数传了也没人读。
  if (uScatter > 0.001) {
    vec2 jdir = vec2(cos(aRand * 6.2831), sin(aRand * 6.2831));
    pos.xy += jdir * uScatter * (0.05 + uTreble * 0.10);
  }
  if (uTwist > 0.001 && uPreset < 0.5) {
    float ta = uTwist * pos.z * 0.6;
    float cs = cos(ta), sn = sin(ta);
    pos.xy = mat2(cs, -sn, sn, cs) * pos.xy;
  }

  // ==================================================== 颜色
  //
  // 严格对照 Mineradio "00-pointer-cover-particles.js:899-911"。
  //
  // 此前实现与 Mineradio 的三处**结构性**差异（本次修正）：
  //
  // 1. uColorBoost 被当成**线性乘数**预乘进 coverColor（5 处分支各乘一遍）。
  //    Mineradio 全程只用一次，且是**反 gamma** "pow(c, 1/boost)"：
  //    线性乘是整体变亮、高光容易削顶；反 gamma 是提亮暗部、保住高光。
  // 2. 缺 blackParticleGuard —— 封面近黑区域不应吃描边加成与染色，
  //    否则暗部发灰，丢掉封面本身的黑。
  // 3. 缺 vinylHiResGuard、uEdgeEnabled 开关，以及 uTintColor 染色链。
  float vinylHiResGuard = smoothstep(1.08, 1.55, uCoverRes) * step(3.5, uPreset) * (1.0 - step(4.5, uPreset));
  float edgeBoost = uEdgeEnabled * edgeVal * mix(1.0, 0.42, vinylHiResGuard);

  // vSourceLum 必须取**gamma 之前**的 vColor 亮度（与 Mineradio 同序）。
  // 片元的 keepBlack 和这里的 guard 依赖同一个量，取值时机错位会导致
  // 判定不一致。此前实现是在函数末尾对 coverColor 取亮度，漏掉了
  // 各预设分支对 vColor 的改写。
  vSourceLum = dot(max(vColor, vec3(0.0)), vec3(0.299, 0.587, 0.114));
  float blackParticleGuard = 1.0 - smoothstep(0.025, 0.115, vSourceLum);

  vEdgeBoost = edgeBoost * (uPreset > 3.5 ? 0.22 : 1.0) * (1.0 - blackParticleGuard);
  vColor = pow(max(vColor, vec3(0.0)), vec3(1.0 / max(0.35, uColorBoost)));
  float edgeColorMix = edgeBoost * (uPreset > 3.5 ? 0.20 : 0.50) * (1.0 - blackParticleGuard);
  vColor = mix(vColor, vColor + vec3(0.20), edgeColorMix);
  float tintLum = max(max(vColor.r, vColor.g), vColor.b);
  vec3 tintedColor = uTintColor * max(0.24, tintLum * 1.12);
  vColor = mix(vColor, tintedColor, clamp(uTintStrength, 0.0, 1.0) * (1.0 - blackParticleGuard));

  vBright = 0.82 + maxRippleAmp * 0.55 + uBass * 0.10 + edgeBoost * 0.30 + uEnergy * 0.05 + uBurstAmt * 0.40;
  if (uPreset > 4.5) {
    vBright = 0.94 + maxRippleAmp * 0.34 + uBass * 0.020 + uEnergy * 0.026 + uBurstAmt * 0.025;
  } else if (uPreset > 3.5) {
    vBright = 0.94 + maxRippleAmp * 0.64 + uBass * 0.08 + edgeBoost * 0.12 + uEnergy * 0.05 + uBeat * 0.16 + uBurstAmt * 0.16;
  }
  vRipple = clamp(maxRippleAmp * 1.5, 0.0, 1.0);

  // 背景区域在启用深度时压暗，前景保持明亮
  if (uHasDepth > 0.5 && uPreset < 0.5) {
    float bgMul = mix(1.0, 0.55, uBgFade * (1.0 - fgMask));
    vBright *= bgMul;
  }

  // ==================================================== 加载形态
  //
  // Mineradio "00-pointer-cover-particles.js:943-969" 的雾状微尘流。
  // 原注释明确写了设计意图：「避免廉价旋转圆环」。
  // 此前 uLoading 同样是声明了但函数体内零引用。
  float loadingMistSize = 1.0;
  if (uLoading > 0.001) {
    float mistSeed = hash11(aRand * 931.7);
    float mistLayer = floor(mistSeed * 4.0);
    float layerN = (mistLayer + 0.5) / 4.0;
    float mistAngle = aRand * 6.2831 + uTime * (0.16 + mistSeed * 0.18) + snoise(vec3(aRand * 2.1, uTime * 0.24, 2.0)) * 1.85;
    float mistR = mix(1.35, 3.15, sqrt(hash11(aRand * 127.3))) * (1.0 + sin(uTime * 0.42 + aRand * 7.0) * 0.13);
    vec2 mistCurl = vec2(
      snoise(vec3(aRand * 4.1, uTime * 0.32, 3.0)),
      snoise(vec3(aRand * 4.7, uTime * 0.30, 8.0))
    );
    float mistBreath = 0.5 + 0.5 * sin(uTime * (0.82 + mistSeed * 0.55) + aRand * 17.0);
    float mistRibbon = sin(mistAngle * (1.35 + layerN * 0.55) + uTime * 0.34 + mistSeed * 4.0);
    float glowPick = smoothstep(0.88, 0.997, hash11(aRand * 1501.0 + mistLayer * 17.0));
    float dustPick = 0.34 + glowPick * 0.66;
    vec3 mistPos = vec3(
      cos(mistAngle) * mistR * (1.24 + mistCurl.x * 0.16) + mistCurl.x * 0.72,
      sin(mistAngle * 0.82 + mistRibbon * 0.25) * mistR * (0.56 + layerN * 0.10) + mistCurl.y * 0.62,
      (layerN - 0.5) * 4.85 + mistCurl.x * 0.56 + mistBreath * 0.36 + mistRibbon * 0.24
    );
    vec3 mistCol = mix(vec3(0.62, 0.86, 0.84), vec3(0.36, 0.46, 0.78), mistSeed);
    mistCol = mix(mistCol, vec3(0.94, 1.0, 0.97), glowPick * (0.45 + mistBreath * 0.35));
    vColor = mix(vColor, mistCol, uLoading * 0.78);
    vBright = mix(vBright, 0.20 + mistBreath * 0.18 + abs(mistCurl.x) * 0.06 + glowPick * (0.72 + abs(mistRibbon) * 0.24), uLoading);
    vAlpha = mix(vAlpha, 0.08 + mistBreath * 0.11 + dustPick * 0.11 + glowPick * 0.30, uLoading);
    pos = mix(pos, mistPos, uLoading);
    loadingMistSize = 1.26 + mistBreath * 0.24 + abs(mistRibbon) * 0.14 + glowPick * 0.78;
  }

  vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
  float depthSize = 36.0 / max(0.5, -mvPos.z);
  float audioBoost = 1.0 + maxRippleAmp * 0.7 + edgeBoost * 0.55 + uBeat * 0.30 + uBurstAmt * 0.5;
  float sz = clamp(depthSize * audioBoost, 1.05, 4.95);
  if (uPreset > 4.5) {
    float flowDrive = uBass * 0.070 + uMid * 0.046 + uTreble * 0.060 + uBurstAmt * 0.090 + uBeat * 0.055;
    sz = clamp(depthSize * (1.05 + flowDrive), 1.00, 5.45);
  } else if (uPreset > 3.5) {
    float ringDrive = uBass * 0.30 + uMid * 0.18 + uTreble * 0.22 + uBeat * 0.30;
    sz = clamp(depthSize * (0.90 + ringDrive * 0.62), 1.05, 3.90);
  }
  // 加载态下粒子稍大
  sz = mix(sz, sz * loadingMistSize, uLoading);

  gl_PointSize = sz * uPixel * uPointScale;
  gl_Position = projectionMatrix * mvPos;
}
`

/**
 * 主粒子片元着色器 —— 对照上游 `lib/shaders.ts`。
 *
 * 关键差异（本次修复的核心）：
 *   上游是 `tex.a * uAlpha * uParticleDim * vAlpha`
 *   此前实现缺 `uAlpha` 这个**全局淡入乘数**，等于少了整个亮度总控。
 *
 * 另外上游在此处做了「亮粒子上加暗边 / 暗粒子上加亮边」的可读性处理
 * （readableRim），本移植此前完全没有，这是封面细节糊成一团的另一原因。
 *
 * 精度必须是 highp：与顶点着色器共享 uAlpha / uParticleDim / uBeat 等
 * uniform，GLSL ES 3.0 要求共享 uniform 精度一致，否则链接校验会失败
 * （真实事故：VALIDATE_STATUS false → useProgram 被拒 → 整屏不绘制）。
 */
export const PARTICLE_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform sampler2D uDotTex;
uniform float uAlpha, uPreset, uParticleDim, uBackdropAdapt;

varying vec3 vColor;
varying float vBright, vRipple, vEdgeBoost, vAlpha, vSourceLum;

void main(){
  vec4 tex = texture2D(uDotTex, gl_PointCoord);
  if (tex.a < 0.02) discard;

  vec3 col = vColor * vBright;
  col = mix(col, col * 1.3 + vec3(0.05), vEdgeBoost * 0.35);
  col = mix(col, col * 1.2, vRipple * 0.4);

  // 封面近黑区域不参与"可读性"处理，避免暗部发灰
  float keepBlack = 1.0 - smoothstep(0.025, 0.115, vSourceLum);
  float nonBlack = 1.0 - keepBlack;

  // 点边缘环带：亮粒子描暗边、暗粒子描亮边，提升封面可辨识度
  //
  // 强度由 uBackdropAdapt 驱动（Mineradio "00-pointer-cover-particles.js:995-1001"）。
  // 此前实现把系数写死成 0.38 / 0.20，而 uBackdropAdapt 初值是 0 ——
  // 等于这个 uniform 传了也没人读，亮底避光强度无法调节。
  float dotDist = length(gl_PointCoord - vec2(0.5)) * 2.0;
  float readableRim = smoothstep(0.44, 0.94, dotDist) * (1.0 - smoothstep(0.94, 1.08, dotDist)) * tex.a;
  float outLum = dot(col, vec3(0.299, 0.587, 0.114));
  float lightParticle = smoothstep(0.50, 0.82, outLum) * nonBlack;
  float darkParticle = (1.0 - smoothstep(0.20, 0.50, outLum)) * nonBlack;
  float backdropAdapt = clamp(uBackdropAdapt, 0.0, 1.0);
  if (backdropAdapt > 0.001) {
    col = mix(col, vec3(0.0), readableRim * lightParticle * (0.38 + backdropAdapt * 0.30));
    col = mix(col, vec3(1.0), readableRim * darkParticle * (0.20 + backdropAdapt * 0.12));
  }

  col = clamp(col, vec3(0.0), vec3(1.6));

  gl_FragColor = vec4(col, tex.a * uAlpha * uParticleDim * vAlpha);
}
`

/** 泛光顶点着色器：与主粒子完全相同，额外乘 uBloomSize 放大点尺寸。 */
export const PARTICLE_BLOOM_VERTEX_SHADER = PARTICLE_VERTEX_SHADER.replace(
  'uniform float uMouseActive, uPixel, uColorMixT, uLoading;',
  'uniform float uMouseActive, uPixel, uColorMixT, uLoading, uBloomSize;',
).replace('gl_PointSize = sz * uPixel * uPointScale;', 'gl_PointSize = sz * uPixel * uPointScale * uBloomSize;')

/**
 * 泛光片元着色器 —— 对照上游同名片元。
 * 同样必须 highp，理由见主粒子片元说明。
 */
export const PARTICLE_BLOOM_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform sampler2D uDotTex;
uniform float uAlpha, uBloomStrength, uPreset, uParticleDim, uBackdropAdapt;

varying vec3 vColor;
varying float vBright, vRipple, vEdgeBoost, vAlpha, vSourceLum;

void main(){
  vec4 tex = texture2D(uDotTex, gl_PointCoord);
  if (tex.a < 0.01) discard;

  float soft = tex.a * tex.a;
  vec3 col = vColor * (0.55 + vBright * 0.62);
  col = mix(col, col + vec3(0.22, 0.18, 0.10), vEdgeBoost * 0.35);
  col = clamp(col, vec3(0.0), vec3(1.8));

  float pulse = 1.0 + vRipple * 0.65;

  float keepBlack = 1.0 - smoothstep(0.025, 0.115, vSourceLum);
  float bloomKeep = 1.0 - keepBlack * 0.92;

  // 亮底时压低泛光，避免亮封面上糊成一团（Mineradio 同名片元）
  float outLum = dot(col, vec3(0.299, 0.587, 0.114));
  float backdropAdapt = clamp(uBackdropAdapt, 0.0, 1.0);
  if (backdropAdapt > 0.001) {
    float brightAvoid = smoothstep(0.48, 0.84, outLum) * backdropAdapt;
    bloomKeep *= 1.0 - brightAvoid * 0.34;
  }

  gl_FragColor = vec4(col, soft * uAlpha * uBloomStrength * uParticleDim * pulse * 0.55 * vAlpha * bloomKeep);
}
`
