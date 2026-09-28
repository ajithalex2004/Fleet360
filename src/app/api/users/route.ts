export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withPlatformAdmin } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';

/**
 * GET /api/users — the members of the caller's tenant (for user pickers).
 *
 * Users are global records (no tenant column, no RLS), so this lists
 * members through user_tenants and returns only non-sensitive fields. It
 * used to return every user of every tenant, and POST created users from
 * the raw request body; users are created by invitation
 * (/api/admin/tenants/:id/invitations) or by a platform administrator
 * (/api/admin/users).
 */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  try {
    const members = await withPlatformAdmin(prisma, (tx) =>
      tx.userTenant.findMany({
        where: { tenantId: authz.tenantId, isActive: true },
        select: {
          user: { select: { id: true, username: true, email: true, firstName: true, lastName: true, isActive: true, createdAt: true } },
          role: { select: { code: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    );
    return NextResponse.json(members.map((m) => ({ ...m.user, roleCode: m.role.code, roleName: m.role.name })));
  } catch (e) {
    console.error('Error fetching users:', e);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}
