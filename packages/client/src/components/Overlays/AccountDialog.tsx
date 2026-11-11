import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { PlatformHub } from './Settings/PlatformHub'

interface AccountDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** 音乐账号主页：平台登录、会员状态、个人歌单、推荐与发现，独立于房间设置。 */
export function AccountDialog({ open, onOpenChange }: AccountDialogProps) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="flex h-[85dvh] flex-col gap-0 overflow-hidden p-0 md:h-[75vh] md:max-w-[75vw] lg:max-w-[60vw]">
        <ResponsiveDialogTitle className="shrink-0 px-4 pt-4 text-lg font-semibold sm:px-6">音乐账号</ResponsiveDialogTitle>
        <ResponsiveDialogDescription className="sr-only">
          登录音乐平台账号，浏览个人歌单、平台推荐、雷达歌单、热门歌手与新碟
        </ResponsiveDialogDescription>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-4 sm:p-6 sm:pt-4">
          <PlatformHub />
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
