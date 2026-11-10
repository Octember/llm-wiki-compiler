/**
 * @file Registers `query`: ask a question against the wiki.
 */

import type { Command } from "commander";
import queryCommand, { assertQuerySaveOptions } from "@atomicstrata/llmwiki-core/commands/query";
import { addProviderOption, applyProviderOption, type ProviderOption } from "@atomicstrata/llmwiki-core/cli/provider-option";
import { applyLanguageOption } from "@atomicstrata/llmwiki-core/utils/output-language";
import { setVerbose } from "@atomicstrata/llmwiki-core/utils/output";
import { verboseEnabled } from "./verbose.js";
import { requireProvider } from "./require-provider.js";

/** Register the `query` command on `program`. */
export function registerQueryCommand(program: Command): void {
  addProviderOption(program.command("query <question>").description("Ask a question against the wiki"))
    .option("--save", "Save the answer as a wiki page")
    .option("--review", "Stage the answer for review instead of publishing (requires --save)")
    .option("--debug", "Print which pages and chunks were selected and their scores")
    .option(
      "--lang <code>",
      "Target language for the answer (e.g. \"Chinese\", \"ja\", \"zh-CN\"). Equivalent to setting LLMWIKI_OUTPUT_LANG.",
    )
    .option("--verbose", "Print detailed progress (or set LLMWIKI_VERBOSE=1)")
    .action(
      async (
        question: string,
        options: ProviderOption & { save?: boolean; review?: boolean; debug?: boolean; lang?: string; verbose?: boolean },
      ) => {
        try {
          assertQuerySaveOptions(options);
          applyProviderOption(options);
          setVerbose(verboseEnabled(options.verbose));
          applyLanguageOption(options.lang);
          requireProvider();
          await queryCommand(process.cwd(), question, options);
        } catch (err) {
          console.error(`\x1b[31mError:\x1b[0m ${err instanceof Error ? err.message : err}`);
          process.exit(1);
        }
      },
    );
}
