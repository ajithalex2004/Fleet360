'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Plus, Edit2 } from 'lucide-react';
import { LeasingBillingMigrationNotice } from '@/components/LeasingBillingMigrationNotice';

interface MileageReading {
  id: string;
  contract: string;
  vehicle: string;
  date: string;
  mileage: number;
  readingType: 'DELIVERY' | 'MONTHLY' | 'EXCHANGE' | 'RETURN' | 'ADHOC';
  capturedBy: string;
  source: 'MANUAL' | 'GPS' | 'OBD';
  notes: string;
  contractId: string;
  vehicleId: string;
}

interface MileageOverage {
  id: string;
  contract: string;
  periodFrom: string;
  periodTo: string;
  allowedKm: number;
  actualKm: number;
  overage: number;
  ratePerKm: number;
  amount: number;
  status: 'PENDING' | 'INVOICED' | 'PAID' | 'WAIVED';
}

interface Contract {
  id: string;
  contractNumber?: string;
  lessee?: string;
  lesseeId?: string | null;
}

interface Lessee {
  id: string;
  name: string;
}

const getStatusBadgeColor = (status: string) => {
  switch (status) {
    case 'PENDING':
      return 'bg-amber-900/30 text-amber-200 border-amber-700';
    case 'INVOICED':
      return 'bg-blue-900/30 text-blue-200 border-blue-700';
    case 'PAID':
      return 'bg-emerald-900/30 text-emerald-200 border-emerald-700';
    case 'WAIVED':
      return 'bg-slate-700/30 text-slate-300 border-slate-600';
    default:
      return 'bg-slate-700/30 text-slate-300 border-slate-600';
  }
};

