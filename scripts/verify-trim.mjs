// verify-trim.mjs — task 8.6, the trim PROOF (D10): the ledger is claimed
// to be a deletable module; this script DELETES it and checks nothing else
// breaks. Green output is evidence, not a claim.
//
// What it does, in order:
//   1. Copies the repo (minus node_modules / dist / .git) to a TEMP
//      DIRECTORY NEXT TO THE REPO — a sibling, not os.tmpdir(), because
//      tsconfig.json's `paths` map @elftia/plugin-types at the relative
//      "../elftia-wt-pet/..." and a sibling copy keeps that resolving.
//   2. Junctions node_modules into the copy (zero-install discipline: this
//      repo never runs npm install).
//   3. rm -rf src/ledger (the deletion under test).
//   4. Stubs pet.ts's ONE dynamic-import expression — the only line in the
//      tree that can reference the deleted module — with a null-returning
//      stub that typechecks and throws at runtime into activate()'s
//      existing guard (ledger stays undefined; the pet is unaffected).
//   5. Runs tsc --noEmit, vitest run, and the pack+entry build IN the copy.
//   6. Asserts the trimmed dist/pet-2d/renderer/pet.mjs contains neither
//      `xpForLevel` nor the ledger storage key — a stray inlined copy of
//      ledger code cannot survive silently.
//   7. TEETH CHECK: if the repo's own (untrimmed) dist exists, asserts it
//      DOES contain those symbols — otherwise step 6 would pass vacuously.
//
// On any failure the temp copy is KEPT and its path printed for inspection.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

// The exact expression pet.ts uses; the script fails loudly if pet.ts drifts.
const SEAM_EXPRESSION = "await import('./ledger/createLedger')";
const SEAM_STUB =
  "await Promise.resolve({ createLedger: null as unknown as () => LedgerPort })";
const FORBIDDEN_SYMBOLS = ['xpForLevel', 'elftia-pet-2d:ledger:v1'];
const TRIMMED_PET = path.join('dist', 'pet-2d', 'renderer', 'pet.mjs');

function fail(tempDir, message) {
  console.error(`verify-trim: FAIL — ${message}`);
  console.error(`verify-trim: temp copy KEPT for inspection: ${tempDir}`);
  process.exit(1);
}

