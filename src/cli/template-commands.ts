/**
 * @file src/cli/template-commands.ts
 * @description Registers the `template` command group with Commander. The
 * group is intentionally thin: parsing stays here, while registry inspection
 * and install behavior stay in `src/commands/template.ts`.
 */
import { Help, type Command } from "commander";
import type { TemplateInitOptions, TemplateStatusOptions, TemplateUpdateOptions } from "@atomicstrata/llmwiki-core/commands/template";
import { runExitCodeCommand } from "@atomicstrata/llmwiki-core/cli/shared";
import type { TapAddOptions, TapForgetOptions, TapOutputOptions } from "@atomicstrata/llmwiki-core/commands/template-tap";
import type { RemoteOutputOptions, TemplateSearchOptions } from "@atomicstrata/llmwiki-core/commands/template-remote";
import type { TemplatePublishAddOptions, TemplatePublishBuildOptions, TemplatePublishInitOptions, TemplatePublishRevokeOptions, TemplatePublishRotateOptions, TemplatePublishVerifyOptions } from "@atomicstrata/llmwiki-core/commands/template-publish";

/** Register template list, inspect, and init commands. */
export function registerTemplateCommands(program: Command): void {
  const template = program
    .command("template")
    .description("List, inspect, and install profile templates")
    .configureHelp({
      subcommandTerm: (command) => {
        const term = new Help().subcommandTerm(command);
        return command.name() === "verify" ? term.replace(" [options]", "") : term;
      },
    });

  registerTemplateDiscoveryCommands(template);
  registerPublishCommands(template);
  registerTemplateInstallCommands(template);
  registerTapCommands(template);
}

/** Register the discovery commands: `list`, `inspect`, `search`, `verify`. */
function registerTemplateDiscoveryCommands(template: Command): void {
  template
    .command("list")
    .description("List builtin profile templates")
    .action(async () => runExitCodeCommand(async () => {
      const { templateListCommand } = await import("@atomicstrata/llmwiki-core/commands/template");
      return templateListCommand().then(() => 0);
    }));

  template
    .command("inspect <id>")
    .description("Inspect one builtin id or qualified remote coordinate")
    .option("--json", "Print stable JSON for a remote coordinate")
    .action(async (id: string, options: RemoteOutputOptions) => runExitCodeCommand(async () => {
      if (id.includes("/")) {
        const { templateRemoteInspectCommand } = await import("@atomicstrata/llmwiki-core/commands/template-remote");
        return templateRemoteInspectCommand(id, options);
      }
      const { templateInspectCommand } = await import("@atomicstrata/llmwiki-core/commands/template");
      return templateInspectCommand(id).then(() => 0);
    }));

  template
    .command("search <query>")
    .description("Search accepted signed remote template indexes")
    .option("--tap <name>", "Search one configured tap")
    .option("--json", "Print stable JSON results")
    .action(async (query: string, options: TemplateSearchOptions) => runExitCodeCommand(async () => {
      const { templateSearchCommand } = await import("@atomicstrata/llmwiki-core/commands/template-remote");
      return templateSearchCommand(query, options);
    }));

  template
    .command("verify <coordinate>")
    .description("Verify one qualified remote template package")
    .option("--json", "Print stable JSON provenance")
    .action(async (coordinate: string, options: RemoteOutputOptions) => runExitCodeCommand(async () => {
      const { templateVerifyCommand } = await import("@atomicstrata/llmwiki-core/commands/template-remote");
      return templateVerifyCommand(coordinate, options);
    }));
}

/** Register the `template publish` sub-group. */
function registerPublishCommands(template: Command): void {
  const publish = template
    .command("publish")
    .description("Author, build, and verify template publisher distributions");

  registerPublishAuthoringCommands(publish);
  registerPublishReleaseCommands(publish);
  registerPublishTrustCommands(publish);
}

