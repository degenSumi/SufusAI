import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Runs before any test module is imported, which matters because
    // config/env.ts validates and freezes process.env at import time.
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.ts"],
  },
});
