import { useEffect, useRef } from 'react'
import type { Theme } from '../types'

const hash = (index: number, channel: number) => {
  const value = Math.sin(index * 123.456 * 127.1 + channel * 311.7) * 43758.5453123
  return value - Math.floor(value)
}
const particles = Array.from({ length: 150 }, (_, index) => ({
  x: hash(index, 4.4),
  y: hash(index, 3.3),
  speed: 0.008 + hash(index, 1.1) * 0.024,
  size: 0.0006 + 0.0032 * hash(index, 2.2) ** 3.8,
  blink: 1 + hash(index, 5.5) * 2,
  accent: hash(index, 6.6) > 0.9,
}))

/** Folia Sora's 150 drifting stars and blink equations, adapted to Canvas2D without a WebGL dependency. */
export function SoraBackground({
  theme,
  paused,
  fps,
  scale,
  speed,
}: {
  theme: Theme
  paused: boolean
  fps: number
  scale: number
  speed: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const timeRef = useRef(0)
  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    let frame = 0
    let lastFrame: number | null = null
    const render = (now: number) => {
      const delta = lastFrame === null ? 0 : now - lastFrame
      if (!paused && lastFrame !== null && delta < 1000 / fps) {
        frame = requestAnimationFrame(render)
        return
      }
      if (!paused) timeRef.current += (Math.min(delta, 100) / 1000) * speed
      lastFrame = now
      const time = timeRef.current
      const width = canvas.width
      const height = canvas.height
      context.clearRect(0, 0, width, height)
      context.fillStyle = theme.backgroundColor
      context.fillRect(0, 0, width, height)
      for (const star of particles) {
        const x = ((star.x + time * star.speed) % 1) * (width + 20) - 10
        const y = (0.05 + star.y * 0.9 + Math.sin(time * 0.3 + star.y * 6.283) * 0.005) * height
        const radius = Math.max(0.6, star.size * height * 1.5)
        const intensity = Math.max(0.08, 0.3 + 0.7 * Math.sin(time * star.blink + star.x * 6.283))
        context.globalAlpha = intensity
        context.fillStyle = star.accent ? theme.accentColor : theme.primaryColor
        context.beginPath()
        context.arc(x, y, radius, 0, Math.PI * 2)
        context.fill()
      }
      context.globalAlpha = 1
      if (!paused) frame = requestAnimationFrame(render)
    }
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * scale
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
      cancelAnimationFrame(frame)
      lastFrame = null
      frame = requestAnimationFrame(render)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [theme, paused, fps, scale, speed])
  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
}
