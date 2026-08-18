/**
 * packs-src/_authoring/gen-elf-blob.mjs — generates the `elf-blob` pack
 * (task 6.5): a round mint blob with a leaf sprout, drawn through the shared
 * pose kit. Regenerate with:
 *
 *   node packs-src/_authoring/gen-elf-blob.mjs
 *
 * (deterministic — no randomness; output is committed and the generator is
 * the source of truth for tweaks, not hand-edits to the .svg files).
 *
 * Silhouette contract (D9): deliberately ROUND — the alpha hit-test gets a
 * genuinely different mask shape from `tin-bot`'s angular chassis.
 */
import { fileURLToPath } from 'node:url';

import { blushPair, composeFrame, extra, eyes, mouth, writePackFiles } from './pose-kit.mjs';

const PACK_DIR = fileURLToPath(new URL('../elf-blob', import.meta.url));

// Palette + geometry: everything a variation pass would change.
const P = {
  body: '#9adcb0',
  bodyDark: '#6cbf8b',
  belly: '#c9f0d6',
  outline: '#2f6b4f',
  eye: '#1f2933',
  mouth: '#1f2933',
  blush: '#f2a6b3',
  white: '#ffffff',
  extra: '#3f8f68',
  sweat: '#7ec3ea',
};
const CX = 128;
const BODY_CY = 148;
const BODY_RX = 66;
const BODY_RY = 58;
const GROUND = 204; // squash/tilt anchor: the ground line

/**
 * The blob's body for one frame: squash/tilt anchored at the ground line,
 * optional `feet` swing (-1|0|1) for walk, and the top-left leaf sprout
 * (the character's leftward asymmetry — assets face LEFT, D7).
 */
function blobBody(pose) {
  const { dy = 0, squash = 1, tilt = 0, feet = 0 } = pose;
  const sx = 1 + (squash - 1) * 0.55; // flattening widens less than it shortens
  const cy = BODY_CY + dy;
  const transform =
    tilt === 0 && squash === 1
      ? ''
      : ` transform="translate(${CX} ${GROUND}) rotate(${tilt}) scale(${sx.toFixed(3)} ${squash.toFixed(3)}) translate(${-CX} ${-GROUND})"`;

  const footDx = feet * 7;
  return (
    `<g${transform}>` +
    // feet (slightly ahead on the left — the facing cue)
    `<rect x="${92 + footDx}" y="${GROUND - 8}" width="26" height="14" rx="7" fill="${P.bodyDark}"/>` +
    `<rect x="${138 + footDx}" y="${GROUND - 8}" width="26" height="14" rx="7" fill="${P.bodyDark}"/>` +
    // body
    `<ellipse cx="${CX}" cy="${cy}" rx="${BODY_RX}" ry="${BODY_RY}" fill="${P.body}" stroke="${P.outline}" stroke-width="3"/>` +
    `<ellipse cx="${CX - 10}" cy="${cy + 16}" rx="${BODY_RX * 0.62}" ry="${BODY_RY * 0.5}" fill="${P.belly}" opacity="0.8"/>` +
    // leaf sprout, top-left
    `<path d="M ${CX - 4} ${cy - BODY_RY + 2} q -4 -10 -12 -13" fill="none" stroke="${P.outline}" stroke-width="3" stroke-linecap="round"/>` +
    `<ellipse cx="${CX - 19}" cy="${cy - BODY_RY - 9}" rx="10" ry="6" fill="${P.bodyDark}" transform="rotate(-28 ${CX - 19} ${cy - BODY_RY - 9})"/>` +
    `</g>`
  );
}

/** elf-blob's renderer: kit face + kit extras over the blob body. */
function renderElfBlob(pose) {
  const faceCy = BODY_CY + (pose.dy ?? 0) - 8;
  const face =
    eyes({ cx: CX, cy: faceCy, spacing: 23, r: 7.5, kind: pose.eye, p: P }) +
    mouth({ cx: CX, cy: faceCy + 20, w: 12, kind: pose.mouth, p: P }) +
    (pose.blush ? blushPair({ cx: CX, cy: faceCy + 10, spacing: 23, p: P }) : '');
  const extras = (pose.extras ?? []).map((token) => extra(token, P)).join('');
  return composeFrame({ body: blobBody(pose), face, extras });
}

