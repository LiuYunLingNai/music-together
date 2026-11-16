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
  const backgroundStatic =
    props.backgroundStaticMode || props.staticMode || false;
  const surface = { backgroundColor: props.theme.backgroundColor };
  if (props.background?.mode && props.background.mode !== "auto") {
    const entry = backgroundEntries.find(
      (entry) => entry.mode === props.background?.mode,
    );
    return (
      <div className="absolute inset-0 pointer-events-none" style={surface}>
        {entry?.render({
          ...props,
          config: props.background,
          staticMode: backgroundStatic,
          // Sonic and Particles expose freezing as `paused`; Sora/Latent also
          // have staticMode. Feed both contracts from the background preference.
          paused: backgroundStatic || props.paused || false,
          isDaylight: props.isDaylight ?? false,
        })}
      </div>
    );
  }
  if (
    ["still", "kinetic"].includes(mode) ||
    (mode === "nebbia" &&
      props.visualizerTunings?.nebbia?.behind !== "backdrop")
  )
    return (
      <div className="absolute inset-0 pointer-events-none" style={surface} />
    );
  return (
    <div className="absolute inset-0 pointer-events-none" style={surface}>
      {mode === "blank" ? (
        <FluidBackground coverUrl={props.coverUrl} theme={props.theme} />
      ) : (
        <LatentBackground
          theme={props.theme}
          coverUrl={props.coverUrl}
          audioPower={props.audioPower}
          audioBands={props.audioBands}
          staticMode={backgroundStatic}
          paused={props.paused ?? false}
          tuning={props.background?.latent?.tuning}
        />
      )}
    </div>
  );
}
