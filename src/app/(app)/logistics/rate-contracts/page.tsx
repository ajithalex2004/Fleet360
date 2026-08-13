/**
 * /logistics/rate-contracts — rate-contract editor.
 *
 * The authoring surface for lane rate cards: the list of the tenant's contracts
 * plus a create/edit form. This is where operators set base rate, fuel
 * surcharge, min charge, effective window — and the quantity-based pricing
 * basis (flat / per-km / per-kg / breakpoints) that the rate engine prices off.
 *
 * Two dashboard panels (RateCoveragePanel, ContractedRateLookup) deep-link
 * here; this page makes those links land somewhere.
 *
 * Reads/writes /api/logistics/rates/contracts. The rate basis round-trips
 * through metadata.rateBasis via the helpers in RateBasisEditor.
 */
'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Plus, Save, RefreshCw } from 'lucide-react';
import { PageHeader, Panel, StatusPill } from '@/components/ui/page-theme';
import { LogisticsMessage, readLogisticsApiError } from '@/components/logistics/master-data-fields';
import RateBasisEditor, {
  emptyRateBasis,
  rateBasisFromMetadata,
  rateBasisToPayload,
  validateRateBasis,
  type RateBasisValue,
} from '@/components/logistics/RateBasisEditor';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Contract {
  id: string;
  contractNo: string;
  customerId: string | null;
  customerName: string | null;
  carrierId: string | null;
  carrierName: string | null;
  laneOrigin: string;
  laneDestination: string;
  vehicleType: string | null;
  serviceLevel: string | null;
  currency: string;
  baseRate: number;
  minCharge: number | null;
  fuelSurchargePct: number | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  status: string;
  metadata: Record<string, unknown>;
}

interface FormState {
  id: string | null;
  contractNo: string;
  customerName: string;
  customerId: string;
  carrierId: string;
  laneOrigin: string;
  laneDestination: string;
  vehicleType: string;
  serviceLevel: string;
  currency: string;
  baseRate: string;
  minCharge: string;
  fuelSurchargePct: string;
  effectiveFrom: string;
  effectiveTo: string;
  status: string;
  metadata: Record<string, unknown>;
  rateBasis: RateBasisValue;
}

function blankForm(): FormState {
  return {
    id: null,
    contractNo: '',
    customerName: '',
    customerId: '',
    carrierId: '',
    laneOrigin: '',
    laneDestination: '',
    vehicleType: '',
    serviceLevel: '',
    currency: 'AED',
    baseRate: '',
    minCharge: '',
    fuelSurchargePct: '',
    effectiveFrom: '',
    effectiveTo: '',
    status: 'ACTIVE',
    metadata: {},
    rateBasis: emptyRateBasis(),
  };
}

function formFromContract(c: Contract): FormState {
  return {
    id: c.id,
    contractNo: c.contractNo ?? '',
    customerName: c.customerName ?? '',
    customerId: c.customerId ?? '',
    carrierId: c.carrierId ?? '',
    laneOrigin: c.laneOrigin ?? '',
    laneDestination: c.laneDestination ?? '',
    vehicleType: c.vehicleType ?? '',
    serviceLevel: c.serviceLevel ?? '',
    currency: c.currency ?? 'AED',
    baseRate: c.baseRate != null ? String(c.baseRate) : '',
    minCharge: c.minCharge != null ? String(c.minCharge) : '',
    fuelSurchargePct: c.fuelSurchargePct != null ? String(c.fuelSurchargePct) : '',
    effectiveFrom: (c.effectiveFrom ?? '').slice(0, 10),
    effectiveTo: (c.effectiveTo ?? '').slice(0, 10),
    status: c.status ?? 'ACTIVE',
    metadata: c.metadata ?? {},
    rateBasis: rateBasisFromMetadata(c.metadata),
  };
}

const inputCls =
  'w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/40';
