'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface LifecycleEvent {
  id: string;
  vehicleId: string;
  eventType: string;
  eventDate: string;
  fromStage: string;
  toStage: string;
  description: string;
  referenceNo: string;
  performedBy: string;
  cost: number;
  notes: string;
}

const EMPTY_FORM: Omit<LifecycleEvent, 'id'> = {
  vehicleId: '',
  eventType: 'ACTIVATION',
  eventDate: '',
  fromStage: '',
  toStage: '',
  description: '',
  referenceNo: '',
  performedBy: '',
  cost: 0,
  notes: '',
};

const badge = (text: string, color: string) => (
  <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${color}`}>{text}</span>
);

const eventTypeColor: Record<string, string> = {
  PURCHASE: 'bg-blue-500/20 text-blue-400',
  ACTIVATION: 'bg-green-500/20 text-green-400',
  ALLOCATION: 'bg-purple-500/20 text-purple-400',
  DEALLOCATION: 'bg-purple-500/10 text-purple-300',
  MAINTENANCE_START: 'bg-amber-500/20 text-amber-400',
  MAINTENANCE_END: 'bg-amber-500/10 text-amber-300',
  TRANSFER: 'bg-orange-500/20 text-orange-400',
  INSPECTION: 'bg-teal-500/20 text-teal-400',
  SALE: 'bg-red-500/20 text-red-400',
  WRITE_OFF: 'bg-red-600/20 text-red-500',
};

const EVENT_TYPES = [
  'PURCHASE', 'ACTIVATION', 'ALLOCATION', 'DEALLOCATION',
  'MAINTENANCE_START', 'MAINTENANCE_END', 'TRANSFER', 'INSPECTION', 'SALE', 'WRITE_OFF',
];

export default function LifecyclePage() {
  const [events, setEvents] = useState<LifecycleEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [vehicleFilter, setVehicleFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (vehicleFilter) params.set('vehicleId', vehicleFilter);
      if (typeFilter) params.set('eventType', typeFilter);
      params.set('page', String(page));
      params.set('limit', '20');
      const res = await fetch(`/api/fleet/lifecycle?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch lifecycle events');
      const data = await res.json();
      setEvents(data.data ?? data.items ?? (Array.isArray(data) ? data : []));
      setTotalPages(data.totalPages ?? 1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [search, vehicleFilter, typeFilter, page]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const openCreate = () => {
    setFormData({ ...EMPTY_FORM });
    setFormError('');
    setShowModal(true);
  };

  const handleSave = async () => {
    setFormError('');
    if (!formData.vehicleId.trim()) { setFormError('Vehicle ID is required'); return; }
    if (!formData.eventDate) { setFormError('Event date is required'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/fleet/lifecycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? 'Save failed');
      }
      setShowModal(false);
      fetchEvents();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:border-orange-500/50 focus:outline-none w-full';
  const labelCls = 'block text-xs text-slate-400 mb-1';

  return (
    <div className="min-h-screen bg-slate-900 text-white p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Fleet Lifecycle Events</h1>
          <p className="text-slate-400 text-sm mt-1">Track vehicle stage transitions and lifecycle history</p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white rounded-xl text-sm font-semibold transition-all shadow-lg shadow-orange-500/20"
        >
          + Log Event
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm mb-4">
          {error}
        </div>
      )}

      {/* Filter Bar */}
      <div className="bg-slate-800/40 border border-white/5 rounded-2xl p-4 mb-6 flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search description, reference, performed by..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          className="bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:border-orange-500/50 focus:outline-none flex-1 min-w-[200px] placeholder-slate-500"
        />
        <input
          type="text"
          placeholder="Filter by Vehicle ID..."
          value={vehicleFilter}
          onChange={e => { setVehicleFilter(e.target.value); setPage(1); }}
          className="bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:border-orange-500/50 focus:outline-none w-48 placeholder-slate-500"
        />
        <select
          value={typeFilter}
          onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
          className="bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:border-orange-500/50 focus:outline-none"
        >
          <option value="">All Event Types</option>
          {EVENT_TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-slate-800/40 border border-white/5 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/60 border-b border-white/5">
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Event Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Vehicle ID</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Event Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Stage Transition</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Description</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Cost (AED)</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Reference No.</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Performed By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-slate-500">Loading lifecycle events...</td>
                </tr>
              ) : events.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-slate-500">No lifecycle events found</td>
                </tr>
              ) : (
                events.map(ev => (
                  <tr key={ev.id} className="hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3">
                      {badge(ev.eventType, eventTypeColor[ev.eventType] ?? 'bg-slate-700 text-slate-300')}
                    </td>
                    <td className="px-4 py-3 text-orange-400 font-medium">{ev.vehicleId}</td>
                    <td className="px-4 py-3 text-slate-300">
                      {ev.eventDate ? new Date(ev.eventDate).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {ev.fromStage || ev.toStage ? (
                        <span className="flex items-center gap-1.5 text-xs">
                          {ev.fromStage && (
                            <span className="bg-slate-700 px-2 py-0.5 rounded text-slate-300">{ev.fromStage}</span>
                          )}
                          {ev.fromStage && ev.toStage && (
                            <span className="text-orange-400">→</span>
                          )}
                          {ev.toStage && (
                            <span className="bg-slate-700 px-2 py-0.5 rounded text-slate-300">{ev.toStage}</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-300 max-w-xs truncate" title={ev.description}>{ev.description || '—'}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{ev.cost ? ev.cost.toLocaleString() : '—'}</td>
                    <td className="px-4 py-3 text-slate-300 font-mono text-xs">{ev.referenceNo || '—'}</td>
                    <td className="px-4 py-3 text-slate-300">{ev.performedBy || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-white/5">
            <span className="text-xs text-slate-500">Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded-lg text-xs text-white transition-colors"
              >
                Prev
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded-lg text-xs text-white transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <h2 className="text-lg font-semibold text-white">Log Lifecycle Event</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white transition-colors text-xl leading-none">&times;</button>
            </div>

            {/* Modal Body */}
            <div className="px-6 py-5 space-y-6">
              {formError && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm">
                  {formError}
                </div>
              )}

              {/* Core Details */}
              <div>
                <p className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-4">Event Details</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Vehicle ID *</label>
                    <input
                      type="text"
                      value={formData.vehicleId}
                      onChange={e => setFormData(f => ({ ...f, vehicleId: e.target.value }))}
                      className={inputCls}
                      placeholder="e.g. VH-001"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Event Type</label>
                    <select
                      value={formData.eventType}
                      onChange={e => setFormData(f => ({ ...f, eventType: e.target.value }))}
                      className={inputCls}
                    >
                      {EVENT_TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Event Date *</label>
                    <input
                      type="date"
                      value={formData.eventDate}
                      onChange={e => setFormData(f => ({ ...f, eventDate: e.target.value }))}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Cost (AED)</label>
                    <input
                      type="number"
                      value={formData.cost}
                      onChange={e => setFormData(f => ({ ...f, cost: Number(e.target.value) }))}
                      className={inputCls}
                      min={0}
                      step={0.01}
                    />
                  </div>
                </div>
              </div>

              {/* Stage Transition */}
              <div>
                <p className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-4">Stage Transition</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>From Stage</label>
                    <input
                      type="text"
                      value={formData.fromStage}
                      onChange={e => setFormData(f => ({ ...f, fromStage: e.target.value }))}
                      className={inputCls}
                      placeholder="e.g. ACTIVE"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>To Stage</label>
                    <input
                      type="text"
                      value={formData.toStage}
                      onChange={e => setFormData(f => ({ ...f, toStage: e.target.value }))}
                      className={inputCls}
                      placeholder="e.g. MAINTENANCE"
                    />
                  </div>
                </div>
                {(formData.fromStage || formData.toStage) && (
                  <div className="mt-3 flex items-center gap-2 text-sm">
                    <span className="text-slate-500 text-xs">Preview:</span>
                    {formData.fromStage && <span className="bg-slate-700 px-2 py-1 rounded text-slate-300 text-xs">{formData.fromStage}</span>}
                    {formData.fromStage && formData.toStage && <span className="text-orange-400">→</span>}
                    {formData.toStage && <span className="bg-slate-700 px-2 py-1 rounded text-slate-300 text-xs">{formData.toStage}</span>}
                  </div>
                )}
              </div>

              {/* Reference & People */}
              <div>
                <p className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-4">Reference & Personnel</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Reference No.</label>
                    <input
                      type="text"
                      value={formData.referenceNo}
                      onChange={e => setFormData(f => ({ ...f, referenceNo: e.target.value }))}
                      className={inputCls}
                      placeholder="Reference or document number"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Performed By</label>
                    <input
                      type="text"
                      value={formData.performedBy}
                      onChange={e => setFormData(f => ({ ...f, performedBy: e.target.value }))}
                      className={inputCls}
                      placeholder="Name or department"
                    />
                  </div>
                </div>
              </div>

              {/* Description & Notes */}
              <div>
                <p className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-4">Additional Info</p>
                <div className="space-y-4">
                  <div>
                    <label className={labelCls}>Description</label>
                    <textarea
                      value={formData.description}
                      onChange={e => setFormData(f => ({ ...f, description: e.target.value }))}
                      className={`${inputCls} resize-none h-20`}
                      placeholder="Describe the lifecycle event..."
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Notes</label>
                    <textarea
                      value={formData.notes}
                      onChange={e => setFormData(f => ({ ...f, notes: e.target.value }))}
                      className={`${inputCls} resize-none h-16`}
                      placeholder="Additional notes..."
                    />
                  </div>
                </div>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 text-xs text-amber-400">
                Lifecycle events are immutable once logged. Please review all details before saving.
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/10">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-6 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-all"
              >
                {saving ? 'Logging...' : 'Log Event'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
