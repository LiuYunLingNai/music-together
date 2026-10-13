import { useCallback, useEffect, useRef, useState } from 'react'
import {
  buildStoredMonetPortraitImage,
  clearStoredMonetPortraitImage,
  isSupportedMonetPortraitFile,
  loadStoredMonetPortraitImage,
  saveStoredMonetPortraitImage,
} from '../services/monetPortraitImage'
import type { MonetPortraitImage } from '../types'

/**
 * monet 自定义封面的宿主通道（上游 `useVisualizerAssetStore` 的 monet 分支）。
 *
 * 与 `useCappellaCustomImages` 同构：Blob 存 IndexedDB、挂载时异步恢复、
 * 消费形态是 objectURL（卸载时 revoke）。monet 只有一张图：
 * 上传 = 覆盖保存（上游 store 的 setMonetPortraitImage 语义），清除即回退封面。
 * 失败静默降级为 null（monet 的 'custom' 来源会自动回退 coverUrl）。
 */
export function useMonetPortraitImage() {
  const [portraitImage, setPortraitImage] = useState<MonetPortraitImage | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const objectUrlRef = useRef<string | null>(null)

  const revokeObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
  }, [])

  const applyStored = useCallback(
    (stored: { id: string; name: string; blob: Blob } | null) => {
      revokeObjectUrl()
      if (!stored) {
        setPortraitImage(null)
        return
      }
      const url = URL.createObjectURL(stored.blob)
      objectUrlRef.current = url
      setPortraitImage({ id: stored.id, name: stored.name, url })
    },
    [revokeObjectUrl],
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const stored = await loadStoredMonetPortraitImage()
      if (cancelled) return
      applyStored(stored)
      setIsLoading(false)
    })()
    return () => {
      cancelled = true
      revokeObjectUrl()
    }
  }, [applyStored, revokeObjectUrl])

  const uploadPortraitImage = useCallback(
    async (files: File[]): Promise<{ ok: boolean; error?: string }> => {
      const file = files.find(isSupportedMonetPortraitFile)
      if (!file) return { ok: false, error: '没有受支持的图片文件' }
      const stored = buildStoredMonetPortraitImage(file)
      await saveStoredMonetPortraitImage(stored)
      applyStored(stored)
      setIsLoading(false)
      return { ok: true }
    },
    [applyStored],
  )

  const clearPortraitImage = useCallback(async () => {
    await clearStoredMonetPortraitImage()
    applyStored(null)
    setIsLoading(false)
  }, [applyStored])

  return {
    monetPortraitImage: portraitImage,
    isLoadingMonetPortraitImage: isLoading,
    uploadMonetPortraitImage: uploadPortraitImage,
    clearMonetPortraitImage: clearPortraitImage,
  }
}
