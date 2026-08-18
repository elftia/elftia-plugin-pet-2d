// Flat ESLint config for elftia-plugin-pet-2d. Parser/plugins are resolved
// through the node_modules JUNCTION into the host Elftia repo (see
// package.json's zero-installs note) — this repo never runs `npm install`.
//
// max-lines is the file-size gate this repo's own tasks.md commits to
// (400 warn-and-split; there is no separate hard-cap tier here, unlike the
// host repo's per-glob buckets — this is a small, single-purpose repo where
// every `src/` file is meant to be short enough that a pack author reads it
// end to end).
import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    // Type-aware linting for the plugin's own TS source + the TS build/verify
    // scripts (they import src/ modules, so they belong to the same program).
    // `scripts/**/*.mjs` (the spike harness) is plain Node ESM — deliberately
    // NOT part of the tsconfig program (no `allowJs`), so it gets its own,
    // non-project-aware block below instead of failing ESLint's "file not
    // found in project" check.
    // .tsx joined at v0.2 (the manager page): JSX parsing on for the
    // source tree via ecmaFeatures below.
    files: ['src/**/*.ts', 'src/**/*.tsx', 'scripts/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      // Core `no-unused-vars` (pulled in by js.configs.recommended) doesn't
      // understand TS-only constructs — it misreads `interface Foo { m(x:
      // T): void }`'s parameter as an unused function-expression binding and
      // errors on it, and it ignores our `^_` ignore patterns (those are
      // only passed to the TS-aware rule below). Must be off wherever the
      // TS-aware rule is on, or the two rules disagree on the same code.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error', 'info', 'debug'] }],
    },
  },
  {
    // Window-side src runs INSIDE the pet window (a browser context): these
    // modules reference ambient `document`/`Image`/`setTimeout`/`console` by
    // design. Flat-config `globals` merge per key with the block above, so
    // this adds the browser ambient set for exactly those directories —
    // `src/brain/**` and `src/contract/**` stay environment-free (usable from
    // any host, testable without jsdom); that split is the render/ boundary's
    // lint-level teeth. pet.ts (group 7) and ledger (group 8) join
    // render/packs/state/interact — the ledger's ambient references are all
    // lazy defaults inside function bodies (typeof-guarded), so its node
    // unit tests never execute them, but lint still needs the globals.
    files: [
      'src/render/**/*.ts',
      'src/packs/**/*.ts',
      'src/state/**/*.ts',
      'src/ledger/**/*.ts',
      'src/interact/**/*.ts',
      'src/manager/**/*.ts',
      'src/manager/**/*.tsx',
      'src/__tests__/**/*.ts',
      'src/__tests__/**/*.tsx',
      'src/pet.ts',
    ],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    // TS build/verify scripts run in NODE (via tsx): `process`/`Buffer`/
    // `console.log` are theirs by right — CLI output is the product here.
    files: ['scripts/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Plain-JS block for build/verify/spike tooling and the packs-src
    // authoring generators — no type-aware rules, no tsconfig project (these
    // run standalone via `node`, never compiled), same import-order +
    // basic-hygiene rules as src/.
    files: ['scripts/**/*.mjs', 'packs-src/**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      ecmaVersion: 'latest',
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: {
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      'no-console': 'off', // scripts print by design
    },
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['src/**/__tests__/**', 'src/**/*.test.ts'],
    rules: {
      'max-lines': [
        'error',
        { max: 400, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    files: ['src/**/__tests__/**/*.ts', 'src/**/*.test.ts'],
    rules: {
      'max-lines': 'off',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'fixtures/**', 'scripts/spike/out/**'],
  },
];
