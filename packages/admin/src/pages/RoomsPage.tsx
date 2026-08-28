import { useEffect, useState } from 'react'
import { Icon } from '@iconify/react'
import { Badge, Button, Card, ConfirmDialog, Dialog, EmptyState, PageLoading } from '../components/ui'
import { useToast } from '../components/toast'
import { adminApi, formatTime } from '../lib/api'
import { PLATFORM_LABELS } from '../lib/types'
import type { AdminRoom, AdminRoomDetail, AdminRoomMember } from '../lib/types'

export default function RoomsPage() {
  const toast = useToast()
  const [rooms, setRooms] = useState<AdminRoom[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [dissolveTarget, setDissolveTarget] = useState<AdminRoom | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  // 房间详情对话框状态
  const [detailRoomId, setDetailRoomId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminRoomDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [kickTarget, setKickTarget] = useState<AdminRoomMember | null>(null)
  const [kicking, setKicking] = useState(false)

  useEffect(() => {
    let cancelled = false
    setRooms(null)
    setError(null)
    adminApi
      .getRooms()
      .then((result) => {
        if (!cancelled) setRooms(result.rooms)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败')
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const handleDissolve = async () => {
    if (!dissolveTarget) return
    setActionLoading(true)
    try {
      await adminApi.dissolveRoom(dissolveTarget.id)
      toast.show(`已解散房间 ${dissolveTarget.name}`, 'success')
      setDissolveTarget(null)
      setReloadKey((key) => key + 1)
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '解散失败', 'error')
    } finally {
      setActionLoading(false)
    }
  }

  const loadDetail = (roomId: string) => {
    setDetail(null)
    setDetailError(null)
    adminApi
      .getRoomDetail(roomId)
      .then((result) => setDetail(result))
      .catch((err: unknown) => setDetailError(err instanceof Error ? err.message : '加载失败'))
  }

  const openDetail = (roomId: string) => {
    setDetailRoomId(roomId)
    loadDetail(roomId)
  }

  const closeDetail = () => {
    setDetailRoomId(null)
    setDetail(null)
    setDetailError(null)
    setKickTarget(null)
  }

  const handleKick = async () => {
    if (!detail || !kickTarget) return
    setKicking(true)
    try {
      await adminApi.kickUser(detail.id, kickTarget.id)
      toast.show(`已将 ${kickTarget.nickname || kickTarget.id} 移出房间`, 'success')
      setKickTarget(null)
      loadDetail(detail.id)
      setReloadKey((key) => key + 1)
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '移出失败', 'error')
    } finally {
      setKicking(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        {error && <p className="text-sm text-[#ff4d4f] dark:text-[#ff7875]">{error}</p>}
        {!error && rooms === null && <PageLoading />}
        {rooms !== null && rooms.length === 0 && (
          <EmptyState title="当前没有活跃房间" description="用户创建或进入房间后会显示在这里" />
        )}
        {rooms !== null && rooms.length > 0 && (
          <div className="-mx-8 -my-8 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-left text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
                  <th className="px-8 py-4 font-medium">房间</th>
                  <th className="px-4 py-4 font-medium">房主</th>
                  <th className="px-4 py-4 font-medium">人数</th>
                  <th className="px-4 py-4 font-medium">属性</th>
                  <th className="px-4 py-4 font-medium">正在播放</th>
                  <th className="px-8 py-4 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {rooms.map((room) => (
                  <tr key={room.id} className="border-b border-zinc-50 last:border-0 dark:border-zinc-800/60">
                    <td className="px-8 py-4">
                      <p className="text-zinc-700 dark:text-zinc-200">{room.name}</p>
                      <p className="text-xs text-zinc-400 dark:text-zinc-500">{room.id}</p>
                    </td>
                    <td className="px-4 py-4 text-xs text-zinc-400 dark:text-zinc-500">{room.creatorId}</td>
                    <td className="px-4 py-4 text-zinc-700 dark:text-zinc-200">{room.userCount}</td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-1.5">
                        {room.hasPassword && <Badge tone="warning">密码房</Badge>}
                        {room.hidden && <Badge>隐藏</Badge>}
                        {room.permanent && <Badge tone="success">永久房</Badge>}
                      </div>
                    </td>
                    <td className="max-w-48 truncate px-4 py-4 text-xs text-zinc-400 dark:text-zinc-500">
                      {room.currentTrackTitle ?? '—'}
                    </td>
                    <td className="px-8 py-4">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={() => openDetail(room.id)}>
                          <Icon icon="mdi:eye-outline" className="size-3.5" />
                          详情
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => setDissolveTarget(room)}>
                          <Icon icon="mdi:delete-outline" className="size-3.5" />
                          解散
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={dissolveTarget !== null}
        title="解散房间"
        danger
        confirmText="解散"
        loading={actionLoading}
        message={
          <p>
            确定解散房间 <span className="font-medium text-zinc-800 dark:text-zinc-100">{dissolveTarget?.name}</span>
            （{dissolveTarget?.id}）吗？房间内 {dissolveTarget?.userCount ?? 0} 名成员将被移出，
            {dissolveTarget?.permanent ? '该房间为永久房，解散后其持久化数据将被清理。' : '该操作不可恢复。'}
          </p>
        }
        onConfirm={handleDissolve}
        onClose={() => !actionLoading && setDissolveTarget(null)}
      />

      <Dialog
        open={detailRoomId !== null}
        onClose={closeDetail}
        width="lg"
        title={detail?.name || '房间详情'}
        subtitle={detail ? `房间 ID：${detail.id}` : detailRoomId ?? undefined}
        footer={
          <Button variant="ghost" onClick={closeDetail}>
            关闭
          </Button>
        }
      >
        {detailError && <p className="text-sm text-[#ff4d4f] dark:text-[#ff7875]">{detailError}</p>}
        {!detailError && detail === null && <PageLoading />}
        {detail !== null && (
          <div className="space-y-5">
            {detail.currentTrack ? (
              <div className="flex items-center gap-3 rounded-xl bg-[#e6f4ff] px-4 py-3.5 dark:bg-[#1890ff]/15">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#1890ff] text-white dark:bg-[#40a9ff]">
                  <Icon icon={detail.isPlaying ? 'mdi:equalizer' : 'mdi:pause'} className="size-4.5" />
                </span>
                <div className="min-w-0">
                  <p className="truncate font-medium text-zinc-800 dark:text-zinc-100">{detail.currentTrack.title}</p>
                  <p className="mt-0.5 truncate text-xs text-zinc-400 dark:text-zinc-500">
                    {detail.currentTrack.artist} · {PLATFORM_LABELS[detail.currentTrack.source] ?? detail.currentTrack.source} · {detail.isPlaying ? '播放中' : '已暂停'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-xl bg-zinc-50 px-4 py-3.5 text-sm text-zinc-400 dark:bg-zinc-800/40 dark:text-zinc-500">
                当前没有正在播放的曲目{detail.queue.length > 0 ? `，待播队列 ${detail.queue.length} 首` : ''}
              </div>
            )}

            <div className="grid gap-x-8 gap-y-4 sm:grid-cols-3">
              <DetailItem label="播放状态">
                {detail.isPlaying ? (
                  <span className="flex items-center gap-1.5 text-[#389e0d] dark:text-[#6abe39]">
                    <span className="size-1.5 rounded-full bg-[#52c41a]" />播放中
                  </span>
                ) : (
                  '已暂停'
                )}
              </DetailItem>
              <DetailItem label="音质">{detail.audioQuality} kbps</DetailItem>
              <DetailItem label="播放模式">{PLAY_MODE_LABELS[detail.playMode] ?? detail.playMode}</DetailItem>
              <DetailItem label="房主">{detail.creatorId}</DetailItem>
              <DetailItem label="指挥（Conductor）">{detail.hostId}</DetailItem>
              <DetailItem label="待播队列">{detail.queue.length} 首</DetailItem>
              <DetailItem label="房间属性">
                <span className="flex flex-wrap gap-1.5">
                  {detail.permanent && <Badge tone="success">永久房</Badge>}
                  {detail.hasPassword && <Badge tone="warning">密码房</Badge>}
                  {detail.hidden && <Badge>隐藏</Badge>}
                  {!detail.permanent && !detail.hasPassword && !detail.hidden && <span className="text-zinc-400 dark:text-zinc-500">普通房间</span>}
                </span>
              </DetailItem>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-zinc-400 dark:text-zinc-500">成员名册（{detail.members.length}）</p>
              {detail.members.length === 0 ? (
                <p className="text-sm text-zinc-400 dark:text-zinc-500">暂无成员</p>
              ) : (
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                  {detail.members.map((member) => (
                    <li key={member.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
                          <span className="truncate">{member.nickname || member.id}</span>
                          {member.isOnline ? (
                            <Badge tone="success">在线</Badge>
                          ) : (
                            <Badge>离线{member.lastSeenAt ? ` · ${formatTime(member.lastSeenAt)}` : ''}</Badge>
                          )}
                          {member.id === detail.hostId && <Badge tone="warning">指挥</Badge>}
                        </p>
                        <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">{member.id}</p>
                      </div>
                      <Button size="sm" variant="danger" onClick={() => setKickTarget(member)}>
                        移出
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={kickTarget !== null}
        title="移出成员"
        danger
        confirmText="移出"
        loading={kicking}
        message={
          <p>
            确定将 <span className="font-medium text-zinc-800 dark:text-zinc-100">{kickTarget?.nickname || kickTarget?.id}</span>
            （{kickTarget?.id}）移出该房间吗？其所有连接都会被断开并返回大厅，离线名册记录也会移除。
          </p>
        }
        onConfirm={handleKick}
        onClose={() => !kicking && setKickTarget(null)}
      />
    </div>
  )
}

const PLAY_MODE_LABELS: Record<string, string> = {
  sequential: '顺序播放',
  'loop-all': '列表循环',
  'loop-one': '单曲循环',
  shuffle: '随机播放',
}

function DetailItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-zinc-400 dark:text-zinc-500">{label}</p>
      <div className="mt-1 text-zinc-700 dark:text-zinc-200">{children}</div>
    </div>
  )
}
