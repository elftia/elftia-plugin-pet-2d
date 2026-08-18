# elftia-plugin-pet-2d

A 2D desktop pet plugin for [Elftia](https://elftia.com) — a reference
implementation of the `desktop-pet` character-pack contract (facts→state
grammar, sprite/atlas player, and a machine-checkable character-pack format
that whale-girl-format packs can be adapted into via a compatibility layer).

This repo IS the reference implementation: a third-party pet author reads
this code, not a spec document, to learn the contract. Ships with two
original SVG character packs, `elf-blob` and `tin-bot` (no third-party
character art in `dist/` — see NOTICE).

`fixtures/whale-girl/` is a LOCAL dev/test fixture (whale-girl software is
MIT, but the 鲸鱼娘 character is ZipZipPipe's IP): it is not redistributed,
never enters `dist/`, and must be stripped before any public publication of
this repo — see NOTICE for the full policy and the gate that proves it.

## Install (into a dev or packaged Elftia ≥ the desktop-pet host runtime)

1. Build and verify the installable directory:

   ```
   npm run verify
   ```

   On success `dist\pet-2d\` contains `elftia-plugin.json` (with a stamped
   sha512 checksum — see "Trust stamping" in `scripts/stamp-manifest.mjs`),
   `renderer\pet.mjs`, and both pack modules under
   `renderer\characters\`.

2. In Elftia: Settings → Plugins → **From folder…** → select
   `dist\pet-2d` — the **built directory ONLY, never the repo root**
   (the repo root contains `fixtures/`, which must not be installed).

3. Complete the inspect/consent step. The plugin list should show
   "2D Desktop Pet" with a **pet** contribution, NOT marked
   restricted/untrusted. A restricted result means the stamped checksum
   does not match the shipped entry — rebuild (`npm run build`), do not
   work around it.

4. Enable the desktop-pet master switch (Settings → Desktop Pet). The pet
   window appears.

**Known install-time gap (host follow-up, not worked around here):** the
host does not re-resolve the current pet when a plugin is installed,
uninstalled, or toggled — resolution happens on the master-switch config
change and at window start. If you install this plugin while the pet window
is already running, **toggle the desktop-pet master switch OFF then ON** to
force a re-resolve.

## Docs

- `docs/state-grammar.md` — facts → sense → state derivation
- `docs/character-pack.md` — the character-pack contract, for pack authors
- `docs/packs/whale-girl-compat.md` — build a pack from your own
  whale-girl install
- `docs/limitations.md` — known host-platform shortfalls (occlusion timer
  throttling, fact-coverage gaps, transparent-corner clicks, cross-plugin
  asset sharing) that this plugin designs around rather than works around

## Authoring a character pack

Write `packs-src/<your-pack>/pack.json` + `sheets/`, then run
`npm run build:packs` and `npm run verify:packs`. The full contract —
manifest tables, frame-0-is-rest-pose, the left-facing baseline, the
15-state requirement, a worked example — is
[`docs/character-pack.md`](docs/character-pack.md). To adapt a
whale-girl-format install you already have rights to:
[`docs/packs/whale-girl-compat.md`](docs/packs/whale-girl-compat.md).

Want a main-window settings section for your pet plugin? Declare
`contributes.renderer` **alongside** `contributes.pet` in the manifest:
pet-only plugins have no module instance in the main window, so
`host.settings.registerSection` is only reachable from a renderer
contribution. Stamp both entries' checksums (`scripts/stamp-manifest.mjs`
already handles every declared code slot).

## The ledger is trimmable

The growth/companionship ledger (`src/ledger/`) is deliberately a deletable
module: `src/pet.ts` reaches it through exactly one guarded dynamic import,
and a pet without it is fully functional (companionship bookkeeping, not
gameplay). To ship a ledger-less pet: delete `src/ledger/` and replace the
one `await import('./ledger/createLedger')` expression in `src/pet.ts` with
the stub shown in `scripts/verify-trim.mjs`. The proof that this works —
typecheck, the full test suite, and a build in a copy with the ledger
deleted, plus the assertion that no ledger symbols survive in the bundle —
runs as part of `npm run verify` (`verify:trim`).

## Development

Zero installs: this repo has no `dependencies`/`devDependencies` and never
runs `npm install` — `node_modules` is a junction into the host Elftia
repo's own `node_modules`, and all tooling (TypeScript, ESLint, Vitest,
Vite, npx electron) is borrowed from there. `npm run verify` is the full
gate: typecheck → lint → tests → pack gate → build (+ checksum stamping +
dist verification) → the trim proof.

See `NOTICE` for the third-party dev-fixture policy and `LICENSE` for
terms.
