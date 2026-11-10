/**
 * @file Registers `recover`: revert a crashed compile's journal.
 */

import type { Command } from "commander";
import { recoverCommand } from "@atomicstrata/llmwiki-core/commands/recover";

/** Register the `recover` command on `program`. */
export function registerRecoverCommand(program: Command): void {
  program
    .command("recover")
    .description("Recover an incomplete compile (revert a crashed compile's journal) without a full recompile.")
    .action(async () => {
      try {
        await recoverCommand();
      } catch (err) {
        console.error(`\x1b[31mError:\x1b[0m ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}
