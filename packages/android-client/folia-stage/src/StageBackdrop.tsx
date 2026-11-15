import React from "react";
import LatentBackground from "../.work/src/components/visualizer/backgrounds/latent/LatentBackground";
import FluidBackground from "../.work/src/components/visualizer/backgrounds/common/FluidBackground";
import type { VisualizerSharedProps } from "../.work/src/components/visualizer/definition";
export default function StageBackdrop({
  mode,
  props,
}: {
  mode: string;
  props: VisualizerSharedProps;
}) {
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
          staticMode={props.staticMode ?? false}
          paused={props.paused ?? false}
        />
      )}
    </div>
  );
}
