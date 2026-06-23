import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { requireAdminPermission, resolveTenantBoundary } from '@/lib/admin-policy';
import { recordAdminChange } from '@/lib/admin-change-history';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdminPermission(req, 'edit', 'users');
    if (auth instanceof NextResponse) return auth;

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? '');
    const tenantId = resolveTenantBoundary(auth.ctx, body.tenantId ? String(body.tenantId) : null);
    if (tenantId instanceof NextResponse) return tenantId;

    if (action === 'deactivate') {
      const userIds = Array.isArray(body.userIds)
        ? body.userIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
        : [];
      if (userIds.length === 0) {
        return NextResponse.json({ error: 'userIds are required' }, { status: 400 });
      }

      const scopedIds = auth.ctx.isSuperAdmin
        ? userIds
        : (await prisma.userTenant.findMany({
            where: { tenantId, userId: { in: userIds }, isActive: true },
            select: { userId: true },
          })).map(r => r.userId);

      const result = await prisma.user.updateMany({
        where: { id: { in: scopedIds } },
        data: { isActive: false, updatedAt: new Date() },
      });
      await recordAdminChange({
        req,
        ctx: auth.ctx,
        tenantId,
        entityType: 'User',
        action: 'BULK_DEACTIVATE',
        before: { requestedUserIds: userIds },
        after: { affected: result.count, userIds: scopedIds },
        summary: `Bulk deactivated ${result.count} user(s).`,
      });
      return NextResponse.json({ ok: true, affected: result.count, userIds: scopedIds });
    }

    if (action === 'import') {
      const users = Array.isArray(body.users) ? body.users : [];
      if (users.length === 0) {
        return NextResponse.json({ error: 'users are required' }, { status: 400 });
      }
      if (users.length > 250) {
        return NextResponse.json({ error: 'Import is limited to 250 users per request' }, { status: 400 });
      }

      const roleId = body.roleId ? String(body.roleId) : '';
      if (!roleId) return NextResponse.json({ error: 'roleId is required for import' }, { status: 400 });
      const role = await prisma.role.findFirst({
        where: { id: roleId, OR: [{ tenantId }, { tenantId: null, isSystem: true }] },
        select: { id: true, code: true },
      });
      if (!role) return NextResponse.json({ error: 'Role is not available for this tenant' }, { status: 400 });

      const created: string[] = [];
      const skipped: Array<{ email: string; reason: string }> = [];

      for (const row of users) {
        const email = String(row?.email ?? '').trim().toLowerCase();
        const username = String(row?.username ?? email.split('@')[0] ?? '').trim();
        if (!email || !/.+@.+\..+/.test(email) || !username) {
          skipped.push({ email: email || '(missing)', reason: 'invalid email or username' });
          continue;
        }
        const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { username }] } });
        if (existing) {
          await prisma.userTenant.upsert({
            where: { userId_tenantId: { userId: existing.id, tenantId } },
            create: { userId: existing.id, tenantId, roleId, isActive: true },
            update: { roleId, isActive: true },
          });
          skipped.push({ email, reason: 'existing user linked to tenant' });
          continue;
        }

        const user = await prisma.user.create({
          data: {
            id: randomUUID(),
            username,
            email,
            firstName: String(row?.firstName ?? '').trim() || null,
            lastName: String(row?.lastName ?? '').trim() || null,
            department: String(row?.department ?? '').trim() || null,
            position: String(row?.position ?? '').trim() || null,
            userType: String(row?.userType ?? 'STAFF').trim() || 'STAFF',
            isActive: true,
            updatedAt: new Date(),
          },
        });
        await prisma.userTenant.create({ data: { userId: user.id, tenantId, roleId, isActive: true } });
        created.push(user.id);
      }

      await recordAdminChange({
        req,
        ctx: auth.ctx,
        tenantId,
        entityType: 'User',
        action: 'BULK_IMPORT',
        after: { created, skipped },
        summary: `Imported ${created.length} user(s); ${skipped.length} skipped/linked.`,
      });
      return NextResponse.json({ ok: true, created, skipped });
    }

    return NextResponse.json({ error: 'Unsupported bulk action' }, { status: 400 });
  } catch (e) {
    console.error('[admin/users/bulk] error:', e);
    return NextResponse.json({ error: 'Bulk operation failed' }, { status: 500 });
  }
}
