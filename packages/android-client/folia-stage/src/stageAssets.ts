import { useEffect } from "react";
import { useVisualizerAssetStore } from "../.work/src/stores/useVisualizerAssetStore";
import { getCustomCappellaEmojiPack } from "../.work/src/services/cappellaEmojiPack";
import { getCustomCappellaAvatar } from "../.work/src/services/cappellaAvatarPack";
import { getMonetPortraitImage } from "../.work/src/services/monetPortraitImage";
import { getMonetBackgroundImage } from "../.work/src/services/monetBackgroundImage";

// Blob URLs belong to this WebView lifetime; the binary records survive it.
export function useStageAssets() {
  const assets = useVisualizerAssetStore();
  useEffect(() => {
    let mounted = true;
    Promise.allSettled([
      getCustomCappellaEmojiPack(),
      getCustomCappellaAvatar(),
      getMonetPortraitImage(),
      getMonetBackgroundImage(),
    ]).then((results) => {
      if (!mounted) return;
      const value = (index: number, fallback: any) =>
        results[index].status === "fulfilled" ? results[index].value : fallback;
      useVisualizerAssetStore.setState({
        storedCappellaEmojiPack: value(0, []),
        storedCappellaAvatarPack: value(1, []),
        storedMonetPortraitImage: value(2, null),
        storedMonetBackgroundImage: value(3, null),
        isLoadingCappellaCustomEmojiPack: false,
        isLoadingCappellaCustomAvatarPack: false,
        isLoadingMonetPortraitImage: false,
        isLoadingMonetBackgroundImage: false,
      });
    });
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    const urls: string[] = [];
    const image = (stored: any) => {
      if (!(stored?.blob instanceof Blob)) return null;
      const url = URL.createObjectURL(stored.blob);
      urls.push(url);
      return { id: stored.id, name: stored.name, url };
    };
    useVisualizerAssetStore.setState({
      cappellaCustomEmojiImages: assets.storedCappellaEmojiPack
        .map(image)
        .filter(Boolean),
      cappellaCustomAvatarImages: assets.storedCappellaAvatarPack
        .map(image)
        .filter(Boolean),
      monetPortraitImage: image(assets.storedMonetPortraitImage),
      monetBackgroundImage: image(assets.storedMonetBackgroundImage),
    });
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [
    assets.storedCappellaEmojiPack,
    assets.storedCappellaAvatarPack,
    assets.storedMonetPortraitImage,
    assets.storedMonetBackgroundImage,
  ]);
}
