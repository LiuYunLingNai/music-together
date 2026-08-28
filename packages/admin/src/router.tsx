import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { PageLoading, Spinner } from './components/ui'
import { useAuth } from './lib/auth'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import UsersPage from './pages/UsersPage'
import RoomsPage from './pages/RoomsPage'
import SettingsPage from './pages/SettingsPage'
import BackgroundPage from './pages/BackgroundPage'
import DocsPage from './pages/DocsPage'
import ThemePage from './pages/ThemePage'

/** 路由守卫：仅服务器管理员可进入后台页面 */
function RequireAdmin({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f7fa] dark:bg-[#0b0c10]">
        <Spinner />
      </div>
    )
  }
  if (status !== 'admin') return <Navigate to="/login" replace />
  return <>{children}</>
}

/** 已登录管理员访问 /login 时直接进概览 */
function RedirectIfAdmin({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  if (status === 'loading') return <PageLoading />
  if (status === 'admin') return <Navigate to="/" replace />
  return <>{children}</>
}

export default function AppRouter() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <RedirectIfAdmin>
            <LoginPage />
          </RedirectIfAdmin>
        }
      />
      <Route
        element={
          <RequireAdmin>
            <Layout />
          </RequireAdmin>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/rooms" element={<RoomsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/background" element={<BackgroundPage />} />
        <Route path="/docs" element={<DocsPage />} />
        <Route path="/theme" element={<ThemePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
