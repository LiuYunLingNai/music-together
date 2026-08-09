import { lazy, Suspense, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { getProxiedCoverUrl } from '../lib/cover'
import { extractStagePalette, type StagePalette } from '../lib/stage-palette'
import { useAppStore } from '../store/app-store'

const AmllFluidBackground = lazy(() => import('@applemusic-like-lyrics/react').then((module) => ({ default: module.BackgroundRender })))
const DARK_FALLBACK = extractStagePalette(new Uint8ClampedArray(), false)
const LIGHT_FALLBACK = extractStagePalette(new Uint8ClampedArray(), true)

export function BackgroundRender({ cover }: { cover: string }) {
  const serverUrl = useAppStore((state) => state.serverUrl)
  const fps = useAppStore((state) => state.backgroundFps)
  const flowSpeed = useAppStore((state) => state.backgroundFlowSpeed)
  const renderScale = useAppStore((state) => state.backgroundRenderScale)
  const isPlaying = useAppStore((state) => state.isPlaying)
  const resolvedTheme = useAppStore((state) => state.resolvedTheme)
  const visual = useAppStore((state) => state.playerVisualSettings)
  const [palette, setPalette] = useState<StagePalette>(() => resolvedTheme === 'light' ? LIGHT_FALLBACK : DARK_FALLBACK)
  const coverUrl = getProxiedCoverUrl(serverUrl, cover)

  useEffect(() => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.src = coverUrl
    const onLoad = () => {
      try {
        const sampler = document.createElement('canvas')
        sampler.width = 32
        sampler.height = 32
        const context = sampler.getContext('2d', { willReadFrequently: true })
        context?.drawImage(image, 0, 0, 32, 32)
        const pixels = context?.getImageData(0, 0, 32, 32).data
        if (pixels) setPalette(extractStagePalette(pixels, resolvedTheme === 'light'))
      } catch {
        setPalette(resolvedTheme === 'light' ? LIGHT_FALLBACK : DARK_FALLBACK)
      }
    }
    image.addEventListener('load', onLoad)
    return () => image.removeEventListener('load', onLoad)
  }, [coverUrl, resolvedTheme])

  const accentIndex = visual.accentVariant === 'secondary' ? 1 : visual.accentVariant === 'tertiary' ? 2 : 0
  const accent = palette.colors[accentIndex] ?? palette.accent
  const style = useMemo(() => ({
    '--player-accent': accent,
    '--player-color-1': palette.colors[0],
    '--player-color-2': palette.colors[1],
    '--player-color-3': palette.colors[2],
    '--player-color-4': palette.colors[3],
    '--player-background-dim': visual.backgroundDim / 100,
    '--player-background-blur': `${visual.backgroundBlur}px`,
    '--player-cover-url': `url("${coverUrl.replaceAll('"', '\\"')}")`,
  }) as CSSProperties, [accent, coverUrl, palette, visual.backgroundBlur, visual.backgroundDim])

  useEffect(() => {
    const shell = document.querySelector<HTMLElement>('.app-shell')
    shell?.style.setProperty('--player-accent', accent)
  }, [accent])

  if (visual.backgroundMode === 'none') return null
  return (
    <div className={`background-render background-render--${visual.backgroundMode}`} style={style} aria-hidden="true">
      {visual.backgroundMode === 'fluid' ? (
        <Suspense fallback={<div className="background-render__gradient" />}>
          <AmllFluidBackground album={coverUrl} fps={fps} flowSpeed={flowSpeed} renderScale={renderScale} playing={isPlaying} staticMode={visual.staticFluid} />
        </Suspense>
      ) : <div className="background-render__surface" />}
    </div>
  )
}
