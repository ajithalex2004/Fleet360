import { NextRequest, NextResponse } from 'next/server';
import { requireAdminPermission } from '@/lib/admin-policy';
import {
  listAdminApprovalPolicyTemplates,
  updateAdminApprovalPolicyTemplate,
  type ApprovalPolicyTemplate,
  type ApprovalRiskLevel,
} from '@/lib/admin-approval-policy';
import { recordAdminChange } from '@/lib/admin-change-history';

const RISKS = new Set<ApprovalRiskLevel>(['low', 'medium', 'high', 'critical']);

export async function GET(req: NextRequest) {
  const auth = await requireAdminPermission(req, 'view', 'audit');
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ templates: await listAdminApprovalPolicyTemplates() });
}

export async function PUT(req: NextRequest) {
  const auth = await requireAdminPermission(req, 'create', 'audit');
  if (auth instanceof NextResponse) return auth;
  if (!auth.ctx.isSuperAdmin) return NextResponse.json({ error: 'Only super admins can update approval policy templates' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const id = String(body.id ?? '').trim();
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const before = (await listAdminApprovalPolicyTemplates()).find(template => template.id === id);
  if (!before) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

  const risk = RISKS.has(String(body.risk) as ApprovalRiskLevel) ? String(body.risk) as ApprovalRiskLevel : before.risk;
  const next: ApprovalPolicyTemplate = {
    id,
    label: String(body.label ?? before.label).trim() || before.label,
    matchActions: Array.isArray(body.matchActions)
      ? body.matchActions.map(String).map((s: string) => s.trim()).filter(Boolean)
      : before.matchActions,
    risk,
    requiredApprovals: Number(body.requiredApprovals ?? before.requiredApprovals),
    dueHours: Number(body.dueHours ?? before.dueHours),
    escalationHours: Number(body.escalationHours ?? before.escalationHours),
    notificationChannels: Array.isArray(body.notificationChannels)
      ? body.notificationChannels.map(String).map((s: string) => s.trim()).filter(Boolean)
      : before.notificationChannels,
    isEnabled: body.isEnabled !== false,
  };

  const updated = await updateAdminApprovalPolicyTemplate(next);
  if (!updated) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

  await recordAdminChange({
    req,
    ctx: auth.ctx,
    tenantId: null,
    entityType: 'AdminApprovalPolicyTemplate',
    entityId: id,
    entityName: updated.label,
    action: 'UPDATE',
    before,
    after: updated,
    summary: `Updated approval policy template ${updated.label}.`,
  });

  return NextResponse.json({ template: updated });
}
