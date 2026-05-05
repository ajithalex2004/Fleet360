import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Bootstrap the settings table (same as in dashboard route)
async function ensureTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS sustainability_settings (
      id                                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id                         TEXT NOT NULL DEFAULT 'default',
      org_name                          TEXT DEFAULT '',
      baseline_year                     INTEGER DEFAULT 2023,
      baseline_routing_improvement      NUMERIC(5,4) DEFAULT 0.20,
      private_car_km_assumption         NUMERIC(6,2) DEFAULT 18.0,
      private_car_ef_kg_per_km          NUMERIC(8,4) DEFAULT 0.1700,
      diesel_ef_kg_per_litre            NUMERIC(8,4) DEFAULT 2.6800,
      petrol_ef_kg_per_litre            NUMERIC(8,4) DEFAULT 2.3100,
      uae_grid_ef_kg_per_kwh            NUMERIC(8,4) DEFAULT 0.4570,
      ev_km_per_kwh                     NUMERIC(6,2) DEFAULT 6.50,
      school_bus_avg_occupancy_target   NUMERIC(5,2) DEFAULT 75.0,
      reporting_currency                TEXT DEFAULT 'AED',
      vat_rate                          NUMERIC(5,4) DEFAULT 0.05,
      created_at                        TIMESTAMPTZ DEFAULT NOW(),
      updated_at                        TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id)
    )
  `).catch(() => {});
}

type Row = Record<string, unknown>;

function serializeRow(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date)     { out[k] = v.toISOString(); continue; }
    if (typeof v === 'bigint') { out[k] = Number(v);       continue; }
    // Numeric columns come back as strings from raw queries — coerce to float
    const numCols = [
      'baseline_routing_improvement', 'private_car_km_assumption',
      'private_car_ef_kg_per_km', 'diesel_ef_kg_per_litre', 'petrol_ef_kg_per_litre',
      'uae_grid_ef_kg_per_kwh', 'ev_km_per_kwh', 'school_bus_avg_occupancy_target',
      'vat_rate', 'baseline_year',
    ];
    if (numCols.includes(k) && v !== null && v !== undefined) {
      out[k] = parseFloat(String(v));
    } else {
      out[k] = v;
    }
  }
  return out;
}

// GET /api/sustainability/settings
export async function GET(req: NextRequest) {
  await ensureTable();

  const { searchParams } = new URL(req.url);
  const tenantId = searchParams.get('tenantId') ?? 'default';

  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT * FROM sustainability_settings WHERE tenant_id = $1`,
    tenantId
  ).catch(() => [] as Row[]);

  if (rows.length === 0) {
    // Return defaults
    return NextResponse.json({
      tenant_id: tenantId,
      baseline_year: 2023,
      baseline_routing_improvement: 0.20,
      private_car_km_assumption: 18.0,
      private_car_ef_kg_per_km: 0.170,
      diesel_ef_kg_per_litre: 2.68,
      petrol_ef_kg_per_litre: 2.31,
      uae_grid_ef_kg_per_kwh: 0.457,
      ev_km_per_kwh: 6.5,
      school_bus_avg_occupancy_target: 75.0,
      reporting_currency: 'AED',
      vat_rate: 0.05,
      org_name: '',
    });
  }

  return NextResponse.json(serializeRow(rows[0]));
}

// POST /api/sustainability/settings — upsert
export async function POST(req: NextRequest) {
  await ensureTable();

  try {
    const body = await req.json();
    const {
      tenant_id = 'default',
      org_name = '',
      baseline_year = 2023,
      baseline_routing_improvement = 0.20,
      private_car_km_assumption = 18.0,
      private_car_ef_kg_per_km = 0.170,
      diesel_ef_kg_per_litre = 2.68,
      petrol_ef_kg_per_litre = 2.31,
      uae_grid_ef_kg_per_kwh = 0.457,
      ev_km_per_kwh = 6.5,
      school_bus_avg_occupancy_target = 75.0,
      reporting_currency = 'AED',
      vat_rate = 0.05,
    } = body;

    await prisma.$executeRawUnsafe(
      `INSERT INTO sustainability_settings
         (tenant_id, org_name, baseline_year, baseline_routing_improvement,
          private_car_km_assumption, private_car_ef_kg_per_km,
          diesel_ef_kg_per_litre, petrol_ef_kg_per_litre,
          uae_grid_ef_kg_per_kwh, ev_km_per_kwh,
          school_bus_avg_occupancy_target, reporting_currency, vat_rate)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (tenant_id) DO UPDATE SET
         org_name                       = EXCLUDED.org_name,
         baseline_year                  = EXCLUDED.baseline_year,
         baseline_routing_improvement   = EXCLUDED.baseline_routing_improvement,
         private_car_km_assumption      = EXCLUDED.private_car_km_assumption,
         private_car_ef_kg_per_km       = EXCLUDED.private_car_ef_kg_per_km,
         diesel_ef_kg_per_litre         = EXCLUDED.diesel_ef_kg_per_litre,
         petrol_ef_kg_per_litre         = EXCLUDED.petrol_ef_kg_per_litre,
         uae_grid_ef_kg_per_kwh         = EXCLUDED.uae_grid_ef_kg_per_kwh,
         ev_km_per_kwh                  = EXCLUDED.ev_km_per_kwh,
         school_bus_avg_occupancy_target= EXCLUDED.school_bus_avg_occupancy_target,
         reporting_currency             = EXCLUDED.reporting_currency,
         vat_rate                       = EXCLUDED.vat_rate,
         updated_at                     = NOW()`,
      tenant_id, org_name,
      Number(baseline_year), Number(baseline_routing_improvement),
      Number(private_car_km_assumption), Number(private_car_ef_kg_per_km),
      Number(diesel_ef_kg_per_litre), Number(petrol_ef_kg_per_litre),
      Number(uae_grid_ef_kg_per_kwh), Number(ev_km_per_kwh),
      Number(school_bus_avg_occupancy_target), reporting_currency, Number(vat_rate)
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[sustainability/settings POST]', err);
    return NextResponse.json({ error: 'Failed to save settings', detail: String(err) }, { status: 500 });
  }
}
