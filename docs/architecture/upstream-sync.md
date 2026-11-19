# 上游同步策略

当前同步基线：`Yueby/music-together@d2b2d06`（已通过 `git merge -s ours` 记入历史，`git log HEAD..upstream/main` 只显示基线之后的新提交）。本 fork 采用“迁移能力和修复、保留本地架构”的方式同步，不直接合并覆盖。

## 已吸收的上游能力

| 范围           | 本 fork 的落地方式                                                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 播放一致性     | `PlayState.revision` 作为可选兼容字段；拒绝迟到动作、同曲恢复按代次幂等、入房计划进度补偿、同步响应校验 `trackId`                        |
| HTML5 音频定位 | 播放中直接更新媒体元素和 Howler 内部锚点，暂停/未就绪时回退公共 `seek()`；继续保留 SoundTouch 无变调纠偏                                 |
| 歌词与播放器   | AMLL core/react 0.6、lyric 1.1；补入逐词渐变、已播放行隐藏、敏感词遮罩、歌曲底栏；保留逐曲校准、TTML/YRC/KRC/LRC、多平台严格匹配与置信度择优、渐进加载缓存和流体背景 |
| 队列与投票     | 方向感知防抖、删除当前歌曲前确定后继、投票原子领取、成员/主持变化时重算门槛和否决权                                                      |
| 安全与网络     | 输入 schema、HTTP/Socket 限流、外部认证超时、封面代理重定向校验、WebSocket 载荷上限、原生 KRC 获取与解压                                 |
| 媒体与列表     | 稳定缩略图封面、加载失败回退、搜索/歌单/队列列表减少原图流量                                                                             |
| 工程治理       | Node 22 CI、冻结安装、服务端与 Vitest 测试、全工作区类型检查、lint、构建、生产依赖审计、Dependabot 和贡献/安全规范                       |

## 必须保留的 fork 差异

- 通信使用原生 `/ws` JSON 信封协议，并兼容 Android、Windows 客户端；不上游 Socket.IO 协议。
- 服务端是播放时间线最终权威；`hostId` 只负责兼容主持与自动下一首，不接受客户端权威进度覆盖。
- 保留 SQLite、永久房间、离线成员、账号/后台管理、临时管理员策略及房间级凭据池。
- 保留网易云、QQ、酷狗、概念版、哔哩哔哩音源，高级音质、服务端代理、下载和全局背景能力。
- 共享载荷的新字段应可选或具备默认值，避免要求原生客户端与服务端同时升级。

## 有意不跟随的破坏性版本迁移

以下上游变更主要是工具链或 API 大版本迁移，并非功能修复，当前不纳入同一批同步：Node 24/26、pnpm 11、Express 5、React Router 8 包迁移、Vite 8、TypeScript 6/7、ESLint 10、CASL 7、Lucide 1 和 Nano ID 6。

原因是现网和 Docker 基于 Node 22，原生客户端依赖当前协议，且这些升级会扩大回归面而不直接改善用户功能。安全补丁继续通过同主版本升级、`pnpm audit` 和 overrides 获取；后续若迁移，应独立建批次并同时验证非 Docker 部署、Docker、Web、Android 与 Windows。


## 基线 02f9447da 的取舍记录

已移植：房间密码试错锁定（同一身份同一房间 1 分钟内错 5 次）、`ROOM_CREATE`/`ROOM_JOIN` 限流、重连凭证 `ttlMs`（客户端从收到时刻起算）、歌单抓取不再信任调用方 `total` 且残缺歌单不写缓存、入队丢弃客户端 `streamUrl` 并限制封面为 https、搜索失败与无结果的区分（`SearchError`，含网易云业务码、酷狗 errcode）、页面卸载且非主动离开时发送 `ROOM_LEAVE`、按 ID/分享链接搜索（`shared/musicRef` + `server/idLookup`，歌手结果沿用 fork 的曲目外形）、队列模式（`queueMode`：保留已播放 / 播完即移除，含消耗队列里「上一首」从头重播与隐藏上一首按钮；与 fork 原有的「播放后移除歌曲」`removePlayedTracks` 并存，互不替代）。

fork 已具备：封面批量解析的单次超时与重试释放、网易云二维码检查超时（`transient`）与 `getUserInfo` 超时记为 error、QQ 请求超时、队列项 id 去重、`resumeTrack` 不回拨正在播放的房间、`playerPlaySchema`、NTP RTT 异常值过滤。

fork 不需要：酷狗登录 cookie 转 Meting 形式（fork 的酷狗取流完全走原生接口，不经过 Meting 的 `url()`）。

已核对并处理：QQ 空搜索与空封面不再缓存、Cookie 只在进房/重连/换房后补发（自动补发应答计数移到 `lib/authAutoResend`）、`HomePage` 只响应本页发起的创建/加入；fork 已具备：登录验证期间房间已销毁时不写 cookie 池（`captureAuthorization`）、暂停/加载完成时读取最新音量、歌词空结果短缓存；不适用：雷达歌单推荐不做缓存。

未同步，后续按需评估：`mapp` 相关改动。

待办（安全类，暂缓）：`POST /api/auth/identity/bootstrap` 按 IP 限流与 `TRUST_PROXY` 环境变量（当前 Express 未设置 trust proxy，反代下 `req.ip` 为代理地址，既有按 IP 的限流也受影响，默认值待定：1 对应反代部署，0 最保守）、同一身份最多同时创建 5 个房间（管理员与持久管理员不受限）、聊天限流改按身份计、`deployment.md` 补充 Cloudflare Tunnel 加反代时的 `TRUST_PROXY` 填法。

