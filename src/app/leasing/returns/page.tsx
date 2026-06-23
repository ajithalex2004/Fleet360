'use client';
import React, { useState, useEffect } from 'react';
import { ClipboardList, Gauge, TriangleAlert } from 'lucide-react';
import { KpiCard, KpiGrid, PageHeader } from '@/components/ui/page-theme';

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

  useEffect(() => {
    setLoading(true);
    const mockReturns: VehicleReturn[] = [
      {
        id: 'VR-001',
        contractId: 'LC-001',
        returnDate: '2024-01-15',
        mileage: 145230,
        condition: 'Good',
        damages: 'None',
        finalCost: 500,
        inspector: 'Ali Al-Mansoori',
      },
      {
        id: 'VR-002',
        contractId: 'LC-002',
        returnDate: '2024-02-20',
        mileage: 98765,
        condition: 'Fair',
        damages: 'Rear bumper scratch',
        finalCost: 2300,
        inspector: 'Sara Al-Mazrouei',
      },
      {
        id: 'VR-003',
        contractId: 'LC-003',
        returnDate: '2024-03-10',
        mileage: 275400,
        condition: 'Good',
        damages: 'Minor tire wear',
        finalCost: 1200,
        inspector: 'Mohammed Al-Khaldi',
      },
      {
        id: 'VR-004',
        contractId: 'LC-005',
        returnDate: '2024-01-05',
        mileage: 156890,
        condition: 'Excellent',
        damages: 'None',
        finalCost: 0,
        inspector: 'Hana Al-Dosari',
      },
    ];

    setReturns(mockReturns);
    setLoading(false);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === 'mileage' || name === 'finalCost' ? parseFloat(value) : value,
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newReturn: VehicleReturn = {
      id: `VR-${String(returns.length + 1).padStart(3, '0')}`,
      contractId: formData.contractId,
      returnDate: formData.returnDate,
      mileage: formData.mileage,
      condition: formData.condition,
      damages: formData.damages,
      finalCost: formData.finalCost,
      inspector: formData.inspector,
    };
    setReturns([...returns, newReturn]);
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
        return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  const totalDamages = returns.reduce((sum, r) => sum + r.finalCost, 0);

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <PageHeader
        title="Vehicle Returns"
        subtitle="Track vehicle condition and return costs"
        accent="blue"
        actions={(
          <button
            onClick={() => setShowModal(true)}
            className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3 text-sm font-medium text-white hover:opacity-90 transition-all"
          >
            + New Return
          </button>
        )}
      />

      {/* Summary Stats */}
      <KpiGrid>
        <KpiCard label="Total Returns" value={returns.length} accent="slate" icon={ClipboardList} sub="Processed records" />
        <KpiCard label="Damage Costs" value={`AED ${totalDamages.toLocaleString()}`} accent="rose" icon={TriangleAlert} sub="Across all returns" />
        <KpiCard
          label="Avg. Mileage"
          value={returns.length > 0 ? Math.round(returns.reduce((sum, r) => sum + r.mileage, 0) / returns.length).toLocaleString() : 0}
          accent="amber"
          icon={Gauge}
          sub="Per returned vehicle"
        />
      </KpiGrid>

      {/* Returns Table */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-800/50">
            <tr className="border-b border-white/5">
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Contract #</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Return Date</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Mileage (km)</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Condition</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Damages</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Final Cost</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Inspector</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Actions</th>
            </tr>
          </thead>
          <tbody>
            {returns.map((vehicleReturn) => (
              <tr key={vehicleReturn.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                <td className="px-6 py-4 text-sm font-medium text-white">{vehicleReturn.contractId}</td>
                <td className="px-6 py-4 text-sm text-slate-200">{vehicleReturn.returnDate}</td>
                <td className="px-6 py-4 text-sm text-white font-medium">{vehicleReturn.mileage.toLocaleString()}</td>
                <td className="px-6 py-4 text-sm">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getConditionColor(vehicleReturn.condition)}`}>
                    {vehicleReturn.condition}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-white">{vehicleReturn.damages || 'None'}</td>
                <td className="px-6 py-4 text-sm font-medium text-white">AED {vehicleReturn.finalCost.toLocaleString()}</td>
                <td className="px-6 py-4 text-sm text-slate-200">{vehicleReturn.inspector}</td>
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
          <div className="w-full max-w-2xl max-h-96 overflow-y-auto bg-slate-800/95 border border-white/10 rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">Record Vehicle Return</h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Contract ID</label>
                  <input
                    type="text"
                    name="contractId"
                    value={formData.contractId}
                    onChange={handleInputChange}
                    required
                    placeholder="e.g., LC-001"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Return Date</label>
                  <input
                    type="date"
                    name="returnDate"
                    value={formData.returnDate}
                    onChange={handleInputChange}
                    required
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Final Mileage (km)</label>
                  <input
                    type="number"
                    name="mileage"
                    value={formData.mileage}
                    onChange={handleInputChange}
                    required
                    placeholder="150000"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Vehicle Condition</label>
                  <select
                    name="condition"
                    value={formData.condition}
                    onChange={handleInputChange}
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-blue-500 focus:outline-none"
                  >
                    <option>Excellent</option>
                    <option>Good</option>
                    <option>Fair</option>
                    <option>Poor</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Damages & Repairs (AED)</label>
                  <input
                    type="number"
                    name="finalCost"
                    value={formData.finalCost}
                    onChange={handleInputChange}
                    placeholder="0"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Inspector Name</label>
                  <input
                    type="text"
                    name="inspector"
                    value={formData.inspector}
                    onChange={handleInputChange}
                    required
                    placeholder="Full name"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Damages Description</label>
                <textarea
                  name="damages"
                  value={formData.damages}
                  onChange={handleInputChange}
                  placeholder="Describe any damages found..."
                  rows={3}
                  className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="flex gap-4 justify-end pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-6 py-2 rounded-lg border border-white/10 text-white hover:bg-white/5 transition-all"
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
