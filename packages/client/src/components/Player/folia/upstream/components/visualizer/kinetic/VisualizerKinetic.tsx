/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/refs, react-hooks/immutability, react-hooks/set-state-in-effect, react-hooks/purity, react-refresh/only-export-components -- Adapted upstream visual runtime and its existing imperative lifecycle. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMotionValueEvent } from 'motion/react';
import type { Line, VisualizerFrameRate } from '../../../types';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import { useVisualizerRuntime } from '../runtime';
import type { VisualizerSharedProps } from '../definition';
import VisualizerShell from '../VisualizerShell';
import VisualizerSubtitleOverlay from '../VisualizerSubtitleOverlay';
import { resolveThemeFontStack } from '../../../utils/fontStacks';
import { useVisualizerSettingsStore } from '../../../adapters/hostStores';
import { readKineticProject } from './kineticProjectMemory';
import { getPlaybackSongKey } from '../../../adapters/kineticPlayback';
import { usePlaybackStore } from '../../../adapters/kineticPlayback';
import { pickConcreteFontFamily, resolveKineticFontPayload } from './kineticFontBridge';
import type { KineticFontPayload } from './kineticFontBridge';
import { kineticPlanMatchesLyrics, resolveKineticProjectLyrics } from './kineticEditorIdentity';
import { kineticLrc, kineticProjectFromTuning, normalizeKineticTuning } from './kineticSettings';

// src/components/visualizer/kinetic/VisualizerKinetic.tsx
// 文字PV：渲染完全交给 JIZURA 原版引擎（public/jizura/render.html，iframe 桥）。
// folia 把歌词（LRC）、主题四色、AI 关键字色、主题字体与播放时间推给它；
// 桥的握手做了重发：iframe 加载完成就先发，收到 ready 的 ack 前每 300ms 重发一次。

type VisualizerKineticProps = VisualizerSharedProps;

/** 歌词行转 LRC 文本（原版 parseLyrics 认这个格式）。 */
/** 当前时间落在哪一句：只在跨句时变化（离散状态）。 */
const resolveLineAt = (list: Line[], now: number, fallback: number) => {
    if (!list.length) return -1;
    for (let i = 0; i < list.length; i++) {
        const line = list[i];
        const next = list[i + 1];
        const end = next ? next.startTime : Number.POSITIVE_INFINITY;
        if (now >= line.startTime && now < end) return i;
    }
    return Math.min(fallback, list.length - 1);
};

