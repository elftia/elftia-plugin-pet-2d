# incomplete-pack — deliberately broken, do not fix

This fixture is missing its 15th state (`wait`) ON PURPOSE: it exists so
`npm run verify:packs` can prove the character-pack gate REJECTS a half-pack
with a readable message ("states.wait is missing — all 15 states are
required, no fallback") instead of merely claiming it would. If you make
this pack valid, the gate's negative control is gone — add a NEW broken
fixture instead.

Everything else about it is valid (14 well-formed 1-frame SVG sheets, a
complete manifest skeleton) so the rejection isolates exactly the
missing-state rule.
