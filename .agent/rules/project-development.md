---
trigger: always_on
---

# Music Together Web 与服务端开发规范

本规则适用于当前 `main` 分支的全部修改。开始工作前先阅读
[`docs/PROJECT_ARCHITECTURE.md`](../../docs/PROJECT_ARCHITECTURE.md)，再按任务范围读取
`docs/architecture/` 中对应的子文档、源码和测试。源码是最终事实来源；文档与实现冲突时，先核对当前代码，再在同一任务中修正文档。

## 1. 仓库范围

当前分支使用 pnpm workspace 维护三个包：

| 包 | 职责 |
| --- | --- |
| `packages/shared/` | Web 与服务端共用的事件名、Schema、类型、常量和权限定义 |
| `packages/server/` | Express HTTP API、`ws` WebSocket、房间业务、音乐平台适配和 SQLite 持久化 |
| `packages/client/` | React Web 客户端、Zustand 状态、音频播放、歌词和响应式界面 |

Android 与 Windows 原生客户端位于独立分支或独立工作区，不在当前分支同步编译。修改共享事件、HTTP API、核心模型或兼容语义时，必须评估两个原生客户端的影响，并保留旧客户端可以安全处理的可选字段或回退路径。

当前 WebSocket 不是 Socket.IO。服务端通过 `packages/server/src/wss.ts` 在 `/ws` 上收发以下 JSON 信封：

```json
{ "event": "room:state", "data": {} }
```

不要引入 Socket.IO 专属 API、客户端握手参数或 ack 语义，除非任务明确要求迁移整个协议并同步所有客户端。

## 2. 工作范围与授权

开始修改前：

1. 运行 `git status --short --branch`，保留用户已有改动
2. 只修改当前任务涉及的文件，不格式化或重排无关代码
3. 修改前先沿调用链读取共享定义、入口、业务实现和已有测试
4. 创建提交、推送、开 Pull Request、合并或发布前，分别确认用户已经授权对应操作
5. 仅在用户明确要求发布时修改版本号、镜像标签或发布元数据
6. 不提交 `.env`、Cookie、平台凭据、数据库、上传文件、日志、构建产物或本机绝对路径
7. 完成后执行与风险匹配且现有规则允许的检查，并运行 `git diff --check`

### 仓库同步与冲突处理

同步远端时先确认工作区和分支关系：

1. 运行 `git status --short --branch` 和 `git fetch`
2. 工作区干净且当前分支只落后上游时，使用 `git pull --ff-only`
3. 有未提交或未跟踪文件时，先确认远端变更是否触及相同路径
4. 路径重叠、分支分叉或状态不明确时停止同步，说明风险并等待用户选择
5. 未经用户确认，不使用 `git stash`、`merge`、`rebase`、`reset --hard`、`checkout -- <path>` 或 `clean`
6. 冲突必须逐块理解双方意图，不整文件盲选 `ours` 或 `theirs`

## 3. 分层与依赖方向

### 共享协议

- 事件名只在 `packages/shared/src/events.ts` 定义
- Socket 载荷类型集中在 `packages/shared/src/socket-types.ts`
- HTTP/Socket 输入优先使用共享 Zod Schema；不要只依赖 TypeScript 类型
- 新增字段应明确必填、可选、默认值和旧客户端行为
- 协议变更必须同时检查 Web 调用方、服务端处理器、广播载荷和原生客户端兼容性

### 服务端

保持以下依赖方向：

```text
routes / controllers
  -> middleware + services
    -> repositories + provider adapters
      -> SQLite / external music APIs
```

- REST 输入在进入业务逻辑前完成验证、长度限制和身份检查
- WebSocket handler 使用现有房间、控制权限和限流中间件，不在 controller 内复制鉴权
- 房间状态由服务端权威维护；客户端上报只作为受校验的同步样本
- 运行时房间状态与永久房间持久化语义分开处理
- 永久房间写入前移除短期有效的 `streamUrl`，重进时重新解析
- 平台 Cookie 只保留在服务端或对应用户的加密存储中，不广播给房间成员
- 外部 URL、重定向、代理和下载入口必须校验协议、目标域名、范围请求和响应头
- 定时器、调度器、房间锁和缓存需要有明确清理路径

### Web 客户端

保持以下数据流：

```text
Page / Component
  -> Hook / Provider
    -> Zustand Store + HTTP / WebSocket
      -> Howler / Web Audio / Media Session
```

- 组件负责展示和用户操作，不直接拥有全局 Socket、音频对象或持久化生命周期
- Socket 订阅使用现有 Provider/Hook，并在卸载或依赖变化时解除
- Zustand 使用不可变更新；房间、播放器、账号和聊天状态不要维护互相冲突的副本
- 可取消请求使用 `AbortController` 或现有竞态保护，忽略过期响应
- 音频、动画和计时器必须在切歌、离房或卸载时释放
- UI 任务同时遵循 `frontend-design.md`；优先复用 `src/components/ui/` 组件

## 4. 不可破坏的系统约束

### 身份与安全

