'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface FixedAsset {
  id: string; asset_no: string; asset_name: string; asset_category: string;
  description: string | null; vehicle_id: string | null; registration_no: string | null;
  acquisition_date: string; acquisition_cost: string; residual_value: string;
  useful_life_months: number; depreciation_method: string; depreciation_rate: string | null;
  status: string; accumulated_depreciation: string; net_book_value: string;
  last_depreciation_date: string | null; supplier: string | null; location: string | null;
  disposal_date: string | null; disposal_proceeds: string | null; disposal_method: string | null;
}

interface DepScheduleLine {
  id: string; period_year: number; period_month: number;
  opening_nbv: string; depreciation: string; closing_nbv: string; is_posted: boolean;
}

interface Summary { total_cost: string; total_acc_dep: string; total_nbv: string; count: string; active_count: string; }

const CATEGORY_ICONS: Record<string, string> = {
  PASSENGER_VEHICLE: '🚗', LCV: '🚐', HEAVY_VEHICLE: '🚛', BUS: '🚌',
  AMBULANCE: '🚑', EQUIPMENT: '⚙️', OFFICE: '🖥️',
};
const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  FULLY_DEPRECIATED: 'text-[var(--text-muted)] bg-slate-500/10 border-slate-500/20',
  DISPOSED: 'text-red-400 bg-red-500/10 border-red-500/20',
  WRITTEN_OFF: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
};

