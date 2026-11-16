import { Button } from '@/components/ui/button'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { usePlatformDiagnostics } from '@/hooks/usePlatformDiagnostics'
import { getPlaybackDiagnostics } from '@/lib/playbackDiagnostics'
import { getMediaCacheStats } from '@/lib/mediaCache'
import { PLATFORM_LABELS } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { useRoomStore } from '@/stores/roomStore'
import type { PlatformDiagnostic } from '@music-together/shared'
import { Activity, AlertTriangle, CheckCircle2, Copy, Loader2, RefreshCw, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

function statusOf(item: PlatformDiagnostic): {
  label: string
  dot: string
  text: string
  Icon: typeof CheckCircle2
} {
  if (!item.loggedIn) {
    return { label: '未登录', dot: 'bg-slate-400', text: 'text-muted-foreground', Icon: AlertTriangle }
  }
  if (item.reachable && item.code === 'ok') {
    return { label: '正常', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', Icon: CheckCircle2 }
  }
  if (item.code === 'expired') {
    return { label: '登录失效', dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', Icon: AlertTriangle }
  }
  return { label: '不可达', dot: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-400', Icon: XCircle }
}

export function PlatformDiagnosticsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const roomId = useRoomStore((state) => state.room?.id)
  const { report, loading, error, run } = usePlatformDiagnostics(roomId)
  // 计数是模块级累计值，打开面板时的渲染就能读到最新值。
  const playbackStats = getPlaybackDiagnostics()
  const [cacheStats, setCacheStats] = useState<{ entries: number; bytes: number } | null>(null)

  useEffect(() => {
    if (open && !report && !loading) void run()
  }, [open, report, loading, run])

  useEffect(() => {
    if (!open) return
    void getMediaCacheStats().then(setCacheStats)
  }, [open])

  const copyReport = async () => {
    if (!report) return
    try {
      await navigator.clipboard.writeText(report.report)
      toast.success('诊断报告已复制')
    } catch {
      toast.error('复制失败，请手动选择文本')
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Activity className="h-4 w-4" />
            </span>
            平台连接诊断
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            检查服务器到各音乐平台的连通性、登录状态与会员等级。报告不包含 cookie、token 或账号密码。
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody className="max-h-[55vh] overflow-y-auto">
          {loading && !report ? (
            <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在检测各平台…
            </div>
          ) : error ? (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-3 text-sm text-rose-600 dark:text-rose-400">
              {error}
            </div>
          ) : report ? (
            <div className="space-y-2">
              {report.platforms.map((item) => {
                const status = statusOf(item)
                const Icon = status.Icon
                return (
                  <div
                    key={item.platform}
                    className="rounded-lg border bg-card/60 px-3 py-2.5 transition-colors hover:bg-muted/30"
                  >
                    <div className="flex items-center gap-2">
                      <span className={cn('h-2 w-2 rounded-full', status.dot)} />
                      <span className="text-sm font-medium">{PLATFORM_LABELS[item.platform]}</span>
                      <span className={cn('inline-flex items-center gap-1 text-xs', status.text)}>
                        <Icon className="h-3.5 w-3.5" />
                        {status.label}
                      </span>
                      <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                        {item.latencyMs == null ? '—' : `${item.latencyMs} ms`}
                      </span>
                    </div>
                    <p className="mt-1.5 pl-4 text-xs leading-relaxed text-muted-foreground">
                      {item.advice}
                      {item.vipLabel ? ` · ${item.vipLabel}` : ''}
                      {item.code && item.code !== 'ok' ? ` · ${item.code}` : ''}
                    </p>
                  </div>
                )
              })}
              <div className="mt-3 rounded-lg border bg-muted/20 px-3 py-2.5">
                <p className="text-sm font-medium">本机播放缓存</p>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <div className="flex justify-between">
                    <dt>内存命中</dt>
                    <dd className="tabular-nums text-foreground">{playbackStats.memoryHits}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>磁盘命中</dt>
                    <dd className="tabular-nums text-foreground">{playbackStats.persistentHits}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>网络取数</dt>
                    <dd className="tabular-nums text-foreground">{playbackStats.networkLoads}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>取数失败</dt>
                    <dd className="tabular-nums text-foreground">{playbackStats.networkFailures}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>预取命中</dt>
                    <dd className="tabular-nums text-foreground">{playbackStats.prefetchHits}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>预取请求</dt>
                    <dd className="tabular-nums text-foreground">{playbackStats.prefetchRequests}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>缓存写入</dt>
                    <dd className="tabular-nums text-foreground">{playbackStats.cacheWrites}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>写入跳过</dt>
                    <dd className="tabular-nums text-foreground">{playbackStats.cacheWriteSkips}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Blob 预热</dt>
                    <dd className="tabular-nums text-foreground">{playbackStats.blobPreloads}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>磁盘占用</dt>
                    <dd className="tabular-nums text-foreground">
                      {cacheStats ? `${cacheStats.entries} 首 · ${(cacheStats.bytes / 1024 / 1024).toFixed(1)} MB` : '—'}
                    </dd>
                  </div>
                </dl>
              </div>
              <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
                提示：诊断只验证账号与平台接口；播放地址仍受版权、地区与音质权限影响。
              </p>
            </div>
          ) : null}
        </ResponsiveDialogBody>

        <ResponsiveDialogFooter className="flex-row justify-between gap-2 sm:justify-between">
          <Button variant="outline" size="sm" onClick={() => void copyReport()} disabled={!report}>
            <Copy className="mr-1.5 h-3.5 w-3.5" />
            复制报告
          </Button>
          <Button size="sm" onClick={() => void run()} disabled={loading}>
            {loading ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            重新检测
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
