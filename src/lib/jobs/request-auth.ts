import type { NextRequest } from 'next/server';
import { getVerifiedRequestSession } from '@/lib/tenant-session';

type JobAuthorization =
  | { ok: true; tenantId: string | null }
  | { ok: false; status: number; error: string };

/** Public job endpoints must authenticate credentials, never identity headers. */
export async function authorizeJobRequest(
  request: NextRequest,
  options: { secretName: 'CRON_SECRET' | 'PUSH_CRON_SECRET'; global?: boolean },
): Promise<JobAuthorization> {
  const expected = process.env[options.secretName];
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    ?? (options.secretName === 'PUSH_CRON_SECRET'
      ? request.headers.get('x-push-cron-secret') ?? request.nextUrl.searchParams.get('secret')
      : null);
  const requestedTenant = request.nextUrl.searchParams.get('tenantId')
    ?? request.headers.get('x-requested-tenant-id') ?? request.headers.get('x-tenant-id');
  if (expected && supplied === expected) {
    if (requestedTenant && !/^[a-zA-Z0-9_-]+$/.test(requestedTenant)) {
      return { ok: false, status: 400, error: 'Invalid tenant selector' };
    }
    return { ok: true, tenantId: options.global ? null : requestedTenant || null };
  }
  const session = await getVerifiedRequestSession(request);
  if (!session) return { ok: false, status: 401, error: 'Valid session or scheduler credential required' };
  const allowed = options.global ? ['SUPER_ADMIN'] : ['SUPER_ADMIN', 'TENANT_ADMIN'];
  if (!allowed.includes(session.role)) return { ok: false, status: 403, error: 'Job permission required' };
  if (requestedTenant && requestedTenant !== session.tenantId) {
    return { ok: false, status: 403, error: 'Tenant switch not permitted' };
  }
  return { ok: true, tenantId: options.global ? null : session.tenantId };
}
