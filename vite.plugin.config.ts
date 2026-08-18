import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

// Lib-mode build of the plugin's renderer entry ONLY. Character packs are
// built separately by scripts/build-packs.mjs (task 6.1) straight into
// dist/pet-2d/renderer/characters/<id>/pack.mjs — vite never touches
// packs-src/ or fixtures/, so a build can never accidentally inline fixture
// bytes into pet.mjs (that would defeat verify-no-fixture-bytes, task 8.7).
export default defineConfig({
  build: {
    outDir: 'dist/pet-2d/renderer',
    emptyOutDir: false, // build-packs.mjs writes into this same tree first
    lib: {
      entry: path.resolve(here, 'src/pet.ts'),
      formats: ['es'],
      fileName: () => 'pet.mjs',
    },
    rollupOptions: {
      // No externals: `plugin://` has no bare-specifier resolution at
      // runtime (D14), so the entry must be fully self-contained. If a
      // future dependency is ever added, it must be bundled here, not
      // externalized.
      external: [],
      output: {
        // One file. No manual chunking, no code-splitting — a Tier-1
        // app-extension entry is loaded as a single ES module import.
        // pet.ts's ONE dynamic import (the ledger trim seam, D10) is INLINED
        // for the same reason: the shipped entry stays a single pet.mjs, and
        // the untrimmed bundle really does contain the ledger code (what
        // verify-trim's negative assertion checks for).
        inlineDynamicImports: true,
      },
    },
    target: 'es2022',
    minify: false, // keep readable — this repo IS the reference implementation
    sourcemap: false,
  },
});