export default function MileagePage() {
  const pathname = usePathname();
  const isLegacyPath = pathname.startsWith('/leasing/');
  const apiBase = isLegacyPath ? '/api/leasing' : '/api/finance/leasing-billing';
  const [activeTab, setActiveTab] = useState<'readings' | 'overages'>('readings');
  const [readings, setReadings] = useState<MileageReading[]>([]);
  const [overages, setOverages] = useState<MileageOverage[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [lessees, setLessees] = useState<Lessee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewReadingModal, setShowNewReadingModal] = useState(false);
  const [showEditOverageModal, setShowEditOverageModal] = useState(false);
  const [selectedOverage, setSelectedOverage] = useState<MileageOverage | null>(null);

  const [readingFormData, setReadingFormData] = useState({
    lesseeId: '',
    contractId: '',
    vehicleId: '',
    readingDate: '',
    mileage: '',
    readingType: 'MONTHLY',
    capturedBy: '',
    source: 'MANUAL',
    notes: '',
  });

  const [overageStatus, setOverageStatus] = useState('PENDING');
  const fetchReadings = useCallback(async () => {
    try {
      const response = await fetch(`${apiBase}/mileage-readings`);
      if (!response.ok) throw new Error('Failed to fetch readings');
      const data = await response.json();
      setReadings(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error fetching readings');
    }
  }, [apiBase]);

  const fetchOverages = useCallback(async () => {
    try {
      const response = await fetch(`${apiBase}/mileage-overages`);
      if (!response.ok) throw new Error('Failed to fetch overages');
      const data = await response.json();
      setOverages(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error fetching overages');
    }
  }, [apiBase]);

  const fetchContracts = useCallback(async () => {
    try {
      const [contractsRes, lesseesRes] = await Promise.all([
        fetch('/api/leasing/contracts-v2'),
        fetch('/api/leasing/lessees'),
      ]);
      if (!contractsRes.ok) throw new Error('Failed to fetch contracts');
      const contractsData = await contractsRes.json();
      setContracts(Array.isArray(contractsData) ? contractsData : []);
      if (lesseesRes.ok) {
        const lesseesData = await lesseesRes.json();
        setLessees(Array.isArray(lesseesData) ? lesseesData : lesseesData.lessees ?? []);
      }
    } catch (err) {
      console.error('Error fetching contracts / lessees:', err);
    }
  }, []);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      await Promise.all([fetchReadings(), fetchOverages(), fetchContracts()]);
      setLoading(false);
    };
    fetchAll();
  }, [fetchReadings, fetchOverages, fetchContracts]);

  const handleAddReading = async () => {
    try {
      const response = await fetch(`${apiBase}/mileage-readings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...readingFormData,
          mileage: parseInt(readingFormData.mileage),
        }),
      });
      if (!response.ok) throw new Error('Failed to add reading');
      setReadingFormData({
        lesseeId: '',
        contractId: '',
        vehicleId: '',
        readingDate: '',
        mileage: '',
        readingType: 'MONTHLY',
        capturedBy: '',
        source: 'MANUAL',
        notes: '',
      });
      setShowNewReadingModal(false);
      fetchReadings();
      fetchOverages();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error adding reading');
    }
  };

  const filteredContracts = readingFormData.lesseeId
    ? contracts.filter(contract => contract.lesseeId === readingFormData.lesseeId)
    : contracts;

  useEffect(() => {
    if (readingFormData.contractId && !filteredContracts.some(contract => contract.id === readingFormData.contractId)) {
      setReadingFormData(prev => ({ ...prev, contractId: '' }));
    }
  }, [filteredContracts, readingFormData.contractId]);

  const handleUpdateOverageStatus = async () => {
    if (!selectedOverage) return;
    try {
      const response = await fetch(`${apiBase}/mileage-overages/${selectedOverage.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: overageStatus }),
      });
      if (!response.ok) throw new Error('Failed to update overage');
      setShowEditOverageModal(false);
      fetchOverages();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error updating overage');
    }
  };

  return (
    isLegacyPath ? (
      <LeasingBillingMigrationNotice
        title="Leasing mileage and overages"
        financeHref="/finance/leasing-billing/mileage"
        description="Mileage capture that feeds invoicing and overage status is now anchored in Finance & Billing."
      />
    ) : (
    <div className="min-h-screen bg-[#0c1a3e] text-slate-100 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold">Mileage Management</h1>
          {activeTab === 'readings' && (
            <button
              onClick={() => setShowNewReadingModal(true)}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition"
            >
              <Plus size={20} /> New Reading
            </button>
          )}
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-lg">
            <p className="text-red-200">{error}</p>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-4 mb-6 border-b border-slate-700">
          <button
            onClick={() => setActiveTab('readings')}
            className={`px-4 py-3 font-medium transition border-b-2 ${
              activeTab === 'readings'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-300'
            }`}
          >
            Mileage Readings
          </button>
          <button
            onClick={() => setActiveTab('overages')}
            className={`px-4 py-3 font-medium transition border-b-2 ${
              activeTab === 'overages'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-300'
            }`}
          >
            Overage Invoices
          </button>
        </div>

        {loading ? (
          <div className="text-center py-12">Loading data...</div>
        ) : (
          <>
            {/* Readings Tab */}
            {activeTab === 'readings' && (
              <div className="overflow-x-auto bg-slate-800 rounded-lg border border-slate-700">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700 bg-slate-900">
                      <th className="px-4 py-3 text-left">Contract</th>
                      <th className="px-4 py-3 text-left">Vehicle</th>
                      <th className="px-4 py-3 text-left">Date</th>
                      <th className="px-4 py-3 text-right">Mileage (km)</th>
                      <th className="px-4 py-3 text-left">Reading Type</th>
                      <th className="px-4 py-3 text-left">Captured By</th>
                      <th className="px-4 py-3 text-left">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {readings.map(reading => (
                      <tr key={reading.id} className="border-b border-slate-700 hover:bg-slate-750">
                        <td className="px-4 py-3">{reading.contract}</td>
                        <td className="px-4 py-3">{reading.vehicle}</td>
                        <td className="px-4 py-3 text-sm">{reading.date}</td>
                        <td className="px-4 py-3 text-right font-semibold">{reading.mileage.toLocaleString()}</td>
                        <td className="px-4 py-3 text-sm">{reading.readingType}</td>
                        <td className="px-4 py-3 text-sm">{reading.capturedBy}</td>
                        <td className="px-4 py-3 text-sm">{reading.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Overages Tab */}
            {activeTab === 'overages' && (
              <div className="overflow-x-auto bg-slate-800 rounded-lg border border-slate-700">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700 bg-slate-900">
                      <th className="px-4 py-3 text-left">Contract</th>
                      <th className="px-4 py-3 text-left">Period</th>
                      <th className="px-4 py-3 text-right">Allowed (km)</th>
                      <th className="px-4 py-3 text-right">Actual (km)</th>
                      <th className="px-4 py-3 text-right">Overage (km)</th>
                      <th className="px-4 py-3 text-right">Rate/km</th>
                      <th className="px-4 py-3 text-right">Amount (AED)</th>
                      <th className="px-4 py-3 text-left">Status</th>
                      <th className="px-4 py-3 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overages.map(overage => (
                      <tr key={overage.id} className="border-b border-slate-700 hover:bg-slate-750">
                        <td className="px-4 py-3">{overage.contract}</td>
                        <td className="px-4 py-3 text-sm">{overage.periodFrom} - {overage.periodTo}</td>
                        <td className="px-4 py-3 text-right">{overage.allowedKm.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right">{overage.actualKm.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right font-semibold">{overage.overage.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right">{overage.ratePerKm.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-semibold">{overage.amount.toFixed(2)}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 text-xs rounded border ${getStatusBadgeColor(overage.status)}`}>
                            {overage.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => {
                              setSelectedOverage(overage);
                              setOverageStatus(overage.status);
                              setShowEditOverageModal(true);
                            }}
                            className="text-blue-400 hover:text-blue-300 transition"
                            title="Update status"
                          >
                            <Edit2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* New Reading Modal */}
        {showNewReadingModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-slate-800 border border-slate-700 rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between p-6 border-b border-slate-700">
                <h2 className="text-xl font-bold">New Mileage Reading</h2>
                <button
                  onClick={() => setShowNewReadingModal(false)}
                  className="text-slate-400 hover:text-slate-200 transition"
                >
                  X
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Customer / Lessee</label>
                  <select
                    value={readingFormData.lesseeId}
                    onChange={e => setReadingFormData({...readingFormData, lesseeId: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  >
                    <option value="">All lessees</option>
                    {lessees.map(lessee => (
                      <option key={lessee.id} value={lessee.id}>{lessee.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Contract</label>
                  <select
                    value={readingFormData.contractId}
                    onChange={e => setReadingFormData({...readingFormData, contractId: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  >
                    <option value="">Select contract</option>
                    {filteredContracts.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.contractNumber ?? c.id.slice(0, 8)}{c.lessee ? ` - ${c.lessee}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Vehicle ID</label>
                  <input
                    type="text"
                    value={readingFormData.vehicleId}
                    onChange={e => setReadingFormData({...readingFormData, vehicleId: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Reading Date</label>
                  <input
                    type="date"
                    value={readingFormData.readingDate}
                    onChange={e => setReadingFormData({...readingFormData, readingDate: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Mileage (km)</label>
                  <input
                    type="number"
                    value={readingFormData.mileage}
                    onChange={e => setReadingFormData({...readingFormData, mileage: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Reading Type</label>
                  <select
                    value={readingFormData.readingType}
                    onChange={e => setReadingFormData({...readingFormData, readingType: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  >
                    <option>DELIVERY</option>
                    <option>MONTHLY</option>
                    <option>EXCHANGE</option>
                    <option>RETURN</option>
                    <option>ADHOC</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Captured By</label>
                  <input
                    type="text"
                    value={readingFormData.capturedBy}
                    onChange={e => setReadingFormData({...readingFormData, capturedBy: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Source</label>
                  <select
                    value={readingFormData.source}
                    onChange={e => setReadingFormData({...readingFormData, source: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  >
                    <option>MANUAL</option>
                    <option>GPS</option>
                    <option>OBD</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Notes</label>
                  <textarea
                    value={readingFormData.notes}
                    onChange={e => setReadingFormData({...readingFormData, notes: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100 h-20"
                  />
                </div>
              </div>
              <div className="flex gap-3 p-6 border-t border-slate-700">
                <button
                  onClick={() => setShowNewReadingModal(false)}
                  className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddReading}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition"
                >
                  Add Reading
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit Overage Status Modal */}
        {showEditOverageModal && selectedOverage && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-slate-800 border border-slate-700 rounded-lg max-w-md w-full">
              <div className="flex items-center justify-between p-6 border-b border-slate-700">
                <h2 className="text-xl font-bold">Update Overage Status</h2>
                <button
                  onClick={() => setShowEditOverageModal(false)}
                  className="text-slate-400 hover:text-slate-200 transition"
                >
                  X
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Status</label>
                  <select
                    value={overageStatus}
                    onChange={e => setOverageStatus(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  >
                    <option>PENDING</option>
                    <option>INVOICED</option>
                    <option>PAID</option>
                    <option>WAIVED</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-3 p-6 border-t border-slate-700">
                <button
                  onClick={() => setShowEditOverageModal(false)}
                  className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpdateOverageStatus}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition"
                >
                  Update
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
    )
  );
}
