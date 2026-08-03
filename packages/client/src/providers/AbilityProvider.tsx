import { useMemo, type ReactNode } from 'react'
import { AbilityProvider as CaslAbilityProvider, Can, useAbility } from '@casl/react'
import { defineAbilityFor, type AppAbility } from '@music-together/shared'
import { useRoomStore } from '@/stores/roomStore'

export { Can }

export function useAppAbility(): AppAbility {
  return useAbility<AppAbility>()
}

export function AbilityProvider({ children }: { children: ReactNode }) {
  const role = useRoomStore((s) => s.currentUser?.role ?? 'member')
  const ability = useMemo(() => defineAbilityFor(role), [role])

  return <CaslAbilityProvider value={ability}>{children}</CaslAbilityProvider>
}
