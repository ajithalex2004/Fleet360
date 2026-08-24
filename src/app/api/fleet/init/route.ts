/**
 * GET /api/fleet/init
 * Force-runs the fleet schema bootstrap.
 * Safe to call multiple times — idempotent.
 * Also called automatically by the fleet layout on first load.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { ensureFleetSchema } from '@/lib/fleet/schema';
import { ensureHosSchema } from '@/lib/fleet/hos-schema';
import { ensureAgentSchema } from '@/lib/agents/schema';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    await Promise.all([ensureFleetSchema(), ensureHosSchema(), ensureAgentSchema()]);
    return NextResponse.json({ ok: true, message: 'Fleet + Agent schemas initialised' });
    } catch (error) {
    console.error('Fleet schema init error:', error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
