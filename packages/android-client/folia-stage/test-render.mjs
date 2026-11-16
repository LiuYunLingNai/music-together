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
      await page.evaluate(() => window.FoliaStage.settings(true));
      await page.getByRole("dialog", { name: "舞台配置" }).waitFor();
      // Every mode owns its real settings panel, including those that read
      // asset/loading flags from stores. Opening it must not throw.
      await page.evaluate(() => window.FoliaStage.settings(false));
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
      await page.evaluate(() => window.FoliaStage.settings(true));
      await page.getByRole("dialog", { name: "舞台配置" }).waitFor();
      await page.waitForTimeout(100);
      const untranslated = await page.getByRole("dialog").innerText();
      if (mode === "tempera") {
        const panel = page.getByRole("dialog", { name: "舞台配置" });
        for (const label of ["景深", "镜头平移", "歌词远近"]) {
          const disabled = await panel
            .getByRole("slider", { name: label, exact: true })
            .evaluate((element) => Boolean(element.closest("[inert]")));
          if (!disabled)
            errors.push(`Unavailable beat effect ${label} is still enabled`);
        }
        if (
          await panel
            .getByRole("slider", { name: "镜头运动强度", exact: true })
            .evaluate((element) => Boolean(element.closest("[inert]")))
        )
          errors.push("Available camera control is disabled");
      }
      if (/options\.[A-Za-z]|ui\.[A-Za-z]/.test(untranslated))
        errors.push("Stage settings contain untranslated keys");
      await page.evaluate(() => window.FoliaStage.settings(false));
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
      await page.evaluate(() => document.fonts.ready);
      // ICU segmentation may replace the word nodes after first paint. A paused
      // frame must still initialize these words from the existing shared clock.
      await page.waitForFunction(
        () => {
          const fit = document.querySelector("[data-folia-lyric-fit]");
          return [...(fit?.querySelectorAll("span") ?? [])].some((element) => {
            if (element.childElementCount || !element.textContent.trim())
              return false;
            let opacity = 1;
            for (
              let node = element;
              node && node !== fit.parentElement;
              node = node.parentElement
            )
              opacity *= Number(getComputedStyle(node).opacity);
            return opacity > 0.1;
          });
        },
        null,
        { timeout: 15000 },
      );
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
// Exercise the settings as a user: live change, tab navigation, reload and reset.
for (const viewport of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
]) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:4176/assets/folia/index.html");
  await page.waitForFunction(() => Boolean(window.FoliaStage));
  await page.evaluate(() => {
    window.FoliaStage.mode("classic");
    window.FoliaStage.settings(true);
  });
  const dialog = page.getByRole("dialog", { name: "舞台配置" });
  await dialog.waitFor();
  const panelBounds = await dialog.boundingBox();
  if (
    !panelBounds ||
    (viewport.width < viewport.height &&
      (panelBounds.x !== 0 || panelBounds.height >= viewport.height)) ||
    (viewport.width > viewport.height && panelBounds.width >= viewport.width)
  )
    errors.push("Settings panel orientation does not match measured viewport");
  const switches = dialog.getByRole("switch");
  const original = await switches.first().getAttribute("aria-checked");
  await switches.first().click();
  await page.waitForFunction(
    () => localStorage.getItem("classic_tuning") !== null,
  );
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("classic_tuning")),
  );
  if (stored.enableWordRotation === (original === "true"))
    errors.push("Stage toggle did not save");
  await page.reload();
  await page.waitForFunction(() => Boolean(window.FoliaStage));
  await page.evaluate(() => {
    window.FoliaStage.mode("classic");
    window.FoliaStage.settings(true);
  });
  await dialog.waitFor();
  if ((await switches.first().getAttribute("aria-checked")) === original)
    errors.push("Stage toggle did not restore");
  await dialog.getByRole("button", { name: "恢复本页默认" }).click();
  if ((await switches.first().getAttribute("aria-checked")) !== original)
    errors.push("Stage reset did not restore defaults");
  for (const tab of ["文字", "字幕", "性能", "背景"]) {
    await dialog.getByRole("button", { name: tab, exact: true }).click();
    await page.waitForTimeout(100);
  }
  await dialog.getByRole("button", { name: "舞台", exact: true }).click();
  await page.evaluate(() => {
    window.FoliaStage.mode("still");
    window.FoliaStage.document({
      seed: "settings-live",
      lines: [
        {
          fullText: "设置实时预览",
          words: [{ text: "设置实时预览", startTime: 0, endTime: 30 }],
          startTime: 0,
          endTime: 30,
        },
      ],
    });
    window.FoliaStage.frame({
      position: 3,
      lineIndex: 0,
      paused: true,
      chromeHidden: true,
    });
  });
  const stageText = page
    .locator("[data-folia-stage-shell]")
    .getByText("设置实时预览", { exact: true });
  await stageText.waitFor();
  await dialog
    .getByRole("switch", { name: "显示舞台歌词", exact: true })
    .click();
  await stageText.waitFor({ state: "hidden" });
  await dialog
    .getByRole("switch", { name: "显示舞台歌词", exact: true })
    .click();
  await stageText.waitFor();
  await dialog.getByRole("button", { name: "背景", exact: true }).click();
  for (let index = 2; index < 9; index++) {
    await dialog.getByRole("combobox").first().click();
    const option = page.getByRole("option").nth(index);
    const background = await option.innerText();
    await option.click();
    await page.waitForTimeout(500);
    const text = await dialog.innerText();
    if (/options\.[A-Za-z]/.test(text))
      errors.push(`Background ${background} contains untranslated keys`);
  }
  await dialog.getByRole("combobox").first().click();
  await page.getByRole("option").first().click();
  // Entry-owned props are part of the renderer contract. Nebbia reads its
  // tuning here rather than through the generic tuning.apply hook.
  await page.evaluate(() => window.FoliaStage.mode("nebbia"));
  await dialog.getByRole("button", { name: "舞台", exact: true }).click();
  const scenery = dialog.getByRole("button", { name: "梦海流萤", exact: true });
  await scenery.click();
  await page.waitForTimeout(500);
  const nebbiaTuning = await page.evaluate(() => {
    const root = document.getElementById("root");
    const fiber =
      root[Object.keys(root).find((key) => key.startsWith("__reactContainer"))];
    const visited = new Set();
    let received;
    function walk(node) {
      if (!node || visited.has(node)) return;
      visited.add(node);
      if (node.memoizedProps?.nebbiaTuning)
        received = node.memoizedProps.nebbiaTuning;
      walk(node.child);
      walk(node.sibling);
    }
    walk(fiber.stateNode?.current ?? fiber);
    return received;
  });
  if (nebbiaTuning?.behind !== "aquarium")
    errors.push("Nebbia settings did not reach the renderer entry");
  await page.evaluate(() => window.FoliaStage.mode("still"));
  await dialog.getByRole("button", { name: "字幕", exact: true }).click();
  await page.evaluate(() =>
    window.FoliaStage.document({
      lines: [
        {
          fullText: "主歌词",
          startTime: 0,
          endTime: 30,
          words: [{ text: "主歌词", startTime: 0, endTime: 30 }],
          translation: "Translation",
          romanization: "Romanization",
        },
      ],
    }),
  );
  const rowCount = dialog
    .locator(".st-row")
    .filter({ hasText: "底部字幕行数" });
  await rowCount.getByRole("button", { name: "双行", exact: true }).click();
  await page.waitForTimeout(150);
  const firstRow = dialog
    .locator(".st-row")
    .filter({ hasText: "第一行" })
    .getByRole("combobox");
  await firstRow.click();
  await page
    .getByRole("listbox", { name: "第一行", exact: true })
    .getByRole("option", { name: "罗马音", exact: true })
    .click();
  const secondRow = dialog
    .locator(".st-row")
    .filter({ hasText: "第二行" })
    .getByRole("combobox");
  await secondRow.click();
  await page
    .getByRole("listbox", { name: "第二行", exact: true })
    .getByRole("option", { name: "翻译", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document
        .querySelector("[data-folia-stage-shell]")
        ?.textContent.includes("Romanization") &&
      document
        .querySelector("[data-folia-stage-shell]")
        ?.textContent.includes("Translation"),
  );
  // Native file chooser calls the same input used by the browser. Verify the
  // binary image survives a new document and that its blob URL is rebuilt.
  await page.evaluate(() => window.FoliaStage.mode("cappella"));
  await dialog.getByRole("button", { name: "舞台", exact: true }).click();
  const inputs = dialog.locator('input[type="file"]');
  await inputs.first().setInputFiles({
    name: "emoji.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZJ0AAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await page.waitForFunction(() =>
    document.querySelector('[role="dialog"] img[src^="blob:"]'),
  );
  await page.reload();
  await page.waitForFunction(() => Boolean(window.FoliaStage));
  await page.evaluate(() => {
    window.FoliaStage.mode("cappella");
    window.FoliaStage.settings(true);
  });
  await page.waitForFunction(() =>
    document.querySelector('[role="dialog"] img[src^="blob:"]'),
  );
  await page.screenshot({
    path: `.work/screens/settings-${viewport.width}.png`,
  });
  await page.evaluate(() => window.FoliaStage.mode("kinetic"));
  await dialog.getByRole("button", { name: /打开原版编辑台/ }).click();
  await page.locator('iframe[src="/jizura/editor.html"]').waitFor();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("iframe")].some(
        (frame) => frame.contentWindow?.J?.uiApi,
      ),
    null,
    { timeout: 15000 },
  );
  const editor = page
    .frames()
    .find((frame) => frame.url().includes("/jizura/editor.html"));
  if (!editor) errors.push("Original JIZURA editor did not open");
  else
    await editor.waitForFunction(() => Boolean(window.J?.uiApi), null, {
      timeout: 15000,
    });
  await page.evaluate(() => window.FoliaStage.settings(false));
  if (await dialog.count()) errors.push("Settings dialog did not close");
  results.push({ test: "settings-persistence", viewport, errors });
  console.log(JSON.stringify(results.at(-1)));
  await context.close();
}
fs.writeFileSync(".work/render-results.json", JSON.stringify(results, null, 2));
await browser.close();
server.close();
if (results.some((result) => result.errors.length)) process.exitCode = 1;
