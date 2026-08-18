/**
 * packs-src/_authoring/pose-kit.mjs — the shared SVG pose-composition kit
 * (task 6.5): ONE parameterised vocabulary that both shipped packs render
 * through, so `tin-bot` is a variation pass over geometry + palette rather
 * than a second from-scratch effort, and a third-party pack author has a
 * worked example of "same poses, different character".
 *
 * The split of responsibilities:
 *   - THIS FILE owns the strip scaffolding (`viewBox="0 0 frames*256 256"`,
 *     one translated <g> per frame — the layout `scripts/lib/measureSheets.ts`
 *     measures and the D7 strip contract requires), the face primitives
 *     (eyes/mouth/blush), and the floating extras (zzz, sparkle, sweat, …).
 *   - EACH PACK'S GENERATOR owns the body: `renderPose(pose)` returning the
 *     character's SVG for one 256×256 frame, parameterised by its own
 *     geometry constants + palette.
 *
 * A `pose` is the neutral vocabulary shared by every character:
 *   { eye: 'open'|'closed'|'happy'|'wide'|'half'|'off',
 *     mouth: 'smile'|'bigSmile'|'flat'|'frown'|'open'|'o'|'wavy'|'none',
 *     dy, squash, tilt,            // body offsets (px / x-scale factor / deg)
 *     blush: boolean,
 *     extras: string[] }           // kit extra tokens, drawn at set anchors
 *
 * Frame 0 is ALWAYS the rest pose (D7 contract: "frame 0 is the rest pose");
 * generators order their pose arrays accordingly. Assets face LEFT (D7) —
 * the kit's primitives are symmetric; the pack's own asymmetries (feet,
 * antenna bend) decide leftness.
 */

import { join } from 'node:path';

export const FRAME_SIZE = 256;

/** The strip: N poses -> one horizontal strip of N 256×256 cells. */
export function stripSvg(poses, renderPose) {
  const cells = poses
    .map((pose, i) => `<g transform="translate(${i * FRAME_SIZE} 0)">${renderPose(pose)}</g>`)
    .join('');
  const width = poses.length * FRAME_SIZE;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${FRAME_SIZE}" ` +
    `width="${width}" height="${FRAME_SIZE}">${cells}</svg>`
  );
}

// ---------------------------------------------------------------------------
// Face primitives. `p` is the pack's palette; coordinates are frame-local.

export function eyes({ cx, cy, spacing, r, kind, p }) {
  const lx = cx - spacing;
  const rx = cx + spacing;
  switch (kind) {
    case 'open':
      return (
        `<circle cx="${lx}" cy="${cy}" r="${r}" fill="${p.eye}"/>` +
        `<circle cx="${rx}" cy="${cy}" r="${r}" fill="${p.eye}"/>`
      );
    case 'closed': // gentle downward arc — asleep or mid-blink
      return arc(lx, cy, r, 1, p.eye) + arc(rx, cy, r, 1, p.eye);
    case 'happy': // upward arc — squeezed-with-joy eyes
      return arc(lx, cy, r, -1, p.eye) + arc(rx, cy, r, -1, p.eye);
    case 'wide': // white sclera + small pupil — alarm
      return (
        `<circle cx="${lx}" cy="${cy}" r="${r + 2}" fill="${p.white}" stroke="${p.eye}" stroke-width="2"/>` +
        `<circle cx="${rx}" cy="${cy}" r="${r + 2}" fill="${p.white}" stroke="${p.eye}" stroke-width="2"/>` +
        `<circle cx="${lx}" cy="${cy}" r="${Math.max(1.5, r * 0.45)}" fill="${p.eye}"/>` +
        `<circle cx="${rx}" cy="${cy}" r="${Math.max(1.5, r * 0.45)}" fill="${p.eye}"/>`
      );
    case 'half': // drowsy lid — ellipse squashed vertically
      return (
        `<ellipse cx="${lx}" cy="${cy}" rx="${r}" ry="${r * 0.45}" fill="${p.eye}"/>` +
        `<ellipse cx="${rx}" cy="${cy}" rx="${r}" ry="${r * 0.45}" fill="${p.eye}"/>`
      );
    case 'off':
      return '';
    default:
      throw new Error(`pose-kit: unknown eye kind "${kind}"`);
  }
}

