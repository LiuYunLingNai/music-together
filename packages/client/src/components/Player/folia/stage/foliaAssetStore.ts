import { create } from 'zustand'
import {
  buildStoredCappellaImagePack,
  clearStoredCappellaImagePack,
  loadStoredCappellaImagePack,
  saveStoredCappellaImagePack,
} from '../services/cappellaImagePacks'
import {
  buildStoredMonetPortraitImage,
  clearStoredMonetPortraitImage,
  isSupportedMonetPortraitFile,
  loadStoredMonetPortraitImage,
  saveStoredMonetPortraitImage,
} from '../services/monetPortraitImage'
import {
  buildStoredMonetBackgroundImage,
  clearMonetBackgroundImage,
  getMonetBackgroundImage,
  isSupportedMonetBackgroundFile,
  saveMonetBackgroundImage,
} from '../upstream/services/monetBackgroundImage'
import type {
  CappellaAvatarImage,
  CappellaEmojiImage,
  MonetBackgroundImage,
  MonetPortraitImage,
  StoredCappellaAvatarImage,
  StoredCappellaEmojiImage,
} from '../types'

/**
 * Folia 的视觉素材（群唱表情/头像、莫奈人像与背景图）。
 *
 * 上游这些存在 `useVisualizerAssetStore` 里，播放页与歌词样式窗口读同一份 ——
 * 窗口里上传的图立刻出现在舞台上，舞台上的样式也在窗口里预览。宿主此前把它拆成
 * 两个舞台作用域 hook，窗口拿不到、上传按钮也就没有回调；这里收成一份 store，
 * 舞台与窗口共用，上传/清除写回 IndexedDB 并刷新 objectURL。
 *
 * 消费形态与上游一致：`{ id, name, url }` 的 objectURL。每个素材各自记账，
 * 覆盖或清除时只释放自己那份，不误伤仍在使用的其它素材。
 */

interface Result { ok: boolean; error?: string }

interface FoliaAssetState {
  cappellaCustomEmojiImages: CappellaEmojiImage[]
  cappellaCustomAvatarImages: CappellaAvatarImage[]
  isLoadingCappellaCustomEmojiPack: boolean
  isLoadingCappellaCustomAvatarPack: boolean
  monetPortraitImage: MonetPortraitImage | null
  isLoadingMonetPortraitImage: boolean
  /** 莫奈背景的全局覆盖图（与海报人像分开存）。 */
  monetBackgroundImage: MonetBackgroundImage | null
  isLoadingMonetBackgroundImage: boolean

  handleImportCustomCappellaEmojiPack: (files: File[]) => Promise<Result>
  handleClearCustomCappellaEmojiPack: () => Promise<void>
  handleImportCustomCappellaAvatar: (files: File[]) => Promise<Result>
  handleClearCustomCappellaAvatar: () => Promise<void>
  handleUploadMonetPortraitImage: (files: File[]) => Promise<Result>
  handleClearMonetPortraitImage: () => Promise<void>
  handleUploadMonetBackgroundImage: (files: File[]) => Promise<Result>
  handleClearMonetBackgroundImage: () => Promise<void>
}

type Slot = 'emoji' | 'avatar' | 'portrait' | 'background'
const liveUrls: Record<Slot, string[]> = { emoji: [], avatar: [], portrait: [], background: [] }

interface StoredImage {
  id: string
  name: string
  blob: Blob
}

/** 换掉某一类素材的 objectURL：先释放这一类旧的，再建新的。 */
const replaceUrls = <T extends { url: string }>(slot: Slot, items: StoredImage[], build: (entry: StoredImage, url: string) => T): T[] => {
  for (const url of liveUrls[slot]) URL.revokeObjectURL(url)
  const built = items.map((entry) => build(entry, URL.createObjectURL(entry.blob)))
  liveUrls[slot] = built.map((entry) => entry.url)
  return built
}

const withUrl = (entry: StoredImage, url: string) => ({ id: entry.id, name: entry.name, url })

const emojiEntries = (entries: StoredCappellaEmojiImage[]) => replaceUrls('emoji', entries, withUrl)
const avatarEntries = (entries: StoredCappellaAvatarImage[]) => replaceUrls('avatar', entries, withUrl)

const loadEmoji = async () => loadStoredCappellaImagePack('emoji') as Promise<StoredCappellaEmojiImage[]>
const loadAvatar = async () => loadStoredCappellaImagePack('avatar') as Promise<StoredCappellaAvatarImage[]>

const readMonetPortrait = async (): Promise<MonetPortraitImage | null> => {
  const stored = await loadStoredMonetPortraitImage()
  const [image] = replaceUrls('portrait', stored ? [stored] : [], withUrl)
  return image ?? null
}

