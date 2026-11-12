/**
 * @file src/profile/validate-field-defs.ts
 * @description Checks on a field definition, wherever one is declared: an
 * entity's fields, a relation's attributes and an artifact type's metadata all
 * share the same shape, so each is checked the same way: finite numbers,
 * `artifactTypes` scoped to a declared artifact type on an `artifactRef` field,
 * and a `format` only on a field whose type it can describe.
 */

import type { FieldDef, FieldType } from "./types.js";
import { assert } from "./validate-helpers.js";

/** Reject any non-finite numeric value on one FieldDef (default/min/max). */
export function assertFieldDefFinite(where: string, field: FieldDef): void {
  for (const key of ["default", "min", "max"] as const) {
    const value = field[key];
    if (typeof value === "number") {
      assert(Number.isFinite(value), `${where} has a non-finite ${key}`);
    }
  }
}

/**
 * Reject `artifactTypes` declared on a field whose type is not `artifactRef` /
 * `artifactRef[]` — the property is meaningless (and silently ignored) on any
 * other field type, so a profile author's typo is caught at LOAD rather than
 * producing a scope that never applies. Placement is checked FIRST: a
 * misplaced `artifactTypes` is flagged before its contents, since a field that
 * shouldn't have the property at all makes checking its contents moot.
 *
 * Once placement is confirmed, an artifactRef field's `artifactTypes` scope
 * must be non-empty (an empty array can never be satisfied by any artifact
 * type — the same silently-dead-scope failure as an undeclared entry) and
 * every named type must be DECLARED by the profile's `artifacts` block —
 * otherwise every ref would fail Layer B ({@link validateArtifactRefsAgainstProfile})
 * at runtime, a silently-dead scope caught here at load instead. Shared by
 * entity fields, relation attributes, and artifact-metadata sub-fields, which
 * all carry the same {@link FieldDef} shape.
 */
export function assertArtifactTypesScoped(where: string, name: string, field: FieldDef, declaredArtifactTypes: Set<string>): void {
  assert(
    field.artifactTypes === undefined || field.type === "artifactRef" || field.type === "artifactRef[]",
    `${where} field ${JSON.stringify(name)} declares artifactTypes but is not an artifactRef field`,
  );
  if (field.artifactTypes === undefined) return;
  assert(
    field.artifactTypes.length > 0,
    `${where} field ${JSON.stringify(name)} declares an empty artifactTypes — no artifact type could ever satisfy it`,
  );
  for (const t of field.artifactTypes) {
    assert(
      declaredArtifactTypes.has(t),
      `${where} field ${JSON.stringify(name)} artifactTypes references undeclared artifact type ${JSON.stringify(t)}`,
    );
  }
}

/**
 * Field types a declarative `format` can describe. A format is a hint about how
 * to read TEXT, so on a boolean, number, date, enum or artifactRef it would be
 * config no renderer could act on — rejected at load rather than ignored later.
 */
const FORMATTABLE_TYPES: ReadonlySet<FieldType> = new Set<FieldType>(["string", "string[]"]);

/**
 * A declared `format` must sit on a field whose type it can describe.
 *
 * Applied to EVERY `FieldDef` carrier, not just entity fields: the schema
 * resolves relation `attributes` and artifact `metadata` to the same
 * `$defs/fieldDef`, so all three would otherwise accept a format the contract
 * says is invalid — and artifact metadata is projected onto the wire. Same
 * placement discipline as {@link assertArtifactTypesScoped}, which is wired into
 * all three for the same reason.
 */
export function assertFieldFormatScoped(where: string, name: string, field: FieldDef): void {
  if (field.format === undefined) return;
  assert(
    FORMATTABLE_TYPES.has(field.type),
    `${where} field '${name}': format '${field.format}' is not valid on type '${field.type}'`,
  );
}
