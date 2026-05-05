/**
 * GET  /api/dispatch/weights           — list all weight configs
 * PUT  /api/dispatch/weights           — upsert a config (admin only)
 * DELETE /api/dispatch/weights?id=X   — remove a custom config
 *
 * Only accessible by Super Admin / Platform Admin.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureDispatchSchema, DEFAULT_WEIGHTS } from '@/lib/dispatch/schema';

type Row = Record<string, unknown>;

function serialize(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date)     { out[k] = v.toISOString(); continue; }
    if (typeof v === 'bigint') { out[k] = Number(v);       continue; }
    if (typeof v === 'object' && v !== null && !(v instanceof Date) && !Array.isArray(v)) {
      out[k] = v; continue;
    }
    out[k] = v;
  }
  return out;
}

export async function GET(req: NextRequest) {
  try {
    await ensureDispatchSchema();

    const sp       = new URL(req.url).searchParams;
    const tenantId = sp.get('tenantId') ?? null;

    const rows = await prisma.$queryRawUnsafe<Row[]>(`
      SELECT * FROM dispatch_weights
      WHERE ($1::text IS NULL OR tenant_id = $1 OR tenant_id IS NULL)
      ORDER BY service_type, priority, tenant_id NULLS FIRST
    `, tenantId);

    // Merge defaults + custom configs into a unified structure
    const configMap: Record<string, Record<string, Row>> = {};

    // Seed with defaults
    for (const [svc, priorities] of Object.entries(DEFAULT_WEIGHTS)) {
      configMap[svc] = {};
      for (const [pri, weights] of Object.entries(priorities)) {
        configMap[svc][pri] = {
          id: null, tenant_id: null, service_type: svc, priority: pri,
          weights,
          max_attempts: 3, driver_response_timeout_min: 6,
          dispatch_radius_km: 10, prefer_same_zone: true,
          cross_zone_allowed: true, allow_preemption: false,
          preemptible_priorities: [],
          is_default: true,
        };
      }
    }

    // Override with DB rows
    for (const row of rows) {
      const svc = String(row.service_type);
      const pri = String(row.priority);
      if (!configMap[svc]) configMap[svc] = {};
      configMap[svc][pri] = { ...serialize(row), is_default: false };
    }

    return NextResponse.json({ data: configMap, defaults: DEFAULT_WEIGHTS });
  } catch (err) {
    console.error('[dispatch/weights GET]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    await ensureDispatchSchema();

    const body = await req.json();
    const {
      tenantId,
      serviceType,
      priority,
      weights,
      maxAttempts = 3,
      driverResponseTimeoutMin = 6,
      dispatchRadiusKm = 10,
      preferSameZone = true,
      crossZoneAllowed = true,
      allowPreemption = false,
      preemptiblePriorities = [],
    } = body;

    if (!serviceType || !priority) {
      return NextResponse.json({ error: 'serviceType and priority are required' }, { status: 400 });
    }

    const [row] = await prisma.$queryRawUnsafe<{ id: string }[]>(`
      INSERT INTO dispatch_weights
        (tenant_id, service_type, priority, weights,
         max_attempts, driver_response_timeout_min,
         dispatch_radius_km, prefer_same_zone, cross_zone_allowed,
         allow_preemption, preemptible_priorities, updated_at)
      VALUES
        ($1, $2, $3, $4::jsonb,
         $5, $6, $7, $8, $9, $10, $11::jsonb, NOW())
      ON CONFLICT (tenant_id, service_type, priority) DO UPDATE SET
        weights                     = EXCLUDED.weights,
        max_attempts                = EXCLUDED.max_attempts,
        driver_response_timeout_min = EXCLUDED.driver_response_timeout_min,
        dispatch_radius_km          = EXCLUDED.dispatch_radius_km,
        prefer_same_zone            = EXCLUDED.prefer_same_zone,
        cross_zone_allowed          = EXCLUDED.cross_zone_allowed,
        allow_preemption            = EXCLUDED.allow_preemption,
        preemptible_priorities      = EXCLUDED.preemptible_priorities,
        updated_at                  = NOW()
      RETURNING id
    `,
      tenantId ?? null,
      serviceType,
      priority,
      JSON.stringify(weights ?? {}),
      maxAttempts,
      driverResponseTimeoutMin,
      dispatchRadiusKm,
      preferSameZone,
      crossZoneAllowed,
      allowPreemption,
      JSON.stringify(preemptiblePriorities),
    );

    return NextResponse.json({ ok: true, id: row?.id });
  } catch (err) {
    console.error('[dispatch/weights PUT]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await ensureDispatchSchema();
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    await prisma.$executeRawUnsafe(`DELETE FROM dispatch_weights WHERE id = $1::uuid`, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[dispatch/weights DELETE]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
