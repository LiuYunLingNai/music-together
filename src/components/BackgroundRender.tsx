import { useEffect, useRef } from 'react'
import { useAppStore } from '../store/app-store'
import { getProxiedCoverUrl } from '../lib/cover'

export function BackgroundRender({ cover }: { cover: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const serverUrl = useAppStore((state) => state.serverUrl)
  const fps = useAppStore((state) => state.backgroundFps)
  const flowSpeed = useAppStore((state) => state.backgroundFlowSpeed)
  const renderScale = useAppStore((state) => state.backgroundRenderScale)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !cover) return
    const context = canvas.getContext('2d')
    if (!context) return
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.src = getProxiedCoverUrl(serverUrl, cover)
    let last = 0
    let animation = 0
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.round(rect.width * renderScale * devicePixelRatio))
      canvas.height = Math.max(1, Math.round(rect.height * renderScale * devicePixelRatio))
    }
    const draw = (time: number) => {
      if (time - last < 1000 / fps) { animation = requestAnimationFrame(draw); return }
      last = time
      const width = canvas.width
      const height = canvas.height
      context.clearRect(0, 0, width, height)
      if (image.complete && image.naturalWidth > 0) {
        const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight)
        const imageWidth = image.naturalWidth * scale
        const imageHeight = image.naturalHeight * scale
        context.globalAlpha = 0.24
        context.drawImage(image, (width - imageWidth) / 2, (height - imageHeight) / 2, imageWidth, imageHeight)
        context.globalAlpha = 1
      }
      context.fillStyle = 'rgba(10, 12, 16, .7)'
      context.fillRect(0, 0, width, height)
      context.strokeStyle = 'rgba(255, 255, 255, .08)'
      context.lineWidth = Math.max(1, width / 900)
      context.beginPath()
      const offset = (time / 1000) * flowSpeed
      for (let x = 0; x <= width; x += Math.max(18, width / 28)) {
        const y = height * 0.55 + Math.sin(x / width * 10 + offset) * height * 0.08
        if (x === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      }
      context.stroke()
      animation = requestAnimationFrame(draw)
    }
    resize()
    window.addEventListener('resize', resize)
    const onImageLoad = () => resize()
    image.addEventListener('load', onImageLoad)
    animation = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(animation); window.removeEventListener('resize', resize); image.removeEventListener('load', onImageLoad) }
  }, [cover, fps, flowSpeed, renderScale, serverUrl])

  return <canvas ref={canvasRef} className="background-render" aria-hidden="true" />
}
