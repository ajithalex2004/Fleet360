/**
 * Active SLA Escalation & On-Call Paging Engine (Pillar 2 - P0)
 *
 * Capabilities:
 *   1. Differentiated SLA Calendars:
 *      - 24/7/365 Emergency Clock (TOWING, INCIDENT, High-Priority MAINTENANCE)
 *      - Business Hours Clock (RENEWAL, COMPLAINT, CLEANING, SUPPORT: 08:00 - 18:00 Mon-Fri)
 *   2. Multi-Tier Escalation Matrix:
 *      - Tier 1 (0–15m unacknowledged): On-duty controller queue
 *      - Tier 2 (15–30m unacknowledged): Auto-escalate priority to High, status to Escalated, alert Shift Supervisor
 *      - Tier 3 (Breached SLA): Trigger SLA_BREACH state, page Operations Director, flag on Control Tower
 *   3. Automated Sweep Engine:
 *      - Idempotent evaluation and auto-transitions with Postgres audit logging
 */

import { prisma } from '@/lib/prisma';
import type { TicketType, TicketPriority, TicketStatus } from '@/types/service-tickets';

export type SlaClockType = 'EMERGENCY_24_7' | 'BUSINESS_HOURS';
export type SlaEscalationTier = 'TIER_1_NORMAL' | 'TIER_2_ESCALATED' | 'TIER_3_BREACHED';

export interface SlaTicketInput {
  id: string;
  ticketType: TicketType;
  priority: TicketPriority;
  status: TicketStatus;
  createdAt: string | Date;
  acknowledgedAt?: string | Date | null;
  resolvedAt?: string | Date | null;
  slaTargetHours?: number | null;
  assignedTo?: string | null;
  readableId?: string | null;
}

export interface ActiveSlaEvaluation {
  ticketId: string;
  readableId?: string | null;
  clockType: SlaClockType;
  escalationTier: SlaEscalationTier;
  elapsedWorkingMinutes: number;
  ackDeadlineMinutes: number;
  resolveDeadlineMinutes: number;
  isAckOverdue: boolean;
  isResolveOverdue: boolean;
  minutesUntilBreach: number;
  shouldAutoEscalateToTier2: boolean;
  shouldTriggerTier3DirectorAlert: boolean;
  escalationReason?: string;
  pagingTargetRole?: 'CONTROLLER' | 'SHIFT_SUPERVISOR' | 'OPERATIONS_DIRECTOR';
}

export interface SlaSweepResult {
  totalOpenTickets: number;
  tier1NormalCount: number;
  tier2EscalatedCount: number;
  tier3BreachedCount: number;
  autoEscalatedTickets: Array<{
    id: string;
    readableId: string | null;
    oldPriority: string;
    newPriority: string;
    oldStatus: string;
    newStatus: string;
    reason: string;
  }>;
  directorAlerts: Array<{
    id: string;
    readableId: string | null;
    ticketType: string;
    elapsedMinutes: number;
    targetMinutes: number;
  }>;
}

// ── Default SLA Configurations (Minutes) ───────────────────────────────────────
const SLA_DEFAULTS: Record<
  TicketType,
  {
    clockType: SlaClockType;
    tier1AckLimitMinutes: number;
    tier2EscalateMinutes: number;
    defaultResolveHours: number;
  }
> = {
  TOWING: {
    clockType: 'EMERGENCY_24_7',
    tier1AckLimitMinutes: 15,
    tier2EscalateMinutes: 30,
    defaultResolveHours: 2,
  },
  INCIDENT: {
    clockType: 'EMERGENCY_24_7',
    tier1AckLimitMinutes: 15,
    tier2EscalateMinutes: 30,
    defaultResolveHours: 4,
  },
  MAINTENANCE: {
    clockType: 'EMERGENCY_24_7',
    tier1AckLimitMinutes: 30,
    tier2EscalateMinutes: 60,
    defaultResolveHours: 24,
  },
  CLEANING: {
    clockType: 'BUSINESS_HOURS',
    tier1AckLimitMinutes: 120,
    tier2EscalateMinutes: 240,
    defaultResolveHours: 24,
  },
  RENEWAL: {
    clockType: 'BUSINESS_HOURS',
    tier1AckLimitMinutes: 240,
    tier2EscalateMinutes: 480,
    defaultResolveHours: 48,
  },
  COMPLAINT: {
    clockType: 'BUSINESS_HOURS',
    tier1AckLimitMinutes: 120,
    tier2EscalateMinutes: 240,
    defaultResolveHours: 24,
  },
  SUPPORT: {
    clockType: 'BUSINESS_HOURS',
    tier1AckLimitMinutes: 120,
    tier2EscalateMinutes: 240,
    defaultResolveHours: 24,
  },
};

