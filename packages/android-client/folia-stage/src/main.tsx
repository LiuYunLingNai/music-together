import React, {
  Suspense,
  useState,
  Component,
  useEffect,
  useMemo,
} from "react";
import { createRoot } from "react-dom/client";
import "./i18n";
import StageBackdrop from "./StageBackdrop";
import StageSettingsPanel from "./StageSettingsPanel";
import {
  styleTunings as adapters,
  getStyleBundle,
  useVisualizerSettingsStore,
  getBackgroundConfig,
  beginSettingsDrag,
  commitSettingsDrag,
} from "./tuningStore";
import { useStageAssets } from "./stageAssets";
import { useStageFonts } from "./StageFonts";
import VisualizerHarmonyOverlay from "../.work/src/components/visualizer/VisualizerHarmonyOverlay";
import { usePlaybackStore, useVisualizerAssetStore } from "./hostStores";
import {
  audioBands as bands,
  audioPower as power,
  lyricCurrentTime as time,
  currentTime,
  actuallyPlaying,
} from "../.work/src/stores/motionSignals";
import { annotateLyricLines } from "../.work/src/utils/lyrics/renderHints";
import {
  loadIcuFolia,
  applyAutoWordSegmentation,
} from "../.work/src/utils/lyrics/icuFolia";
import { applyPushedPhoneInsets } from "./phoneInsets";
import { updateStageViewport } from "./stageViewport";
import "./stage.css";
import { BUILTIN_VISUALIZER_MODES } from "../.work/src/types/visualizerModes";
import type { VisualizerSharedProps } from "../.work/src/components/visualizer/definition";
const modules = import.meta.glob([
  "../.work/src/components/visualizer/blank/VisualizerBlank.tsx",
  "../.work/src/components/visualizer/cadenza/VisualizerCadenza.tsx",
  "../.work/src/components/visualizer/cappella/VisualizerCappella.tsx",
  "../.work/src/components/visualizer/claddagh/VisualizerCladdagh.tsx",
  "../.work/src/components/visualizer/classic/Visualizer.tsx",
  "../.work/src/components/visualizer/diorama/VisualizerDiorama.tsx",
  "../.work/src/components/visualizer/fume/VisualizerFume.tsx",
  "../.work/src/components/visualizer/hanabi/VisualizerHanabi.tsx",
  "../.work/src/components/visualizer/kinetic/VisualizerKinetic.tsx",
  "../.work/src/components/visualizer/lumiere/VisualizerLumiere.tsx",
  "../.work/src/components/visualizer/machi/VisualizerMachi.tsx",
  "../.work/src/components/visualizer/monet/VisualizerMonet.tsx",
  "../.work/src/components/visualizer/nebbia/VisualizerNebbia.tsx",
  "../.work/src/components/visualizer/partita/VisualizerPartita.tsx",
  "../.work/src/components/visualizer/pendolo/VisualizerPendolo.tsx",
  "../.work/src/components/visualizer/prompt/VisualizerPrompt.tsx",
  "../.work/src/components/visualizer/sonnet/VisualizerSonnet.tsx",
  "../.work/src/components/visualizer/still/VisualizerStill.tsx",
  "../.work/src/components/visualizer/tempera/VisualizerTempera.tsx",
  "../.work/src/components/visualizer/tilt/VisualizerTilt.tsx",
]);
const names: Record<string, string> = {
  classic: "Visualizer",
  blank: "VisualizerBlank",
  cadenza: "VisualizerCadenza",
  cappella: "VisualizerCappella",
  claddagh: "VisualizerCladdagh",
  diorama: "VisualizerDiorama",
  fume: "VisualizerFume",
  hanabi: "VisualizerHanabi",
  kinetic: "VisualizerKinetic",
  lumiere: "VisualizerLumiere",
  machi: "VisualizerMachi",
  monet: "VisualizerMonet",
  nebbia: "VisualizerNebbia",
  partita: "VisualizerPartita",
  pendolo: "VisualizerPendolo",
  prompt: "VisualizerPrompt",
  sonnet: "VisualizerSonnet",
  still: "VisualizerStill",
  tempera: "VisualizerTempera",
  tilt: "VisualizerTilt",
};
const renderers = Object.fromEntries(
  BUILTIN_VISUALIZER_MODES.map((mode) => [
    mode,
    React.lazy(
      modules[
        "../.work/src/components/visualizer/" +
          mode +
          "/" +
          names[mode] +
          ".tsx"
      ] as any,
    ),
  ]),
);
const initial: VisualizerSharedProps = {
  currentTime: time,
  currentLineIndex: -1,
  lines: [],
  theme: {
    name: "Folia",
    backgroundColor: "#080a0f",
    primaryColor: "#fff",
    secondaryColor: "#d5c9b5",
    accentColor: "#d1ac72",
    fontStyle: "sans",
    animationIntensity: "normal",
  },
  audioPower: power,
  audioBands: bands,
  paused: true,
  isPreviewMode: false,
  isPlayerChromeHidden: true,
};
class StageBoundary extends Component<
  { children: React.ReactNode; mode: string },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    (window as any).__foliaFailure = this.props.mode;
    window.MusicTogetherStage?.postMessage(
      JSON.stringify({ event: "error", mode: this.props.mode }),
    );
  }
  render() {
    return this.state.failed ? (
      <div className="absolute inset-0 flex items-center justify-center text-center p-8">
        舞台暂时无法渲染，请切换舞台或退出沉浸模式
      </div>
    ) : (
      this.props.children
    );
  }
}
let documentGeneration = 0;
function App() {
  const [mode, setMode] = useState("sonnet");
  const [props, setProps] = useState(initial);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settings = useVisualizerSettingsStore();
  const assets = useVisualizerAssetStore();
  useStageAssets();
  const fonts = useStageFonts();
  useEffect(() => {
    let mounted = true;
    (window as any).FoliaStage = {
      resizeViewport: updateStageViewport,
      settings: (open: boolean) => setSettingsOpen(open),
      document: (data: any) => {
        const generation = ++documentGeneration;
        const next = {
          ...data,
          lines: annotateLyricLines(data.lines ?? []),
          onLyricLineSeek: (position: number) => {
            if (Number.isFinite(position) && position >= 0)
              window.MusicTogetherStage?.postMessage(
                JSON.stringify({ event: "seek", position }),
              );
          },
        };
        setProps((p) => ({ ...p, ...next }));
        usePlaybackStore.setState({
          currentSong: data.songTitle
            ? {
                id: data.seed,
                source: "native",
                title: data.songTitle,
                artist: data.songArtist,
                album: data.songAlbum,
                coverUrl: data.coverUrl,
              }
            : null,
          lyrics: { lines: next.lines },
        });
        if (data.insets) applyPushedPhoneInsets(data.insets);
        if (
          next.lines.some((line: any) =>
            /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(
              line.fullText,
            ),
          )
        )
          void loadIcuFolia().then((ready) => {
            if (!mounted || !ready || generation !== documentGeneration) return;
            const baked = applyAutoWordSegmentation({ lines: next.lines });
            if (baked) setProps((p) => ({ ...p, lines: baked.lines }));
          });
      },
      mode: (id: string) => {
        if (id in renderers) {
          setMode(id);
          useVisualizerSettingsStore.setState({ visualizerMode: id });
        }
      },
      frame: (data: any) => {
        time.set(data.position);
        currentTime.set(data.playbackPosition ?? data.position);
        actuallyPlaying.set(data.paused ? 0 : 1);
        usePlaybackStore.setState({
          playerState: data.paused ? "PAUSED" : "PLAYING",
          currentLineIndex: data.lineIndex,
        });
        window.dispatchEvent(
          new CustomEvent("kinetic:time", { detail: { time: data.position } }),
        );
        power.set(data.power || 0);
        for (const key of ["bass", "lowMid", "mid", "vocal", "treble"] as const)
          bands[key].set(data[key] || 0);
        bands.spectrum.set(Uint8Array.from(data.spectrum || []));
        setProps((p) =>
          p.currentLineIndex === data.lineIndex &&
          p.paused === data.paused &&
          p.isPlayerChromeHidden === (data.chromeHidden ?? true) &&
          p.staticMode === (data.staticMode ?? false)
            ? p
            : {
                ...p,
                currentLineIndex: data.lineIndex,
                paused: data.paused,
                isPlayerChromeHidden: data.chromeHidden ?? true,
                staticMode: data.staticMode ?? false,
              },
        );
      },
    };
    const seek = (event: Event) => {
      const position = (event as CustomEvent).detail?.time;
      if (Number.isFinite(position) && position >= 0)
        window.MusicTogetherStage?.postMessage(
          JSON.stringify({ event: "editorSeek", position }),
        );
    };
    const toggle = (event: Event) =>
      window.MusicTogetherStage?.postMessage(
        JSON.stringify({
          event: (event as CustomEvent).detail?.playing ? "play" : "pause",
        }),
      );
    window.addEventListener("kinetic:seek", seek);
    window.addEventListener("kinetic:toggle-play", toggle);
    window.MusicTogetherStage?.postMessage(JSON.stringify({ event: "ready" }));
    return () => {
      mounted = false;
      window.removeEventListener("kinetic:seek", seek);
      window.removeEventListener("kinetic:toggle-play", toggle);
      delete (window as any).FoliaStage;
    };
  }, []);
  useEffect(() => {
    window.MusicTogetherStage?.postMessage(
      JSON.stringify({
        event: settingsOpen ? "settingsOpen" : "settingsClose",
      }),
    );
  }, [settingsOpen]);
  useEffect(() => {
    const start = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('input[type="range"]')
      )
        beginSettingsDrag();
    };
    window.addEventListener("pointerdown", start, true);
    window.addEventListener("pointerup", commitSettingsDrag, true);
    window.addEventListener("pointercancel", commitSettingsDrag, true);
    window.addEventListener("blur", commitSettingsDrag);
    window.addEventListener("pagehide", commitSettingsDrag);
    return () => {
      commitSettingsDrag();
      window.removeEventListener("pointerdown", start, true);
      window.removeEventListener("pointerup", commitSettingsDrag, true);
      window.removeEventListener("pointercancel", commitSettingsDrag, true);
      window.removeEventListener("blur", commitSettingsDrag);
      window.removeEventListener("pagehide", commitSettingsDrag);
    };
  }, []);

  const Renderer = renderers[mode];
  const tunings = getStyleBundle(settings);
  const display = settings.display;
  const customSubtitles =
    display.subtitleOverlayLayout !== null ||
    display.subtitleContentMode !== null;
  const displayedLines = useMemo(
    () =>
      customSubtitles
        ? props.lines
        : props.lines.map((line: any) => ({
            ...line,
            translation:
              (props as any).showSubtitleTranslation === false
                ? ""
                : line.translation,
            romanization:
              (props as any).showSubtitleRomanization === false
                ? ""
                : line.romanization,
            ...(line.backgroundVocal
              ? {
                  backgroundVocal: {
                    ...line.backgroundVocal,
                    translation:
                      (props as any).showSubtitleTranslation === false
                        ? ""
                        : line.backgroundVocal.translation,
                  },
                }
              : {}),
          })),
    [
      props.lines,
      (props as any).showSubtitleTranslation,
      (props as any).showSubtitleRomanization,
      customSubtitles,
    ],
  );
  const theme = {
    ...props.theme,
    fontStyle: display.fontStyle,
    animationIntensity: display.animationIntensity,
  };
  if (display.fontName && fonts.lyric) theme.fontFamily = fonts.lyric;
  for (const key of [
    "primaryColor",
    "secondaryColor",
    "accentColor",
    "backgroundColor",
    "fontWeight",
  ])
    if (display[key] !== null) theme[key] = display[key];
  let resolved = {
    ...props,
    lines: displayedLines,
    nativeStageMode: mode,
    theme,
    subtitleTheme: {
      ...theme,
      fontWeight: display.subtitleFontWeight ?? theme.fontWeight,
      ...(display.subtitleFontName && fonts.subtitle
        ? { fontFamily: fonts.subtitle }
        : {}),
    },
    visualizerTunings: tunings,
    showText: display.showText,
    hideCoverArt: display.hideCoverArt,
    lyricsFontScale: display.lyricsFontScale ?? props.lyricsFontScale,
    subtitleFontScale: display.subtitleFontScale ?? props.subtitleFontScale,
    subtitleOverlayOpacity: display.subtitleOverlayOpacity,
    subtitleOverlayBackground: display.subtitleOverlayBackground,
    subtitleUpcomingLyricsBlur: display.subtitleUpcomingLyricsBlur,
    subtitleOverlayLayout:
      display.subtitleOverlayLayout ?? props.subtitleOverlayLayout,
    subtitleContentMode:
      display.subtitleContentMode ?? props.subtitleContentMode,
    hideTranslationSubtitle: customSubtitles
      ? false
      : props.hideTranslationSubtitle,
    showHarmonySubtitle: display.showHarmonySubtitle,
    harmonySubtitleBackground: display.harmonySubtitleBackground,
    staticMode: props.staticMode || display.staticMode,
    backgroundStaticMode: props.staticMode || display.backgroundStaticMode,
    background: {
      ...getBackgroundConfig(settings, display.backgroundMode),
      customImage: assets.monetBackgroundImage,
      transparent: display.backgroundMode !== "auto",
    },
    cappellaCustomEmojiImages: assets.cappellaCustomEmojiImages,
    cappellaCustomAvatarImages: assets.cappellaCustomAvatarImages,
    monetPortraitImage: assets.monetPortraitImage,
    onVisualizerTuningChange:
      settings[adapters.find((item) => item.mode === mode)?.settingsSetterKey],
  };
  const adapter = adapters.find((item) => item.mode === mode);
  if (adapter?.apply) resolved = adapter.apply(resolved, tunings[mode]);
  if (mode === "hanabi") resolved.hanabiTuning = tunings.hanabi;
  if (mode === "machi") resolved.machiTuning = tunings.machi;
  return (
    <>
      <StageBackdrop mode={mode} props={resolved} />
      <StageBoundary key={mode} mode={mode}>
        <Suspense
          fallback={
            <div className="absolute inset-0 flex items-center justify-center">
              舞台加载中…
            </div>
          }
        >
          <Renderer {...resolved} />
          <VisualizerHarmonyOverlay {...resolved} />
        </Suspense>
      </StageBoundary>
      {settingsOpen && (
        <StageSettingsPanel
          mode={mode}
          theme={theme}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </>
  );
}
document.addEventListener("click", (event) => {
  if (
    event.target instanceof Element &&
    event.target.closest(
      "button,a,input,select,textarea,[role=dialog],[role=listbox]",
    )
  )
    return;
  window.MusicTogetherStage?.postMessage(JSON.stringify({ event: "tap" }));
});
createRoot(document.getElementById("root")!).render(<App />);
