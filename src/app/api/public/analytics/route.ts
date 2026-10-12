import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { RateLimiter } from '@/lib/rate-limiter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const limiter = new RateLimiter({ windowMs: 15 * 60_000, maxRequests: 120 });
const EventSchema = z.object({
  event: z.enum(['homepage_view', 'homepage_section_view', 'homepage_cta_click', 'review_request_submitted']),
  path: z.string().trim().max(120).optional(),
  section: z.string().trim().max(80).optional(),
  cta: z.string().trim().max(80).optional(),
}).strict();

function getClientIp(request: NextRequest) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'anonymous';
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  const limit = await limiter.check(`public-analytics:${getClientIp(request)}`);
  if (!limit.allowed) return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
  const parsed = EventSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid analytics event.' }, { status: 400 });
  // Only non-sensitive funnel dimensions are accepted. Deployment log
  // pipelines can ship this structured record to the approved analytics sink.
  console.info('[public-analytics]', JSON.stringify({ ...parsed.data, receivedAt: new Date().toISOString() }));
  return new NextResponse(null, { status: 202 });
}
