export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withPlatformAdmin } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';

/**
 * GET /api/users/:id — a member of the caller's tenant, non-sensitive fields.
 *
 * Users are global records (no RLS). This route used to read, update (from
 * the raw request body: email, active flag, …) and delete ANY user of ANY
 * tenant for any signed-in caller. Changes to users go through the admin
 * routes (/api/admin/users/:id, role and membership changes under
 * /api/admin/tenants/:id/users), which check the caller's level and revoke
 * affected sessions.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  try {
    const member = await withPlatformAdmin(prisma, (tx) =>
      tx.userTenant.findUnique({
        where: { userId_tenantId: { userId: id, tenantId: authz.tenantId } },
        select: {
          user: { select: { id: true, username: true, email: true, firstName: true, lastName: true, isActive: true, createdAt: true } },
          role: { select: { code: true, name: true } },
        },
      }),
    );
    if (!member) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    return NextResponse.json({ ...member.user, roleCode: member.role.code, roleName: member.role.name });
  } catch (e) {
    console.error('Error fetching user:', e);
    return NextResponse.json({ error: 'Failed to fetch user' }, { status: 500 });
  }
}
