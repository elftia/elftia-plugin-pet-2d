#!/usr/bin/env node
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, "..");
const sourcePath = path.join(repositoryRoot, "elftia-plugin.json.src");
const packagePath = path.join(repositoryRoot, "package.json");
const lockPath = path.join(repositoryRoot, "package-lock.json");
const destinationRoot = path.join(repositoryRoot, "dist", "pet-2d");
const destinationPath = path.join(destinationRoot, "elftia-plugin.json");

const manifest = JSON.parse(readFileSync(sourcePath, "utf8"));
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
const lock = JSON.parse(readFileSync(lockPath, "utf8"));

if (
  manifest.name !== "pet-2d" ||
  manifest.version !== packageJson.version ||
  lock.version !== packageJson.version ||
  lock.packages?.[""]?.version !== packageJson.version
) {
  throw new Error(
    "[pet-2d-stage] package, lockfile, and source manifest identity must agree",
  );
}

const sdkFile = "vendor/elftia-plugin-types-2.0.0.tgz";
const sdkDependency = `file:${sdkFile}`;
const sdkLock = lock.packages?.["node_modules/@elftia/plugin-types"];
const sdkIntegrity = `sha512-${createHash("sha512")
  .update(readFileSync(path.join(repositoryRoot, sdkFile)))
  .digest("base64")}`;
if (
  packageJson.devDependencies?.["@elftia/plugin-types"] !== sdkDependency ||
  lock.packages?.[""]?.devDependencies?.["@elftia/plugin-types"] !==
    sdkDependency ||
  sdkLock?.version !== "2.0.0" ||
  sdkLock.resolved !== sdkDependency ||
  sdkLock.link === true ||
  sdkLock.integrity !== sdkIntegrity
) {
  throw new Error(
    "[pet-2d-stage] vendored SDK 2.0.0 bytes, dependency, and unlinked lock must agree",
  );
}

for (const slot of ["main", "renderer", "pet"]) {
  const contribution = manifest.contributes?.[slot];
  if (
    !contribution ||
    contribution.requiredMajor !== 2 ||
    contribution.requiredMinor !== 0 ||
    contribution.builtAgainst !== "2.0.0"
  ) {
    throw new Error(
      `[pet-2d-stage] source contributes.${slot} must require Host API 2.0.0`,
    );
  }
  if (Object.prototype.hasOwnProperty.call(contribution, "checksum")) {
    throw new Error(
      `[pet-2d-stage] source contributes.${slot} must not carry generated checksum metadata`,
    );
  }
}

mkdirSync(destinationRoot, { recursive: true });
copyFileSync(sourcePath, destinationPath);
console.log(
  "[pet-2d-stage] copied checksum-free source manifest; plugin-kit owns final stamping",
);
