/**
 * Fail-closed v0 profile validator — schema-first, two-phase.
 *
 * `validateProfile` is the single enforcing gate between an untrusted raw
 * profile object and a typed `ProfilePack`. It is all-or-nothing: ANY violation
 * throws `ProfileValidationError` and nothing is returned.
 *
 *  1. STRUCTURAL (ajv): the published JSON Schema at
 *     `./schema/profile.v1.schema.json` (draft 2020-12), compiled once in
 *     `schema-validator.ts`, enforces structure, types, enums and
 *     `additionalProperties`. The schema is the single source of truth for them.
 *  2. SEMANTIC: what JSON Schema cannot express, in this order:
 *     - no `extends` inheritance (here);
 *     - entity types (`validate-entities.ts`, with `validate-lifecycle.ts`,
 *       `validate-extract.ts` and `validate-field-defs.ts`);
 *     - relation types (here) and lifecycle relation-count preconditions
 *       (`validate-relation-requirements.ts`);
 *     - workflows (`validate-workflows.ts`) and workflow actions
 *       (`validate-workflow-actions.ts`);
 *     - artifact types (here, with `validate-artifact-members.ts`);
 *     - connector bindings (here);
 *     - lifecycle required-artifact preconditions and their ordering
 *       (`validate-artifact-requirements.ts`);
 *     - and, in `validateProfile` only, reserved profile ids, directories and
 *       entity type names.
 *
 * Validation NEVER mutates the caller's input: the raw object is cloned up
 * front and only the clone is canonicalized and returned. `validateProfileShape`
 * runs both phases EXCEPT the reserved-id rejection, so the built-in default
 * profile (`profileId: "default"`) can be proven to satisfy the same structural
 * contract that disk profiles claiming `"default"` are rejected against.
 * Unreachable lifecycle states are collected as warnings, not errors.
 */

import type { ProfilePack, EntityTypeDef, RelationTypeDef } from "./types.js";
import { isSlugSafe } from "./identity.js";
import { assert, isDeclared } from "./validate-helpers.js";
import { validateWorkflowActions } from "./validate-workflow-actions.js";
import { assertRelationRequirementsDeclared } from "./validate-relation-requirements.js";
import { assertArtifactRequirementsDeclared, collectArtifactOrderingWarnings } from "./validate-artifact-requirements.js";
import { assertStructurallyValid } from "./schema-validator.js";
import { CONCEPTS_DIR, QUERIES_DIR, TIMELINE_DIR } from "../utils/constants.js";
import { isValidArtifactFileName, MAX_ARTIFACT_BYTES } from "../artifacts/name.js";
import { getConnectorDef } from "../connectors/registry.js";
import { assertMembersDef } from "./validate-artifact-members.js";
import { assertArtifactTypesScoped, assertFieldDefFinite, assertFieldFormatScoped } from "./validate-field-defs.js";
import { validateEntities } from "./validate-entities.js";
import { validateWorkflows } from "./validate-workflows.js";

export { ProfileValidationError } from "./errors.js";

/**
 * Profile ids reserved by the system. `default` names the in-memory built-in
 * profile, which never loads from disk through `validateProfile` — so a disk
 * profile claiming it is always rejected. `validateProfileShape` skips this gate
 * so the built-in default can be proven structurally well-formed.
 */
const RESERVED_PROFILE_IDS = new Set(["default"]);

/**
 * Entity directories reserved for the built-in DEFAULT profile and for the
 * compiler's generated timeline. A disk profile may not declare an entity at
 * any of them, otherwise one physical file would carry two identities — a
 * legacy `pages: concepts/<slug>` AND a `profile.entityPages: <type>/<slug>`,
 * or a typed record that the next compile's timeline step overwrites or
 * deletes. `DEFAULT_PROFILE` legitimately uses the first two, so this gate
 * lives in `validateProfile` (disk) only, NOT `validateProfileShape`.
 */
const RESERVED_DEFAULT_DIRS = new Set([CONCEPTS_DIR, QUERIES_DIR, TIMELINE_DIR]);

/** The result of a successful validation: the typed pack plus any warnings. */
export interface ProfileValidationResult {
  profile: ProfilePack;
  warnings: string[];
}

/**
 * Reject the unsupported `extends` inheritance with a clear message. ajv already
 * rejects a non-empty `extends` via `maxItems: 0`, but the semantic message
 * names inheritance explicitly (the schema's wording is generic).
 */
function rejectInheritance(raw: ProfilePack): void {
  const ext = raw.extends;
  assert(
    ext === undefined || ext.length === 0,
    "profile inheritance (extends) is not supported in this release",
  );
}

