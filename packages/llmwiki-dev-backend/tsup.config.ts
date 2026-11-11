import { defineConfig } from "tsup";

/**
 * Compiles this private backend package to dist/ so it can be `npm pack`ed into a
 * consumer beside the platform. The platform (`@atomicstrata/llmwiki-core`) is a PEER and is
 * EXTERNALIZED — never a second bundled copy — and so is the dev backend it builds on.
 */
export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "dist",
  format: ["esm"],
  target: "node24",
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: process.env.LLMWIKI_SKIP_DTS === "1" ? false : true,
  tsconfig: "tsconfig.build.json",
  external: ["@atomicstrata/llmwiki-core", "llmwiki-dev-backend"],
});
