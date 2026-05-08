'use client';

/**
 * Tab 2 — Approval Rules.
 * Approval required, levels, dept approval, financial threshold,
 * emergency bypass, auto-approve below threshold, approver roles list,
 * optional workflowId link to /admin/workflows.
 */

import { useMemo } from 'react';
import { useRuleTab } from './use-rule-tab';
import { Field, NumberInput, TextInput, Toggle, ChipMultiSelect, SaveBar, Section } from './shared';
import { DEFAULT_APPROVAL_RULES, type ApprovalRules } from '@/types/service-rules';

const SUGGESTED_ROLES = [
  'TENANT_ADMIN', 'OPERATIONS_MANAGER', 'FINANCE_MANAGER', 'FLEET_MANAGER',
  'DEPARTMENT_HEAD', 'DIRECT_MANAGER',
];

export function ApprovalTab({ typeId }: { typeId: string }) {
  const { rules, patch, loading, saving, savedMsg, error, configured, save, reload } =
    useRuleTab<ApprovalRules>(typeId, 'approval', DEFAULT_APPROVAL_RULES);

  const dirty = useMemo(() => JSON.stringify(rules) !== JSON.stringify(DEFAULT_APPROVAL_RULES) || configured, [rules, configured]);

  if (loading) return <div className="text-sm text-slate-500">Loading…</div>;

  return (
    <div className="space-y-6 max-w-3xl">
      <Section title="Approval gate">
        <Toggle label="Approval required" hint="Tickets/requests start in 'Awaiting Approval'"
          checked={rules.approvalRequired} onChange={v => patch({ approvalRequired: v })} />
        <div className={`grid grid-cols-1 md:grid-cols-2 gap-3 ${rules.approvalRequired ? '' : 'opacity-50 pointer-events-none'}`}>
          <Field label="Approval levels" hint="Number of sequential approvers (1–5)">
            <NumberInput value={rules.approvalLevels} min={1} max={5}
              onChange={v => patch({ approvalLevels: v ?? 1 })} />
          </Field>
          <Field label="Workflow ID" hint="Optional link to /admin/workflows">
            <TextInput value={rules.workflowId ?? ''}
              onChange={e => patch({ workflowId: e.target.value || null })}
              placeholder="UUID from /admin/workflows" />
          </Field>
        </div>
      </Section>

      <Section title="Conditional approval">
        <Toggle label="Department approval required" hint="Submitter's department head must approve"
          checked={rules.departmentApprovalRequired} onChange={v => patch({ departmentApprovalRequired: v })} />
        <Toggle label="Auto-approve below financial threshold"
          hint="Skip approval when amount < threshold"
          checked={rules.autoApproveBelowThreshold} onChange={v => patch({ autoApproveBelowThreshold: v })} />
        <Toggle label="Emergency bypass enabled" hint="Allow High priority to bypass approval"
          checked={rules.emergencyBypassEnabled} onChange={v => patch({ emergencyBypassEnabled: v })} />
        <Field label="Financial threshold (AED)" hint="Approval required at or above this amount">
          <NumberInput value={rules.financialThresholdAed} min={0}
            onChange={v => patch({ financialThresholdAed: v })}
            placeholder="e.g. 5000" />
        </Field>
      </Section>

      <Section title="Approver roles" hint="Roles that can approve at any level">
        <ChipMultiSelect values={rules.approverRoles}
          onChange={v => patch({ approverRoles: v })}
          suggestions={SUGGESTED_ROLES}
          placeholder="Add a role key…" />
      </Section>

      <SaveBar configured={configured} dirty={dirty} saving={saving} error={error} savedMsg={savedMsg}
        onSave={save} onReset={reload}
        typeId={typeId} category="approval" onRolledBack={reload} />
    </div>
  );
}
