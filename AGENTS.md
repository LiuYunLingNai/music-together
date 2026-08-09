# Music Together Windows 桌面端开发规范

本文件适用于整个 `codex/windows-native-client` 分支。开始修改前先阅读
[桌面端架构](docs/ARCHITECTURE.md)，并根据任务范围核对相关源码、测试、构建脚本和兼容服务端实现。

## 1. 仓库范围

当前分支只维护 Electron 桌面客户端：

- `electron/`：主进程、预加载桥、窗口生命周期、深链接和更新安装
- `src/`：React 渲染进程
- `src/domain/`：领域类型、权限、房间兼容和播放同步纯逻辑
- `src/services/`：HTTP、WebSocket、音频播放器与运行时编排
- `src/lyrics/`：TTML/YRC/LRC 解析和 Apple Music-like Lyrics (AMLL) 时间轴
- `src/store/`：Zustand 应用状态
- `scripts/`：Windows 打包和 smoke 测试
- `.github/workflows/build-windows.yml`：持续集成与 Windows Release

服务端、Web 客户端和共享 TypeScript 协议位于仓库 `main` 分支；Android 位于独立分支。本分支手工维护协议类型和事件名。修改 `src/domain/events.ts`、`src/domain/types.ts`、HTTP 路径或兼容字段前，必须先核对兼容服务端的 `packages/shared`、controller 和 route。

实时连接使用 `/ws` 原生 WebSocket，消息格式为：

```json
{ "event": "room:state", "data": {} }
```

不要使用 Socket.IO 客户端、ack 或 Socket.IO 专属重连行为。

## 2. 工作范围与 Git 约定

开始工作前：

1. 运行 `git status --short --branch`，保留用户已有改动
2. 只修改当前任务涉及的文件，不重排或格式化无关代码
3. 创建提交、推送或发布前，分别确认用户已授权对应操作
4. 只授权提交时，完成 commit 后停止，不继续 push
5. 仅在用户明确要求发布时修改 `package.json` 版本、changelog 或打包元数据
6. 不提交身份 Cookie、平台凭据、日志、下载的安装包、`dist/`、`dist-electron/`、`release/` 或本机绝对路径
7. 完成后运行与风险匹配的验证，并执行 `git diff --check`

### 仓库同步与冲突处理

1. 运行 `git status --short --branch` 和 `git fetch`，再比较本地与远端
2. 工作区干净且当前分支只落后上游时，使用 `git pull --ff-only`
3. 有本地改动时先核对远端是否修改相同路径
4. 路径重叠、分支分叉或状态不清楚时停止同步并说明风险
5. 未经用户确认，不执行 `git stash`、`merge`、`rebase`、`reset --hard`、`checkout -- <path>` 或 `clean`
6. 冲突逐块理解并合并，不整文件盲选 `ours` 或 `theirs`

## 3. 进程边界与安全

桌面端必须保持 Electron 主进程、预加载层和渲染进程的边界：

```text
Electron main
  -> BrowserWindow、系统集成、更新、文件和外链
    -> contextBridge 最小 API
      -> React renderer
        -> HTTP / WebSocket / HTMLAudioElement / Zustand
```

