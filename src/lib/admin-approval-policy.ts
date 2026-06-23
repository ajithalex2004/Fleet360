import { prisma } from '@/lib/prisma';

export type ApprovalRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface ApprovalPolicyTemplate {
  id: string;
  label: string;
  matchActions: string[];
  risk: ApprovalRiskLevel;
  requiredApprovals: number;
  dueHours: number;
  escalationHours: number;
  notificationChannels: string[];
  isEnabled: boolean;
}

export interface ApprovalPolicySnapshot {
  template: string;
  templateLabel: string;
  risk: ApprovalRiskLevel;
  requiredApprovals: number;
  impact: string[];
  payloadKeys: string[];
  payloadPreview: string | null;
  beforeAfter: {
    before: unknown | null;
    after: unknown | null;
    summary: string[];
  };
  quorum: {
    mode: 'distinct_non_requester';
    requiredApprovals: number;
    requesterCanVote: false;
    conflictChecks: string[];
  };
  conflicts: Array<{
    code: string;
    severity: 'info' | 'warning' | 'blocker';
    message: string;
  }>;
  sla: {
    dueHours: number;
    escalationHours: number;
    dueAt: string;
    escalationAt: string;
    status: 'on_track' | 'due_soon' | 'overdue' | 'escalated';
  };
}

function clampRequiredApprovals(value: unknown, policyMinimum: number) {
  const parsed = Number(value ?? policyMinimum);
  const requested = Number.isFinite(parsed) ? Math.floor(parsed) : policyMinimum;
  return Math.max(policyMinimum, Math.min(requested, 10));
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safePreview(value: unknown) {
  if (value == null) return null;
  try {
    return JSON.stringify(value, null, 2).slice(0, 4000);
  } catch {
    return '[Unserializable approval payload]';
  }
}

function summarizeBeforeAfter(before: unknown, after: unknown) {
  const beforeObj = readObject(before);
  const afterObj = readObject(after);
  if (!beforeObj || !afterObj) return [];

  const keys = Array.from(new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)])).slice(0, 12);
  return keys
    .filter(key => JSON.stringify(beforeObj[key]) !== JSON.stringify(afterObj[key]))
    .map(key => `${key}: ${JSON.stringify(beforeObj[key]) ?? 'null'} -> ${JSON.stringify(afterObj[key]) ?? 'null'}`);
}

export const DEFAULT_APPROVAL_POLICY_TEMPLATES: ApprovalPolicyTemplate[] = [
  {
    id: 'workflow-create',
    label: 'Workflow Creation',
    matchActions: ['workflow.create'],
    risk: 'medium',
    requiredApprovals: 1,
    dueHours: 24,
    escalationHours: 12,
    notificationChannels: ['in_app'],
    isEnabled: true,
  },
  {
    id: 'workflow-change',
    label: 'Workflow Change',
    matchActions: ['workflow.'],
    risk: 'medium',
    requiredApprovals: 1,
    dueHours: 24,
    escalationHours: 12,
    notificationChannels: ['in_app'],
    isEnabled: true,
  },
  {
    id: 'service-config-rules-change',
    label: 'Service Config Rules Change',
    matchActions: ['service_config.rules.update', 'service_config.rules.reset_override', 'service_config.rules.rollback'],
    risk: 'medium',
    requiredApprovals: 1,
    dueHours: 24,
    escalationHours: 12,
    notificationChannels: ['in_app'],
    isEnabled: true,
  },
  {
    id: 'logistics-compliance-override',
    label: 'Logistics Compliance Override',
    matchActions: ['logistics.compliance_override.'],
    risk: 'high',
    requiredApprovals: 1,
    dueHours: 4,
    escalationHours: 2,
    notificationChannels: ['in_app'],
    isEnabled: true,
  },
  {
    id: 'critical-change',
    label: 'Critical Change',
    matchActions: ['delete', 'revoke', 'seed', 'migration'],
    risk: 'critical',
    requiredApprovals: 2,
    dueHours: 4,
    escalationHours: 2,
    notificationChannels: ['in_app', 'email'],
    isEnabled: true,
  },
  {
    id: 'high-risk-admin-change',
    label: 'High Risk Admin Change',
    matchActions: ['billing', 'sso', 'api_key', 'system', 'platform', 'danger'],
    risk: 'high',
    requiredApprovals: 2,
    dueHours: 8,
    escalationHours: 4,
    notificationChannels: ['in_app', 'email'],
    isEnabled: true,
  },
  {
    id: 'guarded-admin-change',
    label: 'Guarded Admin Change',
    matchActions: ['role', 'permission', 'mfa', 'service_config', 'workflow'],
    risk: 'medium',
    requiredApprovals: 2,
    dueHours: 24,
    escalationHours: 12,
    notificationChannels: ['in_app'],
    isEnabled: true,
  },
  {
    id: 'standard-admin-change',
    label: 'Standard Admin Change',
    matchActions: ['*'],
    risk: 'low',
    requiredApprovals: 2,
    dueHours: 48,
    escalationHours: 24,
    notificationChannels: ['in_app'],
    isEnabled: true,
  },
];

