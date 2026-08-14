# 第三方库依赖

## Client 核心依赖

| 分类         | 库                                                         | 版本     | 用途                                    |
| ------------ | ---------------------------------------------------------- | -------- | --------------------------------------- |
| **UI 框架**  | react, react-dom                                           | ^19.2.8  | UI 基础                                 |
|              | shadcn/ui (new-york)                                       | —        | 组件库（基于 Radix UI）                 |
|              | radix-ui                                                   | ^1.6.7   | 无障碍 UI 原语                          |
|              | tailwindcss                                                | ^4.1.18  | 原子化 CSS                              |
|              | class-variance-authority                                   | ^0.7.1   | 组件变体样式                            |
|              | tailwind-merge                                             | ^3.6.0   | class 合并去重                          |
|              | clsx                                                       | ^2.1.1   | 条件 class 拼接                         |
| **权限**     | @casl/react                                                | ^5.0.1   | RBAC 权限（配合 @casl/ability）         |
| **错误边界** | react-error-boundary                                       | ^6.1.2   | React Error Boundary                    |
| **状态管理** | zustand                                                    | ^5.0.15  | 轻量全局状态                            |
| **路由**     | react-router-dom                                           | ^7.18.2  | 客户端路由                              |
| **实时通信** | 浏览器原生 WebSocket                                       | —        | `/ws` JSON 事件协议                     |
| **音频**     | howler                                                     | ^2.2.4   | 音频播放引擎                            |
|              | @applemusic-like-lyrics/core                               | ^0.5.2   | 歌词渲染核心与逐词动画                  |
|              | @applemusic-like-lyrics/lyric                              | ^1.0.2   | TTML/YRC/KRC/LRC 歌词解析               |
|              | @applemusic-like-lyrics/react                              | ^0.5.2   | 歌词 React 组件                         |
| **动画**     | motion                                                     | ^12.34.0 | Framer Motion 动画                      |
|              | tw-animate-css                                             | ^1.4.0   | Tailwind 动画预设                       |
| **图形渲染** | @pixi/app, core, display, sprite                           | ^7.4.3   | PixiJS（歌词背景渲染）                  |
|              | @pixi/filter-blur, filter-bulge-pinch, filter-color-matrix | —        | PixiJS 滤镜                             |
| **弹窗**     | vaul                                                       | ^1.x     | 移动端 Drawer（底部抽屉，支持拖拽关闭） |
| **虚拟列表** | @tanstack/react-virtual                                    | ^3.14.9  | 虚拟滚动（歌单详情大列表）              |
| **工具**     | dayjs                                                      | ^1.11.21 | 日期格式化                              |
|              | nanoid                                                     | ^5.1.16  | ID 生成                                 |
|              | sonner                                                     | ^2.0.8   | Toast 通知                              |
|              | lucide-react                                               | ^0.563.0 | 图标库                                  |
|              | jss, jss-preset-default                                    | ^10.10.0 | CSS-in-JS（AMLL 依赖）                  |

## Server 核心依赖

| 库                                | 版本     | 用途                                                                |
| --------------------------------- | -------- | ------------------------------------------------------------------- |
| express                           | ^4.22.2  | HTTP 框架                                                           |
| ws                                | ^8.21.3  | 原生 WebSocket 服务端；`wss.ts` 提供类型化事件和房间广播兼容层      |
| better-sqlite3                    | ^12.11.1 | 账号、永久房间、平台凭据和服务器设置持久化                          |
| sharp                             | ^0.35.3  | 头像和全局背景图片处理                                              |
| @meting/core                      | ^1.6.0   | 多音源音乐数据聚合                                                  |
| Node.js `zlib` + `fetch`          | 内置     | `kugouLyricService` 获取、解密并解析酷狗 KRC，避免旧 request 依赖栈 |
| nanoid                            | ^5.1.16  | 房间 ID 生成                                                        |
| cors                              | ^2.8.5   | 跨域                                                                |
| dotenv                            | ^17.4.2  | 环境变量（静默加载，避免测试/日志注入提示）                          |
| zod                               | ^4.4.3   | 请求数据验证（配合 shared schemas）                                 |
| pino                              | ^10.3.1  | 结构化日志                                                          |
| rate-limiter-flexible             | ^9.1.1   | 聊天限流                                                            |
| @neteasecloudmusicapienhanced/api | ^4.40.0  | 网易云 QR 登录 / Cookie 验证 / 用户信息                             |
| qrcode                            | ^1.5.4   | QR 码生成（酷狗扫码登录，API 仅返回 URL 需服务端转 base64 DataURL） |
| escape-html                       | ^1.0.3   | HTML 转义（防注入）                                                 |
| p-limit                           | ^7.3.1   | 并发控制（封面批量解析）                                            |
| lru-cache                         | ^11.5.2  | LRU 缓存（musicProvider 外部 API 结果缓存）                         |

## Shared 核心依赖

| 库            | 版本   | 用途                        |
| ------------- | ------ | --------------------------- |
| @casl/ability | ^6.8.0 | RBAC 权限定义（前后端共用） |
| zod           | ^4.4.3 | 数据验证 Schema             |

## 开发工具

| 库                          | 版本    | 包     | 用途                    |
| --------------------------- | ------- | ------ | ----------------------- |
| vite                        | ^7.3.1  | client | 前端构建                |
| @vitejs/plugin-react        | ^5.1.1  | client | Vite React 插件         |
| @tailwindcss/vite           | ^4.1.18 | client | Vite Tailwind 插件      |
| typescript                  | ~5.9.3  | all    | 类型系统                |
| tsx                         | ^4.19.0 | server | 服务端 TS 运行/热重载   |
| pino-pretty                 | ^13.1.3 | server | 开发环境日志美化        |
| eslint                      | ^9.39.1 | client | 代码检查                |
| eslint-plugin-react-hooks   | ^7.0.1  | client | React Hooks 规则        |
| eslint-plugin-react-refresh | ^0.4.24 | client | React Fast Refresh 规则 |
| concurrently                | ^9.2.1  | root   | 并行运行前后端          |
| kill-port                   | ^2.0.1  | root   | 端口清理                |

---
