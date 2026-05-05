import { NextResponse } from 'next/server';

/**
 * Wrap a JSON response with a Cache-Control header.
 * @param data      The JSON payload
 * @param maxAge    Browser cache duration in seconds (default: 30)
 * @param swr       Stale-while-revalidate window in seconds (default: 60)
 */
export function cachedJson<T>(data: T, maxAge = 30, swr = 60): NextResponse {
  const res = NextResponse.json(data);
  res.headers.set('Cache-Control', `private, max-age=${maxAge}, stale-while-revalidate=${swr}`);
  return res;
}

/**
 * Standard error response
 */
export function errorJson(message: string, status = 500): NextResponse {
  return NextResponse.json({ error: message }, { status });
}
