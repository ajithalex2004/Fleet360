export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Service & Support Ticketing Multi-Line Case Cost Ledger API
 *
 * GET  /api/service-tickets/[id]/costs — Fetch all cost lines and financial summary
 * POST /api/service-tickets/[id]/costs — Add a new cost line to the case ledger
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import {
  getCaseCosts,
  addCaseCost,
  calculateCostSummary,
  type CostType,
  type PayerType,
  type CustomerRechargeStatus,
} from '@/lib/service-tickets/cost-ledger';

interface RouteParams {
  params: Promise<{ id: string }>;
}

const VALID_COST_TYPES: CostType[] = ['TOWING', 'PARTS', 'LABOUR', 'STORAGE', 'REPLACEMENT', 'OTHER'];
const VALID_PAYER_TYPES: PayerType[] = ['TENANT', 'CUSTOMER', 'INSURANCE', 'WARRANTY'];

export async function GET(req: NextRequest, { params }: RouteParams) {
  let authContext: { tenantId: string; userId: string; role?: string };
  try {
    authContext = await requireAuthorizedTenant(req);
  } catch (authErr: any) {
    const status = authErr.status || 401;
    return NextResponse.json({ error: authErr.message || 'Unauthorized' }, { status });
  }

  const { tenantId } = authContext;
  const { id: ticketId } = await params;

  if (!ticketId) {
    return NextResponse.json({ error: 'Ticket ID required' }, { status: 400 });
  }

  return withTenantRls(tenantId, async () => {
    try {
      // Verify ticket exists and belongs to tenant
      const [ticket] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM service_tickets WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
        ticketId,
        tenantId
      );

      if (!ticket) {
        return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
      }

      const costs = await getCaseCosts(ticketId, tenantId);
      const summary = await calculateCostSummary(ticketId, tenantId);

      return NextResponse.json({ costs, summary });
    } catch (err: any) {
      captureException(err, { extra: { ticketId, tenantId, route: 'GET /costs' } });
      return NextResponse.json({ error: 'Failed to fetch case costs: ' + err.message }, { status: 500 });
    }
  });
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  let authContext: { tenantId: string; userId: string; role?: string };
  try {
    authContext = await requireAuthorizedTenant(req);
  } catch (authErr: any) {
    const status = authErr.status || 401;
    return NextResponse.json({ error: authErr.message || 'Unauthorized' }, { status });
  }

  const { tenantId, userId } = authContext;
  const { id: ticketId } = await params;

  if (!ticketId) {
    return NextResponse.json({ error: 'Ticket ID required' }, { status: 400 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const costType = (body.costType || '').toUpperCase() as CostType;
  if (!VALID_COST_TYPES.includes(costType)) {
    return NextResponse.json(
      { error: `Invalid costType. Must be one of: ${VALID_COST_TYPES.join(', ')}` },
      { status: 400 }
    );
  }

  const payerType = (body.payerType || 'TENANT').toUpperCase() as PayerType;
  if (!VALID_PAYER_TYPES.includes(payerType)) {
    return NextResponse.json(
      { error: `Invalid payerType. Must be one of: ${VALID_PAYER_TYPES.join(', ')}` },
      { status: 400 }
    );
  }

  return withTenantRls(tenantId, async () => {
    try {
      // Verify ticket exists
      const [ticket] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM service_tickets WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
        ticketId,
        tenantId
      );

      if (!ticket) {
        return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
      }

      const costLine = await addCaseCost({
        tenantId,
        ticketId,
        costType,
        estimatedAmount: typeof body.estimatedAmount === 'number' ? body.estimatedAmount : 0,
        approvedAmount: typeof body.approvedAmount === 'number' ? body.approvedAmount : 0,
        actualAmount: typeof body.actualAmount === 'number' ? body.actualAmount : 0,
        currency: body.currency || 'AED',
        payerType,
        vendorId: body.vendorId || null,
        vendorName: body.vendorName || null,
        invoiceReference: body.invoiceReference || null,
        warrantyClaimId: body.warrantyClaimId || null,
        insuranceClaimId: body.insuranceClaimId || null,
        customerRechargeStatus: body.customerRechargeStatus as CustomerRechargeStatus,
        notes: body.notes || null,
      });

      // Append entry to ticket history
      const now = new Date();
      const costDisplay = costLine.actualAmount > 0
        ? `Actual: ${costLine.currency} ${costLine.actualAmount}`
        : costLine.approvedAmount > 0
        ? `Approved: ${costLine.currency} ${costLine.approvedAmount}`
        : `Est: ${costLine.currency} ${costLine.estimatedAmount}`;

      const historyEntry = {
        status: 'In Progress',
        date: now.toISOString(),
        actor: userId,
        note: `Cost Ledger Added: [${costType}] ${costDisplay} (Payer: ${payerType}). Ref: ${costLine.invoiceReference || 'None'}.`,
      };

      await prisma.$executeRawUnsafe(
        `UPDATE service_tickets
         SET history = history || $1::jsonb,
             updated_at = NOW()
         WHERE id = $2::uuid AND tenant_id = $3`,
        JSON.stringify([historyEntry]),
        ticketId,
        tenantId
      );

      // Audit log entry
      await logAudit({
        tenantId,
        userId,
        action: 'CREATE',
        entityType: 'service_case_cost',
        entityId: costLine.id,
        newData: { ...costLine },
      }).catch(() => {});

      const summary = await calculateCostSummary(ticketId, tenantId);

      return NextResponse.json({ cost: costLine, summary }, { status: 201 });
    } catch (err: any) {
      captureException(err, { extra: { ticketId, tenantId, route: 'POST /costs' } });
      return NextResponse.json({ error: 'Failed to add case cost: ' + err.message }, { status: 500 });
    }
  });
}
