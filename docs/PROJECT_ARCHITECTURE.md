# Music Together — 项目速查手册

> 供 AI 助手快速理解项目全貌的参考文档。

## 1. 项目概览

**Music Together** 是一个在线同步听歌平台，允许多人在同一房间内实时同步播放音乐、聊天互动。

### 核心功能

| 功能       | 说明                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 房间系统   | 创建/加入房间，房间号邀请，可选密码保护；永久房间在用户加入时按 30 分钟间隔按需刷新当前播放链接                                      |
| 多音源搜索 | 网易云、QQ音乐、酷狗                                                                                                                 |
| 同步播放   | 房间内播放进度实时同步                                                                                                               |
| 实时聊天   | 房间内文字聊天                                                                                                                       |
| 权限控制   | RBAC 三级权限（owner > admin > member）基于 @casl/ability；`hostId` 为兼容性的播放主持标识，不承担权威进度上报                       |
| 播放模式   | 顺序播放、列表循环、单曲循环、随机播放（Owner/Admin 直接切换，Member 投票切换）                                                      |
| 投票系统   | 普通成员通过投票控制播放（暂停/恢复/切歌/切换播放模式/指定播放/移除歌曲）                                                            |
| VIP 认证   | 平台账号登录（网易云/QQ/酷狗），房间级 Cookie 池（VIP 播放共享）+ 用户级歌单（私有）                                                 |
| 歌词展示   | Apple Music 风格歌词动画 (AMLL)，支持逐词渐变、隐藏已播放行、敏感词遮罩、歌曲底栏和逐曲校准；TTML > YRC/KRC > LRC                    |

### 技术栈

- **前端**: React 19 + Vite 7 + TypeScript 5.9 + Tailwind CSS v4 + shadcn/ui + Zustand
- **后端**: Node.js 22 + Express 4 + 原生 `ws` JSON 事件协议 + SQLite + @meting/core
- **Monorepo**: pnpm workspaces（3 个包：`client`、`server`、`shared`）

---

## 子文档索引

本文档已拆分为多个子文件，位于 `docs/architecture/` 目录：

| 章节            | 文件                                                          | 内容                                                                              |
| --------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 2. 目录结构     | [directory-structure.md](architecture/directory-structure.md) | client / server / shared 三包目录树                                               |
| 3. 架构与数据流 | [data-flow.md](architecture/data-flow.md)                     | 分层架构、Socket 事件清单、核心类型定义、NTP 同步、播放同步、播放模式、音频质量等 |
| 上游同步策略 | [upstream-sync.md](architecture/upstream-sync.md) | 上游能力迁移范围、fork 不可破坏能力和有意保留的版本差异 |
| 4. 第三方库依赖 | [dependencies.md](architecture/dependencies.md)               | 前端/后端/共享/开发依赖清单                                                       |
| 5. 设计模式     | [design-patterns.md](architecture/design-patterns.md)         | Zustand Store、Hook 组合、Dialog、Provider、分层架构、Repository 等               |
| 6. 代码规范     | [coding-standards.md](architecture/coding-standards.md)       | 语言模块、路径别名、状态更新、错误处理                                            |
| 7. UI 设计规范  | [ui-design.md](architecture/ui-design.md)                     | 组件库、颜色系统、动画、歌词、响应式                                              |
| 8. 开发指南     | [dev-guide.md](architecture/dev-guide.md)                     | 快速启动、构建、添加组件、注意事项                                                |
| 9. 部署方案     | [deployment.md](architecture/deployment.md)                   | Docker、CORS、Watchtower、1Panel                                                  |
