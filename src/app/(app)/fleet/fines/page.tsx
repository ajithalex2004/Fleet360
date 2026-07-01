'use client';

import React, { useState, useEffect } from 'react';

interface TrafficFine {
  id: string;
  vehicle: string;
  driver: string;
  fineDate: string;
  amount: number;
  authority: string;
  fineRef: string;
  offenceType: string;
  assignedTo: string;
  status: string;
  paidDate: string | null;
}

interface FineSummary {
  totalOutstanding: number;
  totalPaid: number;
  totalDisputed: number;
  totalWaived: number;
}

export default function TrafficFines() {
  const [fines, setFines] = useState<TrafficFine[]>([]);
  const [summary, setSummary] = useState<FineSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    vehicle: '',
    driver: '',
    fineDate: '',
    amount: '',
    authority: '',
    fineRef: '',
    offenceType: '',
    assignedTo: '',
  });

  const authorities = ['RTA', 'Police', 'Municipality'];

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');

      const [finesRes, summaryRes] = await Promise.all([
        fetch('/api/fleet/traffic-fines'),
        fetch('/api/fleet/traffic-fines/summary'),
      ]);

      if (!finesRes.ok || !summaryRes.ok) throw new Error('Failed to fetch data');

      const finesData = await finesRes.json();
      const summaryData = await summaryRes.json();

      setFines(finesData);
      setSummary(summaryData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load fines');
    } finally {
      setLoading(false);
    }
  };

  const handleAddFine = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/fleet/traffic-fines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error('Failed to add fine');
      setShowModal(false);
      setFormData({
        vehicle: '',
        driver: '',
        fineDate: '',
        amount: '',
        authority: '',
        fineRef: '',
        offenceType: '',
        assignedTo: '',
      });
      fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add fine');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Paid':
        return 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
      case 'Unpaid':
        return 'bg-red-500/20 text-red-400 border border-red-500/30';
      case 'Disputed':
        return 'bg-amber-500/20 text-amber-400 border border-amber-500/30';
      case 'Waived':
        return 'bg-slate-500/20 text-slate-400 border border-slate-500/30';
      default:
        return 'bg-slate-500/20 text-slate-400 border border-slate-500/30';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin">
          <div className="w-12 h-12 border-4 border-slate-700 border-t-orange-500 rounded-full"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-6 text-red-400">
        <p className="font-medium">Error loading fines</p>
        <p className="text-sm mt-1">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Traffic Fines</h1>
          <p className="text-slate-400 mt-1">Manage traffic fines and violations</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 px-6 py-3 text-sm font-medium text-white hover:shadow-lg hover:shadow-orange-500/20 transition-all"
        >
          + New Fine Entry
        </button>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
            <p className="text-slate-400 text-sm font-medium mb-2">Outstanding Fines</p>
            <p className="text-3xl font-bold text-red-400">AED {summary.totalOutstanding.toFixed(2)}</p>
            <p className="text-xs text-slate-500 mt-2">Unpaid</p>
          </div>

          <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
            <p className="text-slate-400 text-sm font-medium mb-2">Total Paid</p>
            <p className="text-3xl font-bold text-emerald-400">AED {summary.totalPaid.toFixed(2)}</p>
            <p className="text-xs text-slate-500 mt-2">Settled</p>
          </div>

          <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
            <p className="text-slate-400 text-sm font-medium mb-2">Disputed</p>
            <p className="text-3xl font-bold text-amber-400">AED {summary.totalDisputed.toFixed(2)}</p>
            <p className="text-xs text-slate-500 mt-2">In Review</p>
          </div>

          <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
            <p className="text-slate-400 text-sm font-medium mb-2">Waived</p>
            <p className="text-3xl font-bold text-slate-400">AED {summary.totalWaived.toFixed(2)}</p>
            <p className="text-xs text-slate-500 mt-2">Cancelled</p>
          </div>
        </div>
      )}

      {/* Fines Table */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 overflow-hidden">
        {fines.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">🚨</div>
            <p className="text-slate-400">No traffic fines recorded</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-800/50">
                <tr className="border-b border-white/5">
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Vehicle</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Driver</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Fine Date</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Authority</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Fine Ref</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Offence Type</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Assigned To</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Paid Date</th>
                </tr>
              </thead>
              <tbody>
                {fines.map((fine) => (
                  <tr key={fine.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="px-6 py-4 text-sm text-white font-medium">{fine.vehicle}</td>
                    <td className="px-6 py-4 text-sm text-slate-200">{fine.driver}</td>
                    <td className="px-6 py-4 text-sm text-slate-200">{new Date(fine.fineDate).toLocaleDateString()}</td>
                    <td className="px-6 py-4 text-sm font-medium text-white">AED {fine.amount.toFixed(2)}</td>
                    <td className="px-6 py-4 text-sm text-slate-200">{fine.authority}</td>
                    <td className="px-6 py-4 text-sm text-slate-200 font-mono">{fine.fineRef}</td>
                    <td className="px-6 py-4 text-sm text-slate-200">{fine.offenceType}</td>
                    <td className="px-6 py-4 text-sm text-slate-200">{fine.assignedTo}</td>
                    <td className="px-6 py-4 text-sm">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(fine.status)}`}>
                        {fine.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-200">
                      {fine.paidDate ? new Date(fine.paidDate).toLocaleDateString() : '-'}
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
          <div className="bg-slate-800 border border-white/10 rounded-2xl p-8 max-w-md w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold text-white mb-6">New Traffic Fine</h2>

            <form onSubmit={handleAddFine} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Vehicle</label>
                <input
                  type="text"
                  value={formData.vehicle}
                  onChange={(e) => setFormData({ ...formData, vehicle: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Driver</label>
                <input
                  type="text"
                  value={formData.driver}
                  onChange={(e) => setFormData({ ...formData, driver: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Fine Date</label>
                <input
                  type="date"
                  value={formData.fineDate}
                  onChange={(e) => setFormData({ ...formData, fineDate: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Amount (AED)</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Authority</label>
                <select
                  value={formData.authority}
                  onChange={(e) => setFormData({ ...formData, authority: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                  required
                >
                  <option value="">Select Authority</option>
                  {authorities.map((auth) => (
                    <option key={auth} value={auth}>
                      {auth}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Fine Reference</label>
                <input
                  type="text"
                  value={formData.fineRef}
                  onChange={(e) => setFormData({ ...formData, fineRef: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Offence Type</label>
                <input
                  type="text"
                  value={formData.offenceType}
                  onChange={(e) => setFormData({ ...formData, offenceType: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Assigned To</label>
                <input
                  type="text"
                  value={formData.assignedTo}
                  onChange={(e) => setFormData({ ...formData, assignedTo: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                  placeholder="Company or Driver name"
                  required
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 px-4 py-2 text-sm font-medium text-white hover:shadow-lg hover:shadow-orange-500/20 transition-all"
                >
                  Add Fine
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
