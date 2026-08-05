/**
 * The build.
 *
 * `prisma generate && next build && node scripts/postbuild.mjs` was correct and
 * still failed on Railway repeatedly, because the ways a Next build dies in a
 * container are not the ways it dies on a laptop:
 *
 *   1. OOM. `next build` is the memory peak of the whole pipeline. Containers
 *      cap lower than a dev machine and V8's default heap is smaller still, so
 *      the build is killed — exit 137, or a bare "Killed", with no stack and no
 *      mention of memory anywhere. It reads like a hang.
 *
 *   2. A restored node_modules with no generated Prisma client. Build caching
 *      can hand back a node_modules that predates the current schema. The build
 *      then fails deep inside a route with "@prisma/client did not initialize
 *      yet", which points at application code rather than at the cache.
 *
 *   3. A schema change with no matching client. Same symptom, different cause,
 *      and equally invisible in the log.
 *
 * So this script raises the heap, guarantees the client, and — the part that
 * actually saves the time — translates a failure into the thing to go and do.
 * Every step prints what it is doing, because a build log that goes quiet for
 * four minutes is indistinguishable from one that has died.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const RULE = '='.repeat(72);

function banner(title, lines) {
  console.error(`\n${RULE}`);
  console.error(`  ${title}`);
  console.error(RULE);
  for (const line of lines) console.error(`  ${line}`);
  console.error(`${RULE}\n`);
}

function step(label) {
  console.log(`\n[build] ${label}`);
}

/**
 * Heap ceiling for the Next build.
 *
 * 4 GB unless the environment says otherwise. If the container has less than
 * that, the OS kills the process at its own limit and we are no worse off; if
 * it has more, the build stops dying at V8's default. Anyone who needs a
 * different number sets NEXT_BUILD_MEMORY_MB and it is honoured.
 */
const heapMb = Number(process.env.NEXT_BUILD_MEMORY_MB) || 4096;

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...extraEnv },
  });
  return result.status ?? 1;
}

// ---------------------------------------------------------------------------
// Toolchain, stated up front. Half of "it works locally" is a version gap, and
// the log should answer that without a rebuild.
// ---------------------------------------------------------------------------

let declaredNode = 'unspecified';
try {
  declaredNode = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).engines?.node ?? 'unspecified';
} catch {
  /* package.json is unreadable; the build is about to fail louder than this */
}

console.log(RULE);
console.log('  ICP Builder — build');
console.log(RULE);
console.log(`  node        ${process.version}  (package.json asks for ${declaredNode})`);
console.log(`  platform    ${process.platform} ${process.arch}`);
console.log(`  heap cap    ${heapMb} MB`);
console.log(`  cwd         ${root}`);
console.log(RULE);

const major = Number(process.version.replace(/^v/, '').split('.')[0]);
if (major < 20) {
  banner('Node is too old to build this app', [
    `Running ${process.version}; this app needs Node 20 or newer (22 is pinned).`,
    '',
    'On Railway: Settings → set the Node version, or confirm .nvmrc is committed.',
    'Nixpacks reads .nvmrc and .node-version from the repo root.',
  ]);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. Prisma client — generated unconditionally.
//
// Cheap when the cache is warm, and it removes an entire class of failure that
// otherwise surfaces as an application error three minutes later.
// ---------------------------------------------------------------------------

step('generating the Prisma client');
const generated = run('npx', ['prisma', 'generate']);

if (generated !== 0) {
  banner('Prisma client generation failed', [
    'The build cannot continue without it — every database call goes through it.',
    '',
    'Usual causes, in order:',
    '  1. prisma/schema.prisma has a syntax error. The message above names the line.',
    '  2. The build has no network access and no cached Prisma engines.',
    '  3. A binaryTarget in the schema is not available for this platform.',
    '',
    'DATABASE_URL is NOT required for this step — generation reads the schema,',
    'not the database. If the error mentions DATABASE_URL, the schema is being',
    'validated instead of generated; check the generator block.',
  ]);
  process.exit(generated);
}

const clientPath = path.join(root, 'node_modules', '.prisma', 'client');
if (!existsSync(clientPath)) {
  banner('Prisma reported success but wrote no client', [
    `Expected: ${clientPath}`,
    '',
    'This almost always means node_modules was restored from a build cache and',
    'is read-only or partially populated. Clear the build cache and redeploy.',
    'On Railway: Deployments → ⋯ → Redeploy without cache.',
  ]);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Next build, with a heap that survives a container.
// ---------------------------------------------------------------------------

step(`building (NODE_OPTIONS=--max-old-space-size=${heapMb})`);

const existingOptions = process.env.NODE_OPTIONS ?? '';
const nodeOptions = /max-old-space-size/.test(existingOptions)
  ? existingOptions
  : `${existingOptions} --max-old-space-size=${heapMb}`.trim();

const built = run('npx', ['next', 'build'], { NODE_OPTIONS: nodeOptions });

if (built !== 0) {
  // 137 is SIGKILL, which in a container is the OOM killer almost every time.
  const oom = built === 137 || built === 134;
  banner(oom ? 'The build was killed — almost certainly out of memory' : 'next build failed', [
    ...(oom
      ? [
          `Exit ${built} means the process was killed rather than that it errored.`,
          'In a container that is the OOM killer.',
          '',
          'Fixes, cheapest first:',
          '  1. Give the build more memory. On Railway, raise the plan or the',
          '     build resources for this service.',
          `  2. Lower the heap cap so V8 collects more aggressively instead of`,
          `     growing into the container limit: set NEXT_BUILD_MEMORY_MB below`,
          `     the container's actual memory (currently asking for ${heapMb} MB).`,
          '  3. Clear the build cache and redeploy — a stale .next can inflate',
          '     peak memory considerably.',
        ]
      : [
          'The error above is from Next itself and names the file.',
          '',
          'If it mentions a missing environment variable: nothing in this app',
          'should read env at module scope, so that is a real regression — the',
          'value must be read inside a function, not at import time.',
          '',
          'If it mentions `server-only`: a client component has imported a',
          'server module. Split the shared types into their own file.',
        ]),
  ]);
  process.exit(built);
}

// ---------------------------------------------------------------------------
// 3. Finish the standalone output.
// ---------------------------------------------------------------------------

step('completing the standalone output');
const finished = run('node', [path.join('scripts', 'postbuild.mjs')]);

if (finished !== 0) {
  banner('The standalone output is incomplete', [
    'The build compiled, but the deployable bundle is missing something it',
    'needs at runtime — the message above says which.',
    '',
    'This check exists because the alternative is a green deploy that serves',
    'every page with no CSS, or a container that boots and then cannot find',
    'the master prompt. Failing here is the cheaper outcome.',
  ]);
  process.exit(finished);
}

console.log(`\n${RULE}`);
console.log('  Build complete.');
console.log(RULE);
