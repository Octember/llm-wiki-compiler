/**
 * @file src/cli/workflow-commands.ts
 * @description Registers the `workflow` command group and its `action`/
 * `gate` sub-groups: run and inspect declarative profile workflows
 * (experimental). Kept together in one file because `action` and `gate`
 * are sub-commands of the same group-local `workflowCmd` const. Moved out
 * of `src/cli.ts` verbatim (pure move, no behavior change) as part of the
 * per-domain command split.
 */

import type { Command } from "commander";
import { runExitCodeCommand } from "@atomicstrata/llmwiki-core/cli/shared";

/** Register the read-only discovery/inspection commands: `list`, `show`, `events`. */
function registerWorkflowInspectionCommands(workflowCmd: Command): void {
  workflowCmd
    .command("list")
    .description("List workflows declared in the active profile")
    .action(async () => runExitCodeCommand(async () => {
      const { workflowListCommand } = await import("../commands/workflow.js");
      return workflowListCommand();
    }));

  workflowCmd
    .command("show <workflow-id>")
    .description("Show one workflow's stages (reads/writes/gates), projectionFile, and actions")
    .action(async (workflowId: string) => runExitCodeCommand(async () => {
      const { workflowShowCommand } = await import("../commands/workflow.js");
      return workflowShowCommand(workflowId);
    }));

  workflowCmd
    .command("events <run-id>")
    .description("Show one run's recorded audit events (the in-record events[] trail)")
    .action(async (runId: string) => runExitCodeCommand(async () => {
      const { workflowEventsCommand } = await import("../commands/workflow.js");
      return workflowEventsCommand(runId);
    }));
}

/** Register the run-position commands: `status`, `advance`, `project`. */
function registerWorkflowPositionCommands(workflowCmd: Command): void {
  workflowCmd
    .command("status [run-id]")
    .description("Show workflow run status (all runs, or one by id)")
    .action(async (runId?: string) => runExitCodeCommand(async () => {
      const { workflowStatusCommand } = await import("../commands/workflow.js");
      return workflowStatusCommand(runId);
    }));

  workflowCmd
    .command("advance <run-id>")
    .description("Advance a workflow run to the next stage")
    .action(async (runId: string) => runExitCodeCommand(async () => {
      const { workflowAdvanceCommand } = await import("../commands/workflow.js");
      return workflowAdvanceCommand(runId);
    }));

  workflowCmd
    .command("project <run-id>")
    .description("Write a DERIVED markdown projection of a run to its workflow's projectionFile")
    .action(async (runId: string) => runExitCodeCommand(async () => {
      const { workflowProjectCommand } = await import("../commands/workflow.js");
      return workflowProjectCommand(runId);
    }));
}

