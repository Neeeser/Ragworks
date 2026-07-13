import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = resolve(frontendRoot, "public");
const appDir = resolve(frontendRoot, "src/app");

const sourcePaths = {
  dark: resolve(publicDir, "ragworks-mark-dark.svg"),
  light: resolve(publicDir, "ragworks-mark-light.svg"),
};

const outputPaths = {
  svg: resolve(appDir, "icon.svg"),
  ico: resolve(appDir, "favicon.ico"),
  apple: resolve(appDir, "apple-icon.png"),
};

// The crop keeps the canonical split/merge loop and equal portions of its input/output
// arms. Changing only the viewBox preserves the navbar mark's exact path geometry.
const FAVICON_VIEW_BOX = "395 345 568 568";
const ICO_SIZES = [16, 32, 48, 256];

function extractPath(svg, id) {
  const match = svg.match(new RegExp(`<path id="${id}"[^>]* d="([^"]+)"`));
  if (!match) {
    throw new Error(`Canonical mark is missing path #${id}`);
  }
  return match[1];
}

function extractGradientStops(svg, id) {
  const gradient = svg.match(
    new RegExp(`<linearGradient id="${id}"[^>]*>([\\s\\S]*?)</linearGradient>`),
  );
  if (!gradient) {
    throw new Error(`Canonical mark is missing gradient #${id}`);
  }

  const colors = [...gradient[1].matchAll(/<stop[^>]* stop-color="([^"]+)"/g)].map(
    (match) => match[1],
  );
  if (colors.length === 0) {
    throw new Error(`Canonical gradient #${id} has no color stops`);
  }
  return colors;
}

function extractCanvasColor(svg) {
  const match = svg.match(/<use href="#pipeline" fill="([^"]+)" stroke=/);
  if (!match) {
    throw new Error("Canonical mark is missing its contrast outline color");
  }
  return match[1];
}

function assertSharedGeometry(darkSvg, lightSvg) {
  for (const id of ["pipeline", "trace"]) {
    if (extractPath(darkSvg, id) !== extractPath(lightSvg, id)) {
      throw new Error(`Canonical dark/light marks disagree on path #${id}`);
    }
  }
}

function lightThemeCss(lightSvg) {
  return ["pipeline-gradient", "trace-gradient"]
    .flatMap((id) =>
      extractGradientStops(lightSvg, id).map(
        (color, index) => `      #${id} stop:nth-child(${index + 1}) { stop-color: ${color}; }`,
      ),
    )
    .join("\n");
}

function squareSvg(darkSvg, lightSvg, { adaptive }) {
  let svg = darkSvg
    .replace('viewBox="180 388 938 479"', `viewBox="${FAVICON_VIEW_BOX}"`)
    .replace(' role="img" aria-labelledby="title"', "")
    .replace(/\n  <title[^>]*>.*?<\/title>/, "");

  if (adaptive) {
    const style = `
    <style>
      @media (prefers-color-scheme: light) {
${lightThemeCss(lightSvg)}
      }
    </style>`;
    svg = svg.replace("\n  <defs>", `\n  <defs>${style}`);
  }

  return `${svg.trim()}\n`;
}

function buildIco(pngs) {
  const directorySize = 6 + pngs.length * 16;
  const directory = Buffer.alloc(directorySize);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(pngs.length, 4);

  let imageOffset = directorySize;
  pngs.forEach(({ size, data }, index) => {
    const entryOffset = 6 + index * 16;
    directory.writeUInt8(size === 256 ? 0 : size, entryOffset);
    directory.writeUInt8(size === 256 ? 0 : size, entryOffset + 1);
    directory.writeUInt8(0, entryOffset + 2);
    directory.writeUInt8(0, entryOffset + 3);
    directory.writeUInt16LE(1, entryOffset + 4);
    directory.writeUInt16LE(32, entryOffset + 6);
    directory.writeUInt32LE(data.length, entryOffset + 8);
    directory.writeUInt32LE(imageOffset, entryOffset + 12);
    imageOffset += data.length;
  });

  return Buffer.concat([directory, ...pngs.map(({ data }) => data)]);
}

async function generateAssets() {
  const darkSvg = readFileSync(sourcePaths.dark, "utf8");
  const lightSvg = readFileSync(sourcePaths.light, "utf8");
  assertSharedGeometry(darkSvg, lightSvg);

  const rasterSource = Buffer.from(squareSvg(darkSvg, lightSvg, { adaptive: false }));
  const icoPngs = await Promise.all(
    ICO_SIZES.map(async (size) => ({
      size,
      data: await sharp(rasterSource).resize(size, size).png().toBuffer(),
    })),
  );

  return {
    [outputPaths.svg]: Buffer.from(squareSvg(darkSvg, lightSvg, { adaptive: true })),
    [outputPaths.ico]: buildIco(icoPngs),
    [outputPaths.apple]: await sharp(rasterSource)
      .resize(180, 180)
      .flatten({ background: extractCanvasColor(darkSvg) })
      .png()
      .toBuffer(),
  };
}

function writeOrCheck(assets, checkOnly) {
  const stale = [];
  for (const [path, contents] of Object.entries(assets)) {
    if (checkOnly) {
      if (!existsSync(path) || !readFileSync(path).equals(contents)) {
        stale.push(path);
      }
      continue;
    }
    writeFileSync(path, contents);
  }

  if (stale.length > 0) {
    const staleList = stale.map((path) => `- ${path}`).join("\n");
    throw new Error(`Generated brand icons are stale:\n${staleList}`);
  }
}

const checkOnly = process.argv.includes("--check");
writeOrCheck(await generateAssets(), checkOnly);
