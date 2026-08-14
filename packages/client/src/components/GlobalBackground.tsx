import { useEffect, useState, type CSSProperties } from 'react'
import { EVENTS, type GlobalBackgroundSettings } from '@music-together/shared'
import { SERVER_URL } from '@/lib/config'
import { useSocketEvent } from '@/hooks/useSocketEvent'
import { useGlobalBackgroundStore } from '@/stores/globalBackgroundStore'

function resolveBackgroundUrl(backgroundUrl: string | null): string | undefined {
  if (!backgroundUrl) return undefined
  return backgroundUrl.startsWith('/uploads/') ? `${SERVER_URL}${backgroundUrl}` : backgroundUrl
}

export function GlobalBackground() {
  const backgroundUrl = useGlobalBackgroundStore((state) => state.backgroundUrl)
  const glassOverlay = useGlobalBackgroundStore((state) => state.glassOverlay)
  const colorPreset = useGlobalBackgroundStore((state) => state.colorPreset)
  const backgroundBrightness = useGlobalBackgroundStore((state) => state.backgroundBrightness)
  const autoTint = useGlobalBackgroundStore((state) => state.autoTint)
  const setBackgroundUrl = useGlobalBackgroundStore((state) => state.setBackgroundUrl)
  const setGlassOverlay = useGlobalBackgroundStore((state) => state.setGlassOverlay)
  const setColorPreset = useGlobalBackgroundStore((state) => state.setColorPreset)
  const setBackgroundBrightness = useGlobalBackgroundStore((state) => state.setBackgroundBrightness)
  const setAutoTint = useGlobalBackgroundStore((state) => state.setAutoTint)
  const [tint, setTint] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetch(`${SERVER_URL}/api/settings/background`, { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Request failed: ${response.status}`)
        return (await response.json()) as GlobalBackgroundSettings
      })
      .then((settings) => {
        if (!cancelled) {
          setBackgroundUrl(settings.backgroundUrl)
          setGlassOverlay(settings.glassOverlay)
          setColorPreset(settings.colorPreset)
          setBackgroundBrightness(settings.backgroundBrightness)
          setAutoTint(settings.autoTint)
        }
      })
      .catch(() => {
        // The default theme remains usable if a server is temporarily unavailable.
      })
    return () => {
      cancelled = true
    }
  }, [setBackgroundUrl, setGlassOverlay, setColorPreset, setBackgroundBrightness, setAutoTint])

  useSocketEvent(EVENTS.SERVER_GLOBAL_BACKGROUND, (settings) => {
    setBackgroundUrl(settings.backgroundUrl)
    setGlassOverlay(settings.glassOverlay)
    setColorPreset(settings.colorPreset)
    setBackgroundBrightness(settings.backgroundBrightness)
    setAutoTint(settings.autoTint)
  })

  useEffect(() => {
    document.documentElement.dataset.colorPreset = colorPreset
  }, [colorPreset])

  const resolvedUrl = resolveBackgroundUrl(backgroundUrl)

  useEffect(() => {
    if (!autoTint || !resolvedUrl) return

    let cancelled = false
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 32
        canvas.height = 32
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) return
        context.drawImage(image, 0, 0, 32, 32)
        const pixels = context.getImageData(0, 0, 32, 32).data
        let red = 0
        let green = 0
        let blue = 0
        let count = 0
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index + 3] < 32) continue
          red += pixels[index]!
          green += pixels[index + 1]!
          blue += pixels[index + 2]!
          count += 1
        }
        if (!cancelled && count > 0) {
          setTint(`rgb(${Math.round(red / count)} ${Math.round(green / count)} ${Math.round(blue / count)})`)
        }
      } catch {
        if (!cancelled) setTint(null)
      }
    }
    image.onerror = () => {
      if (!cancelled) setTint(null)
    }
    image.src = resolvedUrl
    return () => {
      cancelled = true
    }
  }, [autoTint, resolvedUrl])

  if (!resolvedUrl) return null

  return (
    <div
      className={glassOverlay ? 'mt-global-background mt-global-background-glass' : 'mt-global-background'}
      aria-hidden="true"
      style={
        {
          backgroundImage: `url("${resolvedUrl}")`,
          '--mt-background-brightness': backgroundBrightness / 100,
          '--mt-auto-tint': autoTint ? (tint ?? 'transparent') : 'transparent',
        } as CSSProperties
      }
    />
  )
}
