/**
 * Preload for `npm run test:profile`: records one line per spawned `llmwiki`
 * CLI process, so the profile can count spawns and their CPU cost.
 *
 * It is loaded into every Node process the test run starts and does nothing
 * unless the process is running `dist/cli.js`. CPU time is recorded instead of
 * wall time because it does not change with how busy the machine is.
 */
import { appendFileSync } from "node:fs";

const MICROSECONDS_PER_MILLISECOND = 1000;
const logFile = process.env.LLMWIKI_TEST_PROFILE_LOG;
const isCli = (process.argv[1] ?? "").endsWith("dist/cli.js");

if (logFile && isCli) {
  process.on("exit", () => {
    const { user, system } = process.cpuUsage();
    const command = process.argv.slice(2).filter((arg) => !arg.startsWith("-")).slice(0, 2).join(" ");
    const cpuMs = Math.round((user + system) / MICROSECONDS_PER_MILLISECOND);
    appendFileSync(logFile, `${JSON.stringify({ command, cpuMs })}\n`);
  });
}
