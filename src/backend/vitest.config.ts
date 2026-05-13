import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    // Strip .js extension from relative imports so Vite resolves .ts source files first.
    // This ensures tests use TypeScript sources even after `build:backend` emits .js files.
    alias: [{ find: /^(\.{1,2}\/.+)\.js$/, replacement: "$1" }],
    extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // After `build:backend` tsup also emits compiled .test.ts under dist/ —
    // exclude so we never run two copies of the same test (or the dist copy
    // alone after a partial cleanup).
    exclude: ["**/node_modules/**", "**/dist/**"],
    globals: true,
  },
})
