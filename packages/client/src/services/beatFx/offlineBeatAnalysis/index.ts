/**
 * 离线拍点分析 —— Mineradio `03-beat/01-audio-beat-analysis.js` +
 * `03-beat/00-tempo-worker-cache-prefetch.js` + `03-beat/04-beat-map-runtime.js`
 * 的忠实移植。
 *
 * ============================ 它解决什么 ============================
 *
 * 上游的节拍运镜有两条路径：
 *
 *   ① **实时路径**（`processRealtimeBeatEngine`，本项目 `beatCamera.ts` 已移植）
 *      —— 只对**当前**这一帧的音频反应。命中即调度，无预判。
 *   ② **离线拍点图路径**（本模块）
 *      —— 开播后延迟分析整首歌，产出一张 `cameraBeats` 拍点图，之后
 *      `tickBeatMap()` 按 `lookahead = 0.075s` **提前**把即将到来的拍排进
 *      事件队列。事件在自己时刻前 75ms 就已就位，因此 attack 包络
 *      （最短 14ms）能在拍点上精确起跳，而不是等频谱涨起来才反应。
 *
 * 差别：实时路径的命中天然晚于拍点（要等能量越过阈值），冲击的**相位**
 * 系统性偏晚；离线路径的相位对得准。这就是上游要花 ~470 行做离线分析的原因。
 *
 * ============================ 移植范围 ============================
 *
 * **已移植**（本目录）：
 *   · `analyzeAudioBeats` 主干 —— 四频段离线渲染 → 10ms 帧能量 →
 *     onset 正向差分 → 滑动均值+标准差自适应阈值 → 局部峰检测 →
 *     网格锁定（`gridStep` 中位 gap）→ music-tempo 相位校正 → 产出拍点图
 *   · `music-tempo` Worker 桥（`00-tempo-worker-cache-prefetch.js` 的
 *     `analyzeMusicTempoInWorker` / `getMusicTempoWorkerUrl`）
 *   · `normalizeMusicTempoBeats` / `medianGap` / `estimateTempoPhaseOffset`
 *     / `applyCinemaProfileFromBeatMap` / `cinemaAnalysisProfileForSong`
 *   · `04-beat-map-runtime.js` 的 `tickBeatMap` /
 *     `syncBeatMapPlaybackCursor` / `triggerScheduledBeat` /
 *     `smoothBeatMapHandoff`（去掉磁盘缓存与队列预取，见下）
 *
 * **未移植（上游存在，本项目结构性不可达）**：
 *   · `02-podcast-dj-analysis.js`（814 行）与全部 `djMode` 分支 ——
 *     `djMode.active` 出厂恒 false（`00-state/03-beat-dj-state.js:87`），
 *     本项目无直播/DJ 音源。与 `beatCamera.ts` 已跳过的 DJ 分支同理。
 *   · 磁盘缓存 `readBeatDiskCache` / `writeBeatDiskCache` /
 *     `ensureBeatDiskCacheStatus`（依赖上游 `/api/beatmap/cache` 后端路由，
 *     本项目 server 无此接口）。
 *   · 队列预取 `scheduleQueueBeatPrefetch` / `runQueueBeatPrefetch` /
 *     `fetchBeatPrefetchAudioUrl` —— 上游 `QUEUE_BEAT_AUDIO_PREFETCH_ENABLED`
 *     **出厂为 false**，整条链上游自己就是关闭的。
 *   · `03-local-beat-cache-modal.js`（364 行）—— 上游的缓存管理弹窗 UI。
 *   · **softGroove 剖面全部**（约 280 行）—— 见下方单独说明。
 *
 * ============================ softGroove：为何未移植 ============================
 *
 * 上游 `cinemaAnalysisProfileForSong()`（`01-scene/02-beat-camera-runtime.js:115-130`）
 * 只对歌名/歌手匹配 `/日落大道|sunsetboulevard/` 的歌返回 softGroove 剖面，
 * 其余一律 `{ id: 'default', softGroove: false, … }`。
 *
 * softGroove 开启时会启用四个特性：`phaseScan`（`estimateSoftGrooveTempoOffset`）、
 * `localRefine`（`refineSoftGrooveBeatTime`）、`sparseCamera`
 * （`thinSoftGrooveCameraBeats`，含 `learnIntroPattern` / `buildIntroPatternBeats`
 *  的奇偶 gap 中位数与 rail phase 打分，约 80 行）、以及 `tempoMetrics` 循环里的
 *  一批分支。合计约 280 行，且是全文件最复杂的部分。
 *
 * **本模块原样移植了 `cinemaAnalysisProfileForSong`（含歌名判断）**，但
 * softGroove 那 280 行未移植：它对《日落大道》之外的任何歌曲都是死代码，
 * 而它是本项目不可能出现的那首歌的专属逻辑。这与 `beatCamera.ts` 跳过
 * DJ 分支是同一条判据 —— 上游恒假的路径不移植，但**判定函数本身**照搬，
 * 以便将来需要时能立刻定位差异。
 *
 * ============================ 红线 ============================
 *
 * · **不新增 AnalyserNode**（红线 2）。分析用的是 `OfflineAudioContext`
 *   独立渲染，与实时链路的 `AnalyserNode` 完全隔离。
 * · **不改音频路由**。fetch 的是同一份 `playbackUrl`，解码进临时
 *   `AudioContext`，用完即 `close()`。
 * · **只写 `beatCamera` 的拍点图与事件队列**，读 `getAudioTapRevision()`
 *   判切歌。单点驱动不变（红线 33）。
 * · 分析全程 `yieldToIdle` / `yieldToPaint` 让路，不在主线程长阻塞。
 */

export * from './beatAnalysisTypes'
export * from './beatTempoGrid'
export * from './beatMapRuntime'
export * from './beatAnalysisScheduler'
