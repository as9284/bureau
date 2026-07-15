/**
 * Build Bureau icon set for Windows 11 (transparent PNG + multi-size ICO).
 *
 * Usage: node scripts/build-icons.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import toIco from 'to-ico';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'assets');
const OUT = path.join(ASSETS, 'icons');

const MASTER_PATH = path.join(ASSETS, 'bureau-icon-master.png');
const PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const source = await fs.readFile(MASTER_PATH);

  const pngBuffers = {};
  for (const size of PNG_SIZES) {
    const buf = await sharp(source)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();

    // Verify alpha exists on master sizes
    if (size === 256) {
      const { data } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let transparent = 0;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 10) transparent++;
      }
      const ratio = transparent / (data.length / 4);
      if (ratio < 0.2) {
        throw new Error(`Icon transparency too low (${ratio.toFixed(2)}); expected clear taskbar alpha.`);
      }
      console.log(`Alpha check @256: ${(ratio * 100).toFixed(1)}% transparent`);
    }

    pngBuffers[size] = buf;
    await fs.writeFile(path.join(OUT, `icon-${size}.png`), buf);
  }

  // Primary PNG used by Electron packager / window icon
  await fs.writeFile(path.join(ASSETS, 'icon.png'), pngBuffers[512]);
  await fs.writeFile(path.join(OUT, 'icon.png'), pngBuffers[256]);

  const ico = await toIco(ICO_SIZES.map((size) => pngBuffers[size]));
  await fs.writeFile(path.join(ASSETS, 'icon.ico'), ico);
  await fs.writeFile(path.join(OUT, 'icon.ico'), ico);

  console.log('Built:');
  console.log('  assets/icon.ico');
  console.log('  assets/icon.png');
  console.log('  assets/icons/icon-*.png');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
