import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

// Lib-mode build of the plugin's MAIN-WINDOW renderer entry (task 4.3,
// desktop-pet-manager-page D9), mirroring the DS renderer config's
// invariants onto this repo's single-file discipline:
//   - `react` (+ dom/router/jsx-runtime) EXTERNAL — the bundle emits bare
//     specifiers the host resolves through its import map to the HOST's
//     single shared instances (dual-React breaks hooks across the host ↔
//     plugin boundary). `@elftia/plugin-types` is type-only (erased) but
//     external so a stray value reference never bundles.
//   - `process.env.*` substituted at build time — the module loads RAW over
//     `plugin://` into a browser context with NO `process` global.
//   - `publicDir: false`, NO host aliases — a reintroduced `@/` /
//     `@main/` / `@elftia/shared` import FAILS this build by unresolved
//     name (the 0-leak guard; same teeth as vite.plugin.config.ts).
//   - ONE output file beside pet.mjs (emptyOutDir:false — build-packs and
//     the pet pass wrote into this tree first); the ONE dynamic import
//     (the ledger seam, group 8 / D8) is INLINED exactly like pet.ts's, so
//     the shipped entry stays single-file and verify-trim can stub the
//     seam expression in source and rebuild.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env': '{}',
  },
  publicDir: false,
  build: {
    outDir: 'dist/pet-2d/renderer',
    emptyOutDir: false,
    target: 'es2022',
    minify: false, // readable reference implementation (same policy as pet.mjs)
    sourcemap: false,
    lib: {
      entry: path.resolve(here, 'src/manager/index.ts'),
      formats: ['es'],
      fileName: () => 'manager.mjs',
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-runtime',
        'react-router-dom',
        '@elftia/plugin-types',
      ],
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
