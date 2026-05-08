/**
 * Module-facing resolvers for the Service Configuration Engine (Phase 2C).
 *
 * Each resolver answers ONE question a downstream module would otherwise
 * answer with hardcoded config — e.g. "should this ticket start in
 * Awaiting Approval?". The resolver consults the central rules and
 * falls back to the legacy hardcoded config when no rules row exists.
 *
 * This is the bridge layer. Modules import resolvers; resolvers know
 * about both the new rules and the old config. Phase 2D shrinks the
 * legacy fallback as more tabs become canonical.
 */

import { loadServiceConfig } from './load';
import {
  TICKET_TYPE_CONFIG, initialStatusForType,
} from '@/lib/service-tickets/config';
import type { TicketType, TicketPriority, FormFieldDef } from '@/types/service-tickets';

/**
 * Resolve the initial status for a new service-ticket. Authority order:
 *
 *   1. service_rules.approval row (admin-configured) — wins
 *   2. TICKET_TYPE_CONFIG.requiresApproval (legacy hardcoded) — fallback
 *
 * Returns 'Awaiting Approval' or 'Pending'. Callers should pass the
 * tenant's resolved priority (already merged with defaults).
 */
export async function resolveTicketInitialStatus(
  tenantId: string,
  ticketType: TicketType,
  priority: TicketPriority,
): Promise<{ status: 'Awaiting Approval' | 'Pending'; source: 'service_rules' | 'legacy' }> {
  const cfg = await loadServiceConfig(tenantId, ticketType);

  // No central row at all — fall back to the legacy code path.
  if (!cfg) {
    return { status: initialStatusForType(ticketType, priority), source: 'legacy' };
  }

  // Central path: consult approval rules. Even when configured=false the
  // resolved object still has defaults, so we treat "configured" as the
  // signal that an admin has actually decided.
  if (cfg.configured.approval) {
    const a = cfg.rules.approval;

    // Emergency bypass: High priority skips the gate when enabled.
    if (a.emergencyBypassEnabled && priority === 'High') {
      return { status: 'Pending', source: 'service_rules' };
    }
    if (a.approvalRequired) {
      return { status: 'Awaiting Approval', source: 'service_rules' };
    }
    // Auto-approve below threshold doesn't apply here — tickets don't
    // have an inherent monetary amount yet. That logic lives in the
    // booking/finance modules and will use the same approval rule shape.
    return { status: 'Pending', source: 'service_rules' };
  }

  // Central row exists but approval was never configured — honour legacy.
  return { status: initialStatusForType(ticketType, priority), source: 'legacy' };
}

/**
 * Resolve the SLA target hours for a ticket given its priority. Authority:
 *
 *   1. service_rules.ticketing.priorityMatrix[priority] — wins
 *   2. TICKET_TYPE_CONFIG.defaultSlaHours (legacy single value) — fallback
 *
 * Returns the resolved hours. Used by the SLA aging badge.
 */
export async function resolveTicketSlaHours(
  tenantId: string,
  ticketType: TicketType,
  priority: TicketPriority,
): Promise<{ hours: number; source: 'service_rules' | 'legacy' }> {
  const cfg = await loadServiceConfig(tenantId, ticketType);
  if (cfg?.configured.ticketing) {
    const matrix = cfg.rules.ticketing.priorityMatrix;
    return { hours: matrix[priority] ?? matrix.Medium, source: 'service_rules' };
  }
  return { hours: TICKET_TYPE_CONFIG[ticketType]?.defaultSlaHours ?? 24, source: 'legacy' };
}

/**
 * Resolve the ticket prefix used in the readable ID. Authority:
 *   1. service_rules.ticketing.ticketPrefix (when non-empty)
 *   2. TICKET_TYPE_CONFIG.prefix (legacy)
 */
export async function resolveTicketPrefix(
  tenantId: string,
  ticketType: TicketType,
): Promise<string> {
  const cfg = await loadServiceConfig(tenantId, ticketType);
  const fromRules = cfg?.rules.ticketing.ticketPrefix?.trim();
  if (cfg?.configured.ticketing && fromRules) return fromRules;
  return TICKET_TYPE_CONFIG[ticketType]?.prefix ?? 'GEN';
}

export type SlaMatrix = { Low: number; Medium: number; High: number };

/**
 * Batch resolve the SLA priority matrix for a set of ticket types in one
 * pass. Used by API routes that return many tickets — keeps the per-ticket
 * SLA computation O(distinct_types) rather than O(tickets).
 *
 * For each requested type the returned matrix follows the same authority
 * order as resolveTicketSlaHours: service_rules.ticketing.priorityMatrix
 * first, TICKET_TYPE_CONFIG.defaultSlaHours legacy fallback second.
 *
 * Tenants without seeded rules (or without that ticket type at all) get
 * a matrix derived from the legacy defaultSlaHours via the same formula
 * the seed uses (Low ≈ 3× SLA, Medium = SLA, High ≈ SLA / 4).
 */
export async function resolveTicketSlaMatrixBatch(
  tenantId: string,
  ticketTypes: TicketType[],
): Promise<Map<TicketType, SlaMatrix>> {
  const out = new Map<TicketType, SlaMatrix>();
  const distinct = Array.from(new Set(ticketTypes));

  await Promise.all(distinct.map(async (type) => {
    const cfg = await loadServiceConfig(tenantId, type);

    if (cfg?.configured.ticketing) {
      const m = cfg.rules.ticketing.priorityMatrix;
      out.set(type, { Low: m.Low, Medium: m.Medium, High: m.High });
      return;
    }
    // Legacy fallback — same shape as the 2C seed formula so first-time
    // tenants and never-seeded tenants converge on identical SLAs.
    const sla = TICKET_TYPE_CONFIG[type]?.defaultSlaHours ?? 24;
    out.set(type, {
      Low:    Math.max(sla * 3, sla),
      Medium: sla,
      High:   Math.max(Math.round(sla / 4), 1),
    });
  }));

  return out;
}

/** Pick the SLA hours for a single ticket given its priority. */
export function pickSlaHours(matrix: SlaMatrix, priority: TicketPriority): number {
  return matrix[priority] ?? matrix.Medium;
}

/**
 * Resolve the per-service form-field schema. Authority order:
 *
 *   1. service_rules.formFields.fields (admin-edited)
 *   2. TICKET_TYPE_CONFIG.formFields (legacy compile-time schema)
 *
 * Used by:
 *   - /api/service-tickets POST → required-field validation
 *   - /service-tickets NewTicketForm → dynamic field rendering
 *
 * Returns an array (possibly empty) — never null.
 */
export async function resolveTicketFormFields(
  tenantId: string,
  ticketType: TicketType,
): Promise<{ fields: FormFieldDef[]; source: 'service_rules' | 'legacy' }> {
  const cfg = await loadServiceConfig(tenantId, ticketType);
  if (cfg?.configured.formFields) {
    return { fields: cfg.rules.formFields.fields ?? [], source: 'service_rules' };
  }
  return { fields: TICKET_TYPE_CONFIG[ticketType]?.formFields ?? [], source: 'legacy' };
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
