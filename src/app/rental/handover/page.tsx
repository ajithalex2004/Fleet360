'use client';
import { useRentalMasterData } from '@/hooks/useRentalMasterData';
import React, { useState, useEffect, useCallback } from 'react';

/* ─── Types ─── */
interface ChecklistItem {
  label: string;
  checked: boolean;
}

interface Handover {
  id: string;
  handover_no: string;
  agreement_id?: string;
  agreement_no?: string;
  customer_name?: string;
  vehicle_id?: string;
  vehicle_no?: string;
  vehicle_name?: string;
  handover_type: 'PICKUP' | 'RETURN';
  handover_date?: string;
  fuel_level?: number;
  odometer_reading?: number;
  condition_score?: number;
  body_condition?: string;
  interior_condition?: string;
  tyres_condition?: string;
  keys_count?: number;
  spare_key?: boolean;
  salik_tag?: boolean;
  parking_card?: boolean;
  accessories?: unknown[];
  checklist_items?: ChecklistItem[];
  notes?: string;
  signed_by?: string;
  signed_at?: string;
  status: string;
  branch_id?: string;
  created_at: string;
}

interface KPIs {
  pendingPickups: number;
  pendingReturns: number;
  completedToday: number;
  avgConditionScore: number;
}

/* ─── Constants ─── */
const FUEL_LABELS = ['Empty', '1/8', '1/4', '3/8', 'Half', '5/8', '3/4', '7/8', 'Full'];

const STANDARD_CHECKLIST: string[] = [
  'Spare Tyre',
  'Jack & Tools',
  'First Aid Kit',
  'Fire Extinguisher',
  'Vehicle Documents',
  'Insurance Card',
  'Registration Card',
];

const INPUT_CLS =
  'w-full px-4 py-2.5 rounded-lg bg-slate-700/80 border border-white/10 text-white placeholder-slate-500 focus:border-teal-500 focus:outline-none text-sm transition-colors';
const LABEL_CLS = 'block text-sm font-medium text-slate-300 mb-1.5';
const SECTION_CLS = 'bg-slate-800/60 border border-white/10 rounded-xl p-5 space-y-4';

/* ─── Sub-components ─── */
function FuelGauge({ level, labels = FUEL_LABELS }: { level: number; labels?: string[] }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-0.5">
        {Array.from({ length: 8 }, (_, i) => (
          <div
            key={i}
            className={`w-5 h-5 rounded-sm transition-colors ${
              i < level ? 'bg-gradient-to-t from-teal-600 to-cyan-500' : 'bg-slate-700'
            }`}
          />
        ))}
      </div>
      <span className="text-xs text-slate-400 whitespace-nowrap">
        {labels[level] ?? `${level}/8`}
      </span>
    </div>
  );
}

function StarRating({ score }: { score: number }) {
  const color =
    score <= 2 ? 'text-red-400' : score === 3 ? 'text-amber-400' : 'text-emerald-400';
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={`text-sm ${i < score ? color : 'text-slate-700'}`}>
          ★
        </span>
      ))}
      <span className={`text-xs ml-1 font-medium ${color}`}>{score}/5</span>
    </div>
  );
}

function StarSelector({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => {
        const c = n <= 2 ? 'text-red-400' : n === 3 ? 'text-amber-400' : 'text-emerald-400';
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`text-2xl transition-colors ${n <= value ? c : 'text-slate-700 hover:text-slate-500'}`}
          >
            ★
          </button>
        );
      })}
      <span className="text-sm text-slate-400 ml-2 self-center">{value}/5</span>
    </div>
  );
}

