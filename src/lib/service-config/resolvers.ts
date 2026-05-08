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
import type { TicketType, TicketPriority } from '@/types/service-tickets';

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
