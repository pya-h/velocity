#!/usr/bin/env node
/**
 * velogen — Velocity Code Generator CLI
 *
 * Unified entry point for all Velocity code generation tools.
 *
 * Usage:
 *   velogen <command> <project-dir> [options]
 *
 * Commands:
 *   types   | t    Generate typed DB interfaces from @Entity files
 *   env     | e    Generate typed .env config (Envelocity)
 *   openapi | oa   Generate OpenAPI 3.1 spec from @Controller routes
 *   client  | c    Generate typed fetch client from @Controller routes
 *   api     | a    Generate interactive API testing UI from controllers
 *   all            Run all generators
 *
 * Examples:
 *   velogen types examples/full-demo
 *   velogen oa examples/full-demo
 *   velogen all examples/full-demo
 *   velogen c examples/full-demo --base-url=http://localhost:3000
 */

const { execSync } = require('child_process');
const path = require('path');

const COMMANDS = {
  types:   'velogen-types.js',   t:  'velogen-types.js',   type:    'velogen-types.js',
  env:     'velogen-env.js',     e:  'velogen-env.js',
  openapi: 'velogen-openapi.js', oa: 'velogen-openapi.js', swagger: 'velogen-openapi.js',
  client:  'velogen-client.js',  c:  'velogen-client.js',
  api:     'velogen-api.js',     a:  'velogen-api.js',     apitester: 'velogen-api.js',
};

const ALL_SCRIPTS = ['velogen-types.js', 'velogen-env.js', 'velogen-openapi.js', 'velogen-client.js', 'velogen-api.js'];

const args = process.argv.slice(2);
const command = args[0];
const rest = args.slice(1);

function showUsage() {
  console.log('velogen — Velocity Code Generator');
  console.log('');
  console.log('Usage: velogen <command> <project-dir> [options]');
  console.log('');
  console.log('Commands:');
  console.log('  types   | t     DB type interfaces');
  console.log('  env     | e     Envelocity typed .env config');
  console.log('  openapi | oa    OpenAPI 3.1 spec');
  console.log('  client  | c     Typed fetch client');
  console.log('  api     | a     Interactive API tester UI');
  console.log('  all             Run all generators');
  console.log('');
  console.log('Examples:');
  console.log('  velogen t examples/full-demo');
  console.log('  velogen all examples/full-demo');
  process.exit(1);
}

function run(script, passArgs) {
  const scriptPath = path.join(__dirname, script);
  const cmd = `node "${scriptPath}" ${passArgs.map(a => `"${a}"`).join(' ')}`;
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch {
    // Sub-script already printed its error; don't exit on `all`
  }
}

if (!command) {
  showUsage();
}

if (command === 'all') {
  if (rest.length === 0) {
    console.error('Usage: velogen all <project-dir>');
    process.exit(1);
  }
  console.log('velogen: running all generators...\n');
  for (const script of ALL_SCRIPTS) {
    run(script, rest);
    console.log('');
  }
  console.log('velogen: all done.');
  process.exit(0);
}

const script = COMMANDS[command];
if (script) {
  run(script, rest);
} else {
  // Backward compat: if first arg looks like a directory, assume `types`
  console.warn(`velogen: unknown command "${command}" — assuming "types" (backward compat)`);
  run('velogen-types.js', args);
}
