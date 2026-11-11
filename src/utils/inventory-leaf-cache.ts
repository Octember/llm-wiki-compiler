/**
 * @file src/utils/inventory-leaf-cache.ts
 * @description What an inventory walk learned from a leaf's confined open, kept
 * per process so a later walk can reuse it while the leaf is unchanged.
 *
 * WHY. Every walk opens every leaf: open, `fstat`, parent `realpath`, canonical
 * `lstat`, and for manifests and runs a read. On an unchanged store that is the
 * same answer each time. A walk that finds a leaf it already proved asks one
 * no-follow `lstat` of the canonical leaf instead, and reuses the size, identity
 * and bytes when `dev`, `ino`, `nlink`, `size`, `mtimeMs` and `ctimeMs` all
 * match. Nothing else is cached: classification is by path, caps, integrity and
 * parsing run downstream on every scan, and absent or unavailable leaves and
 * failed reads are never remembered.
 *
 * WHY THE SKIPPED CHECKS ARE NOT NEEDED. The confined open's post-open parent
 * `realpath` and inode binding exist so the bytes it reads belong to the in-root
 * file, not one reached through a parent swapped around the open. A hit reads
 * nothing: it returns bytes an earlier confined open proved for this inode. Same
 * `dev`/`ino` and the same change time mean the same inode, unchanged since that
 * proof, because every write, truncate, chmod, link or unlink moves its change
 * time and no caller can set it back; a reused inode number gets a new change
 * time. A hard link made elsewhere to reach the inode moves its change time too.
 * The walk still proves each directory canonical before listing it, so a moved
 * or symlinked directory is still reported, and every held byte is proven
 * current again by its reader (`durable-leaf.ts`) before use.
 *
 * RACY-CLEAN, AS GIT DOES. A write in the same timestamp tick as the proof
 * could change the bytes and keep the change time. So a leaf is remembered only
 * when its change time is {@link RACY_WINDOW_MS} older than the start of the
 * walk that proved it, which is before its open: any later write then lands on
 * a later tick. That also makes sub-microsecond timestamp precision moot.
 *
 * BOUNDED. At most {@link MAX_ENTRIES} leaves and {@link MAX_BODY_BYTES} of
 * bytes; the least recently used leaves go first.
 */

import path from "node:path";
import { lstat } from "./fs-metadata.js";
import type { HeldLeaf } from "./scanned-leaf-bytes.js";

/** How much older than its walk a leaf's change time must be to be remembered: a coarse filesystem clock tick. */
const RACY_WINDOW_MS = 1000;
const MAX_ENTRIES = 100_000;
const MAX_BODY_BYTES = 64 * 1024 * 1024;

/** One proven leaf: what its confined open saw, and its bytes when the walk read them. */
export type KnownLeaf = Omit<HeldLeaf, "body"> & { body?: Buffer };

const known = new Map<string, KnownLeaf>();
let heldBytes = 0;

/** Drop one leaf. */
function forget(key: string): void {
  const entry = known.get(key);
  if (entry === undefined) return;
  known.delete(key);
  heldBytes -= entry.body?.byteLength ?? 0;
}

/** Whether a proof of this leaf is remembered. No I/O: the read-ahead skips such leaves. */
export function mayKnowLeaf(file: string): boolean {
  return known.has(path.resolve(file));
}

/**
 * The remembered proof of `file` under `parent` and `root` when the canonical
 * leaf, not followed, is still that exact version; otherwise undefined. Call
 * only from a walk that has just proven `parent` canonical.
 */
export async function knownLeaf(root: string, file: string, parent: string): Promise<KnownLeaf | undefined> {
  const key = path.resolve(file), entry = known.get(key);
  if (entry === undefined || entry.root !== path.resolve(root) || entry.ownedDirectory !== path.resolve(parent)) return undefined;
  const now = await lstat(entry.canonicalLeaf).catch(() => null);
  if (now === null || !now.isFile() || now.dev !== entry.dev || now.ino !== entry.ino || now.nlink !== entry.nlink
    || now.size !== entry.size || now.mtimeMs !== entry.mtimeMs || now.ctimeMs !== entry.ctimeMs) {
    forget(key);
    return undefined;
  }
  known.delete(key);
  known.set(key, entry);
  return entry;
}

/** Remember a leaf a walk started at `walkStartedAt` proved, unless it changed too recently to trust. */
export function rememberLeaf(leaf: KnownLeaf, walkStartedAt: number): void {
  const key = path.resolve(leaf.leaf);
  forget(key);
  if (leaf.ctimeMs + RACY_WINDOW_MS >= walkStartedAt || (leaf.body?.byteLength ?? 0) > MAX_BODY_BYTES) return;
  known.set(key, leaf);
  heldBytes += leaf.body?.byteLength ?? 0;
  for (const oldest of known.keys()) {
    if (known.size <= MAX_ENTRIES && heldBytes <= MAX_BODY_BYTES) break;
    forget(oldest);
  }
}
