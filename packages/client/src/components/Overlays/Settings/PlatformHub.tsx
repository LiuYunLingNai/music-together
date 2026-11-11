import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/hooks/useAuth'
import { usePlaylist } from '@/hooks/usePlaylist'
import { PLATFORM_SHORT_LABELS, PLATFORM_COLORS, getPlatformStatus, getMyPlatformStatus } from '@/lib/platform'
import { storage } from '@/lib/storage'
import { useRecommendations } from '@/hooks/useRecommendations'
import { useRoomStore } from '@/stores/roomStore'
import type { MusicSource, Playlist, Track } from '@music-together/shared'
import { useState, useCallback, useEffect, useMemo } from 'react'
import { Activity } from 'lucide-react'
import { LoginSection } from './LoginSection'
import { ManualCookieDialog } from './ManualCookieDialog'
import { QrLoginDialog } from './QrLoginDialog'
import { PlaylistDetail } from './PlaylistDetail'
import { PlaylistSection } from './PlaylistSection'
import { PlatformDiagnosticsDialog } from './PlatformDiagnosticsDialog'
import { AccountDiscover } from './AccountDiscover'

type ViewState =
  | { type: 'list' }
  | { type: 'detail'; playlist: Playlist; source: MusicSource; tracks?: Track[] }

const noop = () => undefined

