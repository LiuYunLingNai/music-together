import { ActionCards } from '@/components/Lobby/ActionCards'
import { HeroSection } from '@/components/Lobby/HeroSection'
import { RoomListSection } from '@/components/Lobby/RoomListSection'
import { UserPopover } from '@/components/Lobby/UserPopover'
import { GlobalBackground } from '@/components/GlobalBackground'
import { Separator } from '@/components/ui/separator'
import { useLobby } from '@/hooks/useLobby'
import { unlockAudio } from '@/lib/audioUnlock'
import { ACTION_LOADING_TIMEOUT_MS } from '@/lib/constants'
import { storage } from '@/lib/storage'
import { useSocketContext } from '@/providers/socket-context'
import { useRoomStore } from '@/stores/roomStore'
import { useChatStore } from '@/stores/chatStore'
import { useVersionCheck } from '@/hooks/useVersionCheck'
import { EVENTS, ERROR_CODE, type RoomListItem, type RoomState } from '@music-together/shared'
import { Github, Headphones } from 'lucide-react'
import { motion } from 'motion/react'
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAccountStore } from '@/stores/accountStore'
import { fetchCurrentProfile, updateCurrentNickname } from '@/lib/profileApi'

const loadCreateRoomDialog = () => import('@/components/Lobby/CreateRoomDialog')
const loadNicknameDialog = () => import('@/components/Lobby/NicknameDialog')
const loadPasswordDialog = () => import('@/components/Lobby/PasswordDialog')

const CreateRoomDialog = lazy(() =>
  loadCreateRoomDialog().then((module) => ({ default: module.CreateRoomDialog })),
)
const NicknameDialog = lazy(() =>
  loadNicknameDialog().then((module) => ({ default: module.NicknameDialog })),
)
const PasswordDialog = lazy(() =>
  loadPasswordDialog().then((module) => ({ default: module.PasswordDialog })),
)

