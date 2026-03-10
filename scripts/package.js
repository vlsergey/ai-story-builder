#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

// Forward all arguments after the script name to electron-builder
const args = ['electron-builder', '--publish', 'never', ...process.argv.slice(2)];

console.log('Running:', 'npx', args.join(' '));

const proc = spawn('npx', args, {
  stdio: 'inherit',
  shell: true,
  cwd: path.resolve(__dirname, '..'),
});

proc.on('exit', (code) => {
  process.exit(code || 0);
});