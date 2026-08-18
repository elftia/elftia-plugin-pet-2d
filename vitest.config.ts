import { defineConfig } from 'vitest/config';

// Two projects: most of src/ (contracts, brain, ledger, packs, state) is
// plain TS logic tested under `node`; the DOM-touching modules — src/render/*
// (canvas hit-test, stage mounting), src/interact/* (menu/pointer wiring),
// and src/pet.ts itself (the composition root mounts a real stage) — need
// `jsdom`. Split rather than running everything under jsdom, which is slower
// and hides DOM-availability bugs in the non-DOM modules.
export default defineConfig({
  test: {
    // Root-level only: with a `projects` config, vitest's own "no test
    // files found -> exit 1" check runs against the aggregated root run,
    // and `passWithNoTests` isn't a valid per-project key in vitest 4's
    // `ProjectConfig` type (tsc rejects it there) — task 2.5's gate needs
    // the empty Group-2 suite to exit 0, so this one root flag is both
    // necessary and sufficient.
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/__tests__/**/*.test.ts'],
          exclude: ['src/render/**', 'src/interact/**', 'src/__tests__/**'],
        },
      },
      {
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: [
            'src/render/**/__tests__/**/*.test.ts',
            'src/interact/**/__tests__/**/*.test.ts',
            'src/__tests__/*.test.ts',
          ],
        },
      },
    ],
  },
});
