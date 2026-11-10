/**
 * The build-freshness check that lets a test run reuse `dist/`: it must reuse a
 * build only when nothing it was built from has changed since, and must rebuild
 * for every kind of change, including a removed file that leaves no newer file
 * behind.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { isBuildFresh } from "./fixtures/build-freshness.js";

const INPUTS = ["src", "config.json"];
const OUTPUTS = ["dist/cli.js", "dist/index.js"];
/** Fixed past times, in seconds: sources were written, then the build ran. */
const SOURCE_TIME = 1_000;
const BUILD_TIME = 2_000;

describe("isBuildFresh", () => {
  let root: string;
  const at = (relative: string): string => path.join(root, relative);
  const setTime = (relative: string, seconds: number): Promise<void> => utimes(at(relative), seconds, seconds);

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "llmwiki-build-fresh-"));
    await mkdir(at("src/nested"), { recursive: true });
    await mkdir(at("dist"));
    for (const file of ["src/a.ts", "src/nested/b.ts", "config.json", ...OUTPUTS]) await writeFile(at(file), file);
    for (const input of ["src/a.ts", "src/nested/b.ts", "src/nested", "src", "config.json"]) await setTime(input, SOURCE_TIME);
    for (const output of OUTPUTS) await setTime(output, BUILD_TIME);
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("reuses a build that is newer than every input", async () => {
    expect(await isBuildFresh(root, INPUTS, OUTPUTS)).toBe(true);
  });

  it.each(["src/a.ts", "src/nested/b.ts", "config.json"])("rebuilds after %s is edited", async (edited) => {
    await writeFile(at(edited), "changed");
    expect(await isBuildFresh(root, INPUTS, OUTPUTS)).toBe(false);
  });

  it("rebuilds after a source file is removed, though no remaining file is newer", async () => {
    await rm(at("src/nested/b.ts"));
    expect(await isBuildFresh(root, INPUTS, OUTPUTS)).toBe(false);
  });

  it("rebuilds after a source file is added", async () => {
    await writeFile(at("src/nested/c.ts"), "new");
    await setTime("src/nested/c.ts", SOURCE_TIME);
    expect(await isBuildFresh(root, INPUTS, OUTPUTS)).toBe(false);
  });

  it("rebuilds when an output is missing or only as new as an input", async () => {
    await setTime("dist/index.js", SOURCE_TIME);
    expect(await isBuildFresh(root, INPUTS, OUTPUTS)).toBe(false);
    await rm(at("dist/index.js"));
    expect(await isBuildFresh(root, INPUTS, OUTPUTS)).toBe(false);
  });

  it("rebuilds when an expected input does not exist", async () => {
    expect(await isBuildFresh(root, [...INPUTS, "package-lock.json"], OUTPUTS)).toBe(false);
  });
});
