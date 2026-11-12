/**
 * @file src/profile/validate-workflows.ts
 * @description Workflows: slug-safe, non-reserved keys; stages with slug-safe,
 * unique ids, declared read and write endpoints, declared artifact writes and
 * well-formed gates and executors; previous stage ids that stay retired; and a
 * projection file confined under the workflow projection directory.
 */

import type { EntityTypeDef, WorkflowDef, WorkflowStageDef } from "./types.js";
import { isSlugSafe } from "./identity.js";
import { PROFILE_V1_RESERVED_VERBS } from "./reserved-verbs.js";
import { assert } from "./validate-helpers.js";
import { validateEntityDirectory, isInsidePosixDir } from "./paths.js";
import { WORKFLOW_PROJECTION_DIR } from "../utils/constants.js";
import { validateStageExecutor, validateStageGate, validateSubjectGate } from "./validate-stage-authority.js";
import { RESERVED_ROOTS } from "./paths.js";

/** Every stage `reads`/`writes` entry must reference a DECLARED entity type. */
function validateStageEndpoints(wf: string, stage: WorkflowStageDef, entities: Set<string>): void {
  for (const endpoint of [...stage.reads, ...stage.writes]) {
    assert(entities.has(endpoint), `workflow '${wf}' stage '${stage.id}' endpoint '${endpoint}' is not a declared entity type`);
  }
}

/** Every stage `artifactWrites` entry must reference a DECLARED artifact type. */
function validateStageArtifactWrites(wf: string, stage: WorkflowStageDef, artifactTypes: Set<string>): void {
  for (const artifactType of stage.artifactWrites ?? []) {
    assert(artifactTypes.has(artifactType), `workflow '${wf}' stage '${stage.id}' artifactWrites '${artifactType}' is not a declared artifact type`);
  }
}

/**
 * A stage id must be slug-safe, unique within its workflow, and its gate
 * well-formed. A `trust:` stage gate ADDITIONALLY requires a producible output —
 * a declared entity write OR an artifact write (P-A): a trust gate is
 * satisfiable ONLY by a stage output, so a `trust:`-gated stage with neither
 * would load but be permanently stuck at runtime — rejected at load (M2).
 * `human:`/`agent:` gates are satisfied by approval regardless of output, so
 * they stay valid with no writes/artifactWrites.
 */
function validateStage(
  wf: string, stage: WorkflowStageDef, seen: Set<string>, priorStages: WorkflowStageDef[],
  entities: Record<string, EntityTypeDef>, artifactTypes: Set<string>,
): void {
  assert(isSlugSafe(stage.id), `workflow '${wf}' stage id '${stage.id}' must be slug-safe`);
  assert(!seen.has(stage.id), `workflow '${wf}' has a duplicate stage id '${stage.id}'`);
  seen.add(stage.id);
  validateStageEndpoints(wf, stage, new Set(Object.keys(entities)));
  validateStageArtifactWrites(wf, stage, artifactTypes);
  validateStageExecutor(wf, stage, entities, artifactTypes);
  validateStageGate(wf, stage);
  validateSubjectGate(wf, stage, priorStages, artifactTypes);
}

/**
 * Validate the stage-rename `previousIds` declarations across one workflow
 * (fail-closed). Each previousId must be slug-safe; a previousId may NOT equal any
 * CURRENT stage id in the same workflow (a rename replaces a REMOVED id, never
 * aliases a live one); and no two stages may share the same previousId (the old→new
 * mapping must be unambiguous). `currentIds` is the set of declared stage ids.
 */
function assertStagePreviousIds(wf: string, def: WorkflowDef, currentIds: Set<string>): void {
  const claimedBy = new Map<string, string>();
  for (const stage of def.stages) {
    for (const previousId of stage.previousIds ?? []) {
      assert(isSlugSafe(previousId), `workflow '${wf}' stage '${stage.id}' previousId '${previousId}' must be slug-safe`);
      assert(!currentIds.has(previousId), `workflow '${wf}' stage '${stage.id}' previousId '${previousId}' is also a current stage id`);
      const prior = claimedBy.get(previousId);
      assert(prior === undefined, `workflow '${wf}' previousId '${previousId}' is claimed by both stage '${prior}' and stage '${stage.id}'`);
      claimedBy.set(previousId, stage.id);
    }
  }
}