/** Register the run-lifecycle commands: `start`, `adapt`. */
function registerWorkflowRunCommands(workflowCmd: Command): void {
  workflowCmd
    .command("start <workflow>")
    .description("Start a new run of a declared workflow")
    .option("--input <pair...>", "Run input as key=value (repeatable)")
    .action(async (workflow: string, options: { input?: string[] }) => {
      try {
        const { workflowStartCommand } = await import("../commands/workflow.js");
        await workflowStartCommand(workflow, options);
      } catch (err) {
        console.error(`\x1b[31mError:\x1b[0m ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  workflowCmd
    .command("adapt [run-id]")
    .description("Adapt a run to the changed workflow def (--dry-run preview, --apply re-anchor)")
    .option("--dry-run", "Preview the adaptation plan(s) without changing anything (default)")
    .option("--apply", "Re-anchor the run to the active def (requires a run-id)")
    .option("--confirm", "Authorize a lossy adaptation (drop/cancel an unmappable stage)")
    .action(async (runId: string | undefined, options: { dryRun?: boolean; apply?: boolean; confirm?: boolean }) =>
      runExitCodeCommand(async () => {
        const { workflowAdaptCommand } = await import("../commands/workflow.js");
        return workflowAdaptCommand(runId, options);
      }),
    );
}

/** Register `submit`: record a stage output for the run's current stage. */
function registerWorkflowSubmitCommand(workflowCmd: Command): void {
  workflowCmd
    .command("submit <run-id>")
    .description("Submit a stage output (page/relation/lifecycle/artifact/human-input) for the current stage")
    .option("--kind <kind>", "Output kind: page | relation | lifecycle-transition | artifact | human-input")
    .option("--entity-type <t>", "Target entity type (page/lifecycle-transition)")
    .option("--artifact-type <type>", "artifact type (for --kind artifact)")
    .option("--slug <s>", "Target entity/artifact slug (page/lifecycle-transition/artifact)")
    .option("--body-file <path>", "Page/artifact body file (page/artifact)")
    .option("--to-state <state>", "Target lifecycle state (lifecycle-transition)")
    .option("--evidence-file <path>", "JSON evidence file (lifecycle-transition)")
    .option("--output-file <path>", "JSON payload file (relation/human-input)")
    .action(async (runId: string, options) => {
      try {
        const { workflowSubmitCommand } = await import("../commands/workflow.js");
        await workflowSubmitCommand(runId, options);
      } catch (err) {
        console.error(`\x1b[31mError:\x1b[0m ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}

/** Register the terminal-state commands: `cancel`, `fail`, `resume`. */
function registerWorkflowTerminationCommands(workflowCmd: Command): void {
  workflowCmd
    .command("cancel <run-id>")
    .description("Cancel an active workflow run")
    .action(async (runId: string) => {
      try {
        const { workflowCancelCommand } = await import("../commands/workflow.js");
        await workflowCancelCommand(runId);
      } catch (err) {
        console.error(`\x1b[31mError:\x1b[0m ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  workflowCmd
    .command("fail <run-id>")
    .description("Fail an active workflow run (move it to terminal failed; retryable via resume)")
    .option("--detail <reason>", "Human-readable failure reason recorded on the run-failed event")
    .action(async (runId: string, options: { detail?: string }) => {
      try {
        const { workflowFailCommand } = await import("../commands/workflow.js");
        await workflowFailCommand(runId, options);
      } catch (err) {
        console.error(`\x1b[31mError:\x1b[0m ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  workflowCmd
    .command("resume <run-id>")
    .description("Resume a failed workflow run (or report its position)")
    .action(async (runId: string) => {
      try {
        const { workflowResumeCommand } = await import("../commands/workflow.js");
        await workflowResumeCommand(runId);
      } catch (err) {
        console.error(`\x1b[31mError:\x1b[0m ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}

/** Register the `workflow action` sub-group: `list`, `show`, `run` (read-only discovery + execution). */
function registerWorkflowActionCommands(workflowCmd: Command): void {
  const actionCmd = workflowCmd.command("action").description("Discover declared workflow actions (read-only)");

  actionCmd
    .command("list")
    .description("List workflow actions declared in the active profile")
    .action(async () => runExitCodeCommand(async () => {
      const { workflowActionListCommand } = await import("../commands/workflow.js");
      return workflowActionListCommand();
    }));

  actionCmd
    .command("show <action-id>")
    .description("Show one workflow action and its effective permission per surface")
    .action(async (actionId: string) => runExitCodeCommand(async () => {
      const { workflowActionShowCommand } = await import("../commands/workflow.js");
      return workflowActionShowCommand(actionId);
    }));

  actionCmd
    .command("run <action-id>")
    .description("Run a declared workflow action under the composed authority")
    .option("--input <pair...>", "Action input as key=value (repeatable, string-typed)")
    .option("--input-json <json>", "Action inputs as a JSON object (typed; merged over --input)")
    .action(async (actionId: string, options: { input?: string[]; inputJson?: string }) => {
      try {
        const { workflowActionRunCommand } = await import("../commands/workflow.js");
        await workflowActionRunCommand(actionId, options);
      } catch (err) {
        console.error(`\x1b[31mError:\x1b[0m ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}

/** Register the `workflow gate` sub-group: `approve`. */
function registerWorkflowGateCommands(workflowCmd: Command): void {
  const gateCmd = workflowCmd.command("gate").description("Workflow gate operations");

  gateCmd
    .command("approve <run-id> <gate-id>")
    .description("Approve a human/agent gate on a run's current stage")
    .option("--actor <kind>", "Approving actor kind for a non-human gate: agent (default) or system (a human gate is approved via interactive confirmation)")
    .option("--actor-label <label>", "Optional human-readable actor label")
    .action(async (runId: string, gateId: string, options: { actor?: string; actorLabel?: string }) => {
      try {
        const { workflowGateApproveCommand } = await import("../commands/workflow.js");
        await workflowGateApproveCommand(runId, gateId, options);
      } catch (err) {
        console.error(`\x1b[31mError:\x1b[0m ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}

/** Register the `workflow` command group and its `action`/`gate` sub-groups on `program`. */
export function registerWorkflowCommands(program: Command): void {
  const workflowCmd = program
    .command("workflow")
    .description("Run and inspect declarative profile workflows (experimental)");

  registerWorkflowInspectionCommands(workflowCmd);
  registerWorkflowPositionCommands(workflowCmd);
  registerWorkflowRunCommands(workflowCmd);
  registerWorkflowSubmitCommand(workflowCmd);
  registerWorkflowTerminationCommands(workflowCmd);
  registerWorkflowActionCommands(workflowCmd);
  registerWorkflowGateCommands(workflowCmd);
}
