/**
 * @file test/profile-declared-keys.test.ts
 * @description A profile reference to a field, attribute or entity type counts
 * only when the profile declares that key itself: a name inherited from
 * `Object.prototype` (`constructor`, `toString`) is undeclared. And a bad
 * entity directory fails as a profile validation error like every other.
 */

import { describe, expect, it } from "bun:test";
import { validateProfile, ProfileValidationError } from "../src/profile/validate.js";

/** A profile with one `notes` type whose definition is extended by `def`. */
function notesPack(def: Record<string, unknown> = {}, rest: Record<string, unknown> = {}): unknown {
  return {
    schemaVersion: 1, profileId: "notes", displayName: "Notes",
    entities: { notes: { directory: "wiki/notes", fields: { title: { type: "string" }, a: { type: "string" } }, ...def } },
    ...rest,
  };
}

describe("a profile's references to declared keys", () => {
  it.each([
    ["requiredFields", { requiredFields: ["constructor"] }],
    ["contentTiers", { contentTiers: ["toString"] }],
  ])("rejects an inherited name in %s", (_label, def) => {
    expect(() => validateProfile(notesPack(def))).toThrow(ProfileValidationError);
  });

  it("rejects an inherited name in a relation's requiredAttributes", () => {
    const relations = { cites: { from: ["notes"], to: ["notes"], direction: "directed", attributes: {}, requiredAttributes: ["constructor"] } };
    expect(() => validateProfile(notesPack({}, { relations }))).toThrow("requiredAttributes references undeclared attribute 'constructor'");
  });

  it("fails a reserved entity directory as a profile validation error", () => {
    expect(() => validateProfile(notesPack({ directory: "wiki/graph" }))).toThrow(ProfileValidationError);
  });
});
