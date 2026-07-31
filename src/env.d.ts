/// <reference types="vite/client" />

import type { AccountProfile, IdentityBootstrapResult } from './domain/types'

declare global {
  interface Window {
    desktop?: {
      platform: NodeJS.Platform
      minimize: () => void
      toggleMaximize: () => void
      close: () => void
      isMaximized: () => Promise<boolean>
      onMaximizedChange: (listener: (maximized: boolean) => void) => () => void
      openExternal: (url: string) => Promise<void>
      setThemeSource: (source: 'system' | 'light' | 'dark') => Promise<void>
      bootstrapIdentity: (serverUrl: string) => Promise<IdentityBootstrapResult>
      syncIdentityCookie: (serverUrl: string) => Promise<void>
      recoverIdentity: (serverUrl: string, accountId: string, password: string) => Promise<{ userId: string; expiresAt: number }>
      logoutIdentity: (serverUrl: string) => Promise<{ userId: string; expiresAt: number }>
      updateAccountId: (serverUrl: string, accountId: string, currentPassword?: string) => Promise<AccountProfile>
    }
  }
}

export {}
