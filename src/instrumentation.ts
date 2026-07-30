/**
 * Boot diagnostics.
 *
 * Next calls register() once when the server starts. This prints a short,
 * readable summary of the runtime configuration into the deploy logs, so a
 * failed Railway deploy names its own cause in the first ten lines instead of
 * being inferred from a healthcheck that just says "service unavailable".
 *
 * It never throws and never blocks startup — a diagnostic that can take the
 * process down is worse than no diagnostic.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

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
      where = `${u.protocol.replace(':', '')}://${u.hostname}:${u.port || '(default)'}${u.pathname}`;
    } catch {
      /* keep 'unparseable' */
    }
    lines.push(`DATABASE_URL    set → ${where}`);
    if (/\.proxy\.rlwy\.net/.test(dbUrl)) {
      lines.push(
        `                NOTE: this is the PUBLIC proxy URL. Inside Railway prefer` +
          ` \${{Postgres.DATABASE_URL}} (postgres.railway.internal) — faster and no egress cost.`,
      );
    }
  } else {
    problems.push(
      'DATABASE_URL is NOT set on this service. Add a variable on the APP service: ' +
        'DATABASE_URL = ${{Postgres.DATABASE_URL}} — the variable on the Postgres plugin is not shared automatically.',
    );
  }

  if (process.env.OPENAI_API_KEY?.trim()) {
    lines.push(`OPENAI_API_KEY  set (${process.env.OPENAI_API_KEY.trim().length} chars)`);
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
  try {
    const { masterPromptInfo } = await import('./lib/master-prompt');
    const info = masterPromptInfo();
    lines.push(`master prompt   ${info.version} (${info.bytes} bytes)`);
  } catch (err) {
    problems.push(`master prompt NOT loadable: ${(err as Error).message.split('\n')[0]}`);
  }

  console.log('\n┌─ ICP Builder — boot ' + '─'.repeat(48));
  for (const line of lines) console.log('│ ' + line);
  if (problems.length) {
    console.log('│');
    for (const problem of problems) console.log('│ ⚠ ' + problem);
  }
  console.log('└' + '─'.repeat(69) + '\n');
}