/** A single-eye curve. dir 1 = downward arc (closed), -1 = upward (happy). */
function arc(cx, cy, r, dir, fill) {
  const y = cy + dir * r * 0.4;
  return (
    `<path d="M ${cx - r} ${y} Q ${cx} ${y + dir * r * 1.2} ${cx + r} ${y}" ` +
    `fill="none" stroke="${fill}" stroke-width="${Math.max(2, r * 0.55)}" stroke-linecap="round"/>`
  );
}

export function mouth({ cx, cy, w, kind, p }) {
  switch (kind) {
    case 'smile':
      return (
        `<path d="M ${cx - w} ${cy} Q ${cx} ${cy + w * 0.9} ${cx + w} ${cy}" ` +
        `fill="none" stroke="${p.mouth}" stroke-width="4" stroke-linecap="round"/>`
      );
    case 'bigSmile': // open happy mouth
      return (
        `<path d="M ${cx - w} ${cy - 2} Q ${cx} ${cy + w * 1.3} ${cx + w} ${cy - 2} Z" ` +
        `fill="${p.mouth}"/>` +
        `<path d="M ${cx - w * 0.4} ${cy} Q ${cx} ${cy + w * 0.4} ${cx + w * 0.4} ${cy}" fill="${p.white}" opacity="0.7"/>`
      );
    case 'flat':
      return (
        `<path d="M ${cx - w} ${cy} L ${cx + w} ${cy}" fill="none" stroke="${p.mouth}" ` +
        `stroke-width="4" stroke-linecap="round"/>`
      );
    case 'frown':
      return (
        `<path d="M ${cx - w} ${cy + 3} Q ${cx} ${cy - w * 0.7} ${cx + w} ${cy + 3}" ` +
        `fill="none" stroke="${p.mouth}" stroke-width="4" stroke-linecap="round"/>`
      );
    case 'open': // mid-bite / mid-word
      return `<ellipse cx="${cx}" cy="${cy}" rx="${w * 0.7}" ry="${w * 0.9}" fill="${p.mouth}"/>`;
    case 'o': // small surprised o
      return `<circle cx="${cx}" cy="${cy}" r="${w * 0.5}" fill="${p.mouth}"/>`;
    case 'wavy': // uneasy
      return (
        `<path d="M ${cx - w} ${cy} q ${w * 0.33} -5 ${w * 0.5} 0 t ${w * 0.5} 0 t ${w * 0.5} 0 t ${w * 0.5} 0" ` +
        `fill="none" stroke="${p.mouth}" stroke-width="3.5" stroke-linecap="round"/>`
      );
    case 'none':
      return '';
    default:
      throw new Error(`pose-kit: unknown mouth kind "${kind}"`);
  }
}

export function blushPair({ cx, cy, spacing, p }) {
  const rx = Math.max(6, spacing * 0.42);
  return (
    `<ellipse cx="${cx - spacing - 4}" cy="${cy}" rx="${rx}" ry="${rx * 0.55}" fill="${p.blush}" opacity="0.75"/>` +
    `<ellipse cx="${cx + spacing + 4}" cy="${cy}" rx="${rx}" ry="${rx * 0.55}" fill="${p.blush}" opacity="0.75"/>`
  );
}

// ---------------------------------------------------------------------------
// Floating extras — the "what is happening" glyphs around the character.
// Anchors sit in the upper-right / left of the 256×256 frame by convention.

