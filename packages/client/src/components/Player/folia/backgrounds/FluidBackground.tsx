import { useEffect, useState } from 'react'
import type { Theme } from '../types'

/** Adapted from Folia common/FluidBackground: decode a small blur source before cross-fading. */
async function downscaleCover(url: string): Promise<string> {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.decoding = 'async'
  image.src = url
  await image.decode()
  try {
    const size = Math.min(image.naturalWidth, image.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 384
    const context = canvas.getContext('2d')
    if (!context || size <= 0) return url
    context.drawImage(
      image,
      (image.naturalWidth - size) / 2,
      (image.naturalHeight - size) / 2,
      size,
      size,
      0,
      0,
      384,
      384,
    )
    return canvas.toDataURL('image/jpeg', 0.82)
  } catch {
    return url
  }
}

export function FluidBackground({ coverUrl, theme }: { coverUrl: string | null; theme: Theme }) {
  const [layers, setLayers] = useState<{ source: string; url: string }[]>([])
  useEffect(() => {
    if (!coverUrl) return
    let cancelled = false
    void downscaleCover(coverUrl)
      .then((url) => {
        if (!cancelled)
          setLayers((previous) => [
            ...previous.filter((layer) => layer.source !== coverUrl).slice(-1),
            { source: coverUrl, url },
          ])
      })
      .catch(() => {
        // Missing/blocked cover leaves the theme gradients visible.
        if (!cancelled) setLayers([])
      })
    return () => {
      cancelled = true
    }
  }, [coverUrl])
  return (
    <div className="folia-fluid absolute inset-0 overflow-hidden" style={{ backgroundColor: theme.backgroundColor }}>
      {coverUrl &&
        layers.map((layer) => (
          <img
            key={layer.source}
            src={layer.url}
            alt=""
            aria-hidden="true"
            decoding="async"
            draggable={false}
            className="folia-fluid__cover"
          />
        ))}
      <div
        className="absolute inset-0 opacity-40"
        style={{
          background: `linear-gradient(135deg, ${theme.accentColor}, transparent 50%, ${theme.secondaryColor})`,
          mixBlendMode: 'overlay',
        }}
      />
      <div className="absolute inset-0 bg-black/25" />
    </div>
  )
}
