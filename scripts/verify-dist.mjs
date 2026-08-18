// verify-dist.mjs — task 9.3, the LAST step of `npm run build` (D14): the
// finished-tree gate over `dist/pet-2d/`. Every assertion here re-derives
// truth from the SHIPPED bytes (not from the source tree), because this is
// the step that stands between "built" and "installable".
//
//   1. CHECKSUM RECOMPUTE — every declared code entry's sha512 is recomputed
//      over the shipped file and must equal the manifest's `checksum`
//      (encoding-tolerant, mirroring the host's `checksumsMatch`). This is
//      the belt to stamp-manifest's suspenders: a stale stamp from an
//      earlier build can never ship. A declared entry WITHOUT a checksum
//      also fails here — that manifest would classify `restricted`
//      (`tier1Trust.ts::classifyAppExtensionTrust`), and `restricted` is
//      silent: `plugin://` 404s the entry ⇒ an empty pet window, no error.
//   2. ENTRY PRESENCE — `renderer/pet.mjs` and BOTH shipped pack modules
//      (`characters/<id>/pack.mjs`, derived from `packs-src/`) exist.
//   3. NO SURVIVING EXTERNAL SPECIFIER — per-entry (v0.2, task 4.3/9.1):
//      `pet.mjs` + pack modules still allow ZERO bare specifiers (the pet
//      window has no node_modules AND no import map); `manager.mjs` may
//      import exactly the import-map set the MAIN window installs
//      (`installHostModuleImportMap`: react, react-dom, react-dom/client,
//      react/jsx-runtime, react-router-dom). Anything else fails.
//   4. FIXTURE EXCLUSION — task 8.7's checker (`verify-no-fixture-bytes`)
//      runs HERE, on every build, not once: whale-girl art (ZipZipPipe's IP)
//      must never reach dist/. In a fixtures-stripped checkout this half
//      reports SKIP; the standalone `npm run verify:no-fixture-bytes` gives
//      the full plant-and-catch negative case.
//   5. SIZE — total `dist/pet-2d` < 2 MB, with a per-file table. Both
//      shipped packs are SVG (base64-inlined); anything near the cap means
//      a fixture PNG leaked into a pack module.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectProblems } from './verify-no-fixture-bytes.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const distDir = path.join(repoRoot, 'dist', 'pet-2d');
const rendererDir = path.join(distDir, 'renderer');
const shippedManifestPath = path.join(distDir, 'elftia-plugin.json');
const packsSrcDir = path.join(repoRoot, 'packs-src');

const SIZE_CAP_BYTES = 2 * 1024 * 1024;
/** Contribution slots whose `entry` declares code the host hash-pins. */
const CODE_SLOTS = ['pet', 'renderer'];

function fail(message) {
  console.error(`verify-dist: FAIL — ${message}`);
  process.exit(1);
}