/** Register the workspace authoring commands: `publish init`, `publish add`. */
function registerPublishAuthoringCommands(publish: Command): void {
  publish
    .command("init <directory>")
    .description("Create a publisher workspace with fresh tap and publisher keys")
    .requiredOption("--tap <name>", "Tap identity this workspace publishes")
    .requiredOption("--publisher <name>", "Publisher identity that signs packages")
    .option("--tap-key-id <id>", "Override the generated tap key id")
    .option("--publisher-key-id <id>", "Override the generated publisher key id")
    .option("--json", "Print a stable versioned JSON result")
    .action(async (directory: string, options: TemplatePublishInitOptions) =>
      runExitCodeCommand(async () => {
        const { templatePublishInitCommand } = await import("@atomicstrata/llmwiki-core/commands/template-publish");
        return templatePublishInitCommand(directory, options);
      }, { colorError: false }),
    );

  publish
    .command("add <package-file>")
    .description("Validate, sign, and record one template package")
    .requiredOption("--workspace <path>", "Publisher workspace directory")
    .requiredOption("--package-version <version>", "Version this package is published as")
    .option("--json", "Print a stable versioned JSON result")
    .action(async (packageFile: string, options: TemplatePublishAddOptions) =>
      runExitCodeCommand(async () => {
        const { templatePublishAddCommand } = await import("@atomicstrata/llmwiki-core/commands/template-publish");
        return templatePublishAddCommand(packageFile, options);
      }, { colorError: false }),
    );
}

/** Register the distribution commands: `publish build`, `publish rotate`. */
function registerPublishReleaseCommands(publish: Command): void {
  publish
    .command("build")
    .description("Build, verify, and publish a static distribution")
    .requiredOption("--workspace <path>", "Publisher workspace directory")
    .requiredOption("--out <path>", "Output directory, which must live outside the workspace")
    .requiredOption("--expires-in <duration>", "Index lifetime, such as 30d or 12h")
    .option("--refresh", "Republish unchanged content under a fresh lifetime, to renew an expiring index")
    .option("--force", "Republish even when nothing changed since the last build")
    .option("--json", "Print a stable versioned JSON result")
    .action(async (options: TemplatePublishBuildOptions) =>
      runExitCodeCommand(async () => {
        const { templatePublishBuildCommand } = await import("@atomicstrata/llmwiki-core/commands/template-publish");
        return templatePublishBuildCommand(options);
      }, { colorError: false }),
    );

  publish
    .command("rotate")
    .description("Stage a tap-root or publisher key rotation, signed by the next build")
    .requiredOption("--workspace <path>", "Publisher workspace directory")
    .option("--tap-key-id <id>", "Rotate the tap root key to this new key id")
    .option("--publisher-key-id <id>", "Rotate the publisher key to this new key id")
    .action(async (options: TemplatePublishRotateOptions) =>
      runExitCodeCommand(async () => {
        const { templatePublishRotateCommand } = await import("@atomicstrata/llmwiki-core/commands/template-publish");
        return templatePublishRotateCommand(options);
      }, { colorError: false }),
    );
}

/** Register the trust commands: `publish revoke`, `publish verify`. */
function registerPublishTrustCommands(publish: Command): void {
  publish
    .command("revoke")
    .description("Stage a package or publisher-key revocation, published by the next build")
    .requiredOption("--workspace <path>", "Publisher workspace directory")
    .requiredOption("--reason <text>", "Why this evidence is revoked")
    .option("--package-digest <digest>", "Revoke one published package digest")
    .option("--publisher-key-id <id>", "Revoke one publisher key id")
    .action(async (options: TemplatePublishRevokeOptions) =>
      runExitCodeCommand(async () => {
        const { templatePublishRevokeCommand } = await import("@atomicstrata/llmwiki-core/commands/template-publish");
        return templatePublishRevokeCommand(options);
      }, { colorError: false }),
    );

  publish
    .command("verify <directory>")
    .description("Verify a signed publisher distribution offline")
    .requiredOption("--tap <name>", "Expected tap identity selected through a trusted channel")
    .requiredOption("--key-id <id>", "Trusted Ed25519 tap key id")
    .requiredOption("--key-file <path>", "Read the trusted base64 SPKI DER tap key")
    .option("--json", "Print a stable versioned JSON result")
    .action(async (directory: string, options: TemplatePublishVerifyOptions) =>
      runExitCodeCommand(async () => {
        const { templatePublishVerifyCommand } = await import("@atomicstrata/llmwiki-core/commands/template-publish");
        return templatePublishVerifyCommand(directory, options);
      }, { colorError: false }),
    );
}

