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
import { withTenantRls } from '@/lib/rls';
import {
  resolveTicketFormFieldsBatch,
} from '@/lib/service-config/resolvers';
import { loadServiceConfig } from '@/lib/service-config/load';
import { listEnabledTicketTypes } from '@/lib/service-tickets/catalogue';
import { listDepartments } from '@/lib/service-tickets/departments';
import {
  type TicketType, type TicketPriority, type FormFieldDef,
} from '@/types/service-tickets';
import type { ServiceTone } from '@/types/service-config';
import { captureException } from '@/lib/sentry';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export const runtime = 'nodejs';

interface ServiceTypeConfig {
  // Presentation metadata sourced from service_types row.
  name: string;
  longLabel: string;
  description: string;
  iconName: string | null;
  tone: ServiceTone;
  sortOrder: number;
  categoryKey: string;
  categoryName: string;
  // Behavioural flags resolved via service_rules.
  vehicleRequired: boolean;
  autoCreatesMaintenanceRequest: boolean;
  defaultPriority: TicketPriority;
  defaultSlaHours: number;
  /** Resolved SLA hours per priority (Critical falls back to High). */
  slaByPriority: Record<TicketPriority, number>;
  prefix: string;
  // Approval gate flags — UI uses these to render the "will start in
  // Awaiting Approval" hint without hitting another endpoint.
  approvalRequired: boolean;
  approvalEmergencyBypass: boolean;
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  try {
    const [catalogue, departments] = await Promise.all([
      listEnabledTicketTypes(tenantId),
      listDepartments(tenantId),
    ]);
    const types: TicketType[] = catalogue.map((e) => e.key);
    const categoryOf = new Map(catalogue.map((e) => [e.key, e]));

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
        categoryKey: categoryOf.get(t)?.categoryKey ?? '',
        categoryName: categoryOf.get(t)?.categoryName ?? '',
        vehicleRequired: !!cfg.rules.vehicle.vehicleRequired,
        autoCreatesMaintenanceRequest: !!cfg.rules.ticketing.autoCreatesMaintenanceRequest,
        defaultPriority: cfg.type.defaultPriority,
        defaultSlaHours: matrix.Medium,
        slaByPriority: {
          Low: matrix.Low, Medium: matrix.Medium, High: matrix.High,
          Critical: matrix.Critical ?? matrix.High,
        },
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

    return NextResponse.json({
      ok: true, formFields, typeConfig,
      departments: departments.map(({ key, label, shortLabel, description, tone, isSystem }) =>
        ({ key, label, shortLabel, description, tone, isSystem })),
    });
    } catch (err) {
    captureException(err, { context: 'service-tickets.form-fields.list' });
    return NextResponse.json({ ok: false, error: 'Failed to resolve form fields' }, { status: 500 });
  }
}
