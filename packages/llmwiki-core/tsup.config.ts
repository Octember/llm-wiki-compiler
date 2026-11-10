/**
 * Build all core entry points together so shared authority, locks, error classes
 * and the module-instance token resolve to one set of chunks in an installation.
 */
import { defineConfig } from "tsup";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

const SRC = path.resolve("../../src");

/**
 * Modules the CLI imports one at a time, published at their own path
 * (`@atomicstrata/llmwiki-core/commands/ingest`). The CLI loads a command's
 * module when that command runs, so starting it does not load every command.
 * Workflow commands are composed in the standard distribution, not here.
 */
const commandEntries = readdirSync(path.join(SRC, "commands"), { recursive: true, encoding: "utf8" })
  .filter((file) => file.endsWith(".ts") && !path.basename(file).startsWith("workflow"))
  .map((file) => `commands/${file.slice(0, -".ts".length)}`);

/** Small helpers the CLI needs while registering commands, before any runs. */
const cliSupportEntries = [
  "cli/provider-option", "cli/shared", "compiler/concurrency", "profile/templates/publish/bounded-read",
  "utils/constants", "utils/output", "utils/output-language", "utils/provider-guard", "utils/sources-section",
];

const moduleEntries = Object.fromEntries(
  [...commandEntries, ...cliSupportEntries].map((name) => [name, path.join(SRC, `${name}.ts`)]),
);

/** Entry points with a public type surface; these get declarations. */
const typedEntries = {
  index: "../../src/core-index.ts",
  "compiler-cli": "../../src/compiler-cli.ts",
  "compiler-legacy-workflows": "../../src/local-workflow-host/legacy-composition.ts",
  "compiler-sdk": "../../src/sdk/compiler-composition.ts",
  "local-workflow-host": "../../src/local-workflow-host/index.ts",
  "local-workflow-contracts": "../../src/local-workflow-host/shared-contracts.ts",
};

export default defineConfig({
  entry: { ...moduleEntries, ...typedEntries },
  outDir: "dist",
  format: ["esm"],
  target: "node24",
  splitting: true,
  sourcemap: true,
  clean: true,
  // Only the CLI bundle imports the per-module entries, and it type-checks against src.
  dts: { entry: typedEntries, compilerOptions: { rootDir: SRC } },
  tsconfig: "../../tsconfig.json",
  onSuccess: async () => {
    execFileSync(process.execPath, [path.resolve("../../scripts/copy-viewer-assets.mjs"), "packages/llmwiki-core/dist"]);
  },
});
