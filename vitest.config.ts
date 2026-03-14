import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    globals: false,
    // Run serially — blockscout tests stub global fetch and must not share state
    pool: "forks",
  },
});