// The 15 states. Frame 0 is ALWAYS the rest pose (D7).
const POSES = {
  idle: [
    { eye: 'open', mouth: 'smile' },
    { eye: 'closed', mouth: 'smile' },
    { eye: 'half', mouth: 'smile' },
  ],
  working: [
    { eye: 'open', mouth: 'flat', extras: ['dots'] },
    { eye: 'open', mouth: 'flat', tilt: 2, extras: ['dots'] },
    { eye: 'half', mouth: 'flat', tilt: -2, extras: ['dots'] },
  ],
  celebrate: [
    { eye: 'happy', mouth: 'bigSmile', dy: -4, extras: ['star'] },
    { eye: 'happy', mouth: 'bigSmile', dy: -9, squash: 1.05, extras: ['sparkle'] },
    { eye: 'happy', mouth: 'bigSmile', dy: -4, extras: ['star'] },
  ],
  error: [
    { eye: 'wide', mouth: 'wavy', extras: ['sweat', 'exclaim'] },
    { eye: 'wide', mouth: 'wavy', tilt: 3, extras: ['sweat', 'exclaim'] },
  ],
  disappointed: [
    { eye: 'half', mouth: 'frown', dy: 3, squash: 1.05 },
    { eye: 'half', mouth: 'frown', dy: 5, squash: 1.08 },
  ],
  joy: [
    { eye: 'happy', mouth: 'bigSmile', blush: true, dy: -3, extras: ['sparkle'] },
    { eye: 'happy', mouth: 'bigSmile', blush: true, dy: -6, squash: 1.04, extras: ['heart'] },
  ],
  eat: [
    { eye: 'open', mouth: 'open', blush: true },
    { eye: 'closed', mouth: 'open', blush: true },
    { eye: 'open', mouth: 'o', blush: true, extras: ['crumbs'] },
  ],
  play: [
    { eye: 'happy', mouth: 'bigSmile', tilt: -4, extras: ['star'] },
    { eye: 'open', mouth: 'smile', tilt: 4 },
    { eye: 'happy', mouth: 'bigSmile', tilt: -4, extras: ['star'] },
  ],
  drag: [{ eye: 'wide', mouth: 'o', dy: 2, squash: 1.04 }],
  walk: [
    { eye: 'open', mouth: 'flat', feet: -1, dy: -2 },
    { eye: 'open', mouth: 'flat', feet: 0, dy: 0 },
    { eye: 'open', mouth: 'flat', feet: 1, dy: -2 },
  ],
  sleep: [
    { eye: 'closed', mouth: 'flat', dy: 2, squash: 1.04, extras: ['zzz'] },
    { eye: 'closed', mouth: 'flat', dy: 4, squash: 1.07, extras: ['zzz'] },
  ],
  wake: [
    { eye: 'closed', mouth: 'flat', dy: 3, squash: 1.05 },
    { eye: 'half', mouth: 'smile', dy: 0 },
  ],
  welcome: [
    { eye: 'open', mouth: 'smile', extras: ['note'] },
    { eye: 'happy', mouth: 'bigSmile', blush: true, dy: -3, extras: ['note'] },
  ],
  think: [{ eye: 'half', mouth: 'flat', tilt: 2, extras: ['question'] }],
  wait: [{ eye: 'open', mouth: 'flat', extras: ['dots'] }],
};

const manifest = await writePackFiles(
  PACK_DIR,
  { id: 'elf-blob', name: 'Elf Blob', credit: 'ATELIER AI', license: 'CC0-1.0', stageScale: 1 },
  POSES,
  renderElfBlob
);
console.log(`elf-blob: wrote 15 sheets + pack.json -> ${PACK_DIR}`);
console.log(`  (id=${manifest.id}, stageScale=${manifest.meta.stageScale})`);
