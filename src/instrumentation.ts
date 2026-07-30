/**
 * Startup hook.
 *
 * Deliberately thin. Next compiles this file for EVERY runtime it supports,
 * including Edge — and Edge cannot resolve `node:crypto` / `node:fs`, which the
 * diagnostics need. Importing them here breaks `next dev` outright with
 * "UnhandledSchemeError: Reading from node:crypto is not handled by plugins".
 *
 * So the Node-only work lives in ./instrumentation-node and is reached through a
 * dynamic import behind the NEXT_RUNTIME check. Next replaces that value at
 * compile time per runtime, so the Edge bundle never pulls the module in.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  try {
    const { logBootDiagnostics } = await import('./instrumentation-node');
    await logBootDiagnostics();
  } catch (err) {
    // A diagnostic that can take the process down is worse than no diagnostic.
    console.warn('[boot] diagnostics unavailable:', (err as Error)?.message);
  }
}
