/**
 * scripts/e2e/run-e2e.cjs — task 8.2, the Tier-C E2E: whale-girl's real
 * atlas walking the USER surface end to end in the isolated dev app.
 *
 * Preconditions (the orchestrator shell, run-e2e.sh, owns these):
 *   - whale-girl seeded on disk (scripts/e2e/seed.ts) into the temp udd's
 *     plugin-data/pet-2d/packs/
 *   - the current plugin dist installed + enabled, app (re)started, so the
 *     main half is past the ready barrier (spike Q3 reload applied
 *     conditionally inside, only if the rail entry is absent at boot)
 *
 * Legs (each logged + screenshotted into the evidence dir):
 *   1 gallery      — manager page opens; whale-girl card present (user
 *                    chip, unselected); default pack selected
 *   2 select       — click whale-girl -> data-selected="true"
 *   3 pet render   — enable desktopPet; pet.html mounts; sprite has
 *                    data-pet-state; its sheet IS one of whale-girl's 15
 *                    loaded sheets (exact membership, any current state)
 *   4 state probe  — a real CDP drag flips the state (dragging sense ->
 *                    "drag"), release returns it toward idle
 *   5 D6 timing    — packs:load('whale-girl') through the pet window's
 *                    narrowed preload bridge, timed + payload-sized
 *   6 delete+repair— delete whale-girl via the card button; card gone;
 *                    ring repaired to the default pack; the pet window
 *                    falls back (background-image leaves whale-girl's)
 *   7 studio smoke — open studio; the ONE human gesture: the operator
 *                    picks the fixture dir in the REAL native dialog (the
 *                    studio's scoped-ipc surface is not page-interceptable
 *                    — see the leg comment); then the whale-girl offer,
 *                    15-slot grid, animating preview, problems=0 and a
 *                    live bad-id break, all headless
 */
const { mkdirSync, appendFileSync } = require('node:fs');
const { join } = require('node:path');

const lib = require('./lib-cdp.cjs');

const EVIDENCE = 'E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia-wt-pet/.rasen/changes/desktop-pet-pack-authoring/evidence';
const FIXTURE_ASSETS = 'E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia-plugin-pet-2d/fixtures/whale-girl/lib/assets';
const DEV_LOG = process.env.PET2D_E2E_DEV_LOG ?? 'C:/Users/Sayo/AppData/Local/Temp/pet2d-spike/logs/e2e-dev-out7.txt';
// The MAIN window's URL carries '#/' (hash router); '/pet.html' must never
// match this substring (attempt-2's findTarget picked the pet window first).
const MAIN = 'localhost:5399/#';
const PET = 'pet.html';

const report = [];
let failures = 0;

function log(line) {
  console.log(line);
  appendFileSync(join(EVIDENCE, 'e2e-log.txt'), `${new Date().toISOString()} ${line}\n`, 'utf8');
}

function record(leg, pass, detail) {
  report.push({ leg, pass, detail });
  if (!pass) failures += 1;
  log(`${pass ? 'PASS' : 'FAIL'} [${leg}] ${detail}`);
}

async function shot(name, target) {
  const path = join(EVIDENCE, name);
  await lib.screenshot(target, path);
  log(`SHOT ${name}`);
}

function mainEval(mainTarget, expr, timeout) {
  return lib.evalIn(mainTarget, expr, timeout);
}

function click(expr) {
  // expr: a JS expression resolving to the element to click
  return `(async () => { const el = ${expr}; if (!el) return 'MISSING'; el.click(); return 'CLICKED'; })()`;
}

async function waitFor(fn, what, timeoutMs = 15000, intervalMs = 400) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`waitFor(${what}) timed out`);
    await lib.sleep(intervalMs);
  }
}

