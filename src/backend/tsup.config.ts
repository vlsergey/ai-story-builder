import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['**/*.ts', '../shared/**/*.ts'],
  format: ['esm'],
  target: 'node16',
  platform: 'node',
  outDir: '../../dist/',
  // Native and optional modules must remain as runtime require() calls;
  // electron-builder rebuilds better-sqlite3 for the correct Electron ABI.
  external: ['better-sqlite3', 'electron', 'electron-devtools-installer', 'electron-trpc'],
  // 'true' doesn't work good with 'external' (ignores)
  bundle: false,
  sourcemap: false,
  clean: true,
  noExternal: [],
  shims: true,
  skipNodeModulesBundle: true,
  outExtension() {
    return {
      js: '.js',
    }
  },
})
