/**
 * @file Registers the `rules` command group with the CLI provider guard.
 */

import type { Command } from "commander";
import { registerRulesCommand } from "@atomicstrata/llmwiki-core/commands/rules-register";
import { requireProvider } from "./require-provider.js";

/** Register the `rules` command group on `program`. */
export function registerRulesCommands(program: Command): void {
  registerRulesCommand(program, requireProvider);
}
