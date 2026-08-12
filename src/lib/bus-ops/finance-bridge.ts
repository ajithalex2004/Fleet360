/**
 * Bus Operations → Finance bridge
 *
 * Single authorised path for creating Finance entries from the Bus-Ops module.
 * All journal entries are created as DRAFT via createDraftJournalEntry().
 * Finance expenses are inserted idempotently keyed on expense_no = 'FUEL-{fuelLogId}'.
 *
 * GL mapping:
 *   5400  Bus Operations Expense  (debit on trip completion)
 *   4400  Bus Operations Revenue  (credit on AR mirror)
 *   2100  Accounts Payable / Accrued Liabilities (credit on cost accrual)
 *
 * Cost centre / profit centre: PC-BUS
 */

import { prisma }                  from '@/lib/prisma';
import { createDraftJournalEntry } from '@/lib/finance/journal-service';
import { upsertFinanceInvoice }    from '@/lib/finance/module-ledger';

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_FUEL_RATE_AED   = 3.50;  // AED per litre — UAE diesel fallback
const DEFAULT_DRIVER_RATE_AED = 35.00; // AED per hour  — UAE bus driver fallback
const BUS_COST_CENTRE         = 'PC-BUS';
const FUEL_VAT_RATE           = 5;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BusTripLogSummary {
  id:                  string;
  scheduleId:          string;
  fuelUsed:            number | null;
  passengersBoarded:   number | null;
  actualDepartureTime: Date   | null;
  actualArrivalTime:   Date   | null;
}

export interface BusTripScheduleSummary {
  id:         string;
  tripNumber: string | null;
  vehicleId:  string | null;
  driverId:   string | null;
}

export interface FuelLogBridgeInput {
  id:          string;
  vehicleId:   string;
  driverId:    string | null;
  fuelDate:    Date;
  liters:      number;
  costPerLiter: number | null;
  totalCost:   number | null;
  station:     string | null;
}

// ── 1. Trip Operating Costs → Finance JE ─────────────────────────────────────

/**
 * Post operating costs for a completed trip to Finance as a DRAFT journal entry.
 * Best-effort — errors are caught and logged without failing the trip completion.
 *
 * Includes fuel consumption cost and, when a COMPLETED DriverShift exists for the
 * vehicle on the departure date, driver labour cost.
 */
export async function postTripOperatingCostsToFinance(
  schedule: BusTripScheduleSummary,
  tripLog:  BusTripLogSummary,
  tenantId: string,
): Promise<{ jeId: string; jeNumber: string } | null> {
  try {
    let totalCost = 0;
    const costLines: string[] = [];

    // ── Fuel cost ─────────────────────────────────────────────────────────
    if (tripLog.fuelUsed && tripLog.fuelUsed > 0) {
      const recentFuel = schedule.vehicleId
        ? await prisma.$queryRawUnsafe<Array<{ cost_per_liter: number | null }>>(
            `SELECT cost_per_liter FROM fuel_logs
              WHERE vehicle_id = $1 AND cost_per_liter IS NOT NULL
              ORDER BY fuel_date DESC LIMIT 1`,
            schedule.vehicleId,
          ).catch(() => [])
        : [];

      const rate     = Number(recentFuel[0]?.cost_per_liter ?? DEFAULT_FUEL_RATE_AED);
      const fuelCost = Math.round(tripLog.fuelUsed * rate * 100) / 100;
      totalCost += fuelCost;
      costLines.push(`Fuel ${tripLog.fuelUsed}L × AED ${rate.toFixed(2)}`);
    }

    // ── Driver labour cost (COMPLETED shift on same vehicle + date) ───────
    if (schedule.vehicleId && tripLog.actualDepartureTime) {
      const shiftDate = tripLog.actualDepartureTime.toISOString().split('T')[0];
      const [shift]   = await prisma.$queryRawUnsafe<Array<{ total_hours: number | null }>>(
        `SELECT total_hours FROM driver_shifts
          WHERE vehicle_id = $1 AND shift_date::date = $2::date AND status = 'COMPLETED'
          LIMIT 1`,
        schedule.vehicleId,
        shiftDate,
      ).catch(() => []);

      if (shift?.total_hours && shift.total_hours > 0) {
        const driverCost = Math.round(shift.total_hours * DEFAULT_DRIVER_RATE_AED * 100) / 100;
        totalCost += driverCost;
        costLines.push(`Driver labour ${shift.total_hours.toFixed(1)}h × AED ${DEFAULT_DRIVER_RATE_AED}`);
      }
    }

    if (totalCost <= 0) return null;

    const tripRef   = schedule.tripNumber ?? schedule.id;
    const narration = `Bus trip ${tripRef} operating costs: ${costLines.join('; ')}`;

    const je = await createDraftJournalEntry({
      tenantId,
      narration,
      reference:  tripRef,
      sourceType: 'BUS_TRIP_COMPLETION',
      sourceId:   schedule.id,
      amount:     totalCost,
      currency:   'AED',
      preparedBy: 'system',
      costCentre: BUS_COST_CENTRE,
      notes:      `Auto-generated on trip completion. Vehicle: ${schedule.vehicleId ?? 'N/A'}`,
      debit:  { code: '5400', name: 'Bus Operations Expense',       description: narration },
      credit: { code: '2100', name: 'Accounts Payable / Accrued Exp.', description: `Accrual: ${tripRef}` },
    });

    return { jeId: je.id, jeNumber: je.number };
  } catch (err) {
    console.warn('[bus-ops finance-bridge] postTripOperatingCostsToFinance failed:', err);
    return null;
  }
}

