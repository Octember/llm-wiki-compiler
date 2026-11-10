/**
 * @file Registers `visualize`: write Obsidian graph configuration and Canvas maps.
 */

import type { Command } from "commander";
import visualizeCommand, { type VisualizeOptions } from "@atomicstrata/llmwiki-core/modules/commands/visualize";

/** Register the `visualize` command on `program`. */
export function registerVisualizeCommand(program: Command): void {
  program
    .command("visualize")
    .description("Create Obsidian graph configuration and Canvas knowledge maps without overwriting edits")
    .option("--focus <nodeId>", "Centre the canvas on one node, e.g. papers/alpha")
    .option("--depth <hops>", "Hops around --focus (default 1)")
    .action(async (options: VisualizeOptions) => {
      try {
        process.exitCode = await visualizeCommand(process.cwd(), options);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });
}
