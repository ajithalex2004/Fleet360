export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/customer-portal/fsm/types
 * The Field Service request types a customer can raise: catalogue types
 * (Service Catalog & SLA master) that don't need a vehicle, with their form
 * fields, priority and SLA. Same shape as /api/service-tickets/form-fields.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireCustomerPortal } from '@/lib/customer-portal/session';
import { loadRequestTypes } from '@/lib/service-tickets/request-types';
import { REQUEST_CHANNELS, ENTITLEMENT_TYPES } from '@/lib/service-tickets/customer-context';

export async function GET(req: NextRequest) {
  const ctx = await requireCustomerPortal(req, { portal: 'FSM' });
  if (ctx instanceof NextResponse) return ctx;
  const { formFields, typeConfig } = await loadRequestTypes(ctx.tenantId);
  const allowed = Object.entries(typeConfig).filter(([, c]) => c.catalogSla && !c.vehicleRequired);
  return NextResponse.json({
    ok: true,
    typeConfig: Object.fromEntries(allowed),
    formFields: Object.fromEntries(allowed.map(([k]) => [k, formFields[k] ?? []])),
    channels: REQUEST_CHANNELS.filter((c) => c.value === 'CUSTOMER_PORTAL'),
    entitlements: ENTITLEMENT_TYPES,
  });
}
