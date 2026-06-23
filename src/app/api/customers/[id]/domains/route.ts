import { NextRequest, NextResponse } from 'next/server';
import {
  customerBelongsToTenant,
  ensureCorporateCustomerIdentityTables,
  listCustomerDomains,
  replaceCustomerDomains,
} from '@/lib/corporate-customer-identity';

type Params = { params: Promise<{ id: string }> };

function requestContext(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id') ?? '';
  const userId = req.headers.get('x-user-id') ?? '';
  const role = req.headers.get('x-user-role') ?? '';
  if (!tenantId || !userId) return null;
  return { tenantId, userId, role, isSuperAdmin: role === 'SUPER_ADMIN' };
}

export async function GET(req: NextRequest, { params }: Params) {
  const ctx = requestContext(req);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  await ensureCorporateCustomerIdentityTables();
  if (!(await customerBelongsToTenant(id, ctx.tenantId))) {
    return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
  }
  const domains = await listCustomerDomains(ctx.tenantId, id);
  return NextResponse.json({ customerId: id, domains });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const ctx = requestContext(req);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const domains = Array.isArray(body.domains) ? body.domains : [];
  try {
    const rows = await replaceCustomerDomains({
      tenantId: ctx.tenantId,
      customerId: id,
      domains,
      actorUserId: ctx.userId,
      verificationMethod: body.verificationMethod ?? 'ADMIN',
    });
    return NextResponse.json({ customerId: id, domains: rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save customer domains';
    const status = message.includes('not found') ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
