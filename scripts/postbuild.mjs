/**
 * Finish the standalone build.
 *
 * `output: 'standalone'` produces .next/standalone/server.js with a minimal
 * node_modules, but Next deliberately does NOT copy .next/static or public/
 * into it — that is left to the deploy pipeline. Skip this and the container
 * boots, passes its healthcheck, and serves every page with no CSS and no
 * client JavaScript. Green deploy, broken app.
 *
 * Also copies prompts/, so the master prompt is on disk beside the server.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const standalone = path.join(root, '.next', 'standalone');

if (!existsSync(standalone)) {
  console.log('[postbuild] no standalone output — nothing to do');
  process.exit(0);
}

function copy(from, to, label) {
  if (!existsSync(from)) {
    console.log(`[postbuild] skipped ${label} (not present)`);
    return;
  }
  mkdirSync(path.dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true, dereference: true });
  console.log(`[postbuild] copied ${label}`);
}

copy(
  path.join(root, '.next', 'static'),
  path.join(standalone, '.next', 'static'),
  '.next/static → standalone',
);

copy(path.join(root, 'public'), path.join(standalone, 'public'), 'public → standalone');

// outputFileTracingIncludes normally handles this, but copy defensively: a
// missing master prompt is a hard boot failure, not a cosmetic one.
copy(path.join(root, 'prompts'), path.join(standalone, 'prompts'), 'prompts → standalone');

// Fail loudly here rather than in production.
const requiredStatic = path.join(standalone, '.next', 'static');
if (!existsSync(requiredStatic) || readdirSync(requiredStatic).length === 0) {
  console.error('[postbuild] FATAL: .next/static did not land in the standalone output.');
  process.exit(1);
}

const requiredPrompt = path.join(standalone, 'prompts', 'master_icp.md');
if (!existsSync(requiredPrompt) || statSync(requiredPrompt).size < 1000) {
  console.error('[postbuild] FATAL: prompts/master_icp.md is missing or truncated.');
  process.exit(1);
}

console.log('[postbuild] standalone output is complete');
