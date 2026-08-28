import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { authApi, setUnauthorizedHandler } from './api'
import type { MeProfile } from './types'

export type AuthStatus = 'loading' | 'guest' | 'admin'

interface AuthContextValue {
  status: AuthStatus
  me: MeProfile | null
  /** 登录成功后返回错误文案（非管理员等），成功返回 null */
  login: (accountId: string, password: string) => Promise<string | null>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [me, setMe] = useState<MeProfile | null>(null)

  const applyProfile = useCallback((profile: MeProfile | null) => {
    setMe(profile)
    setStatus(profile?.role === 'admin' ? 'admin' : 'guest')
  }, [])

  // 启动时恢复会话；会话失效（401）时回到未登录状态
  useEffect(() => {
    let cancelled = false
    authApi
      .fetchMe()
      .then((profile) => {
        if (!cancelled) applyProfile(profile)
      })
      .catch(() => {
        if (!cancelled) setStatus('guest')
      })
    setUnauthorizedHandler(() => applyProfile(null))
    return () => {
      cancelled = true
      setUnauthorizedHandler(null)
    }
  }, [applyProfile])

  const login = useCallback(
    async (accountId: string, password: string): Promise<string | null> => {
      await authApi.recover(accountId, password)
      const profile = await authApi.fetchMe()
      if (!profile) return '登录失败：账号资料不存在'
      if (profile.role !== 'admin') {
        await authApi.logout().catch(() => {})
        applyProfile(null)
        return '该账号不是服务器管理员，无权访问管理平台'
      }
      applyProfile(profile)
      return null
    },
    [applyProfile],
  )

  const logout = useCallback(async () => {
    await authApi.logout().catch(() => {})
    applyProfile(null)
  }, [applyProfile])

  const value = useMemo(() => ({ status, me, login, logout }), [status, me, login, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用')
  return ctx
}
