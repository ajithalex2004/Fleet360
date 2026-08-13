'use client';
import React, { useState, useEffect, useCallback } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface StaffMember {
  id: string;
  staff_no: string;
  full_name: string;
  email: string | null;
  phone: string;
  role: string;
  module: string;
  branch_id: string | null;
  branch_name: string;
  emirate: string | null;
  start_date: string;
  end_date: string | null;
  status: string;
  employee_id: string | null;
  nationality: string | null;
  notes: string | null;
  created_at: string;
}

interface KPI {
  total: number;
  active: number;
  on_leave: number;
  branch_managers: number;
}

type ViewMode = 'grid' | 'table';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const ROLES = ['BRANCH_MANAGER', 'RENTAL_AGENT', 'COORDINATOR', 'DRIVER', 'ADMIN'];

const ROLE_COLORS: Record<string, string> = {
  BRANCH_MANAGER: 'bg-teal-500/20 text-teal-300 border-teal-500/40',
  RENTAL_AGENT:   'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  COORDINATOR:    'bg-blue-500/20 text-blue-300 border-blue-500/40',
  DRIVER:         'bg-amber-500/20 text-amber-300 border-amber-500/40',
  ADMIN:          'bg-slate-500/20 text-slate-300 border-slate-500/40',
};

const MODULE_OPTIONS = ['RENTAL', 'BOTH'];

const STATUS_COLORS: Record<string, string> = {
  ACTIVE:      'bg-emerald-500/20 text-emerald-400 border-emerald-500/40',
  ON_LEAVE:    'bg-amber-500/20 text-amber-400 border-amber-500/40',
  TRANSFERRED: 'bg-blue-500/20 text-blue-400 border-blue-500/40',
  INACTIVE:    'bg-slate-500/20 text-slate-400 border-slate-500/40',
};

const UAE_EMIRATES = ['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah'];

const EMIRATE_FLAGS: Record<string, string> = {
  'Abu Dhabi':      '🏛️',
  'Dubai':          '🌆',
  'Sharjah':        '🏙️',
  'Ajman':          '🏘️',
  'Umm Al Quwain':  '⛵',
  'Ras Al Khaimah': '⛰️',
  'Fujairah':       '🌊',
};

function getInitials(name: string): string {
  return name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
}

function formatDate(d: string | null) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return d; }
}

