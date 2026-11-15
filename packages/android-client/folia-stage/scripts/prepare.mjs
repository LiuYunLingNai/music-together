import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const archive = fs.readFileSync("upstream-source.tar.gz");
const expected = fs
  .readFileSync("upstream-source.sha256", "utf8")
  .split(" ")[0];
if (createHash("sha256").update(archive).digest("hex") !== expected)
  throw new Error("Folia source archive checksum mismatch");
fs.mkdirSync(".work", { recursive: true });
execFileSync("tar", ["-xzf", "upstream-source.tar.gz", "-C", ".work"]);
