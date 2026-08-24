import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const { searchParams } = new URL(req.url);
        const level    = searchParams.get('level');
        const parentId = searchParams.get('parentId');

        let where = `WHERE is_active = true`;
        if (level)    where += ` AND level = '${level}'`;
        if (parentId) where += ` AND parent_id = '${parentId}'`;
        else if (level === 'REGION') where += ` AND parent_id IS NULL`;

        const items = await tx.$queryRawUnsafe(
          `SELECT * FROM customer_hierarchy ${where} ORDER BY name ASC`
        );
        return NextResponse.json(items);
      } catch (e) {
        return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 });
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
        if (!body.name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
        const id  = randomUUID();
        const now = new Date().toISOString();
        await tx.$executeRawUnsafe(`
          INSERT INTO customer_hierarchy (id, created_at, level, parent_id, name, code, description, is_active)
          VALUES (
            '${id}', '${now}', '${body.level}',
            ${body.parentId   ? `'${body.parentId}'`                      : 'NULL'},
            '${body.name.replace(/'/g,"''")}',
            ${body.code        ? `'${body.code.replace(/'/g,"''")}'`      : 'NULL'},
            ${body.description ? `'${body.description.replace(/'/g,"''")}'` : 'NULL'},
            true
          )
        `);
        const rows = await tx.$queryRawUnsafe(`SELECT * FROM customer_hierarchy WHERE id = '${id}'`);
        return NextResponse.json((rows as any[])[0], { status: 201 });
        } catch (e) {
        return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 });
      }
  });
}

