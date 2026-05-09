/**
 * Lightweight Sentry adapter — uses fetch, no SDK dependency.
 *
 * Why not @sentry/nextjs?
 *   The official SDK is excellent but adds ~500 KB to the bundle and pulls
 *   in webpack plugin config. For our v1.0 needs (capture exceptions and
 *   messages), a fetch-based reporter is sufficient. We can swap to the
 *   full SDK later without changing the call sites.
 *
 * Behaviour:
 *   - If SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN is unset, every call is a no-op.
 *   - If the network fails, errors are swallowed (we never crash on telemetry).
 *   - Each event includes environment, runtime, release (commit SHA if set).
 *
 * Usage:
 *   import { captureException, captureMessage } from '@/lib/sentry';
 *   try { ... } catch (err) { captureException(err, { context: 'leasing.invoice' }); }
 *   captureMessage('Mileage overage batch ran', { level: 'info', count: 12 });
 */

import { env, clientEnv } from '@/lib/env';

type Level = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

interface CaptureOptions {
  level?: Level;
  context?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  user?: { id?: string; email?: string; tenantId?: string };
}

const SDK_NAME = 'xl-mobility-sentry-fetch';
const SDK_VERSION = '1.0.0';
const RELEASE = process.env.GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? 'unknown';

function getDsn(): string | null {
  // Prefer server DSN; fall back to public DSN for client/edge.
  const dsn = env.SENTRY_DSN || clientEnv.NEXT_PUBLIC_SENTRY_DSN;
  return dsn && dsn.length > 0 ? dsn : null;
}

/** Parse a DSN like https://<key>@o123.ingest.sentry.io/456 into ingest URL + key. */
function parseDsn(dsn: string): { url: string; key: string; projectId: string } | null {
  try {
    const u = new URL(dsn);
    const key = u.username;
    const projectId = u.pathname.replace(/^\//, '');
    const ingest = `${u.protocol}//${u.host}/api/${projectId}/store/`;
    return { url: ingest, key, projectId };
  } catch {
    return null;
  }
}

async function send(payload: Record<string, unknown>): Promise<void> {
  const dsn = getDsn();
  if (!dsn) return;
  const parsed = parseDsn(dsn);
  if (!parsed) return;

  const auth = [
    'Sentry sentry_version=7',
    `sentry_client=${SDK_NAME}/${SDK_VERSION}`,
    `sentry_key=${parsed.key}`,
  ].join(', ');

  try {
    await fetch(parsed.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': auth,
      },
      body: JSON.stringify(payload),
      // 2 s timeout — never block a request on telemetry.
      signal: AbortSignal.timeout(2_000),
    });
  } catch {
    // Telemetry must never crash the caller.
  }
}

function baseEvent(level: Level, opts?: CaptureOptions) {
  return {
    event_id: crypto.randomUUID().replace(/-/g, ''),
    timestamp: new Date().toISOString(),
    platform: 'javascript',
    level,
    sdk: { name: SDK_NAME, version: SDK_VERSION },
    release: RELEASE,
    environment: env.NODE_ENV,
    server_name: process.env.HOSTNAME ?? 'unknown',
    tags: { runtime: process.env.NEXT_RUNTIME ?? 'nodejs', ...(opts?.tags ?? {}) },
    extra: opts?.extra ?? {},
    user: opts?.user,
    contexts: opts?.context ? { app: { context: opts.context } } : undefined,
  };
}

export function captureException(err: unknown, opts?: CaptureOptions): void {
  const error = err instanceof Error ? err : new Error(String(err));
  const event = {
    ...baseEvent(opts?.level ?? 'error', opts),
    exception: {
      values: [{
        type: error.name,
        value: error.message,
        stacktrace: error.stack ? { frames: parseStack(error.stack) } : undefined,
      }],
    },
  };
  void send(event);
}

export function captureMessage(message: string, opts?: CaptureOptions): void {
  const event = {
    ...baseEvent(opts?.level ?? 'info', opts),
    message: { formatted: message },
  };
  void send(event);
}

/** Minimal stack-frame parser (Sentry-format). Best-effort; works for V8 stacks. */
function parseStack(stack: string) {
  return stack
    .split('\n')
    .slice(1)
    .map(line => {
      const m = line.match(/at (?:(.+) \()?(.+):(\d+):(\d+)\)?/);
      if (!m) return null;
      return { function: m[1] ?? '?', filename: m[2], lineno: Number(m[3]), colno: Number(m[4]) };
    })
    .filter((x): x is { function: string; filename: string; lineno: number; colno: number } => x !== null)
    .reverse(); // Sentry expects oldest frame first
}

/** Whether Sentry is configured. Useful to gate noisy debug captures. */
export const sentryEnabled = Boolean(getDsn());
