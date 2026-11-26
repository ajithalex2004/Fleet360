export const dynamic = 'force-dynamic';

/**
 * GET /api/service-tickets/form-fields
 *   Tenant-scoped — returns everything the user-facing /service-tickets
 *   page needs to render the type tabs, the create form, and the ticket
 *   cards in a single round-trip:
 *     • formFields per type — for the dynamic create form
 *     • typeConfig per type — vehicleRequired, autoCreatesMaintenanceRequest,
 *       defaultPriority, plus the presentation metadata
 *       (label, longLabel, description, tone, iconName, defaultSlaHours,
 *        sortOrder, categoryKey, categoryName, slaByPriority)
 *     • departments — the tenant's active triage / forwarding departments
 *
 * Types come from the tenant's service catalogue: every service type linked
 * to SERVICE_TICKETING (system or tenant-defined) that isn't disabled.
 *
 * Replaces the runtime use of TICKET_TYPE_CONFIG. All values resolve
 * through the Service Configuration Engine — service_rules + service_types
 * rows; loadServiceConfig auto-seeds new tenants on first call.
 */

import { NextRequest, NextResponse } from 'next/server';
import { loadRequestTypes } from '@/lib/service-tickets/request-types';
import { captureException } from '@/lib/sentry';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  try {
    const { formFields, typeConfig, archivedTypeNames, departments } = await loadRequestTypes(tenantId);

    return NextResponse.json({
      ok: true, formFields, typeConfig,
      // Labels for existing tickets whose type has since been deleted.
      archivedTypeNames,
      departments: departments.map(({ key, label, shortLabel, description, tone, isSystem }) =>
        ({ key, label, shortLabel, description, tone, isSystem })),
    });
    } catch (err) {
    captureException(err, { context: 'service-tickets.form-fields.list' });
    return NextResponse.json({ ok: false, error: 'Failed to resolve form fields' }, { status: 500 });
  }
}
