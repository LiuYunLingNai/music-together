import { create } from "zustand";
export { useVisualizerSettingsStore } from "./tuningStore";
export const usePlaybackStore = create<any>(() => ({
  currentSong: null,
  lyrics: null,
  playerState: "PAUSED",
  currentLineIndex: -1,
}));
export const selectDisplaySong = (s: any) => s.currentSong;
export const selectDisplayPlayerState = (s: any) => s.playerState;
export const selectDisplayLyrics = (s: any) => s.lyrics;
export const selectCoverUrl = (s: any) => s.currentSong?.coverUrl;
export const useAppViewStore = create<any>(() => ({ view: "player" }));
export { useVisualizerAssetStore } from "../.work/src/stores/useVisualizerAssetStore";
export const useVideoLayerSettingsStore = create<any>(() => ({
  videoLayerFile: null,
  videoLayerSubtitleMode: "none",
}));
export const stripInjectPrefix = (s: string) => s;
export const ensureVideoLayerFileRestored = () => Promise.resolve();
export const usePlayerChromeSettingsStore = create<any>(() => ({
  playerBottomBarOffset: 32,
  playerBottomBarStyle: "compact",
  playerBottomBarVisible: false,
}));
export const setStatusMessage = (message: { text?: string }) => {
  window.dispatchEvent(
    new CustomEvent("folia:notice", { detail: message.text }),
  );
};
export const useAudioSettingsStore = create<any>(() => ({
  handleSetVolume: () => setStatusMessage({ text: "请使用设备音量键调节音量" }),
}));
export const useBottomDockStore = create<any>(() => ({ visible: false }));
export const useThemeSettingsStore = create<any>(() => ({
  isDaylight: false,
  staticMode: false,
}));
export const useGyroSettingsStore = create<any>(() => ({
  gyroTiltEnabled: false,
}));
export const readGyroTiltEnabledForMode = () => false;
