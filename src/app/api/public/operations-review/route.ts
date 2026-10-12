import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sendEmail } from '@/lib/email';
import { RateLimiter } from '@/lib/rate-limiter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const reviewRequestLimiter = new RateLimiter({ windowMs: 15 * 60_000, maxRequests: 5 });

const ReviewRequestSchema = z.object({
  name: z.string().trim().min(2).max(100),
  workEmail: z.string().trim().email().max(254),
  company: z.string().trim().min(2).max(160),
  fleetSize: z.enum(['', '1–25', '26–100', '101–500', '501+']),
  message: z.string().trim().max(2_000),
  website: z.string().max(0),
}).strict();

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character] ?? character);
}

function getClientIp(request: NextRequest) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'anonymous';
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }

  const limit = await reviewRequestLimiter.check(`operations-review:${getClientIp(request)}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again in a few minutes.' },
      { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil(limit.resetMs / 1000))) } },
    );
  }

  const parsed = ReviewRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Please check the required fields and try again.' }, { status: 400 });
  }

  // A filled honeypot is intentionally acknowledged without emailing anyone.
  if (parsed.data.website) return NextResponse.json({ ok: true });

  const recipient = process.env.OPERATIONS_EMAIL?.trim();
  if (!recipient) {
    return NextResponse.json(
      { error: 'Review requests are not configured yet. Please contact the Fleet360 team directly.' },
      { status: 503 },
    );
  }

  const { name, workEmail, company, fleetSize, message } = parsed.data;
  const lines = [
    `Name: ${name}`,
    `Work email: ${workEmail}`,
    `Company: ${company}`,
    `Fleet size: ${fleetSize || 'Not provided'}`,
    '',
    'Operational focus:',
    message || 'Not provided',
  ];

  const sent = await sendEmail({
    to: recipient,
    replyTo: workEmail,
    subject: `Operations review request — ${company}`,
    text: lines.join('\n'),
    html: `<h1>Operations review request</h1>${lines.map((line) => line ? `<p>${escapeHtml(line)}</p>` : '<br />').join('')}`,
  });

  if (!sent.sent) {
    console.error('[operations-review] delivery failed', { reason: sent.reason, transport: sent.transport });
    return NextResponse.json(
      { error: 'We could not send your request right now. Please try again shortly.' },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