function TypeBadge({ type }: { type: string }) {
  return type === 'PICKUP' ? (
    <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-teal-500/20 text-teal-400 border border-teal-500/30">
      PICKUP
    </span>
  ) : (
    <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-violet-500/20 text-violet-400 border border-violet-500/30">
      RETURN
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PENDING:   'bg-amber-500/20 text-amber-400 border-amber-500/30',
    COMPLETED: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    CANCELLED: 'bg-red-500/20 text-red-400 border-red-500/30',
  };
  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${map[status] ?? 'bg-slate-500/20 text-slate-400 border-slate-500/30'}`}>
      {status}
    </span>
  );
}

/* ─── Default form state ─── */
const DEFAULT_FORM = {
  agreementNo:       '',
  customerName:      '',
  vehicleNo:         '',
  vehicleName:       '',
  handoverType:      'PICKUP' as 'PICKUP' | 'RETURN',
  handoverDate:      new Date().toISOString().slice(0, 16),
  fuelLevel:         4,
  odometerReading:   '',
  conditionScore:    3,
  bodyCondition:     'Good',
  interiorCondition: 'Clean',
  tyresCondition:    'Good',
  keysCount:         1,
  spareKey:          false,
  salikTag:          false,
  parkingCard:       false,
  signedBy:          '',
  notes:             '',
  checklistItems:    STANDARD_CHECKLIST.map((label) => ({ label, checked: false })),
};

/* ═══════════════════════════════════════════════════════════ */
export default function HandoverPage() {
  const { masterData } = useRentalMasterData();
  const [handovers, setHandovers]     = useState<Handover[]>([]);
  const [kpis, setKpis]               = useState<KPIs>({ pendingPickups: 0, pendingReturns: 0, completedToday: 0, avgConditionScore: 0 });
  const [activeTab, setActiveTab]     = useState<'PICKUP' | 'RETURN'>('PICKUP');
  const [search, setSearch]           = useState('');
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');
  const [showModal, setShowModal]     = useState(false);
  const [form, setForm]               = useState(DEFAULT_FORM);
  const [signOffId, setSignOffId]     = useState<string | null>(null);
  const [signedBy, setSignedByInput]  = useState('');
  const [pickupRef, setPickupRef]     = useState<Handover | null>(null);
  const fuelLabels = masterData.fuelLabels.length ? masterData.fuelLabels : FUEL_LABELS;

  /* ── load ── */
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('handoverType', activeTab);
      if (search) params.set('search', search);
      params.set('limit', '200');

      const res  = await fetch(`/api/rental/handover?${params}`);
      const json = await res.json();
      setHandovers(Array.isArray(json.data) ? json.data : []);
      if (json.kpis) setKpis(json.kpis);
    } catch {
      setError('Failed to load handovers');
    } finally {
      setLoading(false);
    }
  }, [activeTab, search]);

  useEffect(() => { load(); }, [load]);

  /* ── lookup original PICKUP when RETURN form opened ── */
  useEffect(() => {
    if (!showModal || form.handoverType !== 'RETURN' || !form.agreementNo) {
      setPickupRef(null);
      return;
    }
    fetch(`/api/rental/handover?handoverType=PICKUP&agreementNo=${encodeURIComponent(form.agreementNo)}&limit=1`)
      .then((r) => r.json())
      .then((j) => {
        const rows: Handover[] = Array.isArray(j.data) ? j.data : [];
        setPickupRef(rows.find((h) => h.status === 'COMPLETED') ?? null);
      })
      .catch(() => setPickupRef(null));
  }, [showModal, form.handoverType, form.agreementNo]);

  /* ── submit ── */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/rental/handover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agreementNo:       form.agreementNo || null,
          customerName:      form.customerName,
          vehicleNo:         form.vehicleNo,
          vehicleName:       form.vehicleName,
          handoverType:      form.handoverType,
          handoverDate:      form.handoverDate || null,
          fuelLevel:         form.fuelLevel,
          odometerReading:   parseInt(form.odometerReading as string) || 0,
          conditionScore:    form.conditionScore,
          bodyCondition:     form.bodyCondition,
          interiorCondition: form.interiorCondition,
          tyresCondition:    form.tyresCondition,
          keysCount:         form.keysCount,
          spareKey:          form.spareKey,
          salikTag:          form.salikTag,
          parkingCard:       form.parkingCard,
          checklistItems:    form.checklistItems,
          signedBy:          form.signedBy || null,
          notes:             form.notes || null,
        }),
      });
      if (!res.ok) throw new Error('Failed');
      setShowModal(false);
      resetForm();
      load();
    } catch {
      setError('Failed to create handover');
    } finally {
      setSaving(false);
    }
  };

  /* ── sign off ── */
  const handleSignOff = async (id: string) => {
    if (!signedBy.trim()) return;
    try {
      const res = await fetch('/api/rental/handover', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, signOff: true, signedBy }),
      });
      if (!res.ok) throw new Error();
      setSignOffId(null);
      setSignedByInput('');
      load();
    } catch {
      setError('Failed to complete sign-off');
    }
  };

  const resetForm = () => {
    setForm({
      ...DEFAULT_FORM,
      handoverDate: new Date().toISOString().slice(0, 16),
      checklistItems: STANDARD_CHECKLIST.map((label) => ({ label, checked: false })),
    });
    setPickupRef(null);
  };

  /* ── checklist toggle ── */
  const toggleChecklist = (idx: number) => {
    setForm((p) => ({
      ...p,
      checklistItems: p.checklistItems.map((item, i) =>
        i === idx ? { ...item, checked: !item.checked } : item,
      ),
    }));
  };

  /* ── field helper ── */
  const set = <K extends keyof typeof DEFAULT_FORM>(k: K, v: (typeof DEFAULT_FORM)[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  /* ─── KPI cards ─── */
  const kpiCards = [
    {
      label: 'Pending Pickups',
      value: kpis.pendingPickups.toString(),
      color: 'text-teal-400',
      border: 'border-teal-500/20',
      icon: '🚗',
    },
    {
      label: 'Pending Returns',
      value: kpis.pendingReturns.toString(),
      color: 'text-violet-400',
      border: 'border-violet-500/20',
      icon: '🔄',
    },
    {
      label: 'Completed Today',
      value: kpis.completedToday.toString(),
      color: 'text-emerald-400',
      border: 'border-emerald-500/20',
      icon: '✅',
    },
    {
      label: 'Avg Condition',
      value: `${kpis.avgConditionScore}/5`,
      color: kpis.avgConditionScore >= 4 ? 'text-emerald-400' : kpis.avgConditionScore >= 3 ? 'text-amber-400' : 'text-red-400',
      border: 'border-slate-500/20',
      icon: '⭐',
    },
  ];

  if (loading)
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400 animate-pulse text-lg">Loading handovers...</div>
      </div>
    );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">Handover Checklists</h1>
          <p className="text-slate-400">Vehicle pickup and return condition records</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowModal(true); }}
          className="rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 px-6 py-3 text-sm font-semibold text-white hover:opacity-90 transition-opacity shadow-lg shadow-teal-900/30"
        >
          + New Handover
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCards.map((c) => (
          <div key={c.label} className={`bg-slate-800/60 border ${c.border} rounded-2xl p-5 backdrop-blur-sm`}>
            <div className="text-2xl mb-1">{c.icon}</div>
            <div className={`text-2xl font-bold ${c.color} mb-1`}>{c.value}</div>
            <div className="text-sm font-medium text-white">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Type Tabs + Search */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
        <div className="flex gap-1 bg-slate-800/60 border border-white/10 rounded-xl p-1">
          {(['PICKUP', 'RETURN'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
                activeTab === tab
                  ? tab === 'PICKUP'
                    ? 'bg-gradient-to-r from-teal-600 to-cyan-600 text-white shadow'
                    : 'bg-gradient-to-r from-violet-600 to-purple-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {tab === 'PICKUP' ? '🚗 PICKUP Handovers' : '🔄 RETURN Handovers'}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search agreement, customer, vehicle..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-4 py-2 rounded-xl bg-slate-800/60 border border-white/10 text-white placeholder-slate-500 focus:border-teal-500 focus:outline-none text-sm"
        />
      </div>

      {/* Table */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl backdrop-blur-sm overflow-x-auto">
        {handovers.length === 0 ? (
          <div className="text-center text-slate-400 py-16">
            <div className="text-4xl mb-3">{activeTab === 'PICKUP' ? '🚗' : '🔄'}</div>
            <div>No {activeTab.toLowerCase()} handovers found</div>
          </div>
        ) : (
          <table className="w-full min-w-[1200px]">
            <thead>
              <tr className="border-b border-white/5">
                {[
                  'Handover No', 'Type', 'Agreement', 'Customer', 'Vehicle',
                  'Date', 'Fuel', 'Odometer', 'Condition', 'Status', 'Actions',
                ].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {handovers.map((h) => (
                <tr key={h.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3.5 text-sm font-mono text-teal-400 font-medium whitespace-nowrap">
                    {h.handover_no}
                  </td>
                  <td className="px-4 py-3.5">
                    <TypeBadge type={h.handover_type} />
                  </td>
                  <td className="px-4 py-3.5 text-sm text-slate-300">{h.agreement_no ?? '—'}</td>
                  <td className="px-4 py-3.5 text-sm text-white font-medium">{h.customer_name ?? '—'}</td>
                  <td className="px-4 py-3.5 text-sm text-slate-300">
                    <div>{h.vehicle_name ?? '—'}</div>
                    {h.vehicle_no && <div className="text-xs text-slate-500">{h.vehicle_no}</div>}
                  </td>
                  <td className="px-4 py-3.5 text-sm text-slate-300 whitespace-nowrap">
                    {h.handover_date
                      ? new Date(h.handover_date).toLocaleString('en-GB', {
                          day: '2-digit', month: 'short', year: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })
                      : '—'}
                  </td>
                  <td className="px-4 py-3.5">
                    <FuelGauge level={h.fuel_level ?? 0} labels={fuelLabels} />
                  </td>
                  <td className="px-4 py-3.5 text-sm text-slate-300 whitespace-nowrap">
                    {h.odometer_reading != null ? h.odometer_reading.toLocaleString() + ' km' : '—'}
                  </td>
                  <td className="px-4 py-3.5">
                    <StarRating score={h.condition_score ?? 0} />
                  </td>
                  <td className="px-4 py-3.5">
                    <StatusBadge status={h.status} />
                  </td>
                  <td className="px-4 py-3.5">
                    {h.status === 'PENDING' && (
                      signOffId === h.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            placeholder="Signed by..."
                            value={signedBy}
                            onChange={(e) => setSignedByInput(e.target.value)}
                            className="w-28 px-2 py-1 rounded-lg bg-slate-700 border border-white/10 text-white text-xs focus:border-teal-500 focus:outline-none"
                          />
                          <button
                            onClick={() => handleSignOff(h.id)}
                            className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-semibold hover:bg-emerald-500/30"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => { setSignOffId(null); setSignedByInput(''); }}
                            className="text-slate-500 hover:text-white text-xs"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setSignOffId(h.id)}
                          className="px-3 py-1.5 rounded-lg bg-teal-500/20 text-teal-400 border border-teal-500/30 text-xs font-semibold hover:bg-teal-500/30 transition-colors whitespace-nowrap"
                        >
                          Complete & Sign
                        </button>
                      )
                    )}
                    {h.status === 'COMPLETED' && (
                      <div className="text-xs text-slate-500">
                        <div>Signed: {h.signed_by ?? '—'}</div>
                        {h.signed_at && (
                          <div>{new Date(h.signed_at).toLocaleDateString('en-GB')}</div>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ─── NEW HANDOVER MODAL ─── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-3xl bg-slate-900 border border-white/10 rounded-2xl shadow-2xl max-h-[95vh] overflow-y-auto">
            {/* Modal header */}
            <div className="sticky top-0 bg-slate-900 border-b border-white/10 px-8 py-5 flex items-center justify-between rounded-t-2xl z-10">
              <div>
                <h2 className="text-xl font-bold text-white">New Handover Checklist</h2>
                <p className="text-sm text-slate-400 mt-0.5">
                  Complete vehicle {form.handoverType.toLowerCase()} inspection
                </p>
              </div>
              <button
                onClick={() => { setShowModal(false); resetForm(); }}
                className="text-slate-400 hover:text-white text-xl leading-none transition-colors"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="px-8 py-6 space-y-6">

              {/* ── Section 1: Agreement Info ── */}
              <div className={SECTION_CLS}>
                <h3 className="text-sm font-semibold text-teal-400 uppercase tracking-wider">
                  1 — Agreement Info
                </h3>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={LABEL_CLS}>Agreement No</label>
                    <input
                      type="text"
                      value={form.agreementNo}
                      onChange={(e) => set('agreementNo', e.target.value)}
                      placeholder="AGR-000001"
                      className={INPUT_CLS}
                    />
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Customer Name *</label>
                    <input
                      type="text"
                      value={form.customerName}
                      onChange={(e) => set('customerName', e.target.value)}
                      placeholder="Full name"
                      required
                      className={INPUT_CLS}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={LABEL_CLS}>Vehicle Plate *</label>
                    <input
                      type="text"
                      value={form.vehicleNo}
                      onChange={(e) => set('vehicleNo', e.target.value)}
                      placeholder="e.g. ABC 1234"
                      required
                      className={INPUT_CLS}
                    />
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Vehicle Name</label>
                    <input
                      type="text"
                      value={form.vehicleName}
                      onChange={(e) => set('vehicleName', e.target.value)}
                      placeholder="e.g. Toyota Camry 2023"
                      className={INPUT_CLS}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={LABEL_CLS}>Handover Type *</label>
                    <div className="flex gap-2">
                      {(['PICKUP', 'RETURN'] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => set('handoverType', t)}
                          className={`flex-1 py-2.5 rounded-lg text-sm font-semibold border transition-all ${
                            form.handoverType === t
                              ? t === 'PICKUP'
                                ? 'bg-teal-600 text-white border-teal-500'
                                : 'bg-violet-600 text-white border-violet-500'
                              : 'bg-slate-700/50 text-slate-400 border-white/10 hover:border-white/20'
                          }`}
                        >
                          {t === 'PICKUP' ? '🚗 PICKUP' : '🔄 RETURN'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Handover Date & Time *</label>
                    <input
                      type="datetime-local"
                      value={form.handoverDate}
                      onChange={(e) => set('handoverDate', e.target.value)}
                      required
                      className={INPUT_CLS}
                    />
                  </div>
                </div>
              </div>

              {/* ── Pickup Reference (for RETURN) ── */}
              {form.handoverType === 'RETURN' && pickupRef && (
                <div className="bg-teal-900/20 border border-teal-500/30 rounded-xl p-4">
                  <div className="text-xs font-semibold text-teal-400 uppercase tracking-wider mb-3">
                    Original Pickup Condition ({pickupRef.handover_no})
                  </div>
                  <div className="grid grid-cols-4 gap-3 text-sm">
                    <div>
                      <div className="text-slate-400 text-xs mb-1">Fuel</div>
                      <FuelGauge level={pickupRef.fuel_level ?? 0} labels={fuelLabels} />
                    </div>
                    <div>
                      <div className="text-slate-400 text-xs mb-1">Odometer</div>
                      <div className="text-white font-medium">{(pickupRef.odometer_reading ?? 0).toLocaleString()} km</div>
                    </div>
                    <div>
                      <div className="text-slate-400 text-xs mb-1">Condition</div>
                      <StarRating score={pickupRef.condition_score ?? 0} />
                    </div>
                    <div>
                      <div className="text-slate-400 text-xs mb-1">Body</div>
                      <div className="text-white">{pickupRef.body_condition ?? '—'}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Section 2: Vehicle Condition ── */}
              <div className={SECTION_CLS}>
                <h3 className="text-sm font-semibold text-teal-400 uppercase tracking-wider">
                  2 — Vehicle Condition
                </h3>

                {/* Fuel Level Slider */}
                <div>
                  <label className={LABEL_CLS}>
                    Fuel Level — {fuelLabels[form.fuelLevel] ?? `${form.fuelLevel}/8`}
                  </label>
                  <div className="space-y-3">
                    <input
                      type="range"
                      min={0}
                      max={8}
                      step={1}
                      value={form.fuelLevel}
                      onChange={(e) => set('fuelLevel', parseInt(e.target.value))}
                      className="w-full accent-teal-500 cursor-pointer"
                    />
                    <div className="flex justify-between">
                      {fuelLabels.map((l, i) => (
                        <span
                          key={i}
                          className={`text-xs ${i === form.fuelLevel ? 'text-teal-400 font-bold' : 'text-slate-600'}`}
                        >
                          {l}
                        </span>
                      ))}
                    </div>
                    {/* Visual gauge */}
                    <div className="flex gap-1 mt-2">
                      {Array.from({ length: 8 }, (_, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => set('fuelLevel', i + 1 <= form.fuelLevel ? i : i + 1)}
                          className={`h-6 flex-1 rounded transition-colors ${
                            i < form.fuelLevel
                              ? 'bg-gradient-to-t from-teal-600 to-cyan-500'
                              : 'bg-slate-700 hover:bg-slate-600'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {/* Odometer */}
                <div>
                  <label className={LABEL_CLS}>Odometer Reading (km)</label>
                  <input
                    type="number"
                    min={0}
                    value={form.odometerReading}
                    onChange={(e) => set('odometerReading', e.target.value)}
                    placeholder="e.g. 45000"
                    className={INPUT_CLS}
                  />
                </div>

                {/* Condition Score */}
                <div>
                  <label className={LABEL_CLS}>Overall Condition (1–5 Stars)</label>
                  <StarSelector value={form.conditionScore} onChange={(v) => set('conditionScore', v)} />
                </div>

                {/* Body / Interior / Tyres */}
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className={LABEL_CLS}>Body Condition</label>
                    <select
                      value={form.bodyCondition}
                      onChange={(e) => set('bodyCondition', e.target.value)}
                      className={INPUT_CLS}
                    >
                      <option value="Good">Good</option>
                      <option value="Minor Scratches">Minor Scratches</option>
                      <option value="Significant Damage">Significant Damage</option>
                    </select>
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Interior Condition</label>
                    <select
                      value={form.interiorCondition}
                      onChange={(e) => set('interiorCondition', e.target.value)}
                      className={INPUT_CLS}
                    >
                      <option value="Clean">Clean</option>
                      <option value="Minor Stains">Minor Stains</option>
                      <option value="Needs Cleaning">Needs Cleaning</option>
                    </select>
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Tyres Condition</label>
                    <select
                      value={form.tyresCondition}
                      onChange={(e) => set('tyresCondition', e.target.value)}
                      className={INPUT_CLS}
                    >
                      <option value="Good">Good</option>
                      <option value="Worn">Worn</option>
                      <option value="Replace">Replace</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* ── Section 3: Accessories ── */}
              <div className={SECTION_CLS}>
                <h3 className="text-sm font-semibold text-teal-400 uppercase tracking-wider">
                  3 — Accessories
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={LABEL_CLS}>Keys Count</label>
                    <div className="flex gap-2">
                      {[1, 2].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => set('keysCount', n)}
                          className={`flex-1 py-2 rounded-lg text-sm font-semibold border transition-all ${
                            form.keysCount === n
                              ? 'bg-teal-600 text-white border-teal-500'
                              : 'bg-slate-700/50 text-slate-400 border-white/10 hover:border-white/20'
                          }`}
                        >
                          {n} Key{n > 1 ? 's' : ''}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col gap-3 justify-center">
                    {([
                      ['spareKey',    'Spare Key'],
                      ['salikTag',    'Salik Tag'],
                      ['parkingCard', 'Parking Card'],
                    ] as const).map(([field, label]) => (
                      <label key={field} className="flex items-center gap-3 cursor-pointer">
                        <div
                          onClick={() => set(field, !form[field])}
                          className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors cursor-pointer ${
                            form[field]
                              ? 'bg-teal-600 border-teal-500'
                              : 'bg-transparent border-slate-500'
                          }`}
                        >
                          {form[field] && <span className="text-white text-xs font-bold">✓</span>}
                        </div>
                        <span className="text-sm text-slate-300">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── Section 4: Standard Checklist ── */}
              <div className={SECTION_CLS}>
                <h3 className="text-sm font-semibold text-teal-400 uppercase tracking-wider">
                  4 — Standard Checklist
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {form.checklistItems.map((item, idx) => (
                    <label key={idx} className="flex items-center gap-3 cursor-pointer group">
                      <div
                        onClick={() => toggleChecklist(idx)}
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors cursor-pointer flex-shrink-0 ${
                          item.checked
                            ? 'bg-emerald-600 border-emerald-500'
                            : 'bg-transparent border-slate-500 group-hover:border-slate-400'
                        }`}
                      >
                        {item.checked && <span className="text-white text-xs font-bold">✓</span>}
                      </div>
                      <span className={`text-sm transition-colors ${item.checked ? 'text-white' : 'text-slate-400'}`}>
                        {item.label}
                      </span>
                    </label>
                  ))}
                </div>
                <div className="text-xs text-slate-500 mt-2">
                  {form.checklistItems.filter((i) => i.checked).length} / {form.checklistItems.length} items confirmed
                </div>
              </div>

              {/* ── Section 5: Sign Off ── */}
              <div className={SECTION_CLS}>
                <h3 className="text-sm font-semibold text-teal-400 uppercase tracking-wider">
                  5 — Sign Off
                </h3>
                <div>
                  <label className={LABEL_CLS}>Signed By</label>
                  <input
                    type="text"
                    value={form.signedBy}
                    onChange={(e) => set('signedBy', e.target.value)}
                    placeholder="Staff name or customer signature"
                    className={INPUT_CLS}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Notes</label>
                  <textarea
                    value={form.notes}
                    onChange={(e) => set('notes', e.target.value)}
                    rows={3}
                    placeholder="Additional remarks, damage notes..."
                    className={INPUT_CLS + ' resize-none'}
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); resetForm(); }}
                  className="px-6 py-2.5 rounded-xl border border-white/10 text-white text-sm hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {saving ? 'Saving...' : `Create ${form.handoverType} Checklist`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
