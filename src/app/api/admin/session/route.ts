import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId   = searchParams.get('userId');
    const tenantId = searchParams.get('tenantId');
    if (!userId || !tenantId) return NextResponse.json({ error: 'userId and tenantId required' }, { status: 400 });

    // Get user
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    // Get user-tenant assignment with role
    const userTenant = await prisma.userTenant.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
        tenant: { include: { modules: { where: { isEnabled: true } } } },
      },
    });
    if (!userTenant || !userTenant.isActive) {
      return NextResponse.json({ error: 'User has no active access to this tenant' }, { status: 403 });
    }

    // Build permission strings
    const permStrings: string[] = userTenant.role.permissions.map(rp =>
      `${rp.permission.module}:${rp.permission.action}:${rp.permission.resource ?? '*'}`
    );

    // SUPER_ADMIN gets wildcard
    if (userTenant.role.code === 'SUPER_ADMIN') permStrings.push('*:*:*');

    return NextResponse.json(
      {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          roleCode: userTenant.role.code,
          roleName: userTenant.role.name,
        },
        tenant: {
          id: userTenant.tenant.id,
          name: userTenant.tenant.name,
          code: userTenant.tenant.code,
          plan: userTenant.tenant.plan,
          enabledModules: userTenant.tenant.modules.map(m => m.module),
        },
        permissions: [...new Set(permStrings)],
      },
      {
        headers: {
          // Browser caches session for 60 s and serves stale for 120 s while revalidating.
          // Private so CDNs don't share user-specific permission sets across accounts.
          'Cache-Control': 'private, max-age=60, stale-while-revalidate=120',
        },
      }
    );
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
