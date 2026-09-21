import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import wasm from 'vite-plugin-wasm'
import path from 'path'
import { readFileSync } from 'fs'

const rootPkg = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), wasm()],
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version),
  },
  server: {
    host: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    target: 'esnext', // 原生支持 top-level await，避免 vite-plugin-top-level-await 与 manualChunks 冲突
    rollupOptions: {
      output: {
        /**
         * 分包策略。
         *
         * 注意：three.js / @react-three/fiber 只被动态导入的 Mineradio 舞台
         * 引用，因此这里**刻意不给它们命名 chunk**。若把它们写进
         * manualChunks，Rollup 会为满足该命名块而把三者提升成同步依赖，
         * 结果 index.html 会直接 modulepreload 整包 three（约 900 KB），
         * 经典播放器路径也要白白下载。
         *
         * 保持不声明后，Rollup 会把 three 留在 MineradioPlayerStage 那个
         * 异步 chunk 里，只有用户真正切到视觉模式时才请求。
         */
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-motion': ['motion'],
          'vendor-pixi': [
            '@pixi/app',
            '@pixi/core',
            '@pixi/display',
            '@pixi/sprite',
            '@pixi/filter-blur',
            '@pixi/filter-bulge-pinch',
            '@pixi/filter-color-matrix',
          ],
        },
      },
    },
  },
})
