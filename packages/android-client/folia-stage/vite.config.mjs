import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import path from "node:path";
import fs from "node:fs";
import { icuFoliaDataPlugin } from "./.work/dev/icuFolia/icuFoliaDataPlugin.mjs";

const source = path.resolve(".work/src");
const hostModules = {
  "components/visualizer/VisualizerShell.tsx": "VisualizerShell.tsx",
  "components/visualizer/still/VisualizerStill.tsx": "StillStage.tsx",
  "components/visualizer/registry.tsx": "registry.tsx",
  "hooks/useReducedMotionFor.ts": "reducedMotion.ts",
  "components/visualizer/renderQuality/lyricRenderQualityPin.ts":
    "renderQuality.ts",
  "services/analysis/drumHits.ts": "analysis.ts",
  "services/analysis/vocalEnvelope.ts": "analysis.ts",
  "services/db.ts": "db.ts",
  "utils/lyrics/parserCore.ts": "interlude.ts",
  "services/phoneInsets.ts": "phoneInsets.ts",
  "components/visualizer/kinetic/saveExportFile.ts": "saveExportFile.ts",
  "i18n/config.ts": "i18n.ts",
  "mods/folium/registries/tunings.tsx": "foliumTunings.ts",
  "components/modal/settings/pages/integration/market/MarketEntryButton.tsx":
    "MarketEntryButton.tsx",
};
for (const store of [
  "usePlaybackStore",
  "useVisualizerSettingsStore",
  "useAudioSettingsStore",
  "useAppViewStore",
  "useVideoLayerSettingsStore",
  "usePlayerChromeSettingsStore",
  "useBottomDockStore",
  "useThemeSettingsStore",
  "useGyroSettingsStore",
  "useStatusMessageStore",
]) {
  hostModules["stores/" + store + ".ts"] = "hostStores.ts";
}

export default defineConfig({
  base: "/assets/folia/",
  plugins: [
    {
      name: "native-host-boundaries",
      enforce: "pre",
      resolveId(id, importer) {
        if (!importer || (!id.startsWith(".") && !id.startsWith("@/"))) return;
        const candidate = id.startsWith("@/")
          ? path.resolve(source, id.slice(2))
          : path.resolve(path.dirname(importer), id);
        for (const [file, replacement] of Object.entries(hostModules)) {
          const original = path.join(source, file);
          if (
            candidate === original ||
            candidate === original.replace(/\.(tsx?|jsx?)$/, "")
          ) {
            return path.resolve("src", replacement);
          }
        }
      },
      transform(code, id) {
        if (
          id.replaceAll("\\", "/").endsWith("/tempera/TemperaSettingsPanel.tsx")
        ) {
          const depthRow =
            "{DEPTH_CONTROLS.map(control => (\n                    <SliderRow\n                        {...drag}\n                        sub\n                        key={control.key}";
          if (!code.includes(depthRow))
            throw new Error(
              "Folia depth controls changed; review unavailable beat effect settings",
            );
          return code
            .replace(
              depthRow,
              depthRow +
                '\n                        disabled\n                        note="此效果依赖尚未接入的智能拍点分析"',
            )
            .replace(
              "<Row label={t('options.temperaDepthStrength')} hint={t('options.temperaDepthStrengthHint')} />",
              "<Row label={t('options.temperaDepthStrength')} hint=\"此效果依赖尚未接入的智能拍点分析\" />",
            );
        }
        if (id.replaceAll("\\", "/").endsWith("/partita/PartitaChunk.tsx")) {
          const initial =
            "useState<'waiting' | 'active' | 'passed'>('waiting')";
          if (!code.includes(initial))
            throw new Error(
              "Folia Partita chunk state changed; review clock initialization",
            );
          return code
            .replace("useMemo, useState", "useMemo, useState, useEffect")
            .replace(
              initial,
              `useState<'waiting' | 'active' | 'passed'>(() => {
              const now = currentTime.get();
              const end = getGlowWordActiveEndTime(chunkWords[chunkWords.length - 1], renderProfile);
              return now > end ? 'passed' : now >= chunkWords[0].startTime - renderProfile.wordLookahead ? 'active' : 'waiting';
            })`,
            )
            .replace(
              "const activeColor =",
              `useEffect(() => {
              const now = currentTime.get();
              setChunkStatus(now > chunkEndTime ? 'passed' : now >= chunkStartTime - renderProfile.wordLookahead ? 'active' : 'waiting');
            }, [chunkWords, renderProfile, currentTime, chunkStartTime, chunkEndTime]);
            const activeColor =`,
            );
        }
        if (id.replaceAll("\\", "/").endsWith("/visualizer/GlowWord.tsx")) {
          const initial =
            "useState<'waiting' | 'active' | 'passed'>('waiting')";
          if (!code.includes(initial))
            throw new Error(
              "Folia GlowWord state changed; review clock initialization",
            );
          // Paused playback and a late segmentation result may mount words after
          // the last clock event. Read the shared clock on mount and word changes.
          return code
            .replace("useMemo, useState", "useMemo, useState, useEffect")
            .replace(
              initial,
              `useState<'waiting' | 'active' | 'passed'>(() => {
              const now = currentTime.get();
              const end = getGlowWordActiveEndTime(word, renderProfile);
              return now > end ? 'passed' : now >= word.startTime - renderProfile.wordLookahead ? 'active' : 'waiting';
            })`,
            )
            .replace(
              "const graphemeTimings =",
              `useEffect(() => {
              const now = currentTime.get();
              setStatus(now > activeEndTime ? 'passed' : now >= word.startTime - renderProfile.wordLookahead ? 'active' : 'waiting');
            }, [word, renderProfile, currentTime, activeEndTime]);
            const graphemeTimings =`,
            );
        }
        if (
          !id
            .replaceAll("\\", "/")
            .endsWith("/visualizer/partita/partitaLayout.ts")
        )
          return;
        // Upstream can return an empty layout when its width candidates exceed
        // the row budget. The native shell now fits complete groups, so keep
        // the existing grouping rather than dropping a long lyric entirely.
        const fallback =
          "return { ...EMPTY_PARTITA_LAYOUT, totalGraphemes };\n};\n\nexport const buildPartitaLayoutCacheKey";
        if (!code.includes(fallback))
          throw new Error(
            "Folia Partita fallback changed; review native fit adaptation",
          );
        return code.replace(
          fallback,
          "return assembleLayout(passARowConfigs, line, totalGraphemes, legacyDensity, perspective);\n};\n\nexport const buildPartitaLayoutCacheKey",
        );
      },
    },
    react(),
    tailwind(),
    icuFoliaDataPlugin(),
    {
      name: "upstream-source-manifest",
      generateBundle() {
        const modules = [...this.getModuleIds()].filter((id) =>
          id.replaceAll("\\", "/").includes("/.work/"),
        );
        fs.writeFileSync(
          ".work/modules.json",
          JSON.stringify(modules, null, 2),
        );
      },
    },
  ],
  resolve: { alias: [{ find: "@", replacement: source }] },
  build: { target: "es2022", outDir: "dist", emptyOutDir: true },
  define: {
    __APP_VERSION__: JSON.stringify("android-stage"),
    __BUILD_COMMIT__: JSON.stringify("local"),
    __BUILD_KIND__: JSON.stringify("stable"),
    __BUILD_REPO__: JSON.stringify(""),
  },
});
