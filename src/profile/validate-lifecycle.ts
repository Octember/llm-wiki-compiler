/**
 * @file src/profile/validate-lifecycle.ts
 * @description An entity type's lifecycle: its `field` an enum whose values are
 * exactly its states, every state reachable, and each transition's evidence
 * fields declared, unreserved, and of a type the evidence gate can satisfy.
 * Unreachable states are returned as warnings.
 */

import type { FieldDef, FieldType, LifecycleDef } from "./types.js";
import { assert, isDeclared, lifecycleStates } from "./validate-helpers.js";

/**
 * Frontmatter keys a transition's evidence may NEVER set, even if declared: the
 * page `slug` (identity, runtime-dropped at transition time) is reserved here so
 * a profile can never declare an unsatisfiable evidence requirement. The
 * lifecycle `field` is reserved too (the transition WRITES it) and is added
 * dynamically in {@link assertEvidenceFieldsDeclared}.
 */
const RESERVED_EVIDENCE_KEYS = new Set(["slug"]);

/**
 * Field types the runtime evidence gate ({@link isEvidencePresent} in
 * `lifecycle.ts`) can satisfy: a non-empty string / number / slug / enum value
 * (a non-empty enum value is a non-empty string), or a non-empty `string[]`.
 * `boolean`, `object`, and `date` are EXCLUDED — the gate rejects booleans and
 * objects (a bare `true` proves only key presence, not justification), and a
 * `date` parses to a Date object the scalar gate cannot accept. A profile
 * declaring an evidence field of an excluded type would LOAD but its target state
 * could never be entered (a permanently dead state), so it is rejected at load.
 */
const EVIDENCE_COMPATIBLE_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  "string",
  "number",
  "integer",
  "slug",
  "string[]",
  "enum",
]);

/**
 * Reject a profile whose `transitionRequirements` declares any evidence field
 * that can never be satisfied via caller evidence — a RESERVED key (`slug`, or
 * the lifecycle `field` the transition writes), one that is NOT a DECLARED entity
 * field, OR one whose declared `type` the runtime evidence gate can never satisfy
 * (see {@link EVIDENCE_COMPATIBLE_TYPES} — `boolean`/`object`/`date` would make
 * the target state permanently unreachable). Requiring evidence fields to be
 * declared makes them first-class typed fields, so the field contract enforces
 * their type/content. Fails closed at profile LOAD.
 */
function assertEvidenceFieldsDeclared(where: string, lc: LifecycleDef, fields?: Record<string, FieldDef>): void {
  const declared = fields ?? {};
  for (const [state, evidenceFields] of Object.entries(lc.transitionRequirements ?? {})) {
    for (const field of evidenceFields) {
      const reserved = RESERVED_EVIDENCE_KEYS.has(field) || field === lc.field;
      assert(!reserved, `${where}: transitionRequirements['${state}'] uses reserved evidence field '${field}'`);
      assert(isDeclared(declared, field), `${where}: transitionRequirements['${state}'] evidence field '${field}' is not a declared field`);
      const type = declared[field].type;
      assert(
        EVIDENCE_COMPATIBLE_TYPES.has(type),
        `${where}: evidence field '${field}' has type '${type}' which can never satisfy the required-evidence gate`,
      );
    }
  }
}

/**
 * Validate a lifecycle FSM and return any unreachable states as warnings.
 *
 * Well-formedness (all throw on violation): the state set is the union of the
 * terminal states and every transition endpoint; initial ∈ states; terminal ⊆
 * states; terminal states have no outgoing transitions; every transition
 * endpoint ∈ states; every transitionRequirements key ∈ states; every
 * transitionRequirements evidence FIELD is a declared, non-reserved entity field
 * (see {@link assertEvidenceFieldsDeclared}); and if the lifecycle `field` maps
 * to a declared field, that field must be an enum whose values equal the state
 * set. Unreachable states are returned, not thrown.
 */
export function validateLifecycle(entityType: string, lc: LifecycleDef, fields?: Record<string, FieldDef>): string[] {
  const where = `entity '${entityType}' lifecycle`;
  const states = lifecycleStates(lc);
  assert(states.has(lc.initial), `${where}: initial state '${lc.initial}' is not in the state set`);
  for (const t of lc.terminal) {
    assert(states.has(t), `${where}: terminal state '${t}' is not in the state set`);
    assert(!(lc.transitions[t]?.length), `${where}: terminal state '${t}' has outgoing transitions`);
  }
  for (const key of Object.keys(lc.transitionRequirements ?? {})) {
    assert(states.has(key), `${where}: transitionRequirements references unknown state '${key}'`);
  }
  assertEvidenceFieldsDeclared(where, lc, fields);
  assertLifecycleEnum(where, lc, states, fields);
  return unreachableStates(lc, states).map((s) => `${where}: state '${s}' is unreachable from initial`);
}

/** If the lifecycle field maps to a declared field, it must be an enum = state set. */
function assertLifecycleEnum(where: string, lc: LifecycleDef, states: Set<string>, fields?: Record<string, FieldDef>): void {
  const field = fields?.[lc.field];
  if (!field) return;
  assert(field.type === "enum", `${where}: field '${lc.field}' must be an enum`);
  const values = new Set(field.enum ?? []);
  const sameSize = values.size === states.size;
  const covers = [...states].every((s) => values.has(s));
  assert(sameSize && covers, `${where}: enum values of '${lc.field}' must equal the lifecycle state set`);
}

/** Collect states with no path from `initial` via the transition graph. */
function unreachableStates(lc: LifecycleDef, states: Set<string>): string[] {
  const reached = new Set<string>([lc.initial]);
  const queue = [lc.initial];
  while (queue.length) {
    const current = queue.shift() as string;
    for (const next of lc.transitions[current] ?? []) {
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }
  return [...states].filter((s) => !reached.has(s));
}
