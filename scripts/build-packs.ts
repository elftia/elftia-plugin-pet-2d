/**
 * scripts/build-packs.ts — task 6.1 + 6.4: emits D1 pack modules.
 *
 *   tsx scripts/build-packs.ts
 *       Builds every `packs-src/<id>/` (skipping `_authoring/`) into
 *       `dist/pet-2d/renderer/characters/<id>/pack.mjs` and regenerates
 *       `src/packs/pack-ids.generated.ts` (the registry's build-time list).
 *       Reads `packs-src/` ONLY — never `fixtures/`.
 *
 *   tsx scripts/build-packs.ts --from-whale-girl <dir> [--id <id>] [--out <dir>]
 *       The whale-girl adapter's real consumer (D8): reads a whale-girl
 *       install (`<dir>/lib/assets/manifest.json` + character sheets) and
 *       emits a pack module INTO THE CALLER'S OWN BUILD — default
 *       `./built-packs/<id>`, deliberately NOT `dist/` (whale-girl's
 *       鲸鱼娘 art is ZipZipPipe's IP; this repo never distributes it).
 *
 * Both paths share `scripts/lib/buildPack.ts`: resolve sheets, measure real
 * dimensions, run `validateCharacterPack` (a pack that builds is a pack that
 * validates), inline as data URIs. Zero installs: `tsx` comes from the
 * node_modules junction into the host repo.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPackFromSourceDir, buildPackFromWhaleGirlInstall } from './lib/buildPack';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PACKS_SRC = join(REPO_ROOT, 'packs-src');
const DIST_CHARACTERS = join(REPO_ROOT, 'dist', 'pet-2d', 'renderer', 'characters');
const GENERATED_IDS_PATH = join(REPO_ROOT, 'src', 'packs', 'pack-ids.generated.ts');

interface Args {
  fromWhaleGirl: string | null;
  id: string | null;
  out: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { fromWhaleGirl: null, id: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--from-whale-girl') args.fromWhaleGirl = requireValue(argv, ++i, argv[i - 1]);
    else if (argv[i] === '--id') args.id = requireValue(argv, ++i, argv[i - 1]);
    else if (argv[i] === '--out') args.out = requireValue(argv, ++i, argv[i - 1]);
    else {
      console.error(`unknown argument: ${argv[i]}`);
      console.error(USAGE);
      process.exit(2);
    }
  }
  return args;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) {
    console.error(`${flag} requires a value`);
    process.exit(2);
  }
  return value;
}

const USAGE = `usage:
  tsx scripts/build-packs.ts
  tsx scripts/build-packs.ts --from-whale-girl <dir> [--id <id>] [--out <dir>]`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.fromWhaleGirl) {
    await buildFromWhaleGirl(args);
    return;
  }

  const packDirs = (await readdir(PACKS_SRC, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
    .map((entry) => join(PACKS_SRC, entry.name))
    .sort();
  if (packDirs.length === 0) {
    console.error(`no packs found under ${PACKS_SRC} (skipping _authoring/)`);
    process.exit(1);
  }

  const ids: string[] = [];
  for (const packDir of packDirs) {
    const built = await buildPackFromSourceDir(packDir);
    const outDir = join(DIST_CHARACTERS, built.manifest.id);
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, 'pack.mjs'), built.code, 'utf8');
    ids.push(built.manifest.id);
    const sheetCount = new Set(Object.values(built.manifest.states).map((s) => s.sheet)).size;
    console.log(`built ${built.manifest.id} -> ${join('dist', 'pet-2d', 'renderer', 'characters', built.manifest.id, 'pack.mjs')} (${Object.keys(built.manifest.states).length} states, ${sheetCount} sheets measured)`);
  }

  await writeFile(
    GENERATED_IDS_PATH,
    [
      '// GENERATED FILE — do not edit. Emitted by scripts/build-packs.ts from',
      '// the packs-src/ directory listing; imported by src/packs/registry.ts.',
      `export const GENERATED_PACK_IDS = [${ids.map((id) => `'${id}'`).join(', ')}] as const;`,
      '',
    ].join('\n'),
    'utf8'
  );
  console.log(`regenerated ${join('src', 'packs', 'pack-ids.generated.ts')}: [${ids.join(', ')}]`);
}

async function buildFromWhaleGirl(args: Args): Promise<void> {
  const wgRoot = args.fromWhaleGirl as string;
  let characterId = args.id;
  if (!characterId) {
    const manifest: unknown = JSON.parse(
      await readFile(join(wgRoot, 'lib', 'assets', 'manifest.json'), 'utf8')
    );
    const declared = (manifest as { default?: string })?.default ?? null;
    if (declared) {
      characterId = declared;
    } else {
      console.error('--id is required when the whale-girl manifest declares no default character');
      process.exit(2);
    }
  }

  const built = await buildPackFromWhaleGirlInstall(wgRoot, characterId);
  const outDir = args.out ?? join(REPO_ROOT, 'built-packs', built.manifest.id);
  const resolvedOut = isAbsolute(outDir) ? outDir : resolve(REPO_ROOT, outDir);
  const repoDist = join(REPO_ROOT, 'dist');
  if (resolvedOut === repoDist || resolvedOut.startsWith(repoDist + sep)) {
    console.error(
      "refusing to write a whale-girl-derived pack into this repo's dist/ — the 鲸鱼娘 character art is ZipZipPipe's IP and must never ship (see NOTICE). Pass --out <your own dir>."
    );
    process.exit(2);
  }
  await mkdir(dirname(join(outDir, 'pack.mjs')), { recursive: true });
  await writeFile(join(outDir, 'pack.mjs'), built.code, 'utf8');
  console.log(`built ${built.manifest.id} from whale-girl install ${wgRoot}`);
  console.log(`  -> ${join(outDir, 'pack.mjs')} (NOT under dist/, by design)`);
  console.log('  reminder: you own the rights story for the art you just packed (D8/NOTICE).');
}

main().catch((error: unknown) => {
  console.error(String(error instanceof Error ? error.stack : error));
  process.exit(1);
});
