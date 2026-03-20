import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['server.ts'],
  format: ['esm'],
  target: 'node16',
  platform: 'node',
  outDir: '../../dist/backend',
  // Native and optional modules must remain as runtime require() calls;
  // electron-builder rebuilds better-sqlite3 for the correct Electron ABI.
  external: ['better-sqlite3', 'electron'],
  bundle: true,
  sourcemap: false,
  clean: true,
  noExternal: [],
})
