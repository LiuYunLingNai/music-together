import fs from "node:fs";
import path from "node:path";

const generatedRoot = path.resolve("../app/build/generated");
const target = path.resolve(generatedRoot, "foliaAssets/folia");
if (!target.startsWith(generatedRoot + path.sep))
  throw new Error("Invalid generated assets directory");
// Remove only this task's generated output so obsolete chunk hashes cannot bloat APKs.
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
fs.cpSync("dist", target, { recursive: true });
fs.copyFileSync("LICENSE.folia", path.join(target, "LICENSE.folia"));
fs.copyFileSync("UPSTREAM.md", path.join(target, "UPSTREAM.md"));