const readMonetBackground = async (): Promise<MonetBackgroundImage | null> => {
  const stored = await getMonetBackgroundImage()
  const [image] = replaceUrls('background', stored ? [stored] : [], withUrl)
  return image ?? null
}

/** 一次恢复全部四类素材。 */
const hydrate = async () => {
  const [emoji, avatar, portrait, background] = await Promise.all([
    loadEmoji(),
    loadAvatar(),
    readMonetPortrait(),
    readMonetBackground(),
  ])
  useFoliaAssetStore.setState({
    cappellaCustomEmojiImages: emojiEntries(emoji),
    cappellaCustomAvatarImages: avatarEntries(avatar),
    isLoadingCappellaCustomEmojiPack: false,
    isLoadingCappellaCustomAvatarPack: false,
    monetPortraitImage: portrait,
    isLoadingMonetPortraitImage: false,
    monetBackgroundImage: background,
    isLoadingMonetBackgroundImage: false,
  })
}

export const useFoliaAssetStore = create<FoliaAssetState>((set) => ({
  cappellaCustomEmojiImages: [],
  cappellaCustomAvatarImages: [],
  isLoadingCappellaCustomEmojiPack: true,
  isLoadingCappellaCustomAvatarPack: true,
  monetPortraitImage: null,
  isLoadingMonetPortraitImage: true,
  monetBackgroundImage: null,
  isLoadingMonetBackgroundImage: true,

  handleImportCustomCappellaEmojiPack: async (files) => {
    const pack = buildStoredCappellaImagePack(files)
    if (pack.length === 0) return { ok: false, error: '没有受支持的图片文件' }
    await saveStoredCappellaImagePack('emoji', pack)
    set({ cappellaCustomEmojiImages: emojiEntries(pack), isLoadingCappellaCustomEmojiPack: false })
    return { ok: true }
  },
  handleClearCustomCappellaEmojiPack: async () => {
    await clearStoredCappellaImagePack('emoji')
    set({ cappellaCustomEmojiImages: emojiEntries([]), isLoadingCappellaCustomEmojiPack: false })
  },
  handleImportCustomCappellaAvatar: async (files) => {
    const pack = buildStoredCappellaImagePack(files) as unknown as StoredCappellaAvatarImage[]
    if (pack.length === 0) return { ok: false, error: '没有受支持的图片文件' }
    await saveStoredCappellaImagePack('avatar', pack)
    set({ cappellaCustomAvatarImages: avatarEntries(pack), isLoadingCappellaCustomAvatarPack: false })
    return { ok: true }
  },
  handleClearCustomCappellaAvatar: async () => {
    await clearStoredCappellaImagePack('avatar')
    set({ cappellaCustomAvatarImages: avatarEntries([]), isLoadingCappellaCustomAvatarPack: false })
  },

  handleUploadMonetPortraitImage: async (files) => {
    const file = files.find(isSupportedMonetPortraitFile)
    if (!file) return { ok: false, error: '没有受支持的图片文件' }
    await saveStoredMonetPortraitImage(buildStoredMonetPortraitImage(file))
    set({ monetPortraitImage: await readMonetPortrait(), isLoadingMonetPortraitImage: false })
    return { ok: true }
  },
  handleClearMonetPortraitImage: async () => {
    await clearStoredMonetPortraitImage()
    set({ monetPortraitImage: await readMonetPortrait() })
  },
  handleUploadMonetBackgroundImage: async (files) => {
    const file = files.find(isSupportedMonetBackgroundFile)
    if (!file) return { ok: false, error: '没有受支持的图片文件' }
    await saveMonetBackgroundImage(buildStoredMonetBackgroundImage(file))
    set({ monetBackgroundImage: await readMonetBackground(), isLoadingMonetBackgroundImage: false })
    return { ok: true }
  },
  handleClearMonetBackgroundImage: async () => {
    await clearMonetBackgroundImage()
    set({ monetBackgroundImage: await readMonetBackground() })
  },
}))

let hydrating: Promise<void> | null = null
/** 首次读取素材（模块级一次，窗口与舞台共用）。 */
export const ensureFoliaAssets = () => (hydrating ??= hydrate())

// 舞台与窗口读同一份素材：谁先 import 谁触发恢复。
if (typeof window !== 'undefined') ensureFoliaAssets()

/** 释放全部 objectURL（测试与整页卸载）。 */
export const disposeFoliaAssets = () => {
  for (const slot of Object.keys(liveUrls) as Slot[]) {
    for (const url of liveUrls[slot]) URL.revokeObjectURL(url)
    liveUrls[slot] = []
  }
  hydrating = null
}
