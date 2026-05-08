/**
 * GET /api/service-tickets/form-fields
 *   Tenant-scoped — returns the resolved formFields schema AND the
 *   per-type config flags the user-facing page needs at render time.
 *   One round-trip on mount so the create form and Acknowledge handler
 *   work without N+1 fetches.
 *
 * Response shape:
 *   { ok: true,
 *     formFields: { [TicketType]: FormFieldDef[] },
 *     typeConfig: { [TicketType]: {
 *         vehicleRequired: boolean,
 *         autoCreatesMaintenanceRequest: boolean,
 *         defaultPriority: 'Low' | 'Medium' | 'High',
 *     } } }
 *
 * Each value is resolved through the Service Configuration Engine —
 * service_rules first, TICKET_TYPE_CONFIG legacy fallback.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  resolveTicketFormFieldsBatch, resolveTicketVehicleRequired,
  resolveTicketAutoCreatesMaintenanceRequest, resolveTicketDefaultPriority,
} from '@/lib/service-config/resolvers';
import { getTenantEnabledTypes } from '@/lib/service-tickets/access';
import {
  TICKET_TYPES_ORDER,
  type TicketType, type TicketPriority, type FormFieldDef,
} from '@/types/service-tickets';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

interface TypeConfigEntry {
  vehicleRequired: boolean;
  autoCreatesMaintenanceRequest: boolean;
  defaultPriority: TicketPriority;
}

export async function GET(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });

  try {
    const enabled = await getTenantEnabledTypes(tenantId);
    const types: TicketType[] = enabled.length > 0 ? enabled : [...TICKET_TYPES_ORDER];

    const fieldsMatrix = await resolveTicketFormFieldsBatch(tenantId, types);

    // Resolve per-type flags in parallel.
    const flagEntries = await Promise.all(types.map(async (t) => {
      const [vehicleRequired, autoMR, defaultPriority] = await Promise.all([
        resolveTicketVehicleRequired(tenantId, t),
        resolveTicketAutoCreatesMaintenanceRequest(tenantId, t),
        resolveTicketDefaultPriority(tenantId, t),
      ]);
      return [t, { vehicleRequired, autoCreatesMaintenanceRequest: autoMR, defaultPriority }] as const;
    }));

    const formFields: Record<string, FormFieldDef[]> = {};
    const typeConfig: Record<string, TypeConfigEntry> = {};
    for (const t of types) formFields[t] = fieldsMatrix.get(t) ?? [];
    for (const [t, c] of flagEntries) typeConfig[t] = c;

    return NextResponse.json({ ok: true, formFields, typeConfig });
  } catch (err) {
    captureException(err, { context: 'service-tickets.form-fields.list' });
    return NextResponse.json({ ok: false, error: 'Failed to resolve form fields' }, { status: 500 });
  }
}
