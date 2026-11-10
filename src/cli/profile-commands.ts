/**
 * @file src/cli/profile-commands.ts
 * @description Registers active-profile inspection plus the deterministic
 * beginner `profile init` authoring command.
 */

import type { Command } from "commander";
import { runExitCodeCommand } from "@atomicstrata/llmwiki-core/cli/shared";

/** Register the `profile` inspection and starter-authoring commands. */
export function registerProfileCommands(program: Command): void {
  const profileCmd = program
    .command("profile")
    .description("Create or inspect the active wiki profile");

  profileCmd
    .command("init")
    .description("Create a minimal editable profile in an empty project")
    .argument("<profile-id>", "Lowercase profile name using letters, numbers, and hyphens")
    .requiredOption("--entity <entity-type>", "First kind of page to model")
    .action(async (profileId: string, options: { entity: string }) =>
      runExitCodeCommand(async () => {
        const { profileInit } = await import("@atomicstrata/llmwiki-core/commands/profile");
        return profileInit(profileId, options);
      }),
    );

  profileCmd
    .command("show")
    .description("Print the active profile's id, digest, and source file")
    .action(async () => {
      try {
        const { profileShow } = await import("@atomicstrata/llmwiki-core/commands/profile");
        await profileShow();
      } catch (err) {
        console.error(`\x1b[31mError:\x1b[0m ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  registerProfileCheckCommands(profileCmd);
}

/** Register the read-only `profile validate` and `profile diff` checks. */
function registerProfileCheckCommands(profileCmd: Command): void {
  profileCmd
    .command("validate")
    .description("Validate the active profile; exit non-zero with a message if invalid")
    .action(async () => runExitCodeCommand(async () => {
      const { profileValidate } = await import("@atomicstrata/llmwiki-core/commands/profile");
      return profileValidate();
    }));

  profileCmd
    .command("diff")
    .description(
      "Classify on-disk pages over the disposition lattice for an explicit old → new profile pair (read-only; writes nothing)",
    )
    .option("--candidate <file>", "Diff the active profile (old) against an uninstalled candidate file (new)")
    .option("--from <file>", "Old profile for a pure offline diff (requires --to)")
    .option("--to <file>", "New profile for a pure offline diff (requires --from)")
    .action(async (options: { candidate?: string; from?: string; to?: string }) =>
      runExitCodeCommand(async () => {
        const { profileDiff } = await import("@atomicstrata/llmwiki-core/commands/profile");
        return profileDiff(options);
      }),
    );
}
