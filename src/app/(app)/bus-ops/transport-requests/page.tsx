'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { ClipboardList, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/bus-ops/theme';

// ── Types ─────────────────────────────────────────────────────────────────────

interface StaffMember { id: string; name: string; employeeId: string; department?: string | null }

interface TransportRequest {
  id: string;
  requestNo: string | null;
  staffMemberId: string;
  staffMember: StaffMember;
  requestType: string;
  tripDate: string;
  pickupLocation: string | null;
  dropLocation: string | null;
  reason: string | null;
  status: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  notes: string | null;
  createdAt: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const REQUEST_TYPES = ['ADHOC', 'ROUTE_CHANGE', 'NEW_ROUTE', 'TEMPORARY'] as const;
const STATUSES      = ['PENDING', 'APPROVED', 'REJECTED', 'FULFILLED']    as const;

const STATUS_COLORS: Record<string, string> = {
  PENDING:   'bg-amber-500/20 text-amber-400 border-amber-500/30',
  APPROVED:  'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  REJECTED:  'bg-rose-500/20 text-rose-400 border-rose-500/30',
  FULFILLED: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
};

const TYPE_LABELS: Record<string, string> = {
  ADHOC:        'Ad-hoc',
  ROUTE_CHANGE: 'Route change',
  NEW_ROUTE:    'New route',
  TEMPORARY:    'Temporary',
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TransportRequestsPage() {
  const [requests,     setRequests]     = useState<TransportRequest[]>([]);
  const [staff,        setStaff]        = useState<StaffMember[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [showModal,    setShowModal]    = useState(false);
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState('');

  const emptyForm = {
    staffMemberId: '',
    requestType:   'ADHOC' as string,
    tripDate:      '',
    pickupLocation: '',
    dropLocation:  '',
    reason:        '',
    notes:         '',
  };
  const [formData, setFormData] = useState(emptyForm);

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadRequests = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'All') params.set('status', statusFilter);
      const res = await fetch(`/api/bus-ops/transport-requests?${params}`, { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setRequests(Array.isArray(data) ? data : []);
    } catch { setError('Failed to load requests'); }
    finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  // Staff list for the modal dropdown — loaded once on mount.
  useEffect(() => {
    fetch('/api/bus-ops/staff?active=true', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : [])
      .then(d => setStaff(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  // ── Mutations ───────────────────────────────────────────────────────────────

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const payload = {
        ...formData,
        tripDate:       new Date(formData.tripDate).toISOString(),
        pickupLocation: formData.pickupLocation || null,
        dropLocation:   formData.dropLocation   || null,
        reason:         formData.reason         || null,
        notes:          formData.notes          || null,
        status:         'PENDING',
      };
      const res = await fetch('/api/bus-ops/transport-requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? 'Failed'); }
      setShowModal(false); setFormData(emptyForm); loadRequests();
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to create request'); }
    finally { setSaving(false); }
  };

  const updateStatus = async (id: string, status: string) => {
    try {
      const res = await fetch(`/api/bus-ops/transport-requests/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      loadRequests();
    } catch { setError('Failed to update status'); }
  };

  const deleteRequest = async (id: string) => {
    if (!confirm('Delete this transport request?')) return;
    try {
      await fetch(`/api/bus-ops/transport-requests/${id}`, { method: 'DELETE' });
      loadRequests();
    } catch { setError('Failed to delete'); }
  };

  // ── Stats ───────────────────────────────────────────────────────────────────

  const pending   = requests.filter(r => r.status === 'PENDING').length;
  const approved  = requests.filter(r => r.status === 'APPROVED').length;
  const fulfilled = requests.filter(r => r.status === 'FULFILLED').length;

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-[var(--text-muted)] animate-pulse">Loading transport requests...</div>
    </div>
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Transport Requests"
        subtitle={`${pending} pending · ${approved} approved · ${fulfilled} fulfilled · ${requests.length} total`}
        icon={ClipboardList}
        accent="blue"
        actions={
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            <Plus className="w-4 h-4" /> New Request
          </button>
        }
      />

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm">
          {error}
        </div>
      )}

      {/* Filter bar */}
      <div className="flex gap-4 flex-wrap">
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="px-4 py-2 rounded-lg bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-blue-500 focus:outline-none"
        >
          <option value="All">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6 backdrop-blur-sm overflow-x-auto">
        {requests.length === 0 ? (
          <div className="text-center text-[var(--text-muted)] py-12">No transport requests found</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border-subtle)]">
                {['Req No.', 'Staff', 'Type', 'Trip Date', 'Pickup', 'Drop-off', 'Reason', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {requests.map(req => (
                <tr key={req.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] transition-colors">
                  <td className="px-4 py-3 text-sm font-medium text-[var(--text-main)] font-mono">
                    {req.requestNo ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-[var(--text-main)]">{req.staffMember?.name ?? '—'}</div>
                    <div className="text-xs text-[var(--text-muted)]">{req.staffMember?.employeeId}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-[var(--text-main)]">
                    {TYPE_LABELS[req.requestType] ?? req.requestType}
                  </td>
                  <td className="px-4 py-3 text-sm text-[var(--text-main)]">
                    {new Date(req.tripDate).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-[var(--text-main)] max-w-[140px] truncate">
                    {req.pickupLocation ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-[var(--text-main)] max-w-[140px] truncate">
                    {req.dropLocation ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-[var(--text-main)] max-w-[160px] truncate">
                    {req.reason ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[req.status ?? 'PENDING']}`}>
                      {req.status ?? 'PENDING'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <select
                        value={req.status ?? 'PENDING'}
                        onChange={e => updateStatus(req.id, e.target.value)}
                        className="text-xs px-2 py-1 rounded bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:outline-none"
                      >
                        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      {req.status === 'PENDING' && (
                        <button
                          onClick={() => deleteRequest(req.id)}
                          className="p-1 rounded text-[var(--text-muted)] hover:text-rose-400 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* New Request Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto bg-[var(--bg-surface)]/95 border border-[var(--border-subtle)] rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-[var(--text-main)]">New Transport Request</h2>
              <button onClick={() => { setShowModal(false); setFormData(emptyForm); }} className="text-[var(--text-muted)] hover:text-[var(--text-main)]">✕</button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">

                <div className="col-span-2">
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Staff Member *</label>
                  <select
                    value={formData.staffMemberId}
                    onChange={e => setFormData(p => ({ ...p, staffMemberId: e.target.value }))}
                    required
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">— Select staff member —</option>
                    {staff.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.employeeId}){s.department ? ` · ${s.department}` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Request Type *</label>
                  <select
                    value={formData.requestType}
                    onChange={e => setFormData(p => ({ ...p, requestType: e.target.value }))}
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-blue-500 focus:outline-none"
                  >
                    {REQUEST_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Trip Date *</label>
                  <input
                    type="date"
                    value={formData.tripDate}
                    onChange={e => setFormData(p => ({ ...p, tripDate: e.target.value }))}
                    required
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Pickup Location</label>
                  <input
                    type="text"
                    value={formData.pickupLocation}
                    onChange={e => setFormData(p => ({ ...p, pickupLocation: e.target.value }))}
                    placeholder="e.g., Dubai Marina"
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Drop-off Location</label>
                  <input
                    type="text"
                    value={formData.dropLocation}
                    onChange={e => setFormData(p => ({ ...p, dropLocation: e.target.value }))}
                    placeholder="e.g., Office — Al Quoz"
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Reason</label>
                  <textarea
                    value={formData.reason}
                    onChange={e => setFormData(p => ({ ...p, reason: e.target.value }))}
                    rows={2}
                    placeholder="Why is this transport needed?"
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Notes</label>
                  <textarea
                    value={formData.notes}
                    onChange={e => setFormData(p => ({ ...p, notes: e.target.value }))}
                    rows={2}
                    placeholder="Additional notes for the dispatcher..."
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-blue-500 focus:outline-none"
                  />
                </div>

              </div>

              {error && <p className="text-rose-400 text-sm">{error}</p>}

              <div className="flex gap-4 justify-end pt-4">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setFormData(emptyForm); }}
                  className="px-6 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-cyan-600 text-white hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
