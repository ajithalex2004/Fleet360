/**
 * Module-facing resolvers for the Service Configuration Engine.
 *
 * Each resolver answers ONE question a downstream module would otherwise
 * answer with hardcoded config. The resolver consults the database via
 * loadServiceConfig — which auto-seeds missing tenant data — so the
 * resolver itself has no fallback path. Defaults come from the
 * RULE_DEFAULTS map and the seed bootstrap data, never from a runtime
 * legacy file.
 */

import { loadServiceConfig } from './load';
import type { TicketType, TicketPriority, FormFieldDef } from '@/types/service-tickets';

/**
 * Resolve the initial status for a new service-ticket.
 *
 *   - approval.approvalRequired = true   → 'Awaiting Approval'
 *   - approval.emergencyBypassEnabled    → High priority skips the gate
 *   - else                               → 'Pending'
 */
export async function resolveTicketInitialStatus(
  tenantId: string,
  ticketType: TicketType,
  priority: TicketPriority,
): Promise<{ status: 'Awaiting Approval' | 'Pending'; source: 'service_rules' | 'defaults' }> {
  const cfg = await loadServiceConfig(tenantId, ticketType);

  // No service type at all (e.g. unknown ticket-type key) — defaults.
  if (!cfg) return { status: 'Pending', source: 'defaults' };

  const a = cfg.rules.approval;
  const source = cfg.configured.approval ? 'service_rules' : 'defaults';

  if (a.emergencyBypassEnabled && priority === 'High') {
    return { status: 'Pending', source };
  }
  if (a.approvalRequired) {
    return { status: 'Awaiting Approval', source };
  }
  return { status: 'Pending', source };
}

/**
 * Resolve the SLA target hours for a ticket given its priority. Reads
 * service_rules.ticketing.priorityMatrix; returns the priority-matched
 * value or Medium as a fallback when the priority key is unexpected.
 */
export async function resolveTicketSlaHours(
  tenantId: string,
  ticketType: TicketType,
  priority: TicketPriority,
): Promise<{ hours: number; source: 'service_rules' | 'defaults' }> {
  const cfg = await loadServiceConfig(tenantId, ticketType);
  if (!cfg) return { hours: 24, source: 'defaults' };
  const matrix = cfg.rules.ticketing.priorityMatrix;
  return {
    hours: matrix[priority] ?? matrix.Medium,
    source: cfg.configured.ticketing ? 'service_rules' : 'defaults',
  };
}

/**
 * Resolve the ticket prefix used in the readable ID. Falls back to
 * 'GEN' when the type doesn't exist or no prefix is set.
 */
export async function resolveTicketPrefix(
  tenantId: string,
  ticketType: TicketType,
): Promise<string> {
  const cfg = await loadServiceConfig(tenantId, ticketType);
  const fromRules = cfg?.rules.ticketing.ticketPrefix?.trim();
  return fromRules || 'GEN';
}

export type SlaMatrix = { Low: number; Medium: number; High: number };

/**
 * Batch resolve the SLA priority matrix for a set of ticket types in one
 * pass. Used by API routes that return many tickets — keeps the per-ticket
 * SLA computation O(distinct_types) rather than O(tickets).
 */
export async function resolveTicketSlaMatrixBatch(
  tenantId: string,
  ticketTypes: TicketType[],
): Promise<Map<TicketType, SlaMatrix>> {
  const out = new Map<TicketType, SlaMatrix>();
  const distinct = Array.from(new Set(ticketTypes));

  await Promise.all(distinct.map(async (type) => {
    const cfg = await loadServiceConfig(tenantId, type);
    if (cfg) {
      const m = cfg.rules.ticketing.priorityMatrix;
      out.set(type, { Low: m.Low, Medium: m.Medium, High: m.High });
    } else {
      out.set(type, { Low: 72, Medium: 24, High: 4 });
    }
  }));

  return out;
}

/** Pick the SLA hours for a single ticket given its priority. */
export function pickSlaHours(matrix: SlaMatrix, priority: TicketPriority): number {
  return matrix[priority] ?? matrix.Medium;
}

/**
 * Resolve the per-service form-field schema. Used by:
 *   - /api/service-tickets POST → required-field validation
 *   - /service-tickets NewTicketForm → dynamic field rendering
 *
 * Returns an array (possibly empty) — never null.
 */
export async function resolveTicketFormFields(
  tenantId: string,
  ticketType: TicketType,
): Promise<{ fields: FormFieldDef[]; source: 'service_rules' | 'defaults' }> {
  const cfg = await loadServiceConfig(tenantId, ticketType);
  if (!cfg) return { fields: [], source: 'defaults' };
  return {
    fields: cfg.rules.formFields.fields ?? [],
    source: cfg.configured.formFields ? 'service_rules' : 'defaults',
  };
}

/**
 * Batch resolve form-fields for many ticket types in one pass — used by the
 * /api/service-tickets/form-fields endpoint that the user-facing page hits
 * once on mount to render the create form.
 */
export async function resolveTicketFormFieldsBatch(
  tenantId: string,
  ticketTypes: TicketType[],
): Promise<Map<TicketType, FormFieldDef[]>> {
  const out = new Map<TicketType, FormFieldDef[]>();
  await Promise.all(Array.from(new Set(ticketTypes)).map(async (t) => {
    const { fields } = await resolveTicketFormFields(tenantId, t);
    out.set(t, fields);
  }));
  return out;
}

/** Resolve whether this service requires a vehicle reference. */
export async function resolveTicketVehicleRequired(
  tenantId: string,
  ticketType: TicketType,
): Promise<boolean> {
  const cfg = await loadServiceConfig(tenantId, ticketType);
  return !!cfg?.rules.vehicle.vehicleRequired;
}

/**
 * Resolve whether Acknowledging a ticket of this service should auto-create
 * a MaintenanceRequest in the maintenance module (the MAINTENANCE-only
 * cross-module bridge).
 */
export async function resolveTicketAutoCreatesMaintenanceRequest(
  tenantId: string,
  ticketType: TicketType,
): Promise<boolean> {
  const cfg = await loadServiceConfig(tenantId, ticketType);
  return !!cfg?.rules.ticketing.autoCreatesMaintenanceRequest;
}

/**
 * Resolve the default priority for a service. Lives on the service_types
 * row directly (not in service_rules) — Phase 2A stored it on the row.
 */
export async function resolveTicketDefaultPriority(
  tenantId: string,
  ticketType: TicketType,
): Promise<TicketPriority> {
  const cfg = await loadServiceConfig(tenantId, ticketType);
  return cfg?.type.defaultPriority ?? 'Medium';
}
