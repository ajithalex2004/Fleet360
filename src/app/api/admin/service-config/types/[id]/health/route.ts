import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authorizeServiceConfig } from '@/lib/service-config/auth';
import { ensureServiceConfigTables } from '@/lib/service-config/schema';
import { ensureRootScope, loadScopeChain } from '@/lib/service-config/scopes-schema';
import { loadRulesForChain } from '@/lib/service-config/rules-schema';
import { reconcileWorkflowServiceTypeLinks } from '@/lib/workflow-db';
import { getWorkflowProcedureCandidates } from '@/lib/service-config/workflow-procedure';
import { RULE_CATEGORIES, RULE_DEFAULTS, type RuleCategory } from '@/types/service-rules';

export const runtime = 'nodejs';

interface RouteParams { params: Promise<{ id: string }> }

type Severity = 'error' | 'warning' | 'info';
interface HealthIssue {
  severity: Severity;
  tab: string;
  code: string;
  message: string;
  detail?: string;
}

interface TypeRow {
  id: string;
  tenant_id: string;
  key: string;
  name: string;
  category_key: string;
}

interface MappingRow {
  linked_module: string;
  workflow_engine_enabled: boolean;
  notification_engine_enabled: boolean;
  approval_engine_enabled: boolean;
  finance_engine_enabled: boolean;
  dispatch_engine_enabled: boolean;
}

function push(issues: HealthIssue[], severity: Severity, tab: string, code: string, message: string, detail?: string) {
  issues.push({ severity, tab, code, message, ...(detail ? { detail } : {}) });
}

