/**
 * @file Registers `ingest`: add a URL or local file to sources/.
 */

import type { Command } from "commander";
import ingestCommand from "@atomicstrata/llmwiki-core/commands/ingest";
import { setVerbose } from "@atomicstrata/llmwiki-core/utils/output";
import { verboseEnabled } from "./verbose.js";

/** Register the `ingest` command on `program`. */
export function registerIngestCommand(program: Command): void {
  program
    .command("ingest <source>")
    .description("Ingest a URL or local file into sources/")
    .option("--verbose", "Print detailed progress (or set LLMWIKI_VERBOSE=1)")
    .action(async (source: string, options: { verbose?: boolean }) => {
      try {
        setVerbose(verboseEnabled(options.verbose));
        await ingestCommand(source);
      } catch (err) {
        console.error(`\x1b[31mError:\x1b[0m ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}
