/**
 * @file test/profile-template-signing-canonical-json.test.ts
 * @description Differential regression check: `canonicalJson`, the project's
 * RFC 8785 serializer behind every signature, HMAC and digest, must produce the
 * same text (or throw the same error) as the vetted `canonicalize` package it
 * replaced, for hand-picked edge cases and a few hundred seeded random values.
 * A changed byte would invalidate every stored signature, so equality is exact.
 */

import { describe, expect, it } from "bun:test";
import canonicalize from "canonicalize";
import { canonicalJson } from "../src/profile/templates/signing/canonical-json.js";

const RANDOM_CASES = 400;
const MAX_DEPTH = 4;
const UINT32_RANGE = 2 ** 32;

/** Deterministic mulberry32 generator, so a failure reproduces. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

const EDGE_NUMBERS = [0, -0, 1e21, 1e-7, 1e-6, 1e20, 9007199254740993, 5e-324, 1.7976931348623157e308, 0.1 + 0.2, 333333333.33333329];
const STRING_PIECES = ["a", "\"", "\\", "\n", "\u0000", "\u001f", "\u007f", "é", " ", "\ud800", "\udfff", "😀", "中", "", "10"];

/** Random value generator: nested arrays/objects with awkward strings, numbers and members. */
function valueGenerator(random: () => number): (depth: number) => unknown {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const text = (): string => Array.from({ length: Math.floor(random() * 6) }, () => pick(STRING_PIECES)).join("");
  const bits = new Float64Array(1);
  const words = new Uint32Array(bits.buffer);
  const number = (): number => {
    if (random() < 0.5) return pick(EDGE_NUMBERS);
    words[0] = random() * UINT32_RANGE;
    words[1] = random() * UINT32_RANGE;
    return bits[0]!;
  };
  const value = (depth: number): unknown => {
    const kind = Math.floor(random() * (depth >= MAX_DEPTH ? 5 : 8));
    if (kind === 0) return text();
    if (kind === 1) return number();
    if (kind === 2) return pick([true, false, null]);
    if (kind === 3) {
      const converted = text();
      return pick([undefined, Symbol("s"), () => 1, new Date(0), { toJSON: () => converted }]);
    }
    if (kind === 4) return [];
    if (kind === 5) return Array.from({ length: Math.floor(random() * 5) }, () => value(depth + 1));
    return Object.fromEntries(Array.from({ length: Math.floor(random() * 5) }, () => [text(), value(depth + 1)]));
  };
  return value;
}

/** The serializer's text, or the error it threw, as one comparable string. */
function outcome(serialize: (value: unknown) => string | undefined, value: unknown): string {
  try {
    return `ok:${serialize(value)}`;
  } catch (error) {
    return `error:${(error as Error).message}`;
  }
}

/** Hand-picked values covering each quirk of the package. */
function edgeCases(): unknown[] {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const holey: unknown[] = [1];
  holey[3] = 2;
  return [
    undefined, null, NaN, -Infinity, 1n, "plain", "\ud800 lone", ...EDGE_NUMBERS,
    [undefined, Symbol("s"), () => 1], holey, { a: undefined, b: () => 1, c: Symbol("s") },
    { toJSON: () => undefined }, { toJSON: "not callable" }, new Date(0), new Map([[1, 2]]), new Number(3),
    cyclic, { b: 1, a: 2, "10": 3, "9": 4, "😀": 5, "￿": 6 },
  ];
}

describe("canonicalJson", () => {
  it("matches canonicalize on every edge case", () => {
    for (const value of edgeCases()) expect(outcome(canonicalJson, value)).toBe(outcome(canonicalize, value));
  });

  it("matches canonicalize on seeded random values", () => {
    const value = valueGenerator(seededRandom(8785));
    for (let index = 0; index < RANDOM_CASES; index++) {
      const input = value(0);
      expect(outcome(canonicalJson, input)).toBe(outcome(canonicalize, input));
    }
  });
});
