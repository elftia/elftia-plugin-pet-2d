/**
 * Standalone Electron harness for the D0 spike (tasks 1.2-1.5). Replicates the
 * host's pet-surface security posture WITHOUT the dev app or an install:
 *   - registers the `plugin` scheme with the host's exact privileges
 *     (HOST_WT/packages/desktop/app/main/protocols.ts:98-107)
 *   - serves `scripts/spike/fixture/` over `protocol.handle('plugin', …)`
 *     (host `fixture`) and, read-only, ONE real whale-girl PNG (host `real`,
 *     allowlisted to `idle.png` only — WG stays untouched, nothing is copied)
 *   - stamps the host's exact CSP (ported verbatim in `./csp.mjs`) via
 *     `session.defaultSession.webRequest.onHeadersReceived`
 *   - opens windows with child B's production pet-window flags
 *     (browserPetWindow.ts:18-35 + PetWindowService.ts:386-401)
 *
 * Usage (run from PLUGIN_REPO):
 *   npx electron scripts/spike/pet-surface-spike.mjs --only=1 --out=<dir>
 *   npx electron scripts/spike/pet-surface-spike.mjs --only=2 --out=<dir>
 *   npx electron scripts/spike/pet-surface-spike.mjs --only=3 --out=<dir>
 *   npx electron scripts/spike/pet-surface-spike.mjs --only=1p --out=<dir>
 * `--only=1p` is the production-origin RE-PROBE of item ① (see
 * `runItem1ProductionOrigin` below): the same four candidates, but loaded from
 * an `app://bundle` page instead of `plugin://fixture` — the origin the real
 * pet window actually runs on (`app://bundle/pet.html` packaged;
 * `http://localhost:<port>/pet.html` in dev; never `plugin://`).
 * `--only=` runs a single item per process (environment gotcha: this machine
 * restarts the GPU/network service when several windows open across a run;
 * one item per launch avoids that noise). Omit `--only=` to run all three
 * sequentially in one process (fallback; a mid-run network-service restart
 * here is probe noise, not a finding — re-run the affected item alone).
 * `--out=<dir>` defaults to `./out` next to this script; item ③ also writes
 * PNGs there.
 *
 * Always prints a final line `RESULT_JSON: {...}` — the machine-readable
 * envelope required by task 1.2's gate — in addition to the `--out` file.
 */
import { appendFileSync, existsSync, mkdirSync,writeFileSync } from 'node:fs';
import { mkdir,readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow, protocol, screen,session } from 'electron';
import { PNG } from 'pngjs';

import { buildContentSecurityPolicy } from './csp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// DEBUG: unconditional synchronous marker so a silent/empty run is diagnosable.
try {
  mkdirSync(path.join(here, 'out'), { recursive: true });
  writeFileSync(
    path.join(here, 'out', '_debug-boot.log'),
    `boot ${new Date().toISOString()} cwd=${process.cwd()} argv=${JSON.stringify(process.argv)}\n`
  );
} catch {
  // best effort
}
const fixtureDir = path.join(here, 'fixture');
const REAL_WG_DIR = path.resolve(
  here,
  '../../../../_others/whale-girl/lib/assets/characters/whale-girl'
);
const REAL_ALLOWLIST = new Set(['idle.png']);

const argv = process.argv.slice(2);
const onlyArg = argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice('--only='.length) : null; // '1' | '1p' | '2' | '3' | null
const outArg = argv.find((a) => a.startsWith('--out='));
const outDir = outArg ? outArg.slice('--out='.length) : path.join(here, 'out');

app.disableHardwareAcceleration(); // GPU-crash noise reduction, per environment gotcha

