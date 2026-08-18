/**
 * packs-src/_authoring/gen-tin-bot.mjs — generates the `tin-bot` pack
 * (task 6.5): an angular tin robot (octagonal chassis, LED-bar eyes,
 * segmented mouth, antenna, treads) drawn through the shared pose kit.
 * Regenerate with:
 *
 *   node packs-src/_authoring/gen-tin-bot.mjs
 *
 * Silhouette contract (D9): deliberately ANGULAR — the alpha hit-test gets a
 * genuinely different mask from `elf-blob`'s round body (hard corners, thin
 * antenna, tread bar), not a recolor of the same outline.
 */
import { fileURLToPath } from 'node:url';

import { composeFrame, extra, writePackFiles } from './pose-kit.mjs';

const PACK_DIR = fileURLToPath(new URL('../tin-bot', import.meta.url));

const P = {
  chassis: '#8ea4b8',
  chassisDark: '#37424e',
  chassisLight: '#b9c8d6',
  outline: '#1d232b',
  led: '#57e389',
  ledDim: '#2c6e4a',
  ledWarm: '#ffd166',
  eye: '#1f2933',
  mouth: '#1f2933',
  blush: '#f2a6b3',
  white: '#ffffff',
  extra: '#4a77a8',
  sweat: '#7ec3ea',
};
const CX = 128;
const GROUND = 204;
const FACE_CY = 136;

/** The chassis: an octagonal shield, LED eyes, segmented mouth, antenna, treads. */
function botBody(pose) {
  const { dy = 0, tilt = 0, antenna = 0, tread = 0 } = pose;
  const cy = dy;
  const ax = CX - 6 + antenna * 8; // antenna tip (bends LEFT — assets face left, D7)

  return (
    `<g transform="translate(${CX} ${GROUND}) rotate(${tilt}) translate(${-CX} ${-GROUND}) translate(0 ${cy})">` +
    // antenna
    `<line x1="${CX}" y1="94" x2="${ax}" y2="66" stroke="${P.outline}" stroke-width="3" stroke-linecap="round"/>` +
    `<circle cx="${ax}" cy="62" r="5" fill="${P.ledWarm}" stroke="${P.outline}" stroke-width="2"/>` +
    // chassis (octagon — no curves anywhere in the silhouette)
    `<path d="M 76 116 L 100 92 L 156 92 L 180 116 L 180 178 L 156 202 L 100 202 L 76 178 Z" ` +
    `fill="${P.chassis}" stroke="${P.outline}" stroke-width="3"/>` +
    // side rivets + chest plate
    `<rect x="104" y="166" width="48" height="22" fill="${P.chassisDark}"/>` +
    `<rect x="112" y="172" width="8" height="10" fill="${P.led}"/>` +
    `<rect x="126" y="172" width="8" height="10" fill="${P.ledDim}"/>` +
    `<rect x="140" y="172" width="8" height="10" fill="${P.ledDim}"/>` +
    // treads (notches shift with `tread` for the walk cycle)
    `<rect x="82" y="202" width="92" height="16" fill="${P.chassisDark}"/>` +
    `<g fill="${P.chassisLight}">` +
    `<rect x="${88 + tread * 8}" y="206" width="10" height="8"/>` +
    `<rect x="${118 + tread * 8}" y="206" width="10" height="8"/>` +
    `<rect x="${148 + tread * 8}" y="206" width="10" height="8"/></g>` +
    `</g>`
  );
}

/**
 * The bot's face: LED bar eyes + segmented mouth. Uses the kit's pose
 * vocabulary but its own ANGULAR rendering (round eyes would fight the
 * silhouette contract); blush renders as two warm LED squares.
 */
