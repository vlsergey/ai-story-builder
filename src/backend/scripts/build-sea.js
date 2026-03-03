'use strict';
// Generates a Node.js SEA binary for the current platform.
// Run after scripts/bundle.js has already produced dist-sea/bundle.js.

const { execSync, spawnSync } = require('child_process');
const { copyFileSync, mkdirSync, writeFileSync, chmodSync } = require('fs');
const path = require('path');

const platform = process.platform;
const backendDir = path.resolve(__dirname, '..');
const releaseDir = path.resolve(backendDir, '..', '..', 'release');

const outputName = platform === 'win32'  ? 'ai-story-builder-win.exe'
  : platform === 'darwin'               ? 'ai-story-builder-macos'
  :                                       'ai-story-builder-linux';

const outputPath = path.join(releaseDir, outputName);

mkdirSync(releaseDir, { recursive: true });

const run = (cmd) => execSync(cmd, { cwd: backendDir, stdio: 'inherit' });

// 1. Generate SEA blob
console.log('Generating SEA blob...');
run('node --experimental-sea-config sea-config.json');

// 2. Copy the Node.js binary
console.log(`Copying node binary → ${outputPath}`);
copyFileSync(process.execPath, outputPath);

// 3. macOS: strip existing signature before injection
if (platform === 'darwin') {
  spawnSync('codesign', ['--remove-signature', outputPath], { stdio: 'inherit' });
}

// 4. Inject blob
console.log('Injecting SEA blob with postject...');
const machoFlag = platform === 'darwin' ? ' --macho-segment-name NODE_SEA' : '';
run(
  `npx --yes postject "${outputPath}" NODE_SEA_BLOB dist-sea/sea-prep.blob` +
  ` --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2${machoFlag}`
);

// 5. macOS: re-sign with ad-hoc signature
if (platform === 'darwin') {
  spawnSync('codesign', ['--sign', '-', outputPath], { stdio: 'inherit' });
}

console.log(`Done: ${outputPath}`);

// 6. Write wrapper scripts for all platforms
const wrappers = {
  'run.sh': [
    '#!/usr/bin/env bash',
    'cd "$(dirname "$0")"',
    'exec ./ai-story-builder-linux "$@"',
    '',
  ].join('\n'),

  'run.command': [
    '#!/usr/bin/env bash',
    'cd "$(dirname "$0")"',
    'exec ./ai-story-builder-macos',
    '',
  ].join('\n'),

  'run.bat': [
    '@echo off',
    'cd /d "%~dp0"',
    'ai-story-builder-win.exe %*',
    'pause',
    '',
  ].join('\r\n'),
};

for (const [name, content] of Object.entries(wrappers)) {
  const wrapperPath = path.join(releaseDir, name);
  writeFileSync(wrapperPath, content);
  if (name !== 'run.bat') chmodSync(wrapperPath, 0o755);
  console.log(`Written: ${wrapperPath}`);
}
