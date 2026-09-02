/**
 * Node-runtime-only instrumentation. Imported dynamically from
 * src/instrumentation.ts after a NEXT_RUNTIME === 'nodejs' guard so the
 * Edge compiler never sees the Node APIs (process.on, etc.).
 *
 * Startup work must not block server readiness. Remote database warmup is
 * best-effort and intentionally runs in the background.
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

  if (process.env.FLEET360_SKIP_DB_PREWARM === 'true') {
    console.warn('[Startup] Neon pre-warm skipped by FLEET360_SKIP_DB_PREWARM=true');
  } else {
    void warmNeonConnection();
  }

  try {
    const { startJobScheduler } = await import('@/lib/jobs/scheduler');
    void startJobScheduler();
  } catch (err) {
    console.warn('[Startup] Job scheduler failed to start:', err);
  }
}

async function warmNeonConnection(): Promise<void> {
  try {
    const { prisma, startDbKeepAlive } = await import('@/lib/prisma');
    const t0 = Date.now();
    const timeoutMs = getPrewarmTimeoutMs();
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Neon pre-warm timed out after ${timeoutMs} ms`)), timeoutMs)
      ),
    ]);
    console.log(`[Startup] Neon pre-warm OK - ${Date.now() - t0} ms`);
    startDbKeepAlive();
  } catch (err) {
    console.warn(`[Startup] Neon pre-warm deferred: ${summarizeDbStartupError(err)}. The app will retry on first DB request.`);
  }
}

function summarizeDbStartupError(err: unknown): string {
  const seen = new Set<unknown>();
  let current = err;

  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const error = current as { code?: unknown; message?: unknown; cause?: unknown };
    const code = error.code ? `${String(error.code)} ` : '';
    const message = String(error.message ?? '').split('\n')[0]?.trim();
    if (message) return `${code}${message}`.trim();
    current = error.cause;
  }

  return err instanceof Error ? err.message : String(err);
}

function getPrewarmTimeoutMs(): number {
  if (process.env.DB_PREWARM_TIMEOUT_MS) {
    return Number(process.env.DB_PREWARM_TIMEOUT_MS);
  }

  const connectTimeoutMs = Number(process.env.DB_CONNECT_TIMEOUT_MS ?? 3_000);
  const connectRetries = Number(process.env.DB_CONNECT_RETRIES ?? 1);
  const retryDelayMs = Number(process.env.DB_CONNECT_RETRY_BASE_DELAY_MS ?? 500);
  const retryBudgetMs =
    connectTimeoutMs * (connectRetries + 1) +
    retryDelayMs * ((connectRetries * (connectRetries + 1)) / 2);

  return Math.max(15_000, retryBudgetMs + 2_000);
}