- 保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true` 和 `webSecurity: true`
- 渲染进程不得直接导入 `electron`、`node:*`、文件系统、进程或 Shell API
- 新系统能力通过 `preload.cts` 暴露窄接口，并在 `src/env.d.ts` 声明精确类型
- IPC channel 必须显式命名、校验参数和返回值；不要暴露通用 `send`、`invoke`、文件路径或命令执行接口
- 外部链接继续由主进程验证协议并交给系统浏览器；禁止任意新窗口和未受控导航
- 深链接只接受项目定义的房间链接格式，不把完整 URL 直接注入渲染进程
- 更新安装包必须同时匹配预期资产名和 SHA-256；校验失败不得执行安装
- 远程调试端口和 Debug 日志导出能力不得默认进入正式包；常驻诊断缓冲必须限制大小并避免记录 Cookie、密码、令牌和完整平台响应

修改进程边界、安全配置、IPC、更新或深链接时，必须同步检查 `electron/main.ts`、`electron/preload.cts`、类型声明、构建配置和对应 smoke 测试。

## 4. 渲染进程架构

主要模块职责：

| 模块 | 职责 |
| --- | --- |
| `components/` | 桌面布局、播放器、房间、搜索、设置和更新界面 |
| `domain/` | 无浏览器副作用的领域规则、兼容转换和类型 |
| `services/api.ts` | HTTP API、身份 Cookie 和响应解析 |
| `services/socket.ts` | `/ws` 信封、订阅和连接状态 |
| `services/audio-player.ts` | 唯一 `HTMLAudioElement`、播放进度和资源切换 |
| `services/runtime.ts` | 房间、协议、音频、歌词、重连和账号流程编排 |
| `lyrics/` | 歌词解析、分组、间奏、逐词进度和时间轴 |
| `store/app-store.ts` | 单一 Zustand 应用状态 |

新增代码遵循以下数据流：

- React 组件读取 Store 并调用 `runtime` 暴露的操作，不直接创建第二个 Socket 或 Audio 对象
- `runtime.ts` 负责跨模块编排；可独立测试的规则应下沉到 `domain/`、`lyrics/` 或小型 service
- 不继续向 `runtime.ts` 堆叠可独立维护的解析器、状态机或纯算法
- Store 使用不可变更新；房间、播放器和投票状态不要维护互相冲突的副本
- 切换服务器、离开房间和断开连接时释放 interval、timeout、事件监听和待处理请求
- 网络响应和 localStorage 内容视为不可信输入，先归一化再进入 Store
- 样式沿用现有桌面设计系统、CSS 变量和 Manrope 字体，不引入第二套组件库或无关 UI 框架

调整目录、模块职责、核心数据流、进程边界或发布方式时，在同一任务中更新 `docs/ARCHITECTURE.md`。修改工作约定时同步更新本文件。

## 5. 协议与兼容性

### 身份和连接

- 连接前通过 `/api/auth/identity/bootstrap` 建立服务端隔离身份
- 主进程按服务端来源隔离身份 Cookie，不跨服务器复用
- 服务器地址只接受 HTTP/HTTPS。当前主进程身份桥按 `origin` 构造 `/api`，而渲染层 Socket/API 直接拼接用户地址；如需支持反向代理基础路径，必须同时修改地址归一化、主进程身份请求、HTTP API、WebSocket 和对应测试，不能只修其中一层
- 重连使用 2、4、8、15、30 秒有限退避；切换服务器或主动断开时取消旧重连
- 只有当前 Socket 可以更新当前房间，旧连接的迟到事件必须被忽略
- 新服务端可选字段需要在 `domain/room-state.ts` 中提供安全默认值；不要破坏旧服务端

### 权限、房间和投票

- 房间状态和服务端角色是权威来源
- Owner/Admin 直接发送控制；Member 使用现有投票映射
- 系统媒体键和 Media Session 操作也必须经过房间权限或投票，不得只操作本地音频
- 临时管理员的删除歌曲和清空队列权限分别处理，旧服务端缺字段时默认关闭
- `hostId` 是播放主持，不等同于房主；自动下一曲只能由符合当前主持条件的客户端发送
- 房间密码和 Owner 专属字段不写入日志或普通成员可见状态

### 播放同步

- `DesktopAudioPlayer` 是唯一音频实例和播放进度来源
- NTP ping/pong 估算服务端时间偏移，计划动作按 `serverTimeToExecute` 执行
- 服务端播放状态决定曲目、暂停和期望进度，本地 UI 不建立第二套权威状态
- 小漂移仅在用户启用时通过限幅变速修正；大漂移硬 Seek 独立控制
- 切歌、暂停、断开和资源回退后恢复 `1` 倍速并清理旧调度
- Bilibili 和必须解密的酷狗音频使用服务端代理；允许直连时只做一次保留进度的代理回退
- 播放地址、封面代理和普通 HTTP 请求的请求头策略不得混用

### 歌词

- TTML、服务端逐词、YRC 和 LRC 解析顺序与服务端/Android 语义保持一致
- 一首歌只消费 `DesktopAudioPlayer` 的共享时间，不创建独立歌词计时器
- 普通 LRC 行时间与逐词歌词的提前聚焦策略要明确区分
- 翻译、音译、Ruby、背景人声、对唱和间奏不能在归一化过程中丢失
- 点击歌词 Seek 时换算本地偏移，并继续发送房间操作
- 算法修改必须覆盖快句、重叠、空歌词、Seek、暂停和切歌边界

## 6. 测试与验证

要求 Node.js 22 或更高版本。首次安装使用 `npm ci`；只有明确更新依赖时才使用 `npm install` 并提交一致的 lockfile。

常用命令：

```powershell
npm run typecheck
npm test
npm run lint
npm run build
npm run smoke:regressions
```

按改动范围选择最低验证：

| 改动范围 | 最低验证 |
| --- | --- |
| Markdown | 路径、命令、链接和 `git diff --check` |
| `domain/`、`lyrics/`、存储纯逻辑 | 对应 Vitest、完整 `npm test`、typecheck |
| React 组件或 Zustand | `npm test`、typecheck、lint、build |
| HTTP、WebSocket、runtime | 对应测试、完整测试、typecheck、lint、build |
| Electron 主进程、preload、IPC、深链接 | typecheck、测试、lint、build、`smoke:electron` 或等价人工验证 |
| 播放同步、自动下一曲、跨端协议 | 完整静态门禁、`smoke:online`；必要时双客户端回归 |
| 打包、更新、安装器 | 完整静态门禁、`smoke:regressions`、目标 Windows 包和校验文件检查 |

Smoke 测试边界：

- `smoke:online` 会访问真实服务端并创建身份/房间；运行前确认目标 `MT_SERVER_URL`
- `smoke:electron` 需要已启动且开放调试端口的 Electron 实例
- `smoke:regressions` 会通过调试协议操作桌面 UI，并可能影响测试房间状态
- 不要把脚本内默认公网服务端当作无副作用测试环境；无法确认影响时先使用受控服务端或征求用户同意

测试应描述可观察行为，隔离网络、时间、WebSocket、Audio、localStorage 和 Electron 桥，并在测试结束后恢复全局 mock。不要通过删断言、扩大 `any`、跳过测试或忽略 Promise 来获得绿色结果。

## 7. 打包与发布

- `npm run dist:win` 生成带调试能力的测试包
- `npm run dist:win:release` 生成正式 Windows 安装包和 Portable
- `release/` 只存本地产物，不提交
- 正式安装器、Portable、版本号、资产名和 SHA-256 必须一致
- 自动更新只支持已安装的 Windows 正式包；开发环境和 Portable 保持不支持提示
- 修改更新源、代理下载或资产匹配时，必须保留 HTTPS、状态码检查、流式写入和 SHA-256 校验
- 发布前核对 CI workflow、`package.json` 版本、changelog、NSIS/Portable 产物及安装验证

提交标题使用 Conventional Commits，并优先标明桌面端范围：

```text
fix(windows): 修复断线后的播放同步
feat(windows): 增加桌面深链接入口
docs(windows): 完善 Agent 开发规范
```

独立领域优先拆分提交。正文记录实际完成的主要改动；测试结果保留在交付说明中，不为发布创建无内容提交。

## 8. 交付检查

交付前确认：

- `git status` 只包含当前任务文件，没有覆盖用户已有改动
- Electron 安全开关、预加载边界和外链限制未被意外放宽
- 协议字段、事件和旧服务端回退与兼容服务端一致
- Socket、Audio、timer、listener、下载流和 IPC 生命周期可以释放
- 差异中没有 Cookie、凭据、调试端口、日志、产物或本机路径
- 已运行与改动风险匹配的测试，未运行项已说明原因
- 架构、协议、进程边界、构建或发布变化已同步更新文档
- 未在没有授权时提交、推送或发布
