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
 *  - CRON_SECRET Bearer token
 *  - OR x-tenant-id header (authenticated operator)
 *  - Allowed in dev/test when no CRON_SECRET is configured
 */

import { NextRequest, NextResponse } from 'next/server';
import { sweepDocumentExpiries } from '@/lib/agents/document-intelligence/pipeline/lifecycle-manager';
import { ensureAgentSchema } from '@/lib/agents/schema';

function isAuthorized(request: NextRequest): boolean {
  if (request.headers.get('x-tenant-id')) return true;
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return process.env.NODE_ENV !== 'production';
  }
  const got = request.headers
    .get('authorization')
    ?.replace(/^Bearer\s+/i, '');
  return got === expected;
}

async function handle(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await ensureAgentSchema();

  let tenantId: string | undefined;
  const searchParamTenant = request.nextUrl.searchParams.get('tenantId');
  if (searchParamTenant) {
    tenantId = searchParamTenant;
  } else {
    const headerTenant = request.headers.get('x-tenant-id');
    if (headerTenant && headerTenant !== 'ALL') {
      tenantId = headerTenant;
    }
  }

  if (request.method === 'POST') {
    try {
      const body = await request.json();
      if (body?.tenantId) {
        tenantId = body.tenantId;
      }
    } catch {
      // Body may be empty on cron trigger, ignore parse error
    }
  }

  const result = await sweepDocumentExpiries(tenantId);

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
