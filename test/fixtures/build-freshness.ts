/**
 * Decide whether the built CLI and packages are newer than everything they are
 * built from, so the test run can reuse them instead of rebuilding.
 *
 * The full build takes about 20 seconds, and the suite used to pay it on every
 * run: after `npm run build` in the pre-push hook and in CI, and again for each
 * single-file run while iterating on a test. A build is reused only when every
 * expected output exists and the oldest of them is strictly newer than the
 * newest input. Directories count as inputs, because removing or adding a file
 * changes its directory's modification time and nothing else.
 *
 * The check trusts modification times. `git checkout`, `git stash` and editors
 * all write the files they change, so a real source change always looks newer
 * than the build. Anything this cannot see is covered by running
 * `npm run build`, which always rebuilds.
 */

import { readdir, stat } from "fs/promises";
import path from "path";

/** Paths, relative to the repository root, that the build reads. */
const BUILD_INPUTS: readonly string[] = [
  "src",
  "scripts",
  "packages/llmwiki-core/tsup.config.ts",
  "packages/llmwiki-core/package.json",
  "packages/llmwiki-local-workflows/tsup.config.ts",
  "packages/llmwiki-local-workflows/package.json",
  "tsup.config.ts",
  "tsconfig.json",
  "package.json",
  "package-lock.json",
];

/** Files a complete build always writes, across the facade and both packages. */
const BUILD_OUTPUTS: readonly string[] = [
  "dist/cli.js",
  "dist/index.js",
  "dist/index.d.ts",
  "dist/viewer/assets/index.html",
  "packages/llmwiki-core/dist/index.js",
  "packages/llmwiki-core/dist/index.d.ts",
  "packages/llmwiki-core/dist/compiler-cli.js",
  "packages/llmwiki-core/dist/viewer/assets/index.html",
  "packages/llmwiki-local-workflows/dist/index.js",
  "packages/llmwiki-local-workflows/dist/index.d.ts",
];

/** True when every output exists and is strictly newer than every input. */
export async function isBuildFresh(
  root: string,
  inputs: readonly string[] = BUILD_INPUTS,
  outputs: readonly string[] = BUILD_OUTPUTS,
): Promise<boolean> {
  const outputTimes = await Promise.all(outputs.map((output) => modifiedAt(path.join(root, output))));
  if (outputTimes.length === 0 || outputTimes.includes(null)) return false;
  const oldestOutput = Math.min(...(outputTimes as number[]));
  const inputTimes = await Promise.all(inputs.map((input) => newestModification(path.join(root, input))));
  return Math.max(...inputTimes) < oldestOutput;
}

/** Modification time in milliseconds, or null when the path does not exist. */
async function modifiedAt(target: string): Promise<number | null> {
  try {
    return (await stat(target)).mtimeMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Newest modification time of a file, or of a directory and everything in it.
 * A missing input is treated as newer than any build, which forces a rebuild.
 */
async function newestModification(target: string): Promise<number> {
  const info = await stat(target).catch(() => null);
  if (info === null) return Number.POSITIVE_INFINITY;
  if (!info.isDirectory()) return info.mtimeMs;
  const entries = await readdir(target);
  const nested = await Promise.all(entries.map((entry) => newestModification(path.join(target, entry))));
  return Math.max(info.mtimeMs, ...nested);
}
