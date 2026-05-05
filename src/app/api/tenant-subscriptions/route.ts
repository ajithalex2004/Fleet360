import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// ---------------------------------------------------------------------------
// Table bootstrap
// ---------------------------------------------------------------------------
async function ensureTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS tenant_module_subscriptions (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at        TIMESTAMPTZ DEFAULT NOW(),
      updated_at        TIMESTAMPTZ DEFAULT NOW(),
      tenant_id         TEXT NOT NULL,
      module_code       TEXT NOT NULL,
      plan_tier         TEXT DEFAULT 'STANDARD',
      billing_cycle     TEXT DEFAULT 'MONTHLY',
      base_price        NUMERIC(10,2) NOT NULL,
      currency          TEXT DEFAULT 'AED',
      max_vehicles      INTEGER DEFAULT 50,
      max_users         INTEGER DEFAULT 5,
      max_students      INTEGER DEFAULT 0,
      setup_fee         NUMERIC(10,2) DEFAULT 0,
      setup_fee_paid    BOOLEAN DEFAULT FALSE,
      status            TEXT DEFAULT 'ACTIVE',
      trial_end_date    DATE,
      start_date        DATE NOT NULL,
      next_billing_date DATE NOT NULL,
      last_billed_date  DATE,
      notes             TEXT,
      UNIQUE(tenant_id, module_code)
    )
  `).catch(() => {});

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_tms_tenant_id   ON tenant_module_subscriptions(tenant_id)
  `).catch(() => {});
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_tms_status       ON tenant_module_subscriptions(status)
  `).catch(() => {});
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_tms_next_billing ON tenant_module_subscriptions(next_billing_date)
  `).catch(() => {});
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;

function formatDate(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().split('T')[0];
  return String(v).split('T')[0];
}

// Convert a Buffer (raw UUID bytes from pg) → formatted UUID string
function bufferToUuid(buf: Buffer): string {
  const hex = buf.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

function serialize(row: Row): Row {
  // First pass: convert any Buffer fields (UUID columns returned as bytes) to strings
  const base: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (Buffer.isBuffer(v)) {
      base[k] = (v as Buffer).length === 16 ? bufferToUuid(v as Buffer) : (v as Buffer).toString('hex');
    } else {
      base[k] = v;
    }
  }

  return {
    ...base,
    base_price:        base.base_price  !== undefined ? Number(base.base_price)  : null,
    setup_fee:         base.setup_fee   !== undefined ? Number(base.setup_fee)   : null,
    max_vehicles:      base.max_vehicles !== undefined ? Number(base.max_vehicles) : null,
    max_users:         base.max_users   !== undefined ? Number(base.max_users)   : null,
    max_students:      base.max_students !== undefined ? Number(base.max_students) : null,
    created_at:        (base.created_at as Date)?.toISOString?.() ?? base.created_at,
    updated_at:        (base.updated_at as Date)?.toISOString?.() ?? base.updated_at,
    start_date:        formatDate(base.start_date),
    next_billing_date: formatDate(base.next_billing_date),
    last_billed_date:  formatDate(base.last_billed_date),
    trial_end_date:    formatDate(base.trial_end_date),
  };
}

// Add 1 month to a YYYY-MM-DD string
function addMonth(dateStr: string): string {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().split('T')[0];
}

// Add 1 year to a YYYY-MM-DD string
function addYear(dateStr: string): string {
  const d = new Date(dateStr);
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().split('T')[0];
}