/** Every from/to endpoint must reference a DECLARED entity type. */
function validateRelationEndpoints(rel: string, def: RelationTypeDef, entities: Set<string>): void {
  assert(def.from.length > 0, `relation '${rel}' has an empty 'from' endpoint list`);
  assert(def.to.length > 0, `relation '${rel}' has an empty 'to' endpoint list`);
  for (const endpoint of [...def.from, ...def.to]) {
    assert(entities.has(endpoint), `relation '${rel}' endpoint '${endpoint}' is not a declared entity type`);
  }
}

/** requiredAttributes entries must be declared keys in `attributes`; attrs finite. */
function validateRelationAttributes(rel: string, def: RelationTypeDef, declaredArtifactTypes: Set<string>): void {
  const attributes = def.attributes ?? {};
  for (const [name, field] of Object.entries(attributes)) {
    assertFieldDefFinite(`relation '${rel}' attribute '${name}'`, field);
    assertArtifactTypesScoped(`relation '${rel}'`, name, field, declaredArtifactTypes);
    assertFieldFormatScoped(`relation '${rel}'`, name, field);
  }
  for (const name of def.requiredAttributes ?? []) {
    assert(isDeclared(attributes, name), `relation '${rel}' requiredAttributes references undeclared attribute '${name}'`);
  }
}

/**
 * Validate the optional `relations` block (fail-closed). Each relation-type key
 * must be slug-safe; `from`/`to` must be non-empty and reference declared entity
 * types; `direction` is schema-enforced to `directed`/`symmetric`; attribute
 * FieldDefs must be finite and every `requiredAttributes` entry must name a
 * declared attribute. Symmetric-pair canonicalization is a STORE-time concern
 * (a later slice), so only the def shape is validated here.
 */
function validateRelations(
  relations: Record<string, RelationTypeDef> | undefined,
  entities: Record<string, EntityTypeDef>,
  declaredArtifactTypes: Set<string>,
): void {
  if (!relations) return;
  const declared = new Set(Object.keys(entities));
  for (const [rel, def] of Object.entries(relations)) {
    assert(isSlugSafe(rel), `relation type key '${rel}' must be slug-safe`);
    validateRelationEndpoints(rel, def, declared);
    validateRelationAttributes(rel, def, declaredArtifactTypes);
  }
}

/**
 * Semantic checks the JSON schema cannot express for artifact type declarations.
 * `declaredArtifactTypes` is threaded in (rather than recomputed from `profile`)
 * so this shares the exact same declared set as {@link validateEntities} /
 * {@link validateRelations} — a metadata sub-field's `artifactTypes` scope is
 * judged against the same profile-wide truth.
 */
function validateArtifacts(profile: ProfilePack, declaredArtifactTypes: Set<string>): void {
  const artifacts = profile.artifacts;
  if (!artifacts) return;
  for (const [id, def] of Object.entries(artifacts)) {
    assert(isSlugSafe(id), `artifact type id ${JSON.stringify(id)} is not slug-safe`);
    assert(isValidArtifactFileName(def.fileName, def.contentKind),
      `artifact ${JSON.stringify(id)} fileName ${JSON.stringify(def.fileName)} is not a valid ${def.contentKind} filename`);
    assert(def.maxBytes >= 1 && def.maxBytes <= MAX_ARTIFACT_BYTES,
      `artifact ${JSON.stringify(id)} maxBytes must be in 1..${MAX_ARTIFACT_BYTES}`);
    assert(def.contentKind === "json" || def.metadata === undefined,
      `artifact ${JSON.stringify(id)} metadata is permitted only when contentKind is "json"`);
    if (def.members !== undefined) assertMembersDef(id, def);
    // The SHARED FieldType union includes artifactRef, which would make `metadata`
    // a third consumer of it — but Layer B and ref-health never run on artifact
    // bodies, so a nested artifact→artifact ref would be silently half-supported.
    // Refuse at load. A metadata sub-field is also a THIRD `artifactTypes` carrier
    // (alongside entity fields and relation attributes) reachable by no other
    // check, so it gets the same placement scrutiny here (the declared/empty
    // branches are structurally unreachable for metadata — the guard above
    // already rejects artifactRef-typed metadata fields before this call runs,
    // and v0 has no nested artifactRef — but wired for forward-compat).
    for (const [field, fd] of Object.entries(def.metadata ?? {})) {
      assert(fd.type !== "artifactRef" && fd.type !== "artifactRef[]",
        `artifact ${JSON.stringify(id)} metadata field ${JSON.stringify(field)} is artifactRef-typed — nested artifact refs are not supported in v0`);
      assertArtifactTypesScoped(`artifact ${JSON.stringify(id)} metadata`, field, fd, declaredArtifactTypes);
      assertFieldFormatScoped(`artifact ${JSON.stringify(id)} metadata`, field, fd);
    }
  }
}

