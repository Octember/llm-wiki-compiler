/**
 * @file src/profile/validate-entities.ts
 * @description An entity type's own definition: a slug-safe key, a canonical
 * directory unique among types and clear of reserved roots, finite numbers, its
 * field definitions, its title field, required fields, content tiers,
 * extraction opt-in and lifecycle.
 */

import type { EntityTypeDef } from "./types.js";
import { BODY_TIER_TOKEN } from "./types.js";
import { isSlugSafe } from "./identity.js";
import { assert, isDeclared } from "./validate-helpers.js";
import { RESERVED_ROOTS, validateEntityDirectory } from "./paths.js";
import { validateExtract, validateRequiredFields } from "./validate-extract.js";
import { validateLifecycle } from "./validate-lifecycle.js";
import { assertArtifactTypesScoped, assertFieldDefFinite, assertFieldFormatScoped } from "./validate-field-defs.js";

/** Reject any non-finite numeric field-def or retrieval value defensively. */
function assertFiniteNumbers(entityType: string, def: EntityTypeDef): void {
  for (const [name, field] of Object.entries(def.fields ?? {})) {
    assertFieldDefFinite(`entity '${entityType}' field '${name}'`, field);
  }
  const weight = def.retrieval?.defaultWeight;
  if (typeof weight === "number") {
    assert(Number.isFinite(weight), `entity '${entityType}' retrieval.defaultWeight must be finite`);
  }
}

/**
 * Reject `artifactTypes` declared on any of an entity type's fields that is not
 * `artifactRef` / `artifactRef[]`, plus scope-contents violations — see
 * {@link assertArtifactTypesScoped}.
 */
function validateArtifactTypesScope(entityType: string, def: EntityTypeDef, declaredArtifactTypes: Set<string>): void {
  for (const [name, field] of Object.entries(def.fields ?? {})) {
    assertArtifactTypesScoped(`entity '${entityType}'`, name, field, declaredArtifactTypes);
  }
}

/** Every declared `format` on an entity's fields must describe a text type. */
function validateFieldFormats(entityType: string, def: EntityTypeDef): void {
  for (const [name, field] of Object.entries(def.fields ?? {})) {
    assertFieldFormatScoped(`entity '${entityType}'`, name, field);
  }
}

/**
 * `titleField` must name a DECLARED field that can actually hold a title.
 *
 * It is schema-typed as a bare string and was checked against nothing, so a
 * profile could title by a field it never declared and load clean — pages would
 * then silently show their slug with no diagnostic on any surface, which is the
 * failure mode the field exists to prevent.
 *
 * Only `string` qualifies. A number, boolean, date or enum is not a name; an
 * `artifactRef` is a pointer to bytes; and `slug` is excluded deliberately,
 * because the slug is already what an untitled page falls back to, so titling by
 * one would be a no-op dressed as a choice. `string[]` is excluded too: a title
 * is one value, and picking an element would be a rule the profile never stated.
 *
 * The declared-field test is confined to OWN properties. `titleField` comes from
 * profile JSON and indexes a plain object, so a bare read resolves inherited
 * names: `titleField: "constructor"` returned `Object.prototype.constructor`,
 * slipped past the undeclared-field check, and was rejected by the type check
 * below as "must be a 'string' field, not 'undefined'" — the right outcome
 * reported as the wrong problem, telling an author their field is mistyped when
 * it does not exist.
 */
function validateTitleField(entityType: string, def: EntityTypeDef): void {
  if (def.titleField === undefined) return;
  const fields = def.fields ?? {};
  assert(
    Object.hasOwn(fields, def.titleField),
    `entity '${entityType}' titleField '${def.titleField}' is not a declared field`,
  );
  const field = fields[def.titleField];
  assert(
    field.type === "string",
    `entity '${entityType}' titleField '${def.titleField}' must be a 'string' field, not '${field.type}'`,
  );
}

/**
 * Every `contentTiers` entry must be a declared field OR the reserved
 * {@link BODY_TIER_TOKEN}, and entries must be unique. An omitted or empty
 * `contentTiers` is valid (means "no projection"). A field literally named
 * `body` COLLIDES with the reserved token — the projection's `body` token always
 * emits the page body, so a declared `body` field could never be projected; that
 * ambiguity is rejected at load rather than silently misdirecting to the body.
 */
function validateContentTiers(entityType: string, def: EntityTypeDef): void {
  const seen = new Set<string>();
  for (const entry of def.contentTiers ?? []) {
    const isDeclaredOrBody = isDeclared(def.fields, entry) || entry === BODY_TIER_TOKEN;
    assert(isDeclaredOrBody, `entity '${entityType}' contentTiers entry '${entry}' must be a declared field or the reserved 'body' token`);
    assert(!(entry === BODY_TIER_TOKEN && isDeclared(def.fields, BODY_TIER_TOKEN)),
      `entity '${entityType}' declares a field named '${BODY_TIER_TOKEN}', which collides with the reserved contentTiers 'body' token (always the page body); rename the field`);
    assert(!seen.has(entry), `entity '${entityType}' contentTiers has duplicate entry '${entry}'`);
    seen.add(entry);
  }
}

/** The result of validating one entity: its canonical dir plus any warnings. */
interface EntityValidation {
  canonicalDirectory: string;
  warnings: string[];
}

/**
 * Validate one entity type's SEMANTICS (structure is already ajv-checked).
 * Canonicalizes and confines its directory (returning the canonical form), and
 * validates finite numbers, requiredFields references, and lifecycle.
 */
function validateEntity(entityType: string, def: EntityTypeDef, declaredArtifactTypes: Set<string>): EntityValidation {
  const canonicalDirectory = validateEntityDirectory(def.directory, RESERVED_ROOTS);
  assertFiniteNumbers(entityType, def);
  validateArtifactTypesScope(entityType, def, declaredArtifactTypes);
  validateRequiredFields(entityType, def);
  validateTitleField(entityType, def);
  validateFieldFormats(entityType, def);
  validateContentTiers(entityType, def);
  validateExtract(entityType, def, canonicalDirectory);
  const warnings = def.lifecycle ? validateLifecycle(entityType, def.lifecycle, def.fields) : [];
  return { canonicalDirectory, warnings };
}

/**
 * Validate all entities, enforcing slug-safe type keys and CANONICAL directory
 * uniqueness, writing each canonical directory back ON THE CLONE so downstream
 * scanning uses the same path uniqueness was checked against. Returns warnings.
 */
export function validateEntities(entities: Record<string, EntityTypeDef>, declaredArtifactTypes: Set<string>): string[] {
  const warnings: string[] = [];
  const dirs = new Map<string, string>();
  for (const [entityType, def] of Object.entries(entities)) {
    assert(isSlugSafe(entityType), `entity type key '${entityType}' must be slug-safe`);
    const { canonicalDirectory, warnings: entityWarnings } = validateEntity(entityType, def, declaredArtifactTypes);
    warnings.push(...entityWarnings);
    const prior = dirs.get(canonicalDirectory);
    assert(prior === undefined, `entities '${prior}' and '${entityType}' share the same directory '${canonicalDirectory}'`);
    dirs.set(canonicalDirectory, entityType);
    def.directory = canonicalDirectory;
  }
  return warnings;
}
