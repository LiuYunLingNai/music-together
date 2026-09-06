# Music Together Web Client

`packages/client` 是 Music Together 的 React Web 客户端，同时适配桌面浏览器与移动浏览器。它通过仓库内的 Node.js 服务端连接房间，负责音频播放、房间同步、搜索点歌、队列、聊天、平台账号与歌单，以及 Apple Music 风格歌词展示。

## 歌词加载

- 播放器准备音频时预取歌词，当前平台歌词与对应 TTML 并行加载，并对重复请求和最终展示结果做有界缓存。
- 当前版本没有可靠逐词时，服务端按标准化歌名、全部歌手和歌曲时长严格匹配其他平台，聚合网易云 YRC、酷狗 KRC 等候选。
- 客户端按真实逐词动画覆盖率、相对当前版本主 LRC 的整首有序文本完整度、有效时间轴覆盖率和独立计时行数量统一评分；带有对唱或背景人声结构的完整 AMLL 候选优先保留，TTML 只是候选之一。
- 所有逐词候选都不可靠时回退到当前平台 LRC；普通 LRC 也可用于修复少量无效时间行，但不会被当成逐词歌词。

## 开发

请从仓库根目录安装依赖并启动完整开发环境：

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

默认地址：

- Web 客户端：`http://localhost:5173`
- 服务端：`http://localhost:3001`

常用检查：

```powershell
pnpm --filter @music-together/client lint
pnpm --filter @music-together/client typecheck
pnpm --filter @music-together/client build
```

完整项目说明、生产构建和部署方式见仓库根目录的 [README](../../README.md) 与 [架构文档](../../docs/PROJECT_ARCHITECTURE.md)。
