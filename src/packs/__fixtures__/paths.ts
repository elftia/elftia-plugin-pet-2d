/**
 * src/packs/__fixtures__/paths.ts — the ONE place that knows where the
 * whale-girl dev fixture lives (D8, OQ8 ruling). Test files never hard-code
 * the path, so the fixture can be repointed (e.g. straight at
 * `_others/whale-girl` on a dev machine, or deleted entirely before
 * publication) without touching test code — Tier-B tests skip with a clear
 * message when the directory is absent.
 *
 * The fixture is a FAITHFUL whale-girl install layout (not a flattened
 * copy): `lib/assets/manifest.json` + `lib/assets/characters/whale-girl/
 * *.png` — exactly what `scripts/build-packs.ts --from-whale-girl <dir>`
 * reads, so the adapter's e2e path (Tier-B, task 6.4's gate) exercises the
 * same layout a user's real whale-girl checkout has. Tier-A needs only the
 * manifest JSON (a whale-girl MIT SOFTWARE artifact — no character art);
 * only the PNGs under `characters/` are the IP-restricted fixture bytes.
 *
 * TEST-ONLY module: nothing under `src/` outside `__tests__` imports it, so
 * it never reaches the built `pet.mjs` (the fixture must never enter
 * `dist/` — see NOTICE and `scripts/verify-no-fixture-bytes.mjs`).
 */
import { fileURLToPath } from 'node:url';

/**
 * The whale-girl fixture INSTALL ROOT (`fixtures/whale-girl/`, laid out like
 * a real whale-girl checkout: `lib/assets/manifest.json` +
 * `lib/assets/characters/<id>/*.png`). Sheets are frameSize 256 — measured:
 * 3-frame sheets are 768×256, 1-frame sheets 256×256.
 */
export const FIXTURE_WHALE_GIRL_DIR: string = fileURLToPath(
  new URL('../../../fixtures/whale-girl', import.meta.url)
);
