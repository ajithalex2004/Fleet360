/**
 * Node-runtime-only instrumentation. Imported dynamically from
 * src/instrumentation.ts after a NEXT_RUNTIME === 'nodejs' guard so the
 * Edge compiler never sees the Node APIs (process.on, etc.) and doesn't
 * emit "A Node.js API is used in the Edge Runtime" warnings.
 *
 * - Wires unhandled rejection / uncaught exception handlers into Sentry.
 * - Best-effort pre-warms the Neon connection so the first real user request
 *   is less likely to pay the cold-start penalty.
 */

export async function registerNode(): Promise<void> {
  try {
    const { captureException, sentryEnabled } = await import('@/lib/sentry');
    process.on('unhandledRejection', (reason) => {
      console.error('[unhandledRejection]', reason);
      captureException(reason, { level: 'error', context: 'unhandledRejection' });
    });
    process.on('uncaughtException', (err) => {
      console.error('[uncaughtException]', err);
      captureException(err, { level: 'fatal', context: 'uncaughtException' });
    });
    if (sentryEnabled) console.log('[Startup] Sentry configured');
  } catch (err) {
    console.warn('[Startup] Sentry handler registration failed:', err);
  }

  await prewarmNeon();
}

async function prewarmNeon(): Promise<void> {
  if (process.env.FLEET360_SKIP_DB_PREWARM === 'true') {
    console.log('[Startup] Neon pre-warm disabled by FLEET360_SKIP_DB_PREWARM.');
    return;
  }

  try {
    const { prisma } = await import('@/lib/prisma');
    const { retryDb } = await import('@/lib/db-retry');
    const latencyMs = await retryDb(async () => {
      const t0 = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      return Date.now() - t0;
    }, { attempts: 3, delayMs: 750 });
    console.log(`[Startup] Neon pre-warm OK - ${latencyMs} ms`);
  } catch (err) {
    const message = err instanceof Error
      ? err.message.split('\n').map(line => line.trim()).find(Boolean) ?? err.name
      : String(err);
    console.warn(`[Startup] Neon pre-warm skipped: ${message}. The app will retry on first DB request.`);
  }
}
