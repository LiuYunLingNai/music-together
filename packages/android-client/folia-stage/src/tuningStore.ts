import { create } from "zustand";
import { normalizeLyricRenderQuality } from "../.work/src/utils/lyricRenderQuality";
import { parseSubtitleOverlayLayout } from "../.work/src/utils/lyrics/subtitleOverlayLayout";

const modules = import.meta.glob(
  [
    "../.work/src/components/visualizer/*/tuning.ts",
    "../.work/src/components/visualizer/backgrounds/*/tuning.ts",
  ],
  { eager: true },
) as Record<string, { default: any }>;
export const styleTunings = Object.entries(modules)
  .filter(([name]) => !name.includes("/backgrounds/"))
  .map(([, module]) => module.default);
export const backgroundTunings = Object.entries(modules)
  .filter(([name]) => name.includes("/backgrounds/"))
  .map(([, module]) => module.default);
const allTunings = [...styleTunings, ...backgroundTunings];
const globalKey = "music_together_folia_display";
export const displayDefaults = {
  backgroundMode: "auto",
  showText: true,
  hideCoverArt: false,
  lyricsFontScale: null as number | null,
  subtitleFontScale: null as number | null,
  fontStyle: "sans",
  fontName: null as string | null,
  subtitleFontName: null as string | null,
  fontWeight: null as number | null,
  subtitleFontWeight: null as number | null,
  primaryColor: null as string | null,
  secondaryColor: null as string | null,
  accentColor: null as string | null,
  backgroundColor: null as string | null,
  animationIntensity: "normal",
  staticMode: false,
  backgroundStaticMode: false,
  subtitleOverlayOpacity: 1,
  subtitleOverlayBackground: false,
  subtitleUpcomingLyricsBlur: true,
  subtitleOverlayLayout: null as any,
  subtitleContentMode: null as string | null,
  showHarmonySubtitle: true,
  harmonySubtitleBackground: false,
  keywordColoringEnabled: true,
  lyricRenderQuality: { scale: 1, antialias: "auto" },
};
function read(key: string, fallback: any) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: unknown) {
  if (dragging) {
    pendingWrites.set(key, value);
    return;
  }
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    window.dispatchEvent(
      new CustomEvent("folia:notice", {
        detail: "设置保存失败，请检查存储空间",
      }),
    );
  }
}
let dragging = false;
const pendingWrites = new Map<string, unknown>();
export function beginSettingsDrag() {
  dragging = true;
}
export function commitSettingsDrag() {
  dragging = false;
  for (const [key, value] of pendingWrites) store(key, value);
  pendingWrites.clear();
}
function normalizeDisplay(raw: any) {
  const input = raw && typeof raw === "object" ? raw : {};
  const result: any = { ...displayDefaults };
  for (const [key, fallback] of Object.entries(displayDefaults)) {
    if (typeof fallback === "boolean" && typeof input[key] === "boolean")
      result[key] = input[key];
  }
  for (const key of ["lyricsFontScale", "subtitleFontScale"])
    if (Number.isFinite(input[key]))
      result[key] = Math.max(0.5, Math.min(2, input[key]));
  for (const key of ["fontWeight", "subtitleFontWeight"])
    if (Number.isFinite(input[key]))
      result[key] = Math.max(100, Math.min(900, input[key]));
  for (const key of [
    "primaryColor",
    "secondaryColor",
    "accentColor",
    "backgroundColor",
  ])
    if (typeof input[key] === "string" && /^#[\da-f]{3,8}$/i.test(input[key]))
      result[key] = input[key];
  for (const key of ["fontName", "subtitleFontName"])
    if (typeof input[key] === "string") result[key] = input[key].slice(0, 200);
  if (["sans", "serif", "mono"].includes(input.fontStyle))
    result.fontStyle = input.fontStyle;
  if (["calm", "normal", "chaotic"].includes(input.animationIntensity))
    result.animationIntensity = input.animationIntensity;
  if (
    ["native", "translation", "romanization", "both", "none"].includes(
      input.subtitleContentMode,
    )
  )
    result.subtitleContentMode = input.subtitleContentMode;
  if (
    [
      "auto",
      "none",
      "common",
      "latent",
      "monet",
      "nomand",
      "sonic",
      "sora",
      "particles",
    ].includes(input.backgroundMode)
  )
    result.backgroundMode = input.backgroundMode;
  result.subtitleOverlayLayout = parseSubtitleOverlayLayout(
    input.subtitleOverlayLayout,
  );
  if (Number.isFinite(input.subtitleOverlayOpacity))
    result.subtitleOverlayOpacity = Math.max(
      0,
      Math.min(1, input.subtitleOverlayOpacity),
    );
  result.lyricRenderQuality = normalizeLyricRenderQuality(
    input.lyricRenderQuality,
  );
  if (input.common && typeof input.common === "object")
    result.common = {
      useCoverColorBg: input.common.useCoverColorBg === true,
      disableGeometricBackground:
        input.common.disableGeometricBackground === true,
      disableVignette: input.common.disableVignette === true,
      opacity: Number.isFinite(input.common.opacity)
        ? Math.max(0, Math.min(1, input.common.opacity))
        : 0.75,
    };
  return result;
}
export const useVisualizerSettingsStore = create<any>((set, get) => {
  const fields: Record<string, any> = {};
  for (const adapter of allTunings) {
    const {
      storage,
      settingsKey,
      settingsSetterKey,
      settingsResetterKey,
      defaults,
    } = adapter;
    if (!storage) {
      fields[settingsKey] = defaults;
      continue;
    }
    let value = defaults;
    try {
      value = storage.read(read(storage.key, defaults));
    } catch {}
    fields[settingsKey] = value;
    const hold = (tuning: unknown) => {
      store(storage.key, tuning);
      set({ [settingsKey]: tuning });
    };
    fields[settingsSetterKey] = (patch: object) => {
      storage.onChange?.(patch);
      hold(storage.merge(get()[settingsKey], patch));
    };
    fields[settingsResetterKey] = () =>
      hold(storage.reset?.(get()[settingsKey], defaults) ?? defaults);
    Object.assign(
      fields,
      storage.actions?.({ held: () => get()[settingsKey], hold }),
    );
  }
  const display = normalizeDisplay(read(globalKey, displayDefaults));
  return {
    ...fields,
    display,
    visualizerFrameRate: 60,
    visualizerMode: "sonnet",
    smartBeat: { enabled: false },
    keywordColoringEnabled: display.keywordColoringEnabled,
    lyricRenderQuality: display.lyricRenderQuality,
    setDisplay: (patch: object) => {
      const next = normalizeDisplay({ ...get().display, ...patch });
      store(globalKey, next);
      set({
        display: next,
        keywordColoringEnabled: next.keywordColoringEnabled,
        lyricRenderQuality: next.lyricRenderQuality,
      });
    },
    resetDisplay: () => {
      store(globalKey, displayDefaults);
      set({
        display: displayDefaults,
        keywordColoringEnabled: true,
        lyricRenderQuality: displayDefaults.lyricRenderQuality,
      });
    },
  };
});
export const getStyleBundle = (settings: any) =>
  Object.fromEntries(
    styleTunings.map((adapter) => [
      adapter.mode,
      settings[adapter.settingsKey],
    ]),
  );
export const getBackgroundConfig = (settings: any, mode: string) => ({
  mode,
  common: settings.display.common,
  ...Object.fromEntries(
    backgroundTunings.map((adapter) => [
      adapter.mode,
      { tuning: settings[adapter.settingsKey] },
    ]),
  ),
});