export default function HomePage() {
  const navigate = useNavigate()
  const { socket } = useSocketContext()
  const { rooms, isLoading, createRoom, joinRoom } = useLobby()
  const hasUpdate = useVersionCheck()

  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [passwordDialog, setPasswordDialog] = useState<{ open: boolean; room: RoomListItem | null }>({
    open: false,
    room: null,
  })
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const actionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [directRoomId, setDirectRoomId] = useState('')
  const [nicknameDialogOpen, setNicknameDialogOpen] = useState(false)
  const [createDialogMounted, setCreateDialogMounted] = useState(false)
  const [nicknameDialogMounted, setNicknameDialogMounted] = useState(false)
  const [passwordDialogMounted, setPasswordDialogMounted] = useState(false)
  const glowFrameRef = useRef<number | null>(null)
  const glowTargetRef = useRef<HTMLElement | null>(null)
  const glowPointerRef = useRef({ x: 0, y: 0 })

  // Keep dialogs out of the critical bundle, then warm their tiny chunks once
  // the first paint and urgent browser work have completed.
  useEffect(() => {
    const preload = () => {
      void Promise.all([loadCreateRoomDialog(), loadNicknameDialog(), loadPasswordDialog()]).catch(() => {
        // A transient chunk preload failure must not become an unhandled rejection.
        // React.lazy will retry the import if the user opens the dialog later.
      })
    }
    if ('requestIdleCallback' in window) {
      const idleId = window.requestIdleCallback(preload, { timeout: 1_500 })
      return () => window.cancelIdleCallback(idleId)
    }
    const timer = setTimeout(preload, 800)
    return () => clearTimeout(timer)
  }, [])

  const flushCardGlow = useCallback(() => {
    glowFrameRef.current = null
    const card = glowTargetRef.current
    if (!card) return
    const bounds = card.getBoundingClientRect()
    card.style.setProperty('--mt-card-glow-x', `${glowPointerRef.current.x - bounds.left}px`)
    card.style.setProperty('--mt-card-glow-y', `${glowPointerRef.current.y - bounds.top}px`)
  }, [])

  const handleCardGlow = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType !== 'mouse') return
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.mt-card') : null
      glowTargetRef.current = target
      glowPointerRef.current = { x: event.clientX, y: event.clientY }
      if (target && glowFrameRef.current === null) glowFrameRef.current = requestAnimationFrame(flushCardGlow)
    },
    [flushCardGlow],
  )

  const clearCardGlow = useCallback(() => {
    glowTargetRef.current = null
    if (glowFrameRef.current !== null) {
      cancelAnimationFrame(glowFrameRef.current)
      glowFrameRef.current = null
    }
  }, [])

  useEffect(() => clearCardGlow, [clearCardGlow])

  // Stores the pending join action while waiting for nickname input
  const pendingJoinRef = useRef<{ type: 'room'; room: RoomListItem } | { type: 'direct'; roomId: string } | null>(null)

  const lastJoinedRoomIdRef = useRef('')

  const setRoom = useRoomStore((s) => s.setRoom)
  const accountProfile = useAccountStore((state) => state.profile)
  const savedNickname = accountProfile?.nickname || storage.getNickname()

  const onRoomError = useEffectEvent((error: { code: string; message: string }) => {
    setActionLoading(false)
    if (error.code !== ERROR_CODE.WRONG_PASSWORD) {
      toast.error(error.message)
      return
    }

    if (passwordDialog.open) {
      setPasswordError('密码错误，请重试')
      return
    }

    const targetRoomId = lastJoinedRoomIdRef.current || directRoomId.trim()
    if (!targetRoomId) {
      toast.error(error.message)
      return
    }

    setPasswordDialogMounted(true)
    setPasswordDialog({
      open: true,
      room: {
        id: targetRoomId,
        name: targetRoomId,
        hasPassword: true,
        permanent: false,
        userCount: 0,
        currentTrackTitle: null,
        currentTrackArtist: null,
      },
    })
    setPasswordError(null)
  })

  // Safety timeout: reset actionLoading after 15s to prevent stuck button
  useEffect(() => {
    if (actionLoading) {
      actionTimeoutRef.current = setTimeout(() => {
        setActionLoading(false)
        toast.error('操作超时，请重试')
      }, ACTION_LOADING_TIMEOUT_MS)
    } else {
      if (actionTimeoutRef.current) {
        clearTimeout(actionTimeoutRef.current)
        actionTimeoutRef.current = null
      }
    }
    return () => {
      if (actionTimeoutRef.current) {
        clearTimeout(actionTimeoutRef.current)
        actionTimeoutRef.current = null
      }
    }
  }, [actionLoading])

  // Listen for room created / room state / chat history events for navigation
  useEffect(() => {
    const onCreated = (data: { roomId: string; userId: string }) => {
      // currentUser will be auto-derived when onState fires and calls setRoom
      storage.setUserId(data.userId)
      setActionLoading(false)
      setCreateDialogOpen(false)
      // Navigation is handled by onState which fires right after onCreated
    }

    const onState = (roomState: RoomState) => {
      // setRoom automatically derives currentUser from room.users
      setRoom(roomState)
      if ('password' in roomState) {
        useRoomStore.getState().setRoomPassword(roomState.password ?? null)
      }
      setActionLoading(false)
      setPasswordDialog({ open: false, room: null })
      setPasswordError(null)
      void fetchCurrentProfile().catch(() => null)
      navigate(`/room/${roomState.id}`)
    }

    const onRejoinToken = (data: { roomId: string; token: string; expiresAt: number }) => {
      storage.setRejoinToken(data.roomId, data.token, data.expiresAt)
    }

    // 服务端先发送 CHAT_HISTORY，再发送会触发页面跳转的 ROOM_STATE，
    // 确保 RoomPage 监听器挂载前，历史消息已经写入 store。
    const onChatHistory = (messages: import('@music-together/shared').ChatMessage[]) => {
      useChatStore.getState().setMessages(messages)
    }

    socket.on(EVENTS.ROOM_CREATED, onCreated)
    socket.on(EVENTS.ROOM_STATE, onState)
    socket.on(EVENTS.ROOM_REJOIN_TOKEN, onRejoinToken)
    socket.on(EVENTS.CHAT_HISTORY, onChatHistory)
    socket.on(EVENTS.ROOM_ERROR, onRoomError)

    return () => {
      socket.off(EVENTS.ROOM_CREATED, onCreated)
      socket.off(EVENTS.ROOM_STATE, onState)
      socket.off(EVENTS.ROOM_REJOIN_TOKEN, onRejoinToken)
      socket.off(EVENTS.CHAT_HISTORY, onChatHistory)
      socket.off(EVENTS.ROOM_ERROR, onRoomError)
    }
  }, [socket, navigate, setRoom])

  const handleCreateRoom = async (nickname: string, roomName?: string, password?: string) => {
    await unlockAudio()
    await updateCurrentNickname(nickname).catch(() => null)
    setActionLoading(true)
    createRoom(nickname, roomName, password)
  }

  const handleRoomClick = useCallback(
    async (room: RoomListItem) => {
      if (actionLoading) return
      if (!savedNickname) {
        pendingJoinRef.current = { type: 'room', room }
        setNicknameDialogMounted(true)
        setNicknameDialogOpen(true)
        return
      }

      await unlockAudio()

      if (room.hasPassword) {
        setPasswordDialogMounted(true)
        setPasswordDialog({ open: true, room })
        setPasswordError(null)
      } else {
        setActionLoading(true)
        joinRoom(room.id, savedNickname)
      }
    },
    [actionLoading, joinRoom, savedNickname],
  )

  const handlePasswordSubmit = (password: string) => {
    if (!passwordDialog.room) return
    if (!savedNickname) return
    setActionLoading(true)
    setPasswordError(null)
    joinRoom(passwordDialog.room.id, savedNickname, password)
  }

  const handleDirectJoin = async () => {
    if (actionLoading) return
    if (!directRoomId.trim()) {
      toast.error('请输入房间号')
      return
    }
    if (!savedNickname) {
      pendingJoinRef.current = { type: 'direct', roomId: directRoomId.trim() }
      setNicknameDialogMounted(true)
      setNicknameDialogOpen(true)
      return
    }
    await unlockAudio()
    lastJoinedRoomIdRef.current = directRoomId.trim()
    setActionLoading(true)
    joinRoom(directRoomId.trim(), savedNickname)
  }

  /** Called after the user sets their nickname in NicknameDialog */
  const handleNicknameConfirm = useCallback(
    async (nickname: string) => {
      setNicknameDialogOpen(false)
      const pending = pendingJoinRef.current
      pendingJoinRef.current = null
      if (!pending) return

      await unlockAudio()
      await updateCurrentNickname(nickname).catch(() => null)

      if (pending.type === 'room') {
        const room = pending.room
        if (room.hasPassword) {
          setPasswordDialogMounted(true)
          setPasswordDialog({ open: true, room })
          setPasswordError(null)
        } else {
          setActionLoading(true)
          joinRoom(room.id, nickname)
        }
      } else {
        lastJoinedRoomIdRef.current = pending.roomId
        setActionLoading(true)
        joinRoom(pending.roomId, nickname)
      }
    },
    [joinRoom],
  )

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="mt-page-surface mt-home-page flex min-h-screen flex-col bg-background"
      onPointerMove={handleCardGlow}
      onPointerLeave={clearCardGlow}
    >
      <GlobalBackground />
      {/* Header */}
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex w-[min(1040px,calc(100%-32px))] items-center justify-between py-3">
          <div className="flex items-center gap-2.5">
            <Headphones className="h-5 w-5 text-primary" />
            <span className="text-base font-semibold tracking-tight text-foreground">Music Together</span>
          </div>
          <UserPopover />
        </div>
      </header>

      {/* Main */}
      <main className="flex-1">
        <div className="mx-auto w-[min(1040px,calc(100%-32px))] py-8 sm:py-10">
          <HeroSection />

          <ActionCards
            directRoomId={directRoomId}
            onDirectRoomIdChange={setDirectRoomId}
            onCreateClick={() => {
              setCreateDialogMounted(true)
              setCreateDialogOpen(true)
            }}
            onDirectJoin={handleDirectJoin}
            actionLoading={actionLoading}
          />

          <Separator className="mt-soft-divider mb-8 bg-transparent" />

          <RoomListSection rooms={rooms} isLoading={isLoading} onRoomClick={handleRoomClick} />
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-[38px] border-t border-border bg-transparent">
        <div className="mx-auto flex min-h-14 w-[min(1040px,calc(100%-32px))] flex-wrap items-center justify-between gap-2 py-4">
          <span className="text-xs text-muted-foreground">
            Music Together · Made by Yueby - Forked by LiuYunLingNai && 15515151 && YuapXc ·{' '}
            <a
              href="https://github.com/LiuYunLingNai/music-together/blob/main/package.json"
              target="_blank"
              rel="noopener noreferrer"
              className="relative inline-flex items-center transition-colors hover:text-foreground"
            >
              v{__APP_VERSION__}
              {hasUpdate && (
                <span
                  className="absolute -right-2 -top-1 h-2 w-2 rounded-full bg-red-500"
                  title="有新版本可用，刷新页面以更新"
                />
              )}
            </a>
          </span>
          <a
            href="https://github.com/LiuYunLingNai/music-together"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <Github className="h-3.5 w-3.5" />
            GitHub
          </a>
        </div>
      </footer>

      {/* Dialog code is fetched only when the corresponding interaction is used. */}
      <Suspense fallback={null}>
        {createDialogMounted && (
          <CreateRoomDialog
            open={createDialogOpen}
            onOpenChange={setCreateDialogOpen}
            onCreateRoom={handleCreateRoom}
            defaultNickname={savedNickname}
            isLoading={actionLoading}
          />
        )}

        {nicknameDialogMounted && (
          <NicknameDialog
            open={nicknameDialogOpen}
            onOpenChange={setNicknameDialogOpen}
            onConfirm={handleNicknameConfirm}
          />
        )}

        {passwordDialogMounted && (
          <PasswordDialog
            open={passwordDialog.open}
            onOpenChange={(open: boolean) => {
              setPasswordDialog((prev) => ({ ...prev, open }))
              if (!open) setPasswordError(null)
            }}
            roomName={passwordDialog.room?.name ?? ''}
            onSubmit={handlePasswordSubmit}
            error={passwordError}
            isLoading={actionLoading}
          />
        )}
      </Suspense>
    </motion.div>
  )
}
