/**
 * generate-icon.mjs — Resizes icon.png to multiple square sizes,
 * then builds a proper Windows .ico via png-to-ico for use by
 * Electron as the window/taskbar icon and by electron-builder
 * as the exe icon.
 */

import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const srcIcon = path.join(root, 'icon.png');
const buildDir = path.join(root, 'build');
const outIco = path.join(buildDir, 'icon.ico');
const outPng256 = path.join(buildDir, 'icon.png');

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

async function main() {
  if (!fs.existsSync(srcIcon)) {
    console.error(`[icon] Source icon not found: ${srcIcon}`);
    process.exit(1);
  }

  fs.mkdirSync(buildDir, { recursive: true });

  console.log(`[icon] Reading ${srcIcon}...`);
  const metadata = await sharp(srcIcon).metadata();
  console.log(`[icon] Source: ${metadata.width}x${metadata.height}`);

  // Generate all sizes as temporary PNG files (png-to-ico needs file paths)
  const tmpPaths = [];
  for (const size of ICO_SIZES) {
    console.log(`[icon]   Resizing to ${size}x${size}...`);
    const tmpPath = path.join(buildDir, `icon-${size}.png`);
    await sharp(srcIcon)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(tmpPath);
    tmpPaths.push(tmpPath);
  }

  // Copy the 256×256 version as the runtime icon for Electron
  const png256Path = path.join(buildDir, 'icon-256.png');
  fs.copyFileSync(png256Path, outPng256);
  console.log(`[icon] Wrote ${outPng256}`);

  // Build .ico from all the resized PNGs
  console.log(`[icon] Building .ico...`);
  const icoBuffer = await pngToIco(tmpPaths);
  fs.writeFileSync(outIco, icoBuffer);
  console.log(`[icon] Wrote ${outIco} (${(icoBuffer.length / 1024).toFixed(1)} KB)`);

  // Clean up temporary sized PNGs
  for (const tmp of tmpPaths) {
    fs.unlinkSync(tmp);
  }

  console.log('[icon] Done!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
