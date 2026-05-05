'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

/* ─────────────────────────── types ─────────────────────────── */
interface Allocation {
  id: string;
  allocation_no: string;
  student_name: string;
  student_grade: string | null;
  student_section: string | null;
  parent_name: string | null;
  parent_phone: string | null;
  parent_email: string | null;
  route_name: string | null;
  pickup_stop_name: string | null;
  pickup_stop_time: string | null;
  drop_stop_name: string | null;
  drop_stop_time: string | null;
  bus_mode: string;
  seat_number: number | null;
  effective_from: string;
  effective_to: string | null;
  status: string;
  suspension_reason: string | null;
  withdrawal_reason: string | null;
  notes: string | null;
}

interface AllocSummary {
  total: number;
  active: number;
  suspended: number;
  withdrawn: number;
  pending: number;
  twoWay: number;
  pickupOnly: number;
  dropOnly: number;
}

const TENANTID = 'default';

const BUS_MODES = ['TWO_WAY', 'ONE_WAY_PICKUP', 'ONE_WAY_DROP'];
const STATUSES  = ['ACTIVE', 'SUSPENDED', 'PENDING_APPROVAL', 'WITHDRAWN'];

const MODE_CFG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  TWO_WAY:       { label: 'Two Way',     color: 'text-green-400',  bg: 'bg-green-500/10',  icon: '↕️' },
  ONE_WAY_PICKUP:{ label: 'Pickup Only', color: 'text-blue-400',   bg: 'bg-blue-500/10',   icon: '↑'  },
  ONE_WAY_DROP:  { label: 'Drop Only',   color: 'text-orange-400', bg: 'bg-orange-500/10', icon: '↓'  },
};

