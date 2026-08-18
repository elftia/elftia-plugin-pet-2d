/**
 * scripts/verify-packs.ts — task 6.7, the character-pack gate (`npm run
 * verify:packs`, part of `npm run verify`): runs the full build pipeline
 * (which ends in `validateCharacterPack` with real measured dimensions)
 * over every `packs-src/*`, and asserts the deliberately-broken
 * `fixtures/incomplete-pack/` is REJECTED with a readable message — the
 * gate must be seen failing, not assumed to fail (D7: "不再 emoji 降级，门禁
 * 拒收" — a half-pack is a rejection, not a fallback).
 *
 * Exit 0 requires: every shipped pack PASSES and the broken fixture is
 * REJECTED. Either direction failing (a shipped pack breaking, or the
 * broken fixture unexpectedly passing) exits 1.
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPackFromSourceDir } from './lib/buildPack';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PACKS_SRC = join(REPO_ROOT, 'packs-src');
const BROKEN_FIXTURE = join(REPO_ROOT, 'fixtures', 'incomplete-pack');

async function main(): Promise<void> {
  let failed = false;

  const packDirs = (await readdir(PACKS_SRC, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
    .map((entry) => join(PACKS_SRC, entry.name))
    .sort();

  for (const packDir of packDirs) {
    try {
      const built = await buildPackFromSourceDir(packDir);
      const sheetCount = new Set(Object.values(built.manifest.states).map((s) => s.sheet)).size;
      console.log(`PASS ${built.manifest.id} (${Object.keys(built.manifest.states).length} states, ${sheetCount} sheets measured, dims validated)`);
    } catch (error) {
      failed = true;
      console.error(`FAIL ${packDir}`);
      console.error(String(error instanceof Error ? error.message : error));
    }
  }

  // The broken fixture must be REJECTED — and the rejection must be the
  // readable missing-state message, not an incidental crash.
  try {
    await buildPackFromSourceDir(BROKEN_FIXTURE);
    failed = true;
    console.error(`FAIL ${join('fixtures', 'incomplete-pack')} was ACCEPTED — the gate is broken`);
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    if (!message.includes('is missing')) {
      failed = true;
      console.error(`FAIL incomplete-pack was rejected, but not for the designed reason:`);
      console.error(message);
    } else {
      const firstReason = message.split('\n').find((line) => line.trim().startsWith('- '));
      console.log(`REJECTED (expected) fixtures/incomplete-pack: ${firstReason?.trim().slice(2)}`);
    }
  }

  if (failed) process.exit(1);
  console.log(`${packDirs.length} shipped pack(s) PASS; broken fixture REJECTED as designed.`);
}

main().catch((error: unknown) => {
  console.error(String(error instanceof Error ? error.stack : error));
  process.exit(1);
});