function run(tempDir, label, command, args) {
  console.log(`verify-trim: [${label}] ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: tempDir,
    shell: true, // npx on Windows needs a shell
    encoding: 'utf8',
    timeout: 10 * 60_000,
  });
  if (result.status !== 0) {
    console.error(result.stdout ?? '');
    console.error(result.stderr ?? '');
    fail(tempDir, `${label} exited ${result.status} in the trimmed copy`);
  }
  return result.stdout ?? '';
}

/** vitest must have actually RUN tests in the copy — a leading-dot temp dir
 * (or any glob mishap) would find zero files and pass vacuously. ANSI
 * escapes are stripped first (piped output still carries them). */
function assertTestsRan(tempDir, stdout) {
  // ESC spelled via fromCharCode (not a \x1b literal) so no-control-regex
  // stays satisfied without a suppression comment.
  const esc = String.fromCharCode(27);
  const ansi = new RegExp(`${esc}\\[[0-9;]*m`, 'g');
  const plain = stdout.replace(ansi, '');
  const match = /Test Files\s+(\d+) passed/.exec(plain);
  if (match === null || Number(match[1]) < 1) {
    fail(tempDir, 'vitest ran zero test files in the trimmed copy — the proof is vacuous');
  }
  console.log(`verify-trim: [test] ${match[1]} test file(s) passed in the trimmed copy`);
}

// --- 1) the sibling temp copy -------------------------------------------------

const nodeModulesReal = fs.realpathSync(path.join(repoRoot, 'node_modules'));
const stamp = Date.now().toString(36);
// No leading dot in the name: vitest's test glob skips dot-directories, and
// a copy it reads as "no test files" would make the proof vacuously green.
const tempDir = path.resolve(repoRoot, '..', `pet-2d-trim-proof-${stamp}`);
if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
fs.mkdirSync(tempDir, { recursive: true });

const EXCLUDED = new Set(['node_modules', 'dist', '.git']);
fs.cpSync(repoRoot, tempDir, {
  recursive: true,
  filter: (source) => {
    const rel = path.relative(repoRoot, source);
    if (rel === '') return true;
    const top = rel.split(path.sep)[0];
    return !EXCLUDED.has(top);
  },
});

// --- 2) junction node_modules -------------------------------------------------

fs.symlinkSync(nodeModulesReal, path.join(tempDir, 'node_modules'), 'junction');

// --- 3) delete the ledger -----------------------------------------------------

fs.rmSync(path.join(tempDir, 'src', 'ledger'), { recursive: true, force: true });
console.log('verify-trim: deleted src/ledger from the copy');

// --- 4) stub the ONE call site -------------------------------------------------

const petPath = path.join(tempDir, 'src', 'pet.ts');
const petSource = fs.readFileSync(petPath, 'utf8');
const occurrences = petSource.split(SEAM_EXPRESSION).length - 1;
if (occurrences !== 1) {
  fail(tempDir, `expected exactly 1 "${SEAM_EXPRESSION}" in src/pet.ts, found ${occurrences}`);
}
fs.writeFileSync(petPath, petSource.replace(SEAM_EXPRESSION, SEAM_STUB));
console.log('verify-trim: stubbed the dynamic-import seam in the copy');

// --- 5) typecheck + tests + build in the trimmed copy ---------------------------

run(tempDir, 'typecheck', 'npx', ['tsc', '-p', 'tsconfig.json', '--noEmit']);
assertTestsRan(tempDir, run(tempDir, 'test', 'npx', ['vitest', 'run']));
run(tempDir, 'build:packs', 'npx', ['tsx', 'scripts/build-packs.ts']);
run(tempDir, 'build:entry', 'npx', ['vite', 'build', '--config', 'vite.plugin.config.ts']);

// --- 6) the trimmed bundle contains no ledger code ------------------------------

const trimmedPet = path.join(tempDir, ...TRIMMED_PET.split(path.sep));
if (!fs.existsSync(trimmedPet)) fail(tempDir, `${TRIMMED_PET} missing from the trimmed build`);
const trimmedCode = fs.readFileSync(trimmedPet, 'utf8');
for (const symbol of FORBIDDEN_SYMBOLS) {
  if (trimmedCode.includes(symbol)) {
    fail(tempDir, `trimmed ${TRIMMED_PET} still contains "${symbol}"`);
  }
}
console.log(
  `verify-trim: PASS — trimmed pet.mjs contains none of [${FORBIDDEN_SYMBOLS.join(', ')}]`
);

// --- 7) teeth: the UNtrimmed bundle must contain them ----------------------------

const untrimmedPet = path.join(repoRoot, ...TRIMMED_PET.split(path.sep));
if (fs.existsSync(untrimmedPet)) {
  const untrimmedCode = fs.readFileSync(untrimmedPet, 'utf8');
  const present = FORBIDDEN_SYMBOLS.filter((symbol) => untrimmedCode.includes(symbol));
  if (present.length !== FORBIDDEN_SYMBOLS.length) {
    const missing = FORBIDDEN_SYMBOLS.filter((symbol) => !present.includes(symbol));
    fail(tempDir, `untrimmed dist pet.mjs lacks [${missing.join(', ')}] — assertion 6 is vacuous; rebuild dist first`);
  }
  console.log('verify-trim: PASS (teeth) — the untrimmed dist pet.mjs DOES contain the symbols');
} else {
  console.log('verify-trim: NOTE — no untrimmed dist to teeth-check yet; run a normal build first for the full proof');
}

// --- cleanup ---------------------------------------------------------------------

fs.rmSync(path.join(tempDir, 'node_modules'), { force: true }); // the junction link only
fs.rmSync(tempDir, { recursive: true, force: true });
console.log('verify-trim: OK');
