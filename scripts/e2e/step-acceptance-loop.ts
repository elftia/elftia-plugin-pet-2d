/**
 * scripts/e2e/step-acceptance-loop.ts — task 8.2 addendum (LEAD ruling
 * 2026-08-19): the acceptance loop's authoring half driven at VERB level
 * over the real app bridge, dialog-free. Every verb below takes the
 * explicit-payload shape the dialog gesture would have supplied
 * (`packs:save` gets the picked dir + the studio's draft manifest;
 * `packs:export`/`packs:importFile` get explicit paths) — exactly the
 * decomposition the proposal's acceptance section recorded: "native-dialog
 * gestures themselves cannot be driven headless; every step around them
 * is, via the same ipc code path".
 *
 * The ONE seam therefore covered elsewhere (module level + one live
 * operator session): the folder-dialog gesture inside
 * `packs:pickSourceDir`. It is driven by verbs.test.ts (nativeDialog
 * fake), studio.test.ts (fake scoped ipc over the real draft model), and
 * was proven live by the operator's manual pick→offer→save on 2026-08-19
 * (which installed whale-girl through the real dialog for real).
 *
 * Loop: catalog the fixture dir (the offer's data source) → save (the
 * studio's exact payload shape, overwrite) → gallery card → select → pet
 * renders whale-girl → export .petpack → delete → gallery repair →
 * import back → select → pet renders whale-girl AGAIN. Screenshots at
 * each UI-visible step; timings + payload sizes logged like the D6 leg.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { FIXTURE_WHALE_GIRL_DIR } from '../../src/packs/__fixtures__/paths';
import { fromWhaleGirlManifest } from '../../src/packs/whaleGirlCompat';

/** The CDP driver's used surface (lib-cdp.cjs is plain CJS, untyped). */
interface CdpLib {
  resolveCdpPort(devLog: string): string;
  findTarget(port: string, substring: string): Promise<unknown>;
  waitForTarget(port: string, substring: string, timeoutMs: number): Promise<unknown>;
  evalIn(target: unknown, expr: string, timeout?: number): Promise<unknown>;
  screenshot(target: unknown, path: string): Promise<void>;
  sleep(ms: number): Promise<void>;
}

const lib: CdpLib = createRequire(import.meta.url)('./lib-cdp.cjs');

const EVIDENCE = 'E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia-wt-pet/.rasen/changes/desktop-pet-pack-authoring/evidence';
const DEV_LOG = process.env.PET2D_E2E_DEV_LOG ?? 'C:/Users/Sayo/AppData/Local/Temp/pet2d-spike/logs/e2e-dev-out7.txt';
const MAIN = 'localhost:5399/#';
const PET = 'pet.html';
const ASSETS_DIR = join(FIXTURE_WHALE_GIRL_DIR, 'lib', 'assets');
const CHARACTER_DIR = join(ASSETS_DIR, 'characters', 'whale-girl');
const EXPORT_PATH = 'C:/Users/Sayo/AppData/Local/Temp/pet2d-spike/loop.whale-girl.petpack';

const report: Array<{ leg: string; pass: boolean; detail: string }> = [];
let failures = 0;

function log(line: string): void {
  console.log(line);
  appendFileSync(join(EVIDENCE, 'e2e-log.txt'), `${new Date().toISOString()} ${line}\n`, 'utf8');
}

function record(leg: string, pass: boolean, detail: string): void {
  report.push({ leg, pass, detail });
  if (!pass) failures += 1;
  log(`${pass ? 'PASS' : 'FAIL'} [${leg}] ${detail}`);
}

async function shot(name: string, target: unknown): Promise<void> {
  await lib.screenshot(target, join(EVIDENCE, name));
  log(`SHOT ${name}`);
}

/**
 * The product's own same-window refresh channel (userPacks.ts
 * `notifyPacksChanged`): bump the rev key (other windows refetch via their
 * `storage` listener) + dispatch the in-window custom event (the writer's
 * window never receives its own `storage` event). The studio's save handler
 * calls exactly this; a verb-driven save must too, or the gallery's list
 * stays stale — the first loop run's four failures all traced here.
 */
async function notifyPacksChanged(target: unknown): Promise<void> {
  await lib.evalIn(
    target,
    `(() => {
      localStorage.setItem('elftia-pet-2d:packsRev:v1', String(Date.now()));
      window.dispatchEvent(new Event('pet-2d:packs-changed'));
      return 'NOTIFIED';
    })()`,
  );
}

