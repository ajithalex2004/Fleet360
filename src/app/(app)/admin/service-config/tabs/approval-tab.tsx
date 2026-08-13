'use client';

/**
 * Tab 2 — Approval Rules.
 * Approval required, levels, dept approval, financial threshold,
 * emergency bypass, auto-approve below threshold, approver roles list,
 * optional workflowId link to a Workflow defined under this service type
 * (see the Workflow tab — Phase 2C of the workflow merge).
 */

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Plus } from 'lucide-react';
import { useRuleTab } from './use-rule-tab';
import { Field, NumberInput, Toggle, ChipMultiSelect, SaveBar, Section, type RuleTabProps } from './shared';
import { DEFAULT_APPROVAL_RULES, type ApprovalRules } from '@/types/service-rules';

const SUGGESTED_ROLES = [
  'TENANT_ADMIN', 'OPERATIONS_MANAGER', 'FINANCE_MANAGER', 'FLEET_MANAGER',
  'DEPARTMENT_HEAD', 'DIRECT_MANAGER',
];

interface WorkflowOption { id: string; name: string; isActive: boolean }

export function ApprovalTab({ typeId, scopeId, scopeLookup, typeKey, onSwitchTab }: RuleTabProps) {
  const { rules, patch, loading, saving, savedMsg, error, configured, ownedScope, save, reload } =
    useRuleTab<ApprovalRules>(typeId, 'approval', DEFAULT_APPROVAL_RULES, scopeId);

  // Phase 2 — Workflow merge. Dropdown of workflows linked to this service
  // type. Hybrid filter handles both transition states:
  //   • new workflows match by serviceTypeId (canonical Phase 2 keying)
  //   • legacy workflows match by procedure key (Phase 1 fallback)
  const [workflowOptions, setWorkflowOptions] = useState<WorkflowOption[]>([]);
  const [wfLoading, setWfLoading]             = useState(true);
  useEffect(() => {
    if (!typeKey) { setWfLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/workflows');
        if (!res.ok) return;
        const all: Array<{ id: string; name: string; procedure: string; isActive: boolean; serviceTypeId?: string | null }> = await res.json();
        if (cancelled) return;
        setWorkflowOptions(
          all
            .filter(w =>
              (w.serviceTypeId && w.serviceTypeId === typeId)
              || (!w.serviceTypeId && w.procedure === typeKey)
            )
            .map(w => ({ id: w.id, name: w.name, isActive: w.isActive })),
        );
      } finally {
        if (!cancelled) setWfLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [typeId, typeKey]);

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
          <Field label="Workflow"
            hint={workflowOptions.length === 0 && !wfLoading
              ? 'No workflows yet for this service — create one in the Workflow tab.'
              : 'Pick the workflow that runs when this service’s approval gate fires.'}>
            <div className="flex gap-2">
              <select
                value={rules.workflowId ?? ''}
                onChange={e => patch({ workflowId: e.target.value || null })}
                disabled={wfLoading}
                className="flex-1 bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50">
                <option value="">{wfLoading ? 'Loading…' : '— None —'}</option>
                {workflowOptions.map(w => (
                  <option key={w.id} value={w.id}>
                    {w.name}{w.isActive ? '' : ' (inactive)'}
                  </option>
                ))}
              </select>
              {onSwitchTab && (
                <button type="button"
                  onClick={() => onSwitchTab('workflow')}
                  title="Open the Workflow tab to edit steps"
                  className="inline-flex items-center gap-1 px-2.5 rounded-lg bg-slate-800 border border-white/10 hover:border-violet-500/40 text-violet-300 text-xs whitespace-nowrap">
                  {workflowOptions.length === 0 ? (
                    <><Plus className="w-3.5 h-3.5" /> Create</>
                  ) : (
                    <>Edit <ArrowRight className="w-3.5 h-3.5" /></>
                  )}
                </button>
              )}
            </div>
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
        typeId={typeId} category="approval" scopeId={scopeId} ownedScope={ownedScope}
        scopeLookup={scopeLookup} onRolledBack={reload} />
    </div>
  );
}
