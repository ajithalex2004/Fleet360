/**
 * GET /api/agents/catalogue
 * --------------------------
 * Returns the full agent registry — used by the Intelligence Hub UI.
 */
import { NextResponse } from 'next/server';
import { AGENT_CATALOGUE } from '@/lib/agents/registry';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export async function GET() {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return NextResponse.json({ agents: AGENT_CATALOGUE });
}
