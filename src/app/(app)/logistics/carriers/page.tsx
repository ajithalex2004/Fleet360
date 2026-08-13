'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Building2, ClipboardCheck, Plus, RefreshCw, ShieldCheck, Smartphone, Users, X } from 'lucide-react';
import { PageHeader, KpiCard } from '@/components/ui/page-theme';
import LogisticsDataGrid, { type DataGridColumn } from '@/components/logistics/LogisticsDataGrid';

interface Carrier {
  id: string;
  carrierCode: string | null;
  carrierType: string | null;
  name: string;
  tradeLicense: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  status: string;
  onboardingStatus: string;
  complianceStatus: string;
  commissionModel: string | null;
  commissionRate: number | null;
  createdAt: string | null;
}

const EMPTY = {
  name: '', carrierCode: '', contactName: '', contactEmail: '', contactPhone: '',
  tradeLicense: '', carrierType: 'TRANSPORT_COMPANY', onboardingStatus: 'DRAFT',
  complianceStatus: 'PENDING', commissionModel: '', commissionRate: '',
};

const chip = (value: string) =>
  value === 'ACTIVE' || value === 'VERIFIED' || value === 'APPROVED'
    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
    : value === 'SUSPENDED' || value === 'REJECTED' || value === 'EXPIRED'
      ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
      : 'bg-amber-500/15 text-amber-300 border-amber-500/30';

// Carrier type catalog. The code prefix encodes the type: owner-operator (gig
// driver) → DR-, transport company → TR-, broker → BR-.
const CARRIER_TYPES = [
  { value: 'TRANSPORT_COMPANY', label: 'Transport company', prefix: 'TR' },
  { value: 'OWNER_OPERATOR',    label: 'Owner-operator (driver)', prefix: 'DR' },
  { value: 'BROKER',            label: 'Broker', prefix: 'BR' },
] as const;
const prefixFor = (type: string) => CARRIER_TYPES.find(t => t.value === type)?.prefix ?? 'CR';
const typeLabel = (type: string | null) => CARRIER_TYPES.find(t => t.value === type)?.label ?? (type ? type.replace(/_/g, ' ') : '—');

