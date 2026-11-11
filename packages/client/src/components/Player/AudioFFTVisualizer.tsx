import { getLowFreqAnalyser } from '@/lib/audioTap'
import { useLayoutEffect, useRef, type CSSProperties } from 'react'

const RANGE_HZ: readonly [number, number] = [80, 2000]

function resampleLinear(src: number[], dstLen: number): number[] {
  const n = src.length
  if (dstLen <= 0 || n === 0) return []
  if (n === dstLen) return src.slice()
  const out = new Array<number>(dstLen)
  const scale = (n - 1) / Math.max(1, dstLen - 1)
  for (let i = 0; i < dstLen; i++) {
    const x = i * scale
    const x0 = Math.floor(x)
    const x1 = Math.min(n - 1, x0 + 1)
    const t = x - x0
    out[i] = src[x0] * (1 - t) + src[x1] * t
  }
  return out
}

/** 上游 AudioFFTVisualizer 的绘制逻辑；频谱来自宿主只读分析节点（80–2000Hz）。 */
export function AudioFFTVisualizer({ className, style }: { className?: string; style?: CSSProperties }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    let target = { width: 0, height: 0 }
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) {
        target = {
          width: e.contentRect.width * window.devicePixelRatio,
          height: e.contentRect.height * window.devicePixelRatio,
        }
      }
    })
    obs.observe(canvas)

    let maxValue = 100
    let stopped = false
    let raf = 0
    let buf: number[] = []
    let bytes: Uint8Array<ArrayBuffer> | null = null

    const readFft = (): number[] => {
      const analyser = getLowFreqAnalyser()
      if (!analyser) return []
      if (!bytes || bytes.length !== analyser.frequencyBinCount) {
        bytes = new Uint8Array(analyser.frequencyBinCount)
      }
      analyser.getByteFrequencyData(bytes)
      const hzPerBin = analyser.context.sampleRate / analyser.fftSize
      const from = Math.max(0, Math.floor(RANGE_HZ[0] / hzPerBin))
      const to = Math.min(bytes.length, Math.ceil(RANGE_HZ[1] / hzPerBin))
      return Array.from(bytes.subarray(from, to))
    }

    const onFrame = () => {
      if (stopped) return
      const { width, height } = canvas
      if (target.width !== width || target.height !== height) {
        canvas.width = target.width
        canvas.height = target.height
      }

      const processed = readFft()
      if (buf.length !== processed.length) {
        buf = [...processed]
      } else {
        for (let i = 0; i < buf.length; i++) {
          const t = processed[i] * Math.min(((i + 5) / buf.length) * 4, 1)
          buf[i] += t * 2
          buf[i] /= 3
        }
      }

      ctx.clearRect(0, 0, width, height)
      const dpr = window.devicePixelRatio || 1
      const desiredCount = Math.max(8, Math.floor(width / Math.max(1, 8 * dpr)))
      const lineCount = buf.length > 0 ? Math.min(buf.length, desiredCount) : 0
      const display = lineCount > 0 ? resampleLinear(buf, lineCount) : []
      const targetMax = display.length > 0 ? Math.max(...display) : 0
      maxValue = Math.max(targetMax * 0.1 + maxValue * 0.9, 100)

      const barWidth = width / Math.max(1, display.length)
      ctx.beginPath()
      ctx.strokeStyle = 'white'
      ctx.lineWidth = 4 * dpr
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      const beginY = height - barWidth
      for (let i = 0; i < display.length; i++) {
        const x = barWidth * (i + 0.5)
        ctx.moveTo(x, beginY)
        const norm = Math.min(1, Math.max(0, display[i] / maxValue))
        ctx.lineTo(x, beginY - norm ** 2 * (height - barWidth * 2))
      }
      ctx.stroke()

      raf = requestAnimationFrame(onFrame)
    }
    onFrame()

    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      obs.disconnect()
    }
  }, [])

  return <canvas ref={canvasRef} className={className} style={style} aria-hidden />
}