export function extra(kind, p) {
  switch (kind) {
    case 'zzz': // two stacked z glyphs, pure lines
      return (
        `<g stroke="${p.extra}" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
        `<path d="M 186 52 h 16 l -16 14 h 16"/>` +
        `<path d="M 208 30 h 11 l -11 10 h 11"/></g>`
      );
    case 'sparkle':
      return (
        `<g fill="${p.extra}">` +
        `<path d="M 196 40 l 3.5 9 9 3.5 -9 3.5 -3.5 9 -3.5 -9 -9 -3.5 9 -3.5 Z"/>` +
        `<path d="M 218 62 l 2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 Z"/></g>`
      );
    case 'sweat':
      return (
        `<path d="M 200 44 q 8 12 0 17 q -8 -5 0 -17 Z" fill="${p.sweat ?? '#7ec3ea'}"/>`
      );
    case 'question':
      return (
        `<text x="196" y="58" font-family="sans-serif" font-size="30" font-weight="bold" ` +
        `fill="${p.extra}">?</text>`
      );
    case 'note':
      return (
        `<g fill="${p.extra}"><ellipse cx="198" cy="56" rx="5" ry="4"/>` +
        `<rect x="201" y="34" width="3" height="22"/></g>`
      );
    case 'exclaim': // pure shapes — no font dependency
      return (
        `<g fill="${p.extra}"><rect x="196" y="32" width="7" height="18" rx="3.5"/>` +
        `<circle cx="199.5" cy="58" r="4"/></g>`
      );
    case 'star':
      return `<path d="${starPath(200, 44, 14, 6)}" fill="${p.extra}"/>`;
    case 'heart':
      return (
        `<path d="M 198 58 c -8 -8 -16 2 -8 9 l 8 7 8 -7 c 8 -7 0 -17 -8 -9 Z" fill="${p.extra}"/>`
      );
    case 'dots': // "working…" indicator
      return (
        `<g fill="${p.extra}">` +
        `<circle cx="192" cy="46" r="3.5"/><circle cx="203" cy="46" r="3.5"/><circle cx="214" cy="46" r="3.5"/></g>`
      );
    case 'crumbs':
      return (
        `<g fill="${p.extra}">` +
        `<circle cx="88" cy="196" r="3"/><circle cx="98" cy="202" r="2.4"/><circle cx="166" cy="199" r="2.8"/></g>`
      );
    default:
      throw new Error(`pose-kit: unknown extra "${kind}"`);
  }
}

/** 5-pointed star path centred at (cx,cy), outer r0, inner r1. */
function starPath(cx, cy, r0, r1) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? r0 : r1;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return `M ${pts.join(' L ')} Z`;
}

/** Compose a frame: the pack's body art plus kit face/extras. */
export function composeFrame({ body, face, extras }) {
  return body + (face ?? '') + (extras ?? '');
}

// ---------------------------------------------------------------------------
// The per-state slot spec both shipped packs use — deliberately IDENTICAL to
// whale-girl's own numbers (verified against its real manifest): the same
// vocabulary, playback variety (blink/pingpong/once/loop), the three
// motion-on-single-frame states (drag/tilt, think/float, wait/wiggle) and
// the one motion-on-multi-frame exception (error/shake) all get exercised in
// the artifact users actually receive.
export const STATE_SPECS = {
  idle: { frames: 3, fps: 2, playback: 'blink' },
  working: { frames: 3, fps: 3, playback: 'loop' },
  celebrate: { frames: 3, fps: 4, playback: 'loop' },
  error: { frames: 2, fps: 8, playback: 'once', motion: 'shake' },
  disappointed: { frames: 2, fps: 2, playback: 'loop' },
  joy: { frames: 2, fps: 5, playback: 'loop' },
  eat: { frames: 3, fps: 8, playback: 'loop' },
  play: { frames: 3, fps: 4, playback: 'loop' },
  drag: { frames: 1, fps: 5, playback: 'loop', motion: 'tilt' },
  walk: { frames: 3, fps: 6, playback: 'pingpong' },
  sleep: { frames: 2, fps: 1, playback: 'loop' },
  wake: { frames: 2, fps: 3, playback: 'once' },
  welcome: { frames: 2, fps: 3, playback: 'loop' },
  think: { frames: 1, fps: 2, playback: 'loop', motion: 'float' },
  wait: { frames: 1, fps: 2, playback: 'loop', motion: 'wiggle' },
};

/**
 * Writes one pack: `packs-src/<id>/sheets/<state>.svg` + `pack.json`.
 * Called by each pack's generator; deterministic output (no randomness),
 * so re-running a generator reproduces byte-identical files.
 */
export async function writePackFiles(packDir, meta, posesByState, stripFor) {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const sheetsDir = join(packDir, 'sheets');
  await mkdir(sheetsDir, { recursive: true });

  const states = {};
  for (const [state, spec] of Object.entries(STATE_SPECS)) {
    const poses = posesByState[state];
    if (!poses || poses.length !== spec.frames) {
      throw new Error(
        `${meta.id}: state "${state}" needs exactly ${spec.frames} pose(s) (STATE_SPECS), got ${poses?.length ?? 0}`
      );
    }
    await writeFile(join(sheetsDir, `${state}.svg`), stripSvg(poses, stripFor), 'utf8');
    states[state] = { sheet: `${state}.svg`, ...spec };
  }

  const manifest = { apiVersion: 1, id: meta.id, name: meta.name, credit: meta.credit, license: meta.license, meta: { frameSize: FRAME_SIZE, stageScale: meta.stageScale }, states };
  await writeFile(join(packDir, 'pack.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}
