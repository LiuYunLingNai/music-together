import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// 开发环境代理目标：默认本地后端 3001，可用 ADMIN_BACKEND_URL 覆盖
const backendTarget = process.env.ADMIN_BACKEND_URL ?? 'http://localhost:3001'

// https://vite.dev/config/
export default defineConfig({
  // 生产环境由服务端托管在 /admin 路径，构建与预览均使用该 base
  base: process.env.npm_lifecycle_event === 'dev' ? '/' : '/admin/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: true,
    port: 5174,
    proxy: {
      '/api': { target: backendTarget, changeOrigin: true },
      '/uploads': { target: backendTarget, changeOrigin: true },
    },
  },
})
