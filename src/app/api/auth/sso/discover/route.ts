import { NextRequest, NextResponse } from 'next/server';
import { discoverSsoByEmail } from '@/lib/sso';
import { recordLoginAttempt } from '@/lib/auth-security';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? '').trim().toLowerCase();
  const result = await discoverSsoByEmail(email);
  const ready = Boolean(result.found && 'ready' in result && result.ready);
  await recordLoginAttempt({
    email: email || 'unknown',
    tenantId: result.found && 'tenant' in result ? result.tenant?.id : null,
    success: ready,
    failureReason: ready ? null : `SSO_DISCOVERY_${result.reason.toUpperCase().replace(/-/g, '_')}`,
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip'),
    userAgent: req.headers.get('user-agent'),
  });
  return NextResponse.json(result, { status: ready ? 200 : 404 });
}
