/**
 * Start the server.
 *
 * Exists for one line of it: HOSTNAME.
 *
 * Next's standalone server binds to `process.env.HOSTNAME`. Docker sets that
 * variable to the container's ID — so on Railway the server started, reported
 * itself perfectly healthy, and listened on `http://2914db583bd8:8080`, an
 * address the platform's proxy cannot route to. Every healthcheck came back
 * "service unavailable", every deploy was marked failed, and the logs showed a
 * clean boot in 132ms with no error anywhere. The build was never the problem.
 *
 * Forcing 0.0.0.0 before the server module is imported fixes it at the source,
 * so the deploy no longer depends on someone remembering to set an environment
 * variable that has nothing to do with this application.
 */
import path from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const declared = process.env.HOSTNAME;

// Anything that is not already a bind-all address is a container name, a pod
// name, or a machine name — none of which the platform can route to.
if (declared !== '0.0.0.0' && declared !== '::') {
  process.env.HOSTNAME = '0.0.0.0';
  if (declared) {
    console.log(`[start] HOSTNAME was "${declared}" (the container's own name) — binding 0.0.0.0 instead`);
  }
}

if (!process.env.PORT) process.env.PORT = '3000';

const server = path.join(process.cwd(), '.next', 'standalone', 'server.js');

if (!existsSync(server)) {
  console.error(
    [
      '',
      '[start] FATAL: .next/standalone/server.js is missing.',
      '',
      'The build did not finish, or it ran somewhere other than this directory.',
      'Run `npm run build` first — it ends with "[postbuild] standalone output is complete".',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

// The standalone bundle resolves its own assets relative to cwd.
process.chdir(path.dirname(server));

await import(pathToFileURL(server).href);
