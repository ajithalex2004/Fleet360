/**
 * POST /api/rental/agreements/:id/close
 *
 * Closes a rental agreement:
 *  1. Validates agreement is ACTIVE
 *  2. Records actual return date, fuel level, odometer
 *  3. Computes excess KM / late fees if applicable
 *  4. Generates a final closing invoice (STANDARD or COMBINATION)
 *  5. Sets vehicle status back to AVAILABLE
 *  6. Sets agreement status to CLOSED
 *
 * Body:
 *  {
 *    actualReturnDate: string (ISO),
 *    returnFuelLevel: number (0-100),
 *    returnOdometer: number,
 *    closedBy: string,
 *    notes?: string,
 *    generateInvoice?: boolean  // default true
 *  }
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { calculateRate, type RateRequest } from '@/lib/rental-rate-engine';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const {
      actualReturnDate, returnFuelLevel, returnOdometer,
      closedBy, notes, generateInvoice = true,
    } = body;

    if (!actualReturnDate) {
      return NextResponse.json({ error: 'actualReturnDate is required' }, { status: 400 });
    }

    // ── 1. Load agreement ──────────────────────────────────────────────────
    const agreements = await prisma.$queryRawUnsafe<any[]>(
      "SELECT ra.*, v.category AS vehicle_category, v.registration_no " +
      "FROM rental_agreements ra " +
      "LEFT JOIN vehicles v ON v.id = ra.vehicle_id " +
      "WHERE ra.id = $1 AND ra.deleted_at IS NULL",
      params.id
    );
    if (!agreements.length) return NextResponse.json({ error: 'Agreement not found' }, { status: 404 });
    const agr = agreements[0];

    if (agr.status !== 'ACTIVE') {
      return NextResponse.json({ error: 'Only ACTIVE agreements can be closed. Current status: ' + agr.status }, { status: 422 });
    }

    const now        = new Date().toISOString();
    const returnDate = new Date(actualReturnDate);
    const dropoff    = agr.dropoff_date ? new Date(agr.dropoff_date) : returnDate;

    // ── 2. Load rate rule for late fees / excess KM ───────────────────────
    const pricingRules = await (prisma as any).pricingRule.findMany({
      where: { isActive: true }, orderBy: [{ priority: 'desc' }],
    });

    const rateReq: RateRequest = {
      vehicleCategory:    agr.vehicle_category ?? 'ECONOMY',
      pickupDate:         agr.pickup_date ? new Date(agr.pickup_date) : new Date(),
      dropoffDate:        returnDate,
      pickupLocationCode: agr.pickup_location_code ?? undefined,
      dropoffLocationCode: agr.dropoff_location_code ?? undefined,
      customerType:       agr.customer_type ?? 'INDIVIDUAL',
      corporateAccountId: agr.corporate_account_id ?? undefined,
      channel:            agr.channel ?? 'DIRECT',
      promoCode:          agr.promo_code ?? undefined,
      insurancePlanCode:  agr.insurance_plan_code ?? undefined,
      currency:           agr.currency ?? 'AED',
    };

    const rate = calculateRate(pricingRules, rateReq);

    // ── 3. Compute late-return fee ────────────────────────────────────────
    let lateFee = 0;
    const graceMs     = (rate.gracePeriodMin ?? 30) * 60 * 1000;
    const lateDiff    = returnDate.getTime() - dropoff.getTime();
    if (lateDiff > graceMs && rate.lateFeePerHour > 0) {
      const lateHours = Math.ceil((lateDiff - graceMs) / (60 * 60 * 1000));
      lateFee = Math.min(lateHours * rate.lateFeePerHour, rate.lateFeeCap || Infinity);
    }

    // ── 4. Compute excess KM fee ──────────────────────────────────────────
    let excessKmFee = 0;
    if (returnOdometer && agr.pickup_odometer && rate.includedKmPerDay > 0) {
      const totalKm      = Number(returnOdometer) - Number(agr.pickup_odometer);
      const includedKm   = rate.includedKmPerDay * rate.totalDays;
      const excessKm     = Math.max(0, totalKm - includedKm);
      if (excessKm > 0 && rate.excessKmRate > 0) {
        excessKmFee = parseFloat((excessKm * rate.excessKmRate).toFixed(2));
      }
    }

    // ── 5. Compute fuel surcharge (simplified: charged per % below pickup level) ─
    let fuelSurcharge = 0;
    if (returnFuelLevel !== undefined && agr.pickup_fuel_level !== undefined) {
      const fuelDiff = Number(agr.pickup_fuel_level) - Number(returnFuelLevel);
      if (fuelDiff > 0) {
        // AED 5 per % fuel point — adjust per business rule
        fuelSurcharge = parseFloat((fuelDiff * 5).toFixed(2));
      }
    }

    // ── 6. Update agreement to CLOSED ─────────────────────────────────────
    await prisma.$executeRawUnsafe(
      "UPDATE rental_agreements SET " +
      "status='CLOSED', actual_return_date=$1, return_fuel_level=$2, return_odometer=$3, " +
      "late_fee=$4, excess_km_fee=$5, fuel_surcharge=$6, closed_by=$7, " +
      "closing_notes=$8, updated_at=$9 " +
      "WHERE id=$10",
      returnDate.toISOString(),
      returnFuelLevel ?? null,
      returnOdometer  ?? null,
      lateFee,
      excessKmFee,
      fuelSurcharge,
      closedBy ?? null,
      notes ?? null,
      now,
      params.id
    );

    // ── 7. Set vehicle back to AVAILABLE ──────────────────────────────────
    if (agr.vehicle_id) {
      await prisma.$executeRawUnsafe(
        "UPDATE vehicles SET status='AVAILABLE', updated_at=$1 WHERE id=$2",
        now, agr.vehicle_id
      );
    }

    // ── 8. Generate closing invoice if requested ──────────────────────────
    let invoice = null;
    if (generateInvoice) {
      const TAX_RATE   = 5;
      const lineItems: any[] = [];

      // Rental charges from rate engine (exclude TAX line)
      for (const bl of rate.breakdown) {
        if (bl.type === 'TAX') continue;
        lineItems.push({
          lineType: bl.type, description: bl.label,
          quantity: bl.qty, unitPrice: bl.unitPrice, unitLabel: bl.unitLabel,
          discountPct: 0, taxable: bl.type !== 'DISCOUNT', amount: bl.amount,
        });
      }

      // Additional charges from agreement JSON
      try {
        if (agr.additional_charges) {
          const ac = JSON.parse(agr.additional_charges);
          for (const c of (Array.isArray(ac) ? ac : [])) {
            lineItems.push({ lineType: 'EXTRA', description: c.description, quantity: 1, unitPrice: c.amount, unitLabel: 'flat', discountPct: 0, taxable: true, amount: c.amount });
          }
        }
      } catch { /* ignore */ }

      if (lateFee > 0) {
        lineItems.push({ lineType: 'LATE_FEE', description: 'Late return fee', quantity: 1, unitPrice: lateFee, unitLabel: 'flat', discountPct: 0, taxable: true, amount: lateFee });
      }
      if (excessKmFee > 0) {
        lineItems.push({ lineType: 'EXCESS_KM', description: 'Excess km charge', quantity: 1, unitPrice: excessKmFee, unitLabel: 'flat', discountPct: 0, taxable: true, amount: excessKmFee });
      }
      if (fuelSurcharge > 0) {
        lineItems.push({ lineType: 'FUEL', description: 'Fuel surcharge', quantity: 1, unitPrice: fuelSurcharge, unitLabel: 'flat', discountPct: 0, taxable: true, amount: fuelSurcharge });
      }

      // Totals
      const subtotal      = parseFloat(lineItems.reduce((s, l) => s + l.amount, 0).toFixed(2));
      const discAmt       = rate.discountAmount;
      const taxableAmt    = parseFloat((subtotal - discAmt).toFixed(2));
      const taxAmt        = parseFloat((taxableAmt * TAX_RATE / 100).toFixed(2));
      const totalAmt      = parseFloat((taxableAmt + taxAmt).toFixed(2));

      const countRows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
        "SELECT COUNT(*) AS count FROM rental_invoices"
      );
      const seq       = Number(countRows[0]?.count ?? 0) + 1;
      const invoiceNo = 'RINV-' + String(seq).padStart(6, '0');
      const invoiceId = crypto.randomUUID();
      const dueDate   = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      await prisma.$executeRawUnsafe(
        "INSERT INTO rental_invoices " +
        "(id,created_at,updated_at,invoice_no,agreement_id,customer_id,invoice_type,invoice_date," +
        "due_date,period_from,period_to,currency,subtotal,discount_amount,taxable_amount,tax_rate," +
        "tax_amount,total_amount,paid_amount,balance_due,status,billing_mode,payment_terms_days,notes) " +
        "VALUES ($1,$2,$3,$4,$5,$6,'STANDARD',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,0,$17,'DRAFT','SEPARATE',30,$18)",
        invoiceId, now, now, invoiceNo,
        params.id, agr.customer_id,
        now, dueDate,
        agr.pickup_date, returnDate.toISOString(),
        agr.currency ?? 'AED',
        subtotal, discAmt, taxableAmt, TAX_RATE, taxAmt, totalAmt,
        notes ?? 'Closing invoice for agreement ' + agr.agreement_no,
      );

      let sortOrder = 0;
      for (const li of lineItems) {
        await prisma.$executeRawUnsafe(
          "INSERT INTO rental_invoice_line_items " +
          "(id,invoice_id,line_type,description,quantity,unit_price,unit_label,discount_pct,taxable,amount,sort_order) " +
          "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
          crypto.randomUUID(), invoiceId, li.lineType, li.description,
          li.quantity, li.unitPrice, li.unitLabel,
          li.discountPct, li.taxable, li.amount, sortOrder++,
        );
      }

      const invRows = await prisma.$queryRawUnsafe<any[]>(
        "SELECT * FROM rental_invoices WHERE id = $1", invoiceId
      );
      invoice = invRows[0];
    }

    const updatedAgr = await prisma.$queryRawUnsafe<any[]>(
      "SELECT * FROM rental_agreements WHERE id = $1", params.id
    );

    return NextResponse.json({
      agreement: updatedAgr[0],
      closingSummary: { lateFee, excessKmFee, fuelSurcharge },
      invoice,
    });
  } catch (e: any) {
    console.error('Agreement close error:', e);
    return NextResponse.json({ error: e.message ?? 'Failed to close agreement' }, { status: 500 });
  }
}
