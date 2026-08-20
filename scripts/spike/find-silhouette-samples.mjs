/**
 * Dev-only, Node-side (NOT Electron) helper for spike item ③. Decodes the
 * REAL whale-girl `idle.png` (frame 0, the leftmost 256x256 cell) with
 * `pngjs` — a declared devDependency, used here only in
 * `scripts/` tooling, never imported by `src/` (D14's zero-runtime-deps rule
 * applies to the shipped plugin, not dev scripts) — and picks:
 *   - a fully-transparent corner pixel (alpha === 0)
 *   - a fully-opaque body pixel near the character's center (alpha === 255)
 *   - 8 "silhouette" pixels: partial-alpha (anti-aliased edge) pixels, each
 *     with its two horizontal neighbours, for the item-③ black-halo check
 *
 * Writes `alpha-samples.json` next to this script. The Electron harness
 * (`pet-surface-spike.mjs --only=3`) reads that file so it never needs a PNG
 * decoder itself — it only samples the coordinates named here out of its own
 * `capturePage()` bitmap.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PNG } from 'pngjs';

const here = path.dirname(fileURLToPath(import.meta.url));

const IDLE_PNG = path.resolve(
  here,
  '../../../../_others/whale-girl/lib/assets/characters/whale-girl/idle.png'
);

const buf = readFileSync(IDLE_PNG);
const png = PNG.sync.read(buf);
const FRAME = 256;
if (png.height !== FRAME) throw new Error(`expected height 256, got ${png.height}`);

function alphaAt(x, y) {
  const idx = (png.width * y + x) << 2;
  return png.data[idx + 3];
}
function pixelAt(x, y) {
  const idx = (png.width * y + x) << 2;
  return { r: png.data[idx], g: png.data[idx + 1], b: png.data[idx + 2], a: png.data[idx + 3] };
}

// Corner: try (0,0), fall back to scanning frame-0 corners for alpha===0.
const corners = [
  [0, 0],
  [FRAME - 1, 0],
  [0, FRAME - 1],
  [FRAME - 1, FRAME - 1],
];
let corner = corners.find(([x, y]) => alphaAt(x, y) === 0);
if (!corner) {
  // No perfectly-transparent corner in this asset — record the closest and
  // note it; this is evidence, not an assumption.
  corner = corners.reduce((best, c) =>
    alphaAt(...c) < alphaAt(...best) ? c : best
  );
}

// Body: scan a center box for a run of alpha===255 pixels, take the middle one.
let body = null;
const cx = FRAME >> 1;
const cy = FRAME >> 1;
outer: for (let ring = 0; ring < 100; ring++) {
  for (let dy = -ring; dy <= ring; dy++) {
    for (let dx = -ring; dx <= ring; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= FRAME || y >= FRAME) continue;
      if (alphaAt(x, y) === 255) {
        body = [x, y];
        break outer;
      }
    }
  }
}
if (!body) throw new Error('no fully-opaque pixel found near center of frame 0');

// Silhouette: scan the whole frame for partial-alpha pixels (anti-aliased
// edge), collect candidates whose BOTH horizontal neighbours exist within the
// frame, spread the picks across distinct rows so they sample different parts
// of the outline rather than one local cluster.
const candidates = [];
for (let y = 0; y < FRAME; y++) {
  for (let x = 1; x < FRAME - 1; x++) {
    const a = alphaAt(x, y);
    if (a > 8 && a < 247) {
      candidates.push({ x, y, a });
    }
  }
}
if (candidates.length < 8) {
  throw new Error(`only found ${candidates.length} partial-alpha pixels, need >= 8`);
}
// Spread picks: bucket by row, take up to 1 per bucket across 8 buckets.
candidates.sort((p, q) => p.y - q.y);
const minY = candidates[0].y;
const maxY = candidates[candidates.length - 1].y;
const bucketCount = 8;
const bucketHeight = Math.max(1, (maxY - minY + 1) / bucketCount);
const picked = [];
for (let b = 0; b < bucketCount; b++) {
  const lo = minY + b * bucketHeight;
  const hi = minY + (b + 1) * bucketHeight;
  const inBucket = candidates.filter((p) => p.y >= lo && p.y < hi);
  if (inBucket.length > 0) {
    picked.push(inBucket[Math.floor(inBucket.length / 2)]);
  }
}
// Top up if some buckets were empty.
for (const c of candidates) {
  if (picked.length >= 8) break;
  if (!picked.includes(c)) picked.push(c);
}
const silhouette = picked.slice(0, 8).map(({ x, y, a }) => {
  const left = pixelAt(x - 1, y);
  const right = pixelAt(x + 1, y);
  const self = pixelAt(x, y);
  return { x, y, alpha: a, self, leftNeighbour: left, rightNeighbour: right };
});

const out = {
  source: IDLE_PNG,
  frameSize: FRAME,
  corner: { x: corner[0], y: corner[1], alpha: alphaAt(...corner) },
  body: { x: body[0], y: body[1], alpha: alphaAt(...body) },
  silhouette,
};

writeFileSync(path.join(here, 'alpha-samples.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`alpha-samples.json written: corner=(${corner}) alpha=${alphaAt(...corner)}, body=(${body}) alpha=${alphaAt(...body)}, silhouette=${silhouette.length} pts`);
