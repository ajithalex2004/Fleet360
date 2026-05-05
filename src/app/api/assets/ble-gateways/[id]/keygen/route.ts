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

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await ensureAssetsSchema();
    await ensureBleHwSchema();

    const { id } = params;
    const body = await req.json().catch(() => ({}));
    const tenantId = (body as Row).tenant_id ?? 'default';

    // Look up the gateway
    const [gateway] = await query(
      `SELECT id, gateway_code, tenant_id FROM ble_gateways WHERE id = $1 AND tenant_id = $2`,
      id,
      tenantId,
    );

    if (!gateway) {
      return NextResponse.json({ error: 'Gateway not found' }, { status: 404 });
    }

    // Generate key: "bleg_" + 32 random hex bytes
    const rawKey = `bleg_${crypto.randomBytes(32).toString('hex')}`;

    // Hash for storage
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    // First 12 chars of raw key (including "bleg_" prefix) for display
    const keyPrefix = rawKey.slice(0, 12);

    const now = new Date().toISOString();

    await exec(
      `UPDATE ble_gateways
       SET api_key_hash = $1,
           api_key_prefix = $2,
           api_key_created_at = $3,
           updated_at = $3
       WHERE id = $4 AND tenant_id = $5`,
      keyHash,
      keyPrefix,
      now,
      id,
      tenantId,
    );

    return NextResponse.json(
      ser([{
        raw_key: rawKey,
        prefix: keyPrefix,
        created_at: now,
        gateway_code: gateway.gateway_code,
        gateway_id: id,
      }])[0],
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
