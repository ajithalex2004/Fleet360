'use client';

/**
 * Tab 6 — Ticketing Rules.
 * Prefix, auto-assignment, default assignee, priority matrix (SLA hours
 * per priority), category mapping, escalation matrix, customer + internal
 * notes flags. Most relevant to SERVICE_TICKETING-linked services.
 */

import { useMemo } from 'react';
import { useRuleTab } from './use-rule-tab';
import { Field, NumberInput, TextInput, Toggle, SaveBar, Section, type RuleTabProps } from './shared';
import {
  DEFAULT_TICKETING_RULES,
  type TicketingRules, type TicketingEscalationStep,
} from '@/types/service-rules';
import { Plus, Trash2 } from 'lucide-react';

export function TicketingTab({ typeId, scopeId, scopeLookup }: RuleTabProps) {
  const { rules, patch, loading, saving, savedMsg, error, configured, ownedScope, save, reload } =
    useRuleTab<TicketingRules>(typeId, 'ticketing', DEFAULT_TICKETING_RULES, scopeId);

  const dirty = useMemo(() => JSON.stringify(rules) !== JSON.stringify(DEFAULT_TICKETING_RULES) || configured, [rules, configured]);

  if (loading) return <div className="text-sm text-slate-500">Loading…</div>;

  const updateMatrix = (priority: keyof TicketingRules['priorityMatrix'], hours: number) => {
    patch({ priorityMatrix: { ...rules.priorityMatrix, [priority]: hours } });
  };

  const addEscalation = () => {
    const next: TicketingEscalationStep = {
      level: (rules.escalationMatrix.at(-1)?.level ?? 0) + 1,
      afterHours: 24,
      escalateTo: '',
    };
    patch({ escalationMatrix: [...rules.escalationMatrix, next] });
  };
  const updateEscalation = (i: number, p: Partial<TicketingEscalationStep>) => {
    patch({ escalationMatrix: rules.escalationMatrix.map((s, idx) => idx === i ? { ...s, ...p } : s) });
  };
  const removeEscalation = (i: number) => {
    patch({ escalationMatrix: rules.escalationMatrix.filter((_, idx) => idx !== i) });
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <Section title="Identification & assignment">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Ticket prefix" hint="3-letter code (e.g. MNT for Maintenance)">
            <TextInput value={rules.ticketPrefix}
              onChange={e => patch({ ticketPrefix: e.target.value.toUpperCase().slice(0, 6) })}
              placeholder="MNT"
              className="font-mono uppercase" />
          </Field>
          <Field label="Default assignee" hint="Email address — used when auto-assignment is off">
            <TextInput value={rules.defaultAssignee ?? ''}
              onChange={e => patch({ defaultAssignee: e.target.value || null })}
              placeholder="ops@example.com" />
          </Field>
        </div>
        <Toggle label="Auto-assignment"
          hint="Engine picks an assignee based on round-robin / load / role"
          checked={rules.autoAssignment} onChange={v => patch({ autoAssignment: v })} />
      </Section>

      <Section title="Priority matrix" hint="Resolution SLA hours per priority">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Low (h)">
            <NumberInput value={rules.priorityMatrix.Low} min={0}
              onChange={v => updateMatrix('Low', v ?? 0)} />
          </Field>
          <Field label="Medium (h)">
            <NumberInput value={rules.priorityMatrix.Medium} min={0}
              onChange={v => updateMatrix('Medium', v ?? 0)} />
          </Field>
          <Field label="High (h)">
            <NumberInput value={rules.priorityMatrix.High} min={0}
              onChange={v => updateMatrix('High', v ?? 0)} />
          </Field>
        </div>
      </Section>

      <Section title="Category mapping">
        <Field label="Category mapping key" hint="Optional — slug for cross-system category lookup">
          <TextInput value={rules.categoryMapping ?? ''}
            onChange={e => patch({ categoryMapping: e.target.value || null })}
            placeholder="e.g. tickets.maintenance" />
        </Field>
      </Section>

      <Section title="Escalation matrix" hint="Move to next level after N hours">
        {rules.escalationMatrix.length === 0 && (
          <p className="text-[11px] text-slate-500">No escalation steps yet.</p>
        )}
        {rules.escalationMatrix.map((s, i) => (
          <div key={i} className="grid grid-cols-[80px_1fr_2fr_auto] gap-2 items-center">
            <NumberInput value={s.level} min={1}
              onChange={v => updateEscalation(i, { level: v ?? 1 })} />
            <NumberInput value={s.afterHours} min={0}
              onChange={v => updateEscalation(i, { afterHours: v ?? 0 })}
              placeholder="hours" />
            <TextInput value={s.escalateTo}
              onChange={e => updateEscalation(i, { escalateTo: e.target.value })}
              placeholder="email or role" />
            <button type="button" onClick={() => removeEscalation(i)}
              className="p-2 rounded-lg text-rose-300 hover:bg-rose-500/10">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        <button type="button" onClick={addEscalation}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/40 text-violet-200 text-xs">
          <Plus className="w-3.5 h-3.5" /> Add step
        </button>
      </Section>

      <Section title="Notification & notes">
        <Toggle label="Customer notification enabled"
          checked={rules.customerNotificationEnabled} onChange={v => patch({ customerNotificationEnabled: v })} />
        <Toggle label="Internal notes enabled"
          checked={rules.internalNotesEnabled} onChange={v => patch({ internalNotesEnabled: v })} />
      </Section>

      <Section title="Cross-module bridge"
        hint="MAINTENANCE-only: when enabled, Acknowledging a ticket also creates a MaintenanceRequest in the maintenance module">
        <Toggle label="Auto-create Maintenance Request on Acknowledge"
          checked={rules.autoCreatesMaintenanceRequest}
          onChange={v => patch({ autoCreatesMaintenanceRequest: v })} />
      </Section>

      <SaveBar configured={configured} dirty={dirty} saving={saving} error={error} savedMsg={savedMsg}
        onSave={save} onReset={reload}
        typeId={typeId} category="ticketing" scopeId={scopeId} ownedScope={ownedScope}
        scopeLookup={scopeLookup} onRolledBack={reload} />
    </div>
  );
}
