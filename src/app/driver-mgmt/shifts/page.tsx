'use client';

import React, { useState, useEffect } from 'react';

interface Shift {
  id: string;
  driver: string;
  vehicle: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
  totalHours: number;
  status: string;
}

export default function ShiftManagement() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    driver: '',
    shiftDate: '',
    startTime: '',
    endTime: '',
    vehicle: '',
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
      const data = await res.json();
      setShifts(data);
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
      const res = await fetch('/api/drivers/shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error('Failed to add shift');
      setShowModal(false);
      setFormData({ driver: '', shiftDate: '', startTime: '', endTime: '', vehicle: '', notes: '' });
      fetchShifts();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add shift');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Scheduled':
        return 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30';
      case 'Active':
        return 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 animate-pulse';
      case 'Completed':
        return 'bg-slate-500/20 text-slate-400 border border-slate-500/30';
      case 'Absent':
        return 'bg-red-500/20 text-red-400 border border-red-500/30';
      default:
        return 'bg-slate-500/20 text-slate-400 border border-slate-500/30';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin">
          <div className="w-12 h-12 border-4 border-slate-700 border-t-cyan-500 rounded-full"></div>
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
          <h1 className="text-3xl font-bold text-white">Shift Management</h1>
          <p className="text-slate-400 mt-1">Schedule and manage driver shifts</p>
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
          <label className="block text-sm font-medium text-slate-400 mb-2">Start Date</label>
          <input
            type="date"
            value={filterStartDate}
            onChange={(e) => setFilterStartDate(e.target.value)}
            className="w-full bg-slate-800/50 border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
        </div>
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-400 mb-2">End Date</label>
          <input
            type="date"
            value={filterEndDate}
            onChange={(e) => setFilterEndDate(e.target.value)}
            className="w-full bg-slate-800/50 border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
        </div>
      </div>

      {/* Shifts Table */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 overflow-hidden">
        {filteredShifts.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">⏰</div>
            <p className="text-slate-400">No shifts scheduled</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-800/50">
                <tr className="border-b border-white/5">
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Driver</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Vehicle</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Shift Date</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Start Time</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">End Time</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Total Hours</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredShifts.map((shift) => (
                  <tr key={shift.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="px-6 py-4 text-sm text-white font-medium">{shift.driver}</td>
                    <td className="px-6 py-4 text-sm text-slate-200">{shift.vehicle}</td>
                    <td className="px-6 py-4 text-sm text-slate-200">{new Date(shift.shiftDate).toLocaleDateString()}</td>
                    <td className="px-6 py-4 text-sm text-slate-200">{shift.startTime}</td>
                    <td className="px-6 py-4 text-sm text-slate-200">{shift.endTime}</td>
                    <td className="px-6 py-4 text-sm text-slate-200">{shift.totalHours.toFixed(1)} hrs</td>
                    <td className="px-6 py-4 text-sm">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(shift.status)}`}>
                        {shift.status}
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
          <div className="bg-slate-800 border border-white/10 rounded-2xl p-8 max-w-md w-full">
            <h2 className="text-2xl font-bold text-white mb-6">Create New Shift</h2>

            <form onSubmit={handleAddShift} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Driver</label>
                <input
                  type="text"
                  value={formData.driver}
                  onChange={(e) => setFormData({ ...formData, driver: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Shift Date</label>
                <input
                  type="date"
                  value={formData.shiftDate}
                  onChange={(e) => setFormData({ ...formData, shiftDate: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">Start Time</label>
                  <input
                    type="time"
                    value={formData.startTime}
                    onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                    className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">End Time</label>
                  <input
                    type="time"
                    value={formData.endTime}
                    onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                    className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Vehicle</label>
                <input
                  type="text"
                  value={formData.vehicle}
                  onChange={(e) => setFormData({ ...formData, vehicle: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-none"
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
                  className="flex-1 rounded-xl bg-slate-700 px-4 py-2 text-sm font-medium text-slate-400 hover:bg-slate-600 transition-all"
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
