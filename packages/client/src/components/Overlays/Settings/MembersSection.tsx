import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { useRoomStore } from '@/stores/roomStore'
import { useAccountStore } from '@/stores/accountStore'
import type { UserRole } from '@music-together/shared'
import { Crown, Shield, ShieldCheck, User } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { resolveAvatarUrl } from '@/lib/profileApi'

interface MembersSectionProps {
  onSetUserRole?: (userId: string, role: 'admin' | 'member') => void
}

const ROLE_LABELS: Record<UserRole, string> = {
  owner: '房主',
  admin: '管理员',
  member: '成员',
}

const ROLE_ORDER: Record<string, number> = { owner: 0, admin: 1, member: 2 }

function compareMembers(
  a: { role: UserRole; isServerAdmin: boolean; isOnline: boolean },
  b: { role: UserRole; isServerAdmin: boolean; isOnline: boolean },
) {
  if (a.isServerAdmin !== b.isServerAdmin) return a.isServerAdmin ? -1 : 1
  const roleOrder = (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9)
  if (roleOrder !== 0) return roleOrder
  return Number(b.isOnline) - Number(a.isOnline)
}

function getRoleIcon(role: UserRole) {
  switch (role) {
    case 'owner':
      return <Crown className="h-4 w-4 text-yellow-500" />
    case 'admin':
      return <Shield className="h-4 w-4 text-blue-400" />
    case 'member':
      return <User className="h-4 w-4 text-muted-foreground" />
  }
}

export function MembersSection({ onSetUserRole }: MembersSectionProps) {
  const room = useRoomStore((s) => s.room)
  const currentUser = useRoomStore((s) => s.currentUser)
  const isServerAdmin = useAccountStore((state) => state.profile?.role === 'admin')
  const isOwner = currentUser?.role === 'owner' || isServerAdmin
  const members = [...(room?.members ?? [])].sort(compareMembers)

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold">
            房间成员 ({room?.users.length ?? 0}/{members.length})
          </h3>
          <span className="text-xs text-muted-foreground">离线成员会保留在名单中</span>
        </div>
        <Separator className="mt-2 mb-4" />

        <div className="space-y-1">
          {members.map((user) => (
            <div key={user.id} className="flex items-center gap-2 rounded-lg px-3 py-1.5">
              <div className="relative shrink-0">
                <Avatar size="sm">
                  <AvatarImage src={resolveAvatarUrl(user.avatarUrl)} alt="" />
                  <AvatarFallback>{user.nickname.slice(0, 1).toUpperCase()}</AvatarFallback>
                </Avatar>
                <span
                  aria-label={user.isOnline ? '在线' : '离线'}
                  className={
                    user.isOnline
                      ? 'ring-background absolute -right-0.5 -bottom-0.5 z-10 size-2.5 rounded-full bg-emerald-500 ring-2'
                      : 'ring-background absolute -right-0.5 -bottom-0.5 z-10 size-2.5 rounded-full bg-muted-foreground ring-2'
                  }
                />
              </div>
              {user.isServerAdmin ? <ShieldCheck className="h-4 w-4 text-emerald-400" /> : getRoleIcon(user.role)}
              <span className="text-sm">{user.nickname}</span>
              {user.id === currentUser?.id && (
                <Badge variant="secondary" className="text-xs">
                  你
                </Badge>
              )}
              <Badge variant="outline" className="text-xs">
                {user.isServerAdmin ? '服务器管理员' : ROLE_LABELS[user.role]}
              </Badge>
              {/* Owner can change other users' roles (not their own, not other owners) */}
              {isOwner &&
                !user.isServerAdmin &&
                user.role !== 'owner' &&
                user.id !== currentUser?.id &&
                onSetUserRole && (
                  <Select value={user.role} onValueChange={(v) => onSetUserRole(user.id, v as 'admin' | 'member')}>
                    <SelectTrigger className="ml-auto h-7 w-24 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">管理员</SelectItem>
                      <SelectItem value="member">成员</SelectItem>
                    </SelectContent>
                  </Select>
                )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
