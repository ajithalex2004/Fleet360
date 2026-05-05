/**
 * POST /api/rental/agreements/:id/generate-invoice
 *
 * Builds a full RentalInvoice from an active agreement, pulling:
 *  - Base rental charge (from rate engine)
 *  - Insurance charge
 *  - Additional / optional charges stored on the agreement
 *  - Outstanding damage-claim charges
 *  - Unpaid traffic fines linked to the vehicle during the rental period
 *
 * The invoice is created in DRAFT status. Pass { autoSend: true } in the
 * body to also transition it to SENT immediately.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { calculateRate, type RateRequest } from '@/lib/rental-rate-engine';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body  = await req.json().catch(() => ({}));
    const { invoiceType = 'STANDARD', autoSend = false, notes } = body;

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

    if (!['ACTIVE', 'CLOSED'].includes(agr.status)) {
      return NextResponse.json({ error: 'Invoice can only be generated for ACTIVE or CLOSED agreements' }, { status: 422 });
    }

    // ── 2. Fetch pricing rules and calculate base rental ──────────────────
    const pricingRules = await (prisma as any).pricingRule.findMany({
      where: { isActive: true }, orderBy: [{ priority: 'desc' }],
    });

    const pickupDate  = agr.pickup_date  ? new Date(agr.pickup_date)  : new Date();
    const dropoffDate = agr.actual_return_date
      ? new Date(agr.actual_return_date)
      : agr.dropoff_date ? new Date(agr.dropoff_date) : new Date();

    const rateReq: RateRequest = {
      vehicleCategory:    agr.vehicle_category ?? 'ECONOMY',
      pickupDate,
      dropoffDate,
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

    // ── 3. Load additional charges (extras, fuel, child seat, GPS, etc.) ──
    let additionalCharges: { description: string; amount: number; lineType: string }[] = [];
    try {
      if (agr.additional_charges) {
        const parsed = JSON.parse(agr.additional_charges);
        additionalCharges = Array.isArray(parsed) ? parsed : [];
      }
    } catch { /* ignore */ }

    // ── 4. Load open damage-claim charges ────────────────────────────────
    const damageClaims = await prisma.$queryRawUnsafe<any[]>(
      "SELECT description, estimated_repair_cost AS amount FROM rental_damage_claims " +
      "WHERE agreement_id = $1 AND status NOT IN ('CLOSED','WAIVED') AND deleted_at IS NULL",
      params.id
    );

    // ── 5. Load unpaid traffic fines within rental period ────────────────
    const trafficFines = await prisma.$queryRawUnsafe<any[]>(
      "SELECT fine_number AS description, fine_amount AS amount FROM traffic_fines " +
      "WHERE vehicle_id = $1 AND fine_date >= $2 AND fine_date <= $3 " +
      "AND status = 'UNPAID' AND deleted_at IS NULL",
      agr.vehicle_id,
      pickupDate.toISOString(),
      dropoffDate.toISOString()
    );

    // ── 6. Build line items ───────────────────────────────────────────────
    const TAX_RATE = 5; // UAE VAT
    const lineItems: any[] = [];

    // Base rental lines from rate engine breakdown
    for (const bl of rate.breakdown) {
      if (bl.type === 'TAX') continue; // we'll compute tax ourselves
      lineItems.push({
        lineType:    bl.type,
        description: bl.label,
        quantity:    bl.qty,
        unitPrice:   bl.unitPrice,
        unitLabel:   bl.unitLabel,
        discountPct: 0,
        taxable:     bl.type !== 'DISCOUNT',
        amount:      bl.amount,
      });
    }

    // Additional charges from agreement
    for (const ac of additionalCharges) {
      lineItems.push({
        lineType: ac.lineType ?? 'EXTRA',
        description: ac.description,
        quantity: 1, unitPrice: ac.amount, unitLabel: 'flat',
        discountPct: 0, taxable: true, amount: ac.amount,
      });
    }

    // Damage claims
    for (const dc of damageClaims) {
      lineItems.push({
        lineType: 'DAMAGE', description: 'Damage: ' + dc.description,
        quantity: 1, unitPrice: Number(dc.amount), unitLabel: 'flat',
        discountPct: 0, taxable: true, amount: Number(dc.amount),
      });
    }

    // Traffic fines
    for (const tf of trafficFines) {
      lineItems.push({
        lineType: 'FINE', description: 'Traffic Fine: ' + tf.description,
        quantity: 1, unitPrice: Number(tf.amount), unitLabel: 'flat',
        discountPct: 0, taxable: false, amount: Number(tf.amount),
      });
    }

    // ── 7. Compute totals ─────────────────────────────────────────────────
    const taxableSubtotal   = lineItems.filter(l => l.taxable).reduce((s, l) => s + l.amount, 0);
    const nonTaxableSubtotal = lineItems.filter(l => !l.taxable).reduce((s, l) => s + l.amount, 0);
    const subtotal          = parseFloat((taxableSubtotal + nonTaxableSubtotal).toFixed(2));
    const discountAmount    = rate.discountAmount;
    const taxableAmount     = parseFloat((taxableSubtotal - discountAmount).toFixed(2));
    const taxAmount         = parseFloat((taxableAmount * TAX_RATE / 100).toFixed(2));
    const totalAmount       = parseFloat((subtotal - discountAmount + taxAmount).toFixed(2));

    // ── 8. Generate invoice number ────────────────────────────────────────
    const countRows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      "SELECT COUNT(*) AS count FROM rental_invoices"
    );
    const seq = Number(countRows[0]?.count ?? 0) + 1;
    const invoiceNo = 'RINV-' + String(seq).padStart(6, '0');

    const invoiceId = crypto.randomUUID();
    const now       = new Date().toISOString();
    const dueDate   = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const status    = autoSend ? 'SENT' : 'DRAFT';

    // ── 9. Insert invoice ─────────────────────────────────────────────────
    await prisma.$executeRawUnsafe(
      "INSERT INTO rental_invoices " +
      "(id,created_at,updated_at,invoice_no,agreement_id,customer_id,invoice_type,invoice_date," +
      "due_date,period_from,period_to,currency,subtotal,discount_amount,taxable_amount,tax_rate," +
      "tax_amount,total_amount,paid_amount,balance_due,status,is_corporate,corporate_account_id," +
      "billing_mode,payment_terms_days,notes) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,0,$18,$19,$20,$21,$22,30,$23)",
      invoiceId, now, now,
      invoiceNo,
      params.id,
      agr.customer_id,
      invoiceType,
      now,
      dueDate,
      pickupDate.toISOString(),
      dropoffDate.toISOString(),
      agr.currency ?? 'AED',
      subtotal,
      discountAmount,
      taxableAmount,
      TAX_RATE,
      taxAmount,
      totalAmount,
      status,
      agr.is_corporate ?? false,
      agr.corporate_account_id ?? null,
      agr.billing_mode ?? 'SEPARATE',
      notes ?? null,
    );

    // ── 10. Insert line items ─────────────────────────────────────────────
    let sortOrder = 0;
    for (const li of lineItems) {
      const liId = crypto.randomUUID();
      await prisma.$executeRawUnsafe(
        "INSERT INTO rental_invoice_line_items " +
        "(id,invoice_id,line_type,description,quantity,unit_price,unit_label,discount_pct,taxable,amount,sort_order) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        liId, invoiceId, li.lineType, li.description,
        li.quantity, li.unitPrice, li.unitLabel,
        li.discountPct, li.taxable, li.amount, sortOrder++,
      );
    }

    const invoice = await prisma.$queryRawUnsafe<any[]>(
      "SELECT * FROM rental_invoices WHERE id = $1", invoiceId
    );

    return NextResponse.json({ invoice: invoice[0], lineItems }, { status: 201 });
  } catch (e: any) {
    console.error('Generate invoice error:', e);
    return NextResponse.json({ error: e.message ?? 'Failed to generate invoice' }, { status: 500 });
  }
}
