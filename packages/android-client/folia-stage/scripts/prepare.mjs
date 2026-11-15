import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
const archive = fs.readFileSync("upstream-source.tar.gz");
const expected = fs
  .readFileSync("upstream-source.sha256", "utf8")
  .split(" ")[0];
if (createHash("sha256").update(archive).digest("hex") !== expected)
  throw new Error("Folia source archive checksum mismatch");
fs.mkdirSync(".work", { recursive: true });
// Build only the verified snapshot. Stale sources from earlier snapshots can
// otherwise hide missing dependencies that a clean CI checkout will reject.
const generatedRoot = path.resolve(".work");
for (const name of ["src", "shared", "packages", "dev", "assets"]) {
  const target = path.resolve(generatedRoot, name);
  if (!target.startsWith(generatedRoot + path.sep))
    throw new Error("Invalid extracted source path");
  fs.rmSync(target, { recursive: true, force: true });
}
execFileSync("tar", ["-xzf", "upstream-source.tar.gz", "-C", ".work"]);
