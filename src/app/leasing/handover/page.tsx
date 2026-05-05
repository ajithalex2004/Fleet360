'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Search, X, AlertTriangle, Info, Star } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Handover {
  id: string;
  handoverNo: string;
  contractId: string | null;
  contractNo: string | null;
  lesseeName: string;
  vehicleId: string | null;
  vehicleNo: string;
  vehicleName: string | null;
  handoverType: string;
  handoverDate: string;
  location: string | null;
  fuelLevel: number | null;
  odometerReading: number | null;
  conditionScore: number | null;
  bodyCondition: string | null;
  interiorCondition: string | null;
  tyresCondition: string | null;
  keysCount: number;
  spareKey: boolean;
  salikTag: boolean;
  parkingCard: boolean;
  serviceBook: boolean;
  accessories: unknown[];
  checklistItems: ChecklistItem[];
  damageNotes: string | null;
  notes: string | null;
  signedBy: string | null;
  signedAt: string | null;
  witnessedBy: string | null;
  status: string;
  branchId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ChecklistItem {
  label: string;
  checked: boolean;
}

interface Summary {
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  scheduledDeliveries: number;
  scheduledReturns: number;
  completedToday: number;
  pendingSignoff: number;
}

interface ApiResponse {
  data: Handover[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  summary: Summary;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const FUEL_LABELS = ['Empty', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞', 'Full'];

const CONDITION_LABELS: Record<number, string> = {
  1: 'Poor', 2: 'Fair', 3: 'Good', 4: 'Very Good', 5: 'Excellent',
};

const CONDITION_OPTIONS = ['Good', 'Fair', 'Poor', 'Damaged', 'Excellent'];

const DEFAULT_CHECKLIST: ChecklistItem[] = [
  { label: 'Spare Tyre Present', checked: false },
  { label: 'Jack & Tools', checked: false },
  { label: 'First Aid Kit', checked: false },
  { label: 'Fire Extinguisher', checked: false },
  { label: 'Vehicle Registration', checked: false },
  { label: 'Insurance Card', checked: false },
  { label: 'Manufacturer Manual', checked: false },
  { label: 'Floor Mats', checked: false },
];

interface FormState {
  // Section 1
  contractNo: string;
  lesseeName: string;
  vehicleNo: string;
  vehicleName: string;
  handoverType: string;
  handoverDate: string;
  location: string;
  // Section 2
  fuelLevel: number;
  odometerReading: string;
  conditionScore: number;
  bodyCondition: string;
  interiorCondition: string;
  tyresCondition: string;
  // Section 3
  keysCount: number;
  spareKey: boolean;
  salikTag: boolean;
  parkingCard: boolean;
  serviceBook: boolean;
  // Section 4
  checklist: ChecklistItem[];
  // Section 5
  signedBy: string;
  witnessedBy: string;
  damageNotes: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  contractNo: '', lesseeName: '', vehicleNo: '', vehicleName: '',
  handoverType: 'DELIVERY',
  handoverDate: new Date().toISOString().slice(0, 16),
  location: '',
  fuelLevel: 4,
  odometerReading: '',
  conditionScore: 3,
  bodyCondition: 'Good',
  interiorCondition: 'Good',
  tyresCondition: 'Good',
  keysCount: 2,
  spareKey: false,
  salikTag: false,
  parkingCard: false,
  serviceBook: false,
  checklist: DEFAULT_CHECKLIST.map(c => ({ ...c })),
  signedBy: '',
  witnessedBy: '',
  damageNotes: '',
  notes: '',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function typePill(type: string) {
  return type === 'DELIVERY'
    ? 'bg-teal-900/40 text-teal-300 border border-teal-700/50'
    : 'bg-violet-900/40 text-violet-300 border border-violet-700/50';
}

function statusBadgeClass(status: string) {
  switch (status) {
    case 'SCHEDULED':    return 'bg-blue-900/40 text-blue-300 border border-blue-700';
    case 'IN_PROGRESS':  return 'bg-amber-900/40 text-amber-300 border border-amber-700';
    case 'COMPLETED':    return 'bg-emerald-900/40 text-emerald-300 border border-emerald-700';
    case 'DISPUTED':     return 'bg-red-900/40 text-red-300 border border-red-700';
    default:             return 'bg-slate-700/40 text-slate-300 border border-slate-600';
  }
}

function conditionStarColor(score: number | null) {
  if (score === null) return 'text-slate-600';
  if (score <= 2) return 'text-red-400';
  if (score === 3) return 'text-amber-400';
  return 'text-emerald-400';
}

function fmtDatetime(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, accent }: {
  label: string; value: string | number; sub?: string; accent: string;
}) {
  return (
    <div className="bg-slate-800/60 border border-white/10 rounded-xl p-5">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${accent}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function FuelGauge({ level }: { level: number | null }) {
  if (level === null) return <span className="text-slate-600 text-xs">—</span>;
  return (
    <div className="flex items-center gap-0.5" title={FUEL_LABELS[level]}>
      {Array.from({ length: 8 }, (_, i) => (
        <div
          key={i}
          className={`w-2.5 h-4 rounded-sm ${i < level ? 'bg-teal-400' : 'bg-slate-600'}`}
        />
      ))}
      <span className="ml-1.5 text-[10px] text-slate-400">{FUEL_LABELS[level]}</span>
    </div>
  );
}

function ConditionStars({ score }: { score: number | null }) {
  if (score === null) return <span className="text-slate-600 text-xs">—</span>;
  const color = conditionStarColor(score);
  return (
    <div className="flex items-center gap-0.5" title={CONDITION_LABELS[score]}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={`w-3 h-3 ${i < score ? color : 'text-slate-700'}`}
          fill={i < score ? 'currentColor' : 'none'}
        />
      ))}
      <span className={`ml-1 text-[10px] ${color}`}>{CONDITION_LABELS[score]}</span>
    </div>
  );
}

// ─── Fuel Level Selector ─────────────────────────────────────────────────────

function FuelSelector({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-end gap-1">
        {Array.from({ length: 9 }, (_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onChange(i)}
            className={`flex-1 rounded-t-sm transition-all ${
              i <= value
                ? 'bg-teal-500 hover:bg-teal-400'
                : 'bg-slate-700 hover:bg-slate-600'
            }`}
            style={{ height: `${16 + i * 4}px` }}
            title={FUEL_LABELS[i]}
          />
        ))}
      </div>
      <div className="flex justify-between text-[9px] text-slate-500 px-0.5">
        {FUEL_LABELS.map((l, i) => (
          <span key={i} className={value === i ? 'text-teal-400 font-bold' : ''}>{l}</span>
        ))}
      </div>
      <p className="text-center text-xs text-teal-300 font-semibold">{FUEL_LABELS[value]}</p>
    </div>
  );
}

// ─── Condition Score Selector ─────────────────────────────────────────────────

function ConditionSelector({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-2">
      {[1, 2, 3, 4, 5].map(s => {
        const color = conditionStarColor(s);
        const active = value === s;
        return (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            className={`flex-1 py-2 rounded-lg border transition-all flex flex-col items-center gap-1 ${
              active
                ? `${color} bg-slate-700 border-current`
                : 'text-slate-600 bg-slate-800/60 border-slate-700 hover:border-slate-500'
            }`}
          >
            <span className="text-base font-bold">{s}</span>
            <span className="text-[9px] leading-none">{CONDITION_LABELS[s]}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Complete & Sign Modal ────────────────────────────────────────────────────

function CompleteModal({
  handover,
  onClose,
  onComplete,
}: {
  handover: Handover;
  onClose: () => void;
  onComplete: (signedBy: string, witnessedBy: string, damageNotes: string) => Promise<void>;
}) {
  const [signedBy, setSignedBy]   = useState('');
  const [witnessedBy, setWitnessedBy] = useState('');
  const [damageNotes, setDamageNotes] = useState(handover.damageNotes ?? '');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!signedBy.trim()) return;
    setSaving(true);
    await onComplete(signedBy, witnessedBy, damageNotes);
    setSaving(false);
  }

  const inputCls = 'w-full px-3 py-2 rounded-lg bg-slate-700/80 border border-white/10 text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none text-sm';
  const labelCls = 'block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-slate-900 border border-white/10 rounded-2xl shadow-2xl p-6 space-y-4">
        <div>
          <h3 className="text-base font-bold text-white">Complete & Sign Handover</h3>
          <p className="text-xs text-slate-400">{handover.handoverNo} — {handover.vehicleNo}</p>
        </div>

        <div className="bg-violet-900/20 border border-violet-700/40 rounded-lg px-4 py-3 text-xs text-violet-300 flex items-start gap-2">
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
          Both parties must be present. This action is final and creates an audit record.
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={labelCls}>Signed By (Customer) <span className="text-red-400">*</span></label>
            <input value={signedBy} onChange={e => setSignedBy(e.target.value)}
              placeholder="Customer full name" className={inputCls} required />
          </div>
          <div>
            <label className={labelCls}>Witnessed By (Staff)</label>
            <input value={witnessedBy} onChange={e => setWitnessedBy(e.target.value)}
              placeholder="Staff member name" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Damage Notes</label>
            <textarea value={damageNotes} onChange={e => setDamageNotes(e.target.value)}
              placeholder="Any damage observed at handover…" rows={3}
              className={`${inputCls} resize-none`} />
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={saving || !signedBy.trim()}
              className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-all">
              {saving ? 'Signing…' : 'Complete & Sign'}
            </button>
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-semibold text-sm transition-colors">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function HandoverPage() {
  const [handovers, setHandovers] = useState<Handover[]>([]);
  const [summary, setSummary] = useState<Summary>({
    byStatus: {}, byType: {},
    scheduledDeliveries: 0, scheduledReturns: 0, completedToday: 0, pendingSignoff: 0,
  });
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);

  const [activeType, setActiveType]     = useState('ALL');
  const [activeStatus, setActiveStatus] = useState('ALL');
  const [search, setSearch]             = useState('');
  const [searchInput, setSearchInput]   = useState('');

  const [showModal, setShowModal] = useState(false);
  const [form, setForm]           = useState<FormState>({ ...EMPTY_FORM, checklist: DEFAULT_CHECKLIST.map(c => ({ ...c })) });
  const [saving, setSaving]       = useState(false);
  const [formError, setFormError] = useState('');
  const [activeSection, setActiveSection] = useState(1);

  const [completeTarget, setCompleteTarget] = useState<Handover | null>(null);

  const TYPE_TABS   = ['ALL', 'DELIVERY', 'RETURN'];
  const STATUS_TABS = ['ALL', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'DISPUTED'];

  const fetchHandovers = useCallback(async (pg = 1) => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (activeType !== 'ALL')   params.set('handover_type', activeType);
      if (activeStatus !== 'ALL') params.set('status', activeStatus);
      if (search)                 params.set('search', search);
      params.set('page', String(pg));
      params.set('limit', '20');

      const res = await fetch(`/api/leasing/handover?${params}`);
      if (!res.ok) throw new Error('Failed');
      const json: ApiResponse = await res.json();
      setHandovers(json.data);
      setSummary(json.summary);
      setPagination(json.pagination);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, [activeType, activeStatus, search]);

  useEffect(() => { fetchHandovers(1); }, [fetchHandovers]);

  function handleFormChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    const { name, value, type } = e.target;
    if (type === 'checkbox') {
      const checked = (e.target as HTMLInputElement).checked;
      setForm(prev => ({ ...prev, [name]: checked }));
    } else {
      setForm(prev => ({ ...prev, [name]: value }));
    }
  }

  function toggleChecklist(index: number) {
    setForm(prev => ({
      ...prev,
      checklist: prev.checklist.map((item, i) =>
        i === index ? { ...item, checked: !item.checked } : item
      ),
    }));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const res = await fetch('/api/leasing/handover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractNo:       form.contractNo       || undefined,
          lesseeName:       form.lesseeName,
          vehicleNo:        form.vehicleNo,
          vehicleName:      form.vehicleName       || undefined,
          handoverType:     form.handoverType,
          handoverDate:     form.handoverDate,
          location:         form.location          || undefined,
          fuelLevel:        form.fuelLevel,
          odometerReading:  form.odometerReading ? Number(form.odometerReading) : undefined,
          conditionScore:   form.conditionScore,
          bodyCondition:    form.bodyCondition,
          interiorCondition: form.interiorCondition,
          tyresCondition:   form.tyresCondition,
          keysCount:        form.keysCount,
          spareKey:         form.spareKey,
          salikTag:         form.salikTag,
          parkingCard:      form.parkingCard,
          serviceBook:      form.serviceBook,
          checklistItems:   form.checklist,
          damageNotes:      form.damageNotes       || undefined,
          notes:            form.notes             || undefined,
          signedBy:         form.signedBy          || undefined,
          witnessedBy:      form.witnessedBy       || undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error ?? 'Create failed');
      }
      setShowModal(false);
      setForm({ ...EMPTY_FORM, checklist: DEFAULT_CHECKLIST.map(c => ({ ...c })) });
      setActiveSection(1);
      fetchHandovers(1);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to create handover');
    } finally {
      setSaving(false);
    }
  }

  async function handleComplete(handover: Handover, signedBy: string, witnessedBy: string, damageNotes: string) {
    try {
      const res = await fetch(`/api/leasing/handover?id=${handover.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'COMPLETE', signedBy, witnessedBy, damageNotes }),
      });
      if (!res.ok) throw new Error('Failed to complete');
      setCompleteTarget(null);
      fetchHandovers(pagination.page);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Completion failed');
    }
  }

  const inputClass = 'w-full px-3 py-2 rounded-lg bg-slate-700/80 border border-white/10 text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none text-sm';
  const labelClass = 'block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1';

  const sections = [
    { num: 1, title: 'Contract Details' },
    { num: 2, title: 'Vehicle Condition' },
    { num: 3, title: 'Keys & Accessories' },
    { num: 4, title: 'Standard Checklist' },
    { num: 5, title: 'Completion' },
  ];

  return (
    <div className="space-y-6">

      {/* ─── Header ─── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Vehicle Handover & Return</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Digital handover checklists for vehicle delivery and end-of-lease return
          </p>
        </div>
        <button
          onClick={() => {
            setShowModal(true);
            setFormError('');
            setActiveSection(1);
            setForm({ ...EMPTY_FORM, checklist: DEFAULT_CHECKLIST.map(c => ({ ...c })) });
          }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white font-semibold text-sm shadow-lg shadow-violet-900/30 transition-all"
        >
          <Plus className="w-4 h-4" />
          Schedule Handover
        </button>
      </div>

      {/* ─── Important Notice Banner ─── */}
      <div className="flex items-start gap-3 bg-violet-900/20 border border-violet-700/40 rounded-xl px-5 py-4">
        <Info className="w-5 h-5 text-violet-400 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-violet-300">
          <span className="font-semibold">Important:</span> Every handover must be completed and signed before keys are transferred.
          Photos and condition assessment protect both lessor and lessee.
        </p>
      </div>

      {/* ─── KPI Cards ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Scheduled Deliveries"
          value={summary.scheduledDeliveries}
          sub="Upcoming vehicle deliveries"
          accent="text-teal-400"
        />
        <KpiCard
          label="Scheduled Returns"
          value={summary.scheduledReturns}
          sub="Upcoming end-of-lease returns"
          accent="text-violet-400"
        />
        <KpiCard
          label="Completed Today"
          value={summary.completedToday}
          sub="Handovers signed off today"
          accent="text-emerald-400"
        />
        <KpiCard
          label="Pending Sign-off"
          value={summary.pendingSignoff}
          sub="In-progress, awaiting signature"
          accent="text-amber-400"
        />
      </div>

      {/* ─── Filters ─── */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Type tabs */}
        <div className="flex gap-1 bg-slate-800/60 border border-white/10 rounded-xl p-1">
          {TYPE_TABS.map(t => (
            <button
              key={t}
              onClick={() => setActiveType(t)}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeType === t
                  ? t === 'DELIVERY'
                    ? 'bg-teal-600 text-white shadow-sm'
                    : t === 'RETURN'
                    ? 'bg-violet-600 text-white shadow-sm'
                    : 'bg-gradient-to-r from-violet-600 to-purple-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Status tabs */}
        <div className="flex gap-1 bg-slate-800/60 border border-white/10 rounded-xl p-1 flex-wrap">
          {STATUS_TABS.map(s => (
            <button
              key={s}
              onClick={() => setActiveStatus(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeStatus === s
                  ? 'bg-slate-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="flex gap-2 flex-1">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search vehicle, lessee, handover no…"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && setSearch(searchInput)}
              className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-800/60 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
            />
          </div>
          <button
            onClick={() => setSearch(searchInput)}
            className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors"
          >
            Search
          </button>
          {search && (
            <button
              onClick={() => { setSearch(''); setSearchInput(''); }}
              className="px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* ─── Table ─── */}
      <div className="bg-slate-800/50 border border-white/10 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 text-sm">Loading handovers…</div>
        ) : handovers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <p className="text-slate-400 text-sm">No handovers found</p>
            <p className="text-slate-600 text-xs">Schedule a delivery or return to get started</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-slate-900/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap">Handover No</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Contract No</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Lessee</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Vehicle No</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap">Date & Time</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Location</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Fuel</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Odometer</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Condition</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Signed By</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {handovers.map(h => (
                  <tr key={h.id} className="hover:bg-white/3 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-mono text-violet-300 text-xs font-medium">{h.handoverNo}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${typePill(h.handoverType)}`}>
                        {h.handoverType}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-300 text-xs">{h.contractNo ?? '—'}</td>
                    <td className="px-4 py-3 text-white font-medium text-xs">{h.lesseeName}</td>
                    <td className="px-4 py-3 text-xs">
                      <div className="text-white font-medium">{h.vehicleNo}</div>
                      {h.vehicleName && <div className="text-slate-500 text-[10px]">{h.vehicleName}</div>}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-300 whitespace-nowrap">{fmtDatetime(h.handoverDate)}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">{h.location ?? '—'}</td>
                    <td className="px-4 py-3"><FuelGauge level={h.fuelLevel} /></td>
                    <td className="px-4 py-3 text-xs text-slate-300">
                      {h.odometerReading ? `${h.odometerReading.toLocaleString()} km` : '—'}
                    </td>
                    <td className="px-4 py-3"><ConditionStars score={h.conditionScore} /></td>
                    <td className="px-4 py-3 text-xs text-slate-400">{h.signedBy ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusBadgeClass(h.status)}`}>
                        {h.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {['SCHEDULED', 'IN_PROGRESS'].includes(h.status) && (
                        <button
                          onClick={() => setCompleteTarget(h)}
                          className="px-2 py-1 rounded-lg bg-violet-600/20 border border-violet-600/40 text-violet-300 text-[10px] font-semibold hover:bg-violet-600/30 transition-colors whitespace-nowrap"
                        >
                          Complete & Sign
                        </button>
                      )}
                      {h.status === 'COMPLETED' && (
                        <span className="text-emerald-400 text-[10px]">Signed</span>
                      )}
                      {h.status === 'DISPUTED' && (
                        <span className="text-red-400 text-[10px]">Disputed</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-white/10">
            <span className="text-xs text-slate-500">
              Page {pagination.page} of {pagination.totalPages} — {pagination.total} handovers
            </span>
            <div className="flex gap-2">
              <button
                disabled={pagination.page <= 1}
                onClick={() => fetchHandovers(pagination.page - 1)}
                className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-xs disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <button
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => fetchHandovers(pagination.page + 1)}
                className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-xs disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ─── Schedule Handover Modal ─── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl max-h-[94vh] overflow-y-auto bg-slate-900 border border-white/10 rounded-2xl shadow-2xl">

            {/* Modal Header */}
            <div className="sticky top-0 z-10 bg-slate-900 border-b border-white/10 px-6 py-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-lg font-bold text-white">Schedule Handover</h2>
                  <p className="text-xs text-slate-400">Auto-generates LHO-YYYYMM-XXXX</p>
                </div>
                <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Section tabs */}
              <div className="flex gap-1 flex-wrap">
                {sections.map(s => (
                  <button
                    key={s.num}
                    type="button"
                    onClick={() => setActiveSection(s.num)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      activeSection === s.num
                        ? 'bg-gradient-to-r from-violet-600 to-purple-600 text-white'
                        : 'text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700'
                    }`}
                  >
                    {s.num}. {s.title}
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={handleCreate} className="p-6 space-y-5">
              {formError && (
                <div className="flex items-center gap-2 bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-3 text-red-300 text-sm">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  {formError}
                </div>
              )}

              {/* ── Section 1: Contract Details ── */}
              {activeSection === 1 && (
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-violet-400 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-violet-600 flex items-center justify-center text-xs">1</span>
                    Contract Details
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={labelClass}>Contract No</label>
                      <input name="contractNo" value={form.contractNo} onChange={handleFormChange}
                        placeholder="e.g. LC-2024-001" className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Lessee Name <span className="text-red-400">*</span></label>
                      <input name="lesseeName" value={form.lesseeName} onChange={handleFormChange}
                        placeholder="Full name or company" className={inputClass} required />
                    </div>
                    <div>
                      <label className={labelClass}>Vehicle No <span className="text-red-400">*</span></label>
                      <input name="vehicleNo" value={form.vehicleNo} onChange={handleFormChange}
                        placeholder="e.g. Dubai A 12345" className={inputClass} required />
                    </div>
                    <div>
                      <label className={labelClass}>Vehicle Name</label>
                      <input name="vehicleName" value={form.vehicleName} onChange={handleFormChange}
                        placeholder="e.g. Toyota Camry 2023" className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Handover Type <span className="text-red-400">*</span></label>
                      <div className="flex gap-2">
                        {['DELIVERY', 'RETURN'].map(t => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setForm(prev => ({ ...prev, handoverType: t }))}
                            className={`flex-1 py-2 rounded-lg border text-sm font-semibold transition-all ${
                              form.handoverType === t
                                ? t === 'DELIVERY'
                                  ? 'bg-teal-600 border-teal-500 text-white'
                                  : 'bg-violet-600 border-violet-500 text-white'
                                : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500'
                            }`}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className={labelClass}>Date & Time <span className="text-red-400">*</span></label>
                      <input type="datetime-local" name="handoverDate" value={form.handoverDate}
                        onChange={handleFormChange} className={inputClass} required />
                    </div>
                    <div className="col-span-2">
                      <label className={labelClass}>Location</label>
                      <input name="location" value={form.location} onChange={handleFormChange}
                        placeholder="e.g. Dubai Showroom, Al Quoz" className={inputClass} />
                    </div>
                  </div>
                </div>
              )}

              {/* ── Section 2: Vehicle Condition ── */}
              {activeSection === 2 && (
                <div className="space-y-5">
                  <h3 className="text-sm font-bold text-violet-400 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-violet-600 flex items-center justify-center text-xs">2</span>
                    Vehicle Condition
                  </h3>

                  <div>
                    <label className={labelClass}>Fuel Level (0–8 segments)</label>
                    <FuelSelector value={form.fuelLevel} onChange={v => setForm(prev => ({ ...prev, fuelLevel: v }))} />
                  </div>

                  <div>
                    <label className={labelClass}>Odometer Reading (km)</label>
                    <input type="number" name="odometerReading" value={form.odometerReading}
                      onChange={handleFormChange} placeholder="e.g. 45000" className={inputClass} />
                  </div>

                  <div>
                    <label className={labelClass}>Overall Condition Score</label>
                    <ConditionSelector
                      value={form.conditionScore}
                      onChange={v => setForm(prev => ({ ...prev, conditionScore: v }))}
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className={labelClass}>Body Condition</label>
                      <select name="bodyCondition" value={form.bodyCondition} onChange={handleFormChange} className={inputClass}>
                        {CONDITION_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>Interior Condition</label>
                      <select name="interiorCondition" value={form.interiorCondition} onChange={handleFormChange} className={inputClass}>
                        {CONDITION_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>Tyres Condition</label>
                      <select name="tyresCondition" value={form.tyresCondition} onChange={handleFormChange} className={inputClass}>
                        {CONDITION_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Section 3: Keys & Accessories ── */}
              {activeSection === 3 && (
                <div className="space-y-5">
                  <h3 className="text-sm font-bold text-violet-400 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-violet-600 flex items-center justify-center text-xs">3</span>
                    Keys & Accessories
                  </h3>

                  <div>
                    <label className={labelClass}>Keys Count</label>
                    <div className="flex gap-2">
                      {[1, 2].map(n => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setForm(prev => ({ ...prev, keysCount: n }))}
                          className={`flex-1 py-2.5 rounded-xl border font-semibold text-sm transition-all ${
                            form.keysCount === n
                              ? 'bg-violet-600 border-violet-500 text-white'
                              : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500'
                          }`}
                        >
                          {n} Key{n > 1 ? 's' : ''}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { name: 'spareKey',   label: 'Spare Key' },
                      { name: 'salikTag',   label: 'Salik Tag' },
                      { name: 'parkingCard', label: 'Parking Card' },
                      { name: 'serviceBook', label: 'Service Book' },
                    ].map(({ name, label }) => {
                      const checked = form[name as keyof FormState] as boolean;
                      return (
                        <button
                          key={name}
                          type="button"
                          onClick={() => setForm(prev => ({ ...prev, [name]: !prev[name as keyof FormState] }))}
                          className={`flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${
                            checked
                              ? 'bg-emerald-900/30 border-emerald-700/60 text-emerald-300'
                              : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:border-slate-500'
                          }`}
                        >
                          <span className="text-sm font-medium">{label}</span>
                          <span className={`text-xs font-bold ${checked ? 'text-emerald-400' : 'text-slate-600'}`}>
                            {checked ? 'YES' : 'NO'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Section 4: Standard Checklist ── */}
              {activeSection === 4 && (
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-violet-400 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-violet-600 flex items-center justify-center text-xs">4</span>
                    Standard Checklist
                  </h3>
                  <div className="space-y-2">
                    {form.checklist.map((item, index) => (
                      <label
                        key={index}
                        className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all ${
                          item.checked
                            ? 'bg-emerald-900/20 border-emerald-700/50 text-emerald-300'
                            : 'bg-slate-800/60 border-slate-700 text-slate-300 hover:border-slate-500'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={item.checked}
                          onChange={() => toggleChecklist(index)}
                          className="w-4 h-4 rounded accent-violet-500"
                        />
                        <span className="text-sm font-medium">{item.label}</span>
                        {item.checked && (
                          <span className="ml-auto text-emerald-400 text-xs font-bold">PRESENT</span>
                        )}
                      </label>
                    ))}
                  </div>
                  <div className="flex justify-between text-xs text-slate-500 bg-slate-800/40 rounded-lg px-4 py-2">
                    <span>Items checked:</span>
                    <span className="text-white font-medium">
                      {form.checklist.filter(c => c.checked).length} / {form.checklist.length}
                    </span>
                  </div>
                </div>
              )}

              {/* ── Section 5: Completion ── */}
              {activeSection === 5 && (
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-violet-400 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-violet-600 flex items-center justify-center text-xs">5</span>
                    Completion & Sign-off
                  </h3>
                  <p className="text-xs text-slate-500">
                    Sign-off can be done now or later via the &quot;Complete &amp; Sign&quot; button on the handover record.
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={labelClass}>Signed By (Customer)</label>
                      <input name="signedBy" value={form.signedBy} onChange={handleFormChange}
                        placeholder="Customer full name" className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Witnessed By (Staff)</label>
                      <input name="witnessedBy" value={form.witnessedBy} onChange={handleFormChange}
                        placeholder="Staff member name" className={inputClass} />
                    </div>
                  </div>
                  <div>
                    <label className={labelClass}>Damage Notes</label>
                    <textarea name="damageNotes" value={form.damageNotes} onChange={handleFormChange}
                      placeholder="Note any pre-existing damage, scratches, dents…" rows={3}
                      className={`${inputClass} resize-none`} />
                  </div>
                  <div>
                    <label className={labelClass}>Additional Notes</label>
                    <textarea name="notes" value={form.notes} onChange={handleFormChange}
                      placeholder="Any other notes or instructions…" rows={2}
                      className={`${inputClass} resize-none`} />
                  </div>
                </div>
              )}

              {/* ── Navigation + Submit ── */}
              <div className="flex gap-3 pt-2 border-t border-white/10">
                {activeSection > 1 && (
                  <button
                    type="button"
                    onClick={() => setActiveSection(s => s - 1)}
                    className="px-5 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-semibold text-sm transition-colors"
                  >
                    Back
                  </button>
                )}
                {activeSection < 5 ? (
                  <button
                    type="button"
                    onClick={() => setActiveSection(s => s + 1)}
                    className="flex-1 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-semibold text-sm transition-colors"
                  >
                    Next: {sections[activeSection]?.title}
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white font-semibold text-sm shadow-lg shadow-violet-900/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {saving ? 'Scheduling…' : 'Schedule Handover'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Complete & Sign Modal ─── */}
      {completeTarget && (
        <CompleteModal
          handover={completeTarget}
          onClose={() => setCompleteTarget(null)}
          onComplete={(signedBy, witnessedBy, damageNotes) =>
            handleComplete(completeTarget, signedBy, witnessedBy, damageNotes)
          }
        />
      )}
    </div>
  );
}
