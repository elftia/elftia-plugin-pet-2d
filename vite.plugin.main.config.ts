import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

// Lib-mode build of the plugin's MAIN half (desktop-pet-pack-authoring D10),
// the third vite pass: a single CJS entry the host's main-process loader
// `require()`s from `<installDir>/main/index.cjs` after its compat +
// containment gates (loadMainExtensions.ts). Invariants, mirroring the two
// renderer passes:
//   - EXTERNAL = node builtins (bare + `node:`) + `archiver` — the exact set
//     the host's `pluginMainHostExternals` resolves for plugin main halves
//     (the host hands over its OWN loaded copy at require time). Anything
//     else must BUNDLE: `adm-zip` is the repo's first bundled dependency
//     (a devDependency resolved through the node_modules junction at build
//     time; the shipped index.cjs is self-contained at runtime).
//   - `@elftia/plugin-types` is type-only (erased by `verbatimModuleSyntax`)
//     but listed external so a stray value reference never bundles.
//   - `emptyOutDir: false` — the pet/manager passes and build-packs wrote
//     into this same tree first; one wrong flag would wipe it.
//   - No `process.env` substitution needed (main runs in REAL node with a
//     real `process`), and minify stays off (readable reference impl).
const NODE_EXTERNAL = new Set<string>([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
]);

export default defineConfig({
  build: {
    outDir: 'dist/pet-2d/main',
    emptyOutDir: false,
    target: 'node18',
    minify: false,
    sourcemap: false,
    lib: {
      entry: path.resolve(here, 'src/main/index.ts'),
      formats: ['cjs'],
      fileName: () => 'index.cjs',
    },
    rollupOptions: {
      external: (id) =>
        id === 'archiver' ||
        id === '@elftia/plugin-types' ||
        NODE_EXTERNAL.has(id) ||
        id.startsWith('node:'),
    },
  },
});
