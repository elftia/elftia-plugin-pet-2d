#!/usr/bin/env node
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '..');
const sourcePath = path.join(repositoryRoot, 'elftia-plugin.json.src');
const packagePath = path.join(repositoryRoot, 'package.json');
const lockPath = path.join(repositoryRoot, 'package-lock.json');
const destinationRoot = path.join(repositoryRoot, 'dist', 'pet-2d');
const destinationPath = path.join(destinationRoot, 'elftia-plugin.json');

const manifest = JSON.parse(readFileSync(sourcePath, 'utf8'));
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
const lock = JSON.parse(readFileSync(lockPath, 'utf8'));

if (
  manifest.name !== 'pet-2d' ||
  manifest.version !== packageJson.version ||
  lock.version !== packageJson.version ||
  lock.packages?.['']?.version !== packageJson.version
) {
  throw new Error('[pet-2d-stage] package, lockfile, and source manifest identity must agree');
}

for (const slot of ['main', 'renderer', 'pet', 'quickChat']) {
  const contribution = manifest.contributes?.[slot];
  if (contribution && Object.prototype.hasOwnProperty.call(contribution, 'checksum')) {
    throw new Error(
      `[pet-2d-stage] source contributes.${slot} must not carry generated checksum metadata`,
    );
  }
}

mkdirSync(destinationRoot, { recursive: true });
copyFileSync(sourcePath, destinationPath);
console.log('[pet-2d-stage] copied checksum-free source manifest; plugin-kit owns final stamping');
