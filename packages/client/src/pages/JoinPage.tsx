import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Smartphone, Globe2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GlobalBackground } from '@/components/GlobalBackground'
import { buildRoomAppLink, buildRoomBrowserUrl } from '@/lib/appLink'
import { SERVER_URL } from '@/lib/config'

export default function JoinPage() {
  const [searchParams] = useSearchParams()
  const roomId = searchParams.get('ROMMid')?.trim() ?? ''
  const currentServerUrl = typeof window === 'undefined'
    ? SERVER_URL
    : new URL('.', window.location.href).toString().replace(/\/$/, '')
  const serverUrl = searchParams.get('server')?.trim() || currentServerUrl
  const [redirected, setRedirected] = useState(false)
  const appUrl = useMemo(() => (roomId ? buildRoomAppLink(roomId, serverUrl) : ''), [roomId, serverUrl])
  const webUrl = useMemo(() => (roomId ? buildRoomBrowserUrl(roomId, serverUrl) : '/'), [roomId, serverUrl])

  useEffect(() => {
    if (!appUrl) return
    const timer = window.setTimeout(() => {
      window.location.href = appUrl
      setRedirected(true)
    }, 120)
    return () => window.clearTimeout(timer)
  }, [appUrl])

  const openApp = () => {
    if (appUrl) window.location.href = appUrl
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      <GlobalBackground />
      <section className="relative z-10 flex w-full max-w-md flex-col items-center gap-5 rounded-2xl border border-border/60 bg-background/80 p-7 text-center shadow-xl backdrop-blur-xl">
        <Smartphone className="h-10 w-10 text-primary" aria-hidden="true" />
        <h1 className="text-xl font-semibold">打开 Music Together</h1>
        {roomId ? (
          <p className="text-sm text-muted-foreground">正在打开房间 {roomId}。如果没有自动唤起应用，请手动选择打开方式。</p>
        ) : (
          <p className="text-sm text-muted-foreground">分享链接缺少房间号，请返回并重新获取链接。</p>
        )}
        {roomId && (
          <div className="flex w-full flex-col gap-2">
            <Button className="w-full" onClick={openApp}>
              <Smartphone />
              在 App 中打开
            </Button>
            <Button asChild variant="outline" className="w-full">
              <a href={webUrl}>
                <Globe2 />
                使用网页版加入
              </a>
            </Button>
          </div>
        )}
        {redirected && roomId && <p className="text-xs text-muted-foreground">若未跳转，请点击上方按钮。</p>}
      </section>
    </main>
  )
}
