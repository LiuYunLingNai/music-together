import { chromium } from "@playwright/test";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".webp": "image/webp",
  ".png": "image/png",
  ".json": "application/json",
};
const server = http.createServer((req, res) => {
  let url = new URL(req.url, "http://localhost");
  let relative = url.pathname.replace(/^\/assets\/folia\//, "");
  if (relative === "") relative = "index.html";
  if (relative.startsWith("/jizura/")) relative = relative.slice(1);
  if (relative === "/favicon.ico") {
    res.writeHead(204).end();
    return;
  }
  const file = path.resolve("dist", relative);
  if (!file.startsWith(path.resolve("dist") + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    res.setHeader(
      "Content-Type",
      mime[path.extname(file)] || "application/octet-stream",
    );
    res.end(fs.readFileSync(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(4176, "127.0.0.1", r));
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const modes = [
  "sonnet",
  "hanabi",
  "classic",
  "still",
  "blank",
  "cadenza",
  "cappella",
  "claddagh",
  "diorama",
  "fume",
  "kinetic",
  "lumiere",
  "machi",
  "monet",
  "nebbia",
  "partita",
  "pendolo",
  "prompt",
  "tempera",
  "tilt",
];
const upstreamModes = fs
  .readFileSync(".work/src/types/visualizerModes.ts", "utf8")
  .split("export const BUILTIN_VISUALIZER_MODES = [")[1]
  .split("] as const")[0]
  .match(/'[a-z]+'/g)
  .map((id) => id.slice(1, -1));
const nativeModes = [
  ...fs
    .readFileSync(
      "../app/src/main/java/io/github/yueby/musictogether/ui/player/folia/FoliaStagePayload.kt",
      "utf8",
    )
    .split("internal enum class FoliaStageMode")[1]
    .split("\n}")[0]
    .matchAll(/\("([a-z]+)",/g),
].map((match) => match[1]);
if (
  JSON.stringify([...modes].sort()) !==
    JSON.stringify([...upstreamModes].sort()) ||
  JSON.stringify([...modes].sort()) !== JSON.stringify([...nativeModes].sort())
)
  throw new Error("Native and browser stage lists do not match upstream");
const results = [];
for (const viewport of [
  { width: 390, height: 844 },
  { width: 1280, height: 720 },
])
  for (const mode of modes) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.stack || e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text().slice(0, 250));
    });
    await page.goto("http://127.0.0.1:4176/assets/folia/index.html");
    try {
      await page.waitForFunction(() => Boolean(window.FoliaStage), {
        timeout: 10000,
      });
      await page.evaluate((mode) => {
        const lines = Array.from({ length: 8 }, (_, i) => ({
          id: String(i),
          fullText: i % 2 ? "一起听见远方的声音" : "让音乐在此刻相遇",
          words: (i % 2
            ? ["一起", "听见", "远方", "的", "声音"]
            : ["让", "音乐", "在", "此刻", "相遇"]
          ).map((text, j) => ({
            text,
            startTime: i * 4 + j * 0.7,
            endTime: i * 4 + (j + 1) * 0.7,
          })),
          startTime: i * 4,
          endTime: (i + 1) * 4,
          translation: "Listen to the music together",
        }));
        window.FoliaStage.document({
          seed: "demo",
          songTitle: "一起听见",
          songArtist: "Music Together",
          lines,
        });
        window.FoliaStage.mode(mode);
        window.FoliaStage.frame({
          position: 5,
          lineIndex: 1,
          paused: false,
          power: 80,
          bass: 100,
          lowMid: 80,
          mid: 100,
          vocal: 90,
          treble: 40,
          chromeHidden: true,
          spectrum: [10, 80, 120, 180],
        });
      }, mode);
      await page.waitForTimeout(1500);
      const geometry = await page.evaluate(() => ({
        rootHeight: document.getElementById("root").clientHeight,
        canvases: Array.from(document.querySelectorAll("canvas")).map(
          (canvas) => ({
            width: canvas.width,
            height: canvas.height,
            visibleHeight: canvas.getBoundingClientRect().height,
          }),
        ),
      }));
      if (geometry.rootHeight <= 0) errors.push("Stage root has zero height");
      if (
        geometry.canvases.some(
          (canvas) =>
            canvas.width <= 0 ||
            canvas.height <= 0 ||
            canvas.visibleHeight <= 0,
        )
      )
        errors.push("Stage canvas has zero dimensions");
      fs.mkdirSync(".work/screens", { recursive: true });
      await page.screenshot({
        path: ".work/screens/" + mode + "-" + viewport.width + ".png",
      });
    } catch (e) {
      errors.push(e.message);
    }
    if (mode === "kinetic") {
      const frame = page.frames().find((f) => f.url().includes("/jizura/"));
      if (!frame || (await frame.locator("canvas").count()) === 0)
        errors.push("JIZURA canvas missing");
    }
    try {
      await page.evaluate(() => {
        window.FoliaStage?.frame({
          position: 22,
          lineIndex: 5,
          paused: true,
          chromeHidden: true,
        });
        window.FoliaStage?.frame({
          position: 2,
          lineIndex: 0,
          paused: true,
          chromeHidden: true,
        });
      });
    } catch (error) {
      errors.push(error.message);
    }
    await page.waitForTimeout(100);
    const failure = await page
      .evaluate(() => window.__foliaFailure)
      .catch((error) => error.message);
    if (failure) errors.push("Stage error boundary: " + failure);
    results.push({
      mode,
      viewport,
      errors,
      canvas: await page.locator("canvas").count(),
      text: (await page.locator("body").innerText()).slice(0, 100),
    });
    console.log(JSON.stringify(results.at(-1)));
    await page.close();
  }
for (const viewport of [
  { width: 375, height: 667 },
  { width: 844, height: 390 },
]) {
  for (const mode of ["classic", "partita", "tilt"]) {
    const page = await browser.newPage({ viewport });
    await page.goto("http://127.0.0.1:4176/assets/folia/index.html");
    await page.waitForFunction(() => Boolean(window.FoliaStage));
    for (const fontScale of [1, 1.3]) {
      await page.evaluate(
        ({ mode, fontScale }) => {
          const fullText =
            "也许时间是一种解药也是我现在正服下的毒药爱你让我重新编织脑海中温暖的记忆";
          const words = Array.from(fullText, (text, index) => ({
            text,
            startTime: index * 0.2,
            endTime: (index + 1) * 0.2,
          }));
          window.FoliaStage.document({
            seed: "long-line",
            lyricsFontScale: fontScale,
            lines: [{ words, fullText, startTime: 0, endTime: 100 }],
          });
          window.FoliaStage.mode(mode);
          window.FoliaStage.frame({
            position: 12,
            lineIndex: 0,
            paused: true,
            chromeHidden: true,
          });
        },
        { mode, fontScale },
      );
      // The upstream word components subscribe after mounting. Deliver a later
      // clock sample as NativePlayer does so the test measures visible glyphs.
      await page.waitForTimeout(200);
      await page.evaluate((fontScale) => {
        let sample = 0;
        const frames = setInterval(() => {
          window.FoliaStage.frame({
            position: 4 + fontScale * 0.01 + sample++ * 0.001,
            lineIndex: 0,
            paused: false,
            chromeHidden: true,
          });
        }, 50);
        setTimeout(() => clearInterval(frames), 550);
      }, fontScale);
      await page.waitForTimeout(600);
      const geometry = await page.evaluate(() => {
        const fit = document.querySelector("[data-folia-lyric-fit]");
        const area = fit?.parentElement;
        const rect = fit?.getBoundingClientRect();
        const bounds = area?.getBoundingClientRect();
        const glyphs = Array.from(fit?.querySelectorAll("span") ?? []).filter(
          (element) => {
            if (element.childElementCount > 0 || !element.textContent.trim())
              return false;
            let opacity = 1;
            for (
              let node = element;
              node && node !== fit.parentElement;
              node = node.parentElement
            )
              opacity *= Number(getComputedStyle(node).opacity);
            return opacity > 0.1;
          },
        );
        return rect && bounds
          ? {
              top: rect.top,
              bottom: rect.bottom,
              left: rect.left,
              right: rect.right,
              areaTop: bounds.top,
              areaBottom: bounds.bottom,
              areaLeft: bounds.left,
              areaRight: bounds.right,
              visibleGlyphs: glyphs.length,
              glyphTop: Math.min(
                ...glyphs.map((element) => element.getBoundingClientRect().top),
              ),
              glyphBottom: Math.max(
                ...glyphs.map(
                  (element) => element.getBoundingClientRect().bottom,
                ),
              ),
              glyphLeft: Math.min(
                ...glyphs.map(
                  (element) => element.getBoundingClientRect().left,
                ),
              ),
              glyphRight: Math.max(
                ...glyphs.map(
                  (element) => element.getBoundingClientRect().right,
                ),
              ),
            }
          : null;
      });
      const errors = [];
      if (
        !geometry ||
        geometry.top < geometry.areaTop - 2 ||
        geometry.bottom > geometry.areaBottom + 2 ||
        geometry.left < geometry.areaLeft - 2 ||
        geometry.right > geometry.areaRight + 2
      )
        errors.push("Long lyric group exceeds stage bounds");
      if (
        !geometry ||
        geometry.visibleGlyphs === 0 ||
        geometry.glyphTop < 0 ||
        geometry.glyphBottom > viewport.height ||
        geometry.glyphLeft < 0 ||
        geometry.glyphRight > viewport.width
      )
        errors.push("Visible lyric glyphs leave viewport bounds");
      results.push({ mode, viewport, fontScale, geometry, errors });
      console.log(JSON.stringify(results.at(-1)));
      await page.screenshot({
        path: `.work/screens/${mode}-long-${viewport.width}-${fontScale}.png`,
      });
    }
    await page.close();
  }
}
fs.writeFileSync(".work/render-results.json", JSON.stringify(results, null, 2));
await browser.close();
server.close();
if (results.some((result) => result.errors.length)) process.exitCode = 1;
