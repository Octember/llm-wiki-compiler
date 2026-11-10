/**
 * CLI entry point for llmwiki — the knowledge compiler.
 *
 * Lists every command with the module that registers it, and loads only the
 * module for the command being run. Help and unknown commands load them all.
 * Designed for `npx llmwiki` or global install via `npm install -g llm-wiki-compiler`.
 */

import { createRequire } from "module";
import { Command } from "commander";
import { loadCliEnvironment } from "./cli/environment.js";

loadCliEnvironment();

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

type Register = (program: Command) => void;

/** Every top-level command, in help order, with the module that registers it. */
const COMMANDS: Record<string, () => Promise<Register>> = {
  ingest: () => import("./cli/ingest-command.js").then((m) => m.registerIngestCommand),
  "ingest-session": () => import("./cli/ingest-session-command.js").then((m) => m.registerIngestSessionCommand),
  view: () => import("./cli/view-command.js").then((m) => m.registerViewCommand),
  compile: () => import("./cli/compile-command.js").then((m) => m.registerCompileCommand),
  rm: () => import("./cli/rm-command.js").then((m) => m.registerRmCommand),
  refresh: () => import("./cli/refresh-command.js").then((m) => m.registerRefreshCommand),
  review: () => import("./cli/review-commands.js").then((m) => m.registerReviewCommands),
  state: () => import("./cli/state-commands.js").then((m) => m.registerStateCommands),
  recover: () => import("./cli/recover-command.js").then((m) => m.registerRecoverCommand),
  rules: () => import("./cli/rules-commands.js").then((m) => m.registerRulesCommands),
  query: () => import("./cli/query-command.js").then((m) => m.registerQueryCommand),
  watch: () => import("./cli/watch-command.js").then((m) => m.registerWatchCommand),
  visualize: () => import("./cli/visualize-command.js").then((m) => m.registerVisualizeCommand),
  lint: () => import("./cli/lint-command.js").then((m) => m.registerLintCommand),
  status: () => import("./cli/status-command.js").then((m) => m.registerStatusCommand),
  eval: () => import("./cli/eval-commands.js").then((m) => m.registerEvalCommands),
  schema: () => import("./cli/schema-commands.js").then((m) => m.registerSchemaCommands),
  profile: () => import("./cli/profile-commands.js").then((m) => m.registerProfileCommands),
  template: () => import("./cli/template-commands.js").then((m) => m.registerTemplateCommands),
  workflow: () => import("./cli/workflow-commands.js").then((m) => m.registerWorkflowCommands),
  artifact: () => import("./cli/artifact-commands.js").then((m) => m.registerArtifactCommands),
  connector: () => import("./cli/connector-commands.js").then((m) => m.registerConnectorCommands),
  operation: () => import("./cli/operation-commands.js").then((m) => m.registerOperationCommands),
  product: () => import("./cli/product-commands.js").then((m) => m.registerProductCommands),
  preparation: () => import("./cli/preparation-commands.js").then((m) => m.registerPreparationCommands),
  export: () => import("./cli/export-command.js").then((m) => m.registerExportCommand),
  import: () => import("./cli/import-command.js").then((m) => m.registerImportCommand),
  next: () => import("./cli/context-commands.js").then((m) => m.registerNextCommand),
  context: () => import("./cli/context-commands.js").then((m) => m.registerContextCommand),
  quickstart: () => import("./cli/quickstart-command.js").then((m) => m.registerQuickstartCommand),
  serve: () => import("./cli/serve-command.js").then((m) => m.registerServeCommand),
};

const program = new Command();

program
  .name("llmwiki")
  .description("The knowledge compiler — raw sources in, interlinked wiki out")
  .version(version);

const requested = process.argv[2] ?? "";
const loaders = Object.hasOwn(COMMANDS, requested) ? [COMMANDS[requested]] : Object.values(COMMANDS);
for (const load of loaders) (await load())(program);

program.parse();
