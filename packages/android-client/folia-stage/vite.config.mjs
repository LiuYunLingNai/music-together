import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import path from "node:path";
import fs from "node:fs";
import { icuFoliaDataPlugin } from "./.work/dev/icuFolia/icuFoliaDataPlugin.mjs";

const source = path.resolve(".work/src");
const hostModules = {
  "components/visualizer/VisualizerShell.tsx": "VisualizerShell.tsx",
  "components/visualizer/registry.tsx": "registry.tsx",
  "hooks/useReducedMotionFor.ts": "reducedMotion.ts",
  "components/visualizer/renderQuality/useLyricRenderQuality.ts":
    "renderQuality.ts",
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
};
for (const store of [
  "usePlaybackStore",
  "useVisualizerSettingsStore",
  "useVisualizerAssetStore",
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