function walk(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

/** The host's `checksumsMatch` semantics, re-derived here so this gate does
 * not depend on host internals: strip an optional `sha512-`/`sha512:` prefix,
 * then accept the bare base64 OR the (case-insensitive) hex form. */
function checksumMatches(declared, actualBase64, actualHex) {
  const stripped = declared.trim().replace(/^sha512[-:]/i, '');
  if (stripped.length === 0) return false;
  if (stripped === actualBase64) return true;
  return stripped.toLowerCase() === actualHex;
}

// --- 1) checksums over the shipped tree ------------------------------------

if (!fs.existsSync(shippedManifestPath)) {
  fail('dist/pet-2d/elftia-plugin.json missing — stamp-manifest must run before verify-dist');
}
const shipped = JSON.parse(fs.readFileSync(shippedManifestPath, 'utf8'));
const contributions = shipped.contributes ?? {};

for (const slot of CODE_SLOTS) {
  const contribution = contributions[slot];
  if (contribution === undefined) continue;

  const entry = contribution.entry;
  if (typeof entry !== 'string' || entry.length === 0) {
    fail(`shipped manifest declares contributes.${slot} with no usable entry`);
  }
  const declared = contribution.checksum;
  if (typeof declared !== 'string' || declared.trim().length === 0) {
    fail(
      `contributes.${slot} has NO checksum — the host classifies this 'restricted': plugin:// 404s the entry and the pet window comes up EMPTY with no error (stamp-manifest should have filled this)`
    );
  }
  const entryPath = path.join(rendererDir, entry);
  let bytes;
  try {
    bytes = fs.readFileSync(entryPath);
  } catch {
    fail(`declared entry renderer/${entry} is missing from the shipped tree`);
  }
  const base64 = createHash('sha512').update(bytes).digest('base64');
  const hex = createHash('sha512').update(bytes).digest('hex');
  if (!checksumMatches(declared, base64, hex)) {
    fail(
      `contributes.${slot}.checksum does not match the shipped renderer/${entry} — a stale stamp; rebuild (the host would classify this 'restricted' ⇒ empty pet window)`
    );
  }
  console.log(`verify-dist: PASS — contributes.${slot} checksum matches renderer/${entry} (${bytes.length} bytes)`);
}
if (contributions.pet === undefined && contributions.renderer === undefined) {
  fail('shipped manifest declares NO code entry — nothing for the host to serve');
}

// --- 2) entry + pack-module presence -----------------------------------------

if (!fs.existsSync(path.join(rendererDir, 'pet.mjs'))) {
  fail('renderer/pet.mjs missing — the vite build step did not emit the entry');
}
if (contributions.renderer !== undefined) {
  if (!fs.existsSync(path.join(rendererDir, 'manager.mjs'))) {
    fail('renderer/manager.mjs missing — the manager vite build step did not emit the entry');
  }
  console.log('verify-dist: PASS — renderer/manager.mjs present');
}
if (!fs.existsSync(packsSrcDir)) {
  fail('packs-src/ missing — cannot derive the expected pack list');
}
const packIds = fs
  .readdirSync(packsSrcDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
  .map((entry) => entry.name)
  .sort();
if (packIds.length === 0) {
  fail('packs-src/ contains no pack directories');
}
for (const packId of packIds) {
  const packModule = path.join(rendererDir, 'characters', packId, 'pack.mjs');
  if (!fs.existsSync(packModule)) {
    fail(`pack module renderer/characters/${packId}/pack.mjs missing — build-packs did not emit it`);
  }
  console.log(`verify-dist: PASS — pack module characters/${packId}/pack.mjs present`);
}

// --- 3) no surviving external specifier ---------------------------------------

// Static import/export-from statements only; a DYNAMIC import(`url`) loads
// character packs over plugin:// at runtime and is not a build-time edge.
// \bimport rejects `ximport`; the `(` of import( cannot match the quote.
const IMPORT_RE = /\bimport\s*(?:[\w$*{},\s]*?\bfrom\s*)?['"]([^'"]+)['"]/g;
const EXPORT_FROM_RE = /\bexport\s+(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g;

/** A specifier is fine when relative, root-relative, or a URL scheme —
 * everything else (node:, bare package names) needs a resolver and must not
 * survive the bundle unaccounted for. */
function isAllowedSpecifier(specifier) {
  return (
    specifier.startsWith('./') ||
    specifier.startsWith('../') ||
    specifier.startsWith('/') ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(specifier)
  );
}

/** The bare specifiers the MAIN window resolves for a renderer entry via
 * the host import map (`installHostModuleImportMap`). Exactly the set the
 * manager vite pass marks external — a new external must be added to BOTH
 * or this gate fails. */
const IMPORT_MAP_SET = new Set([
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react-router-dom',
]);

/** Per-entry bare-specifier allowance: only the main-window renderer entry
 * gets the import-map set; pet.mjs and pack modules get none (the pet
 * window installs no import map — a bare import there 500s at load). */
function allowedBareSpecifiers(file) {
  const rel = path.relative(rendererDir, file).split(path.sep).join('/');
  if (rel === 'manager.mjs') return IMPORT_MAP_SET;
  return new Set();
}

for (const file of walk(distDir).filter((f) => f.toLowerCase().endsWith('.mjs'))) {
  const code = fs.readFileSync(file, 'utf8');
  const rel = path.relative(repoRoot, file);
  for (const re of [IMPORT_RE, EXPORT_FROM_RE]) {
    const allowedBare = allowedBareSpecifiers(file);
    re.lastIndex = 0;
    let match = re.exec(code);
    while (match !== null) {
      if (!isAllowedSpecifier(match[1]) && !allowedBare.has(match[1])) {
        fail(
          `${rel} contains an unresolvable specifier "${match[1]}" — not relative/URL and outside the entry's bare allowance (import-map set)`
        );
      }
      match = re.exec(code);
    }
  }
}
console.log(
  'verify-dist: PASS — bare static specifiers are within the per-entry allowance (pet/packs: none; manager: import-map set)'
);

// --- 4) fixture exclusion (8.7, every build) -----------------------------------

const fixturesDir = path.join(repoRoot, 'fixtures');
if (!fs.existsSync(fixturesDir)) {
  console.log('verify-dist: SKIP fixture-exclusion — no fixtures/ in this checkout (stripped?)');
} else {
  const problems = collectProblems(distDir, fixturesDir);
  if (problems.length > 0) {
    for (const problem of problems) fail(problem);
  }
  console.log('verify-dist: PASS — fixture exclusion (verify-no-fixture-bytes assertions i–iii) clean');
}

// --- 5) size table + cap --------------------------------------------------------

const distFiles = walk(distDir).sort();
let total = 0;
console.log('verify-dist: dist/pet-2d size table');
for (const file of distFiles) {
  const size = fs.statSync(file).size;
  total += size;
  console.log(
    `  ${path.relative(distDir, file).split(path.sep).join('/').padEnd(48)} ${String(size).padStart(8)} B  ${(size / 1024).toFixed(1)} KiB`
  );
}
console.log(`  ${'TOTAL'.padEnd(48)} ${String(total).padStart(8)} B  ${(total / 1024).toFixed(1)} KiB`);
if (total >= SIZE_CAP_BYTES) {
  fail(`dist/pet-2d is ${(total / 1024 / 1024).toFixed(2)} MB — the 2 MB cap exists because the shipped packs are SVG; a size near it means a fixture PNG leaked`);
}
console.log(`verify-dist: PASS — total ${(total / 1024).toFixed(1)} KiB under the 2 MB cap`);

console.log('verify-dist: OK');
