import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const GO_BACKEND_URL = process.env.GO_BACKEND_URL ?? 'http://localhost:8080';

export async function GET() {
  try {
    const upstreamUrl = new URL('/readyz', GO_BACKEND_URL);
    const res = await fetch(upstreamUrl, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
      },
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      {
        status: 'not_ready',
        error: err instanceof Error ? err.message : 'Go backend unreachable',
        backendUrl: GO_BACKEND_URL,
      },
      { status: 503 },
    );
  }
}