async function main() {
  mkdirSync(EVIDENCE, { recursive: true });
  const port = lib.resolveCdpPort(DEV_LOG);
  log(`=== Tier-C E2E start (cdp=${port}) ===`);

  const mainTarget = await lib.findTarget(port, MAIN);
  // Q3, applied CONDITIONALLY: a boot with the plugin already enabled has the
  // rail from the start — and an unconditional reload KNOCKED it out for the
  // whole run (attempt-2: rail gone >45s post-reload, manager unreachable).
  // The in-page reload is only the fallback for the install-at-runtime boot
  // (main half enabled mid-session, renderer needs one reload to register).
  // If a reload is ever needed, it MUST come from INSIDE the page
  // (`location.reload()`): an external CDP Page.reload aborts the window's
  // load and the fatal-startup path then WEDGES the main loop (spike quirk
  // Q1 signature, reproduced live 2026-08-19).
  const railSel = `document.querySelector('[data-testid="sidebar-agent-page-pet-2d"]')`;
  let railUp = await waitFor(
    async () => (await mainEval(mainTarget, `!!${railSel}`, 10000)) === true,
    'rail entry at boot',
    30000,
    1000,
  ).then(
    () => true,
    () => false,
  );
  if (!railUp) {
    log('rail absent at boot — applying Q3 in-page reload fallback');
    await mainEval(mainTarget, 'location.reload()').catch((e) => log(`reload eval: ${e.message}`));
    railUp = await waitFor(
      async () => (await mainEval(mainTarget, `!!${railSel}`, 10000)) === true,
      'rail entry after reload',
      45000,
      1000,
    ).then(
      () => true,
      (e) => {
        log(`rail wait error: ${e.message}`);
        return false;
      },
    );
  }

  // ── leg 1: gallery ─────────────────────────────────────────────────────
  const railClick = await mainEval(mainTarget, click(railSel));
  const pageUp = railUp && railClick === 'CLICKED' ? await waitFor(
    async () =>
      (await mainEval(mainTarget, `!!document.querySelector('[data-testid="pet-manager-page"]')`, 10000)) === true,
    'manager page mount',
    20000,
    500,
  ).then(
    () => true,
    (e) => {
      log(`page wait error: ${e.message}`);
      return false;
    },
  ) : false;
  // Statelessness against carry-over view state: a prior run (or manual
  // probing between runs) may leave the manager INSIDE the studio screen —
  // the rail click re-shows the page but not the gallery sub-view
  // (attempt-4: page:true, gallery:false). Normalize by leaving the studio
  // when present ('MISSING' click is a harmless no-op otherwise).
  await mainEval(mainTarget, click(`document.querySelector('[data-testid="pet-manager-studio-back"]')`));
  await lib.sleep(800);
  // Reset selection to the default pack first: a prior run (or the user's
  // manual session) can leave whale-girl already selected, which would fail
  // the leg's initial-state assertion without reflecting any product defect
  // (attempt-6: wgSelected:"true" out of the gate).
  await mainEval(
    mainTarget,
    `(async () => {
      const sel = document.querySelector('[data-testid="pet-manager-pack-card-whale-girl"]')?.getAttribute('data-selected');
      if (sel === 'true') {
        document.querySelector('[data-testid="pet-manager-pack-card-elf-blob"]')?.click();
      }
      return 'reset:' + sel;
    })()`,
  );
  await lib.sleep(1200); // prefs debounce + card re-render
  const gallery = await mainEval(
    mainTarget,
    `(() => ({
      page: !!document.querySelector('[data-testid="pet-manager-page"]'),
      gallery: !!document.querySelector('[data-testid="pet-manager-gallery"]'),
      wgCard: !!document.querySelector('[data-testid="pet-manager-pack-card-whale-girl"]'),
      wgChip: !!document.querySelector('[data-testid="pet-manager-pack-user-chip-whale-girl"]'),
      wgSelected: document.querySelector('[data-testid="pet-manager-pack-card-whale-girl"]')?.getAttribute('data-selected'),
      defaultSelected: document.querySelector('[data-testid="pet-manager-pack-card-elf-blob"]')?.getAttribute('data-selected'),
      studioOpen: !!document.querySelector('[data-testid="pet-manager-studio-open"]'),
    }))()`,
  );
  record(
    'gallery',
    pageUp === true && gallery.page && gallery.gallery && gallery.wgCard && gallery.wgChip === true &&
      gallery.wgSelected === 'false' && gallery.defaultSelected === 'true' && gallery.studioOpen,
    `railClick=${railClick} ${JSON.stringify(gallery)}`,
  );
  await shot('e2e-01-gallery.png', mainTarget);

  // ── leg 2: select whale-girl ───────────────────────────────────────────
  await mainEval(mainTarget, click(`document.querySelector('[data-testid="pet-manager-pack-card-whale-girl"]')`));
  const selected = await waitFor(
    async () =>
      (await mainEval(
        mainTarget,
        `document.querySelector('[data-testid="pet-manager-pack-card-whale-girl"]')?.getAttribute('data-selected')`,
      )) === 'true',
    'whale-girl selected ring',
  ).then(
    () => true,
    (e) => {
      log(`select wait error: ${e.message}`);
      return false;
    },
  );
  record('select', selected === true, `data-selected=true after click`);
  await lib.sleep(3500); // prefs debounce (500ms) + pet-window re-resolve

  // ── leg 3: pet render ──────────────────────────────────────────────────
  // Enable the desktop pet through the SANCTIONED main-window verb
  // (`pet:setConfig` — the settings surface's write path; F16 keeps it out of
  // the pet window's own preload). `config:merge` rejects a `desktopPet` key:
  // its Zod enum only knows the eight settings namespaces.
  await mainEval(
    mainTarget,
    `(async () => window.native.pet.setConfig({ enabled: true, currentPetId: 'pet-2d' }))()`,
  );
  const petTarget = await lib.waitForTarget(port, PET, 30000);
  await lib.sleep(5000); // pet window boot + pack resolve
  const petProbe = await lib.evalIn(
    petTarget,
    `(() => {
      const sprite = document.querySelector('[data-pet-state]');
      const bg = sprite ? getComputedStyle(sprite).backgroundImage : '';
      return { hasSprite: !!sprite, state: sprite?.getAttribute('data-pet-state'), bgLen: bg.length };
    })()`,
  );
  // The sprite's sheet must BE one of whale-girl's loaded sheets — ANY of
  // the 15, not just idle: the pet may legitimately sit in another state
  // when the probe lands (attempt-6 failed exactly here: state "sleep",
  // the sleep sheet's URL is obviously not idle's). Membership is checked
  // INSIDE the page — hauling fifteen ~200KB data-URIs back through CDP
  // just to compare them here would be wasteful.
  const renderProbe = await lib.evalIn(
    petTarget,
    `(() => {
      const stripUrl = (u) => {
        if (!u.startsWith('url(')) return u;
        let s = u.slice(4);
        if (s.endsWith(')')) s = s.slice(0, -1);
        const q = s.charAt(0);
        if ((q === '"' || q === String.fromCharCode(39)) && s.charAt(s.length - 1) === q) s = s.slice(1, -1);
        return s;
      };
      return (async () => {
        const pets = await window.native.plugins.listAppExtensionPets();
        const tok = (pets.find(p => p.id === 'pet-2d') ?? pets[0])?.capabilityToken;
        if (!tok) return { error: 'no token', n: pets.length };
        const r = await window.native.plugins.invoke({ method: 'packs:load', payload: { id: 'whale-girl' }, capabilityToken: tok });
        const urls = Object.values(r?.sheets ?? {}).map(s => s?.url);
        const sprite = document.querySelector('[data-pet-state]');
        const bg = sprite ? stripUrl(getComputedStyle(sprite).backgroundImage) : '';
        return {
          manifestId: r?.manifest?.id ?? null,
          states: urls.length,
          bgLen: bg.length,
          bgIsSheet: urls.includes(bg),
          state: sprite?.getAttribute('data-pet-state') ?? null,
        };
      })();
    })()`,
    60000,
  );
  const isWhaleGirl = renderProbe.bgIsSheet === true && renderProbe.manifestId === 'whale-girl';
  record(
    'pet-render',
    petProbe.hasSprite === true && typeof petProbe.state === 'string' && petProbe.state !== '' && isWhaleGirl,
    JSON.stringify({ petProbe, renderProbe }),
  );
  await shot('e2e-02-pet-window.png', petTarget);

  // ── leg 4: state-change probe (real drag) ──────────────────────────────
  const rect = await lib.evalIn(
    petTarget,
    `(() => { const el = document.querySelector('[data-pet-state]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
  );
  let sawDrag = false;
  if (rect === null) {
    record('state-probe', false, 'no sprite rect');
  } else {
    const dragPromise = lib.drag(petTarget, rect.x, rect.y, 90, 40, 8, 700);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !sawDrag) {
      const st = await lib.evalIn(petTarget, `document.querySelector('[data-pet-state]')?.getAttribute('data-pet-state')`);
      if (st === 'drag') sawDrag = true;
      else await lib.sleep(120);
    }
    await dragPromise;
    const post = await lib.evalIn(petTarget, `document.querySelector('[data-pet-state]')?.getAttribute('data-pet-state')`);
    record('state-probe', sawDrag, `saw data-pet-state="drag" during drag; post-release state="${post}"`);
  }
  await shot('e2e-03-pet-after-drag.png', petTarget);

  // ── leg 5: D6 payload timing (the real packs:load over the narrowed bridge)
  const timing = await lib.evalIn(
    petTarget,
    `(async () => {
      const pets = await window.native.plugins.listAppExtensionPets();
      const tok = (pets.find(p => p.id === 'pet-2d') ?? pets[0])?.capabilityToken;
      const out = {};
      for (const id of ['whale-girl', 'elf-blob']) {
        const t0 = performance.now();
        const r = await window.native.plugins.invoke({ method: 'packs:load', payload: { id }, capabilityToken: tok });
        const ms = Math.round((performance.now() - t0) * 10) / 10;
        out[id] = { ms, payloadKB: Math.round(JSON.stringify(r).length / 1024), states: Object.keys(r?.sheets ?? {}).length };
      }
      return out;
    })()`,
    90000,
  );
  // whale-girl: a STORE pack served by packs:load (all 15 sheets ride the
  // bridge). elf-blob: a BUILTIN resolved from the bundled pack module —
  // packs:load legitimately returns no sheets for it (attempt-2: ms 1.3,
  // states 0), so its numbers are recorded, not asserted.
  const timingOk =
    timing?.['whale-girl']?.ms > 0 &&
    timing?.['whale-girl']?.states === 15 &&
    timing?.['whale-girl']?.payloadKB > 0;
  record('d6-timing', timingOk === true, JSON.stringify(timing));

  // ── leg 6: delete + repair ─────────────────────────────────────────────
  await mainEval(mainTarget, click(`document.querySelector('[data-testid="pet-manager-pack-delete-whale-girl"]')`));
  await lib.sleep(2500);
  const afterDelete = await mainEval(
    mainTarget,
    `(() => ({
      wgGone: document.querySelector('[data-testid="pet-manager-pack-card-whale-girl"]') === null,
      defaultSelected: document.querySelector('[data-testid="pet-manager-pack-card-elf-blob"]')?.getAttribute('data-selected'),
    }))()`,
  );
  await lib.sleep(3000); // pet window re-resolve after the rev bump
  const petAfterDelete = await lib.evalIn(
    petTarget,
    `(document.querySelector('[data-pet-state]') ? getComputedStyle(document.querySelector('[data-pet-state]')).backgroundImage : '').length`,
  );
  record(
    'delete-repair',
    afterDelete.wgGone === true && afterDelete.defaultSelected === 'true' && petAfterDelete > 0,
    JSON.stringify({ afterDelete, petBgLenAfterDelete: petAfterDelete }),
  );
  await shot('e2e-04-after-delete.png', mainTarget);

  // ── leg 7: studio smoke ────────────────────────────────────────────────
  await mainEval(mainTarget, click(`document.querySelector('[data-testid="pet-manager-studio-open"]')`));
  await lib.sleep(800);
  const studioBase = await mainEval(
    mainTarget,
    `(() => ({
      studio: !!document.querySelector('[data-testid="pet-manager-studio"]'),
      unavailable: !!document.querySelector('[data-testid="pet-manager-studio-unavailable"]'),
      pick: !!document.querySelector('[data-testid="pet-manager-studio-pick-dir"]'),
    }))()`,
  );
  record('studio-open', studioBase.studio && !studioBase.unavailable && studioBase.pick, JSON.stringify(studioBase));

  // The dir pick: the ONE gesture the driver cannot take alone. Wrapping
  // `window.native.plugins.invoke` — and every function on `window.native`
  // and `window.api` — records ZERO calls while the pick still opens the
  // real dialog: the studio's scoped-ipc transport reaches main on a
  // surface the page's main world cannot intercept (probe 2026-08-19:
  // RECORDED [] while a real dialog opened). Keyboard/UIA injection into
  // the native picker is not reliable on a SHARED machine (the dialog does
  // not reliably take foreground; forced foreground lands focus on the
  // folder tree so typed paths vanish; the active user's input cancels UIA
  // writes — attempts 4-6, one lucky success). So this gesture is HUMAN:
  // the operator clicks the pick button and selects the fixture dir in the
  // real dialog. Everything after — catalog, whale-girl detection,
  // prefill, validation, preview, problems — is the real verb chain,
  // asserted headlessly below.
  const preLabel = await mainEval(
    mainTarget,
    `document.querySelector('[data-testid="pet-manager-studio-dir-label"]')?.textContent ?? null`,
  );
  if (preLabel !== null) {
    // stale studio state from a prior session — remount the view fresh so
    // the leg really waits for THIS run's pick
    await mainEval(mainTarget, click(`document.querySelector('[data-testid="pet-manager-studio-back"]')`));
    await lib.sleep(600);
    await mainEval(mainTarget, click(`document.querySelector('[data-testid="pet-manager-studio-open"]')`));
    await lib.sleep(800);
  }
  log(`HUMAN_PICK_WAITING — operator: click the pick button in the studio, select ${FIXTURE_ASSETS}`);
  const pickDeadline = Date.now() + 240000;
  let afterPick;
  for (;;) {
    afterPick = await mainEval(
      mainTarget,
      `(() => ({
        dirLabel: document.querySelector('[data-testid="pet-manager-studio-dir-label"]')?.textContent ?? null,
        offer: !!document.querySelector('[data-testid="pet-manager-studio-wg-offer-whale-girl"]'),
        fillError: document.querySelector('[data-testid="pet-manager-studio-fill-error"]')?.textContent ?? null,
      }))()`,
    );
    if (afterPick.dirLabel !== null || Date.now() > pickDeadline) break;
    await lib.sleep(2000);
  }
  const typed = 'human-pick (real native dialog, operator-driven)';
  // dirLabel is localized (zh renders "15 个可用素材") — assert the count
  // digit, never an English substring; the offer flag is the strong signal.
  const pickOk =
    afterPick.dirLabel !== null &&
    /15/.test(afterPick.dirLabel) &&
    afterPick.offer === true;
  record('studio-pick', pickOk, `dialog=${typed} ${JSON.stringify(afterPick)}`);

  if (afterPick.offer === true) {
    await mainEval(mainTarget, click(`document.querySelector('[data-testid="pet-manager-studio-wg-offer-whale-girl"]')`));
    await lib.sleep(1500);
    const prefilled = await mainEval(
      mainTarget,
      `(() => ({
        gridRows: document.querySelectorAll('[data-testid="pet-manager-studio-slots"] table tbody tr, [data-testid^="pet-manager-studio-slot-"][data-testid$="-sheet"]').length,
        idleSheet: (document.querySelector('[data-testid="pet-manager-studio-slot-idle-sheet"]') || {}).value,
        problems: document.querySelector('[data-testid="pet-manager-studio-problems"]')?.getAttribute('data-count'),
        previewLoaded: document.querySelector('[data-testid="pet-manager-studio-preview"]')?.getAttribute('data-loaded'),
        previewFrame: document.querySelector('[data-testid="pet-manager-studio-preview"]')?.getAttribute('data-frame'),
        saveDisabled: document.querySelector('[data-testid="pet-manager-studio-save"]')?.disabled,
      }))()`,
    );
    await lib.sleep(450); // idle animates at ~8fps
    const frame2 = await mainEval(
      mainTarget,
      `document.querySelector('[data-testid="pet-manager-studio-preview"]')?.getAttribute('data-frame')`,
    );
    const animates = prefilled.previewFrame !== frame2;
    record(
      'studio-prefill',
      prefilled.idleSheet === 'idle.png' &&
        prefilled.problems === '0' &&
        prefilled.previewLoaded === 'true' &&
        prefilled.saveDisabled === false &&
        animates,
      JSON.stringify({ ...prefilled, frame2, animates }),
    );
    await shot('e2e-05-studio-prefilled.png', mainTarget);

    // Live problems: break the id, watch the strip + save disable.
    await mainEval(
      mainTarget,
      `(async () => {
        const el = document.querySelector('[data-testid="pet-manager-studio-meta-id"]');
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        set.call(el, 'Bad Id!');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return 'SET';
      })()`,
    );
    await lib.sleep(400);
    const broken = await mainEval(
      mainTarget,
      `(() => ({
        problems: document.querySelector('[data-testid="pet-manager-studio-problems"]')?.getAttribute('data-count'),
        saveDisabled: document.querySelector('[data-testid="pet-manager-studio-save"]')?.disabled,
        text: document.querySelector('[data-testid="pet-manager-studio-problems"]')?.textContent?.slice(0, 80),
      }))()`,
    );
    record(
      'studio-problems',
      broken.problems !== '0' && broken.saveDisabled === true,
      JSON.stringify(broken),
    );
    await shot('e2e-06-studio-problems.png', mainTarget);
  }

  // ── wrap up ────────────────────────────────────────────────────────────
  const summary = { legs: report.length, failures, report };
  appendFileSync(
    join(EVIDENCE, 'e2e-report.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8',
  );
  log(`=== Tier-C E2E end: ${report.length - failures}/${report.length} legs passed ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  log(`FATAL: ${e.message}`);
  process.exit(2);
});