/** Register the installed-template commands: `status`, `update`, `init`. */
function registerTemplateInstallCommands(template: Command): void {
  template
    .command("status")
    .description("Report installed template provenance and profile drift")
    .option("--json", "Print a stable JSON status envelope")
    .action(async (options: TemplateStatusOptions) => runExitCodeCommand(async () => {
      const { templateStatusCommand } = await import("@atomicstrata/llmwiki-core/commands/template");
      return templateStatusCommand(options);
    }));

  template
    .command("update [id]")
    .description("Preview a builtin update or safely apply an exact remote update")
    .option("--dry-run", "Inspect compatibility without writing")
    .option("--to <version>", "Target exact remote template version")
    .option("--yes", "Confirm a compatible remote update non-interactively")
    .option("--json", "Print a stable JSON update plan")
    .action(async (id: string | undefined, options: TemplateUpdateOptions) =>
      runExitCodeCommand(async () => {
        const { templateUpdateCommand } = await import("@atomicstrata/llmwiki-core/commands/template");
        return templateUpdateCommand(id, options);
      }),
    );

  template
    .command("init [id]")
    .description("Install a builtin, local, or qualified remote profile template")
    .option("--file <path>", "Install a local template package JSON file")
    .option("--force", "Overwrite an existing profile only when the typed corpus is empty")
    .option("--yes", "Confirm a verified remote install non-interactively")
    .option("--json", "Print a stable JSON result for remote installs")
    .action(async (id: string | undefined, options: TemplateInitOptions) =>
      runExitCodeCommand(async () => {
        const { templateInitCommand } = await import("@atomicstrata/llmwiki-core/commands/template");
        return templateInitCommand(id, options);
      }),
    );
}

/** Register the `template tap` sub-group. */
function registerTapCommands(template: Command): void {
  const tap = template.command("tap").description("Manage explicitly trusted template taps");
  tap.command("list").option("--json", "Print stable JSON").action(async (options: TapOutputOptions) =>
    runExitCodeCommand(async () => {
      const { templateTapListCommand } = await import("@atomicstrata/llmwiki-core/commands/template-tap");
      return templateTapListCommand(options);
    }));
  tap.command("add <name> <index-url>")
    .requiredOption("--key-id <id>", "Trusted Ed25519 key id")
    .option("--key-file <path>", "Read base64 SPKI DER key from a file")
    .option("--key-base64 <value>", "Use a base64 SPKI DER key")
    .action(async (name: string, url: string, options: TapAddOptions) =>
      runExitCodeCommand(async () => {
        const { templateTapAddCommand } = await import("@atomicstrata/llmwiki-core/commands/template-tap");
        return templateTapAddCommand(name, url, options);
      }));
  tap.command("remove <name>").description("Disable a tap and retain trust history").action(async (name: string) =>
    runExitCodeCommand(async () => {
      const { templateTapRemoveCommand } = await import("@atomicstrata/llmwiki-core/commands/template-tap");
      return templateTapRemoveCommand(name);
    }));
  tap.command("forget <name>").description("Permanently delete a tap and all retained trust history")
    .option("--yes", "Confirm the irreversible trust reset")
    .action(async (name: string, options: TapForgetOptions) =>
      runExitCodeCommand(async () => {
        const { templateTapForgetCommand } = await import("@atomicstrata/llmwiki-core/commands/template-tap");
        return templateTapForgetCommand(name, options);
      }));
  tap.command("refresh <name>").option("--json", "Print stable JSON").action(async (name: string, options: TapOutputOptions) =>
    runExitCodeCommand(async () => {
      const { templateTapRefreshCommand } = await import("@atomicstrata/llmwiki-core/commands/template-tap");
      return templateTapRefreshCommand(name, options);
    }));
}