export default function LogisticsCarriersPage() {
  const [rows, setRows] = useState<Carrier[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deviceToken, setDeviceToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/logistics/carriers?status=&limit=500', { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setRows(Array.isArray(body.data) ? body.data : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Next sequential carrier code for a type's prefix, derived from the codes
  // already in the loaded list (e.g. DR-0001 → DR-0002).
  const nextCarrierCode = useCallback((type: string) => {
    const prefix = prefixFor(type);
    const re = new RegExp('^' + prefix + '-(\\d+)$', 'i');
    let max = 0;
    for (const r of rows) {
      const m = r.carrierCode?.match(re);
      if (m) max = Math.max(max, parseInt(m[1], 10) || 0);
    }
    return prefix + '-' + String(max + 1).padStart(4, '0');
  }, [rows]);

  const openForm = () => {
    setForm({ ...EMPTY, carrierCode: nextCarrierCode(EMPTY.carrierType) });
    setError(null);
    setShowForm(true);
  };

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const res = await fetch('/api/logistics/carriers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          // Go LogisticsCarrier: commissionModel is *string, commissionRate is
          // *float64. The form has no commission field, so never ship the
          // empty-string defaults — coerce to null (or a number), else Go's
          // JSON unmarshal rejects the whole payload with a 400.
          commissionModel: form.commissionModel || null,
          commissionRate: form.commissionRate ? Number(form.commissionRate) : null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed to save carrier');
      setShowForm(false); setForm({ ...EMPTY });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save carrier');
    } finally {
      setSaving(false);
    }
  };

  const issueDevice = async (carrierId: string) => {
    setDeviceToken(null);
    const res = await fetch(`/api/logistics/carriers/${carrierId}/app-device`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'WEB' }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) setDeviceToken(body.token ?? body.deviceToken ?? JSON.stringify(body));
  };

  const columns = useMemo<DataGridColumn<Carrier>[]>(() => [
    {
      key: 'carrier', header: 'Carrier', accessor: r => r.name,
      render: r => <div><div className="font-medium text-white">{r.name}</div><div className="text-xs text-slate-500 font-mono">{r.carrierCode ?? r.id.slice(0, 8)}</div></div>,
    },
    {
      key: 'type', header: 'Type', accessor: r => typeLabel(r.carrierType), filter: 'select',
      render: r => <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${r.carrierType === 'OWNER_OPERATOR' ? 'bg-sky-500/15 text-sky-300 border-sky-500/30' : r.carrierType === 'BROKER' ? 'bg-violet-500/15 text-violet-300 border-violet-500/30' : 'bg-slate-500/15 text-slate-300 border-slate-500/30'}`}>{typeLabel(r.carrierType)}</span>,
    },
    {
      key: 'contact', header: 'Contact', accessor: r => r.contactEmail ?? '',
      render: r => <div><div className="text-slate-300">{r.contactName ?? '-'}</div><div className="text-xs text-slate-500">{r.contactEmail ?? r.contactPhone ?? '-'}</div></div>,
    },
    { key: 'onboarding', header: 'Onboarding', accessor: r => r.onboardingStatus, filter: 'select', render: r => <Pill value={r.onboardingStatus} /> },
    { key: 'compliance', header: 'Compliance', accessor: r => r.complianceStatus, filter: 'select', render: r => <Pill value={r.complianceStatus} /> },
    { key: 'status', header: 'Status', accessor: r => r.status, filter: 'select', render: r => <Pill value={r.status} /> },
    {
      key: 'actions', header: '', accessor: r => r.id, sortable: false, filter: false, align: 'right',
      render: r => <button type="button" onClick={() => void issueDevice(r.id)} className="inline-flex items-center gap-1 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-xs font-medium text-sky-200 hover:bg-sky-500/20"><Smartphone className="h-3.5 w-3.5" /> Device token</button>,
    },
  ], []);

  const verified = rows.filter(r => ['VERIFIED', 'COMPLIANT'].includes(r.complianceStatus)).length;
  const active = rows.filter(r => r.status === 'ACTIVE').length;
  const onboarding = rows.filter(r => !['APPROVED', 'ACTIVE'].includes(r.onboardingStatus)).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Carrier network"
        subtitle="Onboard carriers, track compliance, provision app access, and prepare the partner network for marketplace scale."
        icon={Building2}
        accent="emerald"
        actions={
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-300 hover:bg-white/5"><RefreshCw className="h-4 w-4" /> Refresh</button>
            <button type="button" onClick={openForm} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"><Plus className="h-4 w-4" /> Add carrier</button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Carriers" value={rows.length} sub="Network size" icon={Users} accent="emerald" />
        <KpiCard label="Active" value={active} sub="Can receive loads" icon={BadgeCheck} accent="emerald" />
        <KpiCard label="Verified" value={verified} sub="Compliance ready" icon={ShieldCheck} accent="cyan" />
        <KpiCard label="In onboarding" value={onboarding} sub="Needs attention" icon={ClipboardCheck} accent="amber" />
      </div>

      {deviceToken && (
        <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-sm text-sky-100">
          New carrier app device token: <span className="font-mono break-all">{deviceToken}</span>
        </div>
      )}

      <LogisticsDataGrid rows={rows} columns={columns} getRowId={r => r.id} loading={loading} emptyMessage="No carriers found" initialSort={{ key: 'carrier', dir: 'asc' }} toolbar={{ exportName: 'logistics-carriers' }} />

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-slate-950 p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Add carrier</h2>
              <button type="button" onClick={() => setShowForm(false)} className="rounded-lg p-1 text-slate-400 hover:bg-white/5 hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <LabeledSelect label="Carrier type" value={form.carrierType} options={CARRIER_TYPES} onChange={v => setForm(f => ({ ...f, carrierType: v, carrierCode: nextCarrierCode(v) }))} />
              <Input label="Carrier code" value={form.carrierCode} onChange={v => setForm(f => ({ ...f, carrierCode: v }))} />
              <Input label="Carrier name" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} />
              <Input label="Contact name" value={form.contactName} onChange={v => setForm(f => ({ ...f, contactName: v }))} />
              <Input label="Contact email" value={form.contactEmail} onChange={v => setForm(f => ({ ...f, contactEmail: v }))} />
              <Input label="Contact phone" value={form.contactPhone} onChange={v => setForm(f => ({ ...f, contactPhone: v }))} />
              <Input label="Trade license" value={form.tradeLicense} onChange={v => setForm(f => ({ ...f, tradeLicense: v }))} />
              <Select label="Onboarding" value={form.onboardingStatus} options={['DRAFT', 'IN_REVIEW', 'APPROVED', 'SUSPENDED']} onChange={v => setForm(f => ({ ...f, onboardingStatus: v }))} />
              <Select label="Compliance" value={form.complianceStatus} options={['PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED']} onChange={v => setForm(f => ({ ...f, complianceStatus: v }))} />
            </div>
            {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setShowForm(false)} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5">Cancel</button>
              <button type="button" disabled={saving} onClick={() => void save()} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{saving ? 'Saving...' : 'Save carrier'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Pill({ value }: { value: string }) {
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${chip(value)}`}>{value.replace(/_/g, ' ')}</span>;
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block"><span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">{label}</span><input value={value} onChange={e => onChange(e.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/40" /></label>;
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label className="block"><span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">{label}</span><select value={value} onChange={e => onChange(e.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/40">{options.map(o => <option key={o}>{o}</option>)}</select></label>;
}

function LabeledSelect({ label, value, options, onChange }: { label: string; value: string; options: ReadonlyArray<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return <label className="block"><span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">{label}</span><select value={value} onChange={e => onChange(e.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/40">{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>;
}
