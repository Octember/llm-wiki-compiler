/**
 * @file Registers `watch`: recompile when sources/ changes.
 */

import type { Command } from "commander";
import watchCommand from "@atomicstrata/llmwiki-core/commands/watch";
import { addProviderOption, applyProviderOption, type ProviderOption } from "@atomicstrata/llmwiki-core/cli/provider-option";
import { parseConcurrencyFlag } from "@atomicstrata/llmwiki-core/compiler/concurrency";
import { requireCompileProvider } from "./require-provider.js";

/** Register the `watch` command on `program`. */
export function registerWatchCommand(program: Command): void {
  addProviderOption(program.command("watch").description("Watch sources/ and auto-recompile on changes"))
    .option(
      "--concurrency <n>",
      "Max concurrent LLM calls per recompile (or set LLMWIKI_COMPILE_CONCURRENCY; default 5)",
    )
    .action(async (options: ProviderOption & { concurrency?: string }) => {
      try {
        applyProviderOption(options);
        requireCompileProvider();
        await watchCommand({ concurrency: parseConcurrencyFlag(options.concurrency) });
      } catch (err) {
        console.error(`\x1b[31mError:\x1b[0m ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}
