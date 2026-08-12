# 第三方库依赖

> 版本以当前各包 `package.json` 为准；本页记录核心依赖和职责。

## Client 核心依赖

| 分类 | 库 | 版本 | 用途 |
| --- | --- | --- | --- |
| UI | react / react-dom | ^19.2.8 | UI 基础 |
| UI | radix-ui / shadcn/ui | ^1.6.7 / — | 无障碍 UI 原语与项目组件 |
| 样式 | tailwindcss / @tailwindcss/vite | ^4.3.3 | 原子化 CSS 与 Vite 集成 |
| 状态 | zustand | ^5.0.14 | 客户端状态管理 |
| 路由 | react-router | ^8.3.0 | 客户端路由（v8 ESM；仓库统一使用 Node >=24.15.0） |
| 实时通信 | socket.io-client | ^4.8.3 | Socket.IO 客户端 |
| 音频 | howler | ^2.2.4 | 音频播放引擎 |
| 歌词 | @applemusic-like-lyrics/core / react / lyric | ^0.5.2 / ^0.5.2 / ^1.0.2 | AMLL 歌词解析、逐词动画与动态背景 |
| 动画 | motion | ^12.42.2 | React 动画 |
| 虚拟列表 | @tanstack/react-virtual | ^3.14.8 | 搜索和歌单大列表 |
| 图形 | @pixi/* | 7.x | 歌词背景渲染与滤镜 |
| 工具 | dayjs / nanoid / sonner / lucide-react | 当前锁定版本 | 日期、ID、通知、图标 |

## Server 核心依赖

| 库 | 版本 | 用途 |
| --- | --- | --- |
| express | ^4.22.2 | HTTP API 和静态文件托管 |
| socket.io | ^4.8.3 | 实时房间通信 |
| @meting/core | ^1.6.1 | 多音源基础数据聚合 |
| @neteasecloudmusicapienhanced/api | ^4.39.0 | 网易云登录、用户和歌单 API |
| zod | ^4.4.3 | 运行时输入验证 |
| pino | ^10.3.1 | 结构化日志 |
| rate-limiter-flexible | ^9.1.1 | Socket/聊天限流 |
| express-rate-limit | ^8.6.1 | 音乐 REST 与封面代理 HTTP 限流 |
| lru-cache | ^11.5.2 | 搜索、曲目和资源缓存 |
| p-limit | ^7.3.1 | 外部请求并发控制 |
| qrcode | ^1.5.4 | 酷狗登录二维码编码 |
| escape-html | ^1.0.3 | 聊天内容转义 |

酷狗 KRC 获取、解密和逐词解析由 `packages/server/src/services/kugouLyricService.ts` 内置实现，不再依赖已停止维护的 `request` 生态。

QQ 音乐搜索使用腾讯 `zzc` 签名访问 `musics.fcg`，避免未签名 `musicu.fcg` 返回业务码 `2001` 和空列表。

## Shared 核心依赖

| 库 | 版本 | 用途 |
| --- | --- | --- |
| @casl/ability | ^6.8.1 | 前后端共享 RBAC 能力定义 |
| zod | ^4.4.3 | 前后端共享 Schema |

## 开发与测试工具

| 库 | 位置 | 用途 |
| --- | --- | --- |
| TypeScript ~5.9.3 | all | 类型系统和构建 |
| Vite ^7.3.6 | client | 前端构建 |
| ESLint ^10.8.0 | client | 代码检查 |
| Vitest ^4.1.10 | root | Node/jsdom 单元与组件测试 |
| Testing Library | client | React 组件行为测试 |
| jsdom ^29.1.1 | client | 浏览器 DOM 测试环境 |
| tsx ^4.23.1 | server | 服务端开发热重载 |
| shadcn ^4.16.0 | client | shadcn/ui 组件生成 CLI |
| Prettier ^3.9.6 | root | 代码格式化 |
| concurrently ^9.2.4 | root | 并行启动前后端 |

大版本升级（Express 5、Vite 8、TypeScript 7、CASL 7）需要单独迁移和验证，不进行自动批量升级。

根 `pnpm-workspace.yaml` 对 shadcn CLI 的传递依赖锁定安全版本：`@modelcontextprotocol/sdk@1.30.0` 和 `@hono/node-server@2.0.12`。
