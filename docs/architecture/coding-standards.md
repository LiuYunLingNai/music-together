# 代码规范

## 语言与模块

- **TypeScript strict 模式**：所有包均启用 `"strict": true`
- **ESM**：所有包 `"type": "module"`，使用 `import/export` 语法
- **目标**：ES2022（server/shared），ES2022 + DOM（client）
- **模块解析**：`"moduleResolution": "bundler"`

## 命名规范

| 类型             | 规范                     | 示例                                   |
| ---------------- | ------------------------ | -------------------------------------- |
| 组件文件/组件名  | PascalCase               | `ChatPanel.tsx`, `AudioPlayer`         |
| Hook 文件/函数名 | camelCase + `use` 前缀   | `usePlayer.ts`, `useHowl`              |
| Store 文件       | camelCase + `Store` 后缀 | `playerStore.ts`                       |
| 工具函数/文件    | camelCase                | `format.ts`, `formatDuration()`        |
| 类型/接口        | PascalCase               | `Track`, `RoomState`, `HandlerContext` |
| 常量             | UPPER_SNAKE_CASE         | `EVENTS`, `LIMITS`, `TIMING`           |
| 事件名           | 命名空间:动作            | `room:create`, `player:sync_response`  |

## 路径别名

客户端使用 `@/*` 映射到 `src/*`：

```typescript
import { usePlayerStore } from '@/stores/playerStore'
import { cn } from '@/lib/utils'
```

## 状态更新

Zustand Store 通过 `set()` 进行不可变更新：

```typescript
// 展开运算符更新嵌套状态
updateRoom: (partial) =>
  set((state) => ({
    room: state.room ? { ...state.room, ...partial } : null,
  }))
```

## 错误处理

- **REST 路由**：统一使用 `validated(schema, label, handler)` 包装器自动完成 Zod 验证 + try/catch + 日志记录，返回适当的 HTTP 状态码
- **WebSocket**：`wss.ts` 类型化封装和中间件统一捕获异步错误，通过 `ROOM_ERROR` 回传 `ERROR_CODE` 枚举和消息
- **客户端 Hook**：hook 中处理 Socket 错误事件，使用 `sonner` toast 提示用户（含限流反馈）
- **客户端 ErrorBoundary**：`react-error-boundary` 全局 + 路由级双层包裹（`RouteErrorBoundary` 包裹 `HomePage` 和 `RoomPage`），页面崩溃只影响当前路由并导航回首页
- **客户端连接状态**：`SocketProvider` 监听 disconnect/reconnect，显示持久化 warning toast
- **搜索竞态防护**：`SearchDialog` 使用 `AbortController` 取消上一次请求 + `searchIdRef` 忽略过时响应 + `loadMoreAbortRef` 在卸载时中止加载更多请求。搜索结果和歌单详情均通过 `VirtualTrackList` 共享组件实现虚拟滚动 + 无限自动加载
- **Socket 事件速率限制**：`socketRateLimiter` 中间件（`rate-limiter-flexible`）按持久化用户身份对 `QUEUE_ADD`、`PLAYER_PLAY`、`VOTE_START` 等关键事件限流（10 次/5 秒），认证轮询使用独立的 30 次/分钟额度
- **HTTP 资源限流**：音乐元数据接口为 120 次/分钟，优先按身份 Cookie 分桶，无身份时回退到 IP；封面代理不设请求次数限额，依靠主机白名单、逐跳 HTTPS 重定向校验、图片类型和 10 MiB 大小上限约束请求边界
- **投票阈值动态更新**：`voteService.updateVoteThreshold` 在用户离开房间时重新计算 `requiredVotes`，防止人数减少后投票永远无法通过
- **外部 API 超时保护**：`musicProvider` 所有 `@meting/core` 调用使用 `Promise.race` 包裹 15s 超时
- **3 层引用式 LRU 缓存**：`musicProvider` 采用三层缓存架构——Layer 1: `trackRegistry`（max 10000, TTL 2h）以 `source:sourceId` 为 key 存储去重的 TrackMeta，所有经过系统的歌曲注册于此，支持跨上下文数据富化（搜索的 duration/cover 自动回填到歌单）；Layer 2: `searchIndex`（max 200, TTL 10min）和 `playlistIndex`（max 50, TTL 30min）仅存 sourceId 数组引用（不存 Track 对象），2000 首歌单仅占 ~40KB 引用而非 ~1MB 对象；Layer 3: `streamUrlCache`（1h）、`coverCache`（24h）、`lyricCache`（24h）存标量值。内存预算 worst case ~8.3MB（vs 旧架构 ~104MB）。歌单分页通过 `getPlaylistPage(source, id, limit, offset)` 实现，仅对当前页解析封面后回写 registry；VIP cookie 请求不走缓存。**所有平台歌单均使用原始 API 模式**（Netease 用 ncmApi 分块请求，Tencent/Kugou 用 Meting 无 format 模式），统一通过 `rawToTrack()` 解析（exhaustive switch + `never` 检查），保留 VIP/付费标记和歌曲时长
- **广播防抖**：`broadcastRoomList` 使用 100ms trailing debounce，多次快速操作（create+join、多人 leave）合并为一次广播
- **反向索引优化**：`roomRepository` 维护 `roomToSockets` 反向索引（`Map<string, Set<string>>`），使 `getP90RTT` 从 O(全局 socket 数) 降为 O(房间内 socket 数)
- **Timer 泄漏防护**：`usePlayer`/`useHowl`/`usePlayerSync`/`PlayerControls` 中所有 `setTimeout` 均存入 ref 并在组件卸载时清理
- **Stalled 检测**：`useHowl` 的 rAF 时间更新循环中检测播放卡住（`playing()` 为 true 但 `seek()` 8 秒内无变化），自动跳到下一首并 toast 提示。兜底播放中途网络断开等 Howler 不触发任何事件的场景

## ESLint 配置

- **Flat config** 格式（`eslint.config.js`）
- 仅客户端包配置了 ESLint
- 插件：`@eslint/js` recommended + `typescript-eslint` recommended + `react-hooks` + `react-refresh`
- 无 Prettier（依赖编辑器格式化）

## 导入顺序（约定）

```typescript
// 1. 第三方库
import { create } from 'zustand'
import type { Track } from '@music-together/shared'

// 2. 内部模块（@/ 别名）
import { storage } from '@/lib/storage'
import { usePlayerStore } from '@/stores/playerStore'
```

---
