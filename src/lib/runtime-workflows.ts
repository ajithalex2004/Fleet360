import { triggerWorkflow } from '@/lib/workflow-db';
import { loadServiceConfig } from '@/lib/service-config/load';
import { getPreferredWorkflowProcedure } from '@/lib/service-config/workflow-procedure';
import type { OperationalContext } from '@/lib/cross-module-governance';
import type { NextRequest } from 'next/server';

export interface TriggerServiceWorkflowArgs {
  req: NextRequest;
  ctx: OperationalContext;
  serviceTypeKey: string;
  referenceType: string;
  referenceId: string;
  referenceNumber?: string | null;
  contextData?: Record<string, unknown>;
  force?: boolean;
}

export interface TriggerServiceWorkflowResult {
  triggered: boolean;
  reason?: 'service_type_missing' | 'workflow_disabled' | 'workflow_missing';
  workflowName?: string;
  instanceId?: string;
  reused?: boolean;
  error?: string;
}

export async function triggerServiceWorkflow(args: TriggerServiceWorkflowArgs): Promise<TriggerServiceWorkflowResult> {
  const cfg = await loadServiceConfig(args.ctx.tenantId, args.serviceTypeKey).catch(() => null);
  if (!cfg) {
    return { triggered: false, reason: 'service_type_missing' };
  }

  const workflowEnabled = Boolean(
    cfg.mapping?.workflowEngineEnabled
    || cfg.mapping?.approvalEngineEnabled
  );
  if (!workflowEnabled) {
    return { triggered: false, reason: 'workflow_disabled' };
  }

  const initiatedByEmail =
    args.req.headers.get('x-user-email')
    ?? args.req.headers.get('x-user-id')
    ?? args.ctx.userId
    ?? 'system';
  const initiatedByName =
    args.req.headers.get('x-user-name')
    ?? args.req.headers.get('x-user-display-name')
    ?? undefined;

  const result = await triggerWorkflow({
    serviceTypeId: cfg.type.id,
    tenantId: args.ctx.tenantId,
    module: cfg.mapping?.linkedModule ?? undefined,
    procedure: getPreferredWorkflowProcedure(cfg.type.key, cfg.type.name),
    referenceType: args.referenceType,
    referenceId: args.referenceId,
    referenceNumber: args.referenceNumber ?? args.referenceId,
    initiatedByEmail,
    initiatedByName,
    contextData: args.contextData,
    force: args.force,
  }).catch((error: unknown) => ({
    error: error instanceof Error ? error.message : 'Failed to trigger workflow',
  }));

  if ('error' in result) {
    return {
      triggered: false,
      reason: 'workflow_missing',
      error: result.error,
    };
  }

  return {
    triggered: true,
    workflowName: result.workflowName,
    instanceId: result.instanceId,
    reused: result.reused,
  };
}
