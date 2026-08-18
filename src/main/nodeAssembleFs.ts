/**
 * src/main/nodeAssembleFs.ts — the ONE node-side `AssembleFs` implementation
 * (task 3.1): the main half and the build scripts share it, so the injected
 * surface in `src/packs/assemblePack.ts` has exactly one real binding (tests
 * inject fakes; nothing else re-implements the node glue).
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { AssembleFs } from '../packs/assemblePack';

export const nodeAssembleFs: AssembleFs = {
  readFileBytes: (path) => readFile(path),
  readFileText: (path) => readFile(path, 'utf8'),
  isFile: async (path) => {
    try {
      return (await stat(path)).isFile();
    } catch {
      return false;
    }
  },
  listDir: (path) => readdir(path),
  joinPath: join,
};
