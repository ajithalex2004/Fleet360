export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Customer Portal — the customer's equipment and spare-parts inventory.
 *
 * GET  /api/customer-portal/fsm/assets         → { sites, assets, inventory }
 * POST /api/customer-portal/fsm/assets         (portal ADMIN only)
 *   { kind: 'EQUIPMENT', name, customerSiteId?, serialNumber?, tagId?, manufacturer?, model?, description? }
 *   { kind: 'INVENTORY', name, customerSiteId?, quantity, reorderAt?, unit?, description? }
 * Rows live in the Assets register, tagged to this customer.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireCustomerPortal } from '@/lib/customer-portal/session';
import {
  CustomerContextError, createCustomerAsset, createCustomerInventoryItem,
  listCustomerAssets, listCustomerInventory, listCustomerSites,
} from '@/lib/service-tickets/customer-context';
import { logAudit } from '@/lib/audit';

export async function GET(req: NextRequest) {
  const ctx = await requireCustomerPortal(req, { portal: 'FSM' });
  if (ctx instanceof NextResponse) return ctx;
  const data = await withTenantRls(prisma, ctx.tenantId, async (tx) => {
    const [sites, assets, inventory] = await Promise.all([
      listCustomerSites(tx, ctx.tenantId, ctx.customerId),
      listCustomerAssets(tx, ctx.tenantId, ctx.customerId),
      listCustomerInventory(tx, ctx.tenantId, ctx.customerId),
    ]);
    return { sites, assets, inventory };
  });
  return NextResponse.json({ ok: true, ...data, canEdit: ctx.user.role === 'ADMIN' });
}

export async function POST(req: NextRequest) {
  const ctx = await requireCustomerPortal(req, { portal: 'FSM', roles: ['ADMIN'] });
  if (ctx instanceof NextResponse) return ctx;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  try {
    if (body.kind === 'INVENTORY') {
      const item = await withTenantRls(prisma, ctx.tenantId, (tx) => createCustomerInventoryItem(tx, ctx.tenantId, ctx.customerId, body));
      void logAudit({
        tenantId: ctx.tenantId, userId: ctx.user.id, userRole: 'CUSTOMER_PORTAL', entityType: 'CustomerInventory',
        entityId: item.id, entityName: item.itemNo, action: 'CREATE', details: `Customer added inventory item ${item.name}`,
      });
      return NextResponse.json({ ok: true, item }, { status: 201 });
    }
    const asset = await withTenantRls(prisma, ctx.tenantId, (tx) => createCustomerAsset(tx, ctx.tenantId, ctx.customerId, body));
    void logAudit({
      tenantId: ctx.tenantId, userId: ctx.user.id, userRole: 'CUSTOMER_PORTAL', entityType: 'CustomerAsset',
      entityId: asset.id, entityName: asset.assetNo, action: 'CREATE', details: `Customer registered equipment ${asset.name}`,
    });
    return NextResponse.json({ ok: true, asset }, { status: 201 });
  } catch (err) {
    if (err instanceof CustomerContextError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    throw err;
  }
}