function templateById(id: string): ApprovalPolicyTemplate {
  return DEFAULT_APPROVAL_POLICY_TEMPLATES.find(template => template.id === id)
    ?? DEFAULT_APPROVAL_POLICY_TEMPLATES[DEFAULT_APPROVAL_POLICY_TEMPLATES.length - 1];
}

function defaultTemplateForAction(action: string): ApprovalPolicyTemplate {
  const lower = action.toLowerCase();
  if (lower.includes('workflow.')) {
    return templateById('workflow-change');
  }
  if (lower.includes('logistics.compliance_override.')) {
    return templateById('logistics-compliance-override');
  }
  if (lower.includes('delete') || lower.includes('revoke') || lower.includes('seed') || lower.includes('migration')) {
    return templateById('critical-change');
  }
  if (lower.includes('billing') || lower.includes('sso') || lower.includes('api_key') || lower.includes('system') || lower.includes('platform') || lower.includes('danger')) {
    return templateById('high-risk-admin-change');
  }
  if (lower.includes('service_config.rules.')) {
    return templateById('service-config-rules-change');
  }
  if (lower.includes('role') || lower.includes('permission') || lower.includes('mfa') || lower.includes('service_config') || lower.includes('workflow')) {
    return templateById('guarded-admin-change');
  }
  return templateById('standard-admin-change');
}

function computeSlaStatus(now: Date, dueAt: Date, escalationAt: Date): ApprovalPolicySnapshot['sla']['status'] {
  if (now >= dueAt) return 'overdue';
  if (now >= escalationAt) return 'escalated';
  if (dueAt.getTime() - now.getTime() <= 60 * 60 * 1000) return 'due_soon';
  return 'on_track';
}

