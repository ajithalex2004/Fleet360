'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { VehicleRef } from '@/components/ui/EntityRef';

import { FormAlert, FormField, FormFooter, FormSection, PrimaryButton, SecondaryButton, SelectInput, TextAreaInput, TextInput } from '@/components/ui/form-kit';
import { FormModal } from '@/components/ui/form-modal';
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

  const inputCls = 'bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-[var(--text-main)] text-sm focus:border-orange-500/50 focus:outline-none w-full';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)]">Fleet Lifecycle Events</h1>
          <p className="text-[var(--text-muted)] text-xs mt-1">Track vehicle stage transitions and lifecycle history</p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white rounded-xl text-sm font-semibold transition-all shadow-lg shadow-orange-500/20"
        >
          + Log Event
        </button>
      </div>

      {/* Error */}
      {error && <FormAlert>{error}</FormAlert>}

      {/* Filter Bar */}
      <div className="bg-[var(--bg-surface)]/40 border border-[var(--border-subtle)] rounded-2xl p-4 mb-6 flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search description, reference, performed by..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-[var(--text-main)] text-sm focus:border-orange-500/50 focus:outline-none flex-1 min-w-[200px] placeholder-[var(--text-faint)]"
        />
        <input
          type="text"
          placeholder="Filter by Vehicle ID..."
          value={vehicleFilter}
          onChange={e => { setVehicleFilter(e.target.value); setPage(1); }}
          className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-[var(--text-main)] text-sm focus:border-orange-500/50 focus:outline-none w-48 placeholder-[var(--text-faint)]"
        />
        <select
          value={typeFilter}
          onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
          className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-[var(--text-main)] text-sm focus:border-orange-500/50 focus:outline-none"
        >
          <option value="">All Event Types</option>
          {EVENT_TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-[var(--bg-surface)]/40 border border-[var(--border-subtle)] rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--bg-surface)]/60 border-b border-[var(--border-subtle)]">
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Event Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Vehicle ID</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Event Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Stage Transition</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Description</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Cost (AED)</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Reference No.</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Performed By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-[var(--text-faint)]">Loading lifecycle events...</td>
                </tr>
              ) : events.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-[var(--text-faint)]">No lifecycle events found</td>
                </tr>
              ) : (
                events.map(ev => (
                  <tr key={ev.id} className="hover:bg-[var(--bg-surface-hover)] transition-colors">
                    <td className="px-4 py-3">
                      {badge(ev.eventType, eventTypeColor[ev.eventType] ?? 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)]')}
                    </td>
                    <td className="px-4 py-3 text-orange-400 font-medium"><VehicleRef id={ev.vehicleId} /></td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">
                      {ev.eventDate ? new Date(ev.eventDate).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {ev.fromStage || ev.toStage ? (
                        <span className="flex items-center gap-1.5 text-xs">
                          {ev.fromStage && (
                            <span className="bg-[var(--bg-surface-hover)] px-2 py-0.5 rounded text-[var(--text-muted)]">{ev.fromStage}</span>
                          )}
                          {ev.fromStage && ev.toStage && (
                            <span className="text-orange-400">→</span>
                          )}
                          {ev.toStage && (
                            <span className="bg-[var(--bg-surface-hover)] px-2 py-0.5 rounded text-[var(--text-muted)]">{ev.toStage}</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-[var(--text-faint)]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-muted)] max-w-xs truncate" title={ev.description}>{ev.description || '—'}</td>
                    <td className="px-4 py-3 text-right text-[var(--text-muted)]">{ev.cost ? ev.cost.toLocaleString() : '—'}</td>
                    <td className="px-4 py-3 text-[var(--text-muted)] font-mono text-xs">{ev.referenceNo || '—'}</td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">{ev.performedBy || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border-subtle)]">
            <span className="text-xs text-[var(--text-faint)]">Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 bg-[var(--bg-surface-hover)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-40 rounded-lg text-xs text-[var(--text-main)] transition-colors"
              >
                Prev
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 bg-[var(--bg-surface-hover)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-40 rounded-lg text-xs text-[var(--text-main)] transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <FormModal
          onClose={() => setShowModal(false)}
          title="Log Lifecycle Event"
          size="lg"
        >
          {/* Modal Body */}
          <div className="px-6 py-5 space-y-6">
            {formError && <FormAlert>{formError}</FormAlert>}

            {/* Core Details */}
            <FormSection title="Event Details" columns={2}>
              <FormField label="Vehicle ID" required>
                <TextInput
                  type="text"
                  value={formData.vehicleId}
                  onChange={e => setFormData(f => ({ ...f, vehicleId: e.target.value }))}
                  placeholder="e.g. VH-001"
                />
              </FormField>
              <FormField label="Event Type">
                <SelectInput
                  value={formData.eventType}
                  onChange={e => setFormData(f => ({ ...f, eventType: e.target.value }))}
                >
                  {EVENT_TYPES.map(t => <option key={t}>{t}</option>)}
                </SelectInput>
              </FormField>
              <FormField label="Event Date" required>
                <TextInput
                  type="date"
                  value={formData.eventDate}
                  onChange={e => setFormData(f => ({ ...f, eventDate: e.target.value }))}
                />
              </FormField>
              <FormField label="Cost (AED)">
                <TextInput
                  type="number"
                  value={formData.cost}
                  onChange={e => setFormData(f => ({ ...f, cost: Number(e.target.value) }))}
                  min={0}
                  step={0.01}
                />
              </FormField>
            </FormSection>

            {/* Stage Transition */}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-main)] mb-4">Stage Transition</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField label="From Stage">
                  <TextInput
                    type="text"
                    value={formData.fromStage}
                    onChange={e => setFormData(f => ({ ...f, fromStage: e.target.value }))}
                    placeholder="e.g. ACTIVE"
                  />
                </FormField>
                <FormField label="To Stage">
                  <TextInput
                    type="text"
                    value={formData.toStage}
                    onChange={e => setFormData(f => ({ ...f, toStage: e.target.value }))}
                    placeholder="e.g. MAINTENANCE"
                  />
                </FormField>
              </div>
              {(formData.fromStage || formData.toStage) && (
                <div className="mt-3 flex items-center gap-2 text-sm">
                  <span className="text-[var(--text-faint)] text-xs">Preview:</span>
                  {formData.fromStage && <span className="bg-[var(--bg-surface-hover)] px-2 py-1 rounded text-[var(--text-muted)] text-xs">{formData.fromStage}</span>}
                  {formData.fromStage && formData.toStage && <span className="text-blue-400">→</span>}
                  {formData.toStage && <span className="bg-[var(--bg-surface-hover)] px-2 py-1 rounded text-[var(--text-muted)] text-xs">{formData.toStage}</span>}
                </div>
              )}
            </div>

            {/* Reference & People */}
            <FormSection title="Reference & Personnel" columns={2}>
              <FormField label="Reference No.">
                <TextInput
                  type="text"
                  value={formData.referenceNo}
                  onChange={e => setFormData(f => ({ ...f, referenceNo: e.target.value }))}
                  placeholder="Reference or document number"
                />
              </FormField>
              <FormField label="Performed By">
                <TextInput
                  type="text"
                  value={formData.performedBy}
                  onChange={e => setFormData(f => ({ ...f, performedBy: e.target.value }))}
                  placeholder="Name or department"
                />
              </FormField>
            </FormSection>

            {/* Description & Notes */}
            <FormSection title="Additional Info" columns={1}>
              <FormField label="Description">
                <TextAreaInput
                  value={formData.description}
                  onChange={e => setFormData(f => ({ ...f, description: e.target.value }))}
                  className={`${inputCls} resize-none h-20`}
                  placeholder="Describe the lifecycle event..."
                />
              </FormField>
              <FormField label="Notes">
                <TextAreaInput
                  value={formData.notes}
                  onChange={e => setFormData(f => ({ ...f, notes: e.target.value }))}
                  className={`${inputCls} resize-none h-16`}
                  placeholder="Additional notes..."
                />
              </FormField>
            </FormSection>

            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 text-xs text-amber-400">
              Lifecycle events are immutable once logged. Please review all details before saving.
            </div>
          </div>

          {/* Modal Footer */}
          <FormFooter secondary={<SecondaryButton onClick={() => setShowModal(false)}>Cancel</SecondaryButton>}>
            <PrimaryButton onClick={handleSave} disabled={saving}>{saving ? 'Logging...' : 'Log Event'}</PrimaryButton>
          </FormFooter>
        </FormModal>
      )}
    </div>
  );
}
