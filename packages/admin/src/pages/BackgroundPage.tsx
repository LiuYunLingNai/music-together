import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Icon } from '@iconify/react'
import type { ColorPreset, GlobalBackgroundSettings } from '@music-together/shared'
import { Button, Card, ConfirmDialog, Field, Input, PageLoading, SectionCard, Select, Switch } from '../components/ui'
import { useToast } from '../components/toast'
import { adminApi } from '../lib/api'

const COLOR_PRESETS: Array<{ value: ColorPreset; label: string }> = [
  { value: 'gold', label: '琥珀金' },
  { value: 'ocean', label: '海洋蓝' },
  { value: 'rose', label: '玫瑰粉' },
  { value: 'violet', label: '紫罗兰' },
  { value: 'sunset', label: '落日橙' },
  { value: 'mint', label: '薄荷绿' },
  { value: 'mono', label: '单色灰' },
]

const MAX_UPLOAD_BYTES = 6 * 1024 * 1024

export default function BackgroundPage() {
  const toast = useToast()
  const [settings, setSettings] = useState<GlobalBackgroundSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [imageUrl, setImageUrl] = useState('')
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    adminApi
      .getBackground()
      .then((result) => {
        if (!cancelled) setSettings(result)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const patch = async (patchData: Partial<Omit<GlobalBackgroundSettings, 'backgroundUrl'>>) => {
    if (!settings) return
    const previous = settings
    setSettings({ ...settings, ...patchData })
    try {
      const updated = await adminApi.patchBackground(patchData)
      setSettings(updated)
      toast.show('背景设置已更新', 'success')
    } catch (err) {
      setSettings(previous)
      toast.show(err instanceof Error ? err.message : '保存失败', 'error')
    }
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.show('图片必须小于等于 6MB', 'error')
      return
    }
    setUploading(true)
    try {
      const base64 = await readFileAsDataUrl(file)
      const updated = await adminApi.setBackgroundImage({ image: base64 })
      setSettings(updated)
      toast.show('背景图已上传', 'success')
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '上传失败', 'error')
    } finally {
      setUploading(false)
    }
  }

  const handleImageUrlSubmit = async () => {
    const url = imageUrl.trim()
    if (!url) return
    if (!/^https?:\/\//.test(url)) {
      toast.show('仅支持 HTTP/HTTPS 图片链接', 'error')
      return
    }
    setActionLoading(true)
    try {
      const updated = await adminApi.setBackgroundImage({ imageUrl: url })
      setSettings(updated)
      setImageUrl('')
      toast.show('背景图已设置', 'success')
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '设置失败', 'error')
    } finally {
      setActionLoading(false)
    }
  }

  const handleRemove = async () => {
    setActionLoading(true)
    try {
      const updated = await adminApi.removeBackground()
      setSettings(updated)
      setRemoveConfirmOpen(false)
      toast.show('已移除全局背景', 'success')
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '移除失败', 'error')
    } finally {
      setActionLoading(false)
    }
  }

  if (error) {
    return <Card title="全局背景"><p className="text-sm text-[#ff4d4f] dark:text-[#ff7875]">{error}</p></Card>
  }
  if (!settings) return <PageLoading />

  return (
    <div className="space-y-6">
      {/* 当前背景预览 */}
      <SectionCard label="当前背景">
        {settings.backgroundUrl ? (
          <div className="flex items-center justify-between gap-4">
            <img
              src={settings.backgroundUrl}
              alt="当前全局背景"
              className="h-48 w-full rounded-xl border border-zinc-200 object-cover dark:border-zinc-700"
            />
            <Button variant="danger" onClick={() => setRemoveConfirmOpen(true)}>
              <Icon icon="mdi:image-remove-outline" className="size-4" />
              移除背景
            </Button>
          </div>
        ) : (
          <p className="text-sm text-zinc-400 dark:text-zinc-500">尚未设置全局背景，客户端将使用默认主题。</p>
        )}
      </SectionCard>

      {/* 设置背景 */}
      <SectionCard label="设置背景">
        <div className="space-y-5">
          <Field label="上传图片">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handleFileChange}
            />
            <Button variant="ghost" loading={uploading} onClick={() => fileInputRef.current?.click()}>
              <Icon icon="mdi:upload-outline" className="size-4" />
              选择图片文件
            </Button>
          </Field>

          <Field label="或填写图片链接">
            <div className="flex gap-2">
              <Input
                value={imageUrl}
                onChange={(event) => setImageUrl(event.target.value)}
                placeholder="https://example.com/background.jpg"
              />
              <Button variant="ghost" loading={actionLoading} disabled={!imageUrl.trim()} onClick={handleImageUrlSubmit} className="whitespace-nowrap">
                应用
              </Button>
            </div>
          </Field>

          <p className="text-xs text-zinc-400 dark:text-zinc-500">支持 PNG / JPEG / WebP，不超过 6MB；服务端会压缩为 2560×1440 以内的 WebP</p>
        </div>
      </SectionCard>

      {/* 显示设置 */}
      <SectionCard label="显示设置">
        <div className="space-y-0">
          <ToggleRow
            title="玻璃遮罩"
            description="在背景上叠加磨砂玻璃层，提升前景内容可读性"
            checked={settings.glassOverlay}
            onChange={(next) => patch({ glassOverlay: next })}
          />
          <ToggleRow
            title="自动色调"
            description="根据背景图主色调自动调整界面配色"
            checked={settings.autoTint}
            onChange={(next) => patch({ autoTint: next })}
          />
          <ToggleRow
            title="封面色调联动"
            description="播放时跟随当前歌曲封面的主色调"
            checked={settings.coverAutoTint}
            onChange={(next) => patch({ coverAutoTint: next })}
          />

          <div className="grid max-w-md grid-cols-2 gap-4 pt-6">
            <Field label="色彩预设">
              <Select
                value={settings.colorPreset}
                onChange={(event) => patch({ colorPreset: event.target.value as ColorPreset })}
              >
                {COLOR_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>
                    {preset.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={`背景亮度 ${settings.backgroundBrightness}%`}>
              <input
                type="range"
                min={20}
                max={100}
                value={settings.backgroundBrightness}
                onChange={(event) => patch({ backgroundBrightness: Number(event.target.value) })}
                className="mt-2.5 w-full accent-[#1890ff] dark:accent-[#40a9ff]"
              />
            </Field>
          </div>
        </div>
      </SectionCard>

      <ConfirmDialog
        open={removeConfirmOpen}
        title="移除全局背景"
        danger
        confirmText="移除"
        loading={actionLoading}
        message={<p>确定移除当前全局背景吗？客户端将恢复默认主题背景。</p>}
        onConfirm={handleRemove}
        onClose={() => !actionLoading && setRemoveConfirmOpen(false)}
      />
    </div>
  )
}

function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string
  description: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between border-b border-zinc-100 py-5 last:border-0 dark:border-zinc-800/60">
      <div>
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{title}</p>
        <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">{description}</p>
      </div>
      <Switch checked={checked} onChange={onChange} label={title} />
    </div>
  )
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}
