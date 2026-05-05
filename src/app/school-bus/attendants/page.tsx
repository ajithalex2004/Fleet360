'use client';
/**
 * School Bus — Nanny / Bus Attendant Registry
 * UAE law mandates a female attendant on every active school bus.
 * This registry tracks certifications, Emirates ID expiry, and route assignments.
 */
import { useState, useEffect, useCallback } from 'react';

interface Attendant {
  id: string;
  employee_id: string;
  first_name: string;
  last_name: string;
  gender: string;
  nationality?: string;
  phone?: string;
  email?: string;
  emirates_id?: string;
  emirates_id_expiry?: string;
  certification_no?: string;
  certification_expiry?: string;
  route_id?: string;
  route_name?: string;
  assigned_vehicle_id?: string;
  status: string;
  joining_date?: string;
  notes?: string;
  is_active: boolean;
  cert_expiring_soon?: boolean;
  eid_expiring_soon?: boolean;
}

const NATIONALITIES = ['Filipino','Indian','Pakistani','Sri Lankan','Bangladeshi','Indonesian','Ethiopian','Kenyan','Ugandan','Egyptian','Jordanian','Emirati','Other'];
const STATUSES = ['ACTIVE','ON_LEAVE','SUSPENDED','TERMINATED'];

/* ─── Modal ─────────────────────────────────────────────────── */
function AttendantModal({ att, onClose, onSaved }: {
  att?: Attendant | null; onClose: () => void; onSaved: () => void;
}) {
  const isEdit = !!att;
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const [form, setForm] = useState({
    firstName:           att?.first_name            ?? '',
    lastName:            att?.last_name             ?? '',
    gender:              att?.gender                ?? 'Female',
    nationality:         att?.nationality           ?? '',
    phone:               att?.phone                 ?? '',
    email:               att?.email                 ?? '',
    emiratesId:          att?.emirates_id           ?? '',
    emiratesIdExpiry:    att?.emirates_id_expiry    ?? '',
    certificationNo:     att?.certification_no      ?? '',
    certificationExpiry: att?.certification_expiry  ?? '',
    routeName:           att?.route_name            ?? '',
    assignedVehicleId:   att?.assigned_vehicle_id   ?? '',
    status:              att?.status                ?? 'ACTIVE',
    joiningDate:         att?.joining_date          ?? '',
    notes:               att?.notes                 ?? '',
  });

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value }));

  async function save() {
    if (!form.firstName.trim() || !form.lastName.trim()) { setError('Name is required'); return; }
    setSaving(true); setError('');
    try {
      const url    = isEdit ? `/api/school-bus/attendants/${att!.id}` : '/api/school-bus/attendants';
      const method = isEdit ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) { const d = await res.json(); setError(d.error ?? 'Save failed'); return; }
      onSaved();
    } catch { setError('Network error'); }
    finally { setSaving(false); }
  }

  const f = (label: string, k: keyof typeof form, type = 'text', ph = '') => (
    <div className="space-y-1">
      <label className="text-xs text-slate-400">{label}</label>
      <input type={type} value={String(form[k])} onChange={set(k)} placeholder={ph}
        className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-yellow-500/50" />
    </div>
  );

  const sel = (label: string, k: keyof typeof form, opts: string[], ph = '') => (
    <div className="space-y-1">
      <label className="text-xs text-slate-400">{label}</label>
      <select value={String(form[k])} onChange={set(k)}
        className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-yellow-500/50">
        {ph && <option value="">{ph}</option>}
        {opts.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-white font-bold">{isEdit ? 'Edit Attendant' : 'Register New Attendant'}</h2>
          {isEdit && <span className="text-xs font-mono text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 px-2 py-0.5 rounded">{att!.employee_id}</span>}
          <button onClick={onClose} className="text-slate-500 hover:text-white text-xl">×</button>
        </div>

        <div className="p-6 space-y-5">
          {/* Personal Info */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Personal Information</p>
            <div className="grid grid-cols-2 gap-4">
              {f('First Name *', 'firstName', 'text', 'e.g. Fatima')}
              {f('Last Name *',  'lastName',  'text', 'e.g. Al Hassan')}
              {sel('Gender', 'gender', ['Female','Male'])}
              {sel('Nationality', 'nationality', NATIONALITIES, '— Select —')}
              {f('Phone', 'phone', 'tel', '+971 50 000 0000')}
              {f('Email', 'email', 'email', 'attendant@school.ae')}
            </div>
          </div>

          {/* Documents */}
          <div className="rounded-xl bg-slate-800/50 border border-white/5 p-4 space-y-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Documents & Certifications</p>
            <div className="grid grid-cols-2 gap-4">
              {f('Emirates ID Number', 'emiratesId', 'text', '784-XXXX-XXXXXXX-X')}
              {f('Emirates ID Expiry', 'emiratesIdExpiry', 'date')}
              {f('Certification Number', 'certificationNo', 'text', 'Child Safety / First Aid cert no.')}
              {f('Certification Expiry', 'certificationExpiry', 'date')}
            </div>
          </div>

          {/* Assignment */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Route Assignment</p>
            <div className="grid grid-cols-2 gap-4">
              {f('Route Name', 'routeName', 'text', 'e.g. Dubai Marina Morning Route')}
              {f('Vehicle ID / Plate', 'assignedVehicleId', 'text', 'e.g. DXB-A-12345')}
              {sel('Employment Status', 'status', STATUSES)}
              {f('Joining Date', 'joiningDate', 'date')}
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <label className="text-xs text-slate-400">Notes</label>
            <textarea value={form.notes} onChange={set('notes')} rows={2}
              placeholder="Languages spoken, special requirements…"
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-yellow-500/50 resize-none" />
          </div>

          {error && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-slate-800 border border-white/10 text-slate-300 text-sm font-semibold hover:bg-slate-700 transition-all">
              Cancel
            </button>
            <button onClick={save} disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-yellow-500 text-slate-900 text-sm font-bold hover:bg-yellow-400 transition-all disabled:opacity-50">
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Register Attendant'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Main Page ──────────────────────────────────────────────── */
export default function AttendantsPage() {
  const [attendants, setAttendants] = useState<Attendant[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [modal,      setModal]      = useState<'new' | Attendant | null>(null);
  const [search,     setSearch]     = useState('');
  const [toast,      setToast]      = useState<{ msg: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      const res = await fetch(`/api/school-bus/attendants?${params}`);
      if (res.ok) { const d = await res.json(); setAttendants(d.data ?? []); }
    } finally { setLoading(false); }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok }); setTimeout(() => setToast(null), 3500);
  };

  const active    = attendants.filter(a => a.status === 'ACTIVE').length;
  const expiring  = attendants.filter(a => a.cert_expiring_soon || a.eid_expiring_soon).length;
  const assigned  = attendants.filter(a => a.route_name).length;

  const STATUS_COLOR: Record<string, string> = {
    ACTIVE:'bg-emerald-500/20 text-emerald-400', ON_LEAVE:'bg-blue-500/20 text-blue-400',
    SUSPENDED:'bg-orange-500/20 text-orange-400', TERMINATED:'bg-red-500/20 text-red-400',
  };

  return (
    <div className="space-y-6 max-w-full">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-4 py-3 rounded-xl border text-sm font-semibold shadow-xl ${
          toast.ok ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300' : 'bg-red-500/20 border-red-500/30 text-red-300'
        }`}>{toast.ok ? '✅' : '❌'} {toast.msg}</div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">👩 Attendant Registry</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Bus nannies / female attendants — UAE regulatory requirement
          </p>
        </div>
        <button onClick={() => setModal('new')}
          className="px-5 py-2.5 rounded-xl bg-yellow-500 text-slate-900 font-bold text-sm hover:bg-yellow-400 transition-all">
          + Register Attendant
        </button>
      </div>

      {/* UAE Compliance Notice */}
      <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
        <span className="text-xl flex-shrink-0">⚠️</span>
        <div>
          <p className="text-amber-300 text-sm font-semibold">UAE Regulatory Requirement</p>
          <p className="text-slate-400 text-xs mt-0.5">
            All school buses operating in the UAE must have a certified female attendant on board at all times when transporting students.
            Ensure Emirates ID and child safety certifications are up to date.
          </p>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label:'Total Attendants', value: attendants.length, color:'text-white',       icon:'👩' },
          { label:'Active',           value: active,            color:'text-emerald-400', icon:'✅' },
          { label:'Route Assigned',   value: assigned,          color:'text-blue-400',    icon:'🚌' },
          { label:'Docs Expiring',    value: expiring,          color: expiring > 0 ? 'text-red-400' : 'text-slate-400', icon:'⚠️' },
        ].map(k => (
          <div key={k.label} className={`rounded-2xl bg-slate-900 border p-4 ${
            k.label === 'Docs Expiring' && expiring > 0 ? 'border-red-500/30 bg-red-500/5' : 'border-white/10'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-xl">{k.icon}</span>
              <span className={`text-2xl font-bold ${k.color}`}>{loading ? '…' : k.value}</span>
            </div>
            <p className="text-slate-500 text-xs mt-1">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, employee ID or phone…"
        className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-yellow-500/50" />

      {/* Table */}
      <div className="rounded-2xl bg-slate-900 border border-white/10 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-500 text-sm">Loading attendants…</div>
        ) : attendants.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <span className="text-5xl">👩</span>
            <p className="text-slate-400 font-medium">No attendants registered</p>
            <p className="text-slate-600 text-xs">Register bus attendants to meet UAE compliance requirements</p>
            <button onClick={() => setModal('new')}
              className="mt-2 px-5 py-2.5 rounded-xl bg-yellow-500 text-slate-900 font-bold text-sm hover:bg-yellow-400 transition-all">
              + Register First Attendant
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-slate-500 text-xs">
                <th className="px-5 py-3 text-left">Employee</th>
                <th className="px-4 py-3 text-left">Contact</th>
                <th className="px-4 py-3 text-left">Documents</th>
                <th className="px-4 py-3 text-left">Assignment</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {attendants.map(a => (
                <tr key={a.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="px-5 py-3">
                    <p className="text-white font-semibold">{a.first_name} {a.last_name}</p>
                    <p className="text-slate-500 text-xs font-mono">{a.employee_id}</p>
                    {a.nationality && <p className="text-slate-600 text-xs">{a.nationality}</p>}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400 space-y-0.5">
                    {a.phone && <p>📞 {a.phone}</p>}
                    {a.email && <p>✉️ {a.email}</p>}
                  </td>
                  <td className="px-4 py-3 text-xs space-y-1">
                    {a.emirates_id ? (
                      <div className={`flex items-center gap-1 ${a.eid_expiring_soon ? 'text-red-400' : 'text-slate-400'}`}>
                        🪪 {a.emirates_id}
                        {a.eid_expiring_soon && <span className="text-red-400 font-bold">⚠️ EXPIRING</span>}
                      </div>
                    ) : <span className="text-slate-600">EID not entered</span>}
                    {a.certification_no ? (
                      <div className={`flex items-center gap-1 ${a.cert_expiring_soon ? 'text-red-400' : 'text-slate-400'}`}>
                        📜 {a.certification_no}
                        {a.cert_expiring_soon && <span className="text-red-400 font-bold">⚠️ EXPIRING</span>}
                      </div>
                    ) : <span className="text-slate-600">Cert not entered</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    {a.route_name
                      ? <p className="text-slate-300">🚌 {a.route_name}</p>
                      : <span className="text-slate-600">Unassigned</span>
                    }
                    {a.assigned_vehicle_id && <p className="mt-0.5">🚐 {a.assigned_vehicle_id}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLOR[a.status] ?? 'bg-slate-700 text-slate-400'}`}>
                      {a.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => setModal(a)}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 text-xs hover:bg-slate-700 transition-all">
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <AttendantModal
          att={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); showToast('Attendant saved', true); load(); }}
        />
      )}
    </div>
  );
}
