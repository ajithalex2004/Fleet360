'use client';
import React, { useState, useEffect } from 'react';

interface VehicleReturn {
  id: string;
  contractId: string;
  returnDate: string;
  mileage: number;
  condition: string;
  damages: string;
  finalCost: number;
  inspector: string;
}

interface FormData {
  contractId: string;
  returnDate: string;
  mileage: number;
  condition: string;
  damages: string;
  finalCost: number;
  inspector: string;
}

export default function ReturnsPage() {
  const [returns, setReturns] = useState<VehicleReturn[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [formData, setFormData] = useState<FormData>({
    contractId: '',
    returnDate: '',
    mileage: 0,
    condition: 'Good',
    damages: '',
    finalCost: 0,
    inspector: '',
  });

  const fetchReturns = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/leasing/returns');
      if (res.ok) {
        const data = await res.json();
        setReturns(data.map((r: any) => ({
          id: r.id,
          contractId: r.contractNumber,
          returnDate: r.returnDate,
          mileage: r.mileage,
          condition: r.condition,
          damages: r.damages ?? '',
          finalCost: Number(r.finalCost),
          inspector: r.inspector,
        })));
      }
    } catch (error) {
      console.error('Error fetching vehicle returns:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReturns();
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === 'mileage' || name === 'finalCost' ? parseFloat(value) : value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/leasing/returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractNumber: formData.contractId,
          returnDate: formData.returnDate,
          mileage: formData.mileage,
          condition: formData.condition,
          damages: formData.damages,
          finalCost: formData.finalCost,
          inspector: formData.inspector,
        }),
      });
      if (!res.ok) throw new Error(`Failed to save return (${res.status})`);

      await fetchReturns();
      setFormData({
        contractId: '',
        returnDate: '',
        mileage: 0,
        condition: 'Good',
        damages: '',
        finalCost: 0,
        inspector: '',
      });
      setShowModal(false);
    } catch (error) {
      console.error('Failed to record vehicle return:', error);
      alert('Failed to record vehicle return. Please try again.');
    }
  };

  const getConditionColor = (condition: string) => {
    switch (condition) {
      case 'Excellent':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      case 'Good':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'Fair':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      case 'Poor':
        return 'bg-rose-500/20 text-rose-400 border-rose-500/30';
      default:
        return 'bg-slate-500/20 text-[var(--text-muted)] border-slate-500/30';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[var(--text-muted)]">Loading...</div>
      </div>
    );
  }

  const totalDamages = returns.reduce((sum, r) => sum + Number(r.finalCost ?? 0), 0);

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)] mb-2">Vehicle Returns</h1>
          <p className="text-xs text-[var(--text-muted)]">Track vehicle condition and return costs</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3 text-sm font-medium text-white hover:opacity-90 transition-all"
        >
          + New Return
        </button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6 backdrop-blur-sm">
          <h3 className="text-sm font-semibold text-[var(--text-muted)] mb-4">Total Returns</h3>
          <p className="text-3xl font-bold text-[var(--text-main)]">{returns.length}</p>
          <p className="text-xs text-[var(--text-faint)] mt-2">Processed</p>
        </div>
        <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6 backdrop-blur-sm">
          <h3 className="text-sm font-semibold text-[var(--text-muted)] mb-4">Total Damage Costs</h3>
          <p className="text-3xl font-bold text-rose-400">AED {totalDamages.toLocaleString()}</p>
          <p className="text-xs text-[var(--text-faint)] mt-2">All returns</p>
        </div>
        <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6 backdrop-blur-sm">
          <h3 className="text-sm font-semibold text-[var(--text-muted)] mb-4">Avg. Mileage</h3>
          <p className="text-3xl font-bold text-amber-400">
            {returns.length > 0 ? Math.round(returns.reduce((sum, r) => sum + r.mileage, 0) / returns.length).toLocaleString() : 0}
          </p>
          <p className="text-xs text-[var(--text-faint)] mt-2">Per vehicle</p>
        </div>
      </div>

      {/* Returns Table */}
      <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6 backdrop-blur-sm overflow-x-auto">
        <table className="w-full">
          <thead className="bg-[var(--bg-surface)]/50">
            <tr className="border-b border-[var(--border-subtle)]">
              <th className="px-6 py-3 text-left text-sm font-semibold text-[var(--text-muted)]">Contract #</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-[var(--text-muted)]">Return Date</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-[var(--text-muted)]">Mileage (km)</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-[var(--text-muted)]">Condition</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-[var(--text-muted)]">Damages</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-[var(--text-muted)]">Final Cost</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-[var(--text-muted)]">Inspector</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-[var(--text-muted)]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {returns.map((vehicleReturn) => (
              <tr key={vehicleReturn.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] transition-colors">
                <td className="px-6 py-4 text-sm font-medium text-[var(--text-main)]">{vehicleReturn.contractId}</td>
                <td className="px-6 py-4 text-sm text-[var(--text-main)]">{vehicleReturn.returnDate}</td>
                <td className="px-6 py-4 text-sm text-[var(--text-main)] font-medium">{vehicleReturn.mileage.toLocaleString()}</td>
                <td className="px-6 py-4 text-sm">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getConditionColor(vehicleReturn.condition)}`}>
                    {vehicleReturn.condition}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-[var(--text-main)]">{vehicleReturn.damages || 'None'}</td>
                <td className="px-6 py-4 text-sm font-medium text-[var(--text-main)]">AED {vehicleReturn.finalCost.toLocaleString()}</td>
                <td className="px-6 py-4 text-sm text-[var(--text-main)]">{vehicleReturn.inspector}</td>
                <td className="px-6 py-4 text-sm">
                  <button className="text-blue-400 hover:text-blue-300 transition-colors">View</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* New Return Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-96 overflow-y-auto bg-[var(--bg-surface)]/95 border border-[var(--border-subtle)] rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-[var(--text-main)]">Record Vehicle Return</h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Contract ID</label>
                  <input
                    type="text"
                    name="contractId"
                    value={formData.contractId}
                    onChange={handleInputChange}
                    required
                    placeholder="e.g., LC-001"
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Return Date</label>
                  <input
                    type="date"
                    name="returnDate"
                    value={formData.returnDate}
                    onChange={handleInputChange}
                    required
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Final Mileage (km)</label>
                  <input
                    type="number"
                    name="mileage"
                    value={formData.mileage}
                    onChange={handleInputChange}
                    required
                    placeholder="150000"
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Vehicle Condition</label>
                  <select
                    name="condition"
                    value={formData.condition}
                    onChange={handleInputChange}
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-blue-500 focus:outline-none"
                  >
                    <option>Excellent</option>
                    <option>Good</option>
                    <option>Fair</option>
                    <option>Poor</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Damages & Repairs (AED)</label>
                  <input
                    type="number"
                    name="finalCost"
                    value={formData.finalCost}
                    onChange={handleInputChange}
                    placeholder="0"
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Inspector Name</label>
                  <input
                    type="text"
                    name="inspector"
                    value={formData.inspector}
                    onChange={handleInputChange}
                    required
                    placeholder="Full name"
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Damages Description</label>
                <textarea
                  name="damages"
                  value={formData.damages}
                  onChange={handleInputChange}
                  placeholder="Describe any damages found..."
                  rows={3}
                  className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="flex gap-4 justify-end pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-6 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:opacity-90 transition-all"
                >
                  Record Return
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
