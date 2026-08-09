import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

// Mirrors of the FlowPlayer playback defaults the capture page runs at
// (DEFAULT_PROCESS_MS / DEFAULT_TRAVEL_MS) — the recording has to stay on the
// page until playback finishes, and capture-script.test.ts fails if they drift.
export const PROCESS_MS = 1250;
export const TRAVEL_MS = 650;
const HOLD_MS = 500;
const PORT = 3417;
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
export const CAPTURE_SIZE = { width: 1920, height: 720 };
export const GIF_ENCODER = "gifski";
// The rotation plays every shipped preset, so the GIF carries several times
// the frames a two-scene cycle did. Frame rate and output width are what buy
// that back under the 8 MB guard; the width stays above the 1440 floor the
// README asset rules set, so the cards remain legible on a HiDPI screen.
export const GIF_FPS = 12;
export const GIF_WIDTH = 1440;
export const FADE_SECONDS = 0.35;
// The canvas colour is read off the rendered page per theme, never listed here:
// it is a design token, and a stale copy paints a mismatched mask rectangle into
// the frame and pins a colour the frames don't contain into the GIF palette.
export const CAPTURE_THEMES = [
  {
    name: "dark",
    gifName: "pipeline-flow-dark.gif",
    posterName: "pipeline-flow-dark.png",
  },
  {
    name: "light",
    gifName: "pipeline-flow-light.gif",
    posterName: "pipeline-flow-light.png",
  },
];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(frontendDir, "..");
const fixturePath = path.join(frontendDir, "src/components/readme/readme-pipelines.generated.json");
const assetDir = path.join(repoRoot, "docs/assets");

export const captureDurationMs = (stepCount) =>
  stepCount * PROCESS_MS + Math.max(0, stepCount - 1) * TRAVEL_MS + HOLD_MS;

/**
 * Where each clip starts inside the stitched result. An xfade overlaps its two
 * inputs by the fade, so every later clip starts one full fade earlier than its
 * raw position — miss this and the tail scenes drift past the end of the video.
 */
export const xfadeOffsets = (durations) => {
  const offsets = [];
  let elapsed = durations[0] ?? 0;
  for (let i = 1; i < durations.length; i += 1) {
    offsets.push(Math.max(0, elapsed - FADE_SECONDS));
    elapsed += durations[i] - FADE_SECONDS;
  }
  return offsets;
};

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} failed.`);
  }
  return result.stdout.trim();
};

const waitForServer = async (url, server) => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error("Next.js exited before capture started.");
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The dev server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the README capture page.");
};

/** The scene cycle, read from the landing registry the app itself rotates. */
const loadScenes = async () => {
  const response = await fetch(`http://127.0.0.1:${PORT}/readme-pipeline-capture/scenes`);
  if (!response.ok) throw new Error(`Capture scene list unavailable (${response.status}).`);
  const { scenes } = await response.json();
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error("The landing scene registry is empty — nothing to capture.");
  }
  return scenes;
};

const recordScene = async (browser, sceneId, theme, tempDir, posterPath) => {
  const context = await browser.newContext({
    viewport: CAPTURE_SIZE,
    colorScheme: theme.name,
    reducedMotion: "no-preference",
    recordVideo: { dir: tempDir, size: CAPTURE_SIZE },
  });
  const page = await context.newPage();
  const recordingStartedAt = Date.now();
  const video = page.video();
  await page.goto(`http://127.0.0.1:${PORT}/readme-pipeline-capture?scene=${sceneId}`);
  const capture = page.locator(`[data-readme-capture="${sceneId}"]`);
  await capture.waitFor();
  await page
    .locator("nextjs-portal")
    .evaluateAll((portals) => portals.forEach((portal) => portal.remove()));
  const canvasColor = await page.evaluate(() => {
    const channels = getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g);
    if (!channels || channels.length < 3) throw new Error("Could not read the canvas colour.");
    return channels
      .slice(0, 3)
      .map((channel) => Math.round(Number(channel)).toString(16).padStart(2, "0"))
      .join("");
  });
  const stepCount = Number(await capture.getAttribute("data-step-count"));
  if (!Number.isInteger(stepCount) || stepCount < 1) {
    throw new Error(`Invalid playback step count for ${sceneId}.`);
  }
  await page.waitForTimeout(700);
  if (posterPath) await capture.screenshot({ path: posterPath });
  await page.locator("[data-capture-start]").evaluate((button) => button.click());
  await page.locator('[data-playback-state="playing"]').waitFor();
  const trimStartSeconds = (Date.now() - recordingStartedAt) / 1000;
  const durationSeconds = captureDurationMs(stepCount) / 1000;
  await page.waitForTimeout(durationSeconds * 1000);
  await context.close();
  if (!video) throw new Error(`Playwright did not record the ${sceneId} scene.`);
  return { path: await video.path(), trimStartSeconds, durationSeconds, canvasColor };
};

