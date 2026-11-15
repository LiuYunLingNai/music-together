import React from "react";
import LatentBackground from "../.work/src/components/visualizer/backgrounds/latent/LatentBackground";
import FluidBackground from "../.work/src/components/visualizer/backgrounds/common/FluidBackground";
import type { VisualizerSharedProps } from "../.work/src/components/visualizer/definition";
import { backgroundEntries } from "./runtimeRegistry";
export default function StageBackdrop({
  mode,
  props,
}: {
  mode: string;
  props: VisualizerSharedProps;
}) {
  if (props.background?.mode && props.background.mode !== "auto") {
    const entry = backgroundEntries.find(
      (entry) => entry.mode === props.background?.mode,
    );
    return (
      <div className="absolute inset-0 pointer-events-none">
        {entry?.render({
          ...props,
          config: props.background,
          staticMode: props.backgroundStaticMode ?? props.staticMode ?? false,
          isDaylight: props.isDaylight ?? false,
        })}
      </div>
    );
  }
  if (["still", "kinetic", "nebbia"].includes(mode)) return null;
  return (
    <div className="absolute inset-0 pointer-events-none">
      {mode === "blank" ? (
        <FluidBackground coverUrl={props.coverUrl} theme={props.theme} />
      ) : (
        <LatentBackground
          theme={props.theme}
          coverUrl={props.coverUrl}
          audioPower={props.audioPower}
          audioBands={props.audioBands}
          staticMode={props.backgroundStaticMode ?? props.staticMode ?? false}
          paused={props.paused ?? false}
          tuning={props.background?.latent?.tuning}
        />
      )}
    </div>
  );
}