function botFace(pose) {
  const ey = FACE_CY + (pose.dy ?? 0);
  const lx = CX - 22;
  const rx = CX + 22;
  let eyeSvg = '';
  switch (pose.eye) {
    case 'open':
      eyeSvg = ledSquare(lx, ey, 13) + ledSquare(rx, ey, 13);
      break;
    case 'closed': // powered-down: dark sockets
      eyeSvg =
        `<rect x="${lx - 6}" y="${ey - 6}" width="13" height="13" fill="${P.chassisDark}"/>` +
        `<rect x="${rx - 6}" y="${ey - 6}" width="13" height="13" fill="${P.chassisDark}"/>`;
      break;
    case 'happy': // V-shaped LED strips
      eyeSvg =
        `<rect x="${lx - 8}" y="${ey}" width="17" height="5" fill="${P.led}" transform="rotate(-18 ${lx} ${ey})"/>` +
        `<rect x="${rx - 8}" y="${ey}" width="17" height="5" fill="${P.led}" transform="rotate(18 ${rx} ${ey})"/>`;
      break;
    case 'wide': // bright + halo
      eyeSvg =
        ledSquare(lx, ey, 17, true) + ledSquare(rx, ey, 17, true);
      break;
    case 'half': // thin standby strip
      eyeSvg =
        `<rect x="${lx - 9}" y="${ey - 2}" width="18" height="4" fill="${P.ledDim}"/>` +
        `<rect x="${rx - 9}" y="${ey - 2}" width="18" height="4" fill="${P.ledDim}"/>`;
      break;
    default:
      eyeSvg = '';
  }

  const my = ey + 24;
  const seg = (x, rot = 0) =>
    `<rect x="${x}" y="${my}" width="9" height="5" fill="${P.chassisDark}"${rot ? ` transform="rotate(${rot} ${x + 4} ${my + 2})"` : ''}/>`;
  let mouthSvg = '';
  switch (pose.mouth) {
    case 'smile':
      mouthSvg = seg(CX - 16, -25) + seg(CX - 5) + seg(CX + 6) + seg(CX + 17, 25);
      break;
    case 'bigSmile': // all segments lit warm
      mouthSvg =
        `<rect x="${CX - 16}" y="${my - 2}" width="42" height="9" fill="${P.ledWarm}" opacity="0.9"/>` +
        seg(CX - 16, -25) + seg(CX - 5) + seg(CX + 6) + seg(CX + 17, 25);
      break;
    case 'flat':
      mouthSvg = seg(CX - 16) + seg(CX - 5) + seg(CX + 6) + seg(CX + 17);
      break;
    case 'frown':
      mouthSvg = seg(CX - 16, 25) + seg(CX - 5) + seg(CX + 6) + seg(CX + 17, -25);
      break;
    case 'open': // speaker grille opens
      mouthSvg =
        `<rect x="${CX - 18}" y="${my - 4}" width="36" height="12" fill="${P.outline}"/>` +
        `<rect x="${CX - 14}" y="${my - 1}" width="6" height="6" fill="${P.ledWarm}"/>` +
        `<rect x="${CX - 3}" y="${my - 1}" width="6" height="6" fill="${P.ledWarm}"/>` +
        `<rect x="${CX + 8}" y="${my - 1}" width="6" height="6" fill="${P.ledWarm}"/>`;
      break;
    case 'o':
      mouthSvg = `<rect x="${CX - 7}" y="${my - 3}" width="14" height="11" fill="${P.outline}"/>`;
      break;
    case 'wavy':
      mouthSvg = seg(CX - 16, 20) + seg(CX - 5, -20) + seg(CX + 6, 20) + seg(CX + 17, -20);
      break;
    default:
      mouthSvg = '';
  }

  const blushSvg = pose.blush
    ? `<rect x="${lx - 12}" y="${ey + 14}" width="12" height="6" fill="${P.blush}" opacity="0.8"/>` +
      `<rect x="${rx + 1}" y="${ey + 14}" width="12" height="6" fill="${P.blush}" opacity="0.8"/>`
    : '';

  return eyeSvg + mouthSvg + blushSvg;
}

function ledSquare(cx, cy, size, halo = false) {
  const half = size / 2;
  return (
    (halo ? `<rect x="${cx - half - 3}" y="${cy - half - 3}" width="${size + 6}" height="${size + 6}" fill="${P.led}" opacity="0.35"/>` : '') +
    `<rect x="${cx - half}" y="${cy - half}" width="${size}" height="${size}" fill="${P.led}" stroke="${P.outline}" stroke-width="2"/>`
  );
}