function duplicateKeys(fields: Array<{ key?: string }>) {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const f of fields) {
    const key = String(f.key ?? '').trim();
    if (!key) continue;
    if (seen.has(key)) dupes.add(key);
    seen.add(key);
  }
  return Array.from(dupes);
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const auth = authorizeServiceConfig(req);
  if (!auth.ok) return auth.res;

  const { id } = await params;
  await ensureServiceConfigTables();

  const typeRows = await prisma.$queryRawUnsafe<TypeRow[]>(
    `SELECT t.id::text, t.tenant_id, t.key, t.name, c.key AS category_key
       FROM service_types t
       JOIN service_categories c ON c.id = t.category_id
      WHERE t.id = $1::uuid AND t.tenant_id = $2 AND t.deleted_at IS NULL
      LIMIT 1`,
    id,
    auth.tenantId,
  ).catch(() => []);
  const serviceType = typeRows[0];
  if (!serviceType) return NextResponse.json({ ok: false, error: 'Service type not found' }, { status: 404 });

  const requestedScopeId = req.nextUrl.searchParams.get('scopeId');
  const activeScopeId = requestedScopeId || await ensureRootScope(auth.tenantId);
  const scopeChain = await loadScopeChain(auth.tenantId, activeScopeId);
  if (scopeChain.length === 0) return NextResponse.json({ ok: false, error: 'Scope not found' }, { status: 404 });
  const chainIds = scopeChain.map(s => s.id);

  const mappingRows = await prisma.$queryRawUnsafe<MappingRow[]>(
    `SELECT linked_module, workflow_engine_enabled, notification_engine_enabled,
            approval_engine_enabled, finance_engine_enabled, dispatch_engine_enabled
       FROM service_module_mapping
      WHERE service_type_id = $1::uuid
      LIMIT 1`,
    id,
  ).catch(() => []);
  const mapping = mappingRows[0] ?? null;

  await reconcileWorkflowServiceTypeLinks(auth.tenantId);

  const rules: Record<string, any> = {};
  const configuredAtScope: Record<string, string | null> = {};
  await Promise.all(RULE_CATEGORIES.map(async (category) => {
    const hit = await loadRulesForChain<Record<string, unknown>>(id, category, chainIds);
    rules[category] = {
      ...(RULE_DEFAULTS[category] as object),
      ...((hit?.rules ?? {}) as object),
    };
    configuredAtScope[category] = hit?.scopeId ?? null;
  }));

  const workflowRows = await prisma.$queryRawUnsafe<Array<{ id: string; name: string; isActive: boolean; stepCount: bigint }>>(
    `SELECT w.id, w.name, COALESCE(w."isActive", FALSE) AS "isActive",
            (SELECT COUNT(*) FROM "WorkflowStep" s WHERE s."workflowId" = w.id)::bigint AS "stepCount"
       FROM "WorkflowDefinition" w
      WHERE COALESCE(w."tenantId", $2) = $2
        AND (w."serviceTypeId" = $1 OR (w."serviceTypeId" IS NULL AND w.procedure = ANY($3::text[])))
      ORDER BY w."createdAt" DESC
      LIMIT 20`,
    id,
    auth.tenantId,
    getWorkflowProcedureCandidates(serviceType.key, serviceType.name),
  ).catch(() => []);

  const activeWorkflows = workflowRows.filter(w => w.isActive);
  const activeWorkflowsWithSteps = activeWorkflows.filter(w => Number(w.stepCount) > 0);
  const issues: HealthIssue[] = [];

  if (!mapping) {
    push(issues, 'error', 'Module Mapping', 'missing_mapping', 'No module mapping exists for this service type.');
  }

  if (mapping?.approval_engine_enabled && !rules.approval.approvalRequired) {
    push(issues, 'warning', 'Approval', 'approval_toggle_mismatch', 'Approval engine is enabled, but Approval Required is off.');
  }
  if (rules.approval.approvalRequired && !rules.approval.workflowId && (rules.approval.approverRoles ?? []).length === 0 && activeWorkflowsWithSteps.length === 0) {
    push(issues, 'error', 'Approval', 'approval_no_route', 'Approval is required, but no approver role or active workflow with steps is configured.');
  }
  if ((mapping?.workflow_engine_enabled || rules.approval.approvalRequired) && activeWorkflowsWithSteps.length === 0) {
    push(issues, 'warning', 'Workflow', 'workflow_no_active_steps', 'Workflow behavior is enabled, but no active workflow with steps is attached.');
  }
  if (mapping?.finance_engine_enabled) {
    const financeEmpty = rules.finance.pricingSource === 'NONE' && rules.finance.billingType === 'NONE' && !rules.finance.autoInvoiceGeneration;
    if (financeEmpty) push(issues, 'warning', 'Finance', 'finance_empty_rules', 'Finance engine is enabled, but pricing, billing, and auto-invoice rules are empty.');
  }
  if (mapping?.dispatch_engine_enabled && !rules.trip.autoTripCreation && !rules.trip.autoDispatch) {
    push(issues, 'warning', 'Trip & Dispatch', 'dispatch_empty_rules', 'Dispatch engine is enabled, but auto trip and auto dispatch are both disabled.');
  }

  const fields = Array.isArray(rules.formFields.fields) ? rules.formFields.fields : [];
  const dupes = duplicateKeys(fields);
  if (dupes.length > 0) {
    push(issues, 'error', 'Form Fields', 'duplicate_field_keys', `Duplicate form field keys: ${dupes.join(', ')}.`);
  }
  for (const field of fields) {
    if (!String(field.key ?? '').trim()) push(issues, 'error', 'Form Fields', 'blank_field_key', 'A form field has a blank key.');
    if (!String(field.label ?? '').trim()) push(issues, 'warning', 'Form Fields', 'blank_field_label', `Field ${field.key ?? '(unknown)'} has a blank label.`);
    if (field.required && field.readOnly && (!field.source || field.source === 'user-input')) {
      push(issues, 'warning', 'Form Fields', 'required_readonly_unresolved', `Required read-only field ${field.key} has no automatic source.`);
    }
  }
  if (rules.vehicle.vehicleRequired && !fields.some((f: any) => f.bindTo === 'vehicleId' || f.key === 'vehicleId')) {
    push(issues, 'info', 'Vehicle Rules', 'vehicle_required_no_field', 'Vehicle is required; confirm the request UI exposes a vehicle selector for this service.');
  }

  for (const category of RULE_CATEGORIES) {
    const owned = configuredAtScope[category];
    if (owned && owned !== activeScopeId) {
      push(issues, 'info', 'Scope', `inherited_${category}`, `${category} rules are inherited from an ancestor scope.`);
    }
  }

  const ticketRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count
       FROM service_tickets
      WHERE tenant_id = $1 AND ticket_type = $2 AND deleted_at IS NULL`,
    auth.tenantId,
    serviceType.key,
  ).catch(() => [{ count: BigInt(0) }]);

  const severityRank: Record<Severity, number> = { error: 3, warning: 2, info: 1 };
  const status = issues.some(i => i.severity === 'error')
    ? 'BLOCKED'
    : issues.some(i => i.severity === 'warning')
      ? 'WARN'
      : 'OK';

  return NextResponse.json({
    ok: true,
    status,
    serviceType,
    activeScopeId,
    issues: issues.sort((a, b) => severityRank[b.severity] - severityRank[a.severity]),
    impact: {
      activeTickets: Number(ticketRows[0]?.count ?? 0),
      workflows: workflowRows.length,
      activeWorkflows: activeWorkflows.length,
      activeWorkflowsWithSteps: activeWorkflowsWithSteps.length,
      inheritedRuleCategories: RULE_CATEGORIES.filter(c => configuredAtScope[c] && configuredAtScope[c] !== activeScopeId),
    },
  });
}