// ── 2. Trip Revenue → Finance AR mirror ──────────────────────────────────────

/**
 * Mirror bus trip fare revenue to finance_invoices (AR).
 * Only fires when farePerHead > 0 and passengersBoarded > 0.
 * Idempotent — upsert keyed on (BUS_OPERATIONS, BUS_TRIP, scheduleId).
 */
export async function mirrorBusTripRevenueToFinance(
  schedule:    BusTripScheduleSummary,
  tripLog:     BusTripLogSummary,
  farePerHead: number,
  tenantId:    string,
): Promise<{ financeInvoiceId: string } | null> {
  try {
    const passengers = tripLog.passengersBoarded ?? 0;
    if (passengers <= 0 || farePerHead <= 0) return null;

    const subtotal    = Math.round(passengers * farePerHead * 100) / 100;
    const vatAmount   = Math.round(subtotal * 0.05 * 100) / 100;
    const totalAmount = subtotal + vatAmount;
    const tripRef     = schedule.tripNumber ?? schedule.id;
    const issueDate   = (tripLog.actualArrivalTime ?? new Date()).toISOString().split('T')[0];

    const result = await upsertFinanceInvoice({
      tenantId,
      moduleSource:  'BUS_OPERATIONS',
      referenceType: 'BUS_TRIP',
      referenceId:   schedule.id,
      invoiceNumber: `BUS-${tripRef}`,
      clientName:    'Staff Transport — Passengers',
      serviceType:   'BUS_TRANSPORT',
      description:   `Trip ${tripRef}: ${passengers} passengers × AED ${farePerHead.toFixed(2)}`,
      lineItems: [{
        description: `Bus trip ${tripRef}`,
        quantity:    passengers,
        unitPrice:   farePerHead,
        amount:      subtotal,
      }],
      subtotal,
      vatRate:       5,
      vatAmount,
      totalAmount,
      paidAmount:    0,
      currency:      'AED',
      issueDate,
      paymentStatus: 'UNPAID',
    });

    return { financeInvoiceId: result.financeInvoiceId };
  } catch (err) {
    console.warn('[bus-ops finance-bridge] mirrorBusTripRevenueToFinance failed:', err);
    return null;
  }
}

// ── 3. FuelLog → Finance Expense ─────────────────────────────────────────────

/**
 * Mirror a fuel log entry to finance.finance_expenses.
 * Idempotent — keyed on expense_no = 'FUEL-{fuelLogId}'.
 * Best-effort — errors are caught and logged.
 */
export async function postFuelLogToFinance(
  fuelLog:  FuelLogBridgeInput,
  tenantId: string,
): Promise<{ expenseId: string } | null> {
  try {
    const amount = fuelLog.totalCost
      ?? Math.round(fuelLog.liters * DEFAULT_FUEL_RATE_AED * 100) / 100;
    if (amount <= 0) return null;

    const vatAmount   = Math.round(amount * (FUEL_VAT_RATE / 100) * 100) / 100;
    const totalAmount = amount + vatAmount;
    const expenseNo   = `FUEL-${fuelLog.id}`;
    const expDate     = fuelLog.fuelDate.toISOString().split('T')[0];

    // Idempotency check — skip if already mirrored
    const [existing] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM finance.finance_expenses WHERE expense_no = $1 LIMIT 1`,
      expenseNo,
    ).catch(() => []);
    if (existing?.id) return { expenseId: existing.id };

    const description = [
      `Fuel log: ${fuelLog.liters.toFixed(2)}L`,
      fuelLog.station      ? `at ${fuelLog.station}` : null,
      fuelLog.costPerLiter ? `@ AED ${fuelLog.costPerLiter.toFixed(3)}/L` : null,
    ].filter(Boolean).join(' ');

    const [row] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO finance.finance_expenses
         (expense_no, category, sub_category, description,
          amount, currency, vat_amount, total_amount,
          expense_date, status, vehicle_id, driver_id,
          cost_centre, profit_centre, reference_no, tenant_id)
       VALUES ($1,'FUEL','BUS_FUEL',$2, $3,'AED',$4,$5, $6::date,'DRAFT',$7,$8,
               'PC-BUS','PC-BUS',$9,$10)
       RETURNING id::text`,
      expenseNo, description,
      amount, vatAmount, totalAmount,
      expDate,
      fuelLog.vehicleId  ?? null,
      fuelLog.driverId   ?? null,
      fuelLog.id,    // reference_no → traceability back to fuel_logs.id
      tenantId,
    );

    if (!row?.id) throw new Error(`INSERT finance_expenses failed for ${expenseNo}`);
    return { expenseId: row.id };
  } catch (err) {
    console.warn('[bus-ops finance-bridge] postFuelLogToFinance failed:', err);
    return null;
  }
}
