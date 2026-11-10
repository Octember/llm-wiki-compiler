#!/usr/bin/env node
/**
 * Run the test suite with its temporary files on a RAM disk when one is cheap
 * to create.
 *
 * The durable write paths fsync every file and directory they touch, and the
 * tests exercise them thousands of times in temp directories. On macOS, Node's
 * fsync is F_FULLFSYNC, which costs roughly 10 ms per call on the system disk
 * and well under 1 ms on a RAM disk, so most of the suite's wall time is spent
 * waiting on flushes of files that are deleted seconds later.
 *
 * On macOS this script mounts a temporary RAM disk, points TMPDIR at it for the
 * vitest process, and detaches it afterwards. Everywhere else, and whenever the
 * RAM disk cannot be created, the suite runs exactly as `vitest run` would.
 * Set `LLMWIKI_TEST_RAMDISK=0` to skip the RAM disk on macOS.
 *
 * Extra arguments are passed to vitest: `npm test -- test/foo.test.ts`.
 */

import { execFileSync, spawn } from "node:child_process";
import { chmodSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/** Size of the RAM disk. Memory is only consumed as files are written. */
const RAM_DISK_MEGABYTES = 2048;
const SECTORS_PER_MEGABYTE = 2048;
const RAM_DISK_OPT_OUT = "0";
const OWNER_ONLY_MODE = 0o700;

/** True when this run should try to mount a RAM disk. */
function shouldUseRamDisk() {
  return process.platform === "darwin" && process.env.LLMWIKI_TEST_RAMDISK !== RAM_DISK_OPT_OUT;
}

/**
 * Mount an APFS RAM disk and return its device and mount point, or null when
 * either step fails. A device that was attached but could not be formatted is
 * detached again so nothing is left behind.
 */
function mountRamDisk() {
  const volume = `llmwiki-test-${process.pid}`;
  let device;
  try {
    const sectors = RAM_DISK_MEGABYTES * SECTORS_PER_MEGABYTE;
    device = execFileSync("hdiutil", ["attach", "-nomount", `ram://${sectors}`], { encoding: "utf8" }).trim();
    execFileSync("diskutil", ["erasevolume", "APFS", volume, device], { stdio: "ignore" });
    const mountPoint = path.join("/Volumes", volume);
    // A new volume's root is group-writable. Code under test refuses private
    // directories beneath a group-writable ancestor, as it would in production.
    chmodSync(mountPoint, OWNER_ONLY_MODE);
    return { device, mountPoint };
  } catch {
    if (device) detachRamDisk(device);
    return null;
  }
}

/** Detach a RAM disk. A failure is reported, never thrown: the test result stands. */
function detachRamDisk(device) {
  try {
    execFileSync("hdiutil", ["detach", device, "-force"], { stdio: "ignore" });
  } catch {
    console.error(`run-tests: could not detach ${device}; run \`hdiutil detach ${device} -force\`.`);
  }
}

/** Absolute path of the installed vitest entry script. */
function resolveVitest() {
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve("vitest/package.json");
  return path.join(path.dirname(manifestPath), require(manifestPath).bin.vitest);
}

/** Run `vitest run` with the given temp directory and resolve with its exit code. */
function runVitest(tmpdir) {
  const env = tmpdir ? { ...process.env, TMPDIR: tmpdir } : process.env;
  const child = spawn(process.execPath, [resolveVitest(), "run", ...process.argv.slice(2)], { stdio: "inherit", env });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  return new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 1)));
}

const ramDisk = shouldUseRamDisk() ? mountRamDisk() : null;
if (ramDisk) console.log(`run-tests: temp files on RAM disk ${ramDisk.mountPoint}`);
let exitCode = 1;
try {
  exitCode = await runVitest(ramDisk?.mountPoint);
} finally {
  if (ramDisk) detachRamDisk(ramDisk.device);
}
process.exit(exitCode);
