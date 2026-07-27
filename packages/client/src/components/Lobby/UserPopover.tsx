import { useEffect, useState } from 'react'
import { Camera, CircleUser, Loader2 } from 'lucide-react'
import { LIMITS } from '@music-together/shared'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { resolveAvatarUrl, updateCurrentNickname, uploadCurrentAvatar } from '@/lib/profileApi'
import { storage } from '@/lib/storage'
import { useAccountStore } from '@/stores/accountStore'
import { toast } from 'sonner'
import { AccountAccessControls, AccountIdEditor } from '@/components/Overlays/Settings/AccountSection'

export function UserPopover() {
  const profile = useAccountStore((state) => state.profile)
  const [nickname, setNickname] = useState(profile?.nickname || storage.getNickname())
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    setNickname(profile?.nickname || storage.getNickname())
  }, [profile?.nickname])

  const handleSave = async () => {
    const trimmed = nickname.trim()
    if (!trimmed || trimmed === profile?.nickname) return
    setSaving(true)
    try {
      await updateCurrentNickname(trimmed)
      toast.success('昵称已保存到服务器')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '昵称保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleAvatar = async (file?: File) => {
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      toast.error('仅支持 PNG、JPEG 和 WebP 图片')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('头像不能超过 5MB')
      return
    }

    setUploading(true)
    try {
      const image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('读取图片失败'))
        reader.readAsDataURL(file)
      })
      await uploadCurrentAvatar(image)
      toast.success('头像已保存到服务器')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '头像上传失败')
    } finally {
      setUploading(false)
    }
  }

  const displayName = profile?.nickname || storage.getNickname()
  const initial = displayName?.charAt(0).toUpperCase()

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full border border-border/60"
          aria-label="个人资料"
        >
          {profile?.avatarUrl ? (
            <Avatar className="h-8 w-8">
              <AvatarImage src={resolveAvatarUrl(profile.avatarUrl)} alt="" />
              <AvatarFallback>{initial}</AvatarFallback>
            </Avatar>
          ) : initial ? (
            <span className="text-sm font-semibold">{initial}</span>
          ) : (
            <CircleUser className="h-5 w-5" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar size="lg">
              <AvatarImage src={resolveAvatarUrl(profile?.avatarUrl)} alt="" />
              <AvatarFallback>{initial || '?'}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{displayName || '尚未设置昵称'}</p>
              <div className="flex items-center gap-2">
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {profile?.id || '保存昵称后生成账号 ID'}
                </p>
                {profile?.role === 'admin' && (
                  <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                    管理员
                  </Badge>
                )}
              </div>
            </div>
            {profile && (
              <label>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={(event) => void handleAvatar(event.currentTarget.files?.[0])}
                />
                <Button asChild variant="ghost" size="icon" className="h-8 w-8" aria-label="上传头像">
                  <span>
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                  </span>
                </Button>
              </label>
            )}
          </div>

          <Separator />

          <div className="space-y-1.5">
            <label htmlFor="profile-nickname" className="text-xs font-medium text-muted-foreground">
              昵称
            </label>
            <div className="flex gap-2">
              <Input
                id="profile-nickname"
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && void handleSave()}
                maxLength={LIMITS.NICKNAME_MAX_LENGTH}
                className="h-8 text-sm"
              />
              <Button size="sm" className="h-8" onClick={() => void handleSave()} disabled={saving || !nickname.trim()}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : '保存'}
              </Button>
            </div>
          </div>

          {profile ? (
            <>
              <Separator />
              <AccountIdEditor compact onComplete={() => setOpen(false)} />

              <Separator />
              <AccountAccessControls compact onComplete={() => setOpen(false)} />
            </>
          ) : (
            <p className="text-xs text-muted-foreground">保存昵称后将生成账号 ID，并可设置密码保护账号。</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
