/**
 * @file src/profile/templates/signing/canonical-json.ts
 * @description RFC 8785 (JCS) serializer that every signature, HMAC and digest
 * in the project is computed over.
 *
 * It is a drop-in, byte-for-byte replacement for the `canonicalize` npm package
 * (v3.0.0), written to do less work per value: one string is built by
 * concatenation instead of per-node `map`/`join` arrays, strings that need no
 * escaping skip `JSON.stringify`, and numbers use `String` (which is what
 * `JSON.stringify` does for a finite number). Every quirk of the package is
 * kept, because a changed byte invalidates every stored signature:
 *
 * - `NaN` and `±Infinity` throw `"NaN is not allowed"` / `"Infinity is not allowed"`.
 * - `toJSON()` is honoured on objects only, called with no arguments.
 * - A cycle throws `"Circular reference detected"`.
 * - In arrays, `undefined` and symbols become `null`; a hole, or a member that
 *   serializes to nothing (a function), contributes an empty string.
 * - In objects, `undefined` and symbol members are dropped; a member that
 *   serializes to nothing (a function) is written as `undefined`. Each member
 *   is read twice, as the package does.
 * - Keys are sorted by UTF-16 code unit (`Array.prototype.sort`).
 * - Any other primitive (`undefined`, function, symbol, bigint) goes to
 *   `JSON.stringify`, so its result or error is the package's.
 *
 * `test/profile-template-signing-canonical-json.test.ts` holds a differential regression check against
 * the package.
 */

/** Characters `JSON.stringify` escapes, plus every surrogate (paired or not). */
const NEEDS_ESCAPE = /["\\\u0000-\u001f\ud800-\udfff]/;

/** `JSON.stringify(text)`, skipping the call when nothing needs escaping. */
function quote(text: string): string {
  return NEEDS_ESCAPE.test(text) ? JSON.stringify(text) : `"${text}"`;
}

/** Number serialization, rejecting what RFC 8785 cannot represent. */
function numberText(value: number): string {
  if (Number.isNaN(value)) throw new Error("NaN is not allowed");
  if (!Number.isFinite(value)) throw new Error("Infinity is not allowed");
  return String(value);
}

/** Texts already known for some objects of one serialization, keyed by identity. */
export type KnownCanonicalText = ReadonlyMap<object, string>;

/** One serialization's state: the objects on the current path, and known texts. */
interface Walk {
  path: object[];
  known: KnownCanonicalText | undefined;
}

/** Reject a value already on the current path. */
function enter(value: object, path: object[]): void {
  if (path.includes(value)) throw new Error("Circular reference detected");
  path.push(value);
}

/** Array members: holes and empty results as `""`, `undefined`/symbol as `null`. */
function arrayText(array: unknown[], walk: Walk): string {
  let text = "[";
  const length = array.length;
  for (let index = 0; index < length; index++) {
    if (index > 0) text += ",";
    if (!(index in array)) continue;
    const member = array[index];
    const serialized = member === undefined || typeof member === "symbol" ? "null" : serialize(member, walk);
    if (serialized !== undefined) text += serialized;
  }
  return `${text}]`;
}

/** Object members in sorted key order, dropping `undefined`/symbol members. */
function objectText(object: Record<string, unknown>, walk: Walk): string {
  let text = "{";
  let first = true;
  for (const key of Object.keys(object).sort()) {
    const member = object[key];
    if (member === undefined || typeof member === "symbol") continue;
    text += `${first ? "" : ","}${quote(key)}:${serialize(object[key], walk)}`;
    first = false;
  }
  return `${text}}`;
}

/** An object, array or `toJSON` value, guarded against cycles; a known text as given. */
function structuredText(value: object, walk: Walk): string | undefined {
  const known = walk.known?.get(value);
  if (known !== undefined) return known;
  const convertible = value as { toJSON?: () => unknown };
  const hasToJSON = typeof convertible.toJSON === "function";
  enter(value, walk.path);
  const text = hasToJSON
    ? serialize(convertible.toJSON!(), walk)
    : Array.isArray(value) ? arrayText(value, walk) : objectText(value as Record<string, unknown>, walk);
  walk.path.pop();
  return text;
}

/** Serialize one value; `undefined` when it has no JSON form. */
function serialize(value: unknown, walk: Walk): string | undefined {
  switch (typeof value) {
    case "string": return quote(value);
    case "number": return numberText(value);
    case "boolean": return value ? "true" : "false";
    case "object": return value === null ? "null" : structuredText(value, walk);
    default: return JSON.stringify(value);
  }
}

/**
 * RFC 8785 canonical JSON text of `value`, identical to `canonicalize(value)`;
 * `undefined` when the value has no JSON representation.
 *
 * `known` passes along texts the caller has just computed, so a large subtree
 * is not serialized twice: wherever an object in `known` appears, its text is
 * written as given. The caller guarantees each text IS that object's canonical
 * text, so the output is the same as without `known`.
 */
export function canonicalJson(value: unknown, known?: KnownCanonicalText): string | undefined {
  return serialize(value, { path: [], known });
}