// Root cause of an intermittent silent-truncation bug found while running this
// harness: with NO window-all-closed handler, Electron's default behavior is
// to auto-quit as soon as the last open BrowserWindow is destroyed. Every item
// here destroys its window(s) mid-function and then keeps doing async work
// (mkdir/writeFile/console.log) — that default quit races the remaining work
// and, for item 3 (single window, destroyed early, most async tail left),
// reproducibly won, killing the process before the PNG/JSON ever got written.
// Suppress the default so ONLY our own explicit app.exit() at the very end
// terminates the process.
app.on('window-all-closed', () => {});

// ---- scheme registration: host's EXACT privileges (protocols.ts) ---------
// `plugin`: protocols.ts:98-107. `app`: protocols.ts:45-55
// (PRIVILEGED_APP_SCHEME) — registered so the production-origin re-probe
// (`--only=1p`) can load its page from `app://bundle/…`, the origin the real
// pet window runs on. Identical privileges either way; what differs is the
// ORIGIN the page runs on, which is what CSP `'self'` resolves against.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'plugin',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: false,
      corsEnabled: true,
    },
  },
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: false,
      corsEnabled: true,
    },
  },
]);

function contentTypeFor(file) {
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.json')) return 'application/json';
  if (file.endsWith('.mjs') || file.endsWith('.js')) return 'text/javascript';
  if (file.endsWith('.html')) return 'text/html';
  return 'application/octet-stream';
}

async function registerPluginProtocol() {
  protocol.handle('plugin', async (request) => {
    const url = new URL(request.url);
    const host = url.hostname;
    const relPath = decodeURIComponent(url.pathname).replace(/^\/+/, '');

    if (host === 'fixture') {
      // Same-origin alias for the ONE real whale-girl asset this spike needs
      // (idle.png, read-only, nothing else from WG is ever exposed). Serving
      // it under the `fixture` host — not a separate `real` host — matters:
      // a real character-pack plugin ships its HTML and its own images under
      // ONE plugin id (one `plugin://<id>` origin), so this is what makes
      // item ③ representative of production instead of testing an artificial
      // cross-plugin-host load that CSP's img-src would correctly reject
      // regardless of asset content (see `real-idle.png-crossorigin-finding`
      // in spike-findings.md).
      if (relPath === 'real-idle.png') {
        if (!REAL_ALLOWLIST.has('idle.png')) {
          return new Response('forbidden: not allowlisted', { status: 403 });
        }
        try {
          const data = await readFile(path.join(REAL_WG_DIR, 'idle.png'));
          return new Response(data, { headers: { 'Content-Type': 'image/png' } });
        } catch {
          return new Response('not found', { status: 404 });
        }
      }

      const resolved = path.join(fixtureDir, relPath);
      if (!resolved.startsWith(fixtureDir)) {
        return new Response('forbidden: path escape', { status: 403 });
      }
      try {
        const data = await readFile(resolved);
        return new Response(data, {
          headers: { 'Content-Type': contentTypeFor(resolved) },
        });
      } catch {
        return new Response('not found', { status: 404 });
      }
    }

    if (host === 'real') {
      // Deliberately kept as a SEPARATE, genuinely cross-origin host too —
      // this is what produced the img-src CSP block finding above. Left
      // registered (not removed) so that finding stays independently
      // reproducible without re-deriving it.
      if (!REAL_ALLOWLIST.has(relPath)) {
        return new Response('forbidden: not allowlisted', { status: 403 });
      }
      const resolved = path.join(REAL_WG_DIR, relPath);
      try {
        const data = await readFile(resolved);
        return new Response(data, {
          headers: { 'Content-Type': contentTypeFor(resolved) },
        });
      } catch {
        return new Response('not found', { status: 404 });
      }
    }

    return new Response('unknown host', { status: 404 });
  });
}

