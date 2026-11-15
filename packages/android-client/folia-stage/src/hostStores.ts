import { create } from "zustand";
import {
  DEFAULT_CAPPELLA_TUNING,
  DEFAULT_CLASSIC_TUNING,
  DEFAULT_SONNET_TUNING,
} from "../.work/src/types";
export const useVisualizerSettingsStore = create<any>(() => ({
  visualizerFrameRate: 60,
  visualizerMode: "sonnet",
  keywordColoringEnabled: true,
  smartBeat: { enabled: false },
  lyricRenderScale: 1,
  lyricRenderAntialias: true,
  classicTuning: DEFAULT_CLASSIC_TUNING,
  sonnetTuning: DEFAULT_SONNET_TUNING,
  cappellaTuning: DEFAULT_CAPPELLA_TUNING,
}));
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
export const useVisualizerAssetStore = create<any>(() => ({
  cappellaCustomEmojiImages: [],
  cappellaCustomAvatarImages: [],
  monetPortraitImage: null,
}));
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
export const setStatusMessage = () => {};
export const useBottomDockStore = create<any>(() => ({ visible: false }));
export const useThemeSettingsStore = create<any>(() => ({
  isDaylight: false,
  staticMode: false,
}));
export const useGyroSettingsStore = create<any>(() => ({
  gyroTiltEnabled: false,
}));
export const readGyroTiltEnabledForMode = () => false;
