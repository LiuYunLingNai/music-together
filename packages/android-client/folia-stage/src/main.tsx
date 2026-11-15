import React, { Suspense, useState, Component, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./i18n";
import StageBackdrop from "./StageBackdrop";
import { usePlaybackStore, useVisualizerSettingsStore } from "./hostStores";
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
const tuningModules = import.meta.glob(
  "../.work/src/components/visualizer/*/tuning.ts",
  { eager: true },
) as Record<string, { default: any }>;
const adapters = Object.values(tuningModules).map((module) => module.default);
const tunings = Object.fromEntries(
  adapters.map((adapter) => [adapter.mode, adapter.defaults]),
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
  visualizerTunings: tunings,
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
  useEffect(() => {
    let mounted = true;
    (window as any).FoliaStage = {
      resizeViewport: updateStageViewport,
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
    window.MusicTogetherStage?.postMessage(JSON.stringify({ event: "ready" }));
    return () => {
      mounted = false;
      delete (window as any).FoliaStage;
    };
  }, []);

  const Renderer = renderers[mode];
  let resolved = { ...props, nativeStageMode: mode };
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
        </Suspense>
      </StageBoundary>
    </>
  );
}
document.addEventListener("click", (event) => {
  if (
    event.target instanceof Element &&
    event.target.closest("button,a,input,select")
  )
    return;
  window.MusicTogetherStage?.postMessage(JSON.stringify({ event: "tap" }));
});
createRoot(document.getElementById("root")!).render(<App />);
