# Music Together Agent 规范

本文件适用于整个 `main` 分支。开始修改前必须先阅读 `.agent/rules/` 中与任务相关的规则；架构和开发约定以 `docs/PROJECT_ARCHITECTURE.md` 及 `docs/architecture/` 为准。

## 不可破坏的 fork 能力

- 保留原生 WebSocket `/ws` 的 JSON 信封协议及 Android、Windows 旧客户端兼容性，不得擅自替换为 Socket.IO。
- 保留服务端权威播放时间线、永久房间、离线成员、账号与后台管理、多平台音源、音质与下载能力。
- 共享事件新增字段默认设计为可选或提供兼容回退；修改协议时同步检查 Web、Android 和 Windows 客户端。
- 上游同步以迁移修复和能力为主，不直接覆盖 fork 的仓储、鉴权、音源或播放同步实现。

## 工程约束

- 服务端保持 controller → service → repository 分层；外部输入使用 `packages/shared/src/schemas.ts` 校验。
- 事件、共享类型和权限能力集中在 `packages/shared`；不得在日志、测试或文档中写入 Cookie、令牌和密码。
- 前端优先复用现有 UI 组件、设计令牌和响应式布局；动画必须尊重性能设置与减少动态效果偏好。
- 业务修复应增加回归测试；外部音乐平台请求必须 mock，不得让常规测试依赖线上接口。
- 架构、协议、依赖、部署或目录发生变化时，按 `.agent/rules/sync-architecture-docs.md` 同步文档。

## 校验与 Git

- 常规校验依次使用 `pnpm test`、`pnpm --filter @music-together/server test`、`pnpm typecheck` 和客户端 lint。
- 编译、启动、部署和安装遵循 `.agent/rules/no-dev-build-commands.md`：仅在用户明确授权时执行。
- 不得擅自暂存、提交、推送、合并或清理用户已有改动；提交前检查生成物、凭据和临时文件。
