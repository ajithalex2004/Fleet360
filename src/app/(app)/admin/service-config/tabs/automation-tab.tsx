'use client';

/**
 * Tab 8 — Automation Rules.
 * Controls the live Runtime FSM Automation Engine:
 *   - Auto status update (on intake, assignment, approval)
 *   - Auto closure after configurable quiet hours on Resolved / Completed tickets
 *   - Periodic reminder notifications on open tickets
 *   - Notification channel fan-out (Email / WhatsApp / SMS)
 *   - AI classification & AI department/assignee routing
 */

import { useMemo, useState } from 'react';
import { Sparkles, Play, Eye, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { useRuleTab } from './use-rule-tab';
import { Field, NumberInput, Toggle, SaveBar, Section, type RuleTabProps } from './shared';
import { DEFAULT_AUTOMATION_RULES, type AutomationRules } from '@/types/service-rules';

interface SweepReportSummary {
  dryRun: boolean;
  evaluatedTickets: number;
  autoClosedCount: number;
  remindersSentCount: number;
  executedAt: string;
}

export function AutomationTab({ typeId, scopeId, scopeLookup }: RuleTabProps) {
  const { rules, patch, loading, saving, savedMsg, error, configured, ownedScope, save, reload } =
    useRuleTab<AutomationRules>(typeId, 'automation', DEFAULT_AUTOMATION_RULES, scopeId);

  const [sweepBusy, setSweepBusy] = useState<'preview' | 'run' | null>(null);
  const [sweepReport, setSweepReport] = useState<SweepReportSummary | null>(null);
  const [sweepErr, setSweepErr] = useState<string | null>(null);

  const dirty = useMemo(() => JSON.stringify(rules) !== JSON.stringify(DEFAULT_AUTOMATION_RULES) || configured, [rules, configured]);

  const executeSweep = async (mode: 'preview' | 'run') => {
    setSweepBusy(mode);
    setSweepErr(null);
    try {
      const res = await fetch('/api/service-tickets/automation/sweep', {
        method: mode === 'preview' ? 'GET' : 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setSweepErr(data?.error ?? 'Failed to run automation sweep');
        return;
      }
      setSweepReport(data.report as SweepReportSummary);
    } catch {
      setSweepErr('Unable to reach automation sweep endpoint');
    } finally {
      setSweepBusy(null);
    }
  };

  if (loading) return <div className="text-sm text-[var(--text-muted)]">Loading…</div>;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Live Runtime Engine Status & On-Demand Sweep Controls */}
      <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
              <Sparkles className="w-3 h-3" /> Runtime Engine Active
            </span>
            <span className="text-xs text-[var(--text-muted)]">
              Runs live on ticket intake/updates &amp; every 15 min via scheduler
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void executeSweep('preview')}
              disabled={sweepBusy !== null}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-main)] text-xs font-semibold disabled:opacity-50"
            >
              {sweepBusy === 'preview' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
              Preview eligible
            </button>
            <button
              type="button"
              onClick={() => void executeSweep('run')}
              disabled={sweepBusy !== null}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold disabled:opacity-50"
            >
              {sweepBusy === 'run' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              Run sweep now
            </button>
          </div>
        </div>

        {sweepErr && (
          <div className="flex items-center gap-1.5 text-xs text-rose-700 dark:text-rose-300">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {sweepErr}
          </div>
        )}
        {sweepReport && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-emerald-800 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded-lg px-3 py-2">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span>
              <strong>{sweepReport.dryRun ? 'Preview (no changes written)' : 'Sweep executed'}:</strong>{' '}
              Evaluated {sweepReport.evaluatedTickets} ticket(s) —{' '}
              <strong>{sweepReport.autoClosedCount}</strong> {sweepReport.dryRun ? 'eligible for auto-closure' : 'auto-closed'},{' '}
              <strong>{sweepReport.remindersSentCount}</strong> {sweepReport.dryRun ? 'due for reminder' : 'reminder(s) sent'}.
            </span>
          </div>
        )}
      </div>

      <Section title="Lifecycle automation">
        <Toggle label="Auto status update" hint="Automatically advances status to Acknowledged/Assigned when routed, assigned, or approved (never bypasses approvals)"
          checked={rules.autoStatusUpdate} onChange={v => patch({ autoStatusUpdate: v })} />
        <Toggle label="Auto closure" hint="Automatically closes Resolved / Completed tickets after the configured inactivity period"
          checked={rules.autoClosure} onChange={v => patch({ autoClosure: v })} />
        <Field label="Auto-close after (h)" hint="Hours of inactivity after resolution before closing (e.g. 48 or 168)">
          <NumberInput value={rules.autoClosureAfterHours} min={1}
            onChange={v => patch({ autoClosureAfterHours: v })}
            placeholder="e.g. 72" />
        </Field>
      </Section>

      <Section title="Reminders">
        <Toggle label="Reminder notifications" hint="Periodic nudges to assignees on open tickets via enabled notification channels"
          checked={rules.reminderNotifications} onChange={v => patch({ reminderNotifications: v })} />
        <Field label="Reminder interval (h)" hint="Minimum hours between automated reminders for the same ticket">
          <NumberInput value={rules.reminderIntervalHours} min={1}
            onChange={v => patch({ reminderIntervalHours: v })}
            placeholder="e.g. 24" />
        </Field>
      </Section>

      <Section title="Notification channels">
        <Toggle label="Email notifications" hint="Dispatch via Resend / SMTP on ticket create, assign, status change, reminder, and auto-close"
          checked={rules.emailNotifications} onChange={v => patch({ emailNotifications: v })} />
        <Toggle label="WhatsApp notifications" hint="Dispatch via Twilio WhatsApp to site/customer mobile numbers when configured"
          checked={rules.whatsappNotifications} onChange={v => patch({ whatsappNotifications: v })} />
        <Toggle label="SMS notifications" hint="Dispatch via Twilio SMS to site/customer mobile numbers when configured"
          checked={rules.smsNotifications} onChange={v => patch({ smsNotifications: v })} />
      </Section>

      <Section title="AI assist" hint="Runs on ticket intake (deterministic fast-path + Gemini Flash fallback when configured)">
        <Toggle label="AI classification" hint="Auto-tags tickets (EN/AR/UR) and upgrades safety/emergency priorities automatically"
          checked={rules.aiClassification} onChange={v => patch({ aiClassification: v })} />
        <Toggle label="AI routing" hint="Auto-routes new tickets out of Operations Triage to the best active owning department & default assignee"
          checked={rules.aiRouting} onChange={v => patch({ aiRouting: v })} />
      </Section>

      <SaveBar configured={configured} dirty={dirty} saving={saving} error={error} savedMsg={savedMsg}
        onSave={save} onReset={reload}
        typeId={typeId} category="automation" scopeId={scopeId} ownedScope={ownedScope}
        scopeLookup={scopeLookup} onRolledBack={reload} />
    </div>
  );
}
