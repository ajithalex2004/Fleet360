'use client';

/**
 * /admin/tenants/[id]/ticket-types
 *
 * Per-tenant access matrix for the 7 Service & Support ticket types.
 * Platform admin (or tenant admin) can enable / disable each type and
 * override the default first-response SLA hours per tenant.
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Headphones, ArrowLeft, Save, AlertCircle } from 'lucide-react';
import { TICKET_TYPE_LIST } from '@/lib/service-tickets/config';
import type { TicketType, TenantTicketTypeAccess } from '@/types/service-tickets';

interface Row extends TenantTicketTypeAccess {}

export default function TicketTypesAccessPage() {
  const params   = useParams<{ id: string }>();
  const tenantId = params?.id ?? '';

  const [tenantName, setTenantName] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [saved, setSaved]     = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true); setError(null);
    try {
      const [matrixRes, tenantRes] = await Promise.all([
        fetch(`/api/admin/tenants/${tenantId}/ticket-types`),
        fetch(`/api/admin/tenants/${tenantId}`),
      ]);
      if (!matrixRes.ok) {
        const d = await matrixRes.json().catch(() => ({}));
        throw new Error(d?.error ?? 'Failed to load matrix');
      }
      const data = await matrixRes.json();
      setRows(data.matrix ?? []);
      if (tenantRes.ok) {
        const t = await tenantRes.json();
        setTenantName(t?.name ?? '');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  const updateRow = (type: TicketType, patch: Partial<Row>) => {
    setRows(prev => prev.map(r => (r.ticketType === type ? { ...r, ...patch } : r)));
  };

  const save = async () => {
    setSaving(true); setError(null); setSaved(false);
    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}/ticket-types`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: rows.map(r => ({
            ticketType: r.ticketType,
            enabled: r.enabled,
            slaOverrideHours: r.slaOverrideHours ?? null,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.error ?? 'Save failed'); return; }
      setRows(data.matrix ?? rows);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full"><div className="text-slate-400 animate-pulse">Loading access matrix…</div></div>;
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white inline-flex items-center gap-2">
            <Headphones className="w-5 h-5 text-violet-400" /> Service-Ticket types
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            {tenantName ? <>For <strong className="text-white">{tenantName}</strong></> : null}
            <span className="ml-2 text-slate-500">· toggle which ticket types this tenant can use, and override the default SLA</span>
          </p>
        </div>
        <Link href="/admin/tenants"
          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-slate-800 border border-white/10 hover:border-white/20 hover:bg-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:text-white transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Tenants
        </Link>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-300 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}
      {saved && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3 text-emerald-300 text-sm">Saved.</div>
      )}

      <div className="rounded-2xl bg-slate-900/60 border border-white/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-slate-500 text-[11px] uppercase tracking-wider bg-slate-900/40">
              <th className="text-left px-5 py-3 font-medium">Type</th>
              <th className="text-left px-3 py-3 font-medium">Prefix</th>
              <th className="text-left px-3 py-3 font-medium">Default SLA</th>
              <th className="text-left px-3 py-3 font-medium">SLA override (hours)</th>
              <th className="text-center px-5 py-3 font-medium">Enabled</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {TICKET_TYPE_LIST.map(cfg => {
              const row = rows.find(r => r.ticketType === cfg.type);
              if (!row) return null;
              const Icon = cfg.icon;
              return (
                <tr key={cfg.type} className="hover:bg-white/[0.02]">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${TONE_BG[cfg.tone]}`}>
                        <Icon className={`w-4 h-4 ${TONE_FG[cfg.tone]}`} strokeWidth={2} />
                      </div>
                      <div>
                        <div className="text-white font-medium">{cfg.longLabel}</div>
                        <div className="text-[11px] text-slate-500 max-w-md leading-tight">{cfg.description}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <code className="text-[11px] font-mono text-slate-300 bg-slate-700/40 px-2 py-0.5 rounded">{cfg.prefix}</code>
                  </td>
                  <td className="px-3 py-3 text-slate-400 text-xs whitespace-nowrap">
                    {fmtHours(cfg.defaultSlaHours)}
                  </td>
                  <td className="px-3 py-3">
                    <input type="number" min="0" max="8760"
                      placeholder={String(cfg.defaultSlaHours)}
                      value={row.slaOverrideHours ?? ''}
                      onChange={e => updateRow(cfg.type, {
                        slaOverrideHours: e.target.value === '' ? null : Number(e.target.value),
                      })}
                      disabled={!row.enabled}
                      className="w-24 bg-slate-800 border border-white/10 rounded-lg px-2 py-1 text-white text-sm disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-violet-500" />
                  </td>
                  <td className="px-5 py-3 text-center">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only peer"
                        checked={row.enabled}
                        onChange={e => updateRow(cfg.type, { enabled: e.target.checked })} />
                      <div className="w-11 h-6 bg-slate-700 peer-focus:ring-2 peer-focus:ring-violet-500 rounded-full peer-checked:bg-emerald-600 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-transform peer-checked:after:translate-x-5" />
                    </label>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          Defaults: every ticket type is <strong className="text-emerald-400">enabled</strong> for any tenant without explicit configuration.
          Disabling a type here hides it from the tenant&rsquo;s Service &amp; Support module.
        </p>
        <button onClick={save} disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-all shadow-lg shadow-violet-500/30">
          <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save matrix'}
        </button>
      </div>
    </div>
  );
}

function fmtHours(h: number): string {
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

const TONE_BG: Record<string, string> = {
  gold: 'bg-amber-500/10', blue: 'bg-blue-500/10', emerald: 'bg-emerald-500/10',
  amber: 'bg-amber-500/10', rose: 'bg-rose-500/10', slate: 'bg-slate-500/10',
  violet: 'bg-violet-500/10',
};
const TONE_FG: Record<string, string> = {
  gold: 'text-amber-300', blue: 'text-blue-300', emerald: 'text-emerald-300',
  amber: 'text-amber-300', rose: 'text-rose-300', slate: 'text-slate-300',
  violet: 'text-violet-300',
};
