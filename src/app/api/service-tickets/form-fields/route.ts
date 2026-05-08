/**
 * GET /api/service-tickets/form-fields
 *   Tenant-scoped — returns everything the user-facing /service-tickets
 *   page needs to render the type tabs, the create form, and the ticket
 *   cards in a single round-trip:
 *     • formFields per type — for the dynamic create form
 *     • typeConfig per type — vehicleRequired, autoCreatesMaintenanceRequest,
 *       defaultPriority, plus the presentation metadata
 *       (label, longLabel, description, tone, iconName, defaultSlaHours,
 *        sortOrder)
 *
 * Replaces the runtime use of TICKET_TYPE_CONFIG. All values resolve
 * through the Service Configuration Engine — service_rules + service_types
 * rows; loadServiceConfig auto-seeds new tenants on first call.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  resolveTicketFormFieldsBatch,
} from '@/lib/service-config/resolvers';
import { loadServiceConfig } from '@/lib/service-config/load';
import { getTenantEnabledTypes } from '@/lib/service-tickets/access';
import {
  TICKET_TYPES_ORDER,
  type TicketType, type TicketPriority, type FormFieldDef,
} from '@/types/service-tickets';
import type { ServiceTone } from '@/types/service-config';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

export interface ServiceTypeConfig {
  // Presentation metadata sourced from service_types row.
  name: string;
  longLabel: string;
  description: string;
  iconName: string | null;
  tone: ServiceTone;
  sortOrder: number;
  // Behavioural flags resolved via service_rules.
  vehicleRequired: boolean;
  autoCreatesMaintenanceRequest: boolean;
  defaultPriority: TicketPriority;
  defaultSlaHours: number;
  prefix: string;
  // Approval gate flags — UI uses these to render the "will start in
  // Awaiting Approval" hint without hitting another endpoint.
  approvalRequired: boolean;
  approvalEmergencyBypass: boolean;
}

export async function GET(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });

  try {
    const enabled = await getTenantEnabledTypes(tenantId);
    const types: TicketType[] = enabled.length > 0 ? enabled : [...TICKET_TYPES_ORDER];

    const fieldsMatrix = await resolveTicketFormFieldsBatch(tenantId, types);

    // Resolve per-type config (presentation + behavioural) in parallel.
    // loadServiceConfig auto-seeds the tenant if needed.
    const cfgEntries = await Promise.all(types.map(async (t) => {
      const cfg = await loadServiceConfig(tenantId, t);
      if (!cfg) return null;
      const matrix = cfg.rules.ticketing.priorityMatrix;
      const value: ServiceTypeConfig = {
        name: cfg.type.name,
        longLabel: cfg.type.name, // service_types has no separate longLabel column yet
        description: cfg.type.description ?? '',
        iconName: cfg.type.icon,
        tone: cfg.type.tone,
        sortOrder: cfg.type.sortOrder,
        vehicleRequired: !!cfg.rules.vehicle.vehicleRequired,
        autoCreatesMaintenanceRequest: !!cfg.rules.ticketing.autoCreatesMaintenanceRequest,
        defaultPriority: cfg.type.defaultPriority,
        defaultSlaHours: matrix.Medium,
        prefix: cfg.rules.ticketing.ticketPrefix || '',
        approvalRequired: !!cfg.rules.approval.approvalRequired,
        approvalEmergencyBypass: !!cfg.rules.approval.emergencyBypassEnabled,
      };
      return [t, value] as const;
    }));

    const formFields: Record<string, FormFieldDef[]> = {};
    const typeConfig: Record<string, ServiceTypeConfig> = {};
    for (const t of types) formFields[t] = fieldsMatrix.get(t) ?? [];
    for (const entry of cfgEntries) if (entry) typeConfig[entry[0]] = entry[1];

    return NextResponse.json({ ok: true, formFields, typeConfig });
  } catch (err) {
    captureException(err, { context: 'service-tickets.form-fields.list' });
    return NextResponse.json({ ok: false, error: 'Failed to resolve form fields' }, { status: 500 });
  }
}