const labelCls = 'text-[11px] uppercase tracking-wider text-slate-500 font-medium';

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RateContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(blankForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const res = await fetch('/api/logistics/rates/contracts?limit=200', { cache: 'no-store' });
      if (!res.ok) throw new Error((await readLogisticsApiError(res)).message);
      const body = await res.json();
      setContracts(Array.isArray(body.data) ? body.data : []);
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Failed to load contracts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const set = <K extends keyof FormState>(key: K, val: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: val }));

  const startNew = () => {
    setForm(blankForm());
    setFormError(null);
    setSuccess(null);
  };

  const edit = (c: Contract) => {
    setForm(formFromContract(c));
    setFormError(null);
    setSuccess(null);
  };

  const basisIssues = useMemo(() => validateRateBasis(form.rateBasis), [form.rateBasis]);

  const submit = async () => {
    setFormError(null);
    setSuccess(null);

    if (!form.laneOrigin.trim() || !form.laneDestination.trim()) {
      setFormError('Lane origin and destination are required.');
      return;
    }
    if (basisIssues.length > 0) {
      setFormError(basisIssues[0]);
      return;
    }

    // Strip any stale rateBasis from metadata — the rateBasis field is
    // authoritative (the route folds it back in, or clears it when flat).
    const metadata = { ...form.metadata };
    delete (metadata as Record<string, unknown>).rateBasis;

    setSaving(true);
    try {
      const res = await fetch('/api/logistics/rates/contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractNo: form.contractNo.trim() || null,
          customerName: form.customerName.trim() || null,
          customerId: form.customerId.trim() || null,
          carrierId: form.carrierId.trim() || null,
          laneOrigin: form.laneOrigin.trim(),
          laneDestination: form.laneDestination.trim(),
          vehicleType: form.vehicleType.trim() || null,
          serviceLevel: form.serviceLevel.trim() || null,
          currency: form.currency.trim() || 'AED',
          baseRate: form.baseRate === '' ? 0 : Number(form.baseRate),
          minCharge: form.minCharge === '' ? null : Number(form.minCharge),
          fuelSurchargePct: form.fuelSurchargePct === '' ? null : Number(form.fuelSurchargePct),
          effectiveFrom: form.effectiveFrom || null,
          effectiveTo: form.effectiveTo || null,
          status: form.status || 'ACTIVE',
          metadata,
          rateBasis: rateBasisToPayload(form.rateBasis),
        }),
      });
      if (!res.ok) throw new Error((await readLogisticsApiError(res)).message);
      const saved: Contract = await res.json();
      setSuccess(`Saved contract ${saved.contractNo}.`);
      setForm(formFromContract(saved));
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save contract');
    } finally {
      setSaving(false);
    }
  };

  const baseRateNum = form.baseRate === '' ? 0 : Number(form.baseRate) || 0;
  const isQty = form.rateBasis.mode !== 'flat';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rate contracts"
        subtitle="Lane rate cards the freight engine prices off — base rate, surcharges, and per-km / per-kg pricing."
        icon={FileText}
        accent="amber"
        actions={
          <button
            type="button"
            onClick={startNew}
            className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 px-3.5 py-2 text-sm hover:bg-amber-500/25"
          >
            <Plus className="w-4 h-4" /> New contract
          </button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] gap-6">
        {/* List */}
        <Panel
          title="Contracts"
          icon={FileText}
          accent="amber"
          actions={
            <button
              type="button"
              onClick={() => void load()}
              aria-label="Refresh"
              className="text-slate-400 hover:text-white"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          }
        >
          {listError && <LogisticsMessage type="error" message={listError} />}
          {!listError && loading && <p className="text-sm text-slate-500">Loading…</p>}
          {!loading && contracts.length === 0 && !listError && (
            <p className="text-sm text-slate-500">No contracts yet. Create one with “New contract”.</p>
          )}
          <div className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
            {contracts.map((c) => {
              const active = c.id === form.id;
              const mode = (c.metadata?.rateBasis as { mode?: string } | undefined)?.mode;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => edit(c)}
                  className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors ${
                    active
                      ? 'bg-amber-500/10 border-amber-500/40'
                      : 'bg-slate-800/40 border-white/10 hover:border-white/20'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-white truncate">{c.contractNo}</span>
                    <StatusPill status={c.status} />
                  </div>
                  <div className="text-xs text-slate-400 truncate mt-0.5">
                    {c.laneOrigin} → {c.laneDestination}
                  </div>
                  <div className="text-[11px] text-slate-600 mt-1 flex items-center gap-2">
                    <span>{c.customerName || 'Any customer'}</span>
                    {mode === 'per_km' && <span className="text-amber-300/80">· per km</span>}
                    {mode === 'per_kg' && <span className="text-amber-300/80">· per kg</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </Panel>

        {/* Editor */}
        <Panel
          title={form.id ? `Edit ${form.contractNo}` : 'New contract'}
          subtitle={form.id ? 'Update this lane rate card' : 'Define a lane rate card'}
          icon={FileText}
          accent="amber"
        >
          <div className="space-y-5">
            {/* Identity + lane */}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className={labelCls}>Contract no.</label>
                <input
                  value={form.contractNo}
                  onChange={(e) => set('contractNo', e.target.value)}
                  placeholder="Auto-generated when blank"
                  className={`${inputCls} mt-1.5`}
                />
              </div>
              <div>
                <label className={labelCls}>Lane origin *</label>
                <input
                  value={form.laneOrigin}
                  onChange={(e) => set('laneOrigin', e.target.value)}
                  placeholder="Dubai"
                  className={`${inputCls} mt-1.5`}
                />
              </div>
              <div>
                <label className={labelCls}>Lane destination *</label>
                <input
                  value={form.laneDestination}
                  onChange={(e) => set('laneDestination', e.target.value)}
                  placeholder="Abu Dhabi"
                  className={`${inputCls} mt-1.5`}
                />
              </div>
              <div>
                <label className={labelCls}>Customer name</label>
                <input
                  value={form.customerName}
                  onChange={(e) => set('customerName', e.target.value)}
                  placeholder="Any customer when blank"
                  className={`${inputCls} mt-1.5`}
                />
              </div>
              <div>
                <label className={labelCls}>Customer ID</label>
                <input
                  value={form.customerId}
                  onChange={(e) => set('customerId', e.target.value)}
                  placeholder="Optional"
                  className={`${inputCls} mt-1.5`}
                />
              </div>
              <div>
                <label className={labelCls}>Carrier ID</label>
                <input
                  value={form.carrierId}
                  onChange={(e) => set('carrierId', e.target.value)}
                  placeholder="Optional"
                  className={`${inputCls} mt-1.5`}
                />
              </div>
              <div>
                <label className={labelCls}>Vehicle type</label>
                <input
                  value={form.vehicleType}
                  onChange={(e) => set('vehicleType', e.target.value)}
                  placeholder="Any when blank"
                  className={`${inputCls} mt-1.5`}
                />
              </div>
              <div>
                <label className={labelCls}>Service level</label>
                <input
                  value={form.serviceLevel}
                  onChange={(e) => set('serviceLevel', e.target.value)}
                  placeholder="Any when blank"
                  className={`${inputCls} mt-1.5`}
                />
              </div>
              <div>
                <label className={labelCls}>Currency</label>
                <input
                  value={form.currency}
                  onChange={(e) => set('currency', e.target.value)}
                  className={`${inputCls} mt-1.5`}
                />
              </div>
            </div>

            {/* Pricing */}
            <div className="grid grid-cols-3 gap-3 pt-1 border-t border-white/5">
              <div className="pt-4">
                <label className={labelCls}>{isQty ? 'Base rate · flat fallback' : 'Base rate'}</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.baseRate}
                  onChange={(e) => set('baseRate', e.target.value)}
                  placeholder="0.00"
                  className={`${inputCls} mt-1.5`}
                />
              </div>
              <div className="pt-4">
                <label className={labelCls}>Min charge</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.minCharge}
                  onChange={(e) => set('minCharge', e.target.value)}
                  placeholder="—"
                  className={`${inputCls} mt-1.5`}
                />
              </div>
              <div className="pt-4">
                <label className={labelCls}>Fuel surcharge %</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.fuelSurchargePct}
                  onChange={(e) => set('fuelSurchargePct', e.target.value)}
                  placeholder="—"
                  className={`${inputCls} mt-1.5`}
                />
              </div>
            </div>

            {/* Rate basis */}
            <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
              <RateBasisEditor
                value={form.rateBasis}
                onChange={(v) => set('rateBasis', v)}
                fallbackFlat={baseRateNum}
                currency={form.currency || 'AED'}
              />
            </div>

            {/* Effective window + status */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Effective from</label>
                <input
                  type="date"
                  value={form.effectiveFrom}
                  onChange={(e) => set('effectiveFrom', e.target.value)}
                  className={`${inputCls} mt-1.5`}
                />
              </div>
              <div>
                <label className={labelCls}>Effective to</label>
                <input
                  type="date"
                  value={form.effectiveTo}
                  onChange={(e) => set('effectiveTo', e.target.value)}
                  className={`${inputCls} mt-1.5`}
                />
              </div>
              <div>
                <label className={labelCls}>Status</label>
                <select
                  value={form.status}
                  onChange={(e) => set('status', e.target.value)}
                  className={`${inputCls} mt-1.5`}
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="DRAFT">DRAFT</option>
                  <option value="EXPIRED">EXPIRED</option>
                  <option value="ARCHIVED">ARCHIVED</option>
                </select>
              </div>
            </div>

            {formError && <LogisticsMessage type="error" message={formError} />}
            {success && <LogisticsMessage type="success" message={success} />}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={startNew}
                className="rounded-xl border border-white/10 text-slate-300 px-4 py-2.5 text-sm hover:bg-slate-800"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 text-slate-950 font-medium px-4 py-2.5 text-sm hover:bg-amber-400 disabled:opacity-50"
              >
                <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save contract'}
              </button>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
