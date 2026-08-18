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
//   3. NO SURVIVING EXTERNAL SPECIFIER — no static `import`/`export … from`
//      in any shipped .mjs names a `node:` or bare specifier: the pet
//      window has no node_modules to resolve against, so such an import
//      would 500 at load time. Relative/URL specifiers are fine.
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
 * everything else (node:, bare package names) cannot resolve in the pet
 * window and must not survive the bundle. */
function isAllowedSpecifier(specifier) {
  return (
    specifier.startsWith('./') ||
    specifier.startsWith('../') ||
    specifier.startsWith('/') ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(specifier)
  );
}

for (const file of walk(distDir).filter((f) => f.toLowerCase().endsWith('.mjs'))) {
  const code = fs.readFileSync(file, 'utf8');
  const rel = path.relative(repoRoot, file);
  for (const re of [IMPORT_RE, EXPORT_FROM_RE]) {
    re.lastIndex = 0;
    let match = re.exec(code);
    while (match !== null) {
      if (!isAllowedSpecifier(match[1])) {
        fail(`${rel} contains an unresolvable specifier "${match[1]}" — the pet window has no node_modules`);
      }
      match = re.exec(code);
    }
  }
}
console.log('verify-dist: PASS — no node:/bare static specifier survives in any shipped .mjs');

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