/**
 * Serves the SAME fixture dir over `app://bundle/…` — the host name the
 * packaged app actually uses (`app://bundle/pet.html`), so a page loaded from
 * here has the production origin shape: NOT a plugin origin. Used only by the
 * `--only=1p` re-probe; the handler is deliberately dumb (no per-request trust
 * gate — the harness has nothing to gate) and mirrors the response-header
 * shape of the host's `serveLocalFile` (fileServing.ts:151-155: Content-Type /
 * Content-Length / Accept-Ranges, and NOTABLY no Access-Control-Allow-Origin —
 * the host emits none, so the re-probe measures real cross-origin module-import
 * behavior, not a harness-invented one).
 */
async function registerAppProtocol() {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'bundle') return new Response('unknown host', { status: 404 });
    const relPath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const resolved = path.join(fixtureDir, relPath);
    if (!resolved.startsWith(fixtureDir)) {
      return new Response('forbidden: path escape', { status: 403 });
    }
    try {
      const data = await readFile(resolved);
      return new Response(data, {
        headers: {
          'Content-Type': contentTypeFor(resolved),
          'Content-Length': String(data.length),
        },
      });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
}

function setupCsp() {
  const csp = buildContentSecurityPolicy([]);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });
  return csp;
}

// ---- production pet-window flags (browserPetWindow.ts + PetWindowService) -
function createProdFlagsWindow(overrides = {}) {
  return new BrowserWindow({
    width: 256,
    height: 256,
    x: 50,
    y: 50,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#00000000',
    focusable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    ...overrides,
  });
}

// ---- item ① — asset transport ---------------------------------------------
async function runItem1() {
  const win = createProdFlagsWindow();
  await win.loadURL('plugin://fixture/index.html');
  win.show();
  const raw = await win.webContents.executeJavaScript('window.__runTransports()');
  win.destroy();

  const { transports, negativeControl, cspViolations } = raw;
  const passing = Object.entries(transports).filter(
    ([, r]) => r.load === true && r.readable === true
  );
  const verdict = {
    ranking: Object.entries(transports).map(([k, r]) => ({
      candidate: k,
      load: !!r.load,
      readable: r.readable === true,
      error: r.error || null,
      fetchOk: r.fetchOk,
      importOk: r.importOk,
    })),
    anyPassing: passing.length > 0,
    passingCandidates: passing.map(([k]) => k),
    cspActuallyEnforced: negativeControl && negativeControl.blocked === true,
  };
  return { item: 1, transports, negativeControl, cspViolations, verdict };
}

