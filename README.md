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

**Install-time re-scan (host ≥ 1.53):** every pet-management write —
including a same-value patch — re-resolves pet contributors host-side
(`pet:setConfig` calls `petWindow.refresh()` unconditionally), so a pet
installed while the switch is already on surfaces without an OFF/ON dance
(verified live: reinstall with the switch on keeps page, pack selection,
ledger, and the pet window). On hosts **older than 1.53** the gap still
applies: toggle the desktop-pet master switch OFF then ON to force a
re-resolve.

## The manager page (v0.2)

**How do I get to the pet's settings?** Install the plugin, and the entry is
the **rail item** — the pet's own icon in the app's left rail (labeled
"2D Desktop Pet"), exactly like Design Studio. No settings sub-page hunting:
the plugin ships a full main-window page (`contributes.renderer`) with:

- **Master controls** — enable/disable the pet and the opaque-fallback
  toggle, straight against the host config (the same store the Settings →
  Desktop Pet section writes; either surface works).
- **Gallery** — every installed character pack as a live animated preview;
  click a card to switch packs (the running pet switches live via the
  cross-window storage event — at most one preference-debounce (~0.5 s)
  behind — and the choice survives window OFF/ON and app restarts).
- **Character Studio + user packs (v2)** — author a pack in-app from a
  folder of sprite strips (or accept the one-click whale-girl offer), watch
  the same validator surface problems live, save it into the user pack
  store, export it as a `.petpack` file, and import shared ones back through
  the gallery's **Import .petpack…** button. See
  [`docs/character-pack.md`](docs/character-pack.md) for the format and the
  flow. Cards for user packs carry a **user** chip and offer **delete**;
  deleting the selected pack repairs selection to the default.
- **Growth ledger** — level/XP bar, stats, and the newest-first memory ring,
  read live from the same store the pet window writes (refreshes on every
  change). If you ship a ledger-less build, this section shows an honest
  "ledger unavailable (trimmed)" card instead of breaking.
- **Re-scan** — with no pet resolvable, the page offers a rescan row; an
  empty management write is a legitimate re-scan request on 1.53 hosts.

Locale limit: page copy ships in **en / zh / ja** only — other app locales
resolve by `navigator.language` primary subtag and fall back to English.
On hosts older than 1.53 the master controls degrade to an update-required
card; the gallery and ledger stay functional (they are plugin-local).

## Docs

- `docs/state-grammar.md` — facts → sense → state derivation
- `docs/character-pack.md` — the character-pack contract, for pack authors
- `docs/packs/whale-girl-compat.md` — build a pack from your own
  whale-girl install
- `docs/limitations.md` — known host-platform shortfalls (occlusion timer
  throttling, fact-coverage gaps, transparent-corner clicks, cross-plugin
  asset sharing) that this plugin designs around rather than works around

## Authoring a character pack

Two paths, one contract:

- **In-app (no JSON):** the manager page's Character Studio catalogs a
  source folder, prefills the 15 state slots, validates live, and saves
  straight into the user pack store. Export shares the result as
  `.petpack`; Import installs one back. Full how-to in
  [`docs/character-pack.md`](docs/character-pack.md).
- **By hand:** write `packs-src/<your-pack>/pack.json` + `sheets/`, then run
  `npm run build:packs` and `npm run verify:packs`. The full contract —
manifest tables, frame-0-is-rest-pose, the left-facing baseline, the
15-state requirement, a worked example — is
[`docs/character-pack.md`](docs/character-pack.md). To adapt a

**Where user packs live, and their lifetime:** installed user packs are
runtime data under the host's per-plugin storage
(`<userData>/plugin-data/pet-2d/packs/`), never in the plugin install and
never in this repo's `dist/`. **Uninstalling the plugin deletes that
store** — export any pack you want to keep as a `.petpack` first (the
studio's Export button, or the card's export control). Deleting a single
pack removes only that pack; if it was the selected one, selection repairs
to the default automatically.
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
module: exactly TWO guarded dynamic imports reach it — `src/pet.ts`'s
`await import('./ledger/createLedger')` and the manager page's
`import('../ledger/inspect')` (behind `LedgerPanel`'s loadable seam) — and a
pet or page without it is fully functional (companionship bookkeeping, not
gameplay; the page renders its honest unavailable card). To ship a
ledger-less pet: delete `src/ledger/` and replace those two expressions with
the stubs shown in `scripts/verify-trim.mjs`. The proof that this works —
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