/** Validate pure-data connector bindings against the static connector registry and entity fields. */
function validateConnectors(profile: ProfilePack): void {
  for (const [connectorId, binding] of Object.entries(profile.connectors ?? {})) {
    assert(isSlugSafe(connectorId), `connector id '${connectorId}' must be slug-safe`);
    const def = getConnectorDef(connectorId);
    assert(def !== undefined, `connector '${connectorId}' is not registered`);
    const entity = isDeclared(profile.entities, binding.entityType) ? profile.entities[binding.entityType] : undefined;
    assert(entity !== undefined, `connector '${connectorId}' entityType '${binding.entityType}' is not declared`);
    const draftFields = new Set(def.draftFields);
    for (const [draftField, entityField] of Object.entries(binding.fields)) {
      assert(draftFields.has(draftField), `connector '${connectorId}' draft field '${draftField}' is not emitted by connector '${connectorId}'`);
      assert(isDeclared(entity.fields, entityField), `connector '${connectorId}' entity field '${entityField}' is not declared on '${binding.entityType}'`);
    }
    if (binding.contentField !== undefined) {
      assert(draftFields.has(binding.contentField), `connector '${connectorId}' contentField '${binding.contentField}' is not emitted by connector '${connectorId}'`);
    }
  }
}

/**
 * Validate a raw profile's SHAPE: the ajv structural gate plus every semantic
 * check, EXCEPT the reserved profileId rejection. The built-in default profile
 * passes this; disk profiles claiming `"default"` are still rejected by
 * `validateProfile`. Non-mutating: clones the input and returns the canonical
 * clone.
 */
export function validateProfileShape(raw: unknown): ProfileValidationResult {
  assertStructurallyValid(raw);
  const profile = structuredClone(raw) as ProfilePack;
  rejectInheritance(profile);
  const declaredArtifactTypes = new Set(Object.keys(profile.artifacts ?? {}));
  const warnings = validateEntities(profile.entities, declaredArtifactTypes);
  validateRelations(profile.relations, profile.entities, declaredArtifactTypes);
  assertRelationRequirementsDeclared(profile.entities, profile.relations);
  validateWorkflows(profile.workflows, profile.entities, declaredArtifactTypes);
  validateWorkflowActions(profile.workflowActions, profile.workflows, profile.entities);
  validateArtifacts(profile, declaredArtifactTypes);
  validateConnectors(profile);
  assertArtifactRequirementsDeclared(profile.entities, profile.artifacts);
  warnings.push(...collectArtifactOrderingWarnings(profile.workflows, profile.entities));
  return { profile, warnings };
}

/**
 * Validate a raw, untrusted profile object into a typed `ProfilePack`.
 *
 * Two-phase and fail-closed: the ajv schema gate runs first, then the semantic
 * checks. Adds the disk-only reserved-id rejection on top of
 * `validateProfileShape`. Never mutates the caller's input; returns the
 * canonical clone with any (non-fatal) warnings.
 */
export function validateProfile(raw: unknown): ProfileValidationResult {
  const result = validateProfileShape(raw);
  assert(!RESERVED_PROFILE_IDS.has(result.profile.profileId), `profileId '${result.profile.profileId}' is reserved`);
  rejectReservedDefaultDirs(result.profile);
  rejectReservedEntityTypeNames(result.profile);
  return result;
}

/**
 * Reject any entity whose canonical directory is one of the default profile's
 * reserved dirs (`wiki/concepts` / `wiki/queries`). Operates on the canonical
 * directory written back by {@link validateProfileShape}, so `.`-padded aliases
 * are caught too.
 */
function rejectReservedDefaultDirs(profile: ProfilePack): void {
  for (const [entityType, def] of Object.entries(profile.entities)) {
    assert(
      !RESERVED_DEFAULT_DIRS.has(def.directory),
      `entity '${entityType}' directory '${def.directory}' is reserved for the default profile`,
    );
  }
}

/**
 * The basename set of directories reserved for the default profile, used to
 * guard entity TYPE NAMES. An entity type named `concepts`, `queries` or `timeline` would
 * mint `EntityId "concepts/<slug>"` which collides with the legacy
 * `PageId "concepts/<slug>"` — corrupting the viewer graph and ranking map.
 * Derived from `RESERVED_DEFAULT_DIRS` so no strings are hard-coded here.
 */
const RESERVED_ENTITY_TYPE_NAMES = new Set(
  [...RESERVED_DEFAULT_DIRS].map((dir) => dir.split("/").at(-1) as string),
);

/**
 * Reject any entity TYPE NAME equal to a reserved default-profile page
 * directory basename. Disk-only guard (lives in `validateProfile`): the built-in
 * `DEFAULT_PROFILE` legitimately uses these names, so `validateProfileShape`
 * must not enforce this.
 */
function rejectReservedEntityTypeNames(profile: ProfilePack): void {
  for (const entityType of Object.keys(profile.entities)) {
    assert(
      !RESERVED_ENTITY_TYPE_NAMES.has(entityType),
      `entity type name '${entityType}' is reserved — it collides with the default profile's page directory name`,
    );
  }
}