// ---------------------------------------------------------------------------
// GET /api/tenant-subscriptions
// Query params: tenantId, status, moduleCode
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  await ensureTable();

  const { searchParams } = new URL(req.url);
  const tenantId   = searchParams.get('tenantId')   ?? '';
  const status     = searchParams.get('status')     ?? '';
  const moduleCode = searchParams.get('moduleCode') ?? '';

  const conditions: string[] = [];
  const values: unknown[]    = [];

  if (tenantId) {
    values.push(tenantId);
    conditions.push(`s.tenant_id = $${values.length}`);
  }
  if (status) {
    values.push(status);
    conditions.push(`s.status = $${values.length}`);
  }
  if (moduleCode) {
    values.push(moduleCode);
    conditions.push(`s.module_code = $${values.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // Join tenants for context; vehicle/user counts come from live tables
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT
       s.*,
       t.name          AS tenant_name,
       t.code          AS tenant_code,
       t.plan          AS tenant_plan,
       t.contact_email AS tenant_email,
       COALESCE(vc.vehicle_count, 0) AS current_vehicles,
       COALESCE(uc.user_count, 0)    AS current_users
     FROM tenant_module_subscriptions s
     LEFT JOIN tenants t ON t.id = s.tenant_id
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS vehicle_count
       FROM vehicles
       WHERE tenant_id = s.tenant_id AND deleted_at IS NULL
     ) vc ON TRUE
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS user_count
       FROM user_tenants
       WHERE tenant_id = s.tenant_id AND is_active = TRUE
     ) uc ON TRUE
     ${where}
     ORDER BY s.created_at DESC`,
    ...values
  ).catch((err) => { console.error('[tenant-subscriptions GET]', err); return [] as Row[]; });

  // Summary counts by status
  type StatusCount = { status: string; cnt: bigint };
  const summary = await prisma.$queryRawUnsafe<StatusCount[]>(
    `SELECT status, COUNT(*) AS cnt FROM tenant_module_subscriptions GROUP BY status`
  ).catch(() => [] as StatusCount[]);

  const counts: Record<string, number> = {};
  for (const s of summary) counts[s.status] = Number(s.cnt);

  return NextResponse.json({
    data:   rows.map(r => serialize({ ...r, current_vehicles: Number(r.current_vehicles ?? 0), current_users: Number(r.current_users ?? 0) })),
    total:  rows.length,
    counts,
  });
}