export function PlatformHub() {
  const auth = useAuth()
  const playlist = usePlaylist()

  const [activePlatform, setActivePlatform] = useState<MusicSource>('netease')
  const [qrDialogOpen, setQrDialogOpen] = useState(false)
  const [cookieDialogOpen, setCookieDialogOpen] = useState(false)
  const [cookieDialogPlatform, setCookieDialogPlatform] = useState<MusicSource>('netease')
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [viewState, setViewState] = useState<ViewState>({ type: 'list' })
  const roomId = useRoomStore((s) => s.room?.id)
  const recommendations = useRecommendations(roomId)
  const { load: loadRecommendations } = recommendations

  // 概念版账户入口放在“酷狗”标签内，避免额外增加一个平台板块。
  const platforms: MusicSource[] = ['netease', 'tencent', 'kugou', 'bilibili']
  const allAccountPlatforms: MusicSource[] = [...platforms, 'kugou_concept']

  // Show "verifying…" only while waiting for the first AUTH_MY_STATUS response.
  // Once the server responds, use the actual status — no more guessing from localStorage.
  const verifyingPlatforms = useMemo(() => {
    if (auth.statusLoaded) return {} // Server has responded — use actual myStatus
    const result: Partial<Record<MusicSource, boolean>> = {}
    for (const p of allAccountPlatforms) {
      result[p] = storage.hasAuthCookie(p)
    }
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.statusLoaded, auth.myStatus])

  const handleQrLogin = useCallback(
    (platform: MusicSource = activePlatform) => {
      auth.requestQrCode(platform)
      // 同机访问 tencent 时探测本机已登录的 QQ 客户端，提供一键登录入口
      if (platform === 'tencent') auth.probeLocalQq()
      setQrDialogOpen(true)
    },
    [auth, activePlatform],
  )

  const handleCookieLogin = useCallback((platform: MusicSource) => {
    setCookieDialogPlatform(platform)
    setCookieDialogOpen(true)
  }, [])

  const handleCookieSubmit = useCallback(
    (cookie: string) => {
      auth.setCookie(cookieDialogPlatform, cookie)
      setCookieDialogOpen(false)
    },
    [auth, cookieDialogPlatform],
  )

  const handleSelectPlaylist = useCallback(
    (pl: Playlist, type: 'playlist' | 'album' = 'playlist') => {
      setViewState({ type: 'detail', playlist: pl, source: pl.source })
      playlist.fetchPlaylistTracks(pl.source, pl.id, pl.trackCount, type)
    },
    [playlist],
  )

  const handleOpenTracks = useCallback((title: string, tracks: Track[]) => {
    const first = tracks[0]
    setViewState({
      type: 'detail',
      source: first?.source ?? 'netease',
      tracks,
      playlist: {
        id: `feed:${title}`,
        name: title,
        cover: first?.cover ?? '',
        thumbnailCover: first?.thumbnailCover,
        trackCount: tracks.length,
        source: first?.source ?? 'netease',
      },
    })
  }, [])

  const loggedInKey = auth.statusLoaded
    ? allAccountPlatforms.filter((p) => getMyPlatformStatus(p, auth.myStatus)?.loggedIn).join(',')
    : null
  useEffect(() => {
    if (loggedInKey === null) return
    const frame = requestAnimationFrame(loadRecommendations)
    return () => cancelAnimationFrame(frame)
  }, [loggedInKey, loadRecommendations])

  const recommendationFor = (p: MusicSource) => recommendations.recommendations.find((item) => item.platform === p)

  const handleBack = useCallback(() => {
    setViewState({ type: 'list' })
  }, [])

  // Detail view — flex-1 min-h-0 so PlaylistDetail gets proper height for virtual scroll
  if (viewState.type === 'detail') {
    const staticTracks = viewState.tracks
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <PlaylistDetail
            playlist={viewState.playlist}
            tracks={staticTracks ?? playlist.playlistTracks}
            loading={staticTracks ? false : playlist.tracksLoading}
            loadingMore={staticTracks ? false : playlist.loadingMore}
            hasMore={staticTracks ? false : playlist.hasMoreTracks}
            total={staticTracks ? staticTracks.length : playlist.playlistTotal}
            onBack={handleBack}
            onAddTrack={playlist.addTrackToQueue}
            onInsertAfterCurrent={playlist.insertTrackAfterCurrent}
            onAddAll={playlist.addBatchToQueue}
            onLoadAll={staticTracks ? async () => staticTracks : playlist.fetchAllPlaylistTracks}
            onLoadMore={staticTracks ? noop : playlist.loadMoreTracks}
          />
        </div>
      </div>
    )
  }

  // List view — wrapped in ScrollArea since login + playlists may overflow
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="shrink-0">
        <div className="mb-3 flex items-start justify-between gap-3 pr-8">
          <div>
            <h3 className="text-base font-semibold">平台账号 & 歌单</h3>
            <p className="text-muted-foreground text-xs">登录后可浏览个人歌单、平台推荐与发现内容。</p>
          </div>
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => setDiagnosticsOpen(true)}>
            <Activity className="mr-1.5 h-3.5 w-3.5" />
            连接诊断
          </Button>
        </div>
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        <Tabs
          value={activePlatform}
          onValueChange={(v) => setActivePlatform(v as MusicSource)}
          className="overflow-hidden"
        >
          <TabsList className="grid w-full grid-cols-4">
            {platforms.map((p) => (
              <TabsTrigger key={p} value={p} className={PLATFORM_COLORS[p]}>
                {PLATFORM_SHORT_LABELS[p]}
              </TabsTrigger>
            ))}
          </TabsList>

          {platforms.map((p) => (
            <TabsContent key={p} value={p} className="mt-4 space-y-4">
              {/* Login section */}
              <LoginSection
                platform={p}
                status={getPlatformStatus(p, auth.platformStatus)}
                myStatus={getMyPlatformStatus(p, auth.myStatus)}
                isVerifying={verifyingPlatforms[p]}
                onQrLogin={() => handleQrLogin(p)}
                onCookieLogin={() => handleCookieLogin(p)}
                onLogout={() => auth.logout(p)}
                onToggleSharing={(share) => auth.setSharing(p, share)}
                onToggleReporting={(report) => auth.setReporting(p, report)}
                compactLabel={p === 'kugou' ? '标准版' : undefined}
              />

              {p === 'kugou' && (
                <LoginSection
                  platform="kugou_concept"
                  status={getPlatformStatus('kugou_concept', auth.platformStatus)}
                  myStatus={getMyPlatformStatus('kugou_concept', auth.myStatus)}
                  isVerifying={verifyingPlatforms.kugou_concept}
                  onQrLogin={() => handleQrLogin('kugou_concept')}
                  onCookieLogin={() => handleCookieLogin('kugou_concept')}
                  onLogout={() => auth.logout('kugou_concept')}
                  onToggleSharing={(share) => auth.setSharing('kugou_concept', share)}
                  compactLabel="概念版"
                  onClaimConceptVip={auth.claimKugouConceptVip}
                  isClaimingConceptVip={auth.isClaimingKugouConceptVip}
                />
              )}

              <Separator />

              {/* Playlist section */}
              <PlaylistSection
                platform={p}
                myStatus={getMyPlatformStatus(p, auth.myStatus)}
                playlists={playlist.myPlaylists[p]}
                loading={playlist.playlistsLoading[p]}
                loaded={Boolean(playlist.playlistsLoaded[p])}
                onFetchMyPlaylists={() => playlist.fetchMyPlaylists(p)}
                onSelectPlaylist={handleSelectPlaylist}
              />

              {p === 'kugou' && getMyPlatformStatus('kugou_concept', auth.myStatus)?.loggedIn && (
                <>
                  <Separator />
                  <PlaylistSection
                    platform="kugou_concept"
                    myStatus={getMyPlatformStatus('kugou_concept', auth.myStatus)}
                    playlists={playlist.myPlaylists.kugou_concept}
                    loading={playlist.playlistsLoading.kugou_concept}
                    loaded={Boolean(playlist.playlistsLoaded.kugou_concept)}
                    onFetchMyPlaylists={() => playlist.fetchMyPlaylists('kugou_concept')}
                    onSelectPlaylist={handleSelectPlaylist}
                    title="概念版歌单"
                  />
                </>
              )}

              <Separator />

              <AccountDiscover
                platform={p}
                active={activePlatform === p}
                loggedIn={Boolean(getMyPlatformStatus(p, auth.myStatus)?.loggedIn)}
                recommendation={recommendationFor(p)}
                recommendationsLoading={recommendations.loading}
                onReloadRecommendations={loadRecommendations}
                onOpenPlaylist={handleSelectPlaylist}
                onOpenTracks={handleOpenTracks}
              />

              {p === 'kugou' && getMyPlatformStatus('kugou_concept', auth.myStatus)?.loggedIn && (
                <AccountDiscover
                  platform="kugou_concept"
                  active={false}
                  loggedIn
                  recommendation={recommendationFor('kugou_concept')}
                  recommendationsLoading={recommendations.loading}
                  onReloadRecommendations={loadRecommendations}
                  onOpenPlaylist={handleSelectPlaylist}
                  onOpenTracks={handleOpenTracks}
                  titlePrefix="概念版 · "
                />
              )}
            </TabsContent>
          ))}
        </Tabs>
      </div>

      {/* QR Dialog */}
      <QrLoginDialog
        open={qrDialogOpen}
        onOpenChange={(open: boolean) => {
          setQrDialogOpen(open)
          if (!open) {
            auth.resetQr()
            auth.resetLocalQq()
          }
        }}
        platform={auth.qrPlatform}
        qrData={auth.qrData}
        qrStatus={auth.qrStatus}
        isLoading={auth.isQrLoading}
        onRefresh={() => auth.requestQrCode(auth.qrPlatform)}
        onCheckStatus={(key: string) => auth.checkQrStatus(key)}
        savedAccount={auth.savedAccount}
        isQuickLoggingIn={auth.isQuickLoggingIn}
        onQuickLogin={auth.quickLogin}
        localQqAccounts={auth.localQqAccounts}
        localQqAvailable={auth.localQqAvailable}
        isLocalQqLoggingIn={auth.isLocalQqLoggingIn}
        onLoginLocalQq={auth.loginWithLocalQq}
      />

      {/* Manual Cookie Dialog */}
      <ManualCookieDialog
        open={cookieDialogOpen}
        onOpenChange={setCookieDialogOpen}
        platform={cookieDialogPlatform}
        onSubmit={handleCookieSubmit}
      />

      <PlatformDiagnosticsDialog open={diagnosticsOpen} onOpenChange={setDiagnosticsOpen} />
    </div>
  )
}
