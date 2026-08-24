import { Check, Copy, Loader2, QrCode, RefreshCw, Share2, Smartphone } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { buildRoomAppLink, buildRoomWebUrl, isAndroidUserAgent } from '@/lib/appLink'
import { SERVER_URL } from '@/lib/config'
import { useRoomStore } from '@/stores/roomStore'

interface RoomShareDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RoomShareDialog({ open, onOpenChange }: RoomShareDialogProps) {
  const roomId = useRoomStore((state) => state.room?.id)
  const roomName = useRoomStore((state) => state.room?.name)
  const [copied, setCopied] = useState(false)
  const [qrimg, setQrimg] = useState<string | null>(null)
  const [qrLoading, setQrLoading] = useState(false)
  const [qrError, setQrError] = useState<string | null>(null)
  const [qrReloadKey, setQrReloadKey] = useState(0)

  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent
  const isAndroid = isAndroidUserAgent(userAgent)
  const shareUrl = useMemo(() => (roomId ? buildRoomWebUrl(roomId, SERVER_URL) : ''), [roomId])
  const canSystemShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  useEffect(() => {
    if (!open || !roomId || !shareUrl) return

    const controller = new AbortController()
    queueMicrotask(() => {
      if (controller.signal.aborted) return
      setCopied(false)
      setQrLoading(true)
      setQrError(null)
      setQrimg(null)

      const params = new URLSearchParams({ link: shareUrl })
      void fetch(`${SERVER_URL}/api/rooms/${encodeURIComponent(roomId)}/share/qr?${params}`, {
        credentials: 'include',
        signal: controller.signal,
      })
        .then(async (response) => {
          const body = (await response.json().catch(() => null)) as { qrimg?: string; error?: string } | null
          if (!response.ok || !body?.qrimg) throw new Error(body?.error ?? '二维码生成失败')
          setQrimg(body.qrimg)
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          setQrError(error instanceof Error ? error.message : '二维码生成失败')
        })
        .finally(() => {
          if (!controller.signal.aborted) setQrLoading(false)
        })
    })

    return () => controller.abort()
  }, [open, roomId, shareUrl, qrReloadKey])

  const copyLink = useCallback(async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      toast.success('房间链接已复制')
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('复制失败，请手动复制链接')
    }
  }, [shareUrl])

  const systemShare = useCallback(async () => {
    if (!shareUrl || !canSystemShare) return
    try {
      await navigator.share({
        title: roomName ? `一起听：${roomName}` : '一起听音乐',
        text: roomId ? `加入房间 ${roomId}，一起听音乐` : '加入房间，一起听音乐',
        url: shareUrl,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      toast.error('分享失败，请改用复制链接')
    }
  }, [shareUrl, canSystemShare, roomName, roomId])

  const openInApp = useCallback(() => {
    if (!roomId) return
    // The public HTTPS URL is what users share. The landing page explicitly
    // redirects to this scheme so Android can dispatch the registered Intent.
    window.location.href = buildRoomAppLink(roomId, SERVER_URL)
  }, [roomId])

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>分享房间</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="line-clamp-2">
            {roomId ? `${roomName ?? '房间'} · ${roomId}` : '暂无房间'}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
              {shareUrl || '—'}
            </span>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={copyLink} aria-label="复制房间链接">
              {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>

          <div className="flex flex-col items-center gap-2">
            {qrLoading ? (
              <div className="flex h-40 w-40 items-center justify-center rounded-lg border border-border/60" role="status" aria-label="正在生成二维码">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : qrError ? (
              <div className="flex h-40 w-40 flex-col items-center justify-center gap-2 rounded-lg border border-border/60 px-3 text-center">
                <QrCode className="h-5 w-5 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">{qrError}</p>
                <Button variant="outline" size="sm" onClick={() => setQrReloadKey((key) => key + 1)}>
                  <RefreshCw />
                  重试
                </Button>
              </div>
            ) : qrimg ? (
              <img
                src={qrimg}
                alt="房间邀请二维码"
                className="h-40 w-40 rounded-lg border border-border/60 bg-white p-1"
              />
            ) : null}
            <p className="text-xs text-muted-foreground">扫码加入房间</p>
          </div>

          <div className="flex flex-col gap-2">
            {canSystemShare && (
              <Button variant="outline" className="w-full" onClick={systemShare}>
                <Share2 />
                系统分享
              </Button>
            )}
            {isAndroid && (
              <Button variant="outline" className="w-full" onClick={openInApp}>
                <Smartphone />
                在 App 中打开
              </Button>
            )}
          </div>
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
