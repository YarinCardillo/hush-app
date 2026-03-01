import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

// Rewrites the /wasm/hush_crypto.js import in hushCrypto.js before
// vite:import-analysis transforms it. Vite only flags string literal arguments
// to import() that resolve to /public — wrapping the path in an IIFE arrow
// ((_u) => import(_u)) makes the argument a variable reference, bypassing
// the check. Production is unaffected (rollupOptions.external handles it).
const wasmPublicImportPlugin = {
  name: 'wasm-public-import',
  enforce: 'pre',
  transform(code, id) {
    if (!id.includes('hushCrypto')) return;
    const before = code.includes("import(/* @vite-ignore */ '/wasm/hush_crypto.js')");
    const out = code.replace(
      "import(/* @vite-ignore */ '/wasm/hush_crypto.js')",
      "((_u) => import(_u))('/wasm/hush_crypto.js')",
    );
    return out;
  },
};

// Custom middleware to force correct MIME type for WASM files
const wasmContentTypePlugin = {
  name: 'wasm-content-type-plugin',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      // Check for .wasm in URL (may have query params like ?v=xxx)
      if (req.url && req.url.includes('.wasm')) {
        res.setHeader('Content-Type', 'application/wasm');
      }
      next();
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url && req.url.includes('.wasm')) {
        res.setHeader('Content-Type', 'application/wasm');
      }
      next();
    });
  },
};

export default defineConfig({
  plugins: [
    wasmPublicImportPlugin,
    wasmContentTypePlugin,
    wasm(),
    topLevelAwait(),
    react(),
  ],
  worker: {
    format: 'es',
    plugins: () => [wasm(), topLevelAwait()],
  },
  server: {
    port: 5173,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    fs: {
      allow: ['..'],
    },
    proxy: {
      '/api': 'http://localhost:8081',
      '/ws': {
        target: 'http://localhost:8081',
        ws: true,
      },
      '/livekit': {
        target: 'http://localhost:8081',
        ws: true,
      },
    },
  },
  assetsInclude: ['**/*.wasm'],
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      external: ['/wasm/hush_crypto.js'],
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-motion': ['motion'],
        },
      },
    },
  },
});
