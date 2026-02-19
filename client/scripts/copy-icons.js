/**
 * Copies icon PNGs into client/public/ for the build (favicon, apple-touch-icon,
 * PWA icons, og-image). Run via npm prebuild.
 *
 * Source: HUSH_ICONS_DIR if set (path to folder containing the PNGs), otherwise
 * repo root hush-icons/ if present. If neither exists, skips; use icons already
 * in client/public/ (e.g. after copying from your external hush-icons once).
 */
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../..');
const srcDir = process.env.HUSH_ICONS_DIR
  ? (process.env.HUSH_ICONS_DIR.startsWith('/') ? process.env.HUSH_ICONS_DIR : join(root, process.env.HUSH_ICONS_DIR))
  : join(root, 'hush-icons');
const destDir = join(root, 'client/public');

const files = [
  'favicon.png',
  'favicon-light.png',
  'apple-touch-icon.png',
  'apple-touch-icon-light.png',
  'icon-192.png',
  'icon-192-light.png',
  'icon-512.png',
  'icon-512-light.png',
  'og-image.png',
];

if (!existsSync(srcDir)) {
  process.exit(0);
}

if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

for (const name of files) {
  const src = join(srcDir, name);
  if (!existsSync(src)) continue;
  copyFileSync(src, join(destDir, name));
  console.log('copy-icons:', name);
}
