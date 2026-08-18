// stamp-manifest.mjs — task 9.2, the trust stamping step of `npm run build`
// (D14): reads `elftia-plugin.json.src`, computes the sha512 of EVERY
// declared code entry (resolved as `dist/pet-2d/renderer/<entry>`), and
// writes `dist/pet-2d/elftia-plugin.json` with each contribution's
// `checksum` filled in.
//
// WHY this step exists (the failure it prevents is SILENT):
//   `tier1Trust.ts::classifyAppExtensionTrust` (host) grants `trusted` to a
//   non-bundled app-extension ONLY when EVERY declared entry — for this repo
//   `contributes.pet`, plus `contributes.renderer` if a future version
//   co-declares one — carries a checksum that MATCHES the shipped file.
//   Anything else classifies `restricted`, and `restricted` is quiet:
//   `plugin://` 404s the entry and the enumerator hides the plugin, so the
//   user sees an EMPTY PET WINDOW with no error anywhere. An unstamped (or
//   stale-stamped) manifest does not fail loudly at install time — it fails
//   silently at load time. Hence: stamping is part of the BUILD, and
//   `verify-dist.mjs` (9.3) recomputes every digest over the finished tree
//   so a stale stamp can never ship.
//
// Checksum format: `sha512-<base64>` — the encoding
// `checksumsMatch` (host, chainedUpdate/checksum.ts) lists first among its
// tolerated forms; bare hex would also verify, but base64 is the ecosystem's
// common shape.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const SOURCE_MANIFEST = path.join(repoRoot, 'elftia-plugin.json.src');
const DIST_DIR = path.join(repoRoot, 'dist', 'pet-2d');
const RENDERER_DIR = path.join(DIST_DIR, 'renderer');
const OUT_MANIFEST = path.join(DIST_DIR, 'elftia-plugin.json');

function fail(message) {
  console.error(`stamp-manifest: FAIL — ${message}`);
  process.exit(1);
}

/** The contribution slots that declare code entries. A slot absent from the
 * source manifest contributes nothing; a present-but-empty `entry` is an
 * error (the schema on the host side requires `min(1)`). */
const CODE_SLOTS = ['pet', 'renderer'];

const manifest = JSON.parse(readFileSync(SOURCE_MANIFEST, 'utf8'));
if (manifest.contributes === undefined || typeof manifest.contributes !== 'object') {
  fail(`${path.basename(SOURCE_MANIFEST)} declares no "contributes" object`);
}

for (const slot of CODE_SLOTS) {
  const contribution = manifest.contributes[slot];
  if (contribution === undefined) continue;

  const entry = contribution.entry;
  if (typeof entry !== 'string' || entry.length === 0) {
    fail(`contributes.${slot}.entry must be a non-empty string`);
  }
  // Containment: an entry with path separators escaping renderer/ (or an
  // absolute entry) would hash a file outside the shipped tree.
  const entryPath = path.join(RENDERER_DIR, entry);
  if (path.relative(RENDERER_DIR, entryPath).startsWith('..')) {
    fail(`contributes.${slot}.entry "${entry}" escapes renderer/`);
  }
  let bytes;
  try {
    bytes = readFileSync(entryPath);
  } catch {
    fail(`${path.relative(repoRoot, entryPath)} not found — run the build steps before stamping`);
  }
  contribution.checksum = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  console.log(
    `stamp-manifest: ${slot} entry ${entry} <- ${contribution.checksum.slice(0, 22)}… (${bytes.length} bytes)`
  );
}

// Preserve field order (name/version/kind/…/contributes) as authored in the
// .src; JSON.stringify walks insertion order, and `checksum` lands inside the
// existing contribution object rather than appended after it.
writeFileSync(OUT_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`stamp-manifest: wrote ${path.relative(repoRoot, OUT_MANIFEST)}`);
