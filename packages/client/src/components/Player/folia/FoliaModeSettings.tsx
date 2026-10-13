import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useRef, useState } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'
import { FOLIA_MODE_CONTROLS, getTuningPath, setTuningPath } from '@/lib/foliaTuningSchema'
import { useCappellaCustomImages } from './stage/cappellaAssets'
import { useMonetPortraitImage } from './stage/monetPortraitAssets'
import { resolveFoliaTuning } from './stage/foliaTunings'
import type { FoliaModeId } from './registry'

/** cappella 的自定义表情/头像导入区（上游 settingsPanels 的 cappella 分支语义）。 */
function CappellaAssetImport() {
  const {
    emojiImages,
    avatarImages,
    isLoadingEmoji,
    isLoadingAvatar,
    hasEmojiPack,
    hasAvatarPack,
    importEmojiPack,
    clearEmojiPack,
    importAvatarPack,
    clearAvatarPack,
  } = useCappellaCustomImages()
  const emojiInputRef = useRef<HTMLInputElement>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'emoji' | 'avatar' | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const row = 'flex min-h-9 items-center justify-between gap-3 text-xs'

  const runImport = async (kind: 'emoji' | 'avatar', files: File[]) => {
    if (files.length === 0) return
    setBusy(kind)
    setFeedback(null)
    try {
      const result = kind === 'emoji' ? await importEmojiPack(files) : await importAvatarPack(files)
      setFeedback(result.ok ? '导入成功' : (result.error ?? '导入失败'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-2 rounded-xl border p-3">
      <p className="text-xs font-medium">自定义素材</p>
      <div className={row}>
        <span>表情包{hasEmojiPack ? `（${emojiImages.length} 张）` : ''}</span>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null || isLoadingEmoji}
            onClick={() => emojiInputRef.current?.click()}
          >
            {busy === 'emoji' ? '导入中…' : '导入'}
          </Button>
          {hasEmojiPack && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => {
                setFeedback(null)
                void clearEmojiPack().then(() => setFeedback('已清除表情包'))
              }}
            >
              清除
            </Button>
          )}
        </div>
      </div>
      <div className={row}>
        <span>头像{hasAvatarPack ? `（${avatarImages.length} 张）` : ''}</span>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null || isLoadingAvatar}
            onClick={() => avatarInputRef.current?.click()}
          >
            {busy === 'avatar' ? '导入中…' : '导入'}
          </Button>
          {hasAvatarPack && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => {
                setFeedback(null)
                void clearAvatarPack().then(() => setFeedback('已清除头像'))
              }}
            >
              清除
            </Button>
          )}
        </div>
      </div>
      <input
        ref={emojiInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          void runImport('emoji', files)
        }}
      />
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          void runImport('avatar', files)
        }}
      />
      {feedback && <p className="text-xs text-muted-foreground">{feedback}</p>}
      <p className="text-xs text-muted-foreground">支持 png / jpg / gif / webp / svg，多选；保存在本机浏览器。</p>
    </div>
  )
}

/** monet 的自定义封面上传区（上游 MonetSettingsPanel 的 portrait 上传分支语义）。 */
function MonetPortraitUpload() {
  const {
    monetPortraitImage,
    isLoadingMonetPortraitImage,
    uploadMonetPortraitImage,
    clearMonetPortraitImage,
  } = useMonetPortraitImage()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  return (
    <div className="space-y-2 rounded-xl border p-3">
      <p className="text-xs font-medium">自定义封面</p>
      <div className="flex min-h-9 items-center justify-between gap-3 text-xs">
        <span className="truncate">{monetPortraitImage ? monetPortraitImage.name : '未上传'}</span>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="outline"
            disabled={busy || isLoadingMonetPortraitImage}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? '上传中…' : '上传'}
          </Button>
          {monetPortraitImage && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setFeedback(null)
                void clearMonetPortraitImage().then(() => setFeedback('已清除封面'))
              }}
            >
              清除
            </Button>
          )}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.gif,.webp,.svg,image/*"
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          if (files.length === 0) return
          setBusy(true)
          setFeedback(null)
          void uploadMonetPortraitImage(files)
            .then((result) => setFeedback(result.ok ? '上传成功' : (result.error ?? '上传失败')))
            .finally(() => setBusy(false))
        }}
      />
      {feedback && <p className="text-xs text-muted-foreground">{feedback}</p>}
      <p className="text-xs text-muted-foreground">上传后可在下方把「封面来源」切到 custom 使用；保存在本机浏览器。</p>
    </div>
  )
}

export function FoliaModeSettings({ mode }: { mode: FoliaModeId }) {
  const tunings = useSettingsStore((s) => s.foliaSettings.tunings)
  const update = useSettingsStore((s) => s.setFoliaSettings)
  const tuning = resolveFoliaTuning(mode, tunings)
  // 有控件的键才算"用户可见"；嵌套路径（geometryVisibility.* 等）经 getTuningPath 读取。
  const controls = FOLIA_MODE_CONTROLS[mode].filter((control) => getTuningPath(tuning, control.key) !== undefined)
  const set = (key: string, value: unknown) => {
    const patch: Record<string, unknown> = { ...(tunings[mode] ?? {}) }
    setTuningPath(patch, key, value)
    update({ tunings: { ...tunings, [mode]: patch } })
  }
  return (
    <details className="rounded-xl border p-3">
      <summary className="cursor-pointer text-xs font-medium">动画参数</summary>
      <div className="mt-4 space-y-4">
        {mode === 'cappella' && <CappellaAssetImport />}
        {mode === 'monet' && <MonetPortraitUpload />}
        {controls.map((control) => {
          const value = getTuningPath(tuning, control.key)
          return (
            <div key={control.key} className="space-y-2 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span>{control.label}</span>
                {typeof value === 'boolean' ? (
                  <Switch
                    aria-label={control.label}
                    checked={Boolean(value)}
                    onCheckedChange={(next) => set(control.key, next)}
                  />
                ) : control.options ? (
                  <Select value={String(value)} onValueChange={(next) => set(control.key, next)}>
                    <SelectTrigger aria-label={control.label} className="h-8 w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {control.options.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="tabular-nums text-muted-foreground">{Number(value).toFixed(2)}</span>
                )}
              </div>
              {typeof value === 'number' && (
                <Slider
                  aria-label={control.label}
                  value={[Number(value)]}
                  min={control.min}
                  max={control.max}
                  step={control.step}
                  onValueChange={([next]) => set(control.key, next)}
                />
              )}
            </div>
          )
        })}
        {controls.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => update({ tunings: { ...tunings, [mode]: {} } })}>
            重置此动画
          </Button>
        )}
      </div>
    </details>
  )
}
