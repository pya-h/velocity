#!/usr/bin/env node
/**
 * sync.js — Links the compiled framework into node_modules/@velocity/framework.
 *
 * After `npm run build`, run `npm run sync` (or `npm run dev` for both).
 * Creates a symlink so examples can `import { ... } from '@velocity/framework'`.
 *
 * Once published to npm, this script is no longer needed.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const TARGET_DIR = path.join(ROOT, 'node_modules', '@velocity');
const TARGET = path.join(TARGET_DIR, 'framework');

// Verify dist/ exists
if (!fs.existsSync(DIST)) {
  console.error('dist/ not found. Run `npm run build` first.');
  process.exit(1);
}

// Verify dist/index.js exists
if (!fs.existsSync(path.join(DIST, 'index.js'))) {
  console.error('dist/index.js not found. Build may have failed.');
  process.exit(1);
}

// Create @velocity scope directory
fs.mkdirSync(TARGET_DIR, { recursive: true });

// Remove existing symlink/directory
try {
  const stat = fs.lstatSync(TARGET);
  if (stat) fs.rmSync(TARGET, { recursive: true, force: true });
} catch {
  // doesn't exist — fine
}

// Create symlink: node_modules/@velocity/framework -> ../../dist
const RELATIVE = path.relative(TARGET_DIR, DIST);
fs.symlinkSync(RELATIVE, TARGET, 'dir');

console.log(`Synced: @velocity/framework -> ${RELATIVE}`);
