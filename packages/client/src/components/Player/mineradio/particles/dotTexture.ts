import * as THREE from 'three'

/**
 * 点精灵纹理。
 *
 * 参照 Mineradio 的 `makeDotTexture`（`00-pointer-cover-particles.js:197-211`）：
 * 64×64 画布上的径向渐变，
 *
 *   rgba(255,255,255,0.96) @ 0.00
 *   rgba(255,255,255,0.78) @ 0.42
 *   rgba(255,255,255,0.22) @ 0.72
 *   rgba(255,255,255,0)    @ 1.00
 *
 * 这张纹理是"柔和光晕"的关键：直接用 `gl_PointCoord` 做圆形裁切得到的是
 * 硬边圆点，而径向渐变会形成由中心向外衰减的辉光，泛光叠加后才通透。
 *
 * 纹理在整个舞台生命周期内只创建一次，卸载时释放。
 */

const DOT_SIZE = 64

let cached: THREE.CanvasTexture | null = null

export function getDotTexture(): THREE.CanvasTexture | null {
  if (cached) return cached
  if (typeof document === 'undefined') return null

  const canvas = document.createElement('canvas')
  canvas.width = DOT_SIZE
  canvas.height = DOT_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const half = DOT_SIZE / 2
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half - 1)
  gradient.addColorStop(0.0, 'rgba(255,255,255,0.96)')
  gradient.addColorStop(0.42, 'rgba(255,255,255,0.78)')
  gradient.addColorStop(0.72, 'rgba(255,255,255,0.22)')
  gradient.addColorStop(1.0, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, DOT_SIZE, DOT_SIZE)

  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true

  cached = texture
  return texture
}

/** 释放点精灵纹理。舞台卸载时调用。 */
export function disposeDotTexture(): void {
  cached?.dispose()
  cached = null
}
