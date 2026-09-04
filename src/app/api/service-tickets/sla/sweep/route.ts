export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import {
  runSlaEscalationSweep,
  calculateTicketSlaStatus,
  type SlaTicketInput,
} from '@/lib/service-tickets/active-sla-engine';
import type { TicketType, TicketPriority, TicketStatus } from '@/types/service-tickets';

export const runtime = 'nodejs';

/**
 * GET /api/service-tickets/sla/sweep
 * Returns real-time SLA metrics, tier breakdowns, and list of at-risk / breached tickets.
 */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async () => {
    try {
      const rows = await prisma.$queryRawUnsafe<
        Array<{
          id: string;
          ticket_type: string;
          priority: string;
          status: string;
          created_at: string;
          readable_id: string | null;
          assigned_to: string | null;
          title: string;
        }>
      >(
        `SELECT id, ticket_type, priority, status, created_at, readable_id, assigned_to, title
         FROM service_tickets
         WHERE tenant_id = $1
           AND deleted_at IS NULL
           AND status NOT IN ('Resolved', 'Completed', 'Closed', 'Rejected')
         ORDER BY created_at ASC`,
        tenantId
      );

      const now = new Date();
      const evaluations = rows.map((row) => {
        const input: SlaTicketInput = {
          id: row.id,
          ticketType: row.ticket_type as TicketType,
          priority: row.priority as TicketPriority,
          status: row.status as TicketStatus,
          createdAt: row.created_at,
          readableId: row.readable_id,
          assignedTo: row.assigned_to,
        };
        const evaluation = calculateTicketSlaStatus(input, now);
        return {
          ...evaluation,
          title: row.title,
          status: row.status,
          priority: row.priority,
          ticketType: row.ticket_type,
        };
      });

      const tier1 = evaluations.filter((e) => e.escalationTier === 'TIER_1_NORMAL');
      const tier2 = evaluations.filter((e) => e.escalationTier === 'TIER_2_ESCALATED');
      const tier3 = evaluations.filter((e) => e.escalationTier === 'TIER_3_BREACHED');

      return NextResponse.json({
        ok: true,
        summary: {
          totalOpen: rows.length,
          tier1Normal: tier1.length,
          tier2Escalated: tier2.length,
          tier3Breached: tier3.length,
          onTimeComplianceRate:
            rows.length > 0
              ? Math.round(((rows.length - tier3.length) / rows.length) * 100)
              : 100,
        },
        evaluations,
        criticalAlerts: [...tier3, ...tier2],
      });
    } catch (err) {
      console.error('GET /api/service-tickets/sla/sweep error:', err);
      return NextResponse.json(
        { error: 'Failed to fetch SLA evaluations' },
        { status: 500 }
      );
    }
  });
}

/**
 * POST /api/service-tickets/sla/sweep
 * Executes the active SLA sweep, auto-escalates unacknowledged tickets, and returns sweep report.
 */
export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async () => {
    try {
      const sweepResult = await runSlaEscalationSweep(tenantId);
      return NextResponse.json({
        ok: true,
        timestamp: new Date().toISOString(),
        sweepResult,
      });
    } catch (err) {
      console.error('POST /api/service-tickets/sla/sweep error:', err);
      return NextResponse.json(
        { error: 'Failed to execute SLA escalation sweep' },
        { status: 500 }
      );
    }
  });
}