/**
 * Calculates working minutes between two dates based on business hours (08:00 - 18:00 Mon-Fri)
 */
export function calculateBusinessMinutesElapsed(from: Date, to: Date): number {
  if (to <= from) return 0;

  let current = new Date(from.getTime());
  let minutes = 0;

  // Step minute by minute or in hour chunks for accuracy
  while (current < to) {
    const day = current.getUTCDay(); // 0 = Sun, 1 = Mon, ... 5 = Fri, 6 = Sat
    const hour = current.getUTCHours() + 4; // UTC+4 (UAE Gulf Standard Time)
    const normalizedHour = hour % 24;

    // UAE Business Days: Monday (1) to Friday (5). Hours: 08:00 to 18:00 GST
    const isBusinessDay = day >= 1 && day <= 5;
    const isBusinessHour = normalizedHour >= 8 && normalizedHour < 18;

    if (isBusinessDay && isBusinessHour) {
      minutes++;
    }

    current = new Date(current.getTime() + 60_000);
  }

  return minutes;
}

/**
 * Evaluates active SLA status for a single service ticket
 */
export function calculateTicketSlaStatus(
  ticket: SlaTicketInput,
  now: Date = new Date()
): ActiveSlaEvaluation {
  const cfg = SLA_DEFAULTS[ticket.ticketType] || SLA_DEFAULTS.SUPPORT;
  const createdAt = new Date(ticket.createdAt);

  // 1. Calculate Elapsed Minutes based on Clock Type
  const elapsedWorkingMinutes =
    cfg.clockType === 'EMERGENCY_24_7'
      ? Math.max(0, Math.round((now.getTime() - createdAt.getTime()) / 60_000))
      : calculateBusinessMinutesElapsed(createdAt, now);

  const resolveTargetMinutes = (ticket.slaTargetHours || cfg.defaultResolveHours) * 60;
  const isPending = ticket.status === 'Pending' || ticket.status === 'Awaiting Approval';
  const isAcknowledged =
    ticket.status === 'Acknowledged' ||
    ticket.status === 'Assigned' ||
    ticket.status === 'In Progress' ||
    ticket.status === 'Resolved' ||
    ticket.status === 'Completed';

  const isClosedOrResolved =
    ticket.status === 'Resolved' ||
    ticket.status === 'Completed' ||
    ticket.status === 'Closed' ||
    ticket.status === 'Rejected';

  const isAckOverdue = isPending && elapsedWorkingMinutes > cfg.tier1AckLimitMinutes;
  const isResolveOverdue = !isClosedOrResolved && elapsedWorkingMinutes > resolveTargetMinutes;
  const minutesUntilBreach = Math.round(resolveTargetMinutes - elapsedWorkingMinutes);

  // 2. Determine Escalation Tier
  let escalationTier: SlaEscalationTier = 'TIER_1_NORMAL';
  let shouldAutoEscalateToTier2 = false;
  let shouldTriggerTier3DirectorAlert = false;
  let pagingTargetRole: 'CONTROLLER' | 'SHIFT_SUPERVISOR' | 'OPERATIONS_DIRECTOR' = 'CONTROLLER';
  let escalationReason: string | undefined;

  if (isClosedOrResolved) {
    escalationTier = 'TIER_1_NORMAL';
  } else if (isResolveOverdue || (isPending && elapsedWorkingMinutes >= cfg.tier2EscalateMinutes)) {
    escalationTier = 'TIER_3_BREACHED';
    shouldTriggerTier3DirectorAlert = true;
    pagingTargetRole = 'OPERATIONS_DIRECTOR';
    escalationReason = isResolveOverdue
      ? `SLA Target Breached: Elapsed ${elapsedWorkingMinutes}m exceeds ${resolveTargetMinutes}m limit`
      : `Unacknowledged Emergency: Elapsed ${elapsedWorkingMinutes}m exceeds Tier 2 limit (${cfg.tier2EscalateMinutes}m)`;
  } else if (isAckOverdue || ticket.status === 'Escalated') {
    escalationTier = 'TIER_2_ESCALATED';
    shouldAutoEscalateToTier2 = isPending && elapsedWorkingMinutes >= cfg.tier1AckLimitMinutes;
    pagingTargetRole = 'SHIFT_SUPERVISOR';
    escalationReason = `Unacknowledged after ${elapsedWorkingMinutes}m (Tier 1 limit: ${cfg.tier1AckLimitMinutes}m)`;
  }

  return {
    ticketId: ticket.id,
    readableId: ticket.readableId,
    clockType: cfg.clockType,
    escalationTier,
    elapsedWorkingMinutes,
    ackDeadlineMinutes: cfg.tier1AckLimitMinutes,
    resolveDeadlineMinutes: resolveTargetMinutes,
    isAckOverdue,
    isResolveOverdue,
    minutesUntilBreach,
    shouldAutoEscalateToTier2,
    shouldTriggerTier3DirectorAlert,
    escalationReason,
    pagingTargetRole,
  };
}

