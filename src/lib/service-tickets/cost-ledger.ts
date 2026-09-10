/**
 * Service & Support Ticketing Multi-Line Case Cost Ledger (Pillar 3 - P2)
 *
 * Provides financial tracking for breakdowns and service events:
 * - Line-item case costing across Towing, Parts, Labour, Storage, Replacement, Other
 * - Multi-payer accounting: Tenant, Customer recharge, Insurance, Warranty claim
 * - Tracking of estimates vs approved budgets vs actual invoices
 */

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export type CostType = 'TOWING' | 'PARTS' | 'LABOUR' | 'STORAGE' | 'REPLACEMENT' | 'OTHER';
export type PayerType = 'TENANT' | 'CUSTOMER' | 'INSURANCE' | 'WARRANTY';
export type CustomerRechargeStatus = 'PENDING' | 'INVOICED' | 'PAID' | 'WAIVED' | 'NOT_APPLICABLE';

export interface CaseCostLine {
  id: string;
  tenantId: string;
  ticketId: string;
  costType: CostType;
  estimatedAmount: number;
  approvedAmount: number;
  actualAmount: number;
  currency: string;
  payerType: PayerType;
  vendorId?: string | null;
  vendorName?: string | null;
  invoiceReference?: string | null;
  warrantyClaimId?: string | null;
  insuranceClaimId?: string | null;
  customerRechargeStatus: CustomerRechargeStatus;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AddCaseCostInput {
  tenantId: string;
  ticketId: string;
  costType: CostType;
  estimatedAmount?: number;
  approvedAmount?: number;
  actualAmount?: number;
  currency?: string;
  payerType?: PayerType;
  vendorId?: string | null;
  vendorName?: string | null;
  invoiceReference?: string | null;
  warrantyClaimId?: string | null;
  insuranceClaimId?: string | null;
  customerRechargeStatus?: CustomerRechargeStatus;
  notes?: string | null;
}

export interface UpdateCaseCostInput {
  costType?: CostType;
  estimatedAmount?: number;
  approvedAmount?: number;
  actualAmount?: number;
  currency?: string;
  payerType?: PayerType;
  vendorId?: string | null;
  vendorName?: string | null;
  invoiceReference?: string | null;
  warrantyClaimId?: string | null;
  insuranceClaimId?: string | null;
  customerRechargeStatus?: CustomerRechargeStatus;
  notes?: string | null;
}

export interface CaseCostSummary {
  ticketId: string;
  totalEstimated: number;
  totalApproved: number;
  totalActual: number;
  currency: string;
  breakdownByType: Record<CostType, { estimated: number; approved: number; actual: number }>;
  breakdownByPayer: Record<PayerType, { estimated: number; approved: number; actual: number }>;
  customerRechargePending: number;
  lineCount: number;
}

const _g = globalThis as { _costLedgerSchemaInit?: Promise<void> };

function isInsufficientPrivilege(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    (e.meta as { code?: string } | undefined)?.code === '42501'
  );
}

/**
 * Initializes the service_case_costs table if it doesn't already exist.
 */
