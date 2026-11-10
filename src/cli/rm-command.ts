/**
 * @file Registers `rm`: delete a source and the pages derived only from it.
 */

import type { Command } from "commander";
import { rmCommand } from "@atomicstrata/llmwiki-core/commands/rm";

/** Register the `rm` command on `program`. */
export function registerRmCommand(program: Command): void {
  program
    .command("rm <source>")
    .description("Delete a source and the concept pages derived exclusively from it")
    .option("--dry-run", "Print what would be deleted and kept without changing anything")
    .action(async (source: string, options: { dryRun?: boolean }) => {
      try {
        const code = await rmCommand(source, { dryRun: options.dryRun });
        process.exit(code);
      } catch (err) {
        console.error(`\x1b[31mError:\x1b[0m ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}
