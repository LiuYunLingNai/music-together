import { create } from 'zustand'
import { useAccountPlaylistStore } from './accountPlaylistStore'

export interface AccountProfile {
  id: string
  nickname: string
  avatarUrl: string | null
  hasPassword: boolean
  role: 'user' | 'admin'
}

interface AccountState {
  profile: AccountProfile | null
  setProfile: (profile: AccountProfile | null) => void
}

export const useAccountStore = create<AccountState>((set) => ({
  profile: null,
  setProfile: (profile) => {
    useAccountPlaylistStore.getState().bindAccount(profile?.hasPassword ? profile.id : null)
    set({ profile })
  },
}))