export async function ensureCostLedgerTable(): Promise<void> {
  if (_g._costLedgerSchemaInit) return _g._costLedgerSchemaInit;

  _g._costLedgerSchemaInit = (async () => {
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS service_case_costs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id TEXT NOT NULL,
          ticket_id UUID NOT NULL,
          cost_type TEXT NOT NULL,
          estimated_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
          approved_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
          actual_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
          currency TEXT NOT NULL DEFAULT 'AED',
          payer_type TEXT NOT NULL DEFAULT 'TENANT',
          vendor_id TEXT,
          vendor_name TEXT,
          invoice_reference TEXT,
          warranty_claim_id TEXT,
          insurance_claim_id TEXT,
          customer_recharge_status TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
          notes TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_service_case_costs_tenant_ticket 
          ON service_case_costs(tenant_id, ticket_id);
      `);
    } catch (e) {
      if (!isInsufficientPrivilege(e)) {
        delete _g._costLedgerSchemaInit;
        throw e;
      }
    }
  })();

  return _g._costLedgerSchemaInit;
}

interface DbCostRow {
  id: string;
  tenant_id: string;
  ticket_id: string;
  cost_type: string;
  estimated_amount: string | number;
  approved_amount: string | number;
  actual_amount: string | number;
  currency: string;
  payer_type: string;
  vendor_id: string | null;
  vendor_name: string | null;
  invoice_reference: string | null;
  warranty_claim_id: string | null;
  insurance_claim_id: string | null;
  customer_recharge_status: string;
  notes: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function mapDbRowToCaseCost(row: DbCostRow): CaseCostLine {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    ticketId: row.ticket_id,
    costType: (row.cost_type as CostType) || 'OTHER',
    estimatedAmount: Number(row.estimated_amount) || 0,
    approvedAmount: Number(row.approved_amount) || 0,
    actualAmount: Number(row.actual_amount) || 0,
    currency: row.currency || 'AED',
    payerType: (row.payer_type as PayerType) || 'TENANT',
    vendorId: row.vendor_id,
    vendorName: row.vendor_name,
    invoiceReference: row.invoice_reference,
    warrantyClaimId: row.warranty_claim_id,
    insuranceClaimId: row.insurance_claim_id,
    customerRechargeStatus: (row.customer_recharge_status as CustomerRechargeStatus) || 'NOT_APPLICABLE',
    notes: row.notes,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/**
 * Retrieves all cost lines for a specific service ticket within a tenant.
 */
export async function getCaseCosts(ticketId: string, tenantId: string): Promise<CaseCostLine[]> {
  await ensureCostLedgerTable();

  const rows = await prisma.$queryRawUnsafe<DbCostRow[]>(
    `SELECT *
     FROM service_case_costs
     WHERE ticket_id = $1::uuid AND tenant_id = $2
     ORDER BY created_at ASC`,
    ticketId,
    tenantId
  );

  return rows.map(mapDbRowToCaseCost);
}

/**
 * Adds a new cost line to a ticket's cost ledger.
 */
export async function addCaseCost(data: AddCaseCostInput): Promise<CaseCostLine> {
  await ensureCostLedgerTable();

  const [row] = await prisma.$queryRawUnsafe<DbCostRow[]>(
    `INSERT INTO service_case_costs (
       tenant_id,
       ticket_id,
       cost_type,
       estimated_amount,
       approved_amount,
       actual_amount,
       currency,
       payer_type,
       vendor_id,
       vendor_name,
       invoice_reference,
       warranty_claim_id,
       insurance_claim_id,
       customer_recharge_status,
       notes,
       created_at,
       updated_at
     ) VALUES (
       $1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW()
     )
     RETURNING *`,
    data.tenantId,
    data.ticketId,
    data.costType,
    data.estimatedAmount ?? 0,
    data.approvedAmount ?? 0,
    data.actualAmount ?? 0,
    data.currency || 'AED',
    data.payerType || 'TENANT',
    data.vendorId || null,
    data.vendorName || null,
    data.invoiceReference || null,
    data.warrantyClaimId || null,
    data.insuranceClaimId || null,
    data.customerRechargeStatus || (data.payerType === 'CUSTOMER' ? 'PENDING' : 'NOT_APPLICABLE'),
    data.notes || null
  );

  return mapDbRowToCaseCost(row);
}

/**
 * Updates an existing cost line.
 */
export async function updateCaseCost(
  id: string,
  tenantId: string,
  data: UpdateCaseCostInput
): Promise<CaseCostLine | null> {
  await ensureCostLedgerTable();

  const setClauses: string[] = ['updated_at = NOW()'];
  const params: unknown[] = [id, tenantId];
  let idx = 3;

  if (data.costType !== undefined) {
    setClauses.push(`cost_type = $${idx++}`);
    params.push(data.costType);
  }
  if (data.estimatedAmount !== undefined) {
    setClauses.push(`estimated_amount = $${idx++}`);
    params.push(data.estimatedAmount);
  }
  if (data.approvedAmount !== undefined) {
    setClauses.push(`approved_amount = $${idx++}`);
    params.push(data.approvedAmount);
  }
  if (data.actualAmount !== undefined) {
    setClauses.push(`actual_amount = $${idx++}`);
    params.push(data.actualAmount);
  }
  if (data.currency !== undefined) {
    setClauses.push(`currency = $${idx++}`);
    params.push(data.currency);
  }
  if (data.payerType !== undefined) {
    setClauses.push(`payer_type = $${idx++}`);
    params.push(data.payerType);
  }
  if (data.vendorId !== undefined) {
    setClauses.push(`vendor_id = $${idx++}`);
    params.push(data.vendorId);
  }
  if (data.vendorName !== undefined) {
    setClauses.push(`vendor_name = $${idx++}`);
    params.push(data.vendorName);
  }
  if (data.invoiceReference !== undefined) {
    setClauses.push(`invoice_reference = $${idx++}`);
    params.push(data.invoiceReference);
  }
  if (data.warrantyClaimId !== undefined) {
    setClauses.push(`warranty_claim_id = $${idx++}`);
    params.push(data.warrantyClaimId);
  }
  if (data.insuranceClaimId !== undefined) {
    setClauses.push(`insurance_claim_id = $${idx++}`);
    params.push(data.insuranceClaimId);
  }
  if (data.customerRechargeStatus !== undefined) {
    setClauses.push(`customer_recharge_status = $${idx++}`);
    params.push(data.customerRechargeStatus);
  }
  if (data.notes !== undefined) {
    setClauses.push(`notes = $${idx++}`);
    params.push(data.notes);
  }

  const rows = await prisma.$queryRawUnsafe<DbCostRow[]>(
    `UPDATE service_case_costs
     SET ${setClauses.join(', ')}
     WHERE id = $1::uuid AND tenant_id = $2
     RETURNING *`,
    ...params
  );

  if (!rows || rows.length === 0) return null;
  return mapDbRowToCaseCost(rows[0]);
}

/**
 * Computes financial summary totals and aggregations from an array of cost lines.
 */
export function calculateSummaryFromLines(lines: CaseCostLine[], ticketId: string): CaseCostSummary {
  const breakdownByType: Record<CostType, { estimated: number; approved: number; actual: number }> = {
    TOWING: { estimated: 0, approved: 0, actual: 0 },
    PARTS: { estimated: 0, approved: 0, actual: 0 },
    LABOUR: { estimated: 0, approved: 0, actual: 0 },
    STORAGE: { estimated: 0, approved: 0, actual: 0 },
    REPLACEMENT: { estimated: 0, approved: 0, actual: 0 },
    OTHER: { estimated: 0, approved: 0, actual: 0 },
  };

  const breakdownByPayer: Record<PayerType, { estimated: number; approved: number; actual: number }> = {
    TENANT: { estimated: 0, approved: 0, actual: 0 },
    CUSTOMER: { estimated: 0, approved: 0, actual: 0 },
    INSURANCE: { estimated: 0, approved: 0, actual: 0 },
    WARRANTY: { estimated: 0, approved: 0, actual: 0 },
  };

  let totalEstimated = 0;
  let totalApproved = 0;
  let totalActual = 0;
  let customerRechargePending = 0;
  const currency = lines[0]?.currency || 'AED';

  for (const line of lines) {
    totalEstimated += line.estimatedAmount;
    totalApproved += line.approvedAmount;
    totalActual += line.actualAmount;

    // Type aggregation
    if (breakdownByType[line.costType]) {
      breakdownByType[line.costType].estimated += line.estimatedAmount;
      breakdownByType[line.costType].approved += line.approvedAmount;
      breakdownByType[line.costType].actual += line.actualAmount;
    }

    // Payer aggregation
    if (breakdownByPayer[line.payerType]) {
      breakdownByPayer[line.payerType].estimated += line.estimatedAmount;
      breakdownByPayer[line.payerType].approved += line.approvedAmount;
      breakdownByPayer[line.payerType].actual += line.actualAmount;
    }

    // Recharge tracking: customer liability pending collection
    if (line.payerType === 'CUSTOMER' && line.customerRechargeStatus === 'PENDING') {
      customerRechargePending += line.actualAmount > 0 ? line.actualAmount : line.approvedAmount;
    }
  }

  // Round to 2 decimal places
  const round2 = (n: number) => Math.round(n * 100) / 100;

  return {
    ticketId,
    totalEstimated: round2(totalEstimated),
    totalApproved: round2(totalApproved),
    totalActual: round2(totalActual),
    currency,
    breakdownByType,
    breakdownByPayer,
    customerRechargePending: round2(customerRechargePending),
    lineCount: lines.length,
  };
}

/**
 * Calculates the complete cost summary for a service ticket.
 */
export async function calculateCostSummary(
  ticketId: string,
  tenantId: string
): Promise<CaseCostSummary> {
  const lines = await getCaseCosts(ticketId, tenantId);
  return calculateSummaryFromLines(lines, ticketId);
}
