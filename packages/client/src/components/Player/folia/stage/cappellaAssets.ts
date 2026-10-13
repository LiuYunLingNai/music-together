import { useCallback, useEffect, useRef, useState } from 'react'
import { buildStoredCappellaImagePack, clearStoredCappellaImagePack, loadStoredCappellaImagePack, saveStoredCappellaImagePack } from '../services/cappellaImagePacks'
import type { CappellaAvatarImage, CappellaEmojiImage, StoredCappellaAvatarImage, StoredCappellaEmojiImage } from '../types'

/**
 * cappella 自定义表情包 / 头像的宿主通道。
 *
 * 上游对应 `useVisualizerAssetStore` + `useAppPreferences` 的恢复路径 +
 * settingsPanels 的导入回调。这里收敛为一个舞台作用域 hook：
 *
 *   - Blob 存 IndexedDB（`services/cappellaImagePacks.ts`），挂载时异步恢复；
 *   - 消费形态是 objectURL（cappella 的 props 契约就是 `{id,name,url}`），
 *     卸载时统一 revoke，不泄漏；
 *   - 导入 = 构建 Stored 列表 → 覆盖保存 → 同步刷新 objectURL 列表；
 *   - 失败静默降级为空列表（cappella 的 'custom' 源会自动回退 builtin），
 *     与上游「资产缺失不影响其它功能」的语义一致。
 */
export function useCappellaCustomImages() {
  const [emojiImages, setEmojiImages] = useState<CappellaEmojiImage[]>([])
  const [avatarImages, setAvatarImages] = useState<CappellaAvatarImage[]>([])
  const [isLoadingEmoji, setIsLoadingEmoji] = useState(true)
  const [isLoadingAvatar, setIsLoadingAvatar] = useState(true)
  const objectUrlsRef = useRef<string[]>([])

  const revokeAll = useCallback(() => {
    for (const url of objectUrlsRef.current) URL.revokeObjectURL(url)
    objectUrlsRef.current = []
  }, [])

  const applyStored = useCallback(
    (emoji: StoredCappellaEmojiImage[], avatar: StoredCappellaAvatarImage[]) => {
      revokeAll()
      const urls = [...emoji.map((entry) => entry.blob), ...avatar.map((entry) => entry.blob)].map((blob) =>
        URL.createObjectURL(blob),
      )
      objectUrlsRef.current = urls
      setEmojiImages(emoji.map((entry, index) => ({ id: entry.id, name: entry.name, url: urls[index] })))
      setAvatarImages(
        avatar.map((entry, index) => ({ id: entry.id, name: entry.name, url: urls[emoji.length + index] })),
      )
    },
    [revokeAll],
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [emoji, avatar] = await Promise.all([
        loadStoredCappellaImagePack('emoji') as Promise<StoredCappellaEmojiImage[]>,
        loadStoredCappellaImagePack('avatar') as Promise<StoredCappellaAvatarImage[]>,
      ])
      if (cancelled) return
      applyStored(emoji, avatar)
      setIsLoadingEmoji(false)
      setIsLoadingAvatar(false)
    })()
    return () => {
      cancelled = true
      revokeAll()
    }
  }, [applyStored, revokeAll])

  const importEmojiPack = useCallback(
    async (files: File[]): Promise<{ ok: boolean; error?: string }> => {
      const pack = buildStoredCappellaImagePack(files)
      if (pack.length === 0) return { ok: false, error: '没有受支持的图片文件' }
      await saveStoredCappellaImagePack('emoji', pack)
      applyStored(pack, avatarImages.length ? (await loadStoredCappellaImagePack('avatar') as StoredCappellaAvatarImage[]) : [])
      setIsLoadingEmoji(false)
      return { ok: true }
    },
    [applyStored, avatarImages.length],
  )

  const clearEmojiPack = useCallback(async () => {
    await clearStoredCappellaImagePack('emoji')
    applyStored([], avatarImages.length ? (await loadStoredCappellaImagePack('avatar') as StoredCappellaAvatarImage[]) : [])
    setIsLoadingEmoji(false)
  }, [applyStored, avatarImages.length])

  const importAvatarPack = useCallback(
    async (files: File[]): Promise<{ ok: boolean; error?: string }> => {
      const pack = buildStoredCappellaImagePack(files)
      if (pack.length === 0) return { ok: false, error: '没有受支持的图片文件' }
      await saveStoredCappellaImagePack('avatar', pack)
      applyStored(emojiImages.length ? (await loadStoredCappellaImagePack('emoji') as StoredCappellaEmojiImage[]) : [], pack)
      setIsLoadingAvatar(false)
      return { ok: true }
    },
    [applyStored, emojiImages.length],
  )

  const clearAvatarPack = useCallback(async () => {
    await clearStoredCappellaImagePack('avatar')
    applyStored(emojiImages.length ? (await loadStoredCappellaImagePack('emoji') as StoredCappellaEmojiImage[]) : [], [])
    setIsLoadingAvatar(false)
  }, [applyStored, emojiImages.length])

  return {
    emojiImages,
    avatarImages,
    isLoadingEmoji,
    isLoadingAvatar,
    hasEmojiPack: emojiImages.length > 0,
    hasAvatarPack: avatarImages.length > 0,
    importEmojiPack,
    clearEmojiPack,
    importAvatarPack,
    clearAvatarPack,
  }
}