function fmt(v: string | number) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return new Intl.NumberFormat('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
function pct(acc: string, cost: string) {
  const c = parseFloat(cost);
  if (!c) return 0;
  return Math.round((parseFloat(acc) / c) * 100);
}

/* ── Add Asset Modal ── */
function AddAssetModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    assetName: '', assetCategory: 'PASSENGER_VEHICLE', description: '',
    registrationNo: '', acquisitionDate: new Date().toISOString().slice(0, 10),
    acquisitionCost: '', residualValue: '0', usefulLifeMonths: '60',
    depreciationMethod: 'STRAIGHT_LINE', depreciationRate: '0.20',
    supplier: '', location: 'Dubai', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const s = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.assetName || !form.acquisitionCost || !form.acquisitionDate) return;
    setSaving(true);
    const res = await fetch('/api/finance/fixed-assets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, acquisitionCost: parseFloat(form.acquisitionCost), residualValue: parseFloat(form.residualValue || '0'), usefulLifeMonths: parseInt(form.usefulLifeMonths) }),
    });
    setSaving(false);
    if (res.ok) { onSaved(); onClose(); } else { const d = await res.json(); alert(d.error ?? 'Failed'); }
  };

  const inp = 'w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:border-purple-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto">
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-2xl my-4">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-subtle)]">
          <h2 className="text-lg font-bold text-[var(--text-main)]">Register Fixed Asset</h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-xl">×</button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Asset Name *</label>
              <input value={form.assetName} onChange={s('assetName')} placeholder="e.g. Toyota Camry 2024" className={inp} />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Category *</label>
              <select value={form.assetCategory} onChange={s('assetCategory')} className={inp}>
                {['PASSENGER_VEHICLE','LCV','HEAVY_VEHICLE','BUS','AMBULANCE','EQUIPMENT','OFFICE'].map(c =>
                  <option key={c} value={c}>{CATEGORY_ICONS[c]} {c.replace('_',' ')}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Acquisition Date *</label>
              <input type="date" value={form.acquisitionDate} onChange={s('acquisitionDate')} className={inp} />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Cost (AED) *</label>
              <input type="number" value={form.acquisitionCost} onChange={s('acquisitionCost')} placeholder="0.00" className={inp} />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Residual Value (AED)</label>
              <input type="number" value={form.residualValue} onChange={s('residualValue')} placeholder="0.00" className={inp} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Useful Life (Months)</label>
              <input type="number" value={form.usefulLifeMonths} onChange={s('usefulLifeMonths')} className={inp} />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Depreciation Method</label>
              <select value={form.depreciationMethod} onChange={s('depreciationMethod')} className={inp}>
                <option value="STRAIGHT_LINE">Straight Line</option>
                <option value="REDUCING_BALANCE">Reducing Balance</option>
              </select>
            </div>
            {form.depreciationMethod === 'REDUCING_BALANCE' && (
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Annual Rate (e.g. 0.20)</label>
                <input type="number" step="0.01" value={form.depreciationRate} onChange={s('depreciationRate')} className={inp} />
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Registration No.</label>
              <input value={form.registrationNo} onChange={s('registrationNo')} placeholder="e.g. Dubai A 12345" className={inp} />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Location</label>
              <select value={form.location} onChange={s('location')} className={inp}>
                {['Dubai','Abu Dhabi','Sharjah','Ajman','RAK','Fujairah','UAQ'].map(l => <option key={l}>{l}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Supplier</label>
              <input value={form.supplier} onChange={s('supplier')} className={inp} />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Description</label>
              <input value={form.description} onChange={s('description')} className={inp} />
            </div>
          </div>
        </div>
        <div className="flex gap-2 p-5 border-t border-[var(--border-subtle)]">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-[var(--border-subtle)] text-sm text-[var(--text-muted)] hover:text-[var(--text-main)]">Cancel</button>
          <button onClick={save} disabled={saving}
            className="flex-1 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold text-sm disabled:opacity-50">
            {saving ? 'Saving…' : 'Register Asset'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Depreciation Runner Modal ── */
function DepRunModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ processed: number; period: string } | null>(null);

  const run = async () => {
    setRunning(true);
    const res = await fetch('/api/finance/fixed-assets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'run_depreciation', period }),
    });
    const d = await res.json();
    setResult(d);
    setRunning(false);
    onDone();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-subtle)]">
          <h2 className="text-lg font-bold text-[var(--text-main)]">Run Depreciation</h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-xl">×</button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-[var(--text-muted)]">Calculate and record monthly depreciation for all ACTIVE assets. This will skip periods already processed.</p>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Period (YYYY-MM)</label>
            <input type="month" value={period} onChange={e => setPeriod(e.target.value)}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:border-purple-500" />
          </div>
          {result && (
            <div className="bg-emerald-900/20 border border-emerald-500/30 rounded-xl p-4">
              <p className="text-emerald-400 font-bold">✓ Depreciation Run Complete</p>
              <p className="text-sm text-[var(--text-muted)] mt-1">{result.processed} assets processed for period {result.period}</p>
            </div>
          )}
        </div>
        <div className="flex gap-2 p-5 border-t border-[var(--border-subtle)]">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-[var(--border-subtle)] text-sm text-[var(--text-muted)] hover:text-[var(--text-main)]">Close</button>
          <button onClick={run} disabled={running}
            className="flex-1 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold text-sm disabled:opacity-50">
            {running ? 'Running…' : '▶ Run Depreciation'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Disposal Modal ── */
function DisposeModal({ asset, onClose, onDone }: { asset: FixedAsset; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ disposalDate: new Date().toISOString().slice(0, 10), disposalProceeds: '0', disposalMethod: 'SOLD', notes: '' });
  const [result, setResult] = useState<{ gainLoss: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const s = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  const dispose = async () => {
    setSaving(true);
    const res = await fetch('/api/finance/fixed-assets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'dispose', assetId: asset.id, ...form }),
    });
    const d = await res.json();
    setResult(d);
    setSaving(false);
    onDone();
  };

  const inp = 'w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:border-purple-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-subtle)]">
          <h2 className="text-lg font-bold text-[var(--text-main)]">Dispose Asset</h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-xl">×</button>
        </div>
        <div className="p-5 space-y-3">
          <div className="bg-[var(--bg-surface)]/60 rounded-xl p-3">
            <p className="text-sm font-bold text-[var(--text-main)]">{asset.asset_no} — {asset.asset_name}</p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">Net Book Value: AED {fmt(asset.net_book_value)}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Disposal Date</label>
              <input type="date" value={form.disposalDate} onChange={s('disposalDate')} className={inp} />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Proceeds (AED)</label>
              <input type="number" value={form.disposalProceeds} onChange={s('disposalProceeds')} className={inp} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Method</label>
            <select value={form.disposalMethod} onChange={s('disposalMethod')} className={inp}>
              <option value="SOLD">Sold</option>
              <option value="SCRAPPED">Scrapped</option>
              <option value="DONATED">Donated</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Notes</label>
            <textarea value={form.notes} onChange={s('notes')} rows={2}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)] resize-none focus:outline-none focus:border-purple-500" />
          </div>
          {result && (
            <div className={`rounded-xl p-3 border ${result.gainLoss >= 0 ? 'bg-emerald-900/20 border-emerald-500/30' : 'bg-red-900/20 border-red-500/30'}`}>
              <p className={`font-bold text-sm ${result.gainLoss >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {result.gainLoss >= 0 ? '📈 Gain on Disposal' : '📉 Loss on Disposal'}: AED {fmt(Math.abs(result.gainLoss))}
              </p>
            </div>
          )}
        </div>
        <div className="flex gap-2 p-5 border-t border-[var(--border-subtle)]">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-[var(--border-subtle)] text-sm text-[var(--text-muted)] hover:text-[var(--text-main)]">Cancel</button>
          <button onClick={dispose} disabled={saving || !!result}
            className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold text-sm disabled:opacity-50">
            {saving ? 'Processing…' : 'Confirm Disposal'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Depreciation Schedule Drawer ── */
function ScheduleDrawer({ asset, onClose }: { asset: FixedAsset; onClose: () => void }) {
  const [schedule, setSchedule] = useState<DepScheduleLine[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/finance/fixed-assets?type=schedule&assetId=${asset.id}`)
      .then(r => r.json()).then(d => { setSchedule(d.data ?? []); setLoading(false); });
  }, [asset.id]);

  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50">
      <div className="w-[580px] bg-[var(--bg-surface)] border-l border-[var(--border-subtle)] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-subtle)]">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-main)]">{asset.asset_no}</h2>
            <p className="text-xs text-[var(--text-muted)]">{asset.asset_name} · Depreciation Schedule</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-xl">×</button>
        </div>
        <div className="p-5 grid grid-cols-3 gap-3 border-b border-[var(--border-subtle)]">
          <div className="bg-[var(--bg-surface)]/60 rounded-xl p-3">
            <p className="text-xs text-[var(--text-muted)]">Cost</p>
            <p className="text-base font-bold text-[var(--text-main)]">AED {fmt(asset.acquisition_cost)}</p>
          </div>
          <div className="bg-[var(--bg-surface)]/60 rounded-xl p-3">
            <p className="text-xs text-[var(--text-muted)]">Acc. Depreciation</p>
            <p className="text-base font-bold text-amber-400">AED {fmt(asset.accumulated_depreciation)}</p>
          </div>
          <div className="bg-[var(--bg-surface)]/60 rounded-xl p-3">
            <p className="text-xs text-[var(--text-muted)]">Net Book Value</p>
            <p className="text-base font-bold text-emerald-400">AED {fmt(asset.net_book_value)}</p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? <div className="h-32 bg-[var(--bg-surface)]/40 rounded-xl m-5 animate-pulse" /> : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-[var(--text-muted)] text-xs uppercase tracking-wider">
                  <th className="text-left px-4 py-2.5">Period</th>
                  <th className="text-right px-4 py-2.5">Opening NBV</th>
                  <th className="text-right px-4 py-2.5">Depreciation</th>
                  <th className="text-right px-4 py-2.5">Closing NBV</th>
                  <th className="text-center px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {schedule.map(row => (
                  <tr key={row.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface)]/40">
                    <td className="px-4 py-2 text-sm text-[var(--text-muted)]">{monthNames[row.period_month - 1]} {row.period_year}</td>
                    <td className="px-4 py-2 text-right text-sm text-[var(--text-muted)]">{fmt(row.opening_nbv)}</td>
                    <td className="px-4 py-2 text-right text-sm text-amber-400">({fmt(row.depreciation)})</td>
                    <td className="px-4 py-2 text-right text-sm text-[var(--text-main)] font-medium">{fmt(row.closing_nbv)}</td>
                    <td className="px-4 py-2 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${row.is_posted ? 'bg-emerald-900/40 text-emerald-400' : 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)]'}`}>
                        {row.is_posted ? 'Posted' : 'Draft'}
                      </span>
                    </td>
                  </tr>
                ))}
                {schedule.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--text-faint)] text-sm">No depreciation records yet. Run depreciation to generate.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default function FixedAssetsPage() {
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ACTIVE');
  const [showAdd, setShowAdd] = useState(false);
  const [showDepRun, setShowDepRun] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<FixedAsset | null>(null);
  const [disposeAsset, setDisposeAsset] = useState<FixedAsset | null>(null);
  const [scheduleAsset, setScheduleAsset] = useState<FixedAsset | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [aRes, sRes] = await Promise.all([
      fetch(`/api/finance/fixed-assets${statusFilter ? `?status=${statusFilter}` : ''}`),
      fetch('/api/finance/fixed-assets?type=summary'),
    ]);
    if (aRes.ok) { const d = await aRes.json(); setAssets(d.data ?? []); }
    if (sRes.ok) setSummary(await sRes.json());
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)]">Fixed Assets</h1>
          <p className="text-[var(--text-muted)] text-xs mt-0.5">Fleet Register with Depreciation</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowDepRun(true)}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-xl text-sm">
            ▶ Run Depreciation
          </button>
          <button onClick={() => setShowAdd(true)}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl text-sm">
            + Add Asset
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'Total Assets', value: `AED ${fmt(summary.total_cost)}`, sub: `${summary.count} assets`, color: 'text-[var(--text-main)]' },
            { label: 'Accumulated Depreciation', value: `AED ${fmt(summary.total_acc_dep)}`, sub: `${pct(summary.total_acc_dep, summary.total_cost)}% depreciated`, color: 'text-amber-400' },
            { label: 'Net Book Value', value: `AED ${fmt(summary.total_nbv)}`, sub: 'Current carrying value', color: 'text-emerald-400' },
            { label: 'Active Assets', value: summary.active_count, sub: 'In service', color: 'text-blue-400' },
          ].map(card => (
            <div key={card.label} className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-4">
              <p className="text-xs text-[var(--text-muted)]">{card.label}</p>
              <p className={`text-xl font-bold mt-1 ${card.color}`}>{card.value}</p>
              <p className="text-xs text-[var(--text-faint)] mt-0.5">{card.sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* Status filter */}
      <div className="flex gap-2">
        {['ACTIVE','FULLY_DEPRECIATED','DISPOSED','WRITTEN_OFF'].map(s => (
          <button key={s} onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${statusFilter === s ? 'bg-purple-600 text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-main)] bg-[var(--bg-surface)]'}`}>
            {s.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Asset Table */}
      {loading ? <div className="h-64 bg-[var(--bg-surface)]/60 rounded-2xl animate-pulse" /> : (
        <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] text-[var(--text-muted)] text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3 w-28">Asset No.</th>
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3 w-24">Category</th>
                <th className="text-left px-4 py-3 w-24">Status</th>
                <th className="text-right px-4 py-3 w-32">Cost (AED)</th>
                <th className="text-right px-4 py-3 w-32">Acc. Dep.</th>
                <th className="text-right px-4 py-3 w-32">NBV (AED)</th>
                <th className="text-center px-4 py-3 w-24">Dep. %</th>
                <th className="text-left px-4 py-3 w-24">Location</th>
                <th className="px-4 py-3 w-32"></th>
              </tr>
            </thead>
            <tbody>
              {assets.map(asset => {
                const depPct = pct(asset.accumulated_depreciation, asset.acquisition_cost);
                return (
                  <tr key={asset.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface)]/40">
                    <td className="px-4 py-3 font-mono text-xs text-purple-400">{asset.asset_no}</td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-[var(--text-main)] font-medium">{asset.asset_name}</p>
                      {asset.registration_no && <p className="text-xs text-[var(--text-faint)]">{asset.registration_no}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-base">{CATEGORY_ICONS[asset.asset_category] ?? '📦'}</span>
                      <span className="text-xs text-[var(--text-muted)] ml-1">{asset.asset_category.split('_')[0]}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_COLORS[asset.status] ?? ''}`}>
                        {asset.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-[var(--text-muted)]">{fmt(asset.acquisition_cost)}</td>
                    <td className="px-4 py-3 text-right text-sm text-amber-400">({fmt(asset.accumulated_depreciation)})</td>
                    <td className="px-4 py-3 text-right text-sm font-bold text-[var(--text-main)]">{fmt(asset.net_book_value)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-xs text-[var(--text-muted)]">{depPct}%</span>
                        <div className="w-full bg-[var(--bg-surface-hover)] rounded-full h-1.5">
                          <div className="bg-amber-500 h-1.5 rounded-full" style={{ width: `${depPct}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--text-muted)]">{asset.location ?? '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={() => setScheduleAsset(asset)}
                          className="px-2 py-1 bg-[var(--bg-surface-hover)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] rounded-lg text-xs">
                          Schedule
                        </button>
                        {asset.status === 'ACTIVE' && (
                          <button onClick={() => setDisposeAsset(asset)}
                            className="px-2 py-1 bg-red-900/40 hover:bg-red-900/60 text-red-400 rounded-lg text-xs">
                            Dispose
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {assets.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-[var(--text-faint)]">No assets found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && <AddAssetModal onClose={() => setShowAdd(false)} onSaved={load} />}
      {showDepRun && <DepRunModal onClose={() => setShowDepRun(false)} onDone={load} />}
      {disposeAsset && <DisposeModal asset={disposeAsset} onClose={() => setDisposeAsset(null)} onDone={load} />}
      {scheduleAsset && <ScheduleDrawer asset={scheduleAsset} onClose={() => setScheduleAsset(null)} />}
    </div>
  );
}
