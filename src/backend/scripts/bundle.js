'use strict';
// Bundles the backend into a single CommonJS file for Node.js SEA.
// Also generates sea-config.json with the correct path to better_sqlite3.node.

const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const backendDir = path.resolve(__dirname, '..');

// Resolve the native addon — hoisted to root node_modules in npm workspaces
const betterSqlite3Root = path.dirname(
  require.resolve('better-sqlite3/package.json', { paths: [backendDir] })
);
const addonPath = path.join(betterSqlite3Root, 'build', 'Release', 'better_sqlite3.node');

if (!fs.existsSync(addonPath)) {
  console.error('better_sqlite3.node not found at', addonPath);
  process.exit(1);
}

// esbuild plugin: replace the `bindings` package with a SEA-aware shim.
// better-sqlite3 calls require('bindings')('better_sqlite3.node') to load its
// native addon. In SEA mode the filesystem path doesn't exist; we extract the
// .node from embedded assets instead.
const seaBindingsPlugin = {
  name: 'sea-bindings',
  setup(build) {
    build.onResolve({ filter: /^bindings$/ }, () => ({
      path: 'sea-bindings-shim',
      namespace: 'sea-shim',
    }));

    build.onLoad({ filter: /.*/, namespace: 'sea-shim' }, () => ({
      contents: `
'use strict';
const path = require('path');
const fs   = require('fs');
const os   = require('os');

// Resolved at bundle time so development mode works without SEA.
const DEV_ADDON_PATH = ${JSON.stringify(addonPath)};

module.exports = function seaBindings(name) {
  const assetName = name.replace(/(\\.node)?$/, '.node');

  let isSea = false;
  try { isSea = require('node:sea').isSea(); } catch (_) {}

  const tmpPath = path.join(os.tmpdir(), 'sea_addon_' + process.pid + '_' + assetName);

  if (isSea) {
    const { getRawAsset } = require('node:sea');
    if (!fs.existsSync(tmpPath)) {
      fs.writeFileSync(tmpPath, Buffer.from(getRawAsset(assetName)));
    }
  } else {
    // Development / plain node: copy from the known build-time path once.
    if (!fs.existsSync(tmpPath)) {
      fs.copyFileSync(DEV_ADDON_PATH, tmpPath);
    }
  }

  const mod = { exports: {} };
  process.dlopen(mod, tmpPath);
  return mod.exports;
};
      `,
      loader: 'js',
    }));
  },
};

// Write sea-config.json so build-sea.js can run node --experimental-sea-config
const seaConfig = {
  main: 'dist-sea/bundle.js',
  output: 'dist-sea/sea-prep.blob',
  disableExperimentalSEAWarning: true,
  useCodeCache: false,
  useSnapshot: false,
  assets: {
    'better_sqlite3.node': addonPath,
  },
};

fs.mkdirSync(path.join(backendDir, 'dist-sea'), { recursive: true });
fs.writeFileSync(
  path.join(backendDir, 'sea-config.json'),
  JSON.stringify(seaConfig, null, 2)
);

// Bundle
esbuild.build({
  entryPoints: [path.join(backendDir, 'server.js')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: path.join(backendDir, 'dist-sea', 'bundle.js'),
  plugins: [seaBindingsPlugin],
}).then(() => {
  console.log('Bundle written to dist-sea/bundle.js');
  console.log('sea-config.json written');
}).catch(() => process.exit(1));
