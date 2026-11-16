// Adapted from Folia VisualizerStill (AGPL-3.0; revision in UPSTREAM.md).
// Keep its three-line reading layout while making its subtitles consume the
// same settings as the other stages instead of a hard-coded translation row.
import React, { useEffect, useState } from "react";
import type { VisualizerSharedProps } from "../.work/src/components/visualizer/definition";
import {
  resolveThemeFontStack,
  resolveThemeFontWeight,
} from "../.work/src/utils/fontStacks";
import { resolveSubtitleFontSizes } from "../.work/src/components/visualizer/subtitleFontSizes";
import VisualizerSubtitleOverlay from "../.work/src/components/visualizer/VisualizerSubtitleOverlay";
import VisualizerShell from "./VisualizerShell";

export default function StillStage(props: VisualizerSharedProps) {
  const {
    currentLineIndex,
    lines,
    theme,
    lyricsFontScale = 1,
    showText = true,
  } = props;
  const [effectiveIndex, setEffectiveIndex] = useState(() =>
    Math.max(0, currentLineIndex),
  );
  useEffect(() => {
    if (currentLineIndex !== -1) setEffectiveIndex(currentLineIndex);
    else if (effectiveIndex >= lines.length) setEffectiveIndex(0);
  }, [currentLineIndex, effectiveIndex, lines.length]);
  const sizes = resolveSubtitleFontSizes(lyricsFontScale);
  return (
    <VisualizerShell
      theme={theme}
      audioPower={props.audioPower}
      audioBands={props.audioBands}
      sharedProps={props}
      renderBackground={false}
      className="visualizer-still"
    >
      <div
        className={`absolute inset-0 z-0 pointer-events-none ${props.isDaylight ? "opacity-30 mix-blend-multiply" : "opacity-[0.65]"} bg-[radial-gradient(ellipse_at_center,transparent_0%,#000_100%)]`}
      />
      {showText && (
        <div className="absolute inset-0 z-0 flex flex-col items-center justify-center pointer-events-none px-12 pb-16 gap-8">
          {[-1, 0, 1].map((offset) => {
            const lineIndex = effectiveIndex + offset;
            const line = lines[lineIndex];
            if (!line) return <div key={`empty-${offset}`} className="h-20" />;
            const current = offset === 0;
            return (
              <div
                key={lineIndex}
                className="flex flex-col items-center w-full max-w-4xl"
              >
                {line.fullText && (
                  <div
                    className={`drop-shadow-md text-center tracking-[0.02em] ${current ? "text-[2.5rem] opacity-100 leading-tight" : "text-3xl opacity-30"}`}
                    style={{
                      color: theme.primaryColor,
                      fontFamily: resolveThemeFontStack(theme),
                      scale: lyricsFontScale,
                      fontWeight: resolveThemeFontWeight(
                        theme,
                        current ? 700 : 600,
                      ),
                    }}
                  >
                    {line.fullText}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <VisualizerSubtitleOverlay
        showText={showText}
        activeLine={lines[effectiveIndex] ?? null}
        recentCompletedLine={null}
        nextLines={lines.slice(effectiveIndex + 1, effectiveIndex + 3)}
        theme={theme}
        subtitleTheme={props.subtitleTheme}
        {...sizes}
        subtitleFontScale={props.subtitleFontScale}
        subtitleOverlayOpacity={props.subtitleOverlayOpacity}
        subtitleOverlayBackground={props.subtitleOverlayBackground}
        subtitleUpcomingLyricsBlur={props.subtitleUpcomingLyricsBlur}
        isPlayerChromeHidden={props.isPlayerChromeHidden}
        hideTranslationSubtitle={props.hideTranslationSubtitle}
        subtitleOverlayLayout={props.subtitleOverlayLayout}
      />
    </VisualizerShell>
  );
}
