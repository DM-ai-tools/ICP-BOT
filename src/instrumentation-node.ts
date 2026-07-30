/**
 * Boot diagnostics — Node runtime only.
 *
 * Reached exclusively via a dynamic import from instrumentation.ts, guarded by
 * NEXT_RUNTIME. Keeping the node: imports out of the shared instrumentation
 * entrypoint is what stops the Edge compilation failing.
 *
 * Prints a short, readable summary of the runtime configuration into the deploy
 * logs, so a failed Railway deploy names its own cause in the first ten lines
 * instead of being inferred from a healthcheck that says "service unavailable".
 * Never throws, never blocks startup, never logs a secret.
 */

export async function logBootDiagnostics(): Promise<void> {
  const lines: string[] = [];
  const problems: string[] = [];

  lines.push(`node            ${process.version}`);
  lines.push(`NODE_ENV        ${process.env.NODE_ENV ?? '(unset)'}`);
  lines.push(`PORT            ${process.env.PORT ?? '(unset — will default to 3000)'}`);
  lines.push(`HOSTNAME        ${process.env.HOSTNAME ?? '(unset — will default to 0.0.0.0)'}`);
  lines.push(`cwd             ${process.cwd()}`);

  const dbUrl = process.env.DATABASE_URL?.trim();
  if (dbUrl) {
    // Host and database only. The password never reaches a log line.
    let where = 'unparseable';
    try {
      const u = new URL(dbUrl);
      where = `${u.protocol}//${u.hostname}:${u.port || '(default)'}${u.pathname}`;
    } catch {
      /* keep 'unparseable' */
    }
    lines.push(`DATABASE_URL    set → ${where}`);
    if (/\.proxy\.rlwy\.net/.test(dbUrl)) {
      lines.push(
        '                NOTE: public proxy host. Inside Railway prefer ${{Postgres.DATABASE_URL}}' +
          ' (postgres.railway.internal) — faster and no egress cost.',
      );
    }
  } else {
    problems.push(
      'DATABASE_URL is NOT set on this service. Add it to the APP service: ' +
        'DATABASE_URL = ${{Postgres.DATABASE_URL}} — the variable on the Postgres plugin is not shared automatically.',
    );
  }

  const key = process.env.OPENAI_API_KEY?.trim();
  if (key && !/REPLACE|your-key|xxx/i.test(key)) {
    lines.push(`OPENAI_API_KEY  set (${key.length} chars)`);
  } else if (key) {
    problems.push('OPENAI_API_KEY is still a placeholder. Chat and generation will fail.');
  } else {
    problems.push('OPENAI_API_KEY is NOT set. The app will serve, but chat and generation will fail.');
  }

  lines.push(`OPENAI_MODEL    ${process.env.OPENAI_MODEL ?? 'gpt-4o (default)'}`);
  lines.push(`OPENAI_MODEL_FAST ${process.env.OPENAI_MODEL_FAST ?? 'gpt-4o-mini (default)'}`);

  if (process.env.NEXT_PUBLIC_OPENAI_API_KEY) {
    problems.push('NEXT_PUBLIC_OPENAI_API_KEY is set — remove it. That exposes the key to the browser.');
  }

  // The master prompt is read from disk; a missing file is fatal to generation
  // and is worth surfacing at boot rather than on the first request.
  //
  // Deliberately NOT `await import('./lib/master-prompt')`. Webpack follows
  // that import when it compiles instrumentation for the Edge runtime, where
  // node:fs does not exist, and the whole dev server dies with
  // "UnhandledSchemeError". eval('require') is opaque to the bundler, so this
  // stays a plain runtime lookup on Node and is invisible to Edge. The version
  // hash still comes from master-prompt.ts via /api/health — this only confirms
  // the file made it into the image.
  try {
    // eslint-disable-next-line no-eval
    const nodeRequire = eval('require') as NodeRequire;
    const fs = nodeRequire('fs') as typeof import('fs');
    const path = nodeRequire('path') as typeof import('path');

    const candidates = [
      path.join(process.cwd(), 'prompts', 'master_icp.md'),
      path.join(process.cwd(), '.next', 'standalone', 'prompts', 'master_icp.md'),
    ];
    const found = candidates.find((p) => fs.existsSync(p));

    if (found) {
      lines.push(`master prompt   present (${fs.statSync(found).size} bytes) — version at /api/health`);
    } else {
      problems.push(
        'prompts/master_icp.md NOT found beside the server. Generation will fail. ' +
          'Check that scripts/postbuild.mjs ran during the build.',
      );
    }
  } catch {
    // Diagnostics are best-effort; never let this stage stop the server.
  }

  console.log('\n┌─ ICP Builder — boot ' + '─'.repeat(48));
  for (const line of lines) console.log('│ ' + line);
  if (problems.length) {
    console.log('│');
    for (const problem of problems) console.log('│ ⚠ ' + problem);
  }
  console.log('└' + '─'.repeat(69) + '\n');
}