const VisualizerKinetic: React.FC<VisualizerKineticProps> = (props) => {
    const {
        currentTime,
        currentLineIndex,
        lines,
        theme,
        subtitleTheme,
        audioPower,
        audioBands,
        showText = true,
        lyricsFontScale = 1,
        subtitleFontScale = 1,
        subtitleOverlayOpacity,
        subtitleOverlayBackground,
        subtitleUpcomingLyricsBlur,
        isPlayerChromeHidden = false,
        hideTranslationSubtitle = false,
        subtitleOverlayLayout,
        paused: playbackPaused = false,
        staticMode = false,
    } = props;
    const paused = playbackPaused || staticMode || !showText;

    const [windowSize, setWindowSize] = useState(() => ({
        width: typeof window === 'undefined' ? 1200 : window.innerWidth,
        height: typeof window === 'undefined' ? 800 : window.innerHeight,
    }));
    useEffect(() => {
        const observer = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry) return;
            const { width, height } = entry.contentRect;
            setWindowSize((previous) => (
                Math.round(previous.width) === Math.round(width) && Math.round(previous.height) === Math.round(height)
                    ? previous
                    : { width, height }
            ));
        });
        observer.observe(document.documentElement);
        return () => observer.disconnect();
    }, []);

    const { activeLine, recentCompletedLine, nextLines } = useVisualizerRuntime({
        currentTime,
        currentLineIndex,
        lines,
        getLineEndTime: getLineRenderEndTime,
    });

    /* ---- 这首歌的键：编辑结果按它存，换歌/重启都能还原 ---- */
    const currentSong = usePlaybackStore(state => state.currentSong);
    const songKey = useMemo(() => (currentSong ? getPlaybackSongKey(currentSong) : null), [currentSong]);

    /* ---- LRC：行集合变了才重算 ---- */
    const lrc = useMemo(() => kineticLrc(lines), [lines]);
    const tuning = useMemo(() => normalizeKineticTuning(props.kineticTuning), [props.kineticTuning]);

    /* ---- 主题字体：folia 主题的字体栈接到原版 display（見出し）字位上 ---- */
    const fontFamily = useMemo(() => {
        if (!theme) return '';
        try {
            const stack = resolveThemeFontStack({ fontStyle: theme.fontStyle, fontFamily: theme.fontFamily, fontFamilyStack: theme.fontFamilyStack });
            // 取第一个「真字体名」而不是第一个 token：
            // 字体栈一般以 system-ui / sans-serif 这类通用关键字打头，它们注册不进引擎。
            return pickConcreteFontFamily(stack);
        } catch {
            return '';
        }
    }, [theme]);

    /**
     * 字体的实际载荷：上传字体要把字节读出来送进 iframe。
     *
     * 渲染页是独立文档，宿主注册的 @font-face 它看不到 ——
     * 用户上传的字体（族名 FoliaUploadedLyricsFont_xxx）在 Google Fonts 上也不存在，
     * 所以必须把字节整份送过去，否则怎么都显示不出那个字。
     */
    const [fontPayload, setFontPayload] = useState<KineticFontPayload | null>(null);
    useEffect(() => {
        let cancelled = false;
        if (!fontFamily) {
            setFontPayload(null);
            return () => { cancelled = true; };
        }
        resolveKineticFontPayload(fontFamily, theme?.fontWeight)
            .then((payload) => {
                if (cancelled) return;
                setFontPayload(payload);
                console.log('[Kinetic] 字体载荷已准备', {
                    family: payload?.family,
                    hasBytes: Boolean(payload?.data),
                    bytes: payload?.data?.byteLength,
                });
            })
            .catch((error) => {
                if (cancelled) return;
                setFontPayload(null);
                console.warn('[Kinetic] 字体载荷准备失败', error);
            });
        return () => { cancelled = true; };
    }, [fontFamily, theme?.fontWeight]);

    /* ---- 主题四色 + AI 关键字高亮色：接进原版 colors（bg/文字/辅助/强调） ---- */
    const themeColors = useMemo(() => ({
        bg: theme?.backgroundColor || '#0a0a0a',
        fg: theme?.primaryColor || '#f4f4f5',
        sub: theme?.secondaryColor || '#a1a1aa',
        accent: theme?.accentColor || '#f4f4f5',
    }), [theme?.backgroundColor, theme?.primaryColor, theme?.secondaryColor, theme?.accentColor]);
    const wordColors = theme?.wordColors;

    /**
     * 推给引擎的 project：歌词 + 主题四色 + 关键字色 + 主题字体。
     * 只在内容真的变了才换引用 —— 引擎每收到一条 project 就重算一遍完整 plan，
     * 播放中每秒推 24 次会让原版排版一直在重算，真机上直接卡死。
     */
    /**
     * 这首歌上次在编辑台调好的工程。
     *
     * 有就整份盖上来（样式、种子、fx、配色、字体、逐行覆盖都是用户的心血）；
     * 没存过就用 folia 主题的四色与字体做初始值。换歌时会重新读一次，
     * 所以每首歌各记各的，不会串味。
     */
    const [projectRevision, setProjectRevision] = useState(0);
    useEffect(() => {
        const refresh = () => setProjectRevision(revision => revision + 1);
        window.addEventListener('kinetic:project-saved', refresh);
        return () => window.removeEventListener('kinetic:project-saved', refresh);
    }, []);
    const storedProject = useMemo(() => readKineticProject(songKey), [songKey, projectRevision]);
    // Sample thumbnails must never borrow a real song's saved settings or text.
    const savedProject = tuning.scope === 'song' && !props.kineticTuning?.previewDraft
        && (!props.isPreviewMode || storedProject?.sourceLyrics === lrc) ? storedProject : null;
    const savedProjectKey = savedProject ? JSON.stringify(savedProject) : '';

    const projectKey = `${lrc}\u0000${songKey ?? ''}\u0000${savedProjectKey}\u0000${JSON.stringify(tuning)}\u0000${themeColors.bg}\u0000${themeColors.fg}\u0000${themeColors.sub}\u0000${themeColors.accent}\u0000${fontFamily}\u0000${fontPayload?.family ?? ''}\u0000${wordColors ? JSON.stringify(wordColors) : ''}`;
    /** 上次保存下来的 plan：重启后靠它原样还原排版。 */
    // 新工程必须与当前宿主源精确一致（含时间戳），legacy 无来源工程不恢复旧 plan。
    const savedPlan = savedProject?.sourceLyrics === lrc ? savedProject.plan ?? null : null;
    const savedPlanRef = useRef(savedPlan);
    savedPlanRef.current = savedPlan;

    const project = useMemo(() => {
        // 把 plan 从参数里摘掉：它是排版快照，单独通过 'plan' 消息送，
        // 混在 project 里会让每条 project 消息都变重。
        const rest = { ...(savedProject ?? kineticProjectFromTuning(tuning)) } as Record<string, unknown>;
        delete rest.plan;
        return {
        ...rest,
        lyrics: resolveKineticProjectLyrics(tuning.scope === 'song' ? storedProject : null, lrc),
        sourceLyrics: lrc,
        seed: savedProject?.seed ?? tuning.seed,
        // 配色：存过的优先（用户在编辑台改过），否则用 folia 主题四色。
        colors: savedProject?.colors ?? (tuning.colorSource === 'style' ? { enabled: false } : { ...themeColors, enabled: true, accentOn: true }),
        fonts: savedProject?.fonts ?? (fontFamily ? { display: fontFamily } : undefined),
        // 字体载荷：上传字体带着字节，渲染页据此 new FontFace 注册 —— 只传名字它永远装不上。
        fontPayload: fontPayload ?? undefined,
        wordColors: tuning.colorSource === 'theme' ? wordColors : undefined,
        };
    }, [projectKey]);

    /* ---- iframe 桥：加载完成先发一次；收到 ready 前每 300ms 重发 ---- */
    const frameRef = useRef<HTMLIFrameElement | null>(null);
    const [frameReady, setFrameReady] = useState(false);
    const handshakeRef = useRef<number>(0);
    const handshakeTimeoutRef = useRef<number>(0);
    const projectRef = useRef(project);
    projectRef.current = project;
    const songKeyRef = useRef(songKey);
    songKeyRef.current = songKey;
    const projectRefKey = useRef(projectKey);
    projectRefKey.current = projectKey;
    const viewportRef = useRef({ width: windowSize.width, height: windowSize.height, dpr: 1 });
    viewportRef.current = { width: windowSize.width, height: windowSize.height, dpr: Math.min(2, window.devicePixelRatio || 1) };

    /** 上一次推过去的工程签名：同签名不重复推（引擎收到就重算 plan）。 */
    const sentKeyRef = useRef('');

    /**
     * folia「性能与动效」里的帧率上限，原样传给渲染页。
     *
     * iframe 是独立文档，有自己的 requestAnimationFrame，宿主那套限帧器管不到它，
     * 所以这里读出来随消息带过去；'off' 就是不限，让引擎贴着屏幕刷新率跑。
     */
    const visualizerFrameRate = useVisualizerSettingsStore(state => state.visualizerFrameRate);
    const frameCapRef = useRef<VisualizerFrameRate>(visualizerFrameRate);
    frameCapRef.current = visualizerFrameRate;
    useEffect(() => {
        const target = frameRef.current?.contentWindow;
        if (!target) return;
        target.postMessage({
            target: 'jizura-render',
            type: 'frameRate',
            frameCap: visualizerFrameRate,
        }, '*');
        sentKeyRef.current = '';
    }, [visualizerFrameRate]);

    /** 推工程：内容签名变了才发，避免播放中每秒重算原版排版。 */
    const sendProject = (force = false) => {
        const target = frameRef.current?.contentWindow;
        if (!target) return false;
        const signature = `${projectRefKey.current}|${viewportRef.current.width}x${viewportRef.current.height}`;
        if (!force && signature === sentKeyRef.current) return true;
        sentKeyRef.current = signature;
        target.postMessage({
            target: 'jizura-render',
            type: 'project',
            songKey: songKeyRef.current,
            project: projectRef.current,
            resetPlan: !savedPlanRef.current,
            viewport: viewportRef.current,
            time: currentTime.get(),
            // playing 必须带上：渲染页据它决定时间是否推进，
            // 不带的话 Boolean(undefined) 恒为 false，画面就该停在原地。
            playing: !pausedRef.current,
            frameCap: frameCapRef.current,
        }, '*');
        return true;
    };

    /**
     * 启动时把上次保存的 plan 推给渲染页。
     *
     * 这是「编辑完是好的、重启之后完全不一样」的修法：播放页只拿参数重算，
     * 会因音频 beats / 背景历史等运行时状态算出另一套排版；有存下来的 plan 就直接照它画。
     * 每一帧都重发没必要，靠 frameReady 与 songKey 变化触发即可。
     */
    const sentPlanKeyRef = useRef('');
    useEffect(() => {
        if (!savedPlan) { sentPlanKeyRef.current = ''; return; }
        if (!frameReady) return;
        const target = frameRef.current?.contentWindow;
        if (!target) return;
        /*
         * 比例预检：把注定会被渲染页拒掉的 plan 提前挡下来。
         *
         * 存下来的 plan 是编辑台当时的构图比例，重启后屏幕方向/尺寸可能已经变了；
         * 硬塞过去渲染页也会拒（比例差 >2%），不如这里就跳过，
         * 让它按当前屏幕重算 —— 否则容易停在一次被拒的消息上，画面就一直拉不回来。
         */
        /*
         * 歌词校验：plan 里的 cuts 对应的是**保存那一刻的歌词**。
         * 换歌/改词之后如果还照它画，画面就是旧歌词 —— 探针里那种
         * 「重建了但歌词还是旧的」就是这条路径。逐行对不上就放弃还原。
         */
        const planLines = Array.isArray((savedPlan as { lines?: unknown }).lines)
            ? ((savedPlan as { lines: Array<{ text?: unknown }> }).lines)
            : [];
        /*
         * 归一化签名比对，不逐行比。
         *
         * plan.lines[].text 是 parseLyrics 归一化后的结果（08_planner.js）：
         * 剥 | 注释、剥行尾 !、*强调* 去星号、/ 切分按拉丁字母决定拼接方式。
         * 宿主侧对 LRC 做同样的归一化再比 —— 上一版只去空白，带记法的歌词
         * 必然误判不一致（review 必须改 #9）。
         */
        if (!kineticPlanMatchesLyrics(savedPlan, String(project.lyrics))) {
            console.log('[Kinetic] 保存的 plan 与当前歌词不一致，跳过还原', { songKey, planLines: planLines.length });
            return;
        }
        const planW = Number(savedPlan.W);
        const planH = Number(savedPlan.H);
        const boxW = windowSize.width;
        const boxH = windowSize.height;
        if (planW > 0 && planH > 0 && boxW > 0 && boxH > 0) {
            const drift = Math.abs(planW / planH - boxW / boxH) / (boxW / boxH);
            if (drift > 0.02) {
                console.log('[Kinetic] 保存的 plan 与当前屏幕比例不符，跳过还原、按屏幕重算', {
                    plan: `${planW}x${planH}`,
                    screen: `${boxW}x${boxH}`,
                    drift: +drift.toFixed(3),
                });
                sentPlanKeyRef.current = '';
                return;
            }
        }
        const key = `${songKey ?? ''}|${JSON.stringify(savedPlan)}`;
        if (sentPlanKeyRef.current === key) return;
        sentPlanKeyRef.current = key;
        // 歌曲/歌词身份先于 plan 到达；否则渲染页仍持有上一首，会正确拒掉这份新 plan。
        sendProject();
        target.postMessage({
            target: 'jizura-render',
            type: 'plan',
            songKey,
            sourceLyrics: lrc,
            plan: savedPlan,
            time: currentTime.get(),
            playing: !pausedRef.current,
        }, '*');
        console.log('[Kinetic] 已用保存的 plan 还原排版', {
            W: planW,
            H: planH,
            style: savedPlan.styleKey,
            songKey,
        });
    }, [frameReady, savedPlan, songKey, lrc, windowSize.width, windowSize.height]);

    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            const data = event.data;
            if (event.source === frameRef.current?.contentWindow && data && data.source === 'jizura-render') {
                if (data.type === 'boot' || data.type === 'ready') {
                    console.log('[Kinetic] 原版引擎', data.type, { ready: data.ready, cuts: data.cuts });
                    setFrameReady(data.type === 'ready');
                    if (data.type === 'ready' && handshakeRef.current) {
                        window.clearInterval(handshakeRef.current);
                        handshakeRef.current = 0;
                    }
                    if (data.type === 'ready' && handshakeTimeoutRef.current) {
                        window.clearTimeout(handshakeTimeoutRef.current);
                        handshakeTimeoutRef.current = 0;
                    }
                    // 一收到回应就把当前工程与时间推过去。
                    sendProject(data.type === 'boot');
                } else if (data.type === 'error') {
                    console.warn('[Kinetic] 原版引擎错误', data.reason);
                }
            }
        };
        window.addEventListener('message', onMessage);
        return () => {
            window.removeEventListener('message', onMessage);
            if (handshakeRef.current) {
                window.clearInterval(handshakeRef.current);
                handshakeRef.current = 0;
            }
            window.clearTimeout(handshakeTimeoutRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /** iframe 加载完成：启动握手重发，直到原版回话为止。 */
    const onFrameLoad = () => {
        setFrameReady(false);
        sendProject(true);
        if (handshakeRef.current) window.clearInterval(handshakeRef.current);
        handshakeRef.current = window.setInterval(() => {
            sendProject(true);
        }, 300);
        // 兜底：8 秒后停止重发（引擎可能不在这个环境运行）。
        window.clearTimeout(handshakeTimeoutRef.current);
        handshakeTimeoutRef.current = window.setTimeout(() => {
            if (handshakeRef.current) {
                window.clearInterval(handshakeRef.current);
                handshakeRef.current = 0;
                console.warn('[Kinetic] 原版引擎握手超时');
            }
        }, 8000);
    };

    /* ---- project / viewport 变了：重新推一次 ---- */
    useEffect(() => {
        if (!frameReady) return;
        sendProject();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [frameReady, project, windowSize.width, windowSize.height]);

    /* ---- 播放头：引擎按 fps 自己连续出帧，这里只在状态翻转与跨句时校准时间 ---- */
    const [cutLineIndex, setCutLineIndex] = useState(currentLineIndex);
    const lastClockRef = useRef(currentTime.get());
    useEffect(() => {
        setCutLineIndex(currentLineIndex);
    }, [currentLineIndex]);
    /** playing 一起发：引擎据此决定是继续推进时间还是停在原地。 */
    const postSeek = (time: number, playing = !pausedRef.current) => {
        const target = frameRef.current?.contentWindow;
        if (target) target.postMessage({ target: 'jizura-render', type: 'seek', time, playing }, '*');
    };
    useMotionValueEvent(currentTime, 'change', (latest: number) => {
        // 跨句时校准一次，句内交给引擎自绘（每帧都发会让原版不停重算排版）。
        const next = resolveLineAt(lines, latest, cutLineIndex);
        const jumped = Math.abs(latest - lastClockRef.current) > 0.5;
        lastClockRef.current = latest;
        if (next !== cutLineIndex || (pausedRef.current && !staticMode) || jumped) {
            setCutLineIndex(next);
            postSeek(latest, !pausedRef.current);
        }
    });

    // 播放/暂停翻转时校准一次，保证画面与播放头对齐。
    const pausedRef = useRef(paused);
    pausedRef.current = paused;
    useEffect(() => {
        if (frameReady) postSeek(currentTime.get(), !paused);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [paused, frameReady]);

    return (
        <VisualizerShell
            theme={theme}
            audioPower={audioPower}
            audioBands={audioBands}
            sharedProps={props}
        >
            {/* 舞台只负责显示：pointer-events-none 让触摸穿过去，
                否则铺满屏幕的 iframe 会吃掉「点屏幕隐藏 UI / 返回手势 / 左右滑动切歌」。 */}
            <div className="pointer-events-none absolute inset-0" data-kinetic-stage>
                {/* 常驻挂载：切歌词显隐只改可见性。卸载一次就要重载 2MB 引擎并重建 plan，
                    在真机上等于一次长卡，也是帧率掉到 13fps 的来源之一。 */}
                <iframe
                    ref={frameRef}
                    src="/jizura/render.html"
                    title="文字PV"
                    data-picture-canvas-frame
                    className="pointer-events-none absolute inset-0 h-full w-full border-0"
                    style={{ visibility: showText ? 'visible' : 'hidden' }}
                    onLoad={onFrameLoad}
                />
            </div>
            <VisualizerSubtitleOverlay
                showText={showText}
                activeLine={activeLine}
                recentCompletedLine={recentCompletedLine}
                nextLines={nextLines}
                theme={subtitleTheme ?? theme}
                subtitleTheme={subtitleTheme}
                translationFontSize={`clamp(${(1.05 * lyricsFontScale).toFixed(3)}rem, ${(2.2 * lyricsFontScale).toFixed(3)}vw, ${(1.2 * lyricsFontScale).toFixed(3)}rem)`}
                upcomingFontSize={`clamp(${(0.875 * lyricsFontScale).toFixed(3)}rem, ${(1.8 * lyricsFontScale).toFixed(3)}vw, ${(1 * lyricsFontScale).toFixed(3)}rem)`}
                subtitleOverlayOpacity={subtitleOverlayOpacity}
                subtitleOverlayBackground={subtitleOverlayBackground}
                subtitleUpcomingLyricsBlur={subtitleUpcomingLyricsBlur}
                subtitleFontScale={subtitleFontScale}
                isPlayerChromeHidden={isPlayerChromeHidden}
                hideTranslationSubtitle={hideTranslationSubtitle}
                subtitleOverlayLayout={subtitleOverlayLayout}
            />
        </VisualizerShell>
    );
};

export default VisualizerKinetic;
