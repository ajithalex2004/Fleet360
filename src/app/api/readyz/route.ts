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

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      // Upstream returned non-JSON (e.g. 502/504 HTML from a reverse proxy)
      return NextResponse.json(
        { status: 'not_ready', error: 'upstream service unavailable' },
        { status: 503 },
      );
    }

    return NextResponse.json(data, { status: res.status });
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