/** One scoped-ipc verb invocation over the target window's real bridge. */
async function invoke(target: unknown, method: string, payload: unknown, timeout = 60000): Promise<unknown> {
  const r = await lib.evalIn(
    target,
    `(async () => {
      const pets = await window.native.plugins.listAppExtensionPets();
      const tok = (pets.find(p => p.id === 'pet-2d') ?? pets[0])?.capabilityToken;
      if (!tok) return { __noToken: true, n: pets.length };
      return window.native.plugins.invoke({ method: ${JSON.stringify(method)}, payload: ${JSON.stringify(payload)}, capabilityToken: tok });
    })()`,
    timeout,
  );
  return r;
}

/** The pet-window membership probe (run-e2e leg 3's renderProbe, reused). */
async function petRenderProbe(): Promise<{ bgIsSheet: boolean; states: number; state: string | null; manifestId: string | null }> {
  const petTarget = await lib.waitForTarget(await resolvePort(), PET, 30000);
  const r = await lib.evalIn(
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
        if (!tok) return { bgIsSheet: false, states: 0, state: null, manifestId: null };
        const loaded = await window.native.plugins.invoke({ method: 'packs:load', payload: { id: 'whale-girl' }, capabilityToken: tok });
        const urls = Object.values(loaded?.sheets ?? {}).map(s => s?.url);
        const sprite = document.querySelector('[data-pet-state]');
        const bg = sprite ? stripUrl(getComputedStyle(sprite).backgroundImage) : '';
        return { bgIsSheet: urls.includes(bg), states: urls.length, state: sprite?.getAttribute('data-pet-state') ?? null, manifestId: loaded?.manifest?.id ?? null };
      })();
    })()`,
    60000,
  );
  return r as { bgIsSheet: boolean; states: number; state: string | null; manifestId: string | null };
}

let cachedPort: string | undefined;
async function resolvePort(): Promise<string> {
  cachedPort ??= lib.resolveCdpPort(DEV_LOG);
  return cachedPort;
}

async function main(): Promise<void> {
  mkdirSync(EVIDENCE, { recursive: true });
  const port = await resolvePort();
  log(`=== acceptance-loop start (cdp=${port}) ===`);
  const mainTarget = await lib.findTarget(port, MAIN);

  const click = (expr: string) => `(async () => { const el = ${expr}; if (!el) return 'MISSING'; el.click(); return 'CLICKED'; })()`;

  // Normalize the manager to the gallery view (a prior run may have left it
  // inside the studio screen).
  await lib.evalIn(mainTarget, click(`document.querySelector('[data-testid="pet-manager-studio-back"]')`)).catch(() => undefined);

  // ── 1. catalog: the offer's data source, over the real bridge ─────────
  const catalog = (await invoke(mainTarget, 'packs:catalog', { dir: ASSETS_DIR.replace(/\//g, '\\') })) as {
    dir?: string;
    whaleGirl?: { manifest?: unknown; characters?: Array<{ id: string; dir: string; files: Array<{ name: string }> }> };
    files?: Array<{ name: string }>;
  };
  const wgChar = catalog?.whaleGirl?.characters?.find((c) => c.id === 'whale-girl');
  record(
    'loop-catalog',
    wgChar !== undefined && (wgChar.files?.length ?? 0) >= 15 && catalog.whaleGirl?.manifest !== undefined,
    `whaleGirl.manifest=${catalog?.whaleGirl?.manifest !== undefined} charFiles=${wgChar?.files?.length ?? 0} topLevelFiles=${catalog?.files?.length ?? -1}`,
  );

  // ── 2. save: the studio's exact payload (draft manifest + char dir) ───
  const manifestJson: unknown = JSON.parse(await readFile(join(ASSETS_DIR, 'manifest.json'), 'utf8'));
  const draft = fromWhaleGirlManifest(manifestJson, 'whale-girl');
  const t0 = Date.now();
  const saved = (await invoke(mainTarget, 'packs:save', {
    dir: CHARACTER_DIR.replace(/\//g, '\\'),
    manifest: draft,
    overwrite: true,
  })) as { ok?: boolean; id?: string; problems?: string[] };
  const saveMs = Date.now() - t0;
  record('loop-save', saved?.ok === true && saved?.id === 'whale-girl', `ok=${saved?.ok} id=${saved?.id} ms=${saveMs} problems=${JSON.stringify(saved?.problems ?? null)}`);

  // ── 3. gallery shows the saved pack ────────────────────────────────────
  await notifyPacksChanged(mainTarget);
  await lib.evalIn(mainTarget, click(`document.querySelector('[data-testid="sidebar-agent-page-pet-2d"]')`));
  await lib.sleep(1200);
  const gallery1 = await lib.evalIn(
    mainTarget,
    `(() => ({
      card: !!document.querySelector('[data-testid="pet-manager-pack-card-whale-girl"]'),
      chip: !!document.querySelector('[data-testid="pet-manager-pack-user-chip-whale-girl"]'),
    }))()`,
  );
  record('loop-gallery', (gallery1 as { card: boolean }).card === true, JSON.stringify(gallery1));
  await shot('e2e-08-loop-saved-gallery.png', mainTarget);

  // ── 4. select → the pet renders whale-girl ────────────────────────────
  await lib.evalIn(mainTarget, click(`document.querySelector('[data-testid="pet-manager-pack-card-whale-girl"]')`));
  await lib.sleep(3500); // prefs debounce + pet-window re-resolve
  const render1 = await petRenderProbe();
  record(
    'loop-render',
    render1.bgIsSheet === true && render1.states === 15 && render1.manifestId === 'whale-girl',
    JSON.stringify(render1),
  );
  await shot('e2e-09-loop-render.png', await lib.waitForTarget(port, PET, 30000));

  // ── 5. export → a real .petpack on disk ───────────────────────────────
  const exported = (await invoke(mainTarget, 'packs:export', { id: 'whale-girl', path: EXPORT_PATH })) as {
    ok?: boolean;
    path?: string;
  };
  const exportSize = await stat(EXPORT_PATH).then((s) => s.size, () => 0);
  record(
    'loop-export',
    exported?.ok === true && exportSize > 100_000,
    `ok=${exported?.ok} path=${exported?.path} bytes=${exportSize}`,
  );

  // ── 6. delete → list refresh drops the card + pet falls back ──────────
  // (ring-repair-on-delete is asserted by run-e2e leg 6's REAL card button;
  // this leg drives the verb, so it asserts the refetch, not the handler.)
  const deleted = (await invoke(mainTarget, 'packs:delete', { id: 'whale-girl' })) as { ok?: boolean };
  await notifyPacksChanged(mainTarget);
  await lib.evalIn(mainTarget, click(`document.querySelector('[data-testid="sidebar-agent-page-pet-2d"]')`));
  await lib.sleep(1000);
  const afterDelete = await lib.evalIn(
    mainTarget,
    `(() => ({
      gone: document.querySelector('[data-testid="pet-manager-pack-card-whale-girl"]') === null,
      defaultSelected: document.querySelector('[data-testid="pet-manager-pack-card-elf-blob"]')?.getAttribute('data-selected'),
    }))()`,
  );
  record(
    'loop-delete',
    deleted?.ok === true && (afterDelete as { gone: boolean }).gone === true,
    `ok=${deleted?.ok} ${JSON.stringify(afterDelete)}`,
  );
  await shot('e2e-10-loop-deleted.png', mainTarget);

  // ── 7. import the exported .petpack back ──────────────────────────────
  const imported = (await invoke(mainTarget, 'packs:importFile', { path: EXPORT_PATH, overwrite: true })) as {
    ok?: boolean;
    id?: string;
    problems?: string[];
  };
  await notifyPacksChanged(mainTarget);
  await lib.evalIn(mainTarget, click(`document.querySelector('[data-testid="sidebar-agent-page-pet-2d"]')`));
  await lib.sleep(1200);
  const gallery2 = await lib.evalIn(
    mainTarget,
    `!!document.querySelector('[data-testid="pet-manager-pack-card-whale-girl"]')`,
  );
  record(
    'loop-import',
    imported?.ok === true && imported?.id === 'whale-girl' && gallery2 === true,
    `ok=${imported?.ok} id=${imported?.id} cardBack=${gallery2} problems=${JSON.stringify(imported?.problems ?? null)}`,
  );
  await shot('e2e-11-loop-imported.png', mainTarget);

  // ── 8. select the imported pack → the pet renders it again ────────────
  await lib.evalIn(mainTarget, click(`document.querySelector('[data-testid="pet-manager-pack-card-whale-girl"]')`));
  await lib.sleep(3500);
  const render2 = await petRenderProbe();
  record(
    'loop-render2',
    render2.bgIsSheet === true && render2.states === 15 && render2.manifestId === 'whale-girl',
    JSON.stringify(render2),
  );
  await shot('e2e-12-loop-render2.png', await lib.waitForTarget(port, PET, 30000));

  appendFileSync(join(EVIDENCE, 'e2e-report-loop.json'), `${JSON.stringify({ legs: report.length, failures, report }, null, 2)}\n`, 'utf8');
  log(`=== acceptance-loop end: ${report.length - failures}/${report.length} legs passed ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  log(`FATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
});
