import { useEffect, useState, type CSSProperties } from 'react'
import { EVENTS, type GlobalBackgroundSettings } from '@music-together/shared'
import { SERVER_URL } from '@/lib/config'
import { getProxiedCoverUrl } from '@/lib/cover'
import { extractCoverPalette, type CoverPalette } from '@/lib/coverPalette'
import { useSocketEvent } from '@/hooks/useSocketEvent'
import { useGlobalBackgroundStore } from '@/stores/globalBackgroundStore'
import { usePlayerStore } from '@/stores/playerStore'

function resolveBackgroundUrl(backgroundUrl: string | null): string | undefined {
  if (!backgroundUrl) return undefined
  return backgroundUrl.startsWith('/uploads/') ? `${SERVER_URL}${backgroundUrl}` : backgroundUrl
}

export function GlobalBackground({ roomScoped = false }: { roomScoped?: boolean }) {
  const backgroundUrl = useGlobalBackgroundStore((state) => state.backgroundUrl)
  const glassOverlay = useGlobalBackgroundStore((state) => state.glassOverlay)
  const colorPreset = useGlobalBackgroundStore((state) => state.colorPreset)
  const backgroundBrightness = useGlobalBackgroundStore((state) => state.backgroundBrightness)
  const autoTint = useGlobalBackgroundStore((state) => state.autoTint)
  const coverAutoTintSetting = useGlobalBackgroundStore((state) => state.coverAutoTint)
  const coverAutoTint = roomScoped && coverAutoTintSetting
  const currentTrack = usePlayerStore((state) => state.currentTrack)
  const setBackgroundUrl = useGlobalBackgroundStore((state) => state.setBackgroundUrl)
  const setGlassOverlay = useGlobalBackgroundStore((state) => state.setGlassOverlay)
  const setColorPreset = useGlobalBackgroundStore((state) => state.setColorPreset)
  const setBackgroundBrightness = useGlobalBackgroundStore((state) => state.setBackgroundBrightness)
  const setAutoTint = useGlobalBackgroundStore((state) => state.setAutoTint)
  const setCoverAutoTint = useGlobalBackgroundStore((state) => state.setCoverAutoTint)
  const [tint, setTint] = useState<string | null>(null)
  const [coverPalette, setCoverPalette] = useState<{ url: string; palette: CoverPalette | null } | null>(null)

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
          setAutoTint(settings.autoTint === true)
          setCoverAutoTint(settings.coverAutoTint === true)
        }
      })
      .catch(() => {
        // The default theme remains usable if a server is temporarily unavailable.
      })
    return () => {
      cancelled = true
    }
  }, [setBackgroundUrl, setGlassOverlay, setColorPreset, setBackgroundBrightness, setAutoTint, setCoverAutoTint])

  useSocketEvent(EVENTS.SERVER_GLOBAL_BACKGROUND, (settings) => {
    setBackgroundUrl(settings.backgroundUrl)
    setGlassOverlay(settings.glassOverlay)
    setColorPreset(settings.colorPreset)
    setBackgroundBrightness(settings.backgroundBrightness)
    setAutoTint(settings.autoTint === true)
    setCoverAutoTint(settings.coverAutoTint === true)
  })

  useEffect(() => {
    document.documentElement.dataset.colorPreset = colorPreset
  }, [colorPreset])

  const resolvedUrl = resolveBackgroundUrl(backgroundUrl)
  const coverUrl = currentTrack?.cover ? getProxiedCoverUrl(currentTrack.cover) : undefined

  useEffect(() => {
    if (!coverAutoTint || !coverUrl) {
      return
    }

    const sourceUrl = coverUrl
    let cancelled = false
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.referrerPolicy = 'no-referrer'
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 32
        canvas.height = 32
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) return
        context.drawImage(image, 0, 0, 32, 32)
        const palette = extractCoverPalette(context.getImageData(0, 0, 32, 32).data)
        if (!cancelled) setCoverPalette({ url: sourceUrl, palette })
      } catch {
        if (!cancelled) setCoverPalette({ url: sourceUrl, palette: null })
      }
    }
    image.onerror = () => {
      if (!cancelled) setCoverPalette({ url: sourceUrl, palette: null })
    }
    image.src = sourceUrl
    return () => {
      cancelled = true
    }
  }, [coverAutoTint, coverUrl])

  const activeCoverPalette =
    coverAutoTint && coverUrl && coverPalette?.url === coverUrl ? coverPalette.palette : null

  useEffect(() => {
    const root = roomScoped
      ? document.querySelector<HTMLElement>('.mt-room-page')
      : document.documentElement
    if (!root) return
    const portalRoot = roomScoped ? document.body : null
    const scopes = portalRoot ? [root, portalRoot] : [root]
    const properties = [
      '--mt-cover-accent-rgb',
      '--mt-cover-highlight-rgb',
      '--mt-cover-secondary-rgb',
      '--mt-cover-border-rgb',
    ]
    if (!coverAutoTint || !activeCoverPalette) {
      scopes.forEach((scope) => {
        scope.removeAttribute('data-cover-tint')
        scope.removeAttribute('data-room-cover-tint')
        properties.forEach((property) => scope.style.removeProperty(property))
      })
      return
    }

    root.dataset.coverTint = 'true'
    if (portalRoot) portalRoot.dataset.roomCoverTint = 'true'
    scopes.forEach((scope) => {
      scope.style.setProperty('--mt-cover-accent-rgb', activeCoverPalette.accent)
      scope.style.setProperty('--mt-cover-highlight-rgb', activeCoverPalette.highlight)
      scope.style.setProperty('--mt-cover-secondary-rgb', activeCoverPalette.secondary)
      scope.style.setProperty('--mt-cover-border-rgb', activeCoverPalette.border)
    })
    return () => {
      scopes.forEach((scope) => {
        scope.removeAttribute('data-cover-tint')
        scope.removeAttribute('data-room-cover-tint')
        properties.forEach((property) => scope.style.removeProperty(property))
      })
    }
  }, [activeCoverPalette, coverAutoTint, roomScoped])

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
          '--mt-auto-tint': autoTint && !coverAutoTint ? (tint ?? 'transparent') : 'transparent',
        } as CSSProperties
      }
    />
  )
}
