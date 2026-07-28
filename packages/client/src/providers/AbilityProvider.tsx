import { useMemo, type ReactNode } from 'react'
import { defineAbilityFor } from '@music-together/shared'
import { useRoomStore } from '@/stores/roomStore'
import { useAccountStore } from '@/stores/accountStore'
import { AbilityContext } from '@/providers/ability-context'

export function AbilityProvider({ children }: { children: ReactNode }) {
  const role = useRoomStore((s) => s.currentUser?.role ?? 'member')
  const isServerAdmin = useAccountStore((state) => state.profile?.role === 'admin')
  const ability = useMemo(() => defineAbilityFor(isServerAdmin ? 'owner' : role), [isServerAdmin, role])

  return <AbilityContext.Provider value={ability}>{children}</AbilityContext.Provider>
}
