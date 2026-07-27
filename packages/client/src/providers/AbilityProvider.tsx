import { createContext, useMemo, type ReactNode } from 'react'
import { createContextualCan } from '@casl/react'
import { defineAbilityFor, type AppAbility } from '@music-together/shared'
import { useRoomStore } from '@/stores/roomStore'
import { useAccountStore } from '@/stores/accountStore'

const defaultAbility = defineAbilityFor('member')

export const AbilityContext = createContext<AppAbility>(defaultAbility)

export const Can = createContextualCan(AbilityContext.Consumer)

export function AbilityProvider({ children }: { children: ReactNode }) {
  const role = useRoomStore((s) => s.currentUser?.role ?? 'member')
  const isServerAdmin = useAccountStore((state) => state.profile?.role === 'admin')
  const ability = useMemo(() => defineAbilityFor(isServerAdmin ? 'owner' : role), [isServerAdmin, role])

  return <AbilityContext.Provider value={ability}>{children}</AbilityContext.Provider>
}
