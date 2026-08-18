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
//   4. Stubs BOTH dynamic-import seams — the only lines in the tree that
//      can reference the deleted module: pet.ts's `createLedger` seam
//      (null-returning stub that typechecks and lands in activate()'s
//      existing guard — ledger stays undefined, the pet is unaffected) and
//      LedgerPanel.tsx's `inspect` seam (a rejecting stub that lands in the
//      panel's own catch — the honest unavailable card).
//   5. Runs tsc --noEmit, vitest run, and the pack+entry+page builds IN the copy.
//   6. Asserts the trimmed dist/pet-2d/renderer/pet.mjs contains neither
//      `xpForLevel` nor the ledger storage key, and the trimmed manager.mjs
//      contains none of the implementation-only ledger symbols (curve math +
//      storage key) — a stray inlined copy of ledger code cannot survive
//      silently. Seam call-site names are NOT forbidden (see below).
//   7. TRIMMED-CARD CHECK: the trimmed manager.mjs DOES contain the honest
//      unavailable-card string (the degradation the stub produces at
//      runtime must have a literal to render).
//   8. TEETH CHECK: if the repo's own (untrimmed) dist exists, asserts BOTH
//      entries DO contain their symbols — otherwise step 6 would pass
//      vacuously.
//
// On any failure the temp copy is KEPT and its path printed for inspection.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

// The exact expressions the two seam call sites use; the script fails
// loudly if either file drifts. Both stubs TYPECHECK in the trimmed tree
// (a rejected promise awaits to `never`, assignable to anything) and land
// in each caller's existing guard.
const SEAMS = [
  {
    file: path.join('src', 'pet.ts'),
    expression: "await import('./ledger/createLedger')",
    stub: "await Promise.resolve({ createLedger: null as unknown as () => LedgerPort })",
  },
  {
    file: path.join('src', 'manager', 'LedgerPanel.tsx'),
    expression: "import('../ledger/inspect')",
    stub: "Promise.reject(new Error('ledger trimmed'))",
  },
];
const PET_FORBIDDEN_SYMBOLS = ['xpForLevel', 'elftia-pet-2d:ledger:v1'];
// Implementation-only symbols. Seam-interface member names (summarizeLedger,
// readLedgerState, LEDGER_STORAGE_KEY) appear at the panel's CALL SITE
// (inspect.summarizeLedger(...)) and legitimately survive the trim as dead
// code behind the rejecting stub — they cannot be forbidden here. The xp
// curve + the storage key are what "no ledger code leaked" actually means.
const MANAGER_FORBIDDEN_SYMBOLS = ['levelFor', 'xpForLevel', 'elftia-pet-2d:ledger:v1'];
// The honest degradation card's zh copy — must SURVIVE the trim (it renders
// when the stubbed seam rejects at runtime).
const MANAGER_REQUIRED_STRING = '成长账本不可用（已被裁剪）';
const TRIMMED_PET = path.join('dist', 'pet-2d', 'renderer', 'pet.mjs');
const TRIMMED_MANAGER = path.join('dist', 'pet-2d', 'renderer', 'manager.mjs');

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

// --- 4) stub BOTH call sites -----------------------------------------------------

for (const seam of SEAMS) {
  const seamPath = path.join(tempDir, ...seam.file.split(path.sep));
  const seamSource = fs.readFileSync(seamPath, 'utf8');
  const occurrences = seamSource.split(seam.expression).length - 1;
  if (occurrences !== 1) {
    fail(tempDir, `expected exactly 1 "${seam.expression}" in ${seam.file}, found ${occurrences}`);
  }
  fs.writeFileSync(seamPath, seamSource.replace(seam.expression, seam.stub));
  console.log(`verify-trim: stubbed the dynamic-import seam in ${seam.file}`);
}

// --- 5) typecheck + tests + build in the trimmed copy ---------------------------

run(tempDir, 'typecheck', 'npx', ['tsc', '-p', 'tsconfig.json', '--noEmit']);
assertTestsRan(tempDir, run(tempDir, 'test', 'npx', ['vitest', 'run']));
run(tempDir, 'build:packs', 'npx', ['tsx', 'scripts/build-packs.ts']);
run(tempDir, 'build:entry', 'npx', ['vite', 'build', '--config', 'vite.plugin.config.ts']);
run(tempDir, 'build:manager', 'npx', ['vite', 'build', '--config', 'vite.plugin.manager.config.ts']);

// --- 6) the trimmed bundles contain no ledger code --------------------------------

function assertTrimmedEntry(relPath, forbidden) {
  const full = path.join(tempDir, ...relPath.split(path.sep));
  if (!fs.existsSync(full)) fail(tempDir, `${relPath} missing from the trimmed build`);
  const code = fs.readFileSync(full, 'utf8');
  for (const symbol of forbidden) {
    if (code.includes(symbol)) {
      fail(tempDir, `trimmed ${relPath} still contains "${symbol}"`);
    }
  }
  console.log(`verify-trim: PASS — trimmed ${path.basename(relPath)} contains none of [${forbidden.join(', ')}]`);
  return code;
}

assertTrimmedEntry(TRIMMED_PET, PET_FORBIDDEN_SYMBOLS);
const trimmedManagerCode = assertTrimmedEntry(TRIMMED_MANAGER, MANAGER_FORBIDDEN_SYMBOLS);

// --- 7) the trimmed manager still renders the honest card -------------------------

if (!trimmedManagerCode.includes(MANAGER_REQUIRED_STRING)) {
  fail(tempDir, `trimmed ${TRIMMED_MANAGER} lacks the unavailable-card string — the degradation has nothing to render`);
}
console.log('verify-trim: PASS — trimmed manager.mjs still contains the unavailable-card string');

// --- 8) teeth: the UNtrimmed bundles must contain them ------------------------------

function teethCheck(relPath, symbols) {
  const full = path.join(repoRoot, ...relPath.split(path.sep));
  if (!fs.existsSync(full)) {
    console.log(`verify-trim: NOTE — no untrimmed ${path.basename(relPath)} to teeth-check yet; run a normal build first for the full proof`);
    return;
  }
  const code = fs.readFileSync(full, 'utf8');
  const missing = symbols.filter((symbol) => !code.includes(symbol));
  if (missing.length > 0) {
    fail(tempDir, `untrimmed ${relPath} lacks [${missing.join(', ')}] — assertion 6 is vacuous; rebuild dist first`);
  }
  console.log(`verify-trim: PASS (teeth) — the untrimmed ${path.basename(relPath)} DOES contain [${symbols.join(', ')}]`);
}

teethCheck(TRIMMED_PET, PET_FORBIDDEN_SYMBOLS);
teethCheck(TRIMMED_MANAGER, MANAGER_FORBIDDEN_SYMBOLS);

// --- cleanup ---------------------------------------------------------------------

fs.rmSync(path.join(tempDir, 'node_modules'), { force: true }); // the junction link only
fs.rmSync(tempDir, { recursive: true, force: true });
console.log('verify-trim: OK');
