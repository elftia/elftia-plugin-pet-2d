# The character-pack contract

A character pack is a directory of sprite strips plus one manifest. The
contract is enforced by a machine gate — `validateCharacterPack`
(`src/contract/characterPack.ts`) — which returns a list of named,
human-readable problems (it never throws). A pack that builds is a pack that
validates; there is no second, drifting check.

```
packs-src/<id>/
  pack.json          ← the manifest
  sheets/<name>.svg  ← or .png — sprite strips, one file per sheet
```

`npm run build:packs` builds every `packs-src/<id>/` into
`dist/pet-2d/renderer/characters/<id>/pack.mjs` (sheets inlined as data
URIs). `npm run verify:packs` runs the same pipeline as a gate and
additionally asserts that the deliberately-broken
`fixtures/incomplete-pack/` is **rejected** — the gate must be seen failing,
not assumed to fail.

## The manifest

| Field | Required | Rule |
|---|---|---|
| `apiVersion` | yes | `1` (pack-contract version; adding an optional field is MINOR, changing a meaning is MAJOR) |
| `id` | yes | `^[a-z0-9][a-z0-9-]{0,31}$` (URL/path-safe; mirrors the host's flat-id discipline) |
| `name` | yes | display name, non-empty |
| `credit` | yes | asset author attribution, non-empty — always shown in the pack picker |
| `license` | yes | SPDX id or explicit text for the **art** (may differ from the plugin's code license) |
| `meta.frameSize` | — | positive int, default `256`; every sheet's height must equal it |
| `meta.stageScale` | — | `0 < x ≤ 1`, default `1`; fraction of the pet window's shorter side the stage occupies |
| `states` | yes | **all 15 state keys present — a missing key is a rejection, not a fallback**; unknown keys are rejected |

## The per-state slot

| Field | Required | Rule |
|---|---|---|
| `sheet` | yes | pack-relative asset key (`sheets/<name>` resolution is the builder's job) |
| `frames` | yes | positive int; the strip's measured width must equal `frames × meta.frameSize` |
| `fps` | yes | `0 < fps ≤ 30` |
| `playback` | yes | `loop` \| `pingpong` (needs `frames ≥ 2`) \| `once` \| `blink` (needs `frames ≥ 2`) |
| `motion` | — | one of the nine recipes (`bob`, `wiggle`, `squash`, `shake`, `sigh`, `hop`, `tilt`, `float`, `wave`); allowed **only** when `frames === 1`, except the documented `error` exception (`error` ships 2 frames + `shake`) |

Two states may share one sheet; no shipped pack does.

## Rules that are contract, not convention

- **Frame 0 is the rest pose** in every playback mode; the action progresses
  in later frames. `once` plays forward a single time and **holds the last
  frame** — author the strip so its final frame reads as the state's
  settled end-pose. `blink` rests on frame 0 between single
  `0 → N-1 → 0` sweeps.
- **Assets face left.** The player mirrors with `scaleX(-1)` when the pet
  walks or is dragged rightwards. Author your art left-facing.
- **All 15 states are mandatory.** The union is
  `idle, working, celebrate, error, disappointed, joy, eat, play, drag,
  walk, sleep, wake, welcome, think, wait`. A half-pack is a rejection, not
  a fallback — an optional state with an emoji placeholder ships as a
  visibly broken pet, which is why whale-girl removed exactly that.
- **The dimension math is checked against the real asset**, not the
  declaration: the builder reads each sheet's actual pixel size (PNG IHDR /
  SVG `viewBox`), and the gate rejects `width ≠ frames × frameSize` or
  `height ≠ frameSize`.

## A worked example

A one-frame-per-state SVG pack (`packs-src/my-pack/pack.json`):

```json
{
  "apiVersion": 1,
  "id": "my-pack",
  "name": "My Pack",
  "credit": "Your Name Here",
  "license": "CC0-1.0",
  "meta": { "frameSize": 256, "stageScale": 1 },
  "states": {
    "idle":    { "sheet": "idle",    "frames": 1, "fps": 2, "playback": "loop" },
    "working": { "sheet": "working", "frames": 1, "fps": 2, "playback": "loop", "motion": "bob" },
    "celebrate": { "sheet": "celebrate", "frames": 4, "fps": 8, "playback": "once" },
    "error":   { "sheet": "error",   "frames": 2, "fps": 4, "playback": "loop", "motion": "shake" },
    "…": "… the remaining 11 states, same shape — all 15 are required"
  }
}
```

with `sheets/idle.svg` a 256×256 image and `sheets/celebrate.svg` a
1024×256 strip (4 frames × 256). `error` is the one state allowed to break
the "`motion` only on single-frame states" rule.

Then:

```
npm run build:packs     # emits dist/pet-2d/renderer/characters/my-pack/pack.mjs
npm run verify:packs    # the gate, over every pack + the must-reject fixture
```

## The base64 cost note (and the follow-up that removes it)

v1 packs inline every sheet into the pack module as a data URI. For SVG that
is a few KB per sheet and effectively free. For **PNG** strips it is not:
base64 inflates bytes ~1.37×, so a realistic 15-state PNG pack lands in the
hundreds of KB — the shipped `elf-blob` + `tin-bot` (SVG) total ~196 KiB
together, while one PNG-based pack can exceed that alone. The 2 MB cap in
`verify:dist` is sized with that in mind.

This is a deliberate v1 constraint, not a law of nature: the host CSP grants
`plugin:` only to `script-src` today, so `<img src="plugin://…">` is
CSP-blocked in the real pet window and data URIs are the one transport that
works everywhere. The `SheetSource` seam (`src/contract/`) is shaped so a
future host-side `img-src plugin:` change flips packs to plain per-file
`plugin://` URLs with a per-pack loader change — no contract break. That
follow-up (host CSP change + its own security review) is recorded in the
portfolio's follow-up list; it is not this repo's work.

## Validating your own pack outside this repo

`validateCharacterPack` is pure and dependency-free by design: copy
`src/contract/petState.ts` + `src/contract/characterPack.ts` into any
project, measure your sheets (`{width, height}` per sheet name), and call
it. The dimension argument is the only thing the validator cannot do itself
— it has no fs/canvas access and stays usable from a browser context.
