# Music Together Android 开发规范

本文件适用于整个 `codex/android-native-client` 分支。开始修改前先阅读 [Android 项目架构](docs/PROJECT_ARCHITECTURE.md)，并根据任务范围核对相关源码和测试。

## 1. 仓库范围

当前分支只维护原生 Android 客户端：

- Android 工程位于 `packages/android-client/`
- 应用源码位于 `packages/android-client/app/src/main/`
- Java Virtual Machine (JVM) 单元测试位于 `packages/android-client/app/src/test/`
- 持续集成 (CI) 位于 `.github/workflows/android.yml`
- Web 客户端、服务端和共享 TypeScript 协议位于仓库的 `main` 分支

修改事件、协议字段或 HTTP API 前，先核对兼容服务端中的共享类型、控制器和路由。本分支没有可同步修改的服务端源码。

## 2. 开发约定

开始工作前确认改动范围和授权：

1. 运行 `git status --short --branch`，保留用户已有改动
2. 只修改当前任务涉及的文件，不重排或格式化无关代码
3. 创建提交或推送前，确认用户已授权对应操作
4. 只授权提交时，完成 commit 后停止，不继续 push
5. 仅在用户明确要求发布时修改 `versionCode` 或 `versionName`
6. 不提交凭据、Cookie、日志、构建产物或本机绝对路径
7. 完成后运行与风险匹配的测试，并执行 `git diff --check`

项目使用 `kotlin.code.style=official`。命名、导入和状态更新沿用相邻文件的写法；注释用于解释协议约束、时间边界、兼容原因和生命周期行为。

### 仓库同步与冲突处理

同步远端时，先确认工作区状态和本地分支与上游分支的关系：

1. 运行 `git status --short --branch` 和 `git fetch`，再比较本地改动与远端变更
2. 工作区干净且当前分支仅落后于上游时，使用 `git pull --ff-only`
3. 存在未提交或未跟踪文件时，先核对远端是否修改相同路径；只有分支可以快进且路径不重叠时才继续
4. 路径重叠、分支分叉或状态无法确认时，停止同步并说明风险，等待用户选择处理方式
5. 未经用户确认，不执行以下操作：
   - 使用 `git stash` 隐藏工作区改动
   - 使用 `git merge` 或 `git rebase` 选择分支整合方式
   - 使用 `git reset --hard` 或 `git checkout -- <file_path>` 丢弃已跟踪文件的改动
   - 使用 `git clean` 删除未跟踪文件
6. 出现冲突时逐块核对双方意图，不整文件选择 `ours` 或 `theirs`；语义明确时合并并验证，否则等待用户确认

## 3. 代码边界

主要模块及其职责如下：

| 模块 | 职责 |
| --- | --- |
| `model/` | 不可变领域模型和界面状态 |
| `network/` | 服务端地址、HTTP、WebSocket、JSON、Cookie 和应用更新 |
| `player/` | ExoPlayer、MediaSession、时钟同步和漂移修正 |
| `lyrics/` | 歌词解析、Apple Music-like Lyrics (AMLL) 数据整形和本地偏移 |
| `ui/` | 大厅、房间、设置、账号和平台界面 |
| `ui/player/` | 播放器、横竖屏布局、播放模式和歌词渲染 |
| `notifications/` | 聊天通知 |
| `logging/` | 仅限 Debug 的日志记录与导出 |

新增代码遵循现有数据流：

- Compose 页面消费状态并调用操作方法，不直接管理网络、播放器或持久化对象
- `MusicTogetherViewModel` 聚合应用状态和业务操作
- 长算法、解析器和独立业务流程放入可测试的类或纯函数
- `AppState` 及其子状态使用不可变数据类和 `copy()` 更新
- 异步请求使用可取消的 `Job`，切换服务器、房间、曲目或查询时清理旧任务
- 新增服务端字段时同步更新模型、JSON 读写和往返测试

## 4. 兼容性约束

修改网络、播放或歌词流程时，保留以下跨版本和跨服务端约束。

### 网络与身份

网络连接和身份状态必须按服务器隔离：

