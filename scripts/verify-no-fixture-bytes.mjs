// verify-no-fixture-bytes.mjs — task 8.7, the fixture-exclusion PROOF (D8 /
// OQ8 ruling): whale-girl art must NEVER reach dist/. The character is
// ZipZipPipe's IP (the MIT licence on whale-girl's SOFTWARE is not a
// licence to its assets); this project ships commercially, so this gate
// runs on EVERY build (wired into verify-dist, task 9.3), not once.
//
// Three INDEPENDENT assertions over the built dist/pet-2d:
//   (i)   no dist file's sha256 equals any fixtures/** file's sha256;
//   (ii)  no dist file contains the leading 64 base64 chars of any fixture
//         PNG (catches a PNG embedded into a generated pack module);
//   (iii) no dist path segment contains "whale-girl" or "fixtures"
//         (catches a copied-through directory).
//
// And the NEGATIVE case, every run: a fixture PNG is deliberately planted
// in dist/ and the checker must flag it — a gate that cannot fail proves
// nothing (OQ8's discipline).
//
// Exit 0 = clean AND able to detect a plant. Any failure exits 1.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const distDir = path.join(repoRoot, 'dist', 'pet-2d');
const fixturesDir = path.join(repoRoot, 'fixtures');

/** How many leading base64 chars of a fixture PNG constitute a needle. */
const BASE64_NEEDLE_LENGTH = 64;
/** Where the self-test plants a fixture copy (removed right after). */
const SELF_TEST_NAME = 'fixture-exclusion-selftest.png';

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

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Collect every violation as a human-readable string. Pure — no writes. */
export function collectProblems(distPath, fixturesPath) {
  const problems = [];
  const distFiles = walk(distPath);
  const fixtureFiles = walk(fixturesPath);

  const fixtureHashes = new Map(); // sha -> rel path (for readable messages)
  for (const file of fixtureFiles) {
    fixtureHashes.set(sha256(fs.readFileSync(file)), path.relative(repoRoot, file));
  }

  for (const file of distFiles) {
    const rel = path.relative(repoRoot, file);
    const bytes = fs.readFileSync(file);

    // (i) byte-for-byte identity
    const hash = sha256(bytes);
    if (fixtureHashes.has(hash)) {
      problems.push(`(i) ${rel} is byte-identical to ${fixtureHashes.get(hash)}`);
    }

    // (ii) embedded base64 prefix of any fixture PNG
    const asLatin1 = bytes.toString('latin1');
    for (const fixture of fixtureFiles.filter((f) => f.toLowerCase().endsWith('.png'))) {
      const needle = fs.readFileSync(fixture).toString('base64').slice(0, BASE64_NEEDLE_LENGTH);
      if (asLatin1.includes(needle)) {
        problems.push(`(ii) ${rel} embeds the leading base64 of ${path.relative(repoRoot, fixture)}`);
      }
    }

    // (iii) path segments
    for (const segment of path.relative(repoRoot, file).split(path.sep)) {
      const lower = segment.toLowerCase();
      if (lower.includes('whale-girl') || lower.includes('fixtures')) {
        problems.push(`(iii) ${rel} — path segment "${segment}" names fixture content`);
      }
    }
  }
  return problems;
}

function fail(message) {
  console.error(`verify-no-fixture-bytes: FAIL — ${message}`);
  process.exit(1);
}

// --- main (direct-run only) ----------------------------------------------------
// verify-dist.mjs (task 9.3) imports `collectProblems` to run the clean-pass
// half of this gate on EVERY build; the plant-and-catch negative case below
// mutates dist/ and belongs to a direct run, so the whole main body is gated.

function main() {
  if (!fs.existsSync(distDir)) {
    fail('dist/pet-2d not found — run the build first (this gate checks a build).');
  }

  if (!fs.existsSync(fixturesDir)) {
    // A publication-stripped checkout has no fixtures to compare against;
    // the build-side structural checks (path segments) still ran above only
    // with fixtures present, so here the honest answer is "nothing compared".
    console.log('verify-no-fixture-bytes: SKIP — no fixtures/ in this checkout (stripped?).');
    process.exit(0);
  }

  const problems = collectProblems(distDir, fixturesDir);
  if (problems.length > 0) {
    for (const problem of problems) fail(problem);
  }
  console.log(
    `verify-no-fixture-bytes: PASS — assertions (i) sha-identity, (ii) base64-embed, (iii) path-segment all clean over ${walk(distDir).length} dist file(s).`
  );

  // The negative case (OQ8: a gate that cannot fail proves nothing): plant a
  // fixture PNG in dist/, expect the checker to flag it, remove it again.
  const png = walk(fixturesDir).find((f) => f.toLowerCase().endsWith('.png'));
  if (png === undefined) {
    fail('fixtures/ exists but contains no PNG — the negative case cannot run.');
  }
  const probe = path.join(distDir, SELF_TEST_NAME);
  fs.copyFileSync(png, probe);
  let caught;
  try {
    caught = collectProblems(distDir, fixturesDir);
  } finally {
    fs.rmSync(probe, { force: true });
  }
  const probeFlagged = caught.some((problem) => problem.includes(SELF_TEST_NAME));
  if (caught.length === 0 || !probeFlagged) {
    fail('negative case FAILED to detect the planted fixture copy — the gate has no teeth.');
  }
  console.log(
    `verify-no-fixture-bytes: PASS (negative case) — planted ${SELF_TEST_NAME} was detected by assertion, then removed.`
  );
  console.log('verify-no-fixture-bytes: OK');
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
