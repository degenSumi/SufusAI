import { defineConfig } from "tsup";

// Emits apps/api/index.js. Vercel's entrypoint search checks `index.js` before
// `src/index.ts`, so the deployed function runs pre-built JS and the platform
// never compiles our TypeScript with its own tsc version.
export default defineConfig({
  entry: { index: "src/index.ts" },
  outDir: ".",
  format: ["esm"],
  target: "node22",
  platform: "node",
  // Workspace packages ship TypeScript source, so they must be inlined.
  noExternal: [/^@repo\//],
  splitting: false,
  clean: false,
  dts: false,
  sourcemap: false,
});
