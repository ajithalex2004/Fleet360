export const dynamic = 'force-dynamic';

/**
 * GET /api/agents/catalogue
 * --------------------------
 * Returns the full agent registry — used by the Intelligence Hub UI.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { AGENT_CATALOGUE } from '@/lib/agents/registry';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return NextResponse.json({ agents: AGENT_CATALOGUE });
}
