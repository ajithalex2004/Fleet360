/**
 * Structured logger — emits one JSON object per line so log aggregators
 * (Datadog / GCP Logs / CloudWatch) can index every field.
 *
 * Routes through the platform's existing Sentry helper for warn/error
 * (so production exceptions still surface in monitoring) but always
 * also writes a JSON line to stdout for log aggregation.
 *
 * Usage:
 *   import { log } from '@/lib/log';
 *   log.info('billing.checkout.created', { tenantId, plan, sessionId });
 *   log.warn('rate_limit.hit', { tenantId, path, limit });
 *   log.error('stripe.webhook.failed', { eventType }, err);
 */

import { captureException, captureMessage } from '@/lib/sentry';

type Level = 'debug' | 'info' | 'warn' | 'error';

interface BaseFields {
  level: Level;
  ts: string;
  msg: string;
  [key: string]: unknown;
}

const RUNTIME = (() => {
  if (typeof globalThis !== 'undefined' && (globalThis as { EdgeRuntime?: string }).EdgeRuntime) return 'edge';
  if (typeof process !== 'undefined' && process.versions?.node) return 'node';
  return 'unknown';
})();

const RELEASE = process.env.GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? 'unknown';

function emit(level: Level, msg: string, data: Record<string, unknown> = {}, err?: unknown): void {
  const payload: BaseFields = {
    level,
    ts: new Date().toISOString(),
    msg,
    runtime: RUNTIME,
    release: RELEASE,
    ...data,
  };
  if (err) {
    payload.error = err instanceof Error
      ? { name: err.name, message: err.message, stack: err.stack }
      : String(err);
  }
  // Single JSON line per log entry — easy for aggregators to parse.
  const line = JSON.stringify(payload);
  switch (level) {
    case 'error': console.error(line); break;
    case 'warn':  console.warn(line);  break;
    case 'debug': if (process.env.DEBUG) console.debug(line); break;
    default:      console.log(line);
  }
}

export const log = {
  debug(msg: string, data?: Record<string, unknown>): void {
    emit('debug', msg, data);
  },
  info(msg: string, data?: Record<string, unknown>): void {
    emit('info', msg, data);
  },
  warn(msg: string, data?: Record<string, unknown>): void {
    emit('warn', msg, data);
    captureMessage(msg, { level: 'warning', extra: data });
  },
  error(msg: string, data?: Record<string, unknown>, err?: unknown): void {
    emit('error', msg, data, err);
    if (err) captureException(err, { context: msg, extra: data });
    else captureMessage(msg, { level: 'error', extra: data });
  },
};
