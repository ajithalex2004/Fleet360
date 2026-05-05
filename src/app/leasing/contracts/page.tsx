'use client';
import React, { useState, useEffect } from 'react';

interface Contract {
  id: string;
  lessee: string;
  vehicle: string;
  startDate: string;
  endDate: string;
  monthlyRate: number;
  status: string;
}

interface FormData {
  lessee: string;
  vehicleId: string;
  startDate: string;
  endDate: string;
  monthlyRate: number;
  securityDeposit: number;
  mileageCap: number;
  currency: string;
  notes: string;
}

export default function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [filteredContracts, setFilteredContracts] = useState<Contract[]>([]);
  const [statusFilter, setStatusFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [formData, setFormData] = useState<FormData>({
    lessee: '',
    vehicleId: '',
    startDate: '',
    endDate: '',
    monthlyRate: 0,
    securityDeposit: 0,
    mileageCap: 0,
    currency: 'AED',
    notes: '',
  });

  const lesseeOptions = [
    'Ahmed Al-Mansouri',
    'Fatima Al-Nakhli',
    'Global Logistics LLC',
    'Mohammed Al-Qasimi',
    'Nawal Al-Maktoum',
  ];

  useEffect(() => {
    setLoading(true);
    const mockContracts: Contract[] = [
      {
        id: 'LC-001',
        lessee: 'Ahmed Al-Mansouri',
        vehicle: 'Toyota Camry',
        startDate: '2024-01-15',
        endDate: '2026-01-15',
        monthlyRate: 6500,
        status: 'Active',
      },
      {
        id: 'LC-002',
        lessee: 'Fatima Al-Nakhli',
        vehicle: 'BMW X5',
        startDate: '2024-03-20',
        endDate: '2026-03-20',
        monthlyRate: 9800,
        status: 'Active',
      },
      {
        id: 'LC-003',
        lessee: 'Global Logistics LLC',
        vehicle: 'Mercedes-Benz Sprinter',
        startDate: '2024-02-01',
        endDate: '2025-02-01',
        monthlyRate: 8500,
        status: 'Active',
      },
      {
        id: 'LC-004',
        lessee: 'Mohammed Al-Qasimi',
        vehicle: 'Nissan Altima',
        startDate: '2023-06-10',
        endDate: '2025-06-10',
        monthlyRate: 5800,
        status: 'Extended',
      },
      {
        id: 'LC-005',
        lessee: 'Nawal Al-Maktoum',
        vehicle: 'Lexus RX',
        startDate: '2023-01-05',
        endDate: '2024-01-05',
        monthlyRate: 7200,
        status: 'Terminated',
      },
      {
        id: 'LC-006',
        lessee: 'Ahmed Al-Mansouri',
        vehicle: 'Honda Accord',
        startDate: '2024-05-10',
        endDate: '2025-05-10',
        monthlyRate: 6000,
        status: 'Draft',
      },
    ];

    setContracts(mockContracts);
    setFilteredContracts(mockContracts);
    setLoading(false);
  }, []);

  useEffect(() => {
    let filtered = contracts;

    if (statusFilter !== 'All') {
      filtered = filtered.filter((c) => c.status === statusFilter);
    }

    if (searchQuery) {
      filtered = filtered.filter(
        (c) =>
          c.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.lessee.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.vehicle.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    setFilteredContracts(filtered);
  }, [statusFilter, searchQuery, contracts]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === 'monthlyRate' || name === 'securityDeposit' || name === 'mileageCap' ? parseFloat(value) : value,
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newContract: Contract = {
      id: `LC-${String(contracts.length + 1).padStart(3, '0')}`,
      lessee: formData.lessee,
      vehicle: formData.vehicleId,
      startDate: formData.startDate,
      endDate: formData.endDate,
      monthlyRate: formData.monthlyRate,
      status: 'Draft',
    };
    setContracts([...contracts, newContract]);
    setFormData({
      lessee: '',
      vehicleId: '',
      startDate: '',
      endDate: '',
      monthlyRate: 0,
      securityDeposit: 0,
      mileageCap: 0,
      currency: 'AED',
      notes: '',
    });
    setShowModal(false);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Active':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      case 'Draft':
        return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
      case 'Approved':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'Extended':
        return 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30';
      case 'Terminated':
        return 'bg-rose-500/20 text-rose-400 border-rose-500/30';
      case 'Closed':
        return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
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

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">Contracts</h1>
          <p className="text-slate-400">Manage all vehicle leasing contracts</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3 text-sm font-medium text-white hover:opacity-90 transition-all"
        >
          + New Contract
        </button>
      </div>

      {/* Filter Bar */}
      <div className="flex gap-4 flex-wrap">
        <div className="flex-1 min-w-64">
          <input
            type="text"
            placeholder="Search contracts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2 rounded-lg bg-slate-800/50 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none transition-all"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2 rounded-lg bg-slate-800/50 border border-white/10 text-white focus:border-blue-500 focus:outline-none transition-all"
        >
          <option>All</option>
          <option>Draft</option>
          <option>Approved</option>
          <option>Active</option>
          <option>Extended</option>
          <option>Terminated</option>
          <option>Closed</option>
        </select>
      </div>

      {/* Contracts Table */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-800/50">
            <tr className="border-b border-white/5">
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Contract #</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Lessee</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Vehicle</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Start Date</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">End Date</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Monthly Rate</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Status</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredContracts.map((contract) => (
              <tr key={contract.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                <td className="px-6 py-4 text-sm font-medium text-white">{contract.id}</td>
                <td className="px-6 py-4 text-sm text-white">{contract.lessee}</td>
                <td className="px-6 py-4 text-sm text-white">{contract.vehicle}</td>
                <td className="px-6 py-4 text-sm text-slate-200">{contract.startDate}</td>
                <td className="px-6 py-4 text-sm text-slate-200">{contract.endDate}</td>
                <td className="px-6 py-4 text-sm font-medium text-white">AED {contract.monthlyRate.toLocaleString()}</td>
                <td className="px-6 py-4 text-sm">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(contract.status)}`}>
                    {contract.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm">
                  <button className="text-blue-400 hover:text-blue-300 transition-colors">View</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* New Contract Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-96 overflow-y-auto bg-slate-800/95 border border-white/10 rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">New Contract</h2>
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
                  <label className="block text-sm font-medium text-slate-300 mb-2">Lessee</label>
                  <select
                    name="lessee"
                    value={formData.lessee}
                    onChange={handleInputChange}
                    required
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">Select a lessee</option>
                    {lesseeOptions.map((lessee) => (
                      <option key={lessee} value={lessee}>
                        {lessee}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Vehicle ID</label>
                  <input
                    type="text"
                    name="vehicleId"
                    value={formData.vehicleId}
                    onChange={handleInputChange}
                    required
                    placeholder="e.g., VAR-001"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Start Date</label>
                  <input
                    type="date"
                    name="startDate"
                    value={formData.startDate}
                    onChange={handleInputChange}
                    required
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">End Date</label>
                  <input
                    type="date"
                    name="endDate"
                    value={formData.endDate}
                    onChange={handleInputChange}
                    required
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Monthly Rate</label>
                  <input
                    type="number"
                    name="monthlyRate"
                    value={formData.monthlyRate}
                    onChange={handleInputChange}
                    required
                    placeholder="5000"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Security Deposit</label>
                  <input
                    type="number"
                    name="securityDeposit"
                    value={formData.securityDeposit}
                    onChange={handleInputChange}
                    placeholder="15000"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Mileage Cap (km)</label>
                  <input
                    type="number"
                    name="mileageCap"
                    value={formData.mileageCap}
                    onChange={handleInputChange}
                    placeholder="200000"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Currency</label>
                  <select
                    name="currency"
                    value={formData.currency}
                    onChange={handleInputChange}
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-blue-500 focus:outline-none"
                  >
                    <option>AED</option>
                    <option>USD</option>
                    <option>EUR</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Notes</label>
                <textarea
                  name="notes"
                  value={formData.notes}
                  onChange={handleInputChange}
                  placeholder="Additional contract notes..."
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
                  Create Contract
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
