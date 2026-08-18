# Building a pack from your own whale-girl install

This repo ships the whale-girl **format reader**, never whale-girl art.
If you already have a whale-girl install and the rights to use its
character art, the adapter turns it into a pack module in one command —
into **your own build**, not this repo's `dist/`:

```
npm run build:packs -- --from-whale-girl <your-whale-girl-dir> [--id <character-id>] [--out <dir>]
```

- `<your-whale-girl-dir>` is a whale-girl checkout/install root — the
  command reads `<dir>/lib/assets/manifest.json` and the character's
  sheets under `lib/assets/characters/<id>/` (registry form) or flat in
  `lib/assets/` (legacy form).
- `--id` selects the character when the manifest declares several; it is
  optional when the manifest declares a default character.
- `--out` overrides the output directory (default `./built-packs/<id>`).
  The command **refuses to write under this repo's `dist/`** — see the
  rights note below.

The adapted manifest still passes through the same machine gate
(`validateCharacterPack`) as every other pack; unknown state names are
carried through on purpose so the gate rejects them loudly instead of the
adapter silently dropping them.

## The four adaptations

The mapping is near-identity — state names, `playback` enum, `motion`
whitelist, `frames`, `fps`, sheet filenames and the all-15-mandatory rule
are the same by construction — with exactly four differences
(`src/packs/whaleGirlCompat.ts`):

1. **`apiVersion` is synthesized** (`1`) — whale-girl manifests have no
   such field.
2. **`license` is synthesized** as whale-girl-the-software's `MIT`
   (Sam Gao / vlln, https://github.com/vlln/whale-girl) and `credit` maps
   from the character's own `credit` field.
3. **`meta.stageSize` is not carried over as pixels.** It was a web-page
   stage size (e.g. `110`) — meaningless in a 256 OS window. It maps to
   `stageScale: 1` (fill the pet window's shorter side) unconditionally.
4. **The legacy flat form is accepted** (`states` at the manifest root,
   sheets flat beside it) alongside the `characters.<id>` registry form —
   whale-girl's own `verify-assets` validates both, so the adapter does
   too.

## The state-direction inversion (the one thing not adapted)

whale-girl's `/state` endpoint returns **pet state** (`activity.name`) to
an external consumer — the pet process decides, the consumer renders. This
plugin goes the **other way**: the Elftia host feeds **facts** and the pet
derives state (`docs/state-grammar.md`). So the adapter converts *assets
and their playback metadata* — it does not and cannot convert a
whale-girl *state feed*. If you are porting a whale-girl-style companion:
do not wire anything to `/state`; subscribe to the host's facts snapshot
(`host.petRuntime.subscribeFacts`) and derive state with your own state
table.

## The rights note (read before publishing anything)

whale-girl's MIT license covers its **software**. The 鲸鱼娘 character is
**ZipZipPipe's IP** (whale-girl's own README credits the character design
to ZipZipPipe). MIT + attribution does not cover third-party character IP,
and a pack you build from whale-girl art carries that art with it: **you
own the rights story for whatever you pack.** This repository

- distributes **no** whale-girl art,
- keeps a local copy under `fixtures/whale-girl/` strictly as a
  development/test fixture (the adapter's tests run against the real
  manifest and real sheets, which is why the fixture exists at all),
- proves the exclusion on every build (`verify:dist` →
  `verify-no-fixture-bytes`: no fixture bytes, no fixture base64 prefixes,
  no fixture-named paths anywhere under `dist/`),
- and must have `fixtures/` stripped before any public publication of this
  repo — see `NOTICE` for the full policy.
