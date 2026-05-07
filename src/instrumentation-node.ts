/**
 * Node-only instrumentation body.
 *
 * Imported dynamically by instrumentation.ts only when running in the
 * Node runtime, so Turbopack never analyses these `process.on` calls
 * for the Edge runtime.
 *
 *  - Pre-warms the Neon connection (cold-start tax can be 3-8s)
 *  - Wires unhandled rejection / uncaught exception handlers into Sentry
 */

import { captureException, sentryEnabled } from '@/lib/sentry';
import { prisma } from '@/lib/prisma';

// Global error handlers → Sentry
try {
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
(async () => {
  try {
    const t0 = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    console.log(`[Startup] Neon pre-warm OK — ${Date.now() - t0} ms`);
  } catch (err) {
    // Non-fatal — the app works without a warm connection; just slower first load
    console.warn('[Startup] Neon pre-warm failed (will retry on first request):', err);
  }
})();