UI 重构评估：不移植设置项「提示图标 + tooltip」（上游随后的 51479941 又改回在标签下方显示说明，说明该方案被上游自己否定）；弹窗分页（`DialogNav`）与 fork 的独立弹窗结构冲突，且无功能收益，暂不移植。

## 基线 d2b2d06 的取舍记录

已移植：歌手主页与独立「音乐账号」对话框（含发现首页、头像与会员徽章）、网易云播放链接有效期与 v1 授权取流、账号事件 schema 校验、房间预检限流、日志去敏、musicProvider 拆分、已添加状态跟随队列。

未同步，后续按需评估：Discourse 迷你应用（`packages/mapp`、沙箱认证通道、宿主 API 表）、设置对话框改用 ui Tabs 与 Textarea、平台认证服务与 `useAuth`/`useSearch` 的测试补充、依赖大版本批量升级、`.pi/` 忽略项。

后续同步流程：`git fetch upstream` → `git log HEAD..upstream/main` 查看新提交 → 按上文策略移植 → 在同一提交或独立提交中 `git merge -s ours upstream/main` 并更新本节基线。

## refs-folia（folia-major）视觉基线

原有基线：`chthollyphile/folia-major@b7423b40`（v0.7.27 之后的 222 个提交，2026-11-11；末尾两个提交仅新增贡献者文档）。本地参考仓库为 `refs-folia`，移植结果在 `packages/client/src/components/Player/folia/upstream/`，宿主适配在 `folia/` 其余目录。2026-11-19 按 `folia-major@c6560bce` 补入下述视觉能力；该版本仅作为本批相关模块的参考版本，不表示已吸收基线后的所有提交。

已吸收：十八个歌词样式、六个背景族、样式过渡与换歌交接、共享字幕与字幕行布局（含后续歌词回退开关）、智能动感（`services/beatFx` + 分析链路）、雾笺窗外/水族箱/笔画按字号缩放、町景模拟节拍、可视化设置窗口（VisPlayground 及各模式/背景面板）、歌词渲染分辨率与抗锯齿、封面尺寸规则（QQ R1200、网易去参数、Monet/Nomand 全屏背景用原图）、上游歌词匹配评分（`packages/shared/src/lyricMatch.ts`）、跨源歌词搜索别名与无 `itunes:key` 的 TTML 兜底。

宿主差异（保留，不随上游）：Electron 壳与窗口交接、外部播放器与平台账号（Apple Music、Spotify）、OBS 通道与外观配置码、Lattice 封面墙与速记簿、桌面面板页签、Coven/Dedicatus 开发工具、自动 AI 分词（按次付费的 AI 请求）。窄视口一体胶囊只借用「展开态显示歌手与专辑」的信息，不搬桌面 compact dock。

后续同步：`git -C ../refs-folia log --oneline <基线>..HEAD` 查看新提交，按「迁移能力与修复、保留宿主架构」的方式移植，并在同一批更新本节基线。

## 2026-11-19 major / sonnet 视觉移植

| 来源 | 本批移植范围 |
| --- | --- |
| `folia-major@c6560bce` | 新增「隐喻」的流体墨迹、融球、网点、颗粒、镜头与切镜程序；回环增加位置和沿环翻译；莫奈增加镜像、人像来源、描述与拖动柄三档显隐、描边与扭曲参数，并补入绘制管线修复；时计增加倾斜、视差、中心视角、表盘封面、中心渐变、逐词辉光及对应 2D/WebGL 绘制修复。更新模式参数解析、边界限制和旧设置回退，以及 GlowWord、云阶的相关兼容修复。 |
| `folia-sonnet@c15169310` | 新增「提示词」的输入框、逐词落字、候选词和镜头编排，词表随源码打包；新增「文字 PV」与 `public/jizura/` 渲染页、独立引擎脚本和 MIT 许可，保留逐曲工程、排版快照、改词与时间轴校验；原版完整编辑页及专属桥已移除，参数由本体窗口编辑。 |

当前 Web 注册二十种歌词样式。新增样式沿用既有懒加载、主题、字幕、渲染质量与减少动态效果入口；歌词与播放头来自宿主播放器。文字 PV 工程键使用 `source:urlId`，避免同一首歌重新入队后因队列 ID 变化丢失编辑结果；工程保存在本设备的 `kinetic_projects`，最多六十首，不通过房间广播或账号同步。

宿主适配：文字 PV 参数改为本体歌词样式窗口的卡片、滑块和选择控件，原版完整编辑页及其专属播放控制、BroadcastChannel 桥接已删除；JIZURA 独立引擎和旧工程继续使用。窗口提供全局/逐曲模式，全局参数与 scope 存入 `foliaSettings.tunings.kinetic`，逐曲模式按歌曲自动读取和保存工程，缺少配置沿用全局；切换与重置只影响当前范围。逐曲歌词和工程 JSON 可编辑、导入导出，字体与字幕沿用现有窗口入口。滑块草稿直接驱动预览，参数修改清除旧 plan，歌词时间由宿主播放器保持权威。工程、plan 与源歌词校验防止切歌或歌词更新后还原旧词。

保留边界：本批只迁移上述视觉模块，不搬 major 的账号、仓储、播放同步、Electron 窗口或 mod 系统，也不搬 sonnet 的原生桥、移动端路由及其他背景族。`/ws` JSON 信封、共享 Track/RoomState 与服务端权威时间线不变，Android、Windows 旧客户端无需升级。本体文字 PV 窗口当前支持工程 JSON 导出，尚未接入原版逐镜头时间轴、MP4 和 PNG 序列导出；渲染引擎远程字体加载仍需要网络。
