'use client';

/**
 * Tab 8 — Automation Rules.
 * Auto status update, auto closure, reminders, channel toggles
 * (WhatsApp / Email / SMS), AI classification & routing.
 */

import { useMemo } from 'react';
import { useRuleTab } from './use-rule-tab';
import { Field, NumberInput, Toggle, SaveBar, Section } from './shared';
import { DEFAULT_AUTOMATION_RULES, type AutomationRules } from '@/types/service-rules';

export function AutomationTab({ typeId }: { typeId: string }) {
  const { rules, patch, loading, saving, savedMsg, error, configured, save, reload } =
    useRuleTab<AutomationRules>(typeId, 'automation', DEFAULT_AUTOMATION_RULES);

  const dirty = useMemo(() => JSON.stringify(rules) !== JSON.stringify(DEFAULT_AUTOMATION_RULES) || configured, [rules, configured]);

  if (loading) return <div className="text-sm text-slate-500">Loading…</div>;

  return (
    <div className="space-y-6 max-w-3xl">
      <Section title="Lifecycle automation">
        <Toggle label="Auto status update" hint="Engine advances status when conditions are met"
          checked={rules.autoStatusUpdate} onChange={v => patch({ autoStatusUpdate: v })} />
        <Toggle label="Auto closure" hint="Close after a quiet period"
          checked={rules.autoClosure} onChange={v => patch({ autoClosure: v })} />
        <Field label="Auto-close after (h)" hint="Hours of inactivity before closure">
          <NumberInput value={rules.autoClosureAfterHours} min={0}
            onChange={v => patch({ autoClosureAfterHours: v })}
            placeholder="e.g. 168" />
        </Field>
      </Section>

      <Section title="Reminders">
        <Toggle label="Reminder notifications" hint="Periodic nudges to assignees"
          checked={rules.reminderNotifications} onChange={v => patch({ reminderNotifications: v })} />
        <Field label="Reminder interval (h)">
          <NumberInput value={rules.reminderIntervalHours} min={0}
            onChange={v => patch({ reminderIntervalHours: v })}
            placeholder="e.g. 24" />
        </Field>
      </Section>

      <Section title="Notification channels">
        <Toggle label="Email notifications"
          checked={rules.emailNotifications} onChange={v => patch({ emailNotifications: v })} />
        <Toggle label="WhatsApp notifications"
          checked={rules.whatsappNotifications} onChange={v => patch({ whatsappNotifications: v })} />
        <Toggle label="SMS notifications"
          checked={rules.smsNotifications} onChange={v => patch({ smsNotifications: v })} />
      </Section>

      <Section title="AI assist" hint="Optional ML-driven helpers">
        <Toggle label="AI classification" hint="Auto-tag and categorise incoming items"
          checked={rules.aiClassification} onChange={v => patch({ aiClassification: v })} />
        <Toggle label="AI routing" hint="Route to the most likely owner"
          checked={rules.aiRouting} onChange={v => patch({ aiRouting: v })} />
      </Section>

      <SaveBar configured={configured} dirty={dirty} saving={saving} error={error} savedMsg={savedMsg}
        onSave={save} onReset={reload}
        typeId={typeId} category="automation" onRolledBack={reload} />
    </div>
  );
}
