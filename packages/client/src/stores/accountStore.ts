import { create } from 'zustand'

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
  setProfile: (profile) => set({ profile }),
}))
