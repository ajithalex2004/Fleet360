import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const GO_BACKEND_URL = process.env.GO_BACKEND_URL ?? 'http://localhost:8080';

export async function GET() {
  try {
    const upstreamUrl = new URL('/readyz', GO_BACKEND_URL);
    const res = await fetch(upstreamUrl, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2500),
      headers: {
        Accept: 'application/json',
      },
    });

    // Any non-2xx upstream status (even if returning valid JSON with diagnostics)
    // MUST return a generic safe 503 without echoing upstream error fields or hostnames.
    if (!res.ok) {
      return NextResponse.json(
        { status: 'not_ready', error: 'service unavailable' },
        { status: 503 },
      );
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      // Upstream returned non-JSON body
      return NextResponse.json(
        { status: 'not_ready', error: 'upstream service unavailable' },
        { status: 503 },
      );
    }

    // Strictly allowlist fields returned to public callers — never reflect arbitrary upstream JSON
    const payload = data as Record<string, unknown> | null;
    const version = typeof payload?.version === 'string' ? payload.version : undefined;

    return NextResponse.json(
      {
        status: 'ready',
        ...(version ? { version } : {}),
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch (err) {
    // Log the real error server-side only — never expose upstream URLs, DSNs,
    // hostnames, or connection errors to an unauthenticated caller.
    console.error('[api/readyz] upstream check failed:', err);
    return NextResponse.json(
      {
        status: 'not_ready',
        error: 'service unavailable',
      },
      { status: 503 },
    );
  }
}
