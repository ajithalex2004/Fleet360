import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureAssetsSchema } from '@/lib/assets/schema';
import { ensureBleHwSchema } from '@/lib/assets/ble-hw-schema';
import crypto from 'crypto';

type Row = Record<string, unknown>;
const query = <T = Row>(sql: string, ...v: unknown[]) =>
  prisma.$queryRawUnsafe<T[]>(sql, ...v).catch(() => [] as T[]);
const exec = (sql: string, ...v: unknown[]) =>
  prisma.$executeRawUnsafe(sql, ...v).catch(() => 0);

function ser(rows: Row[]): Row[] {
  return rows.map(r => {
    const o: Row = {};
    for (const [k, v] of Object.entries(r)) {
      o[k] = v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? Number(v) : v;
    }
    return o;
  });
}

export async function GET(req: NextRequest) {
  try {
    await ensureAssetsSchema();
    await ensureBleHwSchema();

    const sp = req.nextUrl.searchParams;
    const tenantId = sp.get('tenantId') ?? 'default';
    const gatewayId = sp.get('gateway_id');

    const conditions: string[] = ['tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (gatewayId) {
      params.push(gatewayId);
      conditions.push(`gateway_id = $${params.length}`);
    }

    const rows = await query(
      `SELECT * FROM ble_zone_rules WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC`,
      ...params,
    );

    return NextResponse.json({ rules: ser(rows as Row[]) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureAssetsSchema();
    await ensureBleHwSchema();

    const body = await req.json();
    const tenantId = body.tenant_id ?? 'default';

    const {
      gateway_id,
      rule_name,
      allowed_domains,
      allowed_categories,
      severity,
      alert_on_violation,
      notes,
    } = body as {
      gateway_id: string;
      rule_name?: string;
      allowed_domains?: string[];
      allowed_categories?: string[];
      severity?: string;
      alert_on_violation?: boolean;
      notes?: string;
    };

    if (!gateway_id) {
      return NextResponse.json({ error: 'gateway_id is required' }, { status: 400 });
    }

    // Look up gateway to get gateway_code and gateway_zone
    const [gateway] = await query(
      `SELECT gateway_code, location_zone FROM ble_gateways WHERE id::text = $1 AND tenant_id = $2`,
      gateway_id,
      tenantId,
    );

    const gatewayCode = gateway ? (gateway.gateway_code as string) : null;
    const gatewayZone = gateway ? (gateway.location_zone as string | null) : null;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const [row] = await query(
      `INSERT INTO ble_zone_rules (
         id, tenant_id, gateway_id, gateway_code, gateway_zone,
         rule_name, allowed_domains, allowed_categories,
         alert_on_violation, severity, is_active,
         notes, created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE,$11,$12,$12
       ) RETURNING *`,
      id,
      tenantId,
      gateway_id,
      gatewayCode,
      gatewayZone,
      rule_name ?? null,
      allowed_domains ? `{${allowed_domains.map(d => `"${d}"`).join(',')}}` : null,
      allowed_categories ? `{${allowed_categories.map(c => `"${c}"`).join(',')}}` : null,
      alert_on_violation ?? true,
      severity ?? 'MEDIUM',
      notes ?? null,
      now,
    );

    return NextResponse.json(ser([row as Row])[0], { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await ensureAssetsSchema();
    await ensureBleHwSchema();

    const sp = req.nextUrl.searchParams;
    const id = sp.get('id');
    const tenantId = sp.get('tenantId') ?? 'default';

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const [existing] = await query(
      `SELECT id FROM ble_zone_rules WHERE id::text = $1 AND tenant_id = $2`,
      id,
      tenantId,
    );
    if (!existing) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    await exec(
      `DELETE FROM ble_zone_rules WHERE id::text = $1 AND tenant_id = $2`,
      id,
      tenantId,
    );

    return NextResponse.json({ success: true, deleted_id: id });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
