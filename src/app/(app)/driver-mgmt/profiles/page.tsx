'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface Driver {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  contactNumber: string | null;
  nationality: string | null;
  dob: string | null;
  licenseNumber: string;
  licenseExpiry: string | null;
  licenseType: string | null;
  emiratesId: string | null;
  emiratesIdExpiry: string | null;
  passportNumber: string | null;
  passportExpiry: string | null;
  visaExpiry: string | null;
  status: string;
  driverType: string | null;
  hierarchy: string | null;
  communicationLanguage: string | null;
  dateOfJoin: string | null;
  dallasId: string | null;
  garageId: string | null;
  assignedVehicle: { id: string; make: string; model: string; licensePlate: string } | null;
  compliance: {
    license: string;
    emiratesId: string;
    passport: string;
    visa: string;
    alertLevel: string;
    hasIssues: boolean;
  };
}

const STATUSES      = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'ON_LEAVE'];
const DRIVER_TYPES  = ['RENTAL', 'STAFF', 'SCHOOL_BUS', 'LOGISTICS', 'AMBULANCE', 'POOL'];
const LICENSE_TYPES = ['LIGHT_VEHICLE', 'HEAVY_VEHICLE', 'MOTORCYCLE', 'BUS', 'FORKLIFT'];

const statusColor: Record<string, string> = {
  ACTIVE:    'bg-green-500/20 text-green-400',
  INACTIVE:  'bg-slate-500/20 text-slate-400',
  SUSPENDED: 'bg-red-500/20 text-red-400',
  ON_LEAVE:  'bg-amber-500/20 text-amber-400',
};

const alertColor: Record<string, string> = {
  ok:         'bg-green-500/10 border-green-500/20',
  warning:    'bg-amber-500/10 border-amber-500/20',
  critical:   'bg-red-500/10 border-red-500/20',
  incomplete: 'bg-slate-500/10 border-slate-500/20',
};

const alertBadge: Record<string, string> = {
  ok:         'bg-green-500/20 text-green-400',
  warning:    'bg-amber-500/20 text-amber-400',
  critical:   'bg-red-500/20 text-red-400',
  incomplete: 'bg-slate-500/20 text-slate-400',
};

const docIcon: Record<string, string> = {
  valid:         '✓',
  expiring_soon: '⚠',
  expired:       '✗',
  missing:       '—',
};
const docCls: Record<string, string> = {
  valid:         'text-green-400',
  expiring_soon: 'text-amber-400',
  expired:       'text-red-400',
  missing:       'text-slate-600',
};

const EMPTY: Partial<Driver> = {
  name: '', firstName: '', lastName: '', email: '', contactNumber: '', nationality: '',
  licenseNumber: '', licenseType: 'LIGHT_VEHICLE', status: 'ACTIVE', driverType: 'RENTAL',
  communicationLanguage: 'English',
};

