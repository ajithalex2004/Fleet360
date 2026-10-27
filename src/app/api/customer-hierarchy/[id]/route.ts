export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(
    { headers: _req.headers, nextUrl: _req.nextUrl },
    { allowPlatformSwitch: true },
  );
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }

  return withTenantRls(prisma, authz.tenantId, async (tx) => {
    try {
      const rows = await tx.$queryRawUnsafe<any[]>(
        `SELECT h.*, p.name as parent_name, p.code as parent_code
         FROM customer_hierarchy h
         LEFT JOIN customer_hierarchy p ON p.id = h.parent_id
         WHERE h.id = $1 AND (h.tenant_id = $2 OR h.tenant_id IS NULL)`,
        params.id,
        authz.tenantId,
      );
      if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json(rows[0]);
    } catch (e) {
      return NextResponse.json({ error: errorMessage(e, 'Failed to fetch node') }, { status: 500 });
    }
  });
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  return handleUpdate(req, props);
}

export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  return handleUpdate(req, props);
}

async function handleUpdate(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(
    { headers: req.headers, nextUrl: req.nextUrl },
    { allowPlatformSwitch: true },
  );
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }

  return withTenantRls(prisma, authz.tenantId, async (tx) => {
    try {
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);

      const sets: string[] = [];
      const vals: any[] = [];
      let idx = 1;

      if (body.name !== undefined) {
        sets.push(`name = $${idx++}`);
        vals.push(String(body.name).trim());
      }
      if (body.code !== undefined) {
        sets.push(`code = $${idx++}`);
        vals.push(body.code ? String(body.code).trim().toUpperCase() : null);
      }
      if (body.description !== undefined) {
        sets.push(`description = $${idx++}`);
        vals.push(body.description ? String(body.description).trim() : null);
      }
      if (body.parentId !== undefined || body.parent_id !== undefined) {
        sets.push(`parent_id = $${idx++}`);
        vals.push(body.parentId || body.parent_id || null);
      }
      if (body.isActive !== undefined || body.is_active !== undefined) {
        sets.push(`is_active = $${idx++}`);
        vals.push(Boolean(body.isActive ?? body.is_active));
      }

      if (sets.length === 0) {
        return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
      }

      vals.push(params.id);
      vals.push(authz.tenantId);
      await tx.$executeRawUnsafe(
        `UPDATE customer_hierarchy SET ${sets.join(', ')} WHERE id = $${idx} AND (tenant_id = $${idx + 1} OR tenant_id IS NULL)`,
        ...vals,
      );

      const rows = await tx.$queryRawUnsafe<any[]>(
        `SELECT h.*, p.name as parent_name, p.code as parent_code
         FROM customer_hierarchy h
         LEFT JOIN customer_hierarchy p ON p.id = h.parent_id
         WHERE h.id = $1 AND (h.tenant_id = $2 OR h.tenant_id IS NULL)`,
        params.id,
        authz.tenantId,
      );

      return NextResponse.json(rows[0]);
    } catch (e) {
      return NextResponse.json({ error: errorMessage(e, 'Failed to update') }, { status: 500 });
    }
  });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(
    { headers: req.headers, nextUrl: req.nextUrl },
    { allowPlatformSwitch: true },
  );
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }

  const hard = req.nextUrl.searchParams.get('hard') === 'true';

  return withTenantRls(prisma, authz.tenantId, async (tx) => {
    try {
      if (hard) {
        // First delete any children to prevent foreign/logical orphan lock
        await tx.$executeRawUnsafe(`DELETE FROM customer_hierarchy WHERE parent_id = $1 AND (tenant_id = $2 OR tenant_id IS NULL)`, params.id, authz.tenantId);
        await tx.$executeRawUnsafe(`DELETE FROM customer_hierarchy WHERE id = $1 AND (tenant_id = $2 OR tenant_id IS NULL)`, params.id, authz.tenantId);
      } else {
        // Soft delete this node and its children
        await tx.$executeRawUnsafe(`UPDATE customer_hierarchy SET is_active = false WHERE (id = $1 OR parent_id = $1) AND (tenant_id = $2 OR tenant_id IS NULL)`, params.id, authz.tenantId);
      }
      return NextResponse.json({ success: true });
    } catch (e) {
      return NextResponse.json({ error: errorMessage(e, 'Failed to delete') }, { status: 500 });
    }
  });
}