- HTTP 和 HTTPS 服务端均受支持
- `/ws` 使用 OkHttp 原生 WebSocket
- Cookie 按 `scheme://host:port` 隔离
- discovery socket 只更新对应服务器的房间列表
- 只有 active socket 可以更新当前房间状态
- 平台 Cookie 只在用户主动退出对应账号时删除
- 旧服务端缺少可选字段时保留安全回退

### 播放同步

播放同步以服务端意图为准，并通过 Android 媒体组件执行：

- 房间状态是播放意图的来源，MediaSession 负责执行和系统媒体集成
- 计划动作优先按 `serverTimeToExecute` 执行
- 校时样本不足时立即执行，避免无限等待
- 小漂移使用保持音高的限幅变速，大漂移连续确认后执行硬 Seek
- 切歌、暂停和释放会取消修正任务，并恢复音量和 `1f` 播放速度
- 系统媒体按钮仍经过房间权限或投票逻辑
- 播放地址和封面地址使用不同的请求头策略

### 歌词

歌词布局和动画共享统一时间轴：

- 一首歌使用一个共享帧时钟
- 行切换和逐词进度使用同一时间源
- 激活状态变化不改变测量宽度和换行结果
- 上一行保留遮罩末态，强调效果平滑退场
- 背景人声参与布局，不覆盖下一句
- 歌词跳转会换算本地偏移并关闭当前间奏提示
- 算法调整需要保留等价测试，并检查横竖屏、快速切句、Seek 和切歌

## 5. 本地验证

构建需要 JDK 17 至 21 和 Android SDK 36。常用命令如下：

```powershell
cd packages/android-client
.\gradlew.bat testStandardDebugUnitTest
.\gradlew.bat lintStandardDebug
.\gradlew.bat assembleStandardDebug assembleVivoDebug
```

完整 Debug 门禁与 CI 一致：

```powershell
cd packages/android-client
.\gradlew.bat --no-daemon `
  testStandardDebugUnitTest `
  lintStandardDebug `
  assembleStandardDebug `
  assembleVivoDebug
```

按改动范围选择最低验证：

| 改动范围 | 最低验证 |
| --- | --- |
| Markdown | 空白检查，核对路径和命令 |
| 模型、解析器、算法 | 对应测试，完整 JVM 单元测试 |
| HTTP、WebSocket、JSON | 网络测试，完整单元测试，Lint |
| Compose 界面 | 完整单元测试，Lint，Standard Debug 构建 |
| 播放、Manifest、资源、flavor | 完整 Debug 门禁，检查相关变体 |
| 发布 | Debug 门禁，签名 Release 构建，签名与资产校验 |

工程包含 `standard` 和 `vivo` 两个 distribution flavor。涉及 Manifest、资源、FileProvider、更新包或应用 ID 时验证两个变体；保留 `vivo` 的 `cmccwm.mobilemusic` application ID。

## 6. 提交与发布

提交标题沿用 Conventional Commits，并总结主要结果：

```text
<type>(android): <主要结果>
```

标题下空一行，正文按行列出更新点、兼容处理和实际验证结果：

```text
<type>(android): <主要结果>

- <更新点一>
- <更新点二>
- <兼容处理或测试补充>
- <实际验证结果>
```

正文只记录已经完成的内容和实际通过的检查。独立领域优先拆分提交。版本号属于同一批功能或修复时，在该提交中一并更新，并在正文列出目标版本。只有版本号或发布元数据变化时，标题按实际内容概括即可；不为发布流程额外创建空提交。

推送中 `packages/android-client/app/build.gradle.kts` 的 `versionName` 发生变化时，CI 会触发签名 Release 构建和 GitHub Release 发布，与提交类型无关。发布前核对版本号、两个 flavor 的 Android Package (APK)、Standard Android App Bundle (AAB)、签名、SHA-256 和 Release 说明。

## 7. 交付检查

交付前确认：

- `git status` 只包含当前任务涉及的文件
- 没有覆盖用户已有改动
- 协议字段与兼容服务端一致
- Job、监听器、MediaController 和动画生命周期可以取消或释放
- 差异中没有敏感信息、调试残留、构建产物或本机路径
- 已运行与改动风险匹配的测试
- 未执行的检查已在交付说明中列出
- 架构、协议、构建或发布流程变化已同步更新文档
