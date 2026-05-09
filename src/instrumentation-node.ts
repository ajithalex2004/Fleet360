/**
 * Node-runtime-only instrumentation. Imported dynamically from
 * src/instrumentation.ts after a NEXT_RUNTIME === 'nodejs' guard so the
 * Edge compiler never sees the Node APIs (process.on, etc.) and doesn't
 * emit "A Node.js API is used in the Edge Runtime" warnings.
 *
 * - Wires unhandled rejection / uncaught exception handlers into Sentry.
 * - Pre-warms the Neon connection so the first real user request doesn't
 *   pay the cold-start penalty.
 */

export async function registerNode(): Promise<void> {
  // Global error handlers → Sentry
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

  // Neon pre-warm
  try {
    const { prisma } = await import('@/lib/prisma');
    const t0 = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    console.log(`[Startup] Neon pre-warm OK — ${Date.now() - t0} ms`);
  } catch (err) {
    // Non-fatal — the app works without a warm connection; just slower first load
    console.warn('[Startup] Neon pre-warm failed (will retry on first request):', err);
  }
}
