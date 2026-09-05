/**
 * Renders the app icons from one SVG source.
 *
 * Kept as a script rather than a build step: icons change about once a
 * project, and a build that shells out to an image library is a build that
 * can fail for reasons unrelated to the code. Run it by hand after editing
 * `MARK`, then commit the PNGs.
 *
 *   node scripts/generate-icons.mjs
 */

import { writeFileSync } from "node:fs";
import sharp from "sharp";

const BG = "#18181b";
const FG = "#fafafa";

/**
 * A descending trend line: what this app is for, legible at 48 px.
 *
 * `inset` is the fraction of the canvas left clear around the mark. A
 * maskable icon may be cropped to a circle by the launcher, so its mark has
 * to sit inside the middle 80%; a plain icon can use more of the square.
 */
function svg({ size, inset, radius }) {
  const pad = size * inset;
  const w = size - pad * 2;
  const y = (f) => pad + w * f;
  const x = (f) => pad + w * f;
  const stroke = Math.max(size * 0.075, 2);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${BG}"/>
  <path d="M ${x(0)} ${y(0.14)} L ${x(0.36)} ${y(0.55)} L ${x(0.62)} ${y(0.34)} L ${x(1)} ${y(0.82)}"
        fill="none" stroke="${FG}" stroke-width="${stroke}"
        stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="${x(1)}" cy="${y(0.82)}" r="${stroke * 0.95}" fill="${FG}"/>
</svg>`;
}

const targets = [
  // Manifest icons. `purpose: "any"`, so the whole square is shown.
  { file: "icon-192.png", size: 192, inset: 0.22, radius: 42 },
  { file: "icon-512.png", size: 512, inset: 0.22, radius: 112 },
  // Maskable: full-bleed, mark inside the safe zone the launcher may crop to.
  { file: "icon-maskable-512.png", size: 512, inset: 0.3, radius: 0 },
  // iOS applies its own rounding and refuses transparency, so this one is a
  // square with no corner radius of its own. 180 is the size Safari asks for.
  { file: "apple-touch-icon.png", size: 180, inset: 0.24, radius: 0 },
];

for (const t of targets) {
  // iOS composites a transparent apple-touch-icon onto black and can render
  // it badly, so that one is flattened to opaque RGB. The rest keep alpha.
  const pipeline = sharp(Buffer.from(svg(t)));
  const png = await (t.file === "apple-touch-icon.png"
    ? pipeline.flatten({ background: BG }).png({ compressionLevel: 9 })
    : pipeline.png({ compressionLevel: 9 })
  ).toBuffer();
  writeFileSync(new URL(`../public/${t.file}`, import.meta.url), png);
  console.log(`${t.file}  ${t.size}x${t.size}  ${png.length} bytes`);
}

// A favicon that is not the Next.js default.
const ico = await sharp(Buffer.from(svg({ size: 64, inset: 0.2, radius: 12 })))
  .png({ compressionLevel: 9 })
  .toBuffer();
writeFileSync(new URL("../public/icon.png", import.meta.url), ico);
console.log(`icon.png  64x64  ${ico.length} bytes`);
