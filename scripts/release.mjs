/**
 * Release step — runs before the new container is promoted.
 *
 * Exists because `prisma migrate deploy` on its own fails like this when the
 * service is missing a variable:
 *
 *     error: Environment variable not found: DATABASE_URL.
 *     Error code: P1012
 *     [Context: getConfig]
 *
 * which is true, buried, and tells nobody what to click. This wraps the same
 * command so the fix is stated in the log instead of inferred.
 *
 * It still exits non-zero on a real problem — a deploy that cannot reach its
 * database should fail, not go live broken. It just says why.
 */
import { spawn } from 'node:child_process';

const RULE = '='.repeat(72);

function banner(title, lines) {
  console.error(`\n${RULE}`);
  console.error(`  ${title}`);
  console.error(RULE);
  for (const line of lines) console.error(`  ${line}`);
  console.error(`${RULE}\n`);
}

// ---------------------------------------------------------------------------
// 1. Is the variable there at all?
// ---------------------------------------------------------------------------

const url = process.env.DATABASE_URL?.trim();

if (!url) {
  // List the names Railway DID inject, so it is obvious whether the service has
  // any variables at all or just not this one. Names only — never values.
  const visible = Object.keys(process.env)
    .filter((k) => /^(DATABASE|POSTGRES|PG|MYSQL|OPENAI|RAILWAY|PORT|NODE_ENV)/i.test(k))
    .sort();

  banner('DEPLOY STOPPED — DATABASE_URL is not set on this service', [
    '',
    'Prisma cannot connect because this service has no DATABASE_URL.',
    '',
    'This is almost always the same mistake: the variable is set on the',
    'Postgres plugin, but NOT on the app service. Railway does not share',
    'variables between services automatically — you have to reference them.',
    '',
    'FIX (about 30 seconds):',
    '',
    '  1. Railway dashboard → open the ICP-BOT service',
    '     (the app service, NOT the Postgres one)',
    '  2. Variables tab → + New Variable',
    '  3. Name:  DATABASE_URL',
    '     Value: ${{Postgres.DATABASE_URL}}',
    '     ^ type it exactly, including the ${{ }} — it is a reference,',
    '       not a pasted password, and it survives credential rotation.',
    '  4. If your Postgres service has a different name, use that name',
    '     instead of "Postgres" inside the braces.',
    '  5. Redeploy.',
    '',
    'While you are there, the app also needs:',
    '  OPENAI_API_KEY     = sk-...',
    '  OPENAI_MODEL       = gpt-4o',
    '  OPENAI_MODEL_FAST  = gpt-4o-mini',
    '',
    'Do NOT set PORT — Railway injects it.',
    '',
    `Variables this service can currently see: ${visible.length ? visible.join(', ') : '(none matching)'}`,
    '',
  ]);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Does it look like a connection string?
// ---------------------------------------------------------------------------

let parsed;
try {
  parsed = new URL(url);
} catch {
  banner('DEPLOY STOPPED — DATABASE_URL is not a valid connection string', [
    '',
    'It is set, but it could not be parsed as a URL.',
    '',
    'Expected shape:',
    '  postgresql://USER:PASSWORD@HOST:PORT/DATABASE',
    '',
    'If you pasted the value by hand, prefer the reference form instead:',
    '  DATABASE_URL = ${{Postgres.DATABASE_URL}}',
    '',
  ]);
  process.exit(1);
}

if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
  banner(`DEPLOY STOPPED — DATABASE_URL is not a Postgres URL (got "${parsed.protocol}//")`, [
    '',
    'This app is built on Postgres (prisma/schema.prisma sets provider = "postgresql").',
    '',
    'If you meant to use MySQL, the schema provider and several column types',
    'have to change first — bare String maps to VARCHAR(191) in MySQL, which',
    'would truncate generated ICP documents. Ask before switching.',
    '',
  ]);
  process.exit(1);
}

console.log(
  `[release] DATABASE_URL → ${parsed.protocol}//${parsed.hostname}:${parsed.port || '(default)'}${parsed.pathname}`,
);
if (/\.proxy\.rlwy\.net$/.test(parsed.hostname)) {
  console.log(
    '[release] NOTE: that is the public proxy host. Inside Railway, ${{Postgres.DATABASE_URL}} ' +
      '(postgres.railway.internal) is faster and avoids egress charges.',
  );
}

// ---------------------------------------------------------------------------
// 3. Migrate, with a little patience for a database that is still waking up
// ---------------------------------------------------------------------------

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

const ATTEMPTS = 3;
let code = 1;

for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  console.log(`[release] prisma migrate deploy (attempt ${attempt}/${ATTEMPTS})`);
  code = await run('prisma', ['migrate', 'deploy']);
  if (code === 0) break;

  if (attempt < ATTEMPTS) {
    const wait = attempt * 4000;
    console.log(`[release] failed; the database may still be starting. Retrying in ${wait / 1000}s…`);
    await new Promise((r) => setTimeout(r, wait));
  }
}

if (code !== 0) {
  banner('DEPLOY STOPPED — migrations could not be applied', [
    '',
    'DATABASE_URL is set and looks valid, but the migration failed above.',
    '',
    'Common causes:',
    '  • The Postgres service is not running, or is in another project/environment.',
    '  • The reference points at a service name that does not exist',
    '    (check the name inside ${{ ... }} matches your database service).',
    '  • The database rejected the credentials — rotate and let the reference re-resolve.',
    '',
    'The Prisma error immediately above this box is the real cause.',
    '',
  ]);
  process.exit(code);
}

console.log('[release] migrations applied. Starting the app.');
