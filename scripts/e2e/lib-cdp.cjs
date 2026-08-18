/**
 * scripts/e2e/lib-cdp.cjs — the shared raw-CDP helper for the Tier-C E2E
 * (task 8.2), an extension of the temp spike drivers (`pet2d-spike/cdp-eval.cjs`
 * et al.) now committed under the plugin repo per the task's "script under
 * scripts/e2e/" requirement.
 *
 * CDP HTTP on the app requires `Host: localhost` (fetch of 127.0.0.1 sends
 * it) AND the shell's HTTP(S)_PROXY unset — callers must run with proxies
 * off for localhost (the spike lesson; set NO_PROXY=127.0.0.1,localhost).
 *
 * Every exported helper throws on failure (the orchestrator treats a throw
 * as a step failure and records it in the evidence log).
 */
const { createRequire } = require('node:module');
const { readFileSync } = require('node:fs');
const os = require('node:os');
const { join } = require('node:path');
const req = createRequire('E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia-wt-pet/package.json');
const WebSocket = req('ws');

/**
 * Resolves the app's ACTUAL renderer CDP port. A force-killed dev run can
 * leave a ghost LISTEN entry on Windows (kernel keeps the bind until
 * reboot); the host probes netstat and silently walks to the next free
 * port, recording the picked ports in `%TMP%/elftia-dev-debug-ports.json`
 * (`packages/desktop/app/main/.../devDebugPorts.ts`). Probing the preferred
 * port directly is how the E2E briefly "lost" a perfectly healthy app
 * (2026-08-19) — always resolve the ACTUAL port.
 *
 * The ports file is SHARED machine-globally: the user's own dev app
 * rewrites it on every restart (observed live: our file suddenly carried
 * their pid + port 9334). So the E2E's own dev log is the authoritative
 * source for THIS app's port (`[dev-debug] renderer CDP port: N`); the
 * ports file is trusted ONLY when its pid is one of our marked processes.
 */
function resolveCdpPort(devLogPath, preferred = 9343) {
  if (devLogPath !== undefined) {
    try {
      const log = readFileSync(devLogPath, 'utf8');
      const matches = [...log.matchAll(/renderer CDP port: (\d+)/g)];
      const last = matches[matches.length - 1];
      if (last !== undefined) return Number(last[1]);
    } catch {
      /* log not readable yet — fall through */
    }
  }
  const file = join(os.tmpdir(), 'elftia-dev-debug-ports.json');
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (Number.isInteger(parsed.cdp) && parsed.cdp > 0 && Number.isInteger(parsed.pid)) {
      try {
        const { execFileSync } = require('node:child_process');
        const out = execFileSync('powershell', [
          '-NoProfile',
          '-Command',
          `(Get-CimInstance Win32_Process -Filter "ProcessId=${parsed.pid}").CommandLine`,
        ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        if (String(out).includes('pet2d-spike')) return parsed.cdp;
      } catch {
        /* pid gone or query failed — do not trust the file */
      }
    }
  } catch {
    /* absent or malformed — fall through to the preferred port */
  }
  return preferred;
}

/** Lists the app's CDP page targets: [{type, title, url, webSocketDebuggerUrl}]. */
async function listTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!res.ok) throw new Error(`/json/list -> HTTP ${res.status}`);
  return res.json();
}

/** Finds the page target whose URL contains `substring` (throws if absent). */
async function findTarget(port, substring) {
  const targets = await listTargets(port);
  const target = targets.find((t) => t.type === 'page' && t.url.includes(substring));
  if (target === undefined) {
    const seen = targets.map((t) => `${t.type}|${t.url}`).join('\n  ');
    throw new Error(`no page target matching "${substring}". targets:\n  ${seen}`);
  }
  return target;
}

/** Waits (poll) until a page target matching `substring` exists. */
async function waitForTarget(port, substring, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await findTarget(port, substring);
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await sleep(500);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Opens a CDP session to `target` and resolves a small send/receive helper. */
async function session(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 512 * 1024 * 1024 });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP ws open timeout')), 10000);
    ws.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
  let nextId = 0;
  const pending = new Map();
  ws.on('message', (m) => {
    const d = JSON.parse(String(m));
    const waiter = pending.get(d.id);
    if (waiter !== undefined) {
      pending.delete(d.id);
      waiter(d);
    }
  });
  // Socket close rejects everything still in flight (a wedged main loop
  // accepts TCP but never answers — close is how the caller learns).
  ws.on('close', () => {
    for (const [id, waiter] of pending) {
      pending.delete(id);
      waiter({ id, error: { message: 'CDP socket closed (target gone or wedged)' } });
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, (d) => {
        if (d.error !== undefined) reject(new Error(`${method}: ${JSON.stringify(d.error)}`));
        else resolve(d.result);
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const close = () => ws.close();
  return { send, close };
}

/**
 * Evaluates `expr` in the target (awaitPromise). Returns the JSON value;
 * throws with the remote exception description on evaluation errors, and
 * on timeout (closes the session — a wedged app must fail the step, not
 * hang the orchestrator).
 */
async function evalIn(target, expr, timeoutMs = 30000) {
  const s = await session(target);
  const timer = setTimeout(() => {
    s.close(); // rejects the in-flight send via the close handler
  }, timeoutMs);
  try {
    const result = await s.send('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails !== undefined) {
      const detail = result.exceptionDetails.exception?.description ??
        JSON.stringify(result.exceptionDetails);
      throw new Error(`eval exception: ${String(detail).slice(0, 1200)}`);
    }
    return result.result.value;
  } finally {
    clearTimeout(timer);
    s.close();
  }
}

/** Captures a screenshot of the target into `outPath` (PNG). */
async function screenshot(target, outPath) {
  const s = await session(target);
  try {
    await s.send('Page.enable');
    const shot = await s.send('Page.captureScreenshot', { format: 'png' });
    require('node:fs').writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
  } finally {
    s.close();
  }
}

/**
 * Dispatches a real (trusted) drag on the target: press at (x,y), move in
 * `steps` increments toward (x+dx, y+dy), hold, release. Used by the E2E's
 * state-change probe — `dragging` sense flag → `data-pet-state="drag"`.
 */
async function drag(target, x, y, dx, dy, steps = 8, holdMs = 400) {
  const s = await session(target);
  try {
    const move = (type, px, py, button = 'none', buttons = 0) =>
      s.send('Input.dispatchMouseEvent', { type, x: Math.round(px), y: Math.round(py), button, buttons, pointerType: 'mouse' });
    await move('mousePressed', x, y, 'left', 1);
    for (let i = 1; i <= steps; i += 1) {
      await move('mouseMoved', x + (dx * i) / steps, y + (dy * i) / steps, 'none', 1);
      await sleep(30);
    }
    await sleep(holdMs);
    await move('mouseReleased', x + dx, y + dy, 'left', 0);
  } finally {
    s.close();
  }
}

module.exports = {
  resolveCdpPort,
  listTargets,
  findTarget,
  waitForTarget,
  session,
  evalIn,
  screenshot,
  drag,
  sleep,
};
