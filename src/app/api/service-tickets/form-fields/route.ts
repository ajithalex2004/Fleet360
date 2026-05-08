/**
 * GET /api/service-tickets/form-fields
 *   Tenant-scoped — returns the resolved formFields schema for every
 *   ticket type the tenant has access to, in one round-trip. The
 *   user-facing /service-tickets page loads this once on mount so the
 *   create form can render dynamically without N+1 fetches.
 *
 * Response: { ok: true, formFields: { [TicketType]: FormFieldDef[] } }
 *
 * Authority order (per resolver):
 *   1. service_rules.formFields.fields (admin-edited)
 *   2. TICKET_TYPE_CONFIG.formFields (legacy compile-time fallback)
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveTicketFormFieldsBatch } from '@/lib/service-config/resolvers';
import { getTenantEnabledTypes } from '@/lib/service-tickets/access';
import { TICKET_TYPES_ORDER, type TicketType, type FormFieldDef } from '@/types/service-tickets';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });

  try {
    // Resolve for every type the tenant is allowed to use — clients can
    // ignore the rest. We default to the full type list when the tenant
    // has no access matrix configured (every type enabled).
    const enabled = await getTenantEnabledTypes(tenantId);
    const types: TicketType[] = enabled.length > 0 ? enabled : [...TICKET_TYPES_ORDER];

    const matrix = await resolveTicketFormFieldsBatch(tenantId, types);

    const formFields: Record<string, FormFieldDef[]> = {};
    for (const t of types) formFields[t] = matrix.get(t) ?? [];

    return NextResponse.json({ ok: true, formFields });
  } catch (err) {
    captureException(err, { context: 'service-tickets.form-fields.list' });
    return NextResponse.json({ ok: false, error: 'Failed to resolve form fields' }, { status: 500 });
  }
}
