/**
 * @file test/setup-byte-equality.ts
 * @description Vitest setup file that compares two byte buffers of the same
 * type with one native comparison instead of the generic deep-equality walk.
 *
 * `expect(buffer).toEqual(other)` visits every byte through the iterable
 * equality machinery, which costs about a second of CPU per 5 MiB buffer. The
 * capacity tests assert that large retained files keep their exact bytes, so
 * that walk dominated them. The tester below answers only for two values of
 * the same Uint8Array-family constructor; every other pair (different types,
 * other typed arrays, nested structures containing buffers) is handed back to
 * the default comparison, so no assertion means anything different.
 */

import { expect } from "vitest";

/** Same-constructor Uint8Array pairs compare by bytes; everything else defers. */
function compareSameTypeBytes(a: unknown, b: unknown): boolean | undefined {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return undefined;
  if (a.constructor !== b.constructor) return undefined;
  return Buffer.compare(a, b) === 0;
}

expect.addEqualityTesters([compareSameTypeBytes]);
