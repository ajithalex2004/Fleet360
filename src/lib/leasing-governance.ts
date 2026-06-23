import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  ensureOperationalTenantColumn,
  tenantScopedIds,
  type OperationalContext,
} from '@/lib/cross-module-governance';

export async function ensureLeaseContractTenantColumn() {
  await ensureOperationalTenantColumn('lease_contracts_v2');
}

export async function leaseContractIdsForTenant(tenantId: string, options: { activeOnly?: boolean } = { activeOnly: true }) {
  await ensureLeaseContractTenantColumn();
  return tenantScopedIds('lease_contracts_v2', tenantId, options);
}

export async function requireLeaseContractInTenant(id: string, ctx: OperationalContext) {
  await ensureLeaseContractTenantColumn();
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id::text AS id
       FROM lease_contracts_v2
      WHERE id::text = $1
        AND tenant_id::text = $2
        AND deleted_at IS NULL
      LIMIT 1`,
    id,
    ctx.tenantId,
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return null;
}