const STATUS_CFG: Record<string, { color: string; bg: string; border: string }> = {
  ACTIVE:           { color: 'text-green-400',  bg: 'bg-green-500/10',  border: 'border-green-500/20'  },
  SUSPENDED:        { color: 'text-amber-400',  bg: 'bg-amber-500/10',  border: 'border-amber-500/20'  },
  WITHDRAWN:        { color: 'text-slate-500',  bg: 'bg-slate-800/50',  border: 'border-slate-700'     },
  PENDING_APPROVAL: { color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
};

function fmtDate(s: string | null): string {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtTime(t: string | null): string {
  if (!t) return '—';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${((h % 12) || 12).toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${ampm}`;
}

/* ─────────────────────────── Modal ─────────────────────────── */
function AllocationModal({ initial, onSave, onClose }: {
  initial?: Partial<Allocation>;
  onSave: (d: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    studentName:    initial?.student_name    ?? '',
    studentGrade:   initial?.student_grade   ?? '',
    studentSection: initial?.student_section ?? '',
    parentName:     initial?.parent_name     ?? '',
    parentPhone:    initial?.parent_phone    ?? '',
    parentEmail:    initial?.parent_email    ?? '',
    routeName:      initial?.route_name      ?? '',
    pickupStopName: initial?.pickup_stop_name ?? '',
    pickupStopTime: initial?.pickup_stop_time ?? '',
    dropStopName:   initial?.drop_stop_name  ?? '',
    dropStopTime:   initial?.drop_stop_time  ?? '',
    busMode:        initial?.bus_mode        ?? 'TWO_WAY',
    seatNumber:     initial?.seat_number     ?? '',
    effectiveFrom:  initial?.effective_from?.slice(0,10) ?? new Date().toISOString().slice(0,10),
    effectiveTo:    initial?.effective_to?.slice(0,10)   ?? '',
    status:         initial?.status          ?? 'ACTIVE',
    notes:          initial?.notes           ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));
  const labelClass = 'text-xs text-slate-400 mb-1 block';
  const inputClass = 'w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-yellow-500/50';
  const selectClass = `${inputClass} cursor-pointer`;

  const handleSubmit = async () => {
    if (!form.studentName.trim()) return;
    setSaving(true);
    setError('');
    try {
      await onSave({
        ...form,
        seatNumber: form.seatNumber ? Number(form.seatNumber) : null,
        effectiveTo: form.effectiveTo || null,
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setSaving(false);
  };

  const showPickup = form.busMode === 'TWO_WAY' || form.busMode === 'ONE_WAY_PICKUP';
  const showDrop   = form.busMode === 'TWO_WAY' || form.busMode === 'ONE_WAY_DROP';

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-lg font-bold text-white">
            {initial?.id ? '✏️ Edit Allocation' : '💺 New Seat Allocation'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl leading-none">×</button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-sm text-red-400">
              ⚠️ {error}
            </div>
          )}

          {/* Student info */}
          <div>
            <p className="text-xs font-semibold text-slate-300 mb-3 uppercase tracking-wider">Student Information</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-3">
                <label className={labelClass}>Student Name *</label>
                <input value={form.studentName} onChange={e => set('studentName', e.target.value)}
                  placeholder="Full name" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Grade</label>
                <input value={form.studentGrade} onChange={e => set('studentGrade', e.target.value)}
                  placeholder="e.g. Grade 5" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Section / Class</label>
                <input value={form.studentSection} onChange={e => set('studentSection', e.target.value)}
                  placeholder="e.g. 5A" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Seat No. (optional)</label>
                <input type="number" value={form.seatNumber} onChange={e => set('seatNumber', e.target.value)}
                  placeholder="Auto-assign" className={inputClass} />
              </div>
            </div>
          </div>

          {/* Parent info */}
          <div>
            <p className="text-xs font-semibold text-slate-300 mb-3 uppercase tracking-wider">Parent / Guardian</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-3 md:col-span-1">
                <label className={labelClass}>Parent Name</label>
                <input value={form.parentName} onChange={e => set('parentName', e.target.value)}
                  placeholder="Guardian full name" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Phone</label>
                <input value={form.parentPhone} onChange={e => set('parentPhone', e.target.value)}
                  placeholder="+971 50 xxx xxxx" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Email</label>
                <input value={form.parentEmail} onChange={e => set('parentEmail', e.target.value)}
                  placeholder="parent@email.com" className={inputClass} />
              </div>
            </div>
          </div>

          {/* Route & mode */}
          <div>
            <p className="text-xs font-semibold text-slate-300 mb-3 uppercase tracking-wider">Route & Bus Mode</p>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className={labelClass}>Route Name</label>
                <input value={form.routeName} onChange={e => set('routeName', e.target.value)}
                  placeholder="Select or type route name" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Bus Mode</label>
                <select value={form.busMode} onChange={e => set('busMode', e.target.value)} className={selectClass}>
                  {BUS_MODES.map(m => (
                    <option key={m} value={m}>{MODE_CFG[m]?.label ?? m}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Bus mode explainer */}
            <div className={`rounded-lg px-3 py-2 text-xs mb-3 ${MODE_CFG[form.busMode]?.bg ?? 'bg-slate-800'}`}>
              {form.busMode === 'TWO_WAY'        && <p className={MODE_CFG.TWO_WAY.color}>↕️ <strong>Two Way:</strong> Student uses bus for both morning pickup to school and afternoon drop back home.</p>}
              {form.busMode === 'ONE_WAY_PICKUP' && <p className={MODE_CFG.ONE_WAY_PICKUP.color}>↑ <strong>Pickup Only:</strong> Student is collected from home in the morning. Parent handles the return journey.</p>}
              {form.busMode === 'ONE_WAY_DROP'   && <p className={MODE_CFG.ONE_WAY_DROP.color}>↓ <strong>Drop Only:</strong> Student is dropped home in the afternoon. Parent handles the morning journey.</p>}
            </div>

            {/* Stop assignments */}
            <div className="grid grid-cols-2 gap-3">
              {showPickup && (
                <>
                  <div>
                    <label className={labelClass}>🟢 Pickup Stop</label>
                    <input value={form.pickupStopName} onChange={e => set('pickupStopName', e.target.value)}
                      placeholder="Stop name" className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Pickup Time</label>
                    <input type="time" value={form.pickupStopTime} onChange={e => set('pickupStopTime', e.target.value)} className={inputClass} />
                  </div>
                </>
              )}
              {showDrop && (
                <>
                  <div>
                    <label className={labelClass}>🔴 Drop Stop</label>
                    <input value={form.dropStopName} onChange={e => set('dropStopName', e.target.value)}
                      placeholder="Stop name" className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Drop Time</label>
                    <input type="time" value={form.dropStopTime} onChange={e => set('dropStopTime', e.target.value)} className={inputClass} />
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Validity & status */}
          <div>
            <p className="text-xs font-semibold text-slate-300 mb-3 uppercase tracking-wider">Validity</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelClass}>Effective From *</label>
                <input type="date" value={form.effectiveFrom} onChange={e => set('effectiveFrom', e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Effective To (blank = open)</label>
                <input type="date" value={form.effectiveTo} onChange={e => set('effectiveTo', e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Status</label>
                <select value={form.status} onChange={e => set('status', e.target.value)} className={selectClass}>
                  {STATUSES.map(s => <option key={s} value={s}>{s.replace('_',' ')}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div>
            <label className={labelClass}>Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
              rows={2} placeholder="Special needs, medical conditions, authorised collectors, etc."
              className={`${inputClass} resize-none`} />
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-white/10">
          <button onClick={handleSubmit} disabled={saving || !form.studentName.trim()}
            className="flex-1 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-40 text-slate-900 font-bold py-2.5 rounded-xl text-sm transition-colors">
            {saving ? 'Saving…' : initial?.id ? 'Update Allocation' : 'Create Allocation'}
          </button>
          <button onClick={onClose} className="px-6 bg-slate-800 hover:bg-slate-700 text-white font-medium py-2.5 rounded-xl text-sm transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Row ────────────────────────────── */
function AllocRow({ a, onEdit, onWithdraw, onSuspend }: {
  a: Allocation;
  onEdit: () => void;
  onWithdraw: () => void;
  onSuspend: () => void;
}) {
  const mode = MODE_CFG[a.bus_mode] ?? MODE_CFG.TWO_WAY;
  const scfg = STATUS_CFG[a.status] ?? STATUS_CFG.ACTIVE;

  return (
    <tr className="border-t border-white/5 hover:bg-slate-800/30 transition-colors">
      <td className="py-3 px-4">
        <p className="text-sm font-semibold text-white">{a.student_name}</p>
        <p className="text-xs text-slate-500">{a.student_grade}{a.student_section ? ` · ${a.student_section}` : ''}</p>
      </td>
      <td className="py-3 px-4">
        <p className="text-xs text-slate-400">{a.route_name ?? '—'}</p>
      </td>
      <td className="py-3 px-4">
        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${mode.bg} ${mode.color}`}>
          {mode.icon} {mode.label}
        </span>
      </td>
      <td className="py-3 px-4 text-xs text-slate-400">
        {a.bus_mode !== 'ONE_WAY_DROP' && a.pickup_stop_name && (
          <div>🟢 {a.pickup_stop_name} {a.pickup_stop_time ? `· ${fmtTime(a.pickup_stop_time)}` : ''}</div>
        )}
        {a.bus_mode !== 'ONE_WAY_PICKUP' && a.drop_stop_name && (
          <div>🔴 {a.drop_stop_name} {a.drop_stop_time ? `· ${fmtTime(a.drop_stop_time)}` : ''}</div>
        )}
      </td>
      <td className="py-3 px-4 text-xs text-slate-400">
        {a.parent_name && <div>{a.parent_name}</div>}
        {a.parent_phone && <div className="text-slate-500">{a.parent_phone}</div>}
      </td>
      <td className="py-3 px-4">
        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${scfg.bg} ${scfg.color} ${scfg.border}`}>
          {a.status.replace('_',' ')}
        </span>
      </td>
      <td className="py-3 px-4 text-xs text-slate-500">
        {fmtDate(a.effective_from)} → {a.effective_to ? fmtDate(a.effective_to) : '∞'}
      </td>
      <td className="py-3 px-4">
        <div className="flex gap-1">
          <button onClick={onEdit} className="text-xs bg-slate-800 hover:bg-slate-700 text-white px-2 py-1 rounded-lg transition-colors">Edit</button>
          {a.status === 'ACTIVE' && (
            <button onClick={onSuspend} className="text-xs bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 px-2 py-1 rounded-lg transition-colors">Suspend</button>
          )}
          {a.status !== 'WITHDRAWN' && (
            <button onClick={onWithdraw} className="text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 px-2 py-1 rounded-lg transition-colors">Withdraw</button>
          )}
        </div>
      </td>
    </tr>
  );
}

/* ─────────────────────────── Page ──────────────────────────── */
export default function AllocationsPage() {
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [summary, setSummary]         = useState<AllocSummary | null>(null);
  const [loading, setLoading]         = useState(true);
  const [showModal, setShowModal]     = useState(false);
  const [editing, setEditing]         = useState<Allocation | null>(null);
  const [filterStatus, setFilterStatus] = useState('ACTIVE');
  const [filterMode, setFilterMode]     = useState('');
  const [search, setSearch]             = useState('');

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ tenantId: TENANTID });
      if (filterStatus) params.set('status', filterStatus);
      if (filterMode)   params.set('busMode', filterMode);
      if (search)       params.set('search', search);
      const r = await fetch(`/api/school-bus/allocations?${params}`);
      if (r.ok) {
        const d = await r.json();
        setAllocations(d.data ?? []);
        setSummary(d.summary ?? null);
      }
    } catch {} finally { setLoading(false); }
  }, [filterStatus, filterMode, search]);

  useEffect(() => { fetch_(); }, [fetch_]);

  const handleSave = async (data: Record<string, unknown>) => {
    const isEdit = !!editing;
    const url    = isEdit ? `/api/school-bus/allocations/${editing!.id}` : '/api/school-bus/allocations';
    const method = isEdit ? 'PATCH' : 'POST';
    const body   = isEdit ? data : { ...data, tenantId: TENANTID };

    const res = await fetch(url, {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) {
      const d = await res.json();
      throw new Error(d.error ?? 'Save failed');
    }
    setShowModal(false);
    setEditing(null);
    fetch_();
  };

  const handleWithdraw = async (id: string) => {
    if (!confirm('Withdraw this allocation? The student will no longer have a bus seat.')) return;
    await fetch(`/api/school-bus/allocations/${id}`, { method: 'DELETE' });
    fetch_();
  };

  const handleSuspend = async (id: string) => {
    if (!confirm('Suspend this allocation?')) return;
    await fetch(`/api/school-bus/allocations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'SUSPENDED' }),
    });
    fetch_();
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">💺 Seat Allocations</h1>
          <p className="text-slate-400 text-sm mt-0.5">Student enrollment · pickup/drop stops · bus mode · effective dating</p>
        </div>
        <div className="flex gap-2">
          <Link href="/finance/invoices?module=SCHOOL_BUS"
            className="flex items-center gap-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 font-medium px-4 py-2.5 rounded-xl text-sm transition-colors">
            💰 Fees → Finance ↗
          </Link>
          <button onClick={() => { setEditing(null); setShowModal(true); }}
            className="bg-yellow-500 hover:bg-yellow-400 text-slate-900 font-bold px-4 py-2.5 rounded-xl text-sm transition-colors">
            + New Allocation
          </button>
        </div>
      </div>

      {/* Finance cross-link banner */}
      <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl">💰</span>
          <div>
            <p className="text-sm font-semibold text-emerald-300">Transport invoices are managed in Finance</p>
            <p className="text-xs text-slate-400">Generate invoices, record payments, track AR aging and VAT returns in the Finance module</p>
          </div>
        </div>
        <Link href="/finance/invoices?module=SCHOOL_BUS"
          className="flex-shrink-0 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors">
          Open School Bus Fees →
        </Link>
      </div>

      {/* KPIs */}
      {summary && (
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-slate-800 border border-white/5 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-white">{summary.total}</p>
            <p className="text-xs text-slate-500">Total</p>
          </div>
          <div className="bg-green-500/10 border border-green-500/10 rounded-xl p-3">
            <div className="flex justify-between text-xs text-slate-400 mb-2">
              <span>Active</span><span className="text-green-400 font-bold">{summary.active}</span>
            </div>
            <div className="flex justify-between text-xs text-slate-500">
              <span>↕️ Two Way</span><span>{summary.twoWay}</span>
            </div>
            <div className="flex justify-between text-xs text-slate-500">
              <span>↑ Pickup Only</span><span>{summary.pickupOnly}</span>
            </div>
            <div className="flex justify-between text-xs text-slate-500">
              <span>↓ Drop Only</span><span>{summary.dropOnly}</span>
            </div>
          </div>
          <div className="bg-amber-500/10 border border-amber-500/10 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-amber-400">{summary.suspended + summary.pending}</p>
            <p className="text-xs text-slate-500">Suspended / Pending</p>
          </div>
          <div className="bg-slate-800/50 border border-white/5 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-slate-500">{summary.withdrawn}</p>
            <p className="text-xs text-slate-500">Withdrawn</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search student, parent, route…"
          className="bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-yellow-500/50 w-60" />
        <div className="flex gap-1">
          {['', 'ACTIVE', 'SUSPENDED', 'PENDING_APPROVAL', 'WITHDRAWN'].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                filterStatus === s ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' : 'bg-slate-900 text-slate-400 border-white/10 hover:border-white/20'
              }`}>{s === '' ? 'All Status' : s.replace('_',' ')}</button>
          ))}
        </div>
        <div className="flex gap-1">
          {['', 'TWO_WAY', 'ONE_WAY_PICKUP', 'ONE_WAY_DROP'].map(m => (
            <button key={m} onClick={() => setFilterMode(m)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                filterMode === m ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' : 'bg-slate-900 text-slate-400 border-white/10 hover:border-white/20'
              }`}>{m === '' ? 'All Modes' : MODE_CFG[m]?.label ?? m}</button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-800/60 border-b border-white/5">
            <tr>
              {['Student', 'Route', 'Bus Mode', 'Stops', 'Parent / Guardian', 'Status', 'Validity', 'Actions'].map(h => (
                <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={8} className="py-2 px-4">
                    <div className="h-8 bg-slate-800 rounded animate-pulse" />
                  </td>
                </tr>
              ))
            ) : allocations.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-16 text-center">
                  <p className="text-slate-500 text-sm mb-2">No allocations found</p>
                  <button onClick={() => setShowModal(true)}
                    className="text-xs bg-yellow-500/20 text-yellow-300 px-4 py-1.5 rounded-lg">
                    + Create first allocation
                  </button>
                </td>
              </tr>
            ) : (
              allocations.map(a => (
                <AllocRow key={a.id} a={a}
                  onEdit={() => { setEditing(a); setShowModal(true); }}
                  onWithdraw={() => handleWithdraw(a.id)}
                  onSuspend={() => handleSuspend(a.id)} />
              ))
            )}
          </tbody>
        </table>
        {allocations.length > 0 && (
          <div className="px-4 py-3 border-t border-white/5 text-xs text-slate-500">
            {allocations.length} record{allocations.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {showModal && (
        <AllocationModal
          initial={editing ?? undefined}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditing(null); }}
        />
      )}
    </div>
  );
}
