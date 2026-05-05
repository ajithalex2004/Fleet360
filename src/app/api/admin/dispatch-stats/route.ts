/**
 * GET /api/admin/dispatch-stats
 *
 * Admin-level dispatch health metrics.
 *
 * Super Admin: cross-tenant breakdown (all tenants).
 * Tenant Admin: single-tenant view (filtered by session tenant).
 *
 * Query params:
 *   tenantId  — filter to a single tenant (optional; Super Admin cross-tenant if omitted)
 *   days      — look-back window for trend data (default: 7)
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type Row = Record<string, unknown>;
const n = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
const s = (v: unknown) => String(v ?? '');

async function ensureTables() {
  const exec = (sql: string) => prisma.$executeRawUnsafe(sql).catch(() => {});
  await exec(`
    CREATE TABLE IF NOT EXISTS dispatch_jobs (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      service_type TEXT NOT NULL DEFAULT 'PASSENGER',
      priority TEXT NOT NULL DEFAULT 'NORMAL',
      status TEXT NOT NULL DEFAULT 'PENDING',
      assigned_driver_id TEXT,
      assigned_vehicle_id TEXT,
      current_attempt INT NOT NULL DEFAULT 0,
      max_attempts INT NOT NULL DEFAULT 5,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await exec(`
    CREATE TABLE IF NOT EXISTS driver_availability (
      driver_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      status TEXT NOT NULL DEFAULT 'AVAILABLE',
      vehicle_id TEXT,
      zone_id TEXT,
      service_types JSONB NOT NULL DEFAULT '["PASSENGER"]',
      shift_starts_at TIMESTAMPTZ,
      shift_ends_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function GET(req: NextRequest) {
  try {
    await ensureTables();

    const sp       = new URL(req.url).searchParams;
    const tenantId = sp.get('tenantId') ?? '';
    const days     = Math.min(30, Math.max(1, parseInt(sp.get('days') ?? '7')));

    const tenantFilter = tenantId ? `AND dj.tenant_id = '${tenantId.replace(/'/g, "''")}'` : '';
    const daFilter     = tenantId ? `AND da.tenant_id = '${tenantId.replace(/'/g, "''")}'` : '';

    // ── 1. Overall job status breakdown ──────────────────────────────────────
    const statusRows = await prisma.$queryRawUnsafe<Row[]>(`
      SELECT
        status,
        COUNT(*) AS cnt
      FROM dispatch_jobs dj
      WHERE created_at >= NOW() - INTERVAL '${days} days'
        ${tenantFilter}
      GROUP BY status
      ORDER BY cnt DESC
    `).catch(() => [] as Row[]);

    const statusMap: Record<string, number> = {};
    for (const r of statusRows) statusMap[s(r.status)] = n(r.cnt);

    const total      = Object.values(statusMap).reduce((a, b) => a + b, 0);
    const active     = (statusMap['PENDING'] ?? 0) + (statusMap['SEARCHING'] ?? 0) + (statusMap['OFFERED'] ?? 0) + (statusMap['RETRYING'] ?? 0);
    const inProgress = statusMap['IN_PROGRESS'] ?? 0;
    const completed  = statusMap['COMPLETED']   ?? 0;
    const failed     = (statusMap['FAILED'] ?? 0) + (statusMap['ESCALATED'] ?? 0);
    const cancelled  = statusMap['CANCELLED'] ?? 0;
    const acceptanceRate = total > 0 ? Math.round(((completed + inProgress) / total) * 100) : 0;

    // ── 2. Driver pool stats ──────────────────────────────────────────────────
    const driverRows = await prisma.$queryRawUnsafe<Row[]>(`
      SELECT
        status,
        COUNT(*) AS cnt
      FROM driver_availability da
      WHERE 1=1 ${daFilter}
      GROUP BY status
    `).catch(() => [] as Row[]);

    const driverMap: Record<string, number> = {};
    for (const r of driverRows) driverMap[s(r.status)] = n(r.cnt);

    const driversAvailable = driverMap['AVAILABLE'] ?? 0;
    const driversBusy      = driverMap['BUSY']      ?? 0;
    const driversOnBreak   = driverMap['BREAK']     ?? 0;
    const driversOffDuty   = driverMap['OFF_DUTY']  ?? 0;
    const totalDrivers     = driversAvailable + driversBusy + driversOnBreak + driversOffDuty;

    // ── 3. Service type breakdown ─────────────────────────────────────────────
    const svcRows = await prisma.$queryRawUnsafe<Row[]>(`
      SELECT
        service_type,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'COMPLETED')  AS completed,
        COUNT(*) FILTER (WHERE status IN ('FAILED','ESCALATED')) AS failed
      FROM dispatch_jobs dj
      WHERE created_at >= NOW() - INTERVAL '${days} days'
        ${tenantFilter}
      GROUP BY service_type
      ORDER BY total DESC
    `).catch(() => [] as Row[]);

    const serviceBreakdown = svcRows.map(r => ({
      serviceType: s(r.service_type),
      total:       n(r.total),
      completed:   n(r.completed),
      failed:      n(r.failed),
      successRate: n(r.total) > 0 ? Math.round((n(r.completed) / n(r.total)) * 100) : 0,
    }));

    // ── 4. Daily trend (jobs created per day) ────────────────────────────────
    const trendRows = await prisma.$queryRawUnsafe<Row[]>(`
      SELECT
        DATE(created_at AT TIME ZONE 'Asia/Dubai') AS day,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'COMPLETED') AS completed,
        COUNT(*) FILTER (WHERE status IN ('FAILED','ESCALATED')) AS failed
      FROM dispatch_jobs dj
      WHERE created_at >= NOW() - INTERVAL '${days} days'
        ${tenantFilter}
      GROUP BY day
      ORDER BY day ASC
    `).catch(() => [] as Row[]);

    const trend = trendRows.map(r => ({
      day:       s(r.day).split('T')[0],
      total:     n(r.total),
      completed: n(r.completed),
      failed:    n(r.failed),
    }));

    // ── 5. Escalated / failed jobs requiring attention ───────────────────────
    const urgentRows = await prisma.$queryRawUnsafe<Row[]>(`
      SELECT
        id, tenant_id, service_type, priority, status,
        current_attempt, max_attempts,
        created_at, updated_at
      FROM dispatch_jobs dj
      WHERE status IN ('ESCALATED','FAILED')
        AND created_at >= NOW() - INTERVAL '${days} days'
        ${tenantFilter}
      ORDER BY
        CASE priority
          WHEN 'EMERGENCY' THEN 1 WHEN 'P1' THEN 2 WHEN 'P2' THEN 3
          WHEN 'URGENT'    THEN 4 ELSE 5
        END,
        created_at DESC
      LIMIT 20
    `).catch(() => [] as Row[]);

    const urgentJobs = urgentRows.map(r => ({
      id:             s(r.id),
      tenantId:       s(r.tenant_id),
      serviceType:    s(r.service_type),
      priority:       s(r.priority),
      status:         s(r.status),
      currentAttempt: n(r.current_attempt),
      maxAttempts:    n(r.max_attempts),
      createdAt:      s(r.created_at),
      updatedAt:      s(r.updated_at),
    }));

    // ── 6. Cross-tenant breakdown (Super Admin only — when no tenantId filter) ─
    let tenantBreakdown: {
      tenantId: string; tenantName: string;
      total: number; completed: number; failed: number; active: number;
      acceptanceRate: number;
    }[] = [];

    if (!tenantId) {
      const tenantRows = await prisma.$queryRawUnsafe<Row[]>(`
        SELECT
          dj.tenant_id,
          COALESCE(t.name, dj.tenant_id) AS tenant_name,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE dj.status = 'COMPLETED')  AS completed,
          COUNT(*) FILTER (WHERE dj.status IN ('FAILED','ESCALATED')) AS failed,
          COUNT(*) FILTER (WHERE dj.status IN ('PENDING','SEARCHING','OFFERED','RETRYING','IN_PROGRESS')) AS active
        FROM dispatch_jobs dj
        LEFT JOIN "Tenant" t ON t.id = dj.tenant_id
        WHERE dj.created_at >= NOW() - INTERVAL '${days} days'
        GROUP BY dj.tenant_id, t.name
        ORDER BY total DESC
        LIMIT 20
      `).catch(() => [] as Row[]);

      tenantBreakdown = tenantRows.map(r => ({
        tenantId:       s(r.tenant_id),
        tenantName:     s(r.tenant_name),
        total:          n(r.total),
        completed:      n(r.completed),
        failed:         n(r.failed),
        active:         n(r.active),
        acceptanceRate: n(r.total) > 0 ? Math.round((n(r.completed) / n(r.total)) * 100) : 0,
      }));
    }

    // ── 7. Avg response / completion time ────────────────────────────────────
    const [timeRow] = await prisma.$queryRawUnsafe<Row[]>(`
      SELECT
        AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 60) FILTER (WHERE status = 'COMPLETED') AS avg_complete_min,
        AVG(current_attempt) FILTER (WHERE status = 'COMPLETED') AS avg_attempts
      FROM dispatch_jobs dj
      WHERE created_at >= NOW() - INTERVAL '${days} days'
        ${tenantFilter}
    `).catch(() => [{}] as Row[]);

    const avgCompletionMin = Math.round(n(timeRow?.avg_complete_min) * 10) / 10;
    const avgAttempts      = Math.round(n(timeRow?.avg_attempts) * 10) / 10;

    return NextResponse.json({
      period: { days },
      summary: {
        total, active, inProgress, completed, failed, cancelled,
        acceptanceRate,
        avgCompletionMin,
        avgAttempts,
      },
      drivers: {
        total: totalDrivers,
        available: driversAvailable,
        busy: driversBusy,
        onBreak: driversOnBreak,
        offDuty: driversOffDuty,
        utilizationPct: totalDrivers > 0 ? Math.round(((driversBusy + inProgress) / totalDrivers) * 100) : 0,
      },
      serviceBreakdown,
      trend,
      urgentJobs,
      tenantBreakdown,
    });
  } catch (err) {
    console.error('[admin/dispatch-stats GET]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