const EMPTY_FORM = {
  full_name:   '',
  phone:       '',
  email:       '',
  employee_id: '',
  role:        'RENTAL_AGENT',
  module:      'RENTAL',
  branch_name: '',
  emirate:     '',
  start_date:  '',
  end_date:    '',
  nationality: '',
  notes:       '',
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
export default function RentalStaffPage() {
  const [staff, setStaff]         = useState<StaffMember[]>([]);
  const [kpi, setKpi]             = useState<KPI>({ total: 0, active: 0, on_leave: 0, branch_managers: 0 });
  const [loading, setLoading]     = useState(true);
  const [view, setView]           = useState<ViewMode>('grid');

  const [search, setSearch]           = useState('');
  const [filterBranch, setFilterBranch] = useState('');
  const [filterRole, setFilterRole]     = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const [showAssign, setShowAssign]       = useState(false);
  const [showTransfer, setShowTransfer]   = useState(false);
  const [editTarget, setEditTarget]       = useState<StaffMember | null>(null);
  const [transferTarget, setTransferTarget] = useState<StaffMember | null>(null);

  const [form, setForm]                   = useState({ ...EMPTY_FORM });
  const [transferForm, setTransferForm]   = useState({ branch_name: '', emirate: '', reason: '' });
  const [saving, setSaving]               = useState(false);
  const [error, setError]                 = useState('');

  const fetchStaff = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ module: 'RENTAL', limit: '100' });
      if (search)       qs.set('search', search);
      if (filterBranch) qs.set('branch_name', filterBranch);
      if (filterRole)   qs.set('role', filterRole);
      if (filterStatus) qs.set('status', filterStatus);

      const res  = await fetch(`/api/branch-staff?${qs}`);
      const data = await res.json();
      setStaff(data.data || []);
      setKpi(data.kpi  || { total: 0, active: 0, on_leave: 0, branch_managers: 0 });
    } catch {
      setStaff([]);
    } finally {
      setLoading(false);
    }
  }, [search, filterBranch, filterRole, filterStatus]);

  useEffect(() => { fetchStaff(); }, [fetchStaff]);

  const branches = Array.from(new Set(staff.map(s => s.branch_name))).filter(Boolean).sort();

  const handleSave = async () => {
    setError('');
    setSaving(true);
    try {
      const isEdit = !!editTarget;
      const body   = isEdit ? { id: editTarget!.id, ...form } : form;
      const res    = await fetch('/api/branch-staff', {
        method:  isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed'); return; }
      setShowAssign(false);
      setEditTarget(null);
      setForm({ ...EMPTY_FORM });
      fetchStaff();
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (id: string, newStatus: string) => {
    await fetch('/api/branch-staff', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id, status: newStatus }),
    });
    fetchStaff();
  };

  const handleTransfer = async () => {
    if (!transferTarget || !transferForm.branch_name) return;
    setSaving(true);
    try {
      const body = {
        id:          transferTarget.id,
        branch_name: transferForm.branch_name,
        emirate:     transferForm.emirate || transferTarget.emirate,
        status:      'TRANSFERRED',
        notes:       transferForm.reason
          ? `Transferred: ${transferForm.reason} (${new Date().toLocaleDateString('en-GB')})`
          : transferTarget.notes,
      };
      await fetch('/api/branch-staff', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      setShowTransfer(false);
      setTransferTarget(null);
      setTransferForm({ branch_name: '', emirate: '', reason: '' });
      fetchStaff();
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (s: StaffMember) => {
    setEditTarget(s);
    setForm({
      full_name:   s.full_name,
      phone:       s.phone,
      email:       s.email || '',
      employee_id: s.employee_id || '',
      role:        s.role,
      module:      s.module,
      branch_name: s.branch_name,
      emirate:     s.emirate || '',
      start_date:  s.start_date?.slice(0, 10) || '',
      end_date:    s.end_date?.slice(0, 10) || '',
      nationality: s.nationality || '',
      notes:       s.notes || '',
    });
    setShowAssign(true);
  };

  return (
    <div className="space-y-8">
      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-1">Branch Staff Management</h1>
          <p className="text-slate-400 text-sm">Manage staff assignments across all Rent-A-Car branches</p>
        </div>
        <button
          onClick={() => { setEditTarget(null); setForm({ ...EMPTY_FORM }); setShowAssign(true); }}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 text-white text-sm font-semibold hover:opacity-90 transition-opacity shadow-lg"
        >
          + Assign Staff
        </button>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Staff',     value: kpi.total,           color: 'text-white' },
          { label: 'Active',          value: kpi.active,          color: 'text-emerald-400' },
          { label: 'Branch Managers', value: kpi.branch_managers, color: 'text-teal-400' },
          { label: 'On Leave',        value: kpi.on_leave,        color: 'text-amber-400' },
        ].map(card => (
          <div key={card.label} className="bg-slate-800/50 border border-white/10 rounded-2xl p-5">
            <p className="text-xs text-slate-500 font-medium mb-1">{card.label}</p>
            <p className={`text-3xl font-bold ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* ── Filters + View Toggle ── */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search name, staff no, employee ID..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="px-4 py-2 bg-slate-800/60 border border-white/10 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:border-teal-500/50 w-64"
        />
        <select value={filterBranch} onChange={e => setFilterBranch(e.target.value)}
          className="px-4 py-2 bg-slate-800/60 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-teal-500/50">
          <option value="">All Branches</option>
          {branches.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
          className="px-4 py-2 bg-slate-800/60 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-teal-500/50">
          <option value="">All Roles</option>
          {ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g,' ')}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="px-4 py-2 bg-slate-800/60 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-teal-500/50">
          <option value="">All Statuses</option>
          {['ACTIVE','ON_LEAVE','TRANSFERRED','INACTIVE'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="ml-auto flex gap-1 bg-slate-800/60 border border-white/10 rounded-xl p-1">
          <button onClick={() => setView('grid')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${view==='grid' ? 'bg-teal-600 text-white' : 'text-slate-400 hover:text-white'}`}>
            ⊞ Grid
          </button>
          <button onClick={() => setView('table')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${view==='table' ? 'bg-teal-600 text-white' : 'text-slate-400 hover:text-white'}`}>
            ☰ Table
          </button>
        </div>
      </div>

      {/* ── Content ── */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <div className="inline-block w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-slate-400 text-sm">Loading staff data...</p>
          </div>
        </div>
      ) : staff.length === 0 ? (
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-16 text-center">
          <div className="text-5xl mb-4">👔</div>
          <p className="text-slate-300 text-lg font-semibold">No staff assignments found</p>
          <p className="text-slate-500 text-sm mt-1">Click "+ Assign Staff" to add your first team member</p>
        </div>
      ) : view === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {staff.map(s => (
            <div key={s.id} className="bg-slate-800/60 border border-white/10 rounded-2xl p-5 hover:border-teal-500/30 transition-all group">
              <div className="flex items-start gap-4 mb-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-teal-600 to-cyan-700 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                  {getInitials(s.full_name)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold truncate">{s.full_name}</p>
                  <p className="text-slate-500 text-xs">{s.staff_no}</p>
                  {s.employee_id && <p className="text-slate-600 text-xs">EID: {s.employee_id}</p>}
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border flex-shrink-0 ${STATUS_COLORS[s.status] || STATUS_COLORS.INACTIVE}`}>
                  {s.status}
                </span>
              </div>

              <div className="flex flex-wrap gap-2 mb-3">
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${ROLE_COLORS[s.role] || 'bg-slate-500/20 text-slate-400 border-slate-500/40'}`}>
                  {s.role.replace(/_/g,' ')}
                </span>
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold border bg-teal-500/10 text-teal-400 border-teal-500/20">
                  {s.module}
                </span>
              </div>

              <div className="flex items-center gap-1.5 text-slate-400 text-xs mb-1">
                <span>🏢</span>
                <span className="font-medium text-slate-300">{s.branch_name}</span>
                {s.emirate && <span>{EMIRATE_FLAGS[s.emirate] || '📍'} {s.emirate}</span>}
              </div>
              {s.phone && (
                <div className="flex items-center gap-1.5 text-slate-500 text-xs mb-0.5">
                  <span>📞</span><span>{s.phone}</span>
                </div>
              )}
              {s.email && (
                <div className="flex items-center gap-1.5 text-slate-500 text-xs mb-2">
                  <span>✉️</span><span className="truncate">{s.email}</span>
                </div>
              )}
              <p className="text-slate-600 text-xs mb-3">From: {formatDate(s.start_date)}</p>

              <div className="flex items-center gap-2 pt-3 border-t border-white/5">
                <button onClick={() => openEdit(s)}
                  className="flex-1 px-3 py-1.5 rounded-lg bg-teal-600/20 border border-teal-500/30 text-teal-400 hover:bg-teal-600/40 text-xs font-medium transition-colors">
                  Edit
                </button>
                <button onClick={() => { setTransferTarget(s); setShowTransfer(true); }}
                  className="flex-1 px-3 py-1.5 rounded-lg bg-blue-600/20 border border-blue-500/30 text-blue-400 hover:bg-blue-600/40 text-xs font-medium transition-colors">
                  Transfer
                </button>
                <div className="relative group/menu">
                  <button className="px-2.5 py-1.5 rounded-lg bg-slate-700/50 border border-white/10 text-slate-400 hover:text-white text-xs transition-colors">
                    ···
                  </button>
                  <div className="absolute right-0 top-full mt-1 bg-slate-800 border border-white/10 rounded-xl p-1 shadow-xl z-10 min-w-[140px] hidden group-hover/menu:block">
                    {s.status !== 'ON_LEAVE' && (
                      <button onClick={() => handleStatus(s.id, 'ON_LEAVE')}
                        className="w-full text-left px-3 py-1.5 text-xs text-amber-400 hover:bg-white/5 rounded-lg">
                        Set On Leave
                      </button>
                    )}
                    {s.status === 'ON_LEAVE' && (
                      <button onClick={() => handleStatus(s.id, 'ACTIVE')}
                        className="w-full text-left px-3 py-1.5 text-xs text-emerald-400 hover:bg-white/5 rounded-lg">
                        Mark Active
                      </button>
                    )}
                    {s.status !== 'INACTIVE' && (
                      <button onClick={() => handleStatus(s.id, 'INACTIVE')}
                        className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-white/5 rounded-lg">
                        Deactivate
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5">
                  {['Staff No','Name','Role','Module','Branch / Emirate','Phone','Start Date','Status','Actions'].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {staff.map(s => (
                  <tr key={s.id} className="hover:bg-white/3 transition-colors">
                    <td className="px-5 py-3.5 font-mono text-xs text-slate-400">{s.staff_no}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-teal-600 to-cyan-700 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                          {getInitials(s.full_name)}
                        </div>
                        <div>
                          <p className="text-white font-medium text-sm">{s.full_name}</p>
                          {s.employee_id && <p className="text-slate-600 text-xs">{s.employee_id}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${ROLE_COLORS[s.role] || 'bg-slate-500/20 text-slate-400 border-slate-500/40'}`}>
                        {s.role.replace(/_/g,' ')}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold border bg-teal-500/10 text-teal-400 border-teal-500/20">
                        {s.module}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-300 text-xs">
                      <p>{s.branch_name}</p>
                      {s.emirate && <p className="text-slate-500">{EMIRATE_FLAGS[s.emirate] || ''} {s.emirate}</p>}
                    </td>
                    <td className="px-5 py-3.5 text-slate-400 text-xs">{s.phone}</td>
                    <td className="px-5 py-3.5 text-slate-400 text-xs font-mono">{formatDate(s.start_date)}</td>
                    <td className="px-5 py-3.5">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${STATUS_COLORS[s.status] || STATUS_COLORS.INACTIVE}`}>
                        {s.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => openEdit(s)}
                          className="px-2.5 py-1 rounded-lg bg-teal-600/20 border border-teal-500/30 text-teal-400 hover:bg-teal-600/40 text-xs font-medium transition-colors">
                          Edit
                        </button>
                        <button onClick={() => { setTransferTarget(s); setShowTransfer(true); }}
                          className="px-2.5 py-1 rounded-lg bg-blue-600/20 border border-blue-500/30 text-blue-400 hover:bg-blue-600/40 text-xs font-medium transition-colors">
                          Transfer
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Assign / Edit Modal ── */}
      {showAssign && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-white/10 rounded-2xl p-7 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">{editTarget ? 'Edit Staff Member' : 'Assign Staff to Branch'}</h2>
              <button onClick={() => { setShowAssign(false); setEditTarget(null); setError(''); }}
                className="text-slate-400 hover:text-white text-2xl leading-none">✕</button>
            </div>

            {error && (
              <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">{error}</div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Full Name *</label>
                <input value={form.full_name} onChange={e => setForm({...form, full_name: e.target.value})}
                  placeholder="e.g. Ahmed Al-Mansouri"
                  className="w-full px-4 py-2.5 bg-slate-900/60 border border-white/10 rounded-xl text-white placeholder-slate-600 text-sm focus:outline-none focus:border-teal-500/50" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Phone *</label>
                <input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})}
                  placeholder="+971 50 000 0000"
                  className="w-full px-4 py-2.5 bg-slate-900/60 border border-white/10 rounded-xl text-white placeholder-slate-600 text-sm focus:outline-none focus:border-teal-500/50" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Email</label>
                <input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})}
                  placeholder="staff@company.ae"
                  className="w-full px-4 py-2.5 bg-slate-900/60 border border-white/10 rounded-xl text-white placeholder-slate-600 text-sm focus:outline-none focus:border-teal-500/50" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Employee ID</label>
                <input value={form.employee_id} onChange={e => setForm({...form, employee_id: e.target.value})}
                  placeholder="EMP-0001"
                  className="w-full px-4 py-2.5 bg-slate-900/60 border border-white/10 rounded-xl text-white placeholder-slate-600 text-sm focus:outline-none focus:border-teal-500/50" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Role *</label>
                <select value={form.role} onChange={e => setForm({...form, role: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-900/60 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-teal-500/50">
                  {ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g,' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Module *</label>
                <select value={form.module} onChange={e => setForm({...form, module: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-900/60 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-teal-500/50">
                  {MODULE_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Branch Name *</label>
                <input value={form.branch_name} onChange={e => setForm({...form, branch_name: e.target.value})}
                  placeholder="e.g. Dubai Marina Branch"
                  className="w-full px-4 py-2.5 bg-slate-900/60 border border-white/10 rounded-xl text-white placeholder-slate-600 text-sm focus:outline-none focus:border-teal-500/50" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Emirate</label>
                <select value={form.emirate} onChange={e => setForm({...form, emirate: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-900/60 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-teal-500/50">
                  <option value="">Select Emirate</option>
                  {UAE_EMIRATES.map(e => <option key={e} value={e}>{e}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Start Date *</label>
                <input type="date" value={form.start_date} onChange={e => setForm({...form, start_date: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-900/60 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-teal-500/50" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">End Date (optional)</label>
                <input type="date" value={form.end_date} onChange={e => setForm({...form, end_date: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-900/60 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-teal-500/50" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Nationality</label>
                <input value={form.nationality} onChange={e => setForm({...form, nationality: e.target.value})}
                  placeholder="e.g. Emirati, Indian..."
                  className="w-full px-4 py-2.5 bg-slate-900/60 border border-white/10 rounded-xl text-white placeholder-slate-600 text-sm focus:outline-none focus:border-teal-500/50" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Notes</label>
                <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})}
                  rows={2} placeholder="Additional notes..."
                  className="w-full px-4 py-2.5 bg-slate-900/60 border border-white/10 rounded-xl text-white placeholder-slate-600 text-sm focus:outline-none focus:border-teal-500/50 resize-none" />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => { setShowAssign(false); setEditTarget(null); setError(''); }}
                className="flex-1 px-4 py-2.5 border border-white/10 rounded-xl text-white hover:bg-white/5 text-sm font-medium transition-colors">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 px-4 py-2.5 bg-gradient-to-r from-teal-600 to-cyan-600 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50">
                {saving ? 'Saving...' : editTarget ? 'Update Staff' : 'Assign Staff'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Transfer Modal ── */}
      {showTransfer && transferTarget && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-white/10 rounded-2xl p-7 w-full max-w-md">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">Transfer Staff</h2>
              <button onClick={() => { setShowTransfer(false); setTransferTarget(null); }}
                className="text-slate-400 hover:text-white text-2xl leading-none">✕</button>
            </div>
            <p className="text-slate-400 text-sm mb-5">
              Transferring <span className="text-white font-medium">{transferTarget.full_name}</span> from{' '}
              <span className="text-teal-400">{transferTarget.branch_name}</span>
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">New Branch Name *</label>
                <input value={transferForm.branch_name} onChange={e => setTransferForm({...transferForm, branch_name: e.target.value})}
                  placeholder="e.g. Sharjah Airport Branch"
                  className="w-full px-4 py-2.5 bg-slate-900/60 border border-white/10 rounded-xl text-white placeholder-slate-600 text-sm focus:outline-none focus:border-teal-500/50" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">New Emirate</label>
                <select value={transferForm.emirate} onChange={e => setTransferForm({...transferForm, emirate: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-900/60 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-teal-500/50">
                  <option value="">Select Emirate</option>
                  {UAE_EMIRATES.map(e => <option key={e} value={e}>{e}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Transfer Reason</label>
                <input value={transferForm.reason} onChange={e => setTransferForm({...transferForm, reason: e.target.value})}
                  placeholder="e.g. New branch opening, staff request..."
                  className="w-full px-4 py-2.5 bg-slate-900/60 border border-white/10 rounded-xl text-white placeholder-slate-600 text-sm focus:outline-none focus:border-teal-500/50" />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => { setShowTransfer(false); setTransferTarget(null); }}
                className="flex-1 px-4 py-2.5 border border-white/10 rounded-xl text-white hover:bg-white/5 text-sm font-medium transition-colors">
                Cancel
              </button>
              <button onClick={handleTransfer} disabled={saving || !transferForm.branch_name}
                className="flex-1 px-4 py-2.5 bg-gradient-to-r from-teal-600 to-cyan-600 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50">
                {saving ? 'Transferring...' : 'Confirm Transfer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
