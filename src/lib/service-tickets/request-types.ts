/**
 * The service types a tenant can raise requests for, with everything a
 * request form needs: per-type form fields, presentation and behaviour
 * (vehicle required, priority, SLA, approval), departments, and the names of
 * deleted types. Shared by GET /api/service-tickets/form-fields and the
 * Customer Portal.
 */

import { resolveTicketFormFieldsBatch } from '@/lib/service-config/resolvers';
import { loadServiceConfig } from '@/lib/service-config/load';
import { listArchivedTicketTypeNames, listEnabledTicketTypes } from '@/lib/service-tickets/catalogue';
import { listDepartments } from '@/lib/service-tickets/departments';
import { type TicketType, type TicketPriority, type FormFieldDef } from '@/types/service-tickets';
import type { ServiceTone } from '@/types/service-config';

export interface ServiceTypeConfig {
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
  /** Field Service catalogue types: the SLA timers set in the Service
   *  Catalog & SLA master (priority is fixed for these). Null otherwise. */
  catalogSla: { responseHours: number | null; onSiteHours: number; resolutionHours: number | null } | null;
}

export async function loadRequestTypes(tenantId: string) {
  const [catalogue, departments, archivedTypeNames] = await Promise.all([
    listEnabledTicketTypes(tenantId),
    listDepartments(tenantId),
    listArchivedTicketTypeNames(tenantId),
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
      catalogSla: typeof cfg.rules.sla?.onSiteArrivalHours === 'number'
        ? {
            responseHours: cfg.rules.sla.responseSlaMinutes != null ? cfg.rules.sla.responseSlaMinutes / 60 : null,
            onSiteHours: cfg.rules.sla.onSiteArrivalHours,
            resolutionHours: cfg.rules.sla.resolutionSlaHours ?? null,
          }
        : null,
    };
    return [t, value] as const;
  }));

  const formFields: Record<string, FormFieldDef[]> = {};
  const typeConfig: Record<string, ServiceTypeConfig> = {};
  for (const t of types) formFields[t] = fieldsMatrix.get(t) ?? [];
  for (const entry of cfgEntries) if (entry) typeConfig[entry[0]] = entry[1];
  return { formFields, typeConfig, archivedTypeNames, departments };
}
