// Rebuild the fixed, unmodified upstream dependency closure from a local checkout.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import ts from "typescript";

const sourceRoot = path.resolve(process.argv[2] ?? "");
if (!process.argv[2])
  throw new Error("Usage: node scripts/snapshot.mjs <upstream-checkout>");
const revision = execFileSync(
  "git",
  [
    "-c",
    `safe.directory=${sourceRoot.replaceAll("\\", "/")}`,
    "-C",
    sourceRoot,
    "rev-parse",
    "HEAD",
  ],
  { encoding: "utf8" },
).trim();
if (!fs.readFileSync("UPSTREAM.md", "utf8").includes(revision))
  throw new Error("Snapshot checkout does not match UPSTREAM.md");
const files = new Set(
  execFileSync("tar", ["-tzf", "upstream-source.tar.gz"], { encoding: "utf8" })
    .trim()
    .split(/\r?\n/)
    .filter((file) => !file.endsWith("/")),
);
const boundaries = new Set([
  "services/db.ts",
  "stores/useVisualizerSettingsStore.ts",
  "stores/usePlaybackStore.ts",
  "stores/useAudioSettingsStore.ts",
  "stores/useAppViewStore.ts",
  "stores/useVideoLayerSettingsStore.ts",
  "stores/usePlayerChromeSettingsStore.ts",
  "stores/useBottomDockStore.ts",
  "stores/useThemeSettingsStore.ts",
  "stores/useGyroSettingsStore.ts",
  "stores/useStatusMessageStore.ts",
  "i18n/config.ts",
  "components/visualizer/registry.tsx",
  "mods/folium/registries/tunings.tsx",
]);
const seeds = [
  ...fs.globSync("src/components/visualizer/*/entry.tsx", { cwd: sourceRoot }),
  ...["common", "latent", "monet", "nomand", "sonic", "sora", "particles"].map(
    (mode) => `src/components/visualizer/backgrounds/${mode}/entry.tsx`,
  ),
  "src/components/modal/settings/kit/index.ts",
  "src/components/modal/settings/kit/kit.css",
  "src/components/visualizer/window/SubtitleOverlayRowsSetting.tsx",
  "src/stores/useVisualizerAssetStore.ts",
];
const queue = [...seeds];
const visited = new Set();
while (queue.length) {
  const file = queue.shift().replaceAll("\\", "/");
  if (visited.has(file)) continue;
  visited.add(file);
  if (!fs.existsSync(path.join(sourceRoot, file)))
    throw new Error(`Missing source: ${file}`);
  files.add(file);
  if (boundaries.has(file.slice(4)) || !/\.(tsx?|jsx?|mjs)$/.test(file))
    continue;
  const raw = fs.readFileSync(path.join(sourceRoot, file), "utf8");
  const code = ts.transpileModule(raw, {
    fileName: file,
    compilerOptions: {
      jsx: ts.JsxEmit.Preserve,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const imports = [
    ...code.matchAll(
      /(?:from\s*|import\s*\(|import\s+|new URL\s*\()(['"])([^'"]+)\1/g,
    ),
  ].map((match) => match[2]);
  for (const id of imports) {
    if (!id.startsWith(".") && !id.startsWith("@/")) continue;
    const base = id.startsWith("@/")
      ? path.join("src", id.slice(2))
      : path.join(path.dirname(file), id);
    const bare = base.split("?")[0];
    const candidate = [
      bare,
      ...[".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx"].map(
        (ext) => bare + ext,
      ),
    ].find(
      (name) =>
        fs.existsSync(path.join(sourceRoot, name)) &&
        fs.statSync(path.join(sourceRoot, name)).isFile(),
    );
    if (!candidate) throw new Error(`Cannot resolve ${id} in ${file}`);
    queue.push(candidate);
  }
}
const staging = path.resolve(".work/source-snapshot");
fs.mkdirSync(staging, { recursive: true });
for (const file of files) {
  const target = path.join(staging, file);
  if (!target.startsWith(staging + path.sep))
    throw new Error("Invalid snapshot path");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(sourceRoot, file), target);
}
fs.writeFileSync(
  ".work/snapshot-files.txt",
  [...files].sort().join("\n") + "\n",
);
execFileSync("tar", [
  "-czf",
  "upstream-source.tar.gz",
  "-C",
  staging,
  "-T",
  path.resolve(".work/snapshot-files.txt"),
]);
fs.writeFileSync(
  "upstream-source.sha256",
  createHash("sha256")
    .update(fs.readFileSync("upstream-source.tar.gz"))
    .digest("hex") + "  upstream-source.tar.gz\n",
);
console.log(`Snapshot: ${files.size} original files at ${revision}`);