export function buildAdminApprovalPolicy(args: {
  action: string;
  template?: ApprovalPolicyTemplate | null;
  tenantId?: string | null;
  impersonatedBy?: string | null;
  payload?: unknown;
  requiredApprovals?: number;
  createdAt?: string | Date | null;
  dueAt?: string | Date | null;
  escalationAt?: string | Date | null;
}): ApprovalPolicySnapshot {
  const action = String(args.action ?? '');
  const lower = action.toLowerCase();
  const base = args.template ?? defaultTemplateForAction(action);
  const requiredApprovals = clampRequiredApprovals(args.requiredApprovals, base.requiredApprovals);
  const createdAt = args.createdAt ? new Date(args.createdAt) : new Date();
  const dueAt = args.dueAt ? new Date(args.dueAt) : new Date(createdAt.getTime() + base.dueHours * 60 * 60 * 1000);
  const escalationAt = args.escalationAt ? new Date(args.escalationAt) : new Date(createdAt.getTime() + base.escalationHours * 60 * 60 * 1000);
  const now = new Date();
  const payload = args.payload;
  const payloadObj = readObject(payload);
  const before = payloadObj && 'before' in payloadObj ? payloadObj.before : null;
  const after = payloadObj && 'after' in payloadObj ? payloadObj.after : null;
  const preview = payloadObj ? readObject(payloadObj.preview) : null;
  const affectedUsers = preview && Number.isFinite(Number(preview.affectedUsers)) ? Number(preview.affectedUsers) : 0;

  const impact: string[] = [args.tenantId ? 'Tenant scoped' : 'Platform scoped'];
  if (args.impersonatedBy) impact.push('Impersonated request');
  if (lower.includes('billing')) impact.push('Billing/entitlements');
  if (lower.includes('role') || lower.includes('permission')) impact.push('Access control');
  if (lower.includes('service_config')) impact.push('Service behavior');
  if (lower.includes('workflow')) impact.push('Workflow behavior');
  if (lower.includes('mfa') || lower.includes('sso')) impact.push('Identity/security');
  if (lower.includes('logistics')) impact.push('Logistics operations');
  if (lower.includes('compliance_override')) impact.push('Compliance override');
  if (lower.includes('api_key')) impact.push('External access');
  if (lower.includes('delete') || lower.includes('revoke')) impact.push('Destructive');
  if (lower.includes('danger')) impact.push('Dangerous change');
  if (before !== null || after !== null) impact.push('Before/after captured');

  return {
    template: base.id,
    templateLabel: base.label,
    risk: base.risk,
    requiredApprovals,
    impact,
    payloadKeys: payloadObj ? Object.keys(payloadObj).slice(0, 12) : [],
    payloadPreview: safePreview(payload),
    beforeAfter: {
      before,
      after,
      summary: summarizeBeforeAfter(before, after),
    },
    quorum: {
      mode: 'distinct_non_requester',
      requiredApprovals,
      requesterCanVote: false,
      conflictChecks: [
        'requester_cannot_approve',
        'tenant_boundary_enforced',
        'one_vote_per_actor',
        'closed_requests_are_immutable',
      ],
    },
    conflicts: [
      ...(affectedUsers > 0 ? [{
        code: 'affected_users',
        severity: affectedUsers > 25 ? 'warning' as const : 'info' as const,
        message: `${affectedUsers} active user${affectedUsers === 1 ? '' : 's'} may be affected by this change.`,
      }] : []),
      ...(before === null && after === null ? [{
        code: 'missing_before_after',
        severity: base.risk === 'critical' || base.risk === 'high' ? 'warning' as const : 'info' as const,
        message: 'No structured before/after payload was captured for reviewer comparison.',
      }] : []),
    ],
    sla: {
      dueHours: base.dueHours,
      escalationHours: base.escalationHours,
      dueAt: dueAt.toISOString(),
      escalationAt: escalationAt.toISOString(),
      status: computeSlaStatus(now, dueAt, escalationAt),
    },
  };
}

function safeJson(value: unknown) {
  return JSON.stringify(value, (_key, nested) => typeof nested === 'bigint' ? Number(nested) : nested);
}

function normalizeTemplate(row: Record<string, unknown>): ApprovalPolicyTemplate {
  return {
    id: String(row.id),
    label: String(row.label),
    matchActions: Array.isArray(row.match_actions) ? row.match_actions.map(String) : [],
    risk: String(row.risk_level ?? 'low') as ApprovalRiskLevel,
    requiredApprovals: clampRequiredApprovals(row.required_approvals, 1),
    dueHours: Math.max(1, Math.min(Number(row.due_hours ?? 48), 720)),
    escalationHours: Math.max(1, Math.min(Number(row.escalation_hours ?? 24), 720)),
    notificationChannels: Array.isArray(row.notification_channels) ? row.notification_channels.map(String) : ['in_app'],
    isEnabled: row.is_enabled !== false,
  };
}

