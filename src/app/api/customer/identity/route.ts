import { NextRequest, NextResponse } from 'next/server';
import { customerContextForUser, type CustomerPortalRole } from '@/lib/corporate-customer-identity';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id') ?? '';
  const userId = req.headers.get('x-user-id') ?? '';
  if (!tenantId || !userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sessionCustomerId = req.headers.get('x-customer-id');
  const sessionCustomerRole = req.headers.get('x-customer-role');
  let context = await customerContextForUser(tenantId, userId);

  if (!context && sessionCustomerId) {
    const rows = await prisma.$queryRawUnsafe<Array<{
      customer_id: string;
      customer_name: string;
      domain: string | null;
    }>>(
      `SELECT c.id::text AS customer_id, c.name_en AS customer_name, MIN(cd.domain) AS domain
         FROM customers c
         LEFT JOIN customer_domains cd
           ON cd.tenant_id = c.tenant_id::text AND cd.customer_id = c.id::text AND cd.is_verified = TRUE
        WHERE c.id::text = $1
          AND c.tenant_id::text = $2
          AND c.deleted_at IS NULL
        GROUP BY c.id, c.name_en
        LIMIT 1`,
      sessionCustomerId,
      tenantId,
    ).catch(() => []);
    const row = rows[0];
    if (row) {
      context = {
        tenantId,
        customerId: row.customer_id,
        customerName: row.customer_name,
        domain: row.domain ?? '',
        role: (sessionCustomerRole ?? 'CUSTOMER_USER') as CustomerPortalRole,
      };
    }
  }

  if (!context) {
    return NextResponse.json({ ok: true, customer: null });
  }

  return NextResponse.json({ ok: true, customer: context });
}
