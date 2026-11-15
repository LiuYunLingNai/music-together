import React from "react";
import {
  Group,
  Row,
  Toggle,
  Select,
  Segmented,
  ColorField,
} from "../.work/src/components/modal/settings/kit";
import {
  SliderRow,
  percent,
  times,
} from "../.work/src/components/visualizer/panelRows";
import SubtitleOverlayRowsSetting from "../.work/src/components/visualizer/window/SubtitleOverlayRowsSetting";
import { DEFAULT_SUBTITLE_OVERLAY_LAYOUT } from "../.work/src/utils/lyrics/subtitleOverlayLayout";
import StageFontUpload from "./StageFonts";

// Generic display controls are separate from each upstream stage's own panel.
export default function StageDisplayTabs({
  tab,
  display,
  set,
  entry,
  theme,
  t,
}: {
  tab: string;
  display: any;
  set: (patch: object) => void;
  entry: any;
  theme: any;
  t: (key: string) => string;
}) {
  return (
    <>
      {tab === "text" && (
        <>
          <Group def={{ id: "native-text", titleKey: "文字与排版" }}>
            <Row
              label="字号"
              hint={
                entry?.ownFontSizeNoticeKey
                  ? t(entry.ownFontSizeNoticeKey)
                  : undefined
              }
              disabled={Boolean(entry?.ownFontSizeNoticeKey)}
            >
              <Select
                value={display.lyricsFontScale === null ? "native" : "custom"}
                options={[
                  { value: "native", label: "跟随播放器" },
                  { value: "custom", label: "自定义" },
                ]}
                onChange={(value) =>
                  set({ lyricsFontScale: value === "native" ? null : 1 })
                }
              />
            </Row>
            {display.lyricsFontScale !== null &&
              !entry?.ownFontSizeNoticeKey && (
                <SliderRow
                  label="歌词大小"
                  value={display.lyricsFontScale}
                  min={0.5}
                  max={2}
                  step={0.05}
                  format={times}
                  onChange={(lyricsFontScale) => set({ lyricsFontScale })}
                />
              )}
            <Row label="字体风格">
              <Segmented
                value={display.fontStyle}
                options={[
                  { value: "sans", label: "无衬线" },
                  { value: "serif", label: "衬线" },
                  { value: "mono", label: "等宽" },
                ]}
                onChange={(fontStyle) => set({ fontStyle })}
              />
            </Row>
            <Row label="字重">
              <Select
                value={String(display.fontWeight ?? "native")}
                options={[
                  { value: "native", label: "跟随播放器" },
                  ...[300, 400, 500, 600, 700, 800, 900].map((value) => ({
                    value: String(value),
                    label: String(value),
                  })),
                ]}
                onChange={(value) =>
                  set({
                    fontWeight: value === "native" ? null : Number(value),
                  })
                }
              />
            </Row>
            <Row label="动画强度">
              <Segmented
                value={display.animationIntensity}
                options={[
                  { value: "calm", label: "平缓" },
                  { value: "normal", label: "标准" },
                  { value: "chaotic", label: "强烈" },
                ]}
                onChange={(animationIntensity) => set({ animationIntensity })}
              />
            </Row>
            <StageFontUpload />
          </Group>
          <Group def={{ id: "native-colors", titleKey: "舞台配色" }}>
            {[
              ["primaryColor", "主文字"],
              ["secondaryColor", "辅助文字"],
              ["accentColor", "强调色"],
              ["backgroundColor", "背景色"],
            ].map(([key, label]) => (
              <Row key={key} label={label}>
                <ColorField
                  value={display[key] ?? theme[key]}
                  onChange={(value) => set({ [key]: value })}
                />
              </Row>
            ))}
          </Group>
        </>
      )}
      {tab === "subtitle" && (
        <>
          <Group def={{ id: "native-subtitles", titleKey: "字幕内容" }}>
            <Row label="附加字幕内容">
              <Select
                value={display.subtitleContentMode ?? "native"}
                options={[
                  { value: "native", label: "跟随播放器" },
                  { value: "translation", label: "翻译" },
                  { value: "romanization", label: "音译" },
                  { value: "both", label: "翻译和音译" },
                  { value: "none", label: "关闭" },
                ]}
                onChange={(value) =>
                  set({
                    subtitleContentMode: value === "native" ? null : value,
                  })
                }
              />
            </Row>
            <SubtitleOverlayRowsSetting
              t={t}
              layout={
                display.subtitleOverlayLayout ?? DEFAULT_SUBTITLE_OVERLAY_LAYOUT
              }
              onChange={(subtitleOverlayLayout) =>
                set({ subtitleOverlayLayout })
              }
            />
          </Group>
          <Group def={{ id: "native-subtitle-style", titleKey: "字幕显示" }}>
            <Row label="字幕字号">
              <Select
                value={display.subtitleFontScale === null ? "native" : "custom"}
                options={[
                  { value: "native", label: "跟随播放器" },
                  { value: "custom", label: "自定义" },
                ]}
                onChange={(value) =>
                  set({
                    subtitleFontScale: value === "native" ? null : 1,
                  })
                }
              />
            </Row>
            {display.subtitleFontScale !== null && (
              <SliderRow
                label="字幕大小"
                value={display.subtitleFontScale}
                min={0.5}
                max={2}
                step={0.05}
                format={times}
                onChange={(subtitleFontScale) => set({ subtitleFontScale })}
              />
            )}
            <SliderRow
              label="字幕不透明度"
              value={display.subtitleOverlayOpacity}
              min={0}
              max={1}
              step={0.05}
              format={percent}
              onChange={(subtitleOverlayOpacity) =>
                set({ subtitleOverlayOpacity })
              }
            />
            <Row label="字幕字重">
              <Select
                value={String(display.subtitleFontWeight ?? "native")}
                options={[
                  { value: "native", label: "跟随歌词" },
                  ...[300, 400, 500, 600, 700, 800, 900].map((value) => ({
                    value: String(value),
                    label: String(value),
                  })),
                ]}
                onChange={(value) =>
                  set({
                    subtitleFontWeight:
                      value === "native" ? null : Number(value),
                  })
                }
              />
            </Row>
            <StageFontUpload subtitle />
            <Row label="字幕底板">
              <Toggle
                checked={display.subtitleOverlayBackground}
                onChange={(subtitleOverlayBackground) =>
                  set({ subtitleOverlayBackground })
                }
              />
            </Row>
            <Row label="模糊下一句">
              <Toggle
                checked={display.subtitleUpcomingLyricsBlur}
                onChange={(subtitleUpcomingLyricsBlur) =>
                  set({ subtitleUpcomingLyricsBlur })
                }
              />
            </Row>
            <Row label="显示背景人声字幕">
              <Toggle
                checked={display.showHarmonySubtitle}
                onChange={(showHarmonySubtitle) => set({ showHarmonySubtitle })}
              />
            </Row>
            <Row label="背景人声字幕底板">
              <Toggle
                checked={display.harmonySubtitleBackground}
                onChange={(harmonySubtitleBackground) =>
                  set({ harmonySubtitleBackground })
                }
              />
            </Row>
          </Group>
        </>
      )}
      {tab === "global" && (
        <Group def={{ id: "native-performance", titleKey: "动画与性能" }}>
          <Row label="静态舞台">
            <Toggle
              checked={display.staticMode}
              onChange={(staticMode) => set({ staticMode })}
            />
          </Row>
          <Row label="静态背景">
            <Toggle
              checked={display.backgroundStaticMode}
              onChange={(backgroundStaticMode) => set({ backgroundStaticMode })}
            />
          </Row>
          <Row label="关键词着色">
            <Toggle
              checked={display.keywordColoringEnabled}
              onChange={(keywordColoringEnabled) =>
                set({ keywordColoringEnabled })
              }
            />
          </Row>
          <Row label="渲染分辨率">
            <Select
              value={String(display.lyricRenderQuality.scale)}
              options={[0.5, 0.75, 1, 1.5, 2].map((value) => ({
                value: String(value),
                label: `${value}×`,
              }))}
              onChange={(value) =>
                set({
                  lyricRenderQuality: {
                    ...display.lyricRenderQuality,
                    scale: Number(value),
                  },
                })
              }
            />
          </Row>
          <Row label="抗锯齿">
            <Segmented
              value={display.lyricRenderQuality.antialias}
              options={[
                { value: "auto", label: "自动" },
                { value: "on", label: "开启" },
                { value: "off", label: "关闭" },
              ]}
              onChange={(antialias) =>
                set({
                  lyricRenderQuality: {
                    ...display.lyricRenderQuality,
                    antialias,
                  },
                })
              }
            />
          </Row>
        </Group>
      )}
    </>
  );
}
