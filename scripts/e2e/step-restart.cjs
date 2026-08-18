// scripts/e2e/step-restart.cjs — kills ONLY this E2E's electron tree (the
// one process whose command line carries the pet2d-spike --user-data-dir
// marker — the user's own stack never matches) and clears the re-derivable
// Chromium lockfile a force-kill leaves behind (a stale one correlates with
// a silent next-boot death, observed 2026-08-19). It does NOT relaunch —
// the orchestrator (run-e2e.sh) owns launching.
const { execFileSync } = require('node:child_process');
const { rmSync, existsSync } = require('node:fs');

const UDD = 'C:/Users/Sayo/AppData/Local/Temp/pet2d-spike/elftia-udd';
const MARKER = 'pet2d-spike';

// execFileSync (NOT execSync): on Windows execSync goes through cmd.exe,
// which strips one layer of quotes and mangles the -Filter argument.
function ps(expr) {
  return execFileSync('powershell', ['-NoProfile', '-Command', expr], { encoding: 'utf8' }).trim();
}

function killMine() {
  const out = ps(
    `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | ` +
    `Where-Object { $_.CommandLine -like '*${MARKER}*' } | ` +
    `Select-Object -ExpandProperty ProcessId`,
  );
  const pids = out.split(/\s+/).filter((p) => /^\d+$/.test(p));
  for (const pid of pids) {
    try {
      ps(`Stop-Process -Id ${pid} -Force`);
      console.log(`killed electron pid ${pid}`);
    } catch {
      console.log(`pid ${pid} already gone`);
    }
  }
  if (pids.length === 0) console.log('no electron processes with the E2E marker');
}

function main() {
  killMine();
  const lock = `${UDD}/lockfile`;
  if (existsSync(lock)) {
    rmSync(lock);
    console.log('removed stale udd lockfile');
  }
  const remaining = ps(
    `(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${MARKER}*' -and $_.Name -match 'electron' }).Count`,
  );
  console.log(`remaining marker processes: ${remaining}`);
}

main();
