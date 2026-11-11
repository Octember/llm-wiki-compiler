/**
 * @file test/storage/inventory-leaf-cache.test.ts
 * @description A walk reuses an earlier walk's proof of a leaf only while the
 * leaf is that exact version, and remembers nothing that changed too recently.
 *
 * Real files on real disk through the production observation
 * (`observeInventoryLeaf`). A walk start in the future stands in for a leaf
 * that changed long before its walk.
 */

import { link, mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mayKnowLeaf } from "../../src/utils/inventory-leaf-cache.js";
import { observeInventoryLeaf } from "../../src/utils/inventory-scan.js";
import { scannedLeafBytes } from "../../src/utils/scanned-leaf-bytes.js";

const LATER = () => Date.now() + 60_000;
let root: string, dir: string, leaf: string;

/** Observe the leaf as a walk started at `startedAt` does; the bytes it holds, or its outcome. */
async function walk(startedAt: number): Promise<string> {
  const scanned = scannedLeafBytes();
  const observed = await observeInventoryLeaf(root, leaf, dir, { into: scanned, maxBytes: 1024 }, undefined, startedAt);
  if (observed.kind !== "confirmed") return observed.kind;
  return scanned.heldFor(root, leaf, dir, 1024)?.body.toString("utf8") ?? "nothing held";
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "leaf-cache-")));
  dir = path.join(root, "store");
  leaf = path.join(dir, "run.json");
  await mkdir(dir);
  await writeFile(leaf, "first");
});

afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("inventory leaf cache", () => {
  it("remembers a leaf only when it changed well before the walk", async () => {
    expect(await walk(Date.now())).toBe("first");
    expect(mayKnowLeaf(leaf)).toBe(false);
    expect(await walk(LATER())).toBe("first");
    expect(mayKnowLeaf(leaf)).toBe(true);
    expect(await walk(LATER())).toBe("first");
  });

  it("re-proves a leaf replaced, rewritten, re-linked or swapped for a symlink", async () => {
    await walk(LATER());
    await writeFile(path.join(dir, "next"), "other");
    await rename(path.join(dir, "next"), leaf);
    expect(await walk(LATER())).toBe("other");
    await writeFile(leaf, "rewritten");
    expect(await walk(LATER())).toBe("rewritten");
    await link(leaf, path.join(root, "outside-link"));
    expect(await walk(LATER())).toBe("rewritten");
    await rename(leaf, path.join(root, "moved"));
    await symlink(path.join(root, "moved"), leaf);
    expect(await walk(LATER())).toBe("unavailable");
  });
});
