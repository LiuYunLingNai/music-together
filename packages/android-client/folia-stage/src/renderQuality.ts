import { useVisualizerSettingsStore } from "./tuningStore";
export const useGlobalLyricRenderQuality = () =>
  useVisualizerSettingsStore((state) => state.lyricRenderQuality);
export const useLyricRenderQualityPin = () => null;
