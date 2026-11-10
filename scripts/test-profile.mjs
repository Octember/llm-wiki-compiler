#!/usr/bin/env node
/**
 * Run the test suite and write `test-profile.json`: where the time goes, in
 * numbers that can be compared between runs.
 *
 * Per test file it records test count and duration. Across the run it records
 * how many `llmwiki` CLI processes the tests spawned, grouped by command, with
 * their CPU time. Spawn counts and CPU time are stable on a busy machine;
 * durations are not, so compare those only between runs on a quiet one.
 *
 * Usage: `npm run test:profile` or `npm run test:profile -- test/foo.test.ts`.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scripts = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scripts, "..");
const OUTPUT_FILE = path.join(root, "test-profile.json");

/** Run the suite with the JSON reporter and the spawn-recording preload. */
function runSuite(work) {
  const preload = `--import ${path.join(scripts, "test-profile-preload.mjs")}`;
  const env = {
    ...process.env,
    LLMWIKI_TEST_PROFILE_LOG: path.join(work, "spawns.jsonl"),
    NODE_OPTIONS: [process.env.NODE_OPTIONS, preload].filter(Boolean).join(" "),
  };
  const args = [path.join(scripts, "run-tests.mjs"), "--reporter=json", `--outputFile=${path.join(work, "vitest.json")}`];
  return spawnSync(process.execPath, [...args, ...process.argv.slice(2)], { stdio: "inherit", env, cwd: root }).status ?? 1;
}

/** Spawned CLI processes grouped by command, most CPU first. */
function summarizeSpawns(logFile) {
  const commands = new Map();
  const lines = readFileSync(logFile, { encoding: "utf8", flag: "a+" }).split("\n").filter(Boolean);
  for (const { command, cpuMs } of lines.map((line) => JSON.parse(line))) {
    const entry = commands.get(command) ?? { command, count: 0, cpuMs: 0 };
    commands.set(command, { command, count: entry.count + 1, cpuMs: entry.cpuMs + cpuMs });
  }
  return [...commands.values()].sort((a, b) => b.cpuMs - a.cpuMs);
}

/** Test files with their test count and duration, slowest first. */
function summarizeFiles(reportFile) {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  return report.testResults
    .map((file) => ({
      file: path.relative(root, file.name),
      tests: file.assertionResults.length,
      durationMs: Math.round(file.endTime - file.startTime),
    }))
    .sort((a, b) => b.durationMs - a.durationMs);
}

const work = mkdtempSync(path.join(os.tmpdir(), "llmwiki-test-profile-"));
const exitCode = runSuite(work);
const commands = summarizeSpawns(path.join(work, "spawns.jsonl"));
const files = summarizeFiles(path.join(work, "vitest.json"));
const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);
const totals = {
  files: files.length,
  tests: sum(files, "tests"),
  fileDurationMs: sum(files, "durationMs"),
  cliSpawns: sum(commands, "count"),
  cliCpuMs: sum(commands, "cpuMs"),
};
writeFileSync(OUTPUT_FILE, `${JSON.stringify({ totals, commands, files }, null, 2)}\n`);
rmSync(work, { recursive: true, force: true });
console.log(`test-profile: ${JSON.stringify(totals)} -> ${path.relative(root, OUTPUT_FILE)}`);
process.exit(exitCode);