function renderTinBot(pose) {
  const extras = (pose.extras ?? []).map((token) => extra(token, P)).join('');
  return composeFrame({ body: botBody(pose), face: botFace(pose), extras });
}

// The 15 states. Frame 0 is ALWAYS the rest pose (D7).
const POSES = {
  idle: [
    { eye: 'open', mouth: 'flat' },
    { eye: 'closed', mouth: 'flat' },
    { eye: 'half', mouth: 'flat' },
  ],
  working: [
    { eye: 'open', mouth: 'flat', extras: ['dots'] },
    { eye: 'open', mouth: 'flat', tilt: 1, antenna: 1, extras: ['dots'] },
    { eye: 'half', mouth: 'flat', tilt: -1, extras: ['dots'] },
  ],
  celebrate: [
    { eye: 'happy', mouth: 'bigSmile', dy: -4, antenna: -1, extras: ['star'] },
    { eye: 'happy', mouth: 'bigSmile', dy: -8, antenna: 1, extras: ['sparkle'] },
    { eye: 'happy', mouth: 'bigSmile', dy: -4, antenna: -1, extras: ['star'] },
  ],
  error: [
    { eye: 'wide', mouth: 'wavy', extras: ['sweat', 'exclaim'] },
    { eye: 'wide', mouth: 'wavy', tilt: 3, antenna: 1, extras: ['sweat', 'exclaim'] },
  ],
  disappointed: [
    { eye: 'half', mouth: 'frown', dy: 3, antenna: -1 },
    { eye: 'half', mouth: 'frown', dy: 5, antenna: -1, tilt: 1 },
  ],
  joy: [
    { eye: 'happy', mouth: 'bigSmile', dy: -3, antenna: 1, extras: ['sparkle'] },
    { eye: 'happy', mouth: 'bigSmile', dy: -6, antenna: -1, extras: ['heart'] },
  ],
  eat: [
    { eye: 'open', mouth: 'open' },
    { eye: 'closed', mouth: 'open' },
    { eye: 'open', mouth: 'o', extras: ['crumbs'] },
  ],
  play: [
    { eye: 'happy', mouth: 'bigSmile', tilt: -4, antenna: 1, extras: ['star'] },
    { eye: 'open', mouth: 'smile', tilt: 4 },
    { eye: 'happy', mouth: 'bigSmile', tilt: -4, antenna: 1, extras: ['star'] },
  ],
  drag: [{ eye: 'wide', mouth: 'o', dy: 2 }],
  walk: [
    { eye: 'open', mouth: 'flat', tread: -1, dy: -2 },
    { eye: 'open', mouth: 'flat', tread: 0 },
    { eye: 'open', mouth: 'flat', tread: 1, dy: -2 },
  ],
  sleep: [
    { eye: 'closed', mouth: 'flat', dy: 2, extras: ['zzz'] },
    { eye: 'closed', mouth: 'flat', dy: 4, antenna: -1, extras: ['zzz'] },
  ],
  wake: [
    { eye: 'closed', mouth: 'flat', dy: 3 },
    { eye: 'half', mouth: 'smile' },
  ],
  welcome: [
    { eye: 'open', mouth: 'smile', antenna: 1, extras: ['note'] },
    { eye: 'happy', mouth: 'bigSmile', dy: -3, antenna: -1, extras: ['note'] },
  ],
  think: [{ eye: 'half', mouth: 'flat', tilt: 2, extras: ['question'] }],
  wait: [{ eye: 'open', mouth: 'flat', extras: ['dots'] }],
};

const manifest = await writePackFiles(
  PACK_DIR,
  { id: 'tin-bot', name: 'Tin Bot', credit: 'ATELIER AI', license: 'CC0-1.0', stageScale: 0.92 },
  POSES,
  renderTinBot
);
console.log(`tin-bot: wrote 15 sheets + pack.json -> ${PACK_DIR}`);
console.log(`  (id=${manifest.id}, stageScale=${manifest.meta.stageScale})`);
