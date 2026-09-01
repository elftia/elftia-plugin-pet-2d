#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '..');
const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error('[pet-2d-repro] npm_execpath is required; run through npm run verify:repro');
}
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'pet-2d-repro-'));

function sanitizedEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/(?:^|_)auth(?:_|$)|token/i.test(key)),
  );
}

function run(args, cwd) {
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd,
    env: { ...sanitizedEnvironment(), NODE_PATH: '', CI: '1' },
    encoding: 'utf8',
    stdio: 'pipe',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(
      `npm ${args.join(' ')} failed in ${path.basename(cwd)}:\n${result.stdout ?? ''}${result.stderr ?? ''}`,
    );
  }
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function inventory(root, relative = '') {
  const current = path.join(root, ...relative.split('/').filter(Boolean));
  const entries = [];
  for (const name of readdirSync(current).sort((left, right) => left.localeCompare(right))) {
    const childRelative = relative ? `${relative}/${name}` : name;
    const child = path.join(root, ...childRelative.split('/'));
    const state = lstatSync(child);
    if (state.isSymbolicLink()) throw new Error(`artifact contains link: ${childRelative}`);
    if (state.isDirectory()) entries.push(...inventory(root, childRelative));
    else if (state.isFile()) {
      entries.push({ file: childRelative, size: state.size, sha256: sha256(child) });
    }
  }
  return entries;
}

function build(name) {
  const root = path.join(tempRoot, name);
  cpSync(repositoryRoot, root, {
    recursive: true,
    filter(candidate) {
      const relative = path.relative(repositoryRoot, candidate);
      if (!relative) return true;
      return ![
        '.elftia-work',
        '.git',
        '.rasen',
        '.rasen-store',
        'dist',
        'node_modules',
        'rasen',
        'release',
      ].includes(relative.split(path.sep)[0]);
    },
  });
  run(['ci', '--ignore-scripts', '--no-audit', '--no-fund'], root);
  run(['run', 'build'], root);
  run(['run', 'release'], root);
  const artifactRoot = path.join(root, 'dist', 'pet-2d');
  const version = JSON.parse(readFileSync(path.join(artifactRoot, 'elftia-plugin.json'), 'utf8')).version;
  const releaseRoot = path.join(root, 'release', version);
  return {
    files: inventory(artifactRoot),
    epkgSha256: sha256(path.join(releaseRoot, 'pet-2d.epkg')),
    sidecarSha256: sha256(path.join(releaseRoot, 'pet-2d.json')),
  };
}

try {
  const first = build('a');
  const second = build('b');
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    throw new Error('[pet-2d-repro] isolated build or release bytes differ');
  }
  const officialVersion = JSON.parse(readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8')).version;
  const officialRoot = path.join(repositoryRoot, 'release', officialVersion);
  const official = {
    epkgSha256: sha256(path.join(officialRoot, 'pet-2d.epkg')),
    sidecarSha256: sha256(path.join(officialRoot, 'pet-2d.json')),
  };
  if (
    official.epkgSha256 !== first.epkgSha256 ||
    official.sidecarSha256 !== first.sidecarSha256
  ) {
    throw new Error('[pet-2d-repro] canonical release pair differs from isolated builds');
  }
  console.log(
    `[pet-2d-repro] two isolated npm-ci builds and the canonical release produced ` +
      `${first.files.length} files, EPKG ${first.epkgSha256}, sidecar ${first.sidecarSha256}`,
  );
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
