/**
 * @file test/mcp-http.test.ts
 * @description `llmwiki serve --http` over a real socket. The built CLI is
 * spawned with `--read-only` and a token file, and an SDK client connects over
 * streamable HTTP, so the bearer check, the stateless transport and the
 * read-only tool list are all exercised the way a remote client meets them.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { parseToolPayload, useMcpRoot } from "./fixtures/mcp-test-env.js";
import { CLI, CLI_RUNTIME_FLAGS } from "./fixtures/run-cli.js";
import { writePage } from "./fixtures/write-page.js";

const TOKEN = "test-token-7f3a";
const LISTENING = /listening on (http:\/\/127\.0\.0\.1:\d+\/mcp)/;
const READ_ONLY_TOOLS = [
  "describe_workflow_action",
  "get_context_pack",
  "list_workflow_actions",
  "read_page",
  "search_pages",
  "verify_artifact",
  "wiki_status",
  "workflow_run_status",
];

const rootHandle = useMcpRoot("mcp-http");
const children: ChildProcess[] = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill();
});

/** Spawn `serve --http 0 --read-only` on the test root and resolve its URL from stderr. */
async function startHttpServer(root: string): Promise<URL> {
  const tokenFile = path.join(root, "token");
  await writeFile(tokenFile, `${TOKEN}\n`);
  const child = spawn(
    "bun",
    [...CLI_RUNTIME_FLAGS, CLI, "serve", "--root", root, "--http", "0", "--token-file", tokenFile, "--read-only"],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  children.push(child);
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      const listening = LISTENING.exec(stderr);
      if (listening) resolve(new URL(listening[1]));
    });
    child.once("exit", (code) => reject(new Error(`serve exited with ${code}: ${stderr}`)));
  });
}

/** Connect an SDK client that sends `token` as its bearer. */
async function connect(url: URL, token: string): Promise<Client> {
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }),
  );
  return client;
}

/** POST an `initialize` request with the given headers and return the status. */
async function initializeStatus(url: URL, headers: Record<string, string>): Promise<number> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw", version: "0" } },
    }),
  });
  return response.status;
}

describe("MCP over HTTP: serve --http --read-only", () => {
  it("lists only the tools that never write and reads a page", async () => {
    const root = rootHandle.value;
    await writePage(path.join(root, "wiki/concepts"), "alpha", { title: "Alpha", summary: "a" }, "ALPHA_BODY fact.");
    const client = await connect(await startHttpServer(root), TOKEN);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual(READ_ONLY_TOOLS);

      const result = await client.callTool({ name: "read_page", arguments: { slug: "alpha" } });
      const page = parseToolPayload<{ title: string; body: string }>(result as CallToolResult);
      expect(page.title).toBe("Alpha");
      expect(page.body).toContain("ALPHA_BODY fact.");
    } finally {
      await client.close();
    }
  }, 30_000);

  it("refuses a request without the token", async () => {
    const url = await startHttpServer(rootHandle.value);
    expect(await initializeStatus(url, {})).toBe(401);
    expect(await initializeStatus(url, { Authorization: "Bearer wrong" })).toBe(401);
    expect(await initializeStatus(url, { Authorization: `Bearer ${TOKEN}` })).toBe(200);
  }, 30_000);
});

describe("serve --http without --token-file", () => {
  it("exits with an error instead of serving unauthenticated", async () => {
    const child = spawn("bun", [...CLI_RUNTIME_FLAGS, CLI, "serve", "--root", rootHandle.value, "--http", "0"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    children.push(child);
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    const code = await new Promise((resolve) => child.once("exit", resolve));
    expect(code).toBe(1);
    expect(stderr).toContain("--http requires --token-file");
  }, 30_000);
});
