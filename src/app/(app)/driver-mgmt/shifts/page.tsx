'use client';

import React, { useState, useEffect } from 'react';

// Matches the real DriverShift Prisma model (src/app/api/drivers/shifts/route.ts
// returns raw rows, no relation include) — driverId/vehicleId are plain scalar
// FKs, not joined name strings; there's no driver/vehicle relation object to
// read a display name from. startTime/endTime are full Timestamptz values,
// not bare "HH:mm" strings. status is stored uppercase (SCHEDULED|ACTIVE|
// COMPLETED|ABSENT per the schema comment).
interface Shift {
  id: string;
  driverId: string;
  vehicleId: string | null;
  shiftDate: string;
  startTime: string;
  endTime: string | null;
  totalHours: number | null;
  status: string | null;
}

export default function ShiftManagement() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    driverId: '',
    shiftDate: '',
    startTime: '',
    endTime: '',
    vehicleId: '',
    notes: '',
  });

  useEffect(() => {
    fetchShifts();
  }, []);

  const fetchShifts = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/drivers/shifts');
      if (!res.ok) throw new Error('Failed to fetch shifts');
      const json = await res.json();
      // GET /api/drivers/shifts returns a paginated envelope
      // ({ data, total, page, limit, ... }), not a bare array.
      setShifts(Array.isArray(json?.data) ? json.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load shifts');
    } finally {
      setLoading(false);
    }
  };

  const filteredShifts = shifts.filter((shift) => {
    const shiftDate = new Date(shift.shiftDate);
    const matchesStart = !filterStartDate || shiftDate >= new Date(filterStartDate);
    const matchesEnd = !filterEndDate || shiftDate <= new Date(filterEndDate);
    return matchesStart && matchesEnd;
  });

  const handleAddShift = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // startTime/endTime inputs are bare "HH:mm" (type="time"), but the
      // model stores full Timestamptz values — combine with shiftDate
      // before sending, or Prisma rejects "09:00" as an invalid DateTime.
      const payload = {
        driverId:  formData.driverId,
        vehicleId: formData.vehicleId || undefined,
        shiftDate: new Date(formData.shiftDate).toISOString(),
        startTime: new Date(`${formData.shiftDate}T${formData.startTime}`).toISOString(),
        endTime:   formData.endTime ? new Date(`${formData.shiftDate}T${formData.endTime}`).toISOString() : undefined,
        notes:     formData.notes || undefined,
      };
      const res = await fetch('/api/drivers/shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to add shift');
      setShowModal(false);
      setFormData({ driverId: '', shiftDate: '', startTime: '', endTime: '', vehicleId: '', notes: '' });
      fetchShifts();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add shift');
    }
  };

  // Stored uppercase (SCHEDULED|ACTIVE|COMPLETED|ABSENT) — matching against
  // the DB's actual casing, not a display-cased guess.
  const getStatusColor = (status: string | null) => {
    switch (status) {
      case 'SCHEDULED':
        return 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30';
      case 'ACTIVE':
        return 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 animate-pulse';
      case 'COMPLETED':
        return 'bg-slate-500/20 text-[var(--text-muted)] border border-slate-500/30';
      case 'ABSENT':
        return 'bg-red-500/20 text-red-400 border border-red-500/30';
      default:
        return 'bg-slate-500/20 text-[var(--text-muted)] border border-slate-500/30';
    }
  };

  const fmtTime = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[200px]">
        <div className="animate-spin">
          <div className="w-12 h-12 border-4 border-[var(--border-strong)] border-t-cyan-500 rounded-full"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-6 text-red-400">
        <p className="font-medium">Error loading shifts</p>
        <p className="text-sm mt-1">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[var(--text-main)]">Shift Management</h1>
          <p className="text-[var(--text-muted)] mt-1">Schedule and manage driver shifts</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="rounded-xl bg-gradient-to-r from-cyan-600 to-teal-600 px-6 py-3 text-sm font-medium text-white hover:shadow-lg hover:shadow-cyan-500/20 transition-all"
        >
          + New Shift
        </button>
      </div>

      {/* Date Range Filter */}
      <div className="flex gap-4">
        <div className="flex-1">
          <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Start Date</label>
          <input
            type="date"
            value={filterStartDate}
            onChange={(e) => setFilterStartDate(e.target.value)}
            className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-4 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
        </div>
        <div className="flex-1">
          <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">End Date</label>
          <input
            type="date"
            value={filterEndDate}
            onChange={(e) => setFilterEndDate(e.target.value)}
            className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-4 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
        </div>
      </div>

      {/* Shifts Table */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6 overflow-hidden">
        {filteredShifts.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">⏰</div>
            <p className="text-[var(--text-muted)]">No shifts scheduled</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[var(--bg-surface-hover)]">
                <tr className="border-b border-[var(--border-subtle)]">
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Driver</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Vehicle</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Shift Date</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Start Time</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">End Time</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Total Hours</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredShifts.map((shift) => (
                  <tr key={shift.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] transition-colors">
                    <td className="px-6 py-4 text-sm text-[var(--text-main)] font-medium">{shift.driverId}</td>
                    <td className="px-6 py-4 text-sm text-[var(--text-muted)]">{shift.vehicleId ?? '—'}</td>
                    <td className="px-6 py-4 text-sm text-[var(--text-muted)]">{new Date(shift.shiftDate).toLocaleDateString()}</td>
                    <td className="px-6 py-4 text-sm text-[var(--text-muted)]">{fmtTime(shift.startTime)}</td>
                    <td className="px-6 py-4 text-sm text-[var(--text-muted)]">{fmtTime(shift.endTime)}</td>
                    <td className="px-6 py-4 text-sm text-[var(--text-muted)]">{shift.totalHours != null ? `${shift.totalHours.toFixed(1)} hrs` : '—'}</td>
                    <td className="px-6 py-4 text-sm">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(shift.status)}`}>
                        {shift.status ?? 'UNKNOWN'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <button className="text-cyan-400 hover:text-cyan-300 transition-colors">Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)] rounded-2xl p-8 max-w-md w-full">
            <h2 className="text-2xl font-bold text-[var(--text-main)] mb-6">Create New Shift</h2>

            <form onSubmit={handleAddShift} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Driver ID</label>
                <input
                  type="text"
                  value={formData.driverId}
                  onChange={(e) => setFormData({ ...formData, driverId: e.target.value })}
                  className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-4 py-2 text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Shift Date</label>
                <input
                  type="date"
                  value={formData.shiftDate}
                  onChange={(e) => setFormData({ ...formData, shiftDate: e.target.value })}
                  className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-4 py-2 text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Start Time</label>
                  <input
                    type="time"
                    value={formData.startTime}
                    onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                    className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-4 py-2 text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">End Time</label>
                  <input
                    type="time"
                    value={formData.endTime}
                    onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                    className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-4 py-2 text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Vehicle ID (optional)</label>
                <input
                  type="text"
                  value={formData.vehicleId}
                  onChange={(e) => setFormData({ ...formData, vehicleId: e.target.value })}
                  className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-4 py-2 text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-4 py-2 text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-none"
                  rows={3}
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 rounded-xl bg-gradient-to-r from-cyan-600 to-teal-600 px-4 py-2 text-sm font-medium text-white hover:shadow-lg hover:shadow-cyan-500/20 transition-all"
                >
                  Create Shift
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 rounded-xl bg-[var(--bg-surface-hover)] px-4 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--bg-surface-elevated)] transition-all"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
