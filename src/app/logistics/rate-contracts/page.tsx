'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeDollarSign, Map, Plus, RefreshCcw, Route } from 'lucide-react';
import { KpiCard, KpiGrid, PageHeader, Panel, StatusPill } from '@/components/ui/page-theme';

type SessionMe = { tenantId: string };
type RateContract = {
  id: string;
  contractNo: string;
  customerName: string | null;
  carrierName: string | null;
  laneOrigin: string;
  laneDestination: string;
  vehicleType: string | null;
  serviceLevel: string | null;
  currency: string;
  baseRate: number;
  minCharge: number | null;
  fuelSurchargePct: number | null;
  status: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
};

const emptyForm = {
  customerName: '',
  laneOrigin: '',
  laneDestination: '',
  vehicleType: '',
  serviceLevel: 'STANDARD',
  currency: 'AED',
  baseRate: '',
  minCharge: '',
  fuelSurchargePct: '',
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

export default function LogisticsRateContractsPage() {
  const [me, setMe] = useState<SessionMe | null>(null);
  const [contracts, setContracts] = useState<RateContract[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const tenantId = me?.tenantId ?? null;
  const url = useTenantQuery(tenantId);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contracts.filter(contract => !q || [
      contract.contractNo,
      contract.customerName,
      contract.carrierName,
      contract.laneOrigin,
      contract.laneDestination,
      contract.vehicleType,
    ].some(value => value?.toLowerCase().includes(q)));
  }, [contracts, search]);

  const loadSession = useCallback(async () => {
    const res = await fetch('/api/auth/me', { cache: 'no-store' });
    if (!res.ok) throw new Error('Please sign in before opening rate contracts.');
    setMe(await res.json());
  }, []);

  const loadData = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(url('/api/logistics/rate-contracts', { limit: 200 }), { cache: 'no-store' });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setContracts(Array.isArray(json.contracts) ? json.contracts : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load rate contracts');
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

  const save = useCallback(async () => {
    if (!tenantId) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch(url('/api/logistics/rate-contracts'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          tenantId,
          baseRate: Number(form.baseRate || 0),
          minCharge: form.minCharge ? Number(form.minCharge) : null,
          fuelSurchargePct: form.fuelSurchargePct ? Number(form.fuelSurchargePct) : null,
          accessorialRules: { source: 'rate-contracts-ui' },
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setNotice('Rate contract saved.');
      setForm(emptyForm);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save rate contract');
    } finally {
      setSaving(false);
    }
  }, [form, loadData, tenantId, url]);

  const active = contracts.filter(row => row.status === 'ACTIVE').length;
  const contractRevenue = contracts.reduce((sum, row) => sum + Number(row.baseRate ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rate Contracts & Lane Pricing"
        subtitle="Contract and spot lane rates by customer, carrier, route, vehicle type, and service level."
        icon={Route}
        accent="blue"
        actions={<button onClick={loadData} className="btn-secondary inline-flex items-center gap-2"><RefreshCcw className="h-4 w-4" /> Refresh</button>}
      />
      {error && <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 p-4 text-sm font-semibold text-rose-100">{error}</div>}
      {notice && <div className="rounded-2xl border border-emerald-400/40 bg-emerald-500/10 p-4 text-sm font-semibold text-emerald-100">{notice}</div>}

      <KpiGrid>
        <KpiCard label="Contracts" value={contracts.length} icon={Map} accent="blue" />
        <KpiCard label="Active" value={active} icon={Route} accent="emerald" />
        <KpiCard label="Rate Base" value={`AED ${contractRevenue.toLocaleString()}`} icon={BadgeDollarSign} accent="amber" />
      </KpiGrid>

      <Panel title="New Lane Contract" icon={Plus} accent="blue">
        <div className="grid gap-3 md:grid-cols-4">
          {[
            ['customerName', 'Customer'],
            ['laneOrigin', 'Origin'],
            ['laneDestination', 'Destination'],
            ['vehicleType', 'Vehicle type'],
            ['serviceLevel', 'Service level'],
            ['currency', 'Currency'],
            ['baseRate', 'Base rate'],
            ['minCharge', 'Min charge'],
            ['fuelSurchargePct', 'Fuel %'],
          ].map(([key, label]) => (
            <label key={key} className="space-y-1 text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">
              <span>{label}</span>
              <input
                value={form[key as keyof typeof form]}
                onChange={event => setForm(current => ({ ...current, [key]: event.target.value }))}
                className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm font-semibold text-white outline-none focus:border-blue-300"
              />
            </label>
          ))}
        </div>
        <button onClick={save} disabled={saving || !form.laneOrigin || !form.laneDestination || !form.baseRate} className="btn-primary mt-4 inline-flex items-center gap-2 disabled:opacity-50">
          <Plus className="h-4 w-4" /> {saving ? 'Saving...' : 'Save contract'}
        </button>
      </Panel>

      <Panel
        title="Lane Price Book"
        subtitle={loading ? 'Loading rates...' : `${filtered.length} contract(s)`}
        icon={Map}
        accent="blue"
        actions={<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search lane, customer, carrier..." className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none" />}
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.12em] text-slate-400">
              <tr>
                <th className="px-3 py-3">Contract</th>
                <th className="px-3 py-3">Lane</th>
                <th className="px-3 py-3">Vehicle / Service</th>
                <th className="px-3 py-3">Rate</th>
                <th className="px-3 py-3">Fuel</th>
                <th className="px-3 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => (
                <tr key={row.id} className="border-t border-white/8">
                  <td className="px-3 py-4">
                    <div className="font-semibold text-white">{row.contractNo}</div>
                    <div className="text-xs text-slate-400">{row.customerName ?? row.carrierName ?? 'Open lane'}</div>
                  </td>
                  <td className="px-3 py-4 text-slate-300">{row.laneOrigin} → {row.laneDestination}</td>
                  <td className="px-3 py-4 text-slate-300">{row.vehicleType ?? 'Any'} · {row.serviceLevel ?? 'Standard'}</td>
                  <td className="px-3 py-4 font-semibold text-emerald-300">{row.currency} {row.baseRate.toLocaleString()}</td>
                  <td className="px-3 py-4 text-slate-300">{row.fuelSurchargePct ?? 0}%</td>
                  <td className="px-3 py-4"><StatusPill status={row.status === 'ACTIVE' ? 'active' : 'pending'} label={row.status} /></td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-12 text-center text-slate-500">No rate contracts found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
