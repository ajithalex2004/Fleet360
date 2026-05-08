'use client';

/**
 * Tab 1 — SLA & Workflow.
 *
 * Response / Resolution / Escalation SLAs, business hours, holiday calendar
 * key, auto-escalation, and editable escalation levels (level → trigger
 * hours → notify). Rule shape: SlaRules from src/types/service-rules.ts.
 */

import { useMemo } from 'react';
import { useRuleTab } from './use-rule-tab';
import { Field, NumberInput, TextInput, Toggle, SaveBar, Section } from './shared';
import { DEFAULT_SLA_RULES, type SlaRules, type EscalationLevel } from '@/types/service-rules';
import { Plus, Trash2 } from 'lucide-react';

const WEEKDAYS = [
  { n: 1, label: 'Mon' }, { n: 2, label: 'Tue' }, { n: 3, label: 'Wed' },
  { n: 4, label: 'Thu' }, { n: 5, label: 'Fri' }, { n: 6, label: 'Sat' }, { n: 7, label: 'Sun' },
];

export function SlaTab({ typeId }: { typeId: string }) {
  const { rules, patch, loading, saving, savedMsg, error, configured, save, reload } =
    useRuleTab<SlaRules>(typeId, 'sla', DEFAULT_SLA_RULES);

  const dirty = useMemo(() => JSON.stringify(rules) !== JSON.stringify(DEFAULT_SLA_RULES) || configured, [rules, configured]);

  if (loading) return <div className="text-sm text-slate-500">Loading…</div>;

  const toggleDay = (n: number) => {
    const next = rules.businessDays.includes(n)
      ? rules.businessDays.filter(d => d !== n)
      : [...rules.businessDays, n].sort((a, b) => a - b);
    patch({ businessDays: next });
  };

  const addLevel = () => {
    const next: EscalationLevel = {
      level: (rules.escalationLevels.at(-1)?.level ?? 0) + 1,
      triggerHours: 8,
      notify: '',
    };
    patch({ escalationLevels: [...rules.escalationLevels, next] });
  };

  const updateLevel = (i: number, p: Partial<EscalationLevel>) => {
    patch({
      escalationLevels: rules.escalationLevels.map((l, idx) => idx === i ? { ...l, ...p } : l),
    });
  };

  const removeLevel = (i: number) => {
    patch({ escalationLevels: rules.escalationLevels.filter((_, idx) => idx !== i) });
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <Section title="Response targets">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Response SLA (min)" hint="First response target">
            <NumberInput value={rules.responseSlaMinutes} min={0}
              onChange={v => patch({ responseSlaMinutes: v })} />
          </Field>
          <Field label="Resolution SLA (h)" hint="Total time to resolve">
            <NumberInput value={rules.resolutionSlaHours} min={0}
              onChange={v => patch({ resolutionSlaHours: v })} />
          </Field>
          <Field label="Escalation SLA (h)" hint="Inactivity before escalating">
            <NumberInput value={rules.escalationSlaHours} min={0}
              onChange={v => patch({ escalationSlaHours: v })} />
          </Field>
        </div>
      </Section>

      <Section title="Business hours">
        <Toggle label="Business hours only" hint="SLA timers pause outside business hours"
          checked={rules.businessHoursOnly} onChange={v => patch({ businessHoursOnly: v })} />
        <div className={`grid grid-cols-1 md:grid-cols-3 gap-3 ${rules.businessHoursOnly ? '' : 'opacity-50 pointer-events-none'}`}>
          <Field label="Start">
            <TextInput type="time" value={rules.businessHoursStart}
              onChange={e => patch({ businessHoursStart: e.target.value })} />
          </Field>
          <Field label="End">
            <TextInput type="time" value={rules.businessHoursEnd}
              onChange={e => patch({ businessHoursEnd: e.target.value })} />
          </Field>
          <Field label="Holiday calendar key" hint="Optional — links to a future holidays table">
            <TextInput value={rules.holidayCalendarKey ?? ''}
              onChange={e => patch({ holidayCalendarKey: e.target.value || null })}
              placeholder="UAE_PUBLIC" />
          </Field>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Business days</label>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map(d => {
              const active = rules.businessDays.includes(d.n);
              return (
                <button key={d.n} type="button" onClick={() => toggleDay(d.n)}
                  className={`px-2.5 py-1 rounded-md text-[11px] border ${
                    active ? 'bg-violet-500/20 text-violet-200 border-violet-500/40' : 'bg-slate-800/60 text-slate-400 border-white/10'
                  }`}>
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>
      </Section>

      <Section title="Auto escalation" hint="Trigger an escalation level after N hours of inactivity">
        <Toggle label="Auto escalation enabled"
          checked={rules.autoEscalationEnabled} onChange={v => patch({ autoEscalationEnabled: v })} />

        <div className={`space-y-2 ${rules.autoEscalationEnabled ? '' : 'opacity-50 pointer-events-none'}`}>
          {rules.escalationLevels.length === 0 && (
            <p className="text-[11px] text-slate-500">No escalation levels — add one to start.</p>
          )}
          {rules.escalationLevels.map((lvl, i) => (
            <div key={i} className="grid grid-cols-[80px_1fr_2fr_auto] gap-2 items-center">
              <NumberInput value={lvl.level} min={1}
                onChange={v => updateLevel(i, { level: v ?? 1 })} />
              <NumberInput value={lvl.triggerHours} min={0}
                onChange={v => updateLevel(i, { triggerHours: v ?? 0 })}
                placeholder="hours" />
              <TextInput value={lvl.notify}
                onChange={e => updateLevel(i, { notify: e.target.value })}
                placeholder="email or role" />
              <button type="button" onClick={() => removeLevel(i)}
                className="p-2 rounded-lg text-rose-300 hover:bg-rose-500/10">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          <button type="button" onClick={addLevel}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/40 text-violet-200 text-xs">
            <Plus className="w-3.5 h-3.5" /> Add level
          </button>
        </div>
      </Section>

      <SaveBar configured={configured} dirty={dirty} saving={saving} error={error} savedMsg={savedMsg}
        onSave={save} onReset={reload}
        typeId={typeId} category="sla" onRolledBack={reload} />
    </div>
  );
}
