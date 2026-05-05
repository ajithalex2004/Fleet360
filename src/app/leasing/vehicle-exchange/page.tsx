'use client';
import React, { useState, useEffect } from 'react';

interface Exchange {
  id: string;
  contractNumber: string;
  lessee: string;
  outgoingVehicle: string;
  incomingVehicle: string;
  exchangeDate: string;
  reason: 'UPGRADE' | 'BREAKDOWN' | 'CUSTOMER_REQUEST' | 'MAINTENANCE' | 'OTHER';
  approvedBy: string;
  outgoingMileage: number;
  incomingMileage: number;
  notes: string;
}

interface Contract {
  id: string;
  contractNumber: string;
  lessee: string;
  vehicles: Array<{ id: string; type: string; make: string; model: string; licensePlate: string }>;
}

interface NewExchangeForm {
  contractId: string;
  outgoingVehicleId: string;
  incomingVehicleId: string;
  exchangeDate: string;
  reason: 'UPGRADE' | 'BREAKDOWN' | 'CUSTOMER_REQUEST' | 'MAINTENANCE' | 'OTHER';
  outgoingMileage: string;
  incomingMileage: string;
  approvedBy: string;
  notes: string;
}

export default function VehicleExchangePage() {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewExchange, setShowNewExchange] = useState(false);

  const [newExchangeForm, setNewExchangeForm] = useState<NewExchangeForm>({
    contractId: '',
    outgoingVehicleId: '',
    incomingVehicleId: '',
    exchangeDate: new Date().toISOString().split('T')[0],
    reason: 'CUSTOMER_REQUEST',
    outgoingMileage: '',
    incomingMileage: '',
    approvedBy: '',
    notes: '',
  });

  useEffect(() => {
    const mockExchanges: Exchange[] = [
      {
        id: '1',
        contractNumber: 'LC-V2-001',
        lessee: 'Global Logistics LLC',
        outgoingVehicle: 'Mercedes Sprinter (DXB-001)',
        incomingVehicle: 'Ford Transit (DXB-101)',
        exchangeDate: '2025-03-15',
        reason: 'UPGRADE',
        approvedBy: 'Ahmed Hassan',
        outgoingMileage: 12500,
        incomingMileage: 500,
        notes: 'Vehicle upgraded for better cargo capacity',
      },
      {
        id: '2',
        contractNumber: 'LC-V2-001',
        lessee: 'Global Logistics LLC',
        outgoingVehicle: 'BMW X5 (DXB-002)',
        incomingVehicle: 'Mercedes GLE (DXB-102)',
        exchangeDate: '2025-02-28',
        reason: 'BREAKDOWN',
        approvedBy: 'Hana Al-Mansouri',
        outgoingMileage: 8750,
        incomingMileage: 250,
        notes: 'Engine issues detected, emergency replacement',
      },
      {
        id: '3',
        contractNumber: 'LC-V2-002',
        lessee: 'Ahmed Al-Mansouri',
        outgoingVehicle: 'BMW X7 (AUH-001)',
        incomingVehicle: 'Audi Q7 (AUH-101)',
        exchangeDate: '2025-02-10',
        reason: 'CUSTOMER_REQUEST',
        approvedBy: 'Mohammed Al-Qasimi',
        outgoingMileage: 4200,
        incomingMileage: 100,
        notes: 'Customer preference for different brand',
      },
      {
        id: '4',
        contractNumber: 'LC-V2-004',
        lessee: 'Enterprise Corp',
        outgoingVehicle: 'Toyota Corolla (DXB-005)',
        incomingVehicle: 'Honda Civic (DXB-103)',
        exchangeDate: '2025-01-20',
        reason: 'MAINTENANCE',
        approvedBy: 'Layla Al-Nakhli',
        outgoingMileage: 6800,
        incomingMileage: 150,
        notes: 'Regular maintenance scheduled, temporary replacement',
      },
    ];

    const mockContracts: Contract[] = [
      {
        id: '1',
        contractNumber: 'LC-V2-001',
        lessee: 'Global Logistics LLC',
        vehicles: [
          { id: 'v1', type: 'Van', make: 'Mercedes', model: 'Sprinter', licensePlate: 'DXB-001' },
          { id: 'v2', type: 'SUV', make: 'BMW', model: 'X5', licensePlate: 'DXB-002' },
          { id: 'v3', type: 'Sedan', make: 'Toyota', model: 'Camry', licensePlate: 'DXB-003' },
        ],
      },
      {
        id: '2',
        contractNumber: 'LC-V2-002',
        lessee: 'Ahmed Al-Mansouri',
        vehicles: [
          { id: 'v4', type: 'SUV', make: 'BMW', model: 'X7', licensePlate: 'AUH-001' },
        ],
      },
      {
        id: '3',
        contractNumber: 'LC-V2-003',
        lessee: 'Fatima Al-Nakhli',
        vehicles: [
          { id: 'v5', type: 'Sedan', make: 'Toyota', model: 'Corolla', licensePlate: 'DXB-005' },
        ],
      },
      {
        id: '4',
        contractNumber: 'LC-V2-004',
        lessee: 'Enterprise Corp',
        vehicles: [
          { id: 'v6', type: 'Sedan', make: 'Honda', model: 'Accord', licensePlate: 'DXB-006' },
          { id: 'v7', type: 'Van', make: 'Nissan', model: 'Caravan', licensePlate: 'DXB-007' },
        ],
      },
    ];

    Promise.all([
      fetch('/api/leasing/vehicle-exchanges').then(r => r.ok ? r.json() : []),
      fetch('/api/leasing/contracts-v2').then(r => r.ok ? r.json() : []),
    ])
      .then(([exchangesData, contractsData]) => {
        setExchanges(exchangesData.length ? exchangesData : mockExchanges);
        setContracts(contractsData.length ? contractsData : mockContracts);
      })
      .catch(() => { setExchanges(mockExchanges); setContracts(mockContracts); })
      .finally(() => setLoading(false));
  }, []);

  const getReasonBadgeStyle = (reason: string) => {
    switch (reason) {
      case 'UPGRADE':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      case 'BREAKDOWN':
        return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'CUSTOMER_REQUEST':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'MAINTENANCE':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      case 'OTHER':
        return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
      default:
        return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
    }
  };

  const stats = {
    thisMonth: exchanges.filter(e => {
      const date = new Date(e.exchangeDate);
      const now = new Date();
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    }).length,
    pending: 2,
    byType: {
      VAN: exchanges.filter(e => e.outgoingVehicle.includes('Sprinter') || e.outgoingVehicle.includes('Transit') || e.outgoingVehicle.includes('Caravan')).length,
      SUV: exchanges.filter(e => e.outgoingVehicle.includes('X5') || e.outgoingVehicle.includes('X7') || e.outgoingVehicle.includes('Q7')).length,
      SEDAN: exchanges.filter(e => e.outgoingVehicle.includes('Camry') || e.outgoingVehicle.includes('Corolla') || e.outgoingVehicle.includes('Civic') || e.outgoingVehicle.includes('Accord')).length,
    },
  };

  const handleCreateExchange = async () => {
    const contractId = newExchangeForm.contractId;
    console.log('Creating exchange:', newExchangeForm);
    try {
      const response = await fetch(`/api/leasing/contracts-v2/${contractId}/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newExchangeForm),
      });
      if (response.ok) {
        setShowNewExchange(false);
        setNewExchangeForm({
          contractId: '',
          outgoingVehicleId: '',
          incomingVehicleId: '',
          exchangeDate: new Date().toISOString().split('T')[0],
          reason: 'CUSTOMER_REQUEST',
          outgoingMileage: '',
          incomingMileage: '',
          approvedBy: '',
          notes: '',
        });
      }
    } catch (error) {
      console.error('Error creating exchange:', error);
    }
  };

  const selectedContract = contracts.find(c => c.id === newExchangeForm.contractId);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-400">Loading exchanges...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">Vehicle Exchanges</h1>
          <p className="text-slate-400">Track and manage vehicle exchanges in active contracts</p>
        </div>
        <button
          onClick={() => setShowNewExchange(true)}
          className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3 text-sm font-medium text-white hover:opacity-90 transition-opacity"
        >
          Record Exchange
        </button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-4 backdrop-blur-sm">
          <p className="text-slate-400 text-xs font-medium mb-1">Total This Month</p>
          <p className="text-2xl font-bold text-white">{stats.thisMonth}</p>
        </div>
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-4 backdrop-blur-sm">
          <p className="text-slate-400 text-xs font-medium mb-1">Pending Exchanges</p>
          <p className="text-2xl font-bold text-amber-400">{stats.pending}</p>
        </div>
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-4 backdrop-blur-sm">
          <p className="text-slate-400 text-xs font-medium mb-1">Vans Exchanged</p>
          <p className="text-2xl font-bold text-blue-400">{stats.byType.VAN}</p>
        </div>
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-4 backdrop-blur-sm">
          <p className="text-slate-400 text-xs font-medium mb-1">Sedans Exchanged</p>
          <p className="text-2xl font-bold text-cyan-400">{stats.byType.SEDAN}</p>
        </div>
      </div>

      {/* Exchanges Table */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-800/50">
            <tr className="border-b border-white/5">
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Contract #</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Lessee</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Outgoing Vehicle</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Incoming Vehicle</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Exchange Date</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Reason</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Approved By</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Mileage</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Notes</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Actions</th>
            </tr>
          </thead>
          <tbody>
            {exchanges.map((exchange) => (
              <tr key={exchange.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                <td className="px-4 py-4 text-sm font-medium text-white">{exchange.contractNumber}</td>
                <td className="px-4 py-4 text-sm text-white">{exchange.lessee}</td>
                <td className="px-4 py-4 text-sm text-white">{exchange.outgoingVehicle}</td>
                <td className="px-4 py-4 text-sm text-white">{exchange.incomingVehicle}</td>
                <td className="px-4 py-4 text-sm text-slate-200">{exchange.exchangeDate}</td>
                <td className="px-4 py-4 text-sm">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getReasonBadgeStyle(exchange.reason)}`}>
                    {exchange.reason.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-4 py-4 text-sm text-white">{exchange.approvedBy}</td>
                <td className="px-4 py-4 text-sm text-slate-200">
                  <div className="text-xs">
                    <p>Out: {exchange.outgoingMileage.toLocaleString()} km</p>
                    <p>In: {exchange.incomingMileage.toLocaleString()} km</p>
                  </div>
                </td>
                <td className="px-4 py-4 text-sm text-slate-200 max-w-xs truncate">{exchange.notes}</td>
                <td className="px-4 py-4 text-sm">
                  <button className="text-blue-400 hover:text-blue-300 font-medium">View</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Record Exchange Modal */}
      {showNewExchange && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-white/10 rounded-2xl p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">Record Vehicle Exchange</h2>
              <button
                onClick={() => setShowNewExchange(false)}
                className="text-slate-400 hover:text-white text-2xl"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Contract</label>
                <select
                  value={newExchangeForm.contractId}
                  onChange={(e) => setNewExchangeForm({ ...newExchangeForm, contractId: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500/50"
                >
                  <option value="">Select a contract</option>
                  {contracts.map((contract) => (
                    <option key={contract.id} value={contract.id}>
                      {contract.contractNumber} - {contract.lessee}
                    </option>
                  ))}
                </select>
              </div>

              {selectedContract && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">Outgoing Vehicle</label>
                    <select
                      value={newExchangeForm.outgoingVehicleId}
                      onChange={(e) => setNewExchangeForm({ ...newExchangeForm, outgoingVehicleId: e.target.value })}
                      className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500/50"
                    >
                      <option value="">Select vehicle to exchange</option>
                      {selectedContract.vehicles.map((vehicle) => (
                        <option key={vehicle.id} value={vehicle.id}>
                          {vehicle.make} {vehicle.model} ({vehicle.licensePlate})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">Incoming Vehicle ID</label>
                    <input
                      type="text"
                      value={newExchangeForm.incomingVehicleId}
                      onChange={(e) => setNewExchangeForm({ ...newExchangeForm, incomingVehicleId: e.target.value })}
                      placeholder="New vehicle license plate or ID"
                      className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Exchange Date</label>
                  <input
                    type="date"
                    value={newExchangeForm.exchangeDate}
                    onChange={(e) => setNewExchangeForm({ ...newExchangeForm, exchangeDate: e.target.value })}
                    className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500/50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Reason</label>
                  <select
                    value={newExchangeForm.reason}
                    onChange={(e) => setNewExchangeForm({ ...newExchangeForm, reason: e.target.value as any })}
                    className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500/50"
                  >
                    <option value="UPGRADE">Upgrade</option>
                    <option value="BREAKDOWN">Breakdown</option>
                    <option value="CUSTOMER_REQUEST">Customer Request</option>
                    <option value="MAINTENANCE">Maintenance</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Outgoing Mileage (km)</label>
                  <input
                    type="number"
                    value={newExchangeForm.outgoingMileage}
                    onChange={(e) => setNewExchangeForm({ ...newExchangeForm, outgoingMileage: e.target.value })}
                    placeholder="Current mileage"
                    className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Incoming Mileage (km)</label>
                  <input
                    type="number"
                    value={newExchangeForm.incomingMileage}
                    onChange={(e) => setNewExchangeForm({ ...newExchangeForm, incomingMileage: e.target.value })}
                    placeholder="Starting mileage"
                    className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Approved By</label>
                <input
                  type="text"
                  value={newExchangeForm.approvedBy}
                  onChange={(e) => setNewExchangeForm({ ...newExchangeForm, approvedBy: e.target.value })}
                  placeholder="Approver name"
                  className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Notes</label>
                <textarea
                  value={newExchangeForm.notes}
                  onChange={(e) => setNewExchangeForm({ ...newExchangeForm, notes: e.target.value })}
                  placeholder="Additional notes about the exchange..."
                  rows={3}
                  className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
                />
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowNewExchange(false)}
                  className="flex-1 px-4 py-2 border border-white/10 rounded-lg text-white hover:bg-white/5 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateExchange}
                  className="flex-1 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 font-medium text-white hover:opacity-90 transition-opacity"
                >
                  Record Exchange
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
