import React from "react";
import { BUILTIN_VISUALIZER_MODES } from "../.work/src/types/visualizerModes";
const labels = {
  blank: "blank",
  cadenza: "cadenza",
  cappella: "cappella",
  claddagh: "claddagh",
  classic: "classic",
  diorama: "diorama",
  fume: "fume",
  hanabi: "hanabi",
  kinetic: "kinetic",
  lumiere: "lumiere",
  machi: "machi",
  monet: "monet",
  nebbia: "nebbia",
  partita: "partita",
  pendolo: "pendolo",
  prompt: "prompt",
  sonnet: "sonnet",
  still: "still",
  tempera: "tempera",
  tilt: "tilt",
};
export const VISUALIZER_REGISTRY = BUILTIN_VISUALIZER_MODES.map((mode) => ({
  mode,
  labelFallback: labels[mode],
  render: () => React.createElement("div"),
  usesWordSegmentation: true,
}));
export const getVisualizerRegistryEntry = (mode: string) =>
  VISUALIZER_REGISTRY.find((e) => e.mode === mode) || VISUALIZER_REGISTRY[0];
export const getVisualizerModeLabel = (mode: string) => labels[mode] || mode;
export const hasVisualizerMode = (mode: string) => mode in labels;
export const DEFAULT_VISUALIZER_MODE = "classic";
