export const dynamic = 'force-dynamic';

import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';

function normalizeSalikAccountRow(r: Record<string, unknown>, fallbackTenantId: string) {
  const createdAtIso = r.created_at ? new Date(String(r.created_at)).toISOString() : null;
  const isActive = r.is_active !== false;
  const tagNumber = String(r.tag_number ?? '');

  return {
    id: String(r.id),
    accountNumber: tagNumber,
    tagNumber,
    vehicleId: (r.vehicle_id as string | null) ?? null,
    balance: r.balance != null ? Number(r.balance) : 0,
    autoRecharge: Boolean(r.auto_recharge ?? false),
    rechargeAmount: r.recharge_amount != null ? Number(r.recharge_amount) : null,
    minBalance: null,
    isActive,
    status: isActive ? 'ACTIVE' : 'INACTIVE',
    lastSyncedAt: null,
    createdAt: createdAtIso,
    updatedAt: createdAtIso,
    tenantId: (r.tenant_id as string | null) ?? fallbackTenantId,
  };
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const rows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT id, created_at, tag_number, vehicle_id, balance,
                auto_recharge, recharge_amount, is_active, tenant_id
           FROM salik_accounts
          WHERE tenant_id = $1
          ORDER BY created_at DESC`,
        tenantId,
      );
      return NextResponse.json(rows.map((r) => normalizeSalikAccountRow(r, tenantId)));
    } catch (e) {
      console.error('Error fetching Salik accounts:', e);
      return NextResponse.json({ error: 'Failed to fetch Salik accounts' }, { status: 500 });
    }
  });
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);

      const tagNumber = String(
        body.tagNumber ?? body.tag_number ?? body.accountNumber ?? '',
      ).trim();
      if (!tagNumber) {
        return NextResponse.json({ error: 'tagNumber is required' }, { status: 400 });
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const vehicleId = body.vehicleId ?? body.vehicle_id ?? null;
      const balance = body.balance != null ? Number(body.balance) : 0;
      const autoRecharge = Boolean(body.autoRecharge ?? body.auto_recharge ?? false);
      const rechargeAmount =
        body.rechargeAmount != null
          ? Number(body.rechargeAmount)
          : body.recharge_amount != null
            ? Number(body.recharge_amount)
            : null;
      const isActive =
        body.isActive != null
          ? Boolean(body.isActive)
          : body.is_active != null
            ? Boolean(body.is_active)
            : body.status
              ? String(body.status).toUpperCase() !== 'INACTIVE'
              : true;

      const inserted = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
        `INSERT INTO salik_accounts
           (tenant_id, id, created_at, tag_number, vehicle_id, balance,
            auto_recharge, recharge_amount, is_active)
         VALUES
           ($1, $2, $3::timestamptz, $4, $5, $6, $7, $8, $9)
         RETURNING id, created_at, tag_number, vehicle_id, balance,
                   auto_recharge, recharge_amount, is_active, tenant_id`,
        tenantId,
        id,
        now,
        tagNumber,
        vehicleId,
        balance,
        autoRecharge,
        rechargeAmount,
        isActive,
      );

      return NextResponse.json(
        normalizeSalikAccountRow(
          inserted[0] ?? {
            id,
            created_at: now,
            tag_number: tagNumber,
            vehicle_id: vehicleId,
            balance,
            auto_recharge: autoRecharge,
            recharge_amount: rechargeAmount,
            is_active: isActive,
            tenant_id: tenantId,
          },
          tenantId,
        ),
        { status: 201 },
      );
    } catch (e) {
      console.error('Error creating Salik account:', e);
      return NextResponse.json({ error: 'Failed to create Salik account' }, { status: 500 });
    }
  });
}