export async function ensureAdminApprovalPolicyTemplateTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS admin_approval_policy_templates (
      id                    TEXT PRIMARY KEY,
      label                 TEXT NOT NULL,
      match_actions         JSONB NOT NULL DEFAULT '[]'::jsonb,
      risk_level            TEXT NOT NULL,
      required_approvals    INTEGER NOT NULL DEFAULT 2,
      due_hours             INTEGER NOT NULL DEFAULT 48,
      escalation_hours      INTEGER NOT NULL DEFAULT 24,
      notification_channels JSONB NOT NULL DEFAULT '["in_app"]'::jsonb,
      is_enabled            BOOLEAN NOT NULL DEFAULT TRUE,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  for (const template of DEFAULT_APPROVAL_POLICY_TEMPLATES) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO admin_approval_policy_templates
         (id, label, match_actions, risk_level, required_approvals, due_hours, escalation_hours, notification_channels, is_enabled)
       VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8::jsonb,$9)
       ON CONFLICT (id) DO NOTHING`,
      template.id,
      template.label,
      safeJson(template.matchActions),
      template.risk,
      template.requiredApprovals,
      template.dueHours,
      template.escalationHours,
      safeJson(template.notificationChannels),
      template.isEnabled,
    );
  }
  await prisma.$executeRawUnsafe(`
    UPDATE admin_approval_policy_templates
       SET required_approvals = 1,
           updated_at = NOW()
     WHERE id IN ('workflow-create', 'workflow-change')
        OR EXISTS (
          SELECT 1
            FROM jsonb_array_elements_text(match_actions) AS action_match(value)
           WHERE lower(action_match.value) LIKE 'workflow%'
        )
  `).catch(() => {});
}

export async function listAdminApprovalPolicyTemplates() {
  await ensureAdminApprovalPolicyTemplateTable();
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT id, label, match_actions, risk_level, required_approvals, due_hours,
            escalation_hours, notification_channels, is_enabled
       FROM admin_approval_policy_templates
      ORDER BY CASE id
        WHEN 'workflow-create' THEN 0
        WHEN 'workflow-change' THEN 1
        WHEN 'service-config-rules-change' THEN 2
        WHEN 'logistics-compliance-override' THEN 3
        WHEN 'critical-change' THEN 4
        WHEN 'high-risk-admin-change' THEN 5
        WHEN 'guarded-admin-change' THEN 6
        WHEN 'standard-admin-change' THEN 7
        ELSE 10
      END, label`,
  );
  return rows.map(normalizeTemplate);
}

export async function updateAdminApprovalPolicyTemplate(template: ApprovalPolicyTemplate) {
  await ensureAdminApprovalPolicyTemplateTable();
  const safeRequired = clampRequiredApprovals(template.requiredApprovals, 1);
  const safeDue = Math.max(1, Math.min(Math.floor(Number(template.dueHours)), 720));
  const safeEscalation = Math.max(1, Math.min(Math.floor(Number(template.escalationHours)), safeDue));
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `UPDATE admin_approval_policy_templates
        SET label = $2,
            match_actions = $3::jsonb,
            risk_level = $4,
            required_approvals = $5,
            due_hours = $6,
            escalation_hours = $7,
            notification_channels = $8::jsonb,
            is_enabled = $9,
            updated_at = NOW()
      WHERE id = $1
      RETURNING id, label, match_actions, risk_level, required_approvals, due_hours,
                escalation_hours, notification_channels, is_enabled`,
    template.id,
    template.label,
    safeJson(template.matchActions.filter(Boolean)),
    template.risk,
    safeRequired,
    safeDue,
    safeEscalation,
    safeJson(template.notificationChannels.length ? template.notificationChannels : ['in_app']),
    template.isEnabled,
  );
  return rows[0] ? normalizeTemplate(rows[0]) : null;
}

export async function resolveAdminApprovalPolicyTemplate(action: string) {
  const templates = await listAdminApprovalPolicyTemplates();
  const lower = action.toLowerCase();
  return templates.find(template => template.isEnabled && template.matchActions.some(match => match !== '*' && lower.includes(match.toLowerCase())))
    ?? templates.find(template => template.id === 'standard-admin-change' && template.isEnabled)
    ?? defaultTemplateForAction(action);
}
