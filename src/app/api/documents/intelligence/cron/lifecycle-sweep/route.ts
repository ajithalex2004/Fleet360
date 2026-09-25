export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET/POST /api/documents/intelligence/cron/lifecycle-sweep
 * ---------------------------------------------------------
 * Daily scheduled cron endpoint for the Document Intelligence & Control Engine:
 *  - Sweeps active & validated documents across all tenants (or single tenant if requested)
 *  - Transitions documents past expiry date to EXPIRED
 *  - Transitions documents expiring within 30 days to EXPIRING
 * 
 * Auth:
 *  - CRON_SECRET Bearer token: any single tenant (?tenantId= / body) or all tenants
 *  - OR an authenticated operator session: that operator's own tenant only
 *  - Allowed in dev/test when no CRON_SECRET is configured
 */

import { NextRequest, NextResponse } from 'next/server';
import { sweepDocumentExpiries } from '@/lib/agents/document-intelligence/pipeline/lifecycle-manager';
import { ensureAgentSchema } from '@/lib/agents/schema';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant } from '@/lib/tenant-context';

/** True for the platform scheduler: a valid CRON_SECRET, or no secret configured outside production. */
function isCronCaller(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return process.env.NODE_ENV !== 'production';
  const got = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return got === expected;
}

async function requestedTenant(request: NextRequest): Promise<string | undefined> {
  const fromQuery = request.nextUrl.searchParams.get('tenantId');
  if (fromQuery) return fromQuery;
  if (request.method === 'POST') {
    try {
      const body = await request.json();
      if (typeof body?.tenantId === 'string' && body.tenantId) return body.tenantId;
    } catch {
      // Body may be empty on cron trigger, ignore parse error
    }
  }
  const header = request.headers.get('x-tenant-id');
  return header && header !== 'ALL' ? header : undefined;
}

async function handle(request: NextRequest) {
  // Tenant scope:
  //  - the platform scheduler (CRON_SECRET) may name one tenant or sweep all;
  //  - a signed-in operator only ever sweeps their own session tenant, which
  //    middleware set in x-tenant-id. A tenant named in the query or body is
  //    ignored for them: it previously let any user sweep another tenant.
  let tenantId: string | undefined;
  if (isCronCaller(request)) {
    tenantId = await requestedTenant(request);
  } else {
    const authz = requireAuthorizedTenant(request);
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    tenantId = authz.tenantId;
  }

  await ensureAgentSchema();

  // The documents are RLS-protected: run a single-tenant sweep in that
  // tenant's context and the all-tenant sweep in platform context.
  const result = tenantId
    ? await withTenantRls(prisma, tenantId, () => sweepDocumentExpiries(tenantId))
    : await withPlatformAdmin(prisma, () => sweepDocumentExpiries());

  return NextResponse.json({
    success: true,
    message: `Completed document lifecycle expiry sweep: ${result.expiredCount} marked EXPIRED, ${result.expiringCount} marked EXPIRING.`,
    scope: tenantId ? `TENANT_${tenantId}` : 'ALL_TENANTS',
    timestamp: new Date().toISOString(),
    ...result,
  });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
