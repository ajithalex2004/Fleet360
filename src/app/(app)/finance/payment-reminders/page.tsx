'use client';
import React, { useEffect, useState, useCallback } from 'react';

interface Schedule {
  id: string;
  name: string;
  trigger_type: string;
  trigger_days: number;
  channel: string;
  template_subject: string;
  template_body: string;
  is_active: boolean;
  module_filter: string | null;
  branch_filter: string | null;
  stats: { total_sent: number | string; delivered: number | string; failed: number | string; last_run?: string };
}

const CHANNEL_COLOR: Record<string, string> = {
  EMAIL:     'bg-blue-500/20 text-blue-300 border-blue-500/30',
  SMS:       'bg-violet-500/20 text-violet-300 border-violet-500/30',
  WHATSAPP:  'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
};
const TRIGGER_LABEL: Record<string, string> = {
  BEFORE_DUE: 'Before Due',
  ON_DUE:     'On Due Date',
  AFTER_DUE:  'After Due',
};

function ScheduleModal({
  schedule, onClose, onSave,
}: { schedule: Partial<Schedule> | null; onClose: () => void; onSave: () => void }) {
  const [form, setForm] = useState<Partial<Schedule>>(schedule ?? {
    name: '', trigger_type: 'AFTER_DUE', trigger_days: 7,
    channel: 'EMAIL', template_subject: '', template_body: '',
    module_filter: '', branch_filter: '', is_active: true,
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof Schedule, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  async function submit() {
    setSaving(true);
    const method = form.id ? 'PATCH' : 'POST';
    await fetch('/api/finance/reminder-schedules', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, trigger_days: Number(form.trigger_days) }),
    });
    setSaving(false);
    onSave();
  }

  const varHelp = '{client_name} {invoice_no} {amount} {due_date}';

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl w-full max-w-xl border border-white/10 overflow-hidden">
        <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-4 flex justify-between items-center">
          <h2 className="font-bold text-white">{form.id ? 'Edit' : 'New'} Reminder Schedule</h2>
          <button onClick={onClose} className="text-white/70 hover:text-white text-xl">✕</button>
        </div>
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="text-xs text-slate-400 block mb-1">Schedule Name</label>
            <input value={form.name ?? ''} onChange={e => set('name', e.target.value)}
              className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">Trigger</label>
              <select value={form.trigger_type} onChange={e => set('trigger_type', e.target.value)}
                className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm">
                <option value="BEFORE_DUE">Before Due</option>
                <option value="ON_DUE">On Due Date</option>
                <option value="AFTER_DUE">After Due</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Days</label>
              <input type="number" min={0} value={form.trigger_days ?? 0} onChange={e => set('trigger_days', Number(e.target.value))}
                className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm" />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Channel</label>
              <select value={form.channel} onChange={e => set('channel', e.target.value)}
                className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm">
                <option value="EMAIL">Email</option>
                <option value="SMS">SMS</option>
                <option value="WHATSAPP">WhatsApp</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">Module Filter (optional)</label>
              <select value={form.module_filter ?? ''} onChange={e => set('module_filter', e.target.value || null)}
                className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm">
                <option value="">All Modules</option>
                <option value="LEASE">Lease</option>
                <option value="RENTAL">Rental</option>
                <option value="GENERAL">General</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Branch Filter (optional)</label>
              <input value={form.branch_filter ?? ''} onChange={e => set('branch_filter', e.target.value || null)}
                placeholder="e.g. Dubai"
                className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Subject</label>
            <input value={form.template_subject ?? ''} onChange={e => set('template_subject', e.target.value)}
              className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm" />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Message Body</label>
            <textarea value={form.template_body ?? ''} onChange={e => set('template_body', e.target.value)}
              rows={5} className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm resize-none font-mono" />
            <p className="text-slate-600 text-xs mt-1">Available variables: <span className="text-slate-400 font-mono">{varHelp}</span></p>
          </div>
        </div>
        <div className="px-6 pb-6 flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-700 text-slate-300 text-sm hover:bg-slate-600">Cancel</button>
          <button onClick={submit} disabled={saving || !form.name || !form.template_body}
            className="px-5 py-2 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-medium disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Schedule'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PaymentRemindersPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [running,   setRunning]   = useState(false);
  const [runResult, setRunResult] = useState<{ totalFired: number; results: { schedule: string; fired: number; invoices: string[] }[] } | null>(null);
  const [editing,   setEditing]   = useState<Partial<Schedule> | null | false>(false); // false = closed
  const [toggling,  setToggling]  = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res  = await fetch('/api/finance/reminder-schedules');
    const data = await res.json();
    setSchedules(data.schedules ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function runAll() {
    setRunning(true);
    setRunResult(null);
    const res  = await fetch('/api/finance/reminder-schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'run' }),
    });
    const data = await res.json();
    setRunResult(data);
    setRunning(false);
    load();
  }

  async function toggle(sch: Schedule) {
    setToggling(sch.id);
    await fetch('/api/finance/reminder-schedules', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sch.id, is_active: !sch.is_active }),
    });
    await load();
    setToggling(null);
  }

  async function del(id: string) {
    if (!confirm('Delete this schedule?')) return;
    await fetch('/api/finance/reminder-schedules', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    load();
  }

  const activeCount = schedules.filter(s => s.is_active).length;

  return (
    <div className="text-white">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Automated Payment Reminders</h1>
          <p className="text-slate-400 text-sm mt-1">Schedule-based triggers for overdue and upcoming invoices · Email · SMS · WhatsApp</p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => setEditing(null)}
            className="px-4 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium border border-white/10">
            + New Schedule
          </button>
          <button onClick={runAll} disabled={running}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-semibold disabled:opacity-50 hover:from-emerald-500 hover:to-teal-500">
            {running ? '⏳ Running…' : '▶ Run All Now'}
          </button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Active Schedules', value: activeCount,                              icon: '🟢', color: 'from-emerald-600 to-teal-600' },
          { label: 'Total Schedules',  value: schedules.length,                         icon: '📋', color: 'from-slate-600 to-slate-700' },
          { label: 'Total Sent',       value: schedules.reduce((s,x) => s + Number(x.stats?.total_sent ?? 0), 0), icon: '📨', color: 'from-blue-600 to-indigo-600' },
          { label: 'Failed',           value: schedules.reduce((s,x) => s + Number(x.stats?.failed ?? 0), 0),     icon: '❌', color: 'from-red-600 to-rose-600' },
        ].map(c => (
          <div key={c.label} className={`bg-gradient-to-br ${c.color} rounded-2xl p-4`}>
            <p className="text-2xl mb-1">{c.icon}</p>
            <p className="text-2xl font-bold text-white">{c.value}</p>
            <p className="text-white/70 text-xs mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Run result */}
      {runResult && (
        <div className={`mb-6 rounded-xl p-4 border flex items-start gap-3 ${runResult.totalFired > 0 ? 'bg-emerald-900/30 border-emerald-500/20' : 'bg-slate-800/60 border-white/10'}`}>
          <span className="text-2xl">{runResult.totalFired > 0 ? '✅' : '💤'}</span>
          <div>
            <p className={`font-semibold text-sm ${runResult.totalFired > 0 ? 'text-emerald-300' : 'text-slate-300'}`}>
              {runResult.totalFired > 0 ? `${runResult.totalFired} reminder(s) sent` : 'No reminders due at this time'}
            </p>
            {runResult.results.map((r, i) => (
              <p key={i} className="text-slate-400 text-xs mt-1">
                <span className="text-white">{r.schedule}</span>: {r.fired} sent ({r.invoices.join(', ')})
              </p>
            ))}
          </div>
          <button onClick={() => setRunResult(null)} className="ml-auto text-slate-500 hover:text-white text-lg">✕</button>
        </div>
      )}

      {/* Schedules */}
      {loading ? (
        <div className="text-center py-16 text-slate-500">Loading…</div>
      ) : (
        <div className="space-y-3">
          {schedules.map(sch => {
            const trigLabel = TRIGGER_LABEL[sch.trigger_type] ?? sch.trigger_type;
            const daysLabel = sch.trigger_type === 'ON_DUE' ? 'On due date' : `${sch.trigger_days} day(s) ${sch.trigger_type === 'BEFORE_DUE' ? 'before' : 'after'}`;
            return (
              <div key={sch.id} className={`bg-slate-800/60 border rounded-2xl p-5 transition-all ${sch.is_active ? 'border-white/10' : 'border-white/5 opacity-60'}`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    {/* Toggle */}
                    <button onClick={() => toggle(sch)} disabled={toggling === sch.id}
                      className={`mt-0.5 w-10 h-6 rounded-full transition-all flex-shrink-0 ${sch.is_active ? 'bg-emerald-500' : 'bg-slate-600'} relative`}>
                      <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${sch.is_active ? 'left-5' : 'left-1'}`} />
                    </button>
                    <div>
                      <p className="text-white font-semibold">{sch.name}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${CHANNEL_COLOR[sch.channel] ?? ''}`}>{sch.channel}</span>
                        <span className="text-slate-400 text-xs">⏱ {daysLabel}</span>
                        {sch.module_filter && <span className="text-slate-500 text-xs bg-slate-700 px-2 py-0.5 rounded">{sch.module_filter}</span>}
                        {sch.branch_filter && <span className="text-slate-500 text-xs bg-slate-700 px-2 py-0.5 rounded">📍 {sch.branch_filter}</span>}
                      </div>
                      <p className="text-slate-500 text-xs mt-1.5 font-mono truncate max-w-lg">{sch.template_subject}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-white text-sm font-semibold">{Number(sch.stats?.total_sent ?? 0)}</p>
                      <p className="text-slate-500 text-xs">sent</p>
                    </div>
                    <div className="text-right">
                      <p className="text-red-400 text-sm font-semibold">{Number(sch.stats?.failed ?? 0)}</p>
                      <p className="text-slate-500 text-xs">failed</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setEditing(sch)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300">
                        Edit
                      </button>
                      <button onClick={() => del(sch.id)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-red-700/30 hover:bg-red-700/50 text-red-400">
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
                {/* Preview */}
                <div className="mt-3 bg-slate-900/60 rounded-xl p-3 border border-white/5">
                  <p className="text-slate-400 text-xs font-mono whitespace-pre-line line-clamp-3">{sch.template_body}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing !== false && (
        <ScheduleModal
          schedule={editing}
          onClose={() => setEditing(false)}
          onSave={() => { setEditing(false); load(); }}
        />
      )}
    </div>
  );
}