export default function DriverProfilesPage() {
  const [drivers, setDrivers]   = useState<Driver[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter]     = useState('');
  const [expiringOnly, setExpiringOnly] = useState(false);
  const [showModal, setShowModal]       = useState(false);
  const [editing, setEditing]           = useState<Driver | null>(null);
  const [form, setForm]                 = useState<Partial<Driver>>(EMPTY);
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState('');
  const [formError, setFormError]       = useState('');
  const [tab, setTab]                   = useState<'identity' | 'compliance' | 'assignment'>('identity');

  const fetchDrivers = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search)       params.set('search', search);
    if (statusFilter) params.set('status', statusFilter);
    if (typeFilter)   params.set('driverType', typeFilter);
    if (expiringOnly) params.set('expiring', 'true');
    try {
      const res = await fetch('/api/drivers?' + params);
      const data = await res.json();
      setDrivers(Array.isArray(data) ? data : (data.data ?? []));
      setError('');
    } catch {
      setError('Failed to load drivers');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, typeFilter, expiringOnly]);

  useEffect(() => { fetchDrivers(); }, [fetchDrivers]);

  const openNew  = () => { setEditing(null); setForm(EMPTY); setTab('identity'); setFormError(''); setShowModal(true); };
  const openEdit = (d: Driver) => { setEditing(d); setForm(d); setTab('identity'); setFormError(''); setShowModal(true); };

  const handleSave = async () => {
    if (!form.licenseNumber) { setFormError('License number is required'); return; }
    if (!form.name && !form.firstName) { setFormError('Name is required'); return; }
    setSaving(true); setFormError('');
    try {
      const url    = editing ? `/api/drivers/${editing.id}` : '/api/drivers';
      const method = editing ? 'PATCH' : 'POST';
      const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (!res.ok) { const d = await res.json(); setFormError(d.error ?? 'Save failed'); return; }
      setShowModal(false); fetchDrivers();
    } catch { setFormError('Network error'); }
    finally { setSaving(false); }
  };

  const handleDeactivate = async (id: string) => {
    if (!confirm('Deactivate this driver? They will be set to INACTIVE.')) return;
    await fetch(`/api/drivers/${id}`, { method: 'DELETE' });
    fetchDrivers();
  };

  const f = (k: keyof Driver, v: unknown) => setForm(p => ({ ...p, [k]: v }));

  const inp = (label: string, key: keyof Driver, opts: { type?: string; placeholder?: string; mono?: boolean } = {}) => (
    <div>
      <label className="block text-xs text-slate-400 mb-1.5">{label}</label>
      <input
        type={opts.type ?? 'text'}
        value={(form[key] as string) ?? ''}
        onChange={e => f(key, e.target.value)}
        placeholder={opts.placeholder}
        className={`w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-cyan-500/50 ${opts.mono ? 'font-mono' : ''}`}
      />
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Driver Profiles</h1>
          <p className="text-slate-400 text-sm mt-0.5">Central driver identity &amp; compliance registry</p>
        </div>
        <button onClick={openNew}
          className="px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-teal-500 text-white rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity flex items-center gap-2">
          <span>+</span> Add Driver
        </button>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name, license, email…"
          className="flex-1 min-w-[200px] bg-slate-800/60 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-cyan-500/50" />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="bg-slate-800/60 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none">
          <option value="">All Status</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="bg-slate-800/60 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none">
          <option value="">All Types</option>
          {DRIVER_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </select>
        <button onClick={() => setExpiringOnly(p => !p)}
          className={`px-4 py-2.5 rounded-xl text-sm font-medium border transition-all ${
            expiringOnly
              ? 'bg-amber-500/20 border-amber-500/30 text-amber-400'
              : 'bg-slate-800/60 border-white/10 text-slate-400 hover:text-slate-300'
          }`}>
          ⚠ Expiring Only
        </button>
      </div>

      {/* Table */}
      <div className="bg-slate-800/40 border border-white/10 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/60 border-b border-white/10">
              <tr>
                {['Name', 'License No.', 'Type', 'Status', 'License', 'Emirates ID', 'Passport', 'Visa', 'Vehicle', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-slate-500">Loading…</td></tr>
              ) : drivers.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-slate-500">No drivers found. Click "Add Driver" to get started.</td></tr>
              ) : drivers.map(d => (
                <tr key={d.id} className={`hover:bg-white/5 transition-colors border-l-2 ${
                  d.compliance.alertLevel === 'critical'   ? 'border-red-500/50' :
                  d.compliance.alertLevel === 'warning'    ? 'border-amber-500/50' :
                  d.compliance.alertLevel === 'incomplete' ? 'border-slate-500/50' : 'border-transparent'
                }`}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">{d.name}</div>
                    {d.nationality && <div className="text-xs text-slate-500">{d.nationality}</div>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-300">{d.licenseNumber}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-slate-400">{(d.driverType ?? '—').replace(/_/g, ' ')}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${statusColor[d.status] ?? 'bg-slate-700 text-slate-300'}`}>{d.status}</span>
                  </td>
                  {/* Doc compliance icons */}
                  {([d.compliance.license, d.compliance.emiratesId, d.compliance.passport, d.compliance.visa] as string[]).map((st, i) => (
                    <td key={i} className="px-4 py-3 text-center">
                      <span className={`font-bold text-base ${docCls[st] ?? docCls.missing}`}>{docIcon[st] ?? '—'}</span>
                    </td>
                  ))}
                  <td className="px-4 py-3">
                    {d.assignedVehicle ? (
                      <div>
                        <div className="text-xs text-slate-300">{d.assignedVehicle.make} {d.assignedVehicle.model}</div>
                        <div className="text-xs font-mono text-slate-500">{d.assignedVehicle.licensePlate}</div>
                      </div>
                    ) : <span className="text-xs text-slate-600">Unassigned</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <button onClick={() => openEdit(d)} className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors">Edit</button>
                      <button onClick={() => handleDeactivate(d.id)} className="px-3 py-1.5 text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors">Deactivate</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-white/10">
          <span className="text-xs text-slate-500">{drivers.length} driver{drivers.length !== 1 ? 's' : ''} shown</span>
        </div>
      </div>

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-3xl max-h-[92vh] flex flex-col shadow-2xl">

            {/* Modal Header */}
            <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between flex-shrink-0">
              <div>
                <h2 className="text-lg font-semibold text-white">{editing ? `Edit Driver — ${editing.name}` : 'Add New Driver'}</h2>
                <p className="text-xs text-slate-400 mt-0.5">Driver Hub — single source of truth for all modules</p>
              </div>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white text-2xl leading-none">×</button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-white/10 flex-shrink-0">
              {([
                { key: 'identity',   label: '👤 Identity' },
                { key: 'compliance', label: '📋 Documents' },
                { key: 'assignment', label: '🚗 Assignment' },
              ] as const).map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                    tab === t.key ? 'border-cyan-500 text-cyan-400' : 'border-transparent text-slate-400 hover:text-slate-300'
                  }`}>{t.label}</button>
              ))}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6">
              {formError && <div className="mb-4 bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm">{formError}</div>}

              {tab === 'identity' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-sm font-semibold text-cyan-400 uppercase tracking-wider mb-4">Personal Details</h3>
                    <div className="grid grid-cols-2 gap-4">
                      {inp('Full Name *', 'name', { placeholder: 'Ahmed Al-Mansouri' })}
                      {inp('First Name', 'firstName', { placeholder: 'Ahmed' })}
                      {inp('Last Name', 'lastName', { placeholder: 'Al-Mansouri' })}
                      {inp('Email', 'email', { type: 'email', placeholder: 'ahmed@company.com' })}
                      {inp('Contact Number', 'contactNumber', { placeholder: '+971 50 123 4567' })}
                      {inp('Nationality', 'nationality', { placeholder: 'UAE' })}
                      {inp('Date of Birth', 'dob', { type: 'date' })}
                      {inp('Date of Join', 'dateOfJoin', { type: 'date' })}
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-cyan-400 uppercase tracking-wider mb-4">Classification</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5">Status</label>
                        <select value={form.status ?? 'ACTIVE'} onChange={e => f('status', e.target.value)}
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-cyan-500/50">
                          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5">Driver Type</label>
                        <select value={form.driverType ?? ''} onChange={e => f('driverType', e.target.value)}
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-cyan-500/50">
                          <option value="">— Select Type —</option>
                          {DRIVER_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                        </select>
                      </div>
                      {inp('Communication Language', 'communicationLanguage', { placeholder: 'English' })}
                      {inp('Hierarchy / Division', 'hierarchy', { placeholder: 'e.g. Rental Division' })}
                      {inp('Dallas ID', 'dallasId', { placeholder: 'System ID', mono: true })}
                    </div>
                  </div>
                </div>
              )}

              {tab === 'compliance' && (
                <div className="space-y-6">
                  <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-xl p-4 text-sm text-cyan-300">
                    These fields are owned by the Driver Hub and shared with all modules. Keep them up to date to maintain compliance status.
                  </div>

                  {/* License */}
                  <div>
                    <h3 className="text-sm font-semibold text-cyan-400 uppercase tracking-wider mb-4">Driving License</h3>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="col-span-2">{inp('License Number *', 'licenseNumber', { placeholder: '1234567', mono: true })}</div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5">License Type</label>
                        <select value={form.licenseType ?? 'LIGHT_VEHICLE'} onChange={e => f('licenseType', e.target.value)}
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-cyan-500/50">
                          {LICENSE_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                        </select>
                      </div>
                      {inp('License Expiry', 'licenseExpiry', { type: 'date' })}
                    </div>
                  </div>

                  {/* Emirates ID */}
                  <div>
                    <h3 className="text-sm font-semibold text-cyan-400 uppercase tracking-wider mb-4">Emirates ID</h3>
                    <div className="grid grid-cols-2 gap-4">
                      {inp('Emirates ID Number', 'emiratesId', { placeholder: '784-1234-1234567-1', mono: true })}
                      {inp('Emirates ID Expiry', 'emiratesIdExpiry', { type: 'date' })}
                    </div>
                  </div>

                  {/* Passport & Visa */}
                  <div>
                    <h3 className="text-sm font-semibold text-cyan-400 uppercase tracking-wider mb-4">Passport &amp; Visa</h3>
                    <div className="grid grid-cols-2 gap-4">
                      {inp('Passport Number', 'passportNumber', { placeholder: 'AB1234567', mono: true })}
                      {inp('Passport Expiry', 'passportExpiry', { type: 'date' })}
                      {inp('Visa Expiry', 'visaExpiry', { type: 'date' })}
                    </div>
                  </div>
                </div>
              )}

              {tab === 'assignment' && (
                <div className="space-y-6">
                  <div className="bg-slate-800/60 border border-white/10 rounded-xl p-5">
                    <h3 className="text-sm font-semibold text-cyan-400 uppercase tracking-wider mb-4">Current Assignment</h3>
                    {editing?.assignedVehicle ? (
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-2xl">🚗</div>
                        <div>
                          <p className="text-white font-semibold">{editing.assignedVehicle.make} {editing.assignedVehicle.model}</p>
                          <p className="text-sm text-slate-400 font-mono">{editing.assignedVehicle.licensePlate}</p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-slate-500 text-sm">No vehicle currently assigned. Vehicle assignment is managed from the Fleet Hub.</p>
                    )}
                  </div>

                  <div className="bg-slate-800/40 border border-white/10 rounded-xl p-5">
                    <h3 className="text-sm font-semibold text-cyan-400 uppercase tracking-wider mb-4">Garage Assignment</h3>
                    {inp('Garage ID', 'garageId', { placeholder: 'Garage reference ID', mono: true })}
                    <p className="text-xs text-slate-500 mt-2">Assign this driver to a home garage for scheduling and compliance reporting.</p>
                  </div>

                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-sm text-amber-300">
                    <strong>Hub Rule:</strong> Vehicle-to-driver assignments are controlled by the Fleet Management Hub. Navigate to Fleet → Vehicles to assign this driver to a vehicle.
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-white/10 flex items-center justify-end gap-3 flex-shrink-0 bg-slate-900">
              <button onClick={() => setShowModal(false)} className="px-5 py-2.5 text-sm text-slate-400 hover:text-white transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="px-6 py-2.5 bg-gradient-to-r from-cyan-500 to-teal-500 text-white rounded-xl font-semibold text-sm hover:opacity-90 disabled:opacity-50 transition-opacity">
                {saving ? 'Saving…' : editing ? 'Update Driver' : 'Add Driver'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
