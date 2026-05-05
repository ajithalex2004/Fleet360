/**
 * Next.js Instrumentation hook (runs once on server startup).
 *
 * - Pre-warms the Neon connection so the first real user request doesn't pay
 *   the cold-start penalty (typically 3–8 s on a dormant Neon branch).
 * - Wires unhandled rejection / uncaught exception handlers into Sentry so
 *   crashes are reported even if the request handler doesn't catch them.
 *
 * Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only run in the Node.js runtime (not Edge), and only on actual server boot.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

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