// ---- item ① re-probe — production origin (LEAD correction, 2026-08-18) ----
// The original item ① loaded its test page from `plugin://fixture/index.html`,
// so CSP `'self'` resolved to `plugin://fixture` and candidates a/b passed as
// SAME-ORIGIN — a harness artifact that does NOT transfer: the real pet window
// loads `app://bundle/pet.html` (dev: `http://localhost:<port>/pet.html`), so
// from the real pet window every `plugin://` image/fetch is CROSS-ORIGIN, and
// `img-src`/`connect-src` carry no `plugin:` token. This runner loads the SAME
// page (same file, same absolute `plugin://fixture/…` candidate URLs) from
// `app://bundle/index.html` and re-runs `window.__runTransports()`, plus one
// same-origin control (`app://bundle/sheet.png` from the `app://` page) so an
// a/b failure reads as "the `plugin:` token is missing", never as "images are
// broken in general". It also measures whether candidates c/d — the module
// graph, the channel the production ENTRY loader itself uses
// (`loadAppExtensionPets.ts:73-74` does `import('plugin://<id>/pet.mjs')` from
// this same kind of page) — actually work cross-origin (CORS applies to module
// imports; the host's plugin handler emits no ACAO header, so this is a real
// question, not a formality).
async function runItem1ProductionOrigin() {
  const win = createProdFlagsWindow();
  await win.loadURL('app://bundle/index.html');
  win.show();
  const pageOrigin = await win.webContents.executeJavaScript('location.origin');
  const sameOriginControl = await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const img = new Image();
      const t = setTimeout(() => resolve({ ok: false, error: 'timeout' }), 4000);
      img.onload = () => { clearTimeout(t); resolve({ ok: true, w: img.naturalWidth, h: img.naturalHeight }); };
      img.onerror = () => { clearTimeout(t); resolve({ ok: false, error: 'onerror' }); };
      img.src = 'app://bundle/sheet.png';
    })
  `);
  const raw = await win.webContents.executeJavaScript('window.__runTransports()');
  win.destroy();

  const { transports, negativeControl, cspViolations } = raw;
  const passing = Object.entries(transports).filter(
    ([, r]) => r.load === true && r.readable === true
  );
  const verdict = {
    pageOrigin,
    ranking: Object.entries(transports).map(([k, r]) => ({
      candidate: k,
      load: !!r.load,
      readable: r.readable === true,
      error: r.error || null,
      fetchOk: r.fetchOk,
      importOk: r.importOk,
    })),
    anyPassing: passing.length > 0,
    passingCandidates: passing.map(([k]) => k),
    cspActuallyEnforced: negativeControl && negativeControl.blocked === true,
  };
  return {
    item: '1p',
    pageOrigin,
    sameOriginControl,
    transports,
    negativeControl,
    cspViolations,
    verdict,
  };
}

// ---- item ② — animation clock ---------------------------------------------
async function measureClock(win, durationMs) {
  return win.webContents.executeJavaScript(`window.__runClockTest(${durationMs})`);
}

function cssAdvancing(samples) {
  if (!samples || samples.length < 2) return false;
  // "advancing" = the sampled transform X is not stuck at a single value
  // across the whole window (allows for wrap-around at the 4s keyframe loop).
  const xs = samples.map((s) => s.x);
  const distinct = new Set(xs.map((x) => Math.round(x)));
  return distinct.size > 1;
}

async function runItem2() {
  const DURATION = 10000;
  const probe = createProdFlagsWindow();
  await probe.loadURL('plugin://fixture/index.html');
  probe.show();

  const conditions = {};

  // (i) probe visible, nothing covering it, no other window competing for focus.
  conditions.focused = await measureClock(probe, DURATION);

  // (ii) a decoy window elsewhere on screen takes OS focus; probe stays visible,
  // unobstructed (it was never OS-focusable to begin with — focusable:false).
  const decoy = new BrowserWindow({
    width: 300,
    height: 200,
    x: 900,
    y: 50,
    show: true,
    webPreferences: { sandbox: true },
  });
  await decoy.loadURL('data:text/html,<title>decoy</title><body>decoy (focused)');
  decoy.focus();
  conditions.unfocusedOtherWindow = await measureClock(probe, DURATION);
  decoy.destroy();

  // (iii) a fullscreen decoy covers the whole screen (including the probe's
  // position), simulating "a fullscreen app in front".
  const display = screen.getPrimaryDisplay();
  const decoy2 = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    show: true,
    webPreferences: { sandbox: true },
  });
  await decoy2.loadURL('data:text/html,<title>decoy-fullscreen</title><body style="background:black;color:white">fullscreen decoy');
  await new Promise((resolve) => {
    decoy2.once('enter-full-screen', resolve);
    decoy2.setFullScreen(true);
    setTimeout(resolve, 2000); // fallback if the event doesn't fire on this platform
  });
  decoy2.focus();
  conditions.fullscreenAppInFront = await measureClock(probe, DURATION);
  decoy2.setFullScreen(false);
  decoy2.destroy();

  probe.destroy();

  const verdict = {};
  for (const [name, r] of Object.entries(conditions)) {
    const pct = r.expectedTicks > 0 ? r.intervalTicks / r.expectedTicks : 0;
    verdict[name] = {
      intervalTickPct: Math.round(pct * 1000) / 10,
      intervalTicks: r.intervalTicks,
      expectedTicks: r.expectedTicks,
      timeoutTicks: r.timeoutTicks,
      cssAdvancing: cssAdvancing(r.cssSamples),
    };
  }
  return { item: 2, conditions, verdict };
}

// ---- item ③ — alpha compositing --------------------------------------------
async function runItem3() {
  const samplesPath = path.join(here, 'alpha-samples.json');
  if (!existsSync(samplesPath)) {
    throw new Error(
      `${samplesPath} missing — run: node scripts/spike/find-silhouette-samples.mjs`
    );
  }
  const samples = JSON.parse(await readFile(samplesPath, 'utf8'));

  debugAppend('item3: creating window');
  const win = createProdFlagsWindow();
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    debugAppend(`item3: did-fail-load code=${code} desc=${desc} url=${url}`);
  });
  win.webContents.on('console-message', (_e, level, message) => {
    debugAppend(`item3: page console[${level}] ${message}`);
  });
  debugAppend('item3: window created, loading URL');
  await win.loadURL('plugin://fixture/alpha.html');
  debugAppend('item3: URL loaded, showing');
  win.show();
  debugAppend('item3: shown, checking real image load via probe <img> (same-origin)');
  const probeSameOrigin = await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const img = new Image();
      const t = setTimeout(() => resolve({ ok: false, error: 'timeout' }), 4000);
      img.onload = () => { clearTimeout(t); resolve({ ok: true, w: img.naturalWidth, h: img.naturalHeight }); };
      img.onerror = () => { clearTimeout(t); resolve({ ok: false, error: 'onerror' }); };
      img.src = 'plugin://fixture/real-idle.png';
    })
  `);
  debugAppend(`item3: probe <img> (same-origin) result = ${JSON.stringify(probeSameOrigin)}`);
  // Cross-plugin-host negative check (the finding that explained the earlier
  // all-blank capture): a DIFFERENT plugin host is a different CSP origin,
  // img-src has no plugin: token, so 'self' does not cover it and this must
  // fail. Recorded, not asserted against — informational corroboration.
  const probeCrossOrigin = await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const img = new Image();
      const t = setTimeout(() => resolve({ ok: false, error: 'timeout' }), 4000);
      img.onload = () => { clearTimeout(t); resolve({ ok: true, w: img.naturalWidth, h: img.naturalHeight }); };
      img.onerror = () => { clearTimeout(t); resolve({ ok: false, error: 'onerror' }); };
      img.src = 'plugin://real/idle.png';
    })
  `);
  debugAppend(`item3: probe <img> (cross-plugin-host, expected blocked) result = ${JSON.stringify(probeCrossOrigin)}`);
  const stageInfo = await win.webContents.executeJavaScript(`
    (() => {
      const el = document.getElementById('stage');
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundImage, w: el.clientWidth, h: el.clientHeight, bodyBg: getComputedStyle(document.body).background };
    })()
  `);
  debugAppend(`item3: stage computed style = ${JSON.stringify(stageInfo)}`);
  debugAppend('item3: waiting for paint');
  // Let the compositor actually paint the background-image frame before capture.
  await new Promise((r) => setTimeout(r, 700));
  debugAppend('item3: wait done, calling capturePage');
  const image = await win.webContents.capturePage();
  debugAppend('item3: capturePage resolved, destroying window');
  win.destroy();
  debugAppend('item3: window destroyed');

  const pngBuf = image.toPNG(); // standard RGBA — sidesteps native-bitmap byte-order ambiguity
  debugAppend(`item3: toPNG done, ${pngBuf.length} bytes`);
  await mkdir(outDir, { recursive: true });
  const pngPath = path.join(outDir, 'item3-capture.png');
  await writeFile(pngPath, pngBuf);
  debugAppend('item3: png written');
  const decoded = PNG.sync.read(pngBuf);
  debugAppend(`item3: png decoded ${decoded.width}x${decoded.height}`);

  function pixelAt(x, y) {
    if (x < 0 || y < 0 || x >= decoded.width || y >= decoded.height) return null;
    const idx = (decoded.width * y + x) << 2;
    return {
      r: decoded.data[idx],
      g: decoded.data[idx + 1],
      b: decoded.data[idx + 2],
      a: decoded.data[idx + 3],
    };
  }
  const luma = (p) => (p ? (p.r + p.g + p.b) / 3 : null);

  const cornerPx = pixelAt(samples.corner.x, samples.corner.y);
  const bodyPx = pixelAt(samples.body.x, samples.body.y);
  const silhouetteResults = samples.silhouette.map((s) => {
    const self = pixelAt(s.x, s.y);
    const left = pixelAt(s.x - 1, s.y);
    const right = pixelAt(s.x + 1, s.y);
    const selfLuma = luma(self);
    const leftLuma = luma(left);
    const rightLuma = luma(right);
    const darkerThanBoth =
      selfLuma !== null &&
      leftLuma !== null &&
      rightLuma !== null &&
      selfLuma < leftLuma - 32 &&
      selfLuma < rightLuma - 32;
    return { x: s.x, y: s.y, self, left, right, darkerThanBoth };
  });

  const cornerPass = !!cornerPx && cornerPx.a === 0;
  const bodyPass = !!bodyPx && bodyPx.a === 255;
  const haloPixels = silhouetteResults.filter((s) => s.darkerThanBoth);
  const noHalo = haloPixels.length === 0;

  return {
    item: 3,
    capturedPngPath: pngPath,
    sameOriginImgProbe: probeSameOrigin,
    crossPluginHostImgProbe: probeCrossOrigin,
    corner: { requested: samples.corner, captured: cornerPx, pass: cornerPass },
    body: { requested: samples.body, captured: bodyPx, pass: bodyPass },
    silhouette: silhouetteResults,
    verdict: {
      cornerPass,
      bodyPass,
      noHalo,
      haloPixelCount: haloPixels.length,
      overallPass: cornerPass && bodyPass && noHalo,
    },
  };
}

function debugAppend(line) {
  try {
    const p = path.join(here, 'out', '_debug-boot.log');
    appendFileSync(p, `${new Date().toISOString()} ${line}\n`);
  } catch {
    // best effort
  }
}
process.on('uncaughtException', (err) => {
  debugAppend(`uncaughtException: ${err && err.stack}`);
  try {
    app.exit(2);
  } catch {
    process.exit(2);
  }
});
process.on('unhandledRejection', (err) => {
  debugAppend(`unhandledRejection: ${err && (err.stack || err)}`);
});

app.whenReady().then(async () => {
  debugAppend('whenReady fired');
  await mkdir(outDir, { recursive: true });
  await registerPluginProtocol();
  await registerAppProtocol();
  debugAppend('protocols registered');
  const csp = setupCsp();
  debugAppend('csp stamped');

  const results = { csp, items: {} };
  try {
    if (!only || only === '1') {
      debugAppend('starting item1');
      results.items['1'] = await runItem1();
      debugAppend('finished item1');
    }
    if (only === '1p') {
      debugAppend('starting item1p (production-origin re-probe)');
      results.items['1p'] = await runItem1ProductionOrigin();
      debugAppend('finished item1p');
    }
    if (!only || only === '2') {
      debugAppend('starting item2');
      results.items['2'] = await runItem2();
      debugAppend('finished item2');
    }
    if (!only || only === '3') {
      debugAppend('starting item3');
      results.items['3'] = await runItem3();
      debugAppend('finished item3');
    }
  } catch (err) {
    debugAppend(`item error: ${err && err.stack}`);
    results.error = { message: err.message, stack: err.stack };
  }

  const outFile = path.join(outDir, `spike-result-item${only || 'all'}.json`);
  await writeFile(outFile, JSON.stringify(results, null, 2));
  debugAppend(`wrote ${outFile}`);

  console.log(`RESULT_JSON: ${JSON.stringify(results)}`);
  console.log(`(also written to ${outFile})`);
  app.exit(results.error ? 1 : 0);
});
