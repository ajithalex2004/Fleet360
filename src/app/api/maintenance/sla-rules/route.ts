/**
 * GET  /api/maintenance/sla-rules
 * Returns the active SLA rule set for all tiers.
 *
 * In a production tenant-aware deployment these would be loaded from a
 * `maintenance_sla_rules` DB table keyed by tenantId. For now the defaults
 * from the type definitions are returned directly — the frontend can POST
 * overrides here in a future iteration.
 */
import { NextResponse } from 'next/server';
import { DEFAULT_SLA_RULES } from '@/types/maintenance';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export async function GET() {
    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

    return NextResponse.json({ rules: DEFAULT_SLA_RULES });
}
