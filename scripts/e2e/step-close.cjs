// scripts/e2e/step-close.cjs — graceful full-app close via CDP Browser.close
// (windows closed in order, db handles released, no ghost ports / WAL
// residue). A force-killed predecessor correlates with the next boot
// wedging; this is the sanctioned teardown. Callers fall back to the
// CommandLine-marker kill only if this fails.
const lib = require('./lib-cdp.cjs');

async function main() {
  const port = lib.resolveCdpPort(process.env.PET2D_E2E_DEV_LOG);
  const t = await lib.findTarget(port, 'localhost:5399/');
  const s = await lib.session(t);
  await s.send('Browser.close').catch((e) => console.log('BROWSER_CLOSE_ERR:', e.message));
  s.close();
  console.log('CLOSED');
}

main().catch((e) => {
  console.error('ERR:', e.message);
  process.exit(1);
});
