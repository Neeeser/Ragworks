import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const PROCESS_MS = 550;
const TRAVEL_MS = 400;
const HOLD_MS = 800;
const PORT = 3417;
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
export const CAPTURE_SIZE = { width: 1920, height: 720 };
export const GIF_ENCODER = "gifski";
export const GIF_WIDTH = 1920;
export const CAPTURE_THEMES = [
  {
    name: "dark",
    canvasColor: "05060a",
    gifName: "pipeline-flow-dark.gif",
    posterName: "pipeline-flow-dark.png",
  },
  {
    name: "light",
    canvasColor: "f6f7fb",
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

const recordScene = async (browser, kind, theme, tempDir, posterPath) => {
  const context = await browser.newContext({
    viewport: CAPTURE_SIZE,
    colorScheme: theme.name,
    reducedMotion: "no-preference",
    recordVideo: { dir: tempDir, size: CAPTURE_SIZE },
  });
  const page = await context.newPage();
  const recordingStartedAt = Date.now();
  const video = page.video();
  await page.goto(`http://127.0.0.1:${PORT}/readme-pipeline-capture?kind=${kind}`);
  const capture = page.locator(`[data-readme-capture="${kind}"]`);
  await capture.waitFor();
  await page
    .locator("nextjs-portal")
    .evaluateAll((portals) => portals.forEach((portal) => portal.remove()));
  const stepCount = Number(await capture.getAttribute("data-step-count"));
  if (!Number.isInteger(stepCount) || stepCount < 1) {
    throw new Error(`Invalid playback step count for ${kind}.`);
  }
  await page.waitForTimeout(700);
  if (posterPath) await capture.screenshot({ path: posterPath });
  await page.locator("[data-capture-start]").evaluate((button) => button.click());
  await page.locator('[data-playback-state="playing"]').waitFor();
  const trimStartSeconds = (Date.now() - recordingStartedAt) / 1000;
  const durationSeconds = captureDurationMs(stepCount) / 1000;
  await page.waitForTimeout(durationSeconds * 1000);
  await context.close();
  if (!video) throw new Error(`Playwright did not record the ${kind} scene.`);
  return { path: await video.path(), trimStartSeconds, durationSeconds };
};

const encodeAnimation = (ingestionVideo, retrievalVideo, theme, tempDir, gifPath) => {
  const combinedPath = path.join(tempDir, `pipeline-flow-${theme.name}.mp4`);
  const fadeSeconds = 0.35;
  const ingestionDuration = ingestionVideo.durationSeconds;
  const fadeOffset = Math.max(0, ingestionDuration - fadeSeconds);
  run("ffmpeg", [
    "-y",
    "-ss",
    String(ingestionVideo.trimStartSeconds),
    "-t",
    String(ingestionVideo.durationSeconds),
    "-i",
    ingestionVideo.path,
    "-ss",
    String(retrievalVideo.trimStartSeconds),
    "-t",
    String(retrievalVideo.durationSeconds),
    "-i",
    retrievalVideo.path,
    "-filter_complex",
    `[0:v]fps=10,drawbox=x=0:y=ih-80:w=100:h=80:color=0x${theme.canvasColor}:t=fill,format=yuv420p[v0];[1:v]fps=10,drawbox=x=0:y=ih-80:w=100:h=80:color=0x${theme.canvasColor}:t=fill,format=yuv420p[v1];[v0][v1]xfade=transition=fade:duration=${fadeSeconds}:offset=${fadeOffset}[v]`,
    "-map",
    "[v]",
    "-an",
    combinedPath,
  ]);
  run(GIF_ENCODER, [
    "--fps",
    "10",
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
    theme.canvasColor,
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
    await waitForServer(`http://127.0.0.1:${PORT}/readme-pipeline-capture`, server);
    const browser = await chromium.launch();
    try {
      for (const theme of CAPTURE_THEMES) {
        const gifPath = path.join(assetDir, theme.gifName);
        const posterPath = path.join(assetDir, theme.posterName);
        const ingestionVideo = await recordScene(browser, "ingestion", theme, tempDir, posterPath);
        const retrievalVideo = await recordScene(browser, "retrieval", theme, tempDir);
        encodeAnimation(ingestionVideo, retrievalVideo, theme, tempDir, gifPath);

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
