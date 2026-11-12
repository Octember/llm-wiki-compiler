/**
 * @file src/profile/validate-extract.ts
 * @description Profile checks on an entity type's field references: its
 * `requiredFields` and an extraction opt-in (`extract`) must name declared
 * fields, and an extracted type must live at `wiki/<type>` and leave the keys
 * extraction answers for every record to extraction.
 */

import type { EntityTypeDef } from "./types.js";
import { assert } from "./validate-helpers.js";

/** Keys every extracted record answers, so an extracted type cannot declare them as fields. */
const EXTRACTED_RECORD_KEYS = ["name", "writtenAs", "lines"];

/** Each of `names`, listed under `label` (`requiredFields`, `extract.fields`), must be a declared field. */
function assertDeclaredFields(entityType: string, def: EntityTypeDef, label: string, names: Iterable<string>): void {
  for (const name of names) {
    assert(def.fields?.[name] !== undefined, `entity '${entityType}' ${label} entry '${name}' is not a declared field`);
  }
}

/** Every requiredFields entry must reference a declared field. */
export function validateRequiredFields(entityType: string, def: EntityTypeDef): void {
  assertDeclaredFields(entityType, def, "requiredFields", def.requiredFields ?? []);
}

/**
 * An extraction opt-in must name only declared fields, and its type must live
 * at `wiki/<type>`: compile writes extracted records through the planner's typed
 * target, which always places a page at `wiki/<entityType>/`, so any other
 * directory would write pages the type's own scans never read.
 */
export function validateExtract(entityType: string, def: EntityTypeDef, canonicalDirectory: string): void {
  if (!def.extract) return;
  assertDeclaredFields(entityType, def, "extract.fields", Object.keys(def.extract.fields ?? {}));
  assert(canonicalDirectory === `wiki/${entityType}`, `entity '${entityType}' with extract must use directory 'wiki/${entityType}'`);
  for (const reserved of EXTRACTED_RECORD_KEYS) {
    assert(def.fields?.[reserved] === undefined, `entity '${entityType}' with extract cannot declare field '${reserved}': extraction answers it for every record`);
  }
}
