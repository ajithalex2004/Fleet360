import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * RAC Insurance Documentation API
 * Table: rental_insurance_policies
 *
 * GET  /api/rental/insurance?status=&search=
 * POST /api/rental/insurance  — create new policy (auto-generates policy_no)
 * PATCH /api/rental/insurance — update policy fields / status
 */

async function ensureTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS rental_insurance_policies (
      id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      deleted_at       TIMESTAMPTZ,
      policy_no        TEXT          UNIQUE NOT NULL,
      vehicle_id       TEXT,
      vehicle_no       TEXT          NOT NULL,
      vehicle_name     TEXT,
      insurer          TEXT          NOT NULL,
      policy_type      TEXT          NOT NULL DEFAULT 'COMPREHENSIVE',
      coverage_amount  NUMERIC(15,2),
      excess_amount    NUMERIC(10,2) NOT NULL DEFAULT 0,
      premium_annual   NUMERIC(10,2),
      start_date       DATE          NOT NULL,
      end_date         DATE          NOT NULL,
      status           TEXT          NOT NULL DEFAULT 'ACTIVE',
      document_url     TEXT,
      notes            TEXT
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_rip_status ON rental_insurance_policies(status)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_rip_vehicle_no ON rental_insurance_policies(vehicle_no)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_rip_end_date ON rental_insurance_policies(end_date)
  `);
}

function computeStatus(startDate: string, endDate: string): string {
  const now = new Date();
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (now < start) return 'PENDING';
  if (now > end) return 'EXPIRED';
  const daysLeft = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (daysLeft <= 30) return 'EXPIRING_SOON';
  return 'ACTIVE';
}

export async function GET(req: NextRequest) {
  try {
    await ensureTable();
    const { searchParams } = new URL(req.url);
    const status  = searchParams.get('status')  ?? '';
    const search  = searchParams.get('search')  ?? '';
    const limit   = Math.min(200, Number(searchParams.get('limit') ?? 100));

    const conds: string[] = ['p.deleted_at IS NULL'];
    const params: unknown[] = [];
    let pi = 1;

    if (status && status !== 'ALL') {
      if (status === 'EXPIRING_SOON') {
        conds.push(`p.end_date > NOW() AND p.end_date <= NOW() + INTERVAL '30 days'`);
      } else if (status === 'EXPIRED') {
        conds.push(`p.end_date < NOW()`);
      } else if (status === 'ACTIVE') {
        conds.push(`p.end_date > NOW() + INTERVAL '30 days' AND p.start_date <= NOW()`);
      } else {
        conds.push(`p.status = $${pi++}`);
        params.push(status);
      }
    }

    if (search) {
      conds.push(`(p.vehicle_no ILIKE $${pi} OR p.policy_no ILIKE $${pi} OR p.insurer ILIKE $${pi} OR p.vehicle_name ILIKE $${pi})`);
      params.push(`%${search}%`);
      pi++;
    }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    type PolicyRow = {
      id: string;
      policy_no: string;
      vehicle_id: string | null;
      vehicle_no: string;
      vehicle_name: string | null;
      insurer: string;
      policy_type: string;
      coverage_amount: string | null;
      excess_amount: string;
      premium_annual: string | null;
      start_date: string;
      end_date: string;
      status: string;
      document_url: string | null;
      notes: string | null;
      created_at: string;
      updated_at: string;
      expiry_days_remaining: number;
    };

    const policies = await prisma.$queryRawUnsafe<PolicyRow[]>(
      `SELECT p.*,
              CAST(CEIL(EXTRACT(EPOCH FROM (p.end_date::TIMESTAMPTZ - NOW())) / 86400) AS INT) AS expiry_days_remaining
         FROM rental_insurance_policies p
         ${where}
         ORDER BY p.end_date ASC
         LIMIT $${pi}`,
      ...params, limit
    ).catch(() => [] as PolicyRow[]);

    // KPI Stats
    type StatRow = { total: bigint; active: bigint; expiring_soon: bigint; expired: bigint; cancelled: bigint };
    const [stats] = await prisma.$queryRawUnsafe<StatRow[]>(`
      SELECT
        COUNT(*) FILTER (WHERE deleted_at IS NULL) AS total,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND end_date > NOW() + INTERVAL '30 days' AND start_date <= NOW()) AS active,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND end_date > NOW() AND end_date <= NOW() + INTERVAL '30 days') AS expiring_soon,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND end_date < NOW()) AS expired,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'CANCELLED') AS cancelled
      FROM rental_insurance_policies
    `).catch(() => [{ total: 0n, active: 0n, expiring_soon: 0n, expired: 0n, cancelled: 0n }]);

    type PremiumRow = { total_premium: string | null };
    const [premRow] = await prisma.$queryRawUnsafe<PremiumRow[]>(`
      SELECT SUM(premium_annual) AS total_premium
      FROM rental_insurance_policies
      WHERE deleted_at IS NULL AND end_date > NOW()
    `).catch(() => [{ total_premium: null }]);

    return NextResponse.json({
      policies: policies.map(p => ({
        id: p.id,
        policyNo: p.policy_no,
        vehicleId: p.vehicle_id,
        vehicleNo: p.vehicle_no,
        vehicleName: p.vehicle_name,
        insurer: p.insurer,
        policyType: p.policy_type,
        coverageAmount: p.coverage_amount ? Number(p.coverage_amount) : null,
        excessAmount: Number(p.excess_amount),
        premiumAnnual: p.premium_annual ? Number(p.premium_annual) : null,
        startDate: p.start_date,
        endDate: p.end_date,
        status: p.status,
        documentUrl: p.document_url,
        notes: p.notes,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
        expiryDaysRemaining: p.expiry_days_remaining,
      })),
      stats: {
        total: Number(stats.total),
        active: Number(stats.active),
        expiringSoon: Number(stats.expiring_soon),
        expired: Number(stats.expired),
        cancelled: Number(stats.cancelled),
        totalPremiumAed: premRow.total_premium ? Number(premRow.total_premium) : 0,
      },
    });
  } catch (err) {
    console.error('[insurance GET]', err);
    return NextResponse.json({ error: 'Failed to load insurance policies' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureTable();
    const body = await req.json();
    const {
      vehicleId, vehicleNo, vehicleName, insurer, policyType = 'COMPREHENSIVE',
      coverageAmount, excessAmount = 0, premiumAnnual,
      startDate, endDate, documentUrl, notes,
    } = body;

    if (!vehicleNo?.trim()) return NextResponse.json({ error: 'Vehicle No is required' }, { status: 400 });
    if (!insurer?.trim())   return NextResponse.json({ error: 'Insurer is required' }, { status: 400 });
    if (!startDate)         return NextResponse.json({ error: 'Start date is required' }, { status: 400 });
    if (!endDate)           return NextResponse.json({ error: 'End date is required' }, { status: 400 });

    // Auto-generate policy_no: RIP-YYYYMM-XXXX
    const now = new Date();
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const rand = Math.floor(Math.random() * 9000) + 1000;
    const policyNo = `RIP-${ym}-${rand}`;

    const status = computeStatus(startDate, endDate);

    type NewPolicy = { id: string; policy_no: string };
    const [policy] = await prisma.$queryRawUnsafe<NewPolicy[]>(
      `INSERT INTO rental_insurance_policies
         (policy_no, vehicle_id, vehicle_no, vehicle_name, insurer, policy_type,
          coverage_amount, excess_amount, premium_annual, start_date, end_date, status, document_url, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id, policy_no`,
      policyNo,
      vehicleId || null,
      vehicleNo.trim(),
      vehicleName || null,
      insurer.trim(),
      policyType,
      coverageAmount ? Number(coverageAmount) : null,
      Number(excessAmount),
      premiumAnnual ? Number(premiumAnnual) : null,
      startDate,
      endDate,
      status,
      documentUrl || null,
      notes || null
    );

    return NextResponse.json({ id: policy.id, policyNo: policy.policy_no }, { status: 201 });
  } catch (err) {
    console.error('[insurance POST]', err);
    return NextResponse.json({ error: 'Failed to create insurance policy' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await ensureTable();
    const body = await req.json();
    const { id, ...fields } = body;

    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const colMap: Record<string, string> = {
      vehicleId: 'vehicle_id',
      vehicleNo: 'vehicle_no',
      vehicleName: 'vehicle_name',
      insurer: 'insurer',
      policyType: 'policy_type',
      coverageAmount: 'coverage_amount',
      excessAmount: 'excess_amount',
      premiumAnnual: 'premium_annual',
      startDate: 'start_date',
      endDate: 'end_date',
      status: 'status',
      documentUrl: 'document_url',
      notes: 'notes',
    };

    const setClauses: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [];
    let pi = 1;

    for (const [key, col] of Object.entries(colMap)) {
      if (key in fields) {
        setClauses.push(`${col} = $${pi++}`);
        const val = fields[key];
        params.push(val === '' ? null : val);
      }
    }

    // Recompute status if dates changed
    if (fields.startDate || fields.endDate) {
      type DateRow = { start_date: string; end_date: string };
      const [cur] = await prisma.$queryRawUnsafe<DateRow[]>(
        `SELECT start_date, end_date FROM rental_insurance_policies WHERE id = $1`, id
      );
      if (cur) {
        const newStart = fields.startDate || cur.start_date;
        const newEnd   = fields.endDate   || cur.end_date;
        const newStatus = computeStatus(newStart, newEnd);
        if (!('status' in fields)) {
          setClauses.push(`status = $${pi++}`);
          params.push(newStatus);
        }
      }
    }

    params.push(id);
    await prisma.$executeRawUnsafe(
      `UPDATE rental_insurance_policies SET ${setClauses.join(', ')} WHERE id = $${pi}`,
      ...params
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[insurance PATCH]', err);
    return NextResponse.json({ error: 'Failed to update insurance policy' }, { status: 500 });
  }
}
