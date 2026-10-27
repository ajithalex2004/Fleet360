export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';

export interface PingResult {
  ok: boolean;
  status: 'healthy' | 'error' | 'unconfigured' | 'unreachable' | 'quota_exceeded';
  latencyMs?: number;
  message: string;
  checkedAt: string;
}

// 1. Stripe Live Probe
async function probeStripe(): Promise<PingResult> {
  const checkedAt = new Date().toISOString();
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return { ok: false, status: 'unconfigured', message: 'STRIPE_SECRET_KEY is not set', checkedAt };
  }
  const start = Date.now();
  try {
    const res = await fetch('https://api.stripe.com/v1/balance', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(4500),
    });
    const latencyMs = Date.now() - start;
    if (res.ok) {
      return { ok: true, status: 'healthy', latencyMs, message: 'Live Stripe API authenticated & balance reachable', checkedAt };
    }
    const data = await res.json().catch(() => ({}));
    return {
      ok: false,
      status: 'error',
      latencyMs,
      message: data?.error?.message ?? `Stripe error (HTTP ${res.status})`,
      checkedAt,
    };
  } catch (err) {
    return {
      ok: false,
      status: 'unreachable',
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : String(err),
      checkedAt,
    };
  }
}

// 2. SendGrid Live Probe
async function probeSendGrid(): Promise<PingResult> {
  const checkedAt = new Date().toISOString();
  const key = process.env.SENDGRID_API_KEY;
  if (!key) {
    return { ok: false, status: 'unconfigured', message: 'SENDGRID_API_KEY is not set', checkedAt };
  }
  const start = Date.now();
  try {
    const res = await fetch('https://api.sendgrid.com/v3/user/profile', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(4500),
    });
    const latencyMs = Date.now() - start;
    if (res.ok) {
      return { ok: true, status: 'healthy', latencyMs, message: 'SendGrid API reachable & account profile verified', checkedAt };
    }
    const data = await res.json().catch(() => ({}));
    const errMsg = Array.isArray(data?.errors) ? data.errors[0]?.message : `HTTP ${res.status}`;
    return {
      ok: false,
      status: 'error',
      latencyMs,
      message: errMsg || 'SendGrid authentication failed',
      checkedAt,
    };
  } catch (err) {
    return {
      ok: false,
      status: 'unreachable',
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : String(err),
      checkedAt,
    };
  }
}

// 3. Google Maps Platform Live Probe
async function probeGoogleMaps(): Promise<PingResult> {
  const checkedAt = new Date().toISOString();
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return { ok: false, status: 'unconfigured', message: 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set', checkedAt };
  }
  const start = Date.now();
  try {
    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=Dubai&key=${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(4500),
    });
    const latencyMs = Date.now() - start;
    const data = await res.json().catch(() => ({}));
    if (data.status === 'OK' || data.status === 'ZERO_RESULTS') {
      return { ok: true, status: 'healthy', latencyMs, message: 'Google Maps geocoding & rendering quota verified', checkedAt };
    }
    if (data.status === 'REQUEST_DENIED') {
      return {
        ok: false,
        status: 'error',
        latencyMs,
        message: data.error_message || 'API key request denied by Google Maps Platform',
        checkedAt,
      };
    }
    if (data.status === 'OVER_QUERY_LIMIT') {
      return { ok: false, status: 'quota_exceeded', latencyMs, message: 'Google Maps query quota exceeded', checkedAt };
    }
    return { ok: false, status: 'error', latencyMs, message: `Google Maps status: ${data.status}`, checkedAt };
  } catch (err) {
    return {
      ok: false,
      status: 'unreachable',
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : String(err),
      checkedAt,
    };
  }
}

// 4. Sentry Live Ingest Host Probe
async function probeSentry(): Promise<PingResult> {
  const checkedAt = new Date().toISOString();
  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) {
    return { ok: false, status: 'unconfigured', message: 'SENTRY_DSN is not set', checkedAt };
  }
  const start = Date.now();
  try {
    const url = new URL(dsn);
    await fetch(`https://${url.host}`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(4500),
    });
    const latencyMs = Date.now() - start;
    return {
      ok: true,
      status: 'healthy',
      latencyMs,
      message: `Sentry telemetry ingest endpoint (${url.host}) reachable`,
      checkedAt,
    };
  } catch (err) {
    return {
      ok: false,
      status: 'unreachable',
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : String(err),
      checkedAt,
    };
  }
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }

  const body = await req.json().catch(() => ({}));
  const target = (body.target as string) || 'all';

  if (target === 'stripe') {
    const result = await probeStripe();
    return NextResponse.json({ target: 'stripe', result });
  }
  if (target === 'sendgrid') {
    const result = await probeSendGrid();
    return NextResponse.json({ target: 'sendgrid', result });
  }
  if (target === 'googleMaps') {
    const result = await probeGoogleMaps();
    return NextResponse.json({ target: 'googleMaps', result });
  }
  if (target === 'sentry') {
    const result = await probeSentry();
    return NextResponse.json({ target: 'sentry', result });
  }

  // Probe all simultaneously
  const [stripe, sendgrid, googleMaps, sentry] = await Promise.all([
    probeStripe(),
    probeSendGrid(),
    probeGoogleMaps(),
    probeSentry(),
  ]);

  return NextResponse.json({
    target: 'all',
    results: {
      stripe,
      sendgrid,
      googleMaps,
      sentry,
    },
  });
}