- HTTP 与 WebSocket 使用同一个 `mt_identity` HttpOnly Cookie 身份
- Cookie 的 `Secure` 属性依据显式配置，或在生产环境中根据请求协议与 `X-Forwarded-Proto` 推断
- 生产部署不得依赖公开的开发默认 `IDENTITY_SECRET`
- 平台 Cookie、永久房间密码使用身份密钥派生的 AES-256-GCM 加密
- Owner 密码等敏感字段只通过定向响应返回给有权用户
- 服务端管理员能力以服务端身份为准，不信任客户端传入角色

### 房间与权限

- 角色语义为 `owner > admin > member`
- `hostId` 是自动选举的播放主持，不等同于房主身份
- Owner/管理员直接控制；普通成员按现有规则发起投票
- 临时管理员不写入永久管理员集合，永久管理员返回时需要重新协调角色
- 多 Socket 重连不能让旧连接的 disconnect 清除新连接对应的活跃用户
- 普通空房间按宽限期清理；永久房间保留成员、队列、聊天和播放快照

### 播放同步

- 服务端时间和 `serverTimeToExecute` 是计划动作的基准
- NTP ping/pong、RTT 估算和 `serverTimestamp` 共同确定期望进度
- 同一房间的播放、切歌和停止操作继续使用现有互斥和防抖边界
- 切换音质只影响之后解析的流，不无条件打断当前播放
- 自动换源、代理与直连回退必须保持曲目身份、当前进度和一次性回退约束
- 歌词行、逐词进度和播放器显示应消费同一播放时间源

## 5. 修改入口与测试位置

| 改动 | 主要入口 | 最低检查重点 |
| --- | --- | --- |
| 事件或模型 | `shared/src/events.ts`、`socket-types.ts`、`types.ts`、`schemas.ts` | 服务端 handler、Web 订阅、原生端兼容 |
| 房间/权限 | `server/src/controllers/roomController.ts`、`services/roomService.ts`、`middleware/` | 角色协调、断线重连、公开状态脱敏 |
| 播放/队列/投票 | 对应 controller 和 service | mutex、防抖、停止兜底、投票直控一致性 |
| 音乐平台 | `server/src/services/musicProvider.ts`、各平台 auth/quality 模块 | 超时、会员音质、缓存、代理安全、降级 |
| SQLite | `server/src/repositories/database.ts` 和对应 repository | 幂等迁移、旧数据兼容、事务边界 |
| Web 房间状态 | `client/src/hooks/room/`、`stores/`、`pages/RoomPage.tsx` | 订阅释放、重连、状态副本 |
| Web 播放/歌词 | `client/src/hooks/useHowl.ts`、`usePlayerSync.ts`、`useLyric.ts` | 切歌、暂停、Seek、漂移、计时器释放 |
| 响应式 UI | `client/src/components/`、`index.css` | 移动/桌面、键盘、焦点、触控和降级动画 |

大文件是维护热点，不继续无边界堆叠职责。新逻辑可以独立测试且边界清晰时，优先拆到内聚模块，并保留明确入口和单向依赖。

## 6. 验证

本仓库已有规则禁止 Agent 自行运行开发服务器、生产启动或构建命令；以
[`no-dev-build-commands.md`](no-dev-build-commands.md) 为准。允许的静态检查和测试按风险选择：

```powershell
pnpm --filter @music-together/client typecheck
pnpm --filter @music-together/client lint
pnpm --filter @music-together/server test
pnpm --filter @music-together/shared exec tsc -p tsconfig.json --noEmit
git diff --check
```

| 改动范围 | 最低验证 |
| --- | --- |
| Markdown / Agent 规则 | 链接、路径、命令和 `git diff --check` |
| shared 类型或 Schema | shared 类型检查、client 类型检查、server 测试 |
| 服务端纯函数/平台解析 | 对应测试、完整 server 测试 |
| REST/WebSocket/身份/房间 | server 测试、client 类型检查；说明缺少的集成覆盖 |
| React Hook/Store/UI | client typecheck、lint；按现有测试能力补测试 |
| 播放同步/代理/持久化 | server 测试、client typecheck，并核对边界测试 |
| 构建或部署 | 不自行执行；向用户给出需要运行的命令和原因 |

不要用降低规则、删除断言、扩大 `any`、跳过测试或更新基线来掩盖失败。若现有环境或规则阻止某项验证，交付时明确列出未执行项和原因。

## 7. 文档、提交与交付

架构、协议、依赖、目录、部署或核心行为发生变化时，遵循
[`sync-architecture-docs.md`](sync-architecture-docs.md) 更新对应文档。修改 Agent 工作约定时同步更新 `.agent/rules/`。

提交标题使用 Conventional Commits，按实际范围使用 `client`、`server`、`shared`、`docs` 等 scope，例如：

```text
fix(server): 修复永久房间恢复状态
feat(client): 增加移动端队列操作
docs(agent): 完善主分支开发规范
```

交付前确认：

- `git status` 只包含当前任务文件，没有覆盖用户已有修改
- 协议、权限、持久化与跨端兼容语义一致
- 差异中没有敏感信息、调试残留、产物或本机路径
- 已执行与风险匹配且规则允许的检查
- 未执行的构建、集成或人工验证已明确说明
- 没有在未获授权时提交、推送、开 PR、合并或发布