// ---------------------------------------------------------------------------
// POST /api/tenant-subscriptions
// Body actions: activate | suspend | cancel | (default = create)
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  await ensureTable();

  try {
    const body = await req.json();
    const { action } = body;

    // ── activate ────────────────────────────────────────────────────────────
    if (action === 'activate') {
      const { id, nextBillingDate } = body;
      if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

      type SubRow = { billing_cycle: string; next_billing_date: string };
      const [existing] = await prisma.$queryRawUnsafe<SubRow[]>(
        `SELECT billing_cycle, next_billing_date FROM tenant_module_subscriptions WHERE id = $1`,
        id
      ).catch(() => [] as SubRow[]);

      if (!existing) return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });

      const today    = new Date().toISOString().split('T')[0];
      const nbd      = nextBillingDate
        ?? (existing.billing_cycle === 'ANNUAL' ? addYear(today) : addMonth(today));

      await prisma.$executeRawUnsafe(
        `UPDATE tenant_module_subscriptions
            SET status = 'ACTIVE', next_billing_date = $1::date, updated_at = NOW()
          WHERE id = $2`,
        nbd, id
      );

      return NextResponse.json({ success: true, action: 'activated', id, next_billing_date: nbd });
    }

    // ── suspend ─────────────────────────────────────────────────────────────
    if (action === 'suspend') {
      const { id } = body;
      if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

      await prisma.$executeRawUnsafe(
        `UPDATE tenant_module_subscriptions
            SET status = 'SUSPENDED', updated_at = NOW()
          WHERE id = $1`,
        id
      );

      return NextResponse.json({ success: true, action: 'suspended', id });
    }

    // ── cancel ──────────────────────────────────────────────────────────────
    if (action === 'cancel') {
      const { id } = body;
      if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

      await prisma.$executeRawUnsafe(
        `UPDATE tenant_module_subscriptions
            SET status = 'CANCELLED', updated_at = NOW()
          WHERE id = $1`,
        id
      );

      return NextResponse.json({ success: true, action: 'cancelled', id });
    }

    // ── create (default) ────────────────────────────────────────────────────
    const {
      tenantId, moduleCode, planTier = 'STANDARD', billingCycle = 'MONTHLY',
      basePrice, currency = 'AED',
      maxVehicles = 50, maxUsers = 5, maxStudents = 0,
      setupFee = 0, setupFeePaid = false,
      status = 'ACTIVE', trialEndDate = null,
      startDate, notes = null,
    } = body;

    if (!tenantId)   return NextResponse.json({ error: 'tenantId is required' },   { status: 400 });
    if (!moduleCode) return NextResponse.json({ error: 'moduleCode is required' }, { status: 400 });
    if (basePrice === undefined || basePrice === null)
      return NextResponse.json({ error: 'basePrice is required' }, { status: 400 });

    const sd  = startDate ?? new Date().toISOString().split('T')[0];
    const nbd = billingCycle === 'ANNUAL' ? addYear(sd) : addMonth(sd);

    type InsRow = { id: string; invoice_number?: string };
    const [row] = await prisma.$queryRawUnsafe<InsRow[]>(
      `INSERT INTO tenant_module_subscriptions
         (tenant_id, module_code, plan_tier, billing_cycle, base_price, currency,
          max_vehicles, max_users, max_students, setup_fee, setup_fee_paid,
          status, trial_end_date, start_date, next_billing_date, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
               $13::date,$14::date,$15::date,$16)
       ON CONFLICT (tenant_id, module_code)
         DO UPDATE SET
           plan_tier         = EXCLUDED.plan_tier,
           billing_cycle     = EXCLUDED.billing_cycle,
           base_price        = EXCLUDED.base_price,
           currency          = EXCLUDED.currency,
           max_vehicles      = EXCLUDED.max_vehicles,
           max_users         = EXCLUDED.max_users,
           max_students      = EXCLUDED.max_students,
           setup_fee         = EXCLUDED.setup_fee,
           setup_fee_paid    = EXCLUDED.setup_fee_paid,
           status            = EXCLUDED.status,
           trial_end_date    = EXCLUDED.trial_end_date,
           start_date        = EXCLUDED.start_date,
           next_billing_date = EXCLUDED.next_billing_date,
           notes             = EXCLUDED.notes,
           updated_at        = NOW()
       RETURNING id`,
      tenantId, moduleCode, planTier, billingCycle, Number(basePrice), currency,
      Number(maxVehicles), Number(maxUsers), Number(maxStudents),
      Number(setupFee), Boolean(setupFeePaid),
      status, trialEndDate, sd, nbd, notes
    );

    return NextResponse.json({ success: true, id: row.id, next_billing_date: nbd }, { status: 201 });

  } catch (err) {
    console.error('[tenant-subscriptions POST]', err);
    return NextResponse.json({ error: 'Failed to process subscription request', detail: String(err) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/tenant-subscriptions
// Update pricing/limits for an existing subscription
// Body: { id, basePrice?, maxVehicles?, maxUsers?, maxStudents?, planTier?, billingCycle?, notes? }
// ---------------------------------------------------------------------------
export async function PATCH(req: NextRequest) {
  await ensureTable();

  try {
    const body = await req.json();
    const { id, basePrice, maxVehicles, maxUsers, maxStudents, planTier, billingCycle, notes } = body;

    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const setClauses: string[] = ['updated_at = NOW()'];
    const values: unknown[]    = [];

    if (basePrice !== undefined) {
      values.push(Number(basePrice));
      setClauses.push(`base_price = $${values.length}`);
    }
    if (maxVehicles !== undefined) {
      values.push(Number(maxVehicles));
      setClauses.push(`max_vehicles = $${values.length}`);
    }
    if (maxUsers !== undefined) {
      values.push(Number(maxUsers));
      setClauses.push(`max_users = $${values.length}`);
    }
    if (maxStudents !== undefined) {
      values.push(Number(maxStudents));
      setClauses.push(`max_students = $${values.length}`);
    }
    if (planTier !== undefined) {
      values.push(planTier);
      setClauses.push(`plan_tier = $${values.length}`);
    }
    if (billingCycle !== undefined) {
      values.push(billingCycle);
      setClauses.push(`billing_cycle = $${values.length}`);
    }
    if (notes !== undefined) {
      values.push(notes);
      setClauses.push(`notes = $${values.length}`);
    }

    if (setClauses.length === 1) {
      return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
    }

    values.push(id);
    const idParam = `$${values.length}`;

    type UpdateRow = { id: string };
    const [updated] = await prisma.$queryRawUnsafe<UpdateRow[]>(
      `UPDATE tenant_module_subscriptions SET ${setClauses.join(', ')} WHERE id = ${idParam} RETURNING id`,
      ...values
    );

    if (!updated) return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });

    return NextResponse.json({ success: true, id: updated.id });

  } catch (err) {
    console.error('[tenant-subscriptions PATCH]', err);
    return NextResponse.json({ error: 'Failed to update subscription', detail: String(err) }, { status: 500 });
  }
}
