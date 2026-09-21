import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { readAudioBands } from '../shared/AudioAnalyser'
import type { VisualModeId } from '../shared/VisualMode'
import { getDotTexture } from './dotTexture'

/** OpenMusic `GalaxyBackgroundStarRiver` 的背景星河粒子数。 */
const STAR_COUNT = 1400

/** 可复现的 0..1 散列，避免 Strict Mode 重渲染时重排星河。 */
function seededRandom(seed: number): number {
  const value = Math.sin(seed * 127.1) * 43758.5453123
  return value - Math.floor(value)
}

const VERTEX_SHADER = /* glsl */ `
precision highp float;
attribute float aSeed, aLane, aDepthSeed;
uniform float uTime, uBass, uTreble, uBeat, uEnergy, uPixel, uAlpha;
uniform float uPointScale, uParticleDim;
uniform vec3 uTintColor;
varying vec3 vColor;
varying float vAlpha, vTwinkle;
float hash11(float p){ return fract(sin(p * 127.1) * 43758.5453123); }
void main(){
  float band = floor(aLane * 6.0);
  float local = fract(aLane * 6.0);
  float bandN = (band + 0.5) / 6.0;
  float seed = aSeed + band * 19.17;
  float flow = fract(hash11(seed * 2.13) + uTime * (0.0022 + bandN * 0.0028 + hash11(seed * 5.1) * 0.0034));
  float arc = (flow - 0.5) * 6.2831853 * (0.68 + bandN * 0.46) + bandN * 2.4 + hash11(seed) * 6.2831853;
  float wave = sin(arc * (1.18 + bandN * 0.28) + uTime * (0.014 + bandN * 0.012) + seed * 0.07);
  float radius = 7.2 + bandN * 15.8 + hash11(seed * 3.7) * 6.2 + local * 1.8;
  vec3 pos;
  pos.x = cos(arc * 0.76 + bandN * 0.84) * radius + (flow - 0.5) * (18.0 + bandN * 14.0);
  pos.y = (bandN - 0.5) * 13.2 + wave * (1.5 + bandN * 1.4) + (local - 0.5) * 1.2;
  pos.z = mix(-31.0, -4.8, aDepthSeed) + wave * 1.2 + sin(uTime * (0.018 + hash11(seed) * 0.032) + seed) * 1.0;
  float twinkle = pow(0.5 + 0.5 * sin(uTime * (0.22 + hash11(seed * 4.0) * 0.44) + seed * 9.0), 5.0);
  float ridge = exp(-pow((local - (0.42 + hash11(seed * 6.0) * 0.16)) / (0.22 + hash11(seed * 7.0) * 0.10), 2.0));
  float dust = smoothstep(0.20, 0.98, hash11(seed * 8.0 + band));
  vec3 cool = mix(vec3(0.34, 0.76, 1.0), vec3(0.60, 0.44, 1.0), bandN);
  vec3 warm = vec3(1.0, 0.78, 0.58);
  vec3 tint = max(uTintColor, vec3(0.08));
  vColor = mix(mix(cool, warm, ridge * 0.35 + uBass * 0.06), tint, 0.22);
  vTwinkle = twinkle;
  vAlpha = uAlpha * uParticleDim * dust * (0.10 + ridge * 0.52 + twinkle * 0.32 + uBeat * 0.05) * (0.88 + uEnergy * 0.18);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  float depthSize = 30.0 / max(0.65, -mv.z);
  float size = 1.10 + ridge * 2.40 + twinkle * 2.80 + uTreble * 0.80 + uBeat * 0.50;
  gl_PointSize = clamp(size * depthSize * uPixel * uPointScale, 0.75, 5.60);
  gl_Position = projectionMatrix * mv;
}`

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;
uniform sampler2D uDotTex;
varying vec3 vColor;
varying float vAlpha, vTwinkle;
void main(){
  vec4 tex = texture2D(uDotTex, gl_PointCoord);
  if (tex.a < 0.02) discard;
  vec3 col = clamp(vColor * (0.66 + vTwinkle * 0.72), vec3(0.0), vec3(1.45));
  gl_FragColor = vec4(col, tex.a * vAlpha);
}`

interface StarRiverProps {
  enabled?: boolean
  mode: VisualModeId
}

/**
 * OpenMusic 的六带、纵深弧形背景星河。
 *
 * `galaxy` 的主粒子层本身已经构成星河，因此和上游 preset 5 一样让该层退场，
 * 避免两层稀疏粒子互相叠加。
 */
export function StarRiver({ enabled = true, mode }: StarRiverProps) {
  const alphaRef = useRef(0)
  const geometry = useMemo(() => {
    const next = new THREE.BufferGeometry()
    const seeds = new Float32Array(STAR_COUNT)
    const lanes = new Float32Array(STAR_COUNT)
    const depths = new Float32Array(STAR_COUNT)
    for (let i = 0; i < STAR_COUNT; i++) {
      seeds[i] = seededRandom(i + 1) * 1000 + i * 0.37
      lanes[i] = seededRandom(i + 1409)
      depths[i] = seededRandom(i + 2801)
    }
    next.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))
    next.setAttribute('aLane', new THREE.BufferAttribute(lanes, 1))
    next.setAttribute('aDepthSeed', new THREE.BufferAttribute(depths, 1))
    next.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50)
    return next
  }, [])

  const uniforms = useMemo(
    () => ({
      uDotTex: { value: getDotTexture() },
      uTime: { value: 0 },
      uBass: { value: 0 },
      uTreble: { value: 0 },
      uBeat: { value: 0 },
      uEnergy: { value: 0 },
      uPixel: { value: 1 },
      uPointScale: { value: 1 },
      // 上游 uParticleDim（00-pointer-cover-particles.js:366）：地形等模式
      // 挂载时压暗星河到 0.82，只压背景不影响 3D 卡片。
      uParticleDim: { value: 1 },
      uTintColor: { value: new THREE.Color('#9db8cf') },
      uAlpha: { value: 0 },
    }),
    [],
  )

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    [uniforms],
  )

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  useFrame((state, delta) => {
    const bands = readAudioBands()
    const target = enabled && mode !== 'galaxy' ? 0.34 : 0
    const ease = target > alphaRef.current ? 0.085 : 0.16
    alphaRef.current += (target - alphaRef.current) * Math.min(1, ease * Math.max(1, delta * 60))

    const u = uniforms
    /* eslint-disable react-hooks/immutability -- Three.js uniforms are mutable frame handles by design. */
    u.uTime.value = state.clock.elapsedTime
    u.uBass.value = bands.bass
    u.uTreble.value = bands.treble
    u.uBeat.value = bands.beat
    u.uEnergy.value = bands.energy
    u.uPixel.value = state.gl.getPixelRatio()
    u.uAlpha.value = alphaRef.current
    // uParticleDim：地形模式挂载时星河压暗（上游 11-main-loop.js:588
    // skullBackdropDim 的 sonic 分支 = 0.82；本项目星河与地形同时挂载，
    // 以地形挂载与否判断）。uPointScale 恒 1 —— 预设切换脉冲乘数由
    // ParticleField 独享（星河在 galaxy 模式退场，不再参与切换脉冲）。
    u.uParticleDim.value = mode === 'topography' ? 0.82 : 1
    /* eslint-enable react-hooks/immutability */
  })

  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={-2} />
}
