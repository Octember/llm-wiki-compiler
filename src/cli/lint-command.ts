/**
 * @file Registers `lint`: run rule-based quality checks against the wiki.
 */

import type { Command } from "commander";
import lintCommand from "@atomicstrata/llmwiki-core/commands/lint";

/** Register the `lint` command on `program`. */
export function registerLintCommand(program: Command): void {
  program
    .command("lint")
    .description("Run rule-based quality checks against the wiki")
    .option("--tiered", "Separate broken content, model judgements, and stale derived views")
    .option("--fix-preview", "Preview deterministic repairs without applying them")
    .option("--fix-propose <n>", "Propose the nth previewed repair for review; applies nothing")
    .action(async (options: { tiered?: boolean; fixPreview?: boolean; fixPropose?: string }) => {
      try {
        await lintCommand({
          tiered: options.tiered,
          fixPreview: options.fixPreview,
          ...(options.fixPropose === undefined ? {} : { fixPropose: Number(options.fixPropose) }),
        });
      } catch (err) {
        console.error(`\x1b[31mError:\x1b[0m ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}
