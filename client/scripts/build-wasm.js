/**
 * Builds hush-crypto WASM if src/wasm/ output is missing.
 * Hooked into npm dev/build via "prebuild:wasm" script.
 *
 * Skips if src/wasm/hush_crypto.js already exists (use --force to rebuild).
 * Exits with a clear message if wasm-pack is not installed.
 */
import { existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientDir = join(__dirname, '..');
const crateDir = join(clientDir, '..', 'hush-crypto');
const wasmOutDir = join(clientDir, 'src', 'wasm');
const marker = join(wasmOutDir, 'hush_crypto.js');

const force = process.argv.includes('--force');

if (!force && existsSync(marker)) {
  console.log('[build-wasm] src/wasm/ already present, skipping (use --force to rebuild)');
  process.exit(0);
}

if (!existsSync(crateDir)) {
  console.error('[build-wasm] hush-crypto/ crate not found at', crateDir);
  process.exit(1);
}

try {
  execFileSync('wasm-pack', ['--version'], { stdio: 'pipe' });
} catch {
  console.error(
    '[build-wasm] wasm-pack not found. Install it:\n' +
    '  cargo install wasm-pack\n' +
    '  or: curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh'
  );
  process.exit(1);
}

console.log('[build-wasm] Building hush-crypto WASM...');
execFileSync('wasm-pack', ['build', crateDir, '--target', 'web', '--out-dir', wasmOutDir], {
  stdio: 'inherit',
});
console.log('[build-wasm] Done.');
