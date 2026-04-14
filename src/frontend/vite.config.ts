import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "path"

export default defineConfig({
  root: path.resolve(__dirname),
  base: "./",
  plugins: [
    react({
      fastRefresh: false,
      jsxRuntime: "automatic",
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  server: {
    port: 3000,
    host: true,
    strictPort: true,
    watch: {
      usePolling: true,
      interval: 1000,
      binaryInterval: 1000,
    },
  },
  build: {
    outDir: path.resolve(__dirname, "..", "..", "dist", "frontend"),
    emptyOutDir: true,
  },
  optimizeDeps: {
    include: ["react", "react-dom"],
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/tests/test-setup.ts"],
    include: ["src/tests/**/*.test.{js,jsx,ts,tsx}"],
    globals: true,
    coverage: {
      provider: "istanbul",
      reporter: ["text", "json", "html"],
      exclude: ["src/tests/**", "src/main.tsx", "src/App.tsx"],
    },
  },
})
