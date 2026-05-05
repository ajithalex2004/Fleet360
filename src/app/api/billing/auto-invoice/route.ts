import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// ---------------------------------------------------------------------------
// Table bootstrap
// ---------------------------------------------------------------------------
async function ensureTables() {
  // billing_runs table
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS billing_runs (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      run_date         DATE NOT NULL,
      status           TEXT DEFAULT 'RUNNING',
      total_tenants    INTEGER DEFAULT 0,
      invoices_created INTEGER DEFAULT 0,
      total_amount     NUMERIC(15,2) DEFAULT 0,
      errors           JSONB DEFAULT '[]',
      completed_at     TIMESTAMPTZ
    )
  `).catch(() => {});

  // Ensure finance_invoices has the extra columns we need
  await prisma.$executeRawUnsafe(`
    ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS tenant_id TEXT
  `).catch(() => {});

  await prisma.$executeRawUnsafe(`
    ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS line_items_json JSONB DEFAULT '[]'
  `).catch(() => {});

  await prisma.$executeRawUnsafe(`
    ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS module_source TEXT
  `).catch(() => {});

  await prisma.$executeRawUnsafe(`
    ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS client_email TEXT
  `).catch(() => {});

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_billing_runs_run_date ON billing_runs(run_date DESC)
  `).catch(() => {});

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_fi_tenant_id ON finance_invoices(tenant_id)
    WHERE tenant_id IS NOT NULL
  `).catch(() => {});
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;

interface Subscription {
  id:                string;
  tenant_id:         string;
  module_code:       string;
  plan_tier:         string;
  billing_cycle:     string;
  base_price:        string | number;
  currency:          string;
  max_vehicles:      string | number;
  max_users:         string | number;
  max_students:      string | number;
  next_billing_date: Date | string;
}

interface LineItem {
  description: string;
  quantity:    number;
  unit_price:  number;
  amount:      number;
}

interface BillingPreview {
  subscription_id: string;
  tenant_id:       string;
  tenant_name:     string;
  module_code:     string;
  invoice_number:  string;
  line_items:      LineItem[];
  subtotal:        number;
  vat_amount:      number;
  total_amount:    number;
  currency:        string;
  billing_cycle:   string;
  next_billing_date: string;
}

// ---------------------------------------------------------------------------
// Invoice number generator: SUB-YYYYMM-XXXX
// ---------------------------------------------------------------------------
async function nextInvoiceNumber(): Promise<string> {
  const ym     = new Date().toISOString().slice(0, 7).replace('-', '');
  const prefix = `SUB-${ym}`;

  type SeqRow = { last_seq: bigint | null };
  const [seqRow] = await prisma.$queryRawUnsafe<SeqRow[]>(
    `SELECT MAX(CAST(SPLIT_PART(invoice_number, '-', 3) AS INTEGER)) AS last_seq
       FROM finance_invoices
      WHERE invoice_number LIKE $1`,
    `${prefix}-%`
  ).catch(() => [{ last_seq: null }]);

  const seq = (Number(seqRow?.last_seq ?? 0) + 1).toString().padStart(4, '0');
  return `${prefix}-${seq}`;
}

// ---------------------------------------------------------------------------
// Core billing logic for a single subscription (returns line items & totals)
// ---------------------------------------------------------------------------
async function computeBilling(sub: Subscription, tenantName: string): Promise<{
  lineItems: LineItem[];
  subtotal:  number;
  vatAmount: number;
  total:     number;
}> {
  const basePrice   = Number(sub.base_price);
  const maxVehicles = Number(sub.max_vehicles);
  const maxUsers    = Number(sub.max_users);
  const maxStudents = Number(sub.max_students);
  const lineItems: LineItem[] = [];

  // 1. Base module license fee
  lineItems.push({
    description: `${sub.module_code} Module License — ${sub.plan_tier} (${sub.billing_cycle})`,
    quantity:    1,
    unit_price:  basePrice,
    amount:      basePrice,
  });

  // 2. Vehicle overage
  type CountRow = { cnt: bigint };
  const [vcRow] = await prisma.$queryRawUnsafe<CountRow[]>(
    `SELECT COUNT(*) AS cnt FROM vehicles WHERE tenant_id = $1 AND deleted_at IS NULL`,
    sub.tenant_id
  ).catch(() => [{ cnt: BigInt(0) }]);

  const vehicleCount   = Number(vcRow?.cnt ?? 0);
  const vehicleOverage = Math.max(0, vehicleCount - maxVehicles);
  if (vehicleOverage > 0) {
    const unitPrice = Math.round(basePrice * 0.02 * 100) / 100;
    lineItems.push({
      description: `Vehicle Overage (${vehicleOverage} vehicles over limit of ${maxVehicles})`,
      quantity:    vehicleOverage,
      unit_price:  unitPrice,
      amount:      Math.round(vehicleOverage * unitPrice * 100) / 100,
    });
  }

  // 3. User overage
  const [ucRow] = await prisma.$queryRawUnsafe<CountRow[]>(
    `SELECT COUNT(*) AS cnt FROM user_tenants WHERE tenant_id = $1 AND is_active = TRUE`,
    sub.tenant_id
  ).catch(() => [{ cnt: BigInt(0) }]);

  const userCount   = Number(ucRow?.cnt ?? 0);
  const userOverage = Math.max(0, userCount - maxUsers);
  if (userOverage > 0) {
    lineItems.push({
      description: `User Overage (${userOverage} users over limit of ${maxUsers})`,
      quantity:    userOverage,
      unit_price:  150,
      amount:      userOverage * 150,
    });
  }

  // 4. Student overage (SCHOOL_BUS only)
  if (sub.module_code === 'SCHOOL_BUS' && maxStudents > 0) {
    const [scRow] = await prisma.$queryRawUnsafe<CountRow[]>(
      `SELECT COUNT(*) AS cnt FROM students WHERE tenant_id = $1 AND deleted_at IS NULL`,
      sub.tenant_id
    ).catch(() => [{ cnt: BigInt(0) }]);

    const studentCount   = Number(scRow?.cnt ?? 0);
    const studentOverage = Math.max(0, studentCount - maxStudents);
    if (studentOverage > 0) {
      lineItems.push({
        description: `Student Overage (${studentOverage} students over limit of ${maxStudents})`,
        quantity:    studentOverage,
        unit_price:  8,
        amount:      studentOverage * 8,
      });
    }
  }

  const subtotal  = lineItems.reduce((sum, li) => sum + li.amount, 0);
  const vatAmount = Math.round(subtotal * 0.05 * 100) / 100;
  const total     = Math.round((subtotal + vatAmount) * 100) / 100;

  return { lineItems, subtotal, vatAmount, total };
}

// ---------------------------------------------------------------------------
// GET /api/billing/auto-invoice
// Returns billing runs list + last run summary
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest) {
  await ensureTables();

  type RunRow = {
    id: string;
    created_at: Date;
    run_date: Date;
    status: string;
    total_tenants: number | bigint;
    invoices_created: number | bigint;
    total_amount: string | number;
    errors: unknown;
    completed_at: Date | null;
  };

  const runs = await prisma.$queryRawUnsafe<RunRow[]>(
    `SELECT * FROM billing_runs ORDER BY created_at DESC LIMIT 20`
  ).catch(() => [] as RunRow[]);

  const serializedRuns = runs.map(r => ({
    ...r,
    total_tenants:    Number(r.total_tenants),
    invoices_created: Number(r.invoices_created),
    total_amount:     Number(r.total_amount),
    run_date:         (r.run_date as Date)?.toISOString?.().split('T')[0] ?? r.run_date,
    created_at:       (r.created_at as Date)?.toISOString?.() ?? r.created_at,
    completed_at:     r.completed_at ? (r.completed_at as Date)?.toISOString?.() ?? r.completed_at : null,
  }));

  const lastRun = serializedRuns[0] ?? null;

  // Pending subscriptions count (due today or overdue, still active)
  type PendingRow = { cnt: bigint };
  const [pendingRow] = await prisma.$queryRawUnsafe<PendingRow[]>(
    `SELECT COUNT(*) AS cnt FROM tenant_module_subscriptions
      WHERE status = 'ACTIVE' AND next_billing_date <= CURRENT_DATE`
  ).catch(() => [{ cnt: BigInt(0) }]);

  return NextResponse.json({
    runs:              serializedRuns,
    last_run:          lastRun,
    pending_to_bill:   Number(pendingRow?.cnt ?? 0),
    total_runs:        serializedRuns.length,
  });
}

// ---------------------------------------------------------------------------
// POST /api/billing/auto-invoice
// action=run_billing  → full billing run (creates invoices)
// action=preview      → dry run, returns what would be billed
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  await ensureTables();

  try {
    const body   = await req.json();
    const action = body.action ?? 'run_billing';

    if (action !== 'run_billing' && action !== 'preview') {
      return NextResponse.json({ error: 'action must be run_billing or preview' }, { status: 400 });
    }

    const today   = new Date().toISOString().split('T')[0];
    const isDryRun = action === 'preview';

    // ── 1. Create billing_run record (only for real runs) ──────────────────
    let runId: string | null = null;

    if (!isDryRun) {
      type RunInsRow = { id: string };
      const [runRow] = await prisma.$queryRawUnsafe<RunInsRow[]>(
        `INSERT INTO billing_runs (run_date, status) VALUES ($1::date, 'RUNNING') RETURNING id`,
        today
      );
      runId = runRow.id;
    }

    // ── 2. Query all due ACTIVE subscriptions ──────────────────────────────
    const subscriptions = await prisma.$queryRawUnsafe<Subscription[]>(
      `SELECT s.*
         FROM tenant_module_subscriptions s
        WHERE s.status = 'ACTIVE'
          AND s.next_billing_date <= CURRENT_DATE
        ORDER BY s.tenant_id, s.module_code`
    ).catch(() => [] as Subscription[]);

    // ── 3. Process each subscription ──────────────────────────────────────
    const previews:     BillingPreview[] = [];
    const errors:       Array<{ subscription_id: string; error: string }> = [];
    let   invoicesCreated = 0;
    let   totalAmount     = 0;
    const tenantsSeen     = new Set<string>();

    for (const sub of subscriptions) {
      try {
        tenantsSeen.add(sub.tenant_id);

        // 3a. Get tenant name
        type TenantRow = { name: string; contact_email: string | null };
        const [tenant] = await prisma.$queryRawUnsafe<TenantRow[]>(
          `SELECT name, contact_email FROM tenants WHERE id = $1`,
          sub.tenant_id
        ).catch(() => [] as TenantRow[]);

        const tenantName  = tenant?.name  ?? `Tenant ${sub.tenant_id}`;
        const tenantEmail = tenant?.contact_email ?? null;

        // 3b. Compute line items
        const { lineItems, subtotal, vatAmount, total } = await computeBilling(sub, tenantName);

        // Next billing date calculation
        const currentNbd = (sub.next_billing_date instanceof Date)
          ? sub.next_billing_date.toISOString().split('T')[0]
          : String(sub.next_billing_date).split('T')[0];

        const nextNbd = sub.billing_cycle === 'ANNUAL'
          ? (() => { const d = new Date(currentNbd); d.setFullYear(d.getFullYear() + 1); return d.toISOString().split('T')[0]; })()
          : (() => { const d = new Date(currentNbd); d.setMonth(d.getMonth() + 1); return d.toISOString().split('T')[0]; })();

        totalAmount += total;

        if (isDryRun) {
          // Preview only — generate a mock invoice number
          const previewNumber = `SUB-${today.slice(0, 7).replace('-', '')}-PREVIEW`;
          previews.push({
            subscription_id:   sub.id,
            tenant_id:         sub.tenant_id,
            tenant_name:       tenantName,
            module_code:       sub.module_code,
            invoice_number:    previewNumber,
            line_items:        lineItems,
            subtotal,
            vat_amount:        vatAmount,
            total_amount:      total,
            currency:          sub.currency,
            billing_cycle:     sub.billing_cycle,
            next_billing_date: nextNbd,
          });
          invoicesCreated++;
          continue;
        }

        // 3c/3d. Generate invoice number and INSERT into finance_invoices
        const invoiceNumber = await nextInvoiceNumber();
        const issueDate     = today;
        const dueDate       = (() => {
          const d = new Date(today);
          d.setDate(d.getDate() + 30);
          return d.toISOString().split('T')[0];
        })();

        await prisma.$executeRawUnsafe(
          `INSERT INTO finance_invoices
             (invoice_number, client_name, client_email, module_source,
              issue_date, due_date,
              subtotal, vat_amount, total_amount,
              payment_status, notes, line_items_json, tenant_id,
              currency, vat_rate, discount_amount, paid_amount,
              service_type, module, line_items)
           VALUES ($1, $2, $3, $4,
                   $5::date, $6::date,
                   $7, $8, $9,
                   'SENT', $10, $11::jsonb, $12,
                   $13, 5, 0, 0,
                   'SUBSCRIPTION', $14, $15::jsonb)`,
          invoiceNumber,
          tenantName,
          tenantEmail,
          sub.module_code,
          issueDate,
          dueDate,
          subtotal,
          vatAmount,
          total,
          `Auto-generated subscription invoice for ${sub.module_code} — ${sub.plan_tier}`,
          JSON.stringify(lineItems),
          sub.tenant_id,
          sub.currency,
          sub.module_code,
          JSON.stringify(lineItems)
        );

        // 3e. Update subscription: next_billing_date + last_billed_date
        await prisma.$executeRawUnsafe(
          `UPDATE tenant_module_subscriptions
              SET next_billing_date = $1::date,
                  last_billed_date  = $2::date,
                  updated_at        = NOW()
            WHERE id = $3`,
          nextNbd, today, sub.id
        );

        invoicesCreated++;

      } catch (subErr) {
        console.error(`[auto-invoice] Sub ${sub.id} failed:`, subErr);
        errors.push({ subscription_id: sub.id, error: String(subErr) });
      }
    }

    // ── 4. Mark billing_run as COMPLETED ──────────────────────────────────
    if (!isDryRun && runId) {
      await prisma.$executeRawUnsafe(
        `UPDATE billing_runs
            SET status           = $1,
                total_tenants    = $2,
                invoices_created = $3,
                total_amount     = $4,
                errors           = $5::jsonb,
                completed_at     = NOW()
          WHERE id = $6`,
        errors.length > 0 ? 'FAILED' : 'COMPLETED',
        tenantsSeen.size,
        invoicesCreated,
        totalAmount,
        JSON.stringify(errors),
        runId
      );
    }

    // ── Response ───────────────────────────────────────────────────────────
    if (isDryRun) {
      return NextResponse.json({
        preview:          true,
        subscriptions_due: subscriptions.length,
        unique_tenants:   tenantsSeen.size,
        invoices_to_create: previews.length,
        total_amount:     Math.round(totalAmount * 100) / 100,
        previews,
      });
    }

    return NextResponse.json({
      success:          true,
      run_id:           runId,
      total_tenants:    tenantsSeen.size,
      invoices_created: invoicesCreated,
      total_amount:     Math.round(totalAmount * 100) / 100,
      errors,
    });

  } catch (err) {
    console.error('[auto-invoice POST]', err);
    return NextResponse.json({ error: 'Billing run failed', detail: String(err) }, { status: 500 });
  }
}
