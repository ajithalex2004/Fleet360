'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Ban, RefreshCcw, Star, TrendingUp } from 'lucide-react';
import { KpiCard, KpiGrid, PageHeader, Panel, StatusPill } from '@/components/ui/page-theme';

type SessionMe = { tenantId: string };
type Scorecard = {
  id: string;
  carrierId: string;
  carrierName: string | null;
  onTimeRate: number | null;
  acceptanceRate: number | null;
  cancellationRate: number | null;
  claimRate: number | null;
  complianceScore: number | null;
  averageRating: number | null;
  shipmentsCompleted: number;
  qualityScore: number;
  preferred: boolean;
  blacklisted: boolean;
  blacklistReason: string | null;
  status: string;
};

function useTenantQuery(tenantId: string | null) {
  return useCallback((path: string, extra?: Record<string, string | number | null | undefined>) => {
    const params = new URLSearchParams();
    if (tenantId) params.set('tenantId', tenantId);
    Object.entries(extra ?? {}).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') params.set(key, String(value));
    });
    const query = params.toString();
    return `${path}${query ? `?${query}` : ''}`;
  }, [tenantId]);
}

export default function LogisticsCarrierScorecardsPage() {
  const [me, setMe] = useState<SessionMe | null>(null);
  const [scorecards, setScorecards] = useState<Scorecard[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const tenantId = me?.tenantId ?? null;
  const url = useTenantQuery(tenantId);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scorecards.filter(row => !q || [
      row.carrierName,
      row.blacklistReason,
      row.status,
    ].some(value => value?.toLowerCase().includes(q)));
  }, [scorecards, search]);

  const loadSession = useCallback(async () => {
    const res = await fetch('/api/auth/me', { cache: 'no-store' });
    if (!res.ok) throw new Error('Please sign in before opening carrier scorecards.');
    setMe(await res.json());
  }, []);

  const loadData = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(url('/api/logistics/carrier-scorecards', { limit: 200 }), { cache: 'no-store' });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setScorecards(Array.isArray(json.scorecards) ? json.scorecards : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load carrier scorecards');
    } finally {
      setLoading(false);
    }
  }, [tenantId, url]);

  useEffect(() => {
    loadSession().catch(err => {
      setError(err instanceof Error ? err.message : 'Failed to load session');
      setLoading(false);
    });
  }, [loadSession]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const setRule = useCallback(async (row: Scorecard, next: { preferred?: boolean; blacklisted?: boolean }) => {
    if (!tenantId) return;
    setSaving(row.carrierId);
    try {
      const res = await fetch(url('/api/logistics/carrier-scorecards'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          carrierId: row.carrierId,
          preferred: next.preferred ?? row.preferred,
          blacklisted: next.blacklisted ?? row.blacklisted,
          blacklistReason: next.blacklisted ? 'Set from scorecard governance' : row.blacklistReason,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update carrier rule');
    } finally {
      setSaving('');
    }
  }, [loadData, tenantId, url]);

  const preferred = scorecards.filter(row => row.preferred).length;
  const blacklisted = scorecards.filter(row => row.blacklisted).length;
  const avgScore = scorecards.length ? Math.round(scorecards.reduce((sum, row) => sum + row.qualityScore, 0) / scorecards.length) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Carrier Scorecards"
        subtitle="Preferred and blacklisted carrier rules, performance scores, SLA quality, compliance, and risk posture."
        icon={TrendingUp}
        accent="emerald"
        actions={<button onClick={loadData} className="btn-secondary inline-flex items-center gap-2"><RefreshCcw className="h-4 w-4" /> Refresh</button>}
      />
      {error && <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 p-4 text-sm font-semibold text-rose-100">{error}</div>}
      <KpiGrid>
        <KpiCard label="Scorecards" value={scorecards.length} icon={TrendingUp} accent="blue" />
        <KpiCard label="Avg Score" value={avgScore} icon={Star} accent="amber" />
        <KpiCard label="Preferred" value={preferred} icon={BadgeCheck} accent="emerald" />
        <KpiCard label="Blacklisted" value={blacklisted} icon={Ban} accent="rose" />
      </KpiGrid>

      <Panel
        title="Carrier Governance Rules"
        subtitle={loading ? 'Loading performance rules...' : `${filtered.length} scorecard(s)`}
        icon={Star}
        accent="emerald"
        actions={<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search carrier..." className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none" />}
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.12em] text-slate-400">
              <tr>
                <th className="px-3 py-3">Carrier</th>
                <th className="px-3 py-3">Quality</th>
                <th className="px-3 py-3">SLA</th>
                <th className="px-3 py-3">Compliance</th>
                <th className="px-3 py-3">Rules</th>
                <th className="px-3 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => (
                <tr key={row.id} className="border-t border-white/8">
                  <td className="px-3 py-4">
                    <div className="font-semibold text-white">{row.carrierName ?? row.carrierId}</div>
                    <div className="text-xs text-slate-400">{row.shipmentsCompleted} completed · rating {row.averageRating ?? '-'}</div>
                  </td>
                  <td className="px-3 py-4 font-semibold text-emerald-300">{row.qualityScore}/100</td>
                  <td className="px-3 py-4 text-slate-300">On-time {row.onTimeRate ?? 0}% · claims {row.claimRate ?? 0}%</td>
                  <td className="px-3 py-4 text-slate-300">{row.complianceScore ?? 0}%</td>
                  <td className="px-3 py-4">
                    <div className="flex flex-wrap gap-2">
                      {row.preferred && <StatusPill status="active" label="Preferred" />}
                      {row.blacklisted && <StatusPill status="danger" label="Blacklisted" />}
                      {!row.preferred && !row.blacklisted && <StatusPill status="info" label="Neutral" />}
                    </div>
                  </td>
                  <td className="px-3 py-4">
                    <div className="flex gap-2">
                      <button disabled={saving === row.carrierId} onClick={() => setRule(row, { preferred: !row.preferred, blacklisted: false })} className="rounded-lg border border-emerald-300 bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-900">
                        {row.preferred ? 'Unprefer' : 'Prefer'}
                      </button>
                      <button disabled={saving === row.carrierId} onClick={() => setRule(row, { blacklisted: !row.blacklisted, preferred: false })} className="rounded-lg border border-rose-300 bg-rose-100 px-3 py-1.5 text-xs font-semibold text-rose-900">
                        {row.blacklisted ? 'Unblock' : 'Blacklist'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-12 text-center text-slate-500">No carrier scorecards yet. Scorecards are created when carrier performance is imported or posted.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
