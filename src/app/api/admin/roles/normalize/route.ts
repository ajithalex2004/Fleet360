import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminPermission, requireDangerApproval } from '@/lib/admin-policy';
import { recordAdminChange } from '@/lib/admin-change-history';
import {
  CANONICAL_ROLES,
  canonicalRoleCode,
  normalizeCanonicalRoles,
} from '@/lib/role-canonicalization';

async function getRoleNormalizationPreview() {
  const roles = await prisma.role.findMany({
    select: {
      id: true,
      tenantId: true,
      code: true,
      name: true,
      isSystem: true,
      description: true,
      _count: { select: { userTenants: true, permissions: true } },
    },
    orderBy: [{ tenantId: 'asc' }, { code: 'asc' }, { name: 'asc' }],
  });

  const groups = new Map<string, {
    tenantId: string | null;
    canonicalCode: keyof typeof CANONICAL_ROLES;
    canonicalName: string;
    roles: typeof roles;
    issues: string[];
  }>();

  for (const role of roles) {
    const canonicalCode = canonicalRoleCode(role);
    if (!canonicalCode) continue;
    const canonical = CANONICAL_ROLES[canonicalCode];
    const key = `${role.tenantId ?? 'platform'}:${canonicalCode}`;
    const group = groups.get(key) ?? {
      tenantId: role.tenantId,
      canonicalCode,
      canonicalName: canonical.name,
      roles: [],
      issues: [],
    };
    group.roles.push(role);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    if (group.roles.length > 1) group.issues.push('duplicate-alias-roles');
    for (const role of group.roles) {
      if (role.code !== group.canonicalCode) group.issues.push('misaligned-code');
      if (role.name !== group.canonicalName) group.issues.push('misaligned-name');
      if (role.isSystem !== true) group.issues.push('missing-system-flag');
    }
    group.issues = [...new Set(group.issues)];
  }

  return [...groups.values()].filter(group => group.issues.length > 0);
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdminPermission(req, 'view', 'roles');
    if (auth instanceof NextResponse) return auth;
    if (!auth.ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const preview = await getRoleNormalizationPreview();
    return NextResponse.json({
      canonicalRoles: CANONICAL_ROLES,
      pendingFixes: preview.length,
      preview,
    });
  } catch (error: any) {
    console.error('GET /api/admin/roles/normalize error:', error);
    return NextResponse.json({ error: error?.message ?? 'Failed to preview role cleanup' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdminPermission(req, 'edit', 'roles');
    if (auth instanceof NextResponse) return auth;
    if (!auth.ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const preview = await getRoleNormalizationPreview();
    const approval = await requireDangerApproval(req, auth.ctx, 'roles.normalize-seed-data', {
      tenantId: null,
      targetType: 'Role',
      targetId: 'canonical-system-roles',
      summary: `Normalize ${preview.length} duplicate or misaligned system role group(s).`,
      payload: { preview },
      requiredApprovals: 2,
    });
    if (approval) return approval;

    const result = await prisma.$transaction(tx => normalizeCanonicalRoles(tx));
    await recordAdminChange({
      req,
      ctx: auth.ctx,
      tenantId: null,
      entityType: 'Role',
      entityId: 'canonical-system-roles',
      action: 'UPDATE',
      before: { preview },
      after: result,
      summary: `Normalized role seed data: ${result.updated} updated, ${result.merged} merged.`,
    });

    return NextResponse.json({ success: true, result });
  } catch (error: any) {
    console.error('POST /api/admin/roles/normalize error:', error);
    return NextResponse.json({ error: error?.message ?? 'Failed to normalize role seed data' }, { status: 500 });
  }
}

