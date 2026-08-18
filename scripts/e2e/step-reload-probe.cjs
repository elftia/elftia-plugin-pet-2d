// scripts/e2e/step-reload-probe.cjs — Q3 reload + rail probe (one-shot driver).
const lib = require('./lib-cdp.cjs');

const DEV_LOG = process.env.PET2D_E2E_DEV_LOG ?? 'C:/Users/Sayo/AppData/Local/Temp/pet2d-spike/logs/e2e-dev-out7.txt';

async function main() {
  const t = await lib.findTarget(lib.resolveCdpPort(DEV_LOG), 'localhost:5399/');
  // Reload from INSIDE the page — external Page.reload wedges the app (Q1).
  await lib.evalIn(t, 'location.reload()');
  await lib.sleep(6000);
  const r = await lib.evalIn(
    t,
    `(() => ({
      rail: !!document.querySelector('[data-testid="sidebar-agent-page-pet-2d"]'),
      withheld: window.native ? (window.native.plugins.listWithheldContributions ? 'api' : 'none') : 'no-native',
      href: location.href,
    }))()`,
  );
  console.log('RAIL_PROBE:', JSON.stringify(r));
  const withheld = await lib.evalIn(
    t,
    `(async () => JSON.stringify(await window.native.plugins.listWithheldContributions()))()`,
  );
  console.log('WITHHELD:', String(withheld).slice(0, 300));
}

main().catch((e) => {
  console.error('ERR:', e.message);
  process.exit(1);
});
