import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    testTimeout: 30_000, // 30s — RPCs Supabase peuvent être lentes en cold start
    setupFiles: ["./helpers/setup.ts"],
    pool: "forks", // 1 process par fichier pour éviter les conflits cross-test
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