/**
 * Runs active SLA Sweep across all open tickets for a tenant
 */
export async function runSlaEscalationSweep(
  tenantId: string,
  now: Date = new Date()
): Promise<SlaSweepResult> {
  // Fetch all open tickets
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      ticket_type: string;
      priority: string;
      status: string;
      created_at: string;
      readable_id: string | null;
      assigned_to: string | null;
      custom_fields: Record<string, unknown>;
    }>
  >(
    `SELECT id, ticket_type, priority, status, created_at, readable_id, assigned_to, custom_fields
     FROM service_tickets
     WHERE tenant_id = $1
       AND deleted_at IS NULL
       AND status NOT IN ('Resolved', 'Completed', 'Closed', 'Rejected')`,
    tenantId
  );

  let tier1Count = 0;
  let tier2Count = 0;
  let tier3Count = 0;

  const autoEscalated: SlaSweepResult['autoEscalatedTickets'] = [];
  const directorAlerts: SlaSweepResult['directorAlerts'] = [];

  for (const row of rows) {
    const input: SlaTicketInput = {
      id: row.id,
      ticketType: row.ticket_type as TicketType,
      priority: row.priority as TicketPriority,
      status: row.status as TicketStatus,
      createdAt: row.created_at,
      readableId: row.readable_id,
      assignedTo: row.assigned_to,
    };

    const evalResult = calculateTicketSlaStatus(input, now);

    if (evalResult.escalationTier === 'TIER_1_NORMAL') {
      tier1Count++;
    } else if (evalResult.escalationTier === 'TIER_2_ESCALATED') {
      tier2Count++;
    } else if (evalResult.escalationTier === 'TIER_3_BREACHED') {
      tier3Count++;
    }

    // Auto-Escalate if unacknowledged past Tier 1 limit
    if (evalResult.shouldAutoEscalateToTier2 && row.status === 'Pending') {
      const historyEntry = {
        status: 'Escalated',
        date: now.toISOString(),
        actor: 'Active SLA Auto-Escalation Engine',
        note: evalResult.escalationReason || 'Auto-escalated to High priority due to unacknowledged SLA threshold',
      };

      await prisma.$executeRawUnsafe(
        `UPDATE service_tickets
         SET status = 'Escalated',
             priority = 'High',
             history = history || $2::jsonb,
             updated_at = NOW()
         WHERE id = $1::uuid AND tenant_id = $3`,
        row.id,
        JSON.stringify([historyEntry]),
        tenantId
      );

      autoEscalated.push({
        id: row.id,
        readableId: row.readable_id,
        oldPriority: row.priority,
        newPriority: 'High',
        oldStatus: row.status,
        newStatus: 'Escalated',
        reason: evalResult.escalationReason || 'Auto-escalated',
      });
    }

    // Capture Director Paging Alerts for Tier 3 breaches
    if (evalResult.shouldTriggerTier3DirectorAlert) {
      directorAlerts.push({
        id: row.id,
        readableId: row.readable_id,
        ticketType: row.ticket_type,
        elapsedMinutes: evalResult.elapsedWorkingMinutes,
        targetMinutes: evalResult.resolveDeadlineMinutes,
      });
    }
  }

  return {
    totalOpenTickets: rows.length,
    tier1NormalCount: tier1Count,
    tier2EscalatedCount: tier2Count,
    tier3BreachedCount: tier3Count,
    autoEscalatedTickets: autoEscalated,
    directorAlerts,
  };
}
