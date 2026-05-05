/**
 * GET /api/health
 *
 * Lightweight health + Neon warm-up endpoint.
 * - Returns 200 with DB latency so the dev server can probe it on startup.
 * - Hit this route once after `npm run dev` to pre-warm the Neon connection
 *   pool before the first real user request.
 *
 * Example:
 *   curl http://localhost:3000/api/health
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic'; // never cache

export async function GET() {
  const t0 = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - t0;
    return NextResponse.json({ status: 'ok', db: 'connected', latencyMs });
  } catch (err) {
    const latencyMs = Date.now() - t0;
    return NextResponse.json(
      { status: 'degraded', db: 'error', latencyMs, error: String(err) },
      { status: 503 }
    );
  }
}
