import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['**/*.ts'],
    format: ['esm'],
    target: 'node16',
    platform: 'node',
    outDir: '../../dist/backend',
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
  },
  {
    entry: ['../shared/**/*.ts'],
    format: ['esm'],
    target: 'node16',
    platform: 'node',
    outDir: '../../dist/shared',
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
  },
  {
    entry: ['../preload/preload.ts'],
    format: ['cjs'],
    target: 'chrome100',
    platform: 'browser',
    outDir: '../../dist/preload/',
    bundle: false,
    sourcemap: false,
    clean: true,
    noExternal: ['electron-trpc'],
    external: ['electron'],
    shims: true,
    skipNodeModulesBundle: true,
    outExtension() {
      return {
        js: '.cjs',
      }
    },
  },
  
])
