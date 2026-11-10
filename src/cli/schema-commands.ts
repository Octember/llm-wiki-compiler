/**
 * @file src/cli/schema-commands.ts
 * @description Registers the `schema` command group: inspect or initialize
 * the project's wiki schema config (`schema init`, `schema show`). Moved
 * out of `src/cli.ts` verbatim (pure move, no behavior change) as part of
 * the per-domain command split.
 */

import type { Command } from "commander";

/** Register the `schema` command group (`init`, `show`) on `program`. */
export function registerSchemaCommands(program: Command): void {
  const schemaCmd = program
    .command("schema")
    .description("Inspect or initialize the project's wiki schema config");

  schemaCmd
    .command("init")
    .description("Write a starter schema file to .llmwiki/schema.json")
    .action(async () => {
      try {
        const { schemaInitCommand } = await import("@atomicstrata/llmwiki-core/commands/schema");
        await schemaInitCommand();
      } catch (err) {
        console.error(`\x1b[31mError:\x1b[0m ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  schemaCmd
    .command("show")
    .description("Print the resolved schema for this project")
    .action(async () => {
      try {
        const { schemaShowCommand } = await import("@atomicstrata/llmwiki-core/commands/schema");
        await schemaShowCommand();
      } catch (err) {
        console.error(`\x1b[31mError:\x1b[0m ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}
