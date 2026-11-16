import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X, RotateCcw } from "lucide-react";
import {
  Button,
  Group,
  Row,
  Toggle,
  Select,
} from "../.work/src/components/modal/settings/kit";
import {
  settingsTokens,
  SettingsKitThemeContext,
} from "../.work/src/components/modal/settings/kit/kitTheme";
import { stageEntries, backgroundEntries } from "./runtimeRegistry";
import { useVisualizerAssetStore } from "./hostStores";
import StageDisplayTabs from "./StageDisplayTabs";
import { removeFromCache } from "./db";
import {
  styleTunings,
  backgroundTunings,
  useVisualizerSettingsStore,
  getBackgroundConfig,
} from "./tuningStore";
import "../.work/src/components/modal/settings/kit/kit.css";

// The current stage and its parameter groups are primary; tabs are secondary,
// reset is tertiary. Reuse Folia's settings tokens, 14px rows, 28px group spacing
// and 12px card radius. The uncovered stage remains the live preview.
export default function StageSettingsPanel({
  mode,
  theme,
  onClose,
}: {
  mode: string;
  theme: any;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const settings = useVisualizerSettingsStore();
  const assets = useVisualizerAssetStore();
  const display = settings.display;
  const [tab, setTab] = useState("stage");
  const [notice, setNotice] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const entry = stageEntries.find((entry) => entry.mode === mode);
  const adapter = styleTunings.find((adapter) => adapter.mode === mode);
  const background = backgroundEntries.find(
    (entry) => entry.mode === display.backgroundMode,
  );
  const set = settings.setDisplay;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    const listener = (event: Event) =>
      setNotice((event as CustomEvent).detail ?? "");
    window.addEventListener("folia:notice", listener);
    return () => window.removeEventListener("folia:notice", listener);
  }, []);
  const reset = async () => {
    if (tab === "stage") {
      settings[adapter?.settingsResetterKey]?.();
      set({ showText: true, hideCoverArt: false });
      if (mode === "monet") set({ keywordColoringEnabled: true });
    } else if (tab === "background") {
      const adapter = backgroundTunings.find(
        (item) => item.mode === display.backgroundMode,
      );
      settings[adapter?.settingsResetterKey]?.();
      set({ common: undefined });
    } else if (tab === "text") {
      await removeFromCache("lyric-font");
      window.dispatchEvent(new Event("folia:font"));
      set({
        fontName: null,
        lyricsFontScale: null,
        fontWeight: null,
        fontStyle: "sans",
        primaryColor: null,
        secondaryColor: null,
        accentColor: null,
        backgroundColor: null,
      });
    } else if (tab === "subtitle") {
      await removeFromCache("subtitle-font");
      window.dispatchEvent(new Event("folia:font"));
      set({
        subtitleFontName: null,
        subtitleFontScale: null,
        subtitleFontWeight: null,
        subtitleOverlayLayout: null,
        subtitleContentMode: null,
        subtitleOverlayOpacity: 1,
        subtitleOverlayBackground: false,
        subtitleUpcomingLyricsBlur: true,
        showHarmonySubtitle: true,
        harmonySubtitleBackground: false,
      });
    } else
      set({
        staticMode: false,
        backgroundStaticMode: false,
        lyricRenderQuality: { scale: 1, antialias: "auto" },
        keywordColoringEnabled: true,
      });
  };
  const actions = {
    customImage: {
      onUpload: settings.handleUploadMonetBackgroundImage,
      onClear: settings.handleClearMonetBackgroundImage,
      isLoading: assets.isLoadingMonetBackgroundImage,
    },
    common: {
      onCoverColorChange: (value: boolean) =>
        set({ common: { ...display.common, useCoverColorBg: value } }),
      onOpacityChange: (value: number) =>
        set({ common: { ...display.common, opacity: value } }),
      onDisableGeometricChange: (value: boolean) =>
        set({
          common: { ...display.common, disableGeometricBackground: value },
        }),
      onDisableVignetteChange: (value: boolean) =>
        set({ common: { ...display.common, disableVignette: value } }),
    },
    ...Object.fromEntries(
      backgroundTunings.map((adapter) => [
        adapter.mode,
        {
          onTuningChange: settings[adapter.settingsSetterKey],
          onResetTuning: settings[adapter.settingsResetterKey],
        },
      ]),
    ),
  };
  const common = {
    t,
    isDaylight: false,
    theme,
    controlCardBg: "var(--st-card)",
    rangeInputClass: "",
    settings,
  };
  const label = t(entry?.labelKey ?? "") || entry?.labelFallback || mode;
  return (
    <SettingsKitThemeContext.Provider value={{ isDaylight: false }}>
      <div
        className="folia-settings-layer"
        onClick={(event) => event.stopPropagation()}
      >
        <section
          ref={root}
          tabIndex={-1}
          role="dialog"
          aria-modal="false"
          aria-label="舞台配置"
          className="folia-settings"
          style={settingsTokens(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              onClose();
            }
            if (event.key === "Tab") {
              const controls = [
                ...(root.current?.querySelectorAll<HTMLElement>(
                  'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
                ) ?? []),
              ].filter((node) => node.getClientRects().length);
              const target =
                event.shiftKey && document.activeElement === controls[0]
                  ? controls.at(-1)
                  : !event.shiftKey &&
                      document.activeElement === controls.at(-1)
                    ? controls[0]
                    : null;
              if (target) {
                event.preventDefault();
                target.focus();
              }
            }
          }}
        >
          <header className="flex items-center gap-3 px-4 py-3 border-b border-[var(--st-line)]">
            <div className="flex-1">
              <h2 className="text-base font-semibold">{label} · 舞台配置</h2>
              <p className="text-xs text-[var(--st-t2)] mt-1">
                实时预览 · 自动保存
              </p>
            </div>
            <button
              aria-label="关闭舞台配置"
              className="st-focus grid size-11 place-items-center rounded-lg"
              onClick={onClose}
            >
              <X size={20} />
            </button>
          </header>
          <nav
            className="flex gap-1 overflow-x-auto px-3 py-2 border-b border-[var(--st-line)]"
            aria-label="配置分类"
          >
            {[
              ["stage", "舞台"],
              ["background", "背景"],
              ["text", "文字"],
              ["subtitle", "字幕"],
              ["global", "性能"],
            ].map(([id, label]) => (
              <button
                key={id}
                aria-pressed={tab === id}
                onClick={() => setTab(id)}
                className={`st-focus shrink-0 min-h-11 px-3 rounded-lg text-sm ${tab === id ? "bg-[var(--st-fill2)] font-semibold" : "text-[var(--st-t2)]"}`}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="folia-settings-scroll px-4 pb-6">
            <div className="flex justify-end pt-3">
              <Button variant="quiet" onClick={reset}>
                <RotateCcw size={14} />
                恢复本页默认
              </Button>
            </div>
            {notice && (
              <p role="status" className="text-xs py-2 text-[var(--st-t2)]">
                {notice}
              </p>
            )}
            {tab === "stage" && (
              <>
                {entry?.renderSettingsPanel?.({
                  ...common,
                  tuning:
                    mode === "monet"
                      ? {
                          ...settings[adapter?.settingsKey],
                          keywordColoringEnabled:
                            display.keywordColoringEnabled,
                        }
                      : (settings[adapter?.settingsKey] ?? {}),
                  onTuningChange: (patch: any) => {
                    settings[adapter?.settingsSetterKey]?.(patch);
                    if (
                      mode === "monet" &&
                      typeof patch.keywordColoringEnabled === "boolean"
                    )
                      set({
                        keywordColoringEnabled: patch.keywordColoringEnabled,
                      });
                  },
                }) ?? (
                  <p className="py-5 text-sm text-[var(--st-t2)]">
                    此舞台没有独立参数，可在其他分类调整显示。
                  </p>
                )}
                <Group def={{ id: "native-visible", titleKey: "显示" }}>
                  <Row
                    label="显示舞台歌词"
                    disabled={mode === "blank"}
                    hint={mode === "blank" ? "纯背景舞台不绘制歌词" : undefined}
                  >
                    <Toggle
                      checked={display.showText}
                      onChange={(showText) => set({ showText })}
                    />
                  </Row>
                  <Row
                    label="隐藏封面"
                    disabled={mode !== "monet"}
                    hint={
                      mode !== "monet" ? "此开关用于莫奈的封面列" : undefined
                    }
                  >
                    <Toggle
                      checked={display.hideCoverArt}
                      onChange={(hideCoverArt) => set({ hideCoverArt })}
                    />
                  </Row>
                </Group>
              </>
            )}
            {tab === "background" && (
              <>
                <Group def={{ id: "native-background", titleKey: "背景样式" }}>
                  <Row label="背景">
                    <Select
                      value={display.backgroundMode}
                      options={[
                        { value: "auto", label: "舞台默认" },
                        { value: "none", label: "纯色" },
                        ...backgroundEntries.map((entry) => ({
                          value: entry.mode,
                          label: t(entry.labelKey),
                        })),
                      ]}
                      onChange={(backgroundMode) => set({ backgroundMode })}
                    />
                  </Row>
                </Group>
                {background?.renderSettingsPanel?.({
                  ...common,
                  config: {
                    ...getBackgroundConfig(settings, background.mode),
                    customImage: assets.monetBackgroundImage,
                  },
                  actions,
                })}
              </>
            )}
            <StageDisplayTabs
              tab={tab}
              display={display}
              set={set}
              entry={entry}
              theme={theme}
              t={t}
            />
          </div>
        </section>
      </div>
    </SettingsKitThemeContext.Provider>
  );
}
