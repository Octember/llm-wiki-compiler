/**
 * @file Registers `serve`: start the MCP server over stdio.
 */

import type { Command } from "commander";
import { startMCPServer } from "../mcp/server.js";

/** Register the `serve` command on `program`. */
export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("Start an MCP server exposing wiki tools and resources over stdio")
    .option("--root <dir>", "Project root directory", process.cwd())
    .action(async (options: { root: string }) => {
      try {
        // Per-tool credential checks happen inside the MCP layer so read-only
        // tools and ingest still work without an API key.
        await startMCPServer({ root: options.root, version: program.version() ?? "" });
      } catch (err) {
        console.error(`\x1b[31mError:\x1b[0m ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}