const encodeAnimation = (clips, theme, tempDir, gifPath) => {
  const canvasColor = clips[0].canvasColor;
  const combinedPath = path.join(tempDir, `pipeline-flow-${theme.name}.mp4`);
  const inputs = clips.flatMap((clip) => [
    "-ss",
    String(clip.trimStartSeconds),
    "-t",
    String(clip.durationSeconds),
    "-i",
    clip.path,
  ]);
  // Every clip is normalized first (frame rate, the corner mask, pixel format),
  // then folded together left to right so one xfade never sees a raw input.
  const prepared = clips
    .map(
      (_clip, index) =>
        `[${index}:v]fps=${GIF_FPS},drawbox=x=0:y=ih-80:w=100:h=80:` +
        `color=0x${canvasColor}:t=fill,format=yuv420p[v${index}]`,
    )
    .join(";");
  const offsets = xfadeOffsets(clips.map((clip) => clip.durationSeconds));
  const fades = offsets
    .map((offset, index) => {
      const left = index === 0 ? "[v0]" : `[x${index}]`;
      const label = index === offsets.length - 1 ? "[v]" : `[x${index + 1}]`;
      return (
        `${left}[v${index + 1}]xfade=transition=fade:` +
        `duration=${FADE_SECONDS}:offset=${offset}${label}`
      );
    })
    .join(";");
  const filter = offsets.length > 0 ? `${prepared};${fades}` : `${prepared}`;
  run("ffmpeg", [
    "-y",
    ...inputs,
    "-filter_complex",
    filter,
    "-map",
    offsets.length > 0 ? "[v]" : "[v0]",
    "-an",
    combinedPath,
  ]);
  run(GIF_ENCODER, [
    "--fps",
    String(GIF_FPS),
    "--quality",
    "90",
    "--motion-quality",
    "100",
    "--lossy-quality",
    "100",
    "--width",
    String(GIF_WIDTH),
    "--repeat",
    "0",
    "--fixed-color",
    canvasColor,
    "--output",
    gifPath,
    combinedPath,
  ]);
};

const main = async () => {
  run("ffmpeg", ["-version"]);
  run(GIF_ENCODER, ["--version"]);
  run("uv", ["run", "python", "-m", "scripts.export_readme_pipelines", "--output", fixturePath], {
    cwd: repoRoot,
  });
  run("npx", ["prettier", "--write", fixturePath], { cwd: frontendDir });

  const tempDir = await mkdtemp(path.join(tmpdir(), "ragworks-readme-"));
  const server = spawn("npm", ["run", "dev", "--", "-p", String(PORT)], {
    cwd: frontendDir,
    env: { ...process.env, README_CAPTURE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverOutput = "";
  server.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });

  try {
    await waitForServer(`http://127.0.0.1:${PORT}/readme-pipeline-capture/scenes`, server);
    const scenes = await loadScenes();
    process.stdout.write(
      `Capturing ${scenes.length} scenes: ${scenes.map((s) => s.id).join(", ")}\n`,
    );
    const browser = await chromium.launch();
    try {
      for (const theme of CAPTURE_THEMES) {
        const gifPath = path.join(assetDir, theme.gifName);
        const posterPath = path.join(assetDir, theme.posterName);
        const clips = [];
        for (const [index, scene] of scenes.entries()) {
          clips.push(
            await recordScene(browser, scene.id, theme, tempDir, index === 0 ? posterPath : null),
          );
        }
        encodeAnimation(clips, theme, tempDir, gifPath);

        const { size } = await stat(gifPath);
        if (size > MAX_ASSET_BYTES) {
          throw new Error(
            `Generated ${theme.gifName} is ${(size / 1024 / 1024).toFixed(1)} MB; limit is 8 MB.`,
          );
        }
        process.stdout.write(`Updated docs/assets/${theme.gifName} (${size} bytes).\n`);
      }
    } finally {
      await browser.close();
    }
  } catch (error) {
    if (serverOutput) process.stderr.write(serverOutput);
    throw error;
  } finally {
    server.kill("SIGTERM");
    await rm(tempDir, { recursive: true, force: true });
  }
};

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  await main();
}
