// scripts/e2e/step-install.cjs — installLocal the current dist + ensure
// enabled, then GRACEFULLY close the whole app via CDP Browser.close (a
// force-killed predecessor correlates with the next boot wedging at the
// session-folder-migration step — observed 2026-08-19; graceful close
// avoids leaving locked db/WAL state behind).
const lib = require('./lib-cdp.cjs');

const DEV_LOG = process.env.PET2D_E2E_DEV_LOG ?? 'C:/Users/Sayo/AppData/Local/Temp/pet2d-spike/logs/e2e-dev-out6.txt';

const DIST = 'E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia-plugin-pet-2d/dist/pet-2d';

async function main() {
  const t = await lib.findTarget(lib.resolveCdpPort(DEV_LOG), 'localhost:5399/');
  const install = await lib.evalIn(
    t,
    `(async () => window.native.plugins.installLocal({ path: '${DIST}' }))()`,
    60000,
  );
  console.log('INSTALL:', JSON.stringify(install).slice(0, 400));
  const enable = await lib.evalIn(
    t,
    `(async () => window.native.plugins.setEnabled({ id: 'pet-2d', enabled: true }))()`,
  );
  console.log('ENABLE:', JSON.stringify(enable));
  await lib.sleep(1500);
  // Graceful full-app close: Browser.close ends the browser process cleanly
  // (windows closed in order, db handles released), and npm/electron-vite
  // then exits on its own.
  const s = await lib.session(t);
  await s.send('Browser.close').catch((e) => console.log('BROWSER_CLOSE_ERR:', e.message));
  s.close();
  console.log('CLOSED');
}

main().catch((e) => {
  console.error('ERR:', e.message);
  process.exit(1);
});
