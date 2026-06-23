import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ALL_PERMISSIONS, SYSTEM_ROLES } from '@/lib/permissions';
import { requireAdminPermission, requireDangerApproval } from '@/lib/admin-policy';
import { recordAdminChange } from '@/lib/admin-change-history';
import { normalizeCanonicalRoles } from '@/lib/role-canonicalization';

// ── GET: quick DB health check ────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdminPermission(req, 'view', 'platform');
    if (auth instanceof NextResponse) return auth;

    await prisma.$queryRaw`SELECT 1`;
    const permCount  = await prisma.permission.count();
    const roleCount  = await prisma.role.count();
    return NextResponse.json({ db: 'ok', permissions: permCount, roles: roleCount });
  } catch (e) {
    return NextResponse.json({ db: 'error', error: String(e) }, { status: 500 });
  }
}

// ── POST: seed permissions + system roles ────────────────────────────────────
export async function POST(_req: NextRequest) {
  try {
    const req = _req;
    const auth = await requireAdminPermission(req, 'edit', 'platform');
    if (auth instanceof NextResponse) return auth;
    const approval = await requireDangerApproval(req, auth.ctx, 'seed.permissions', {
      targetType: 'Seed',
      targetId: 'permissions',
      summary: 'Seed admin permissions.',
    });
    if (approval) return approval;

    // ── 1. All permissions in ONE SQL query (INSERT … ON CONFLICT DO UPDATE) ──
    // This is a single round-trip, no connection-pool pressure, no transactions.
    const permValues = ALL_PERMISSIONS.map(p =>
      Prisma.sql`(gen_random_uuid()::text, ${p.module}::text, ${p.action}::text, ${p.resource ?? '*'}::text, ${p.label}::text)`
    );

    await prisma.$executeRaw`
      INSERT INTO permissions (id, module, action, resource, label)
      VALUES ${Prisma.join(permValues)}
      ON CONFLICT (module, action, resource)
      DO UPDATE SET label = EXCLUDED.label
    `;

    // ── 2. Load all permissions into an in-memory map (1 query) ──────────────
    const allPerms = await prisma.permission.findMany({
      select: { id: true, module: true, action: true, resource: true },
    });
    const permMap = new Map<string, string>(
      allPerms.map(p => [`${p.module}:${p.action}:${p.resource ?? '*'}`, p.id])
    );

    // ── 3. Upsert each system role + its permissions (sequential, no txns) ────
    for (const sr of SYSTEM_ROLES) {
      // Find-or-create the platform-wide role (tenantId IS NULL)
      let role = await prisma.role.findFirst({
        where: { code: sr.code, tenantId: null },
      });
      if (!role) {
        role = await prisma.role.create({
          data: {
            name:        sr.name,
            code:        sr.code,
            description: sr.description,
            isSystem:    true,
            tenantId:    null,
          },
        });
      } else {
        await prisma.role.update({
          where: { id: role.id },
          data:  { name: sr.name, description: sr.description },
        });
      }

      // Deduplicate + resolve permission ids
      const permIds = [
        ...new Set(
          sr.permissions
            .map(p => permMap.get(`${p.module}:${p.action}:${p.resource ?? '*'}`))
            .filter((id): id is string => Boolean(id))
        ),
      ];

      // Replace role permissions: delete first, then bulk-insert (no transaction)
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });

      if (permIds.length > 0) {
        await prisma.rolePermission.createMany({
          data: permIds.map(permissionId => ({ roleId: role!.id, permissionId })),
          skipDuplicates: true,
        });
      }
    }

    // ── 4. Return final counts ────────────────────────────────────────────────
    const roleNormalization = await normalizeCanonicalRoles();

    const [permCount, roleCount] = await Promise.all([
      prisma.permission.count(),
      prisma.role.count(),
    ]);

    await recordAdminChange({
      req,
      ctx: auth.ctx,
      tenantId: null,
      entityType: 'Seed',
      entityId: 'permissions',
      action: 'UPDATE',
      after: { permissions: permCount, roles: roleCount, roleNormalization },
      summary: `Seeded permissions and system roles (${permCount} permissions, ${roleCount} roles).`,
    });
    return NextResponse.json({ success: true, permissions: permCount, roles: roleCount, roleNormalization });
  } catch (e) {
    console.error('[SEED ERROR]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