/**
 * The reserved roots a `projectionFile` is checked against. The projection
 * subtree itself ({@link WORKFLOW_PROJECTION_DIR}) is EXCLUDED here: a projection
 * legitimately lives INSIDE it (so it must not be rejected as overlapping a
 * reserved root), while {@link validateProjectionFile} separately REQUIRES the
 * target be confined under that subtree.
 */
const PROJECTION_RESERVED_ROOTS = RESERVED_ROOTS.filter((root) => root !== WORKFLOW_PROJECTION_DIR);

/**
 * Confine an optional workflow `projectionFile` to the RESERVED projection
 * subtree so it can never clobber an authored wiki page. The schema accepts an
 * unconstrained string, so an unvalidated `"../../etc/passwd"`, `/etc/passwd`, or
 * even a clean-but-hostile `wiki/concepts/important.md` would later be written to.
 * Two layered checks (fail-closed at profile LOAD): (1) the same lexical
 * confinement entity directories use ({@link validateEntityDirectory}) rejects
 * absolute paths, `..`/NUL segments, and anything not under `wiki/`; (2) the
 * canonical target MUST sit under {@link WORKFLOW_PROJECTION_DIR} (the only place
 * a projection may write), so a clean `wiki/`-path that targets a real page is
 * rejected — the page-clobber vector is gone at validation.
 */
function validateProjectionFile(wf: string, def: WorkflowDef): void {
  if (def.projectionFile === undefined) return;
  let canonical: string;
  try {
    canonical = validateEntityDirectory(def.projectionFile, PROJECTION_RESERVED_ROOTS);
  } catch (err) {
    assert(false, `workflow '${wf}' projectionFile is not a safe path under 'wiki/': ${(err as Error).message}`);
    return; // unreachable: assert(false) throws; satisfies the definite-assignment check
  }
  assert(
    isInsidePosixDir(canonical, WORKFLOW_PROJECTION_DIR),
    `workflow '${wf}' projectionFile must live under '${WORKFLOW_PROJECTION_DIR}/': ${def.projectionFile}`,
  );
}

/**
 * Validate the optional `workflows` block (fail-closed). Each workflow key must
 * be slug-safe and must NOT collide with a reserved core CLI verb (see
 * {@link PROFILE_V1_RESERVED_VERBS}). Within a workflow, every stage id must be
 * slug-safe and unique, every `reads`/`writes` entry must reference a declared
 * entity type, any `gate` must match `<kind>:<id>` for kind ∈ {trust,human,agent},
 * any stage `previousIds` rename source must be slug-safe, must not alias a current
 * stage id, and must be claimed by at most one stage, and any `projectionFile` must
 * be a confined path under `wiki/`. Every stage `artifactWrites` entry must
 * reference a declared artifact type (`declaredArtifactTypes`, shared with
 * {@link validateEntities}/{@link validateRelations}). This is SCHEMA +
 * VALIDATION only: workflows are never executable and carry no run state in
 * this slice.
 */
export function validateWorkflows(
  workflows: Record<string, WorkflowDef> | undefined,
  entities: Record<string, EntityTypeDef>,
  declaredArtifactTypes: Set<string>,
): void {
  if (!workflows) return;
  const declared = new Set(Object.keys(entities));
  for (const [wf, def] of Object.entries(workflows)) {
    assert(isSlugSafe(wf), `workflow key '${wf}' must be slug-safe`);
    assert(!PROFILE_V1_RESERVED_VERBS.has(wf), `workflow id '${wf}' is reserved — it collides with a core CLI verb`);
    const seen = new Set<string>();
    const priorStages: WorkflowStageDef[] = [];
    for (const stage of def.stages) {
      validateStage(wf, stage, seen, priorStages, entities, declaredArtifactTypes);
      priorStages.push(stage);
    }
    assertStagePreviousIds(wf, def, seen);
    validateProjectionFile(wf, def);
  }
}
