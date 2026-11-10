/**
 * @file Registers `status`: report project status.
 */

import type { Command } from "commander";
import statusCommand from "@atomicstrata/llmwiki-core/commands/status";

/** Register the `status` command on `program`. */
export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Report project status: page/source counts, stale and orphaned pages, pending changes, review queue, and state health")
    .option("--json", "Emit the status snapshot as JSON (same shape as the MCP wiki_status tool)")
    .action(async (options: { json?: boolean }) => {
      try {
        const code = await statusCommand({ json: options.json });
        process.exit(code);
      } catch (err) {
        console.error(`\x1b[31mError:\x1b[0m ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}
