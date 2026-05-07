'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Plus, Edit2 } from 'lucide-react';

interface RemarketingVehicle {
  id: string;
  remarketingNo: string;
  make: string;
  model: string;
  year: number;
  plateNo: string;
  condition: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';
  bookValue: number;
  residualValue: number;
  askingPrice: number;
  stage: 'AVAILABLE' | 'LISTED' | 'OFFER_RECEIVED' | 'NEGOTIATING' | 'SOLD' | 'WRITTEN_OFF';
  salePrice: number | null;
  buyerName: string | null;
  saleDate: string | null;
  buyerType: 'AUCTION' | 'DEALER' | 'DIRECT' | 'STAFF' | null;
  returnDate: string;
  returnMileage: number;
  contractId: string;
  notes: string;
  daysInPipeline: number;
}

interface PipelineCount {
  stage: string;
  count: number;
}

const getConditionBadgeColor = (condition: string) => {
  switch (condition) {
    case 'EXCELLENT':
      return 'bg-emerald-900/30 text-emerald-200 border-emerald-700';
    case 'GOOD':
      return 'bg-blue-900/30 text-blue-200 border-blue-700';
    case 'FAIR':
      return 'bg-amber-900/30 text-amber-200 border-amber-700';
    case 'POOR':
      return 'bg-red-900/30 text-red-200 border-red-700';
    default:
      return 'bg-slate-700/30 text-slate-300 border-slate-600';
  }
};

const getStageBadgeColor = (stage: string) => {
  switch (stage) {
    case 'AVAILABLE':
      return 'bg-slate-700/30 text-slate-300 border-slate-600';
    case 'LISTED':
      return 'bg-blue-900/30 text-blue-200 border-blue-700';
    case 'OFFER_RECEIVED':
      return 'bg-cyan-900/30 text-cyan-200 border-cyan-700';
    case 'NEGOTIATING':
      return 'bg-amber-900/30 text-amber-200 border-amber-700';
    case 'SOLD':
      return 'bg-emerald-900/30 text-emerald-200 border-emerald-700';
    case 'WRITTEN_OFF':
      return 'bg-red-900/30 text-red-200 border-red-700';
    default:
      return 'bg-slate-700/30 text-slate-300 border-slate-600';
  }
};

export default function RemarketingPage() {
  const [vehicles, setVehicles] = useState<RemarketingVehicle[]>([]);
  const [pipelineData, setPipelineData] = useState<PipelineCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<RemarketingVehicle | null>(null);

  const [formData, setFormData] = useState({
    make: '',
    model: '',
    year: new Date().getFullYear().toString(),
    plateNo: '',
    contractId: '',
    returnDate: '',
    returnMileage: '',
    condition: 'GOOD',
    bookValue: '',
    residualValue: '',
    askingPrice: '',
    buyerType: 'DEALER',
    notes: '',
  });

  const [editData, setEditData] = useState({
    stage: 'AVAILABLE',
    salePrice: '',
    buyerName: '',
    saleDate: '',
  });

  const fetchVehicles = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/leasing/remarketing');
      if (!response.ok) throw new Error('Failed to fetch vehicles');
      const data = await response.json();
      setVehicles(data.vehicles || data);

      // Build pipeline data
      const stages = ['AVAILABLE', 'LISTED', 'OFFER_RECEIVED', 'NEGOTIATING', 'SOLD', 'WRITTEN_OFF'];
      const pipeline = stages.map(stage => ({
        stage,
        count: (data.vehicles || data).filter((v: RemarketingVehicle) => v.stage === stage).length,
      }));
      setPipelineData(pipeline);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error fetching vehicles');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVehicles();
  }, [fetchVehicles]);

  const handleNewVehicle = async () => {
    try {
      const response = await fetch('/api/leasing/remarketing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          year: parseInt(formData.year),
          returnMileage: parseInt(formData.returnMileage),
          bookValue: parseFloat(formData.bookValue),
          residualValue: parseFloat(formData.residualValue),
          askingPrice: parseFloat(formData.askingPrice),
        }),
      });
      if (!response.ok) throw new Error('Failed to create vehicle');
      setFormData({
        make: '',
        model: '',
        year: new Date().getFullYear().toString(),
        plateNo: '',
        contractId: '',
        returnDate: '',
        returnMileage: '',
        condition: 'GOOD',
        bookValue: '',
        residualValue: '',
        askingPrice: '',
        buyerType: 'DEALER',
        notes: '',
      });
      setShowNewModal(false);
      fetchVehicles();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error creating vehicle');
    }
  };

  const handleEditVehicle = async () => {
    if (!selectedVehicle) return;
    try {
      const payload: any = { stage: editData.stage };
      if (editData.salePrice) payload.salePrice = parseFloat(editData.salePrice);
      if (editData.buyerName) payload.buyerName = editData.buyerName;
      if (editData.saleDate) payload.saleDate = editData.saleDate;

      const response = await fetch(`/api/leasing/remarketing/${selectedVehicle.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error('Failed to update vehicle');
      setShowEditModal(false);
      fetchVehicles();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error updating vehicle');
    }
  };

  const totalSold = vehicles.filter(v => v.stage === 'SOLD').length;
  const totalProfit = vehicles.reduce((sum, v) => {
    if (v.stage === 'SOLD' && v.salePrice) {
      return sum + (v.salePrice - v.bookValue);
    }
    return sum;
  }, 0);
  const avgSalePrice = vehicles.filter(v => v.stage === 'SOLD' && v.salePrice).length > 0
    ? vehicles.filter(v => v.stage === 'SOLD' && v.salePrice).reduce((sum, v) => sum + (v.salePrice || 0), 0) /
      vehicles.filter(v => v.stage === 'SOLD' && v.salePrice).length
    : 0;

  const openEditModal = (vehicle: RemarketingVehicle) => {
    setSelectedVehicle(vehicle);
    setEditData({
      stage: vehicle.stage,
      salePrice: vehicle.salePrice?.toString() || '',
      buyerName: vehicle.buyerName || '',
      saleDate: vehicle.saleDate || '',
    });
    setShowEditModal(true);
  };

  return (
    <div className="min-h-screen bg-[#0c1a3e] text-slate-100 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold">Remarketing Management</h1>
          <button
            onClick={() => setShowNewModal(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition"
          >
            <Plus size={20} /> New Vehicle
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-lg">
            <p className="text-red-200">{error}</p>
          </div>
        )}

        {/* Pipeline Bar */}
        <div className="mb-8 bg-slate-800 border border-slate-700 rounded-lg p-6">
          <h2 className="text-sm font-semibold text-slate-400 mb-4 uppercase">Pipeline Status</h2>
          <div className="grid grid-cols-6 gap-3">
            {pipelineData.map(item => (
              <div key={item.stage} className="bg-slate-900 rounded-lg p-4 text-center">
                <p className="text-xs text-slate-400 mb-2">{item.stage.replace(/_/g, ' ')}</p>
                <p className="text-2xl font-bold text-blue-400">{item.count}</p>
              </div>
            ))}
          </div>
        </div>

        {/* P&L Summary */}
        <div className="mb-8 grid grid-cols-3 gap-4">
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
            <p className="text-slate-400 text-sm mb-1">Total Sold</p>
            <p className="text-3xl font-bold text-emerald-400">{totalSold}</p>
          </div>
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
            <p className="text-slate-400 text-sm mb-1">Total Profit/Loss</p>
            <p className={`text-3xl font-bold ${totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {totalProfit >= 0 ? '+' : ''}{totalProfit.toFixed(2)} AED
            </p>
          </div>
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
            <p className="text-slate-400 text-sm mb-1">Avg Sale Price</p>
            <p className="text-3xl font-bold text-blue-400">{avgSalePrice.toFixed(2)} AED</p>
          </div>
        </div>

        {/* Vehicles Grid */}
        {loading ? (
          <div className="text-center py-12">Loading vehicles...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {vehicles.map(vehicle => (
              <div key={vehicle.id} className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden hover:border-slate-600 transition">
                <div className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <p className="text-xs text-slate-400 mb-1">Remarketing No</p>
                      <p className="font-bold">{vehicle.remarketingNo}</p>
                    </div>
                    <span className={`px-2 py-1 text-xs rounded border ${getConditionBadgeColor(vehicle.condition)}`}>
                      {vehicle.condition}
                    </span>
                  </div>

                  <div className="mb-4">
                    <p className="text-lg font-semibold">{vehicle.year} {vehicle.make} {vehicle.model}</p>
                    <p className="text-sm text-slate-400">Plate: {vehicle.plateNo}</p>
                  </div>

                  <div className="mb-4 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Book Value:</span>
                      <span className="font-medium">{vehicle.bookValue.toFixed(2)} AED</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Asking Price:</span>
                      <span className="font-medium">{vehicle.askingPrice.toFixed(2)} AED</span>
                    </div>
                    {vehicle.salePrice && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">Sale Price:</span>
                        <span className="font-medium text-emerald-400">{vehicle.salePrice.toFixed(2)} AED</span>
                      </div>
                    )}
                  </div>

                  <div className="mb-4 flex flex-wrap gap-2">
                    <span className={`px-2 py-1 text-xs rounded border ${getStageBadgeColor(vehicle.stage)}`}>
                      {vehicle.stage.replace(/_/g, ' ')}
                    </span>
                    <span className="px-2 py-1 text-xs bg-slate-900 text-slate-300 rounded border border-slate-600">
                      {vehicle.daysInPipeline} days
                    </span>
                  </div>

                  {vehicle.buyerName && (
                    <p className="text-sm text-slate-400 mb-4">Buyer: {vehicle.buyerName}</p>
                  )}

                  <button
                    onClick={() => openEditModal(vehicle)}
                    className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 px-3 py-2 rounded transition text-sm"
                  >
                    <Edit2 size={16} /> Update
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* New Vehicle Modal */}
        {showNewModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-slate-800 border border-slate-700 rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between p-6 border-b border-slate-700">
                <h2 className="text-xl font-bold">New Vehicle Entry</h2>
                <button
                  onClick={() => setShowNewModal(false)}
                  className="text-slate-400 hover:text-slate-200 transition"
                >
                  X
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Make</label>
                  <input
                    type="text"
                    value={formData.make}
                    onChange={e => setFormData({...formData, make: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Model</label>
                  <input
                    type="text"
                    value={formData.model}
                    onChange={e => setFormData({...formData, model: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Year</label>
                  <input
                    type="number"
                    value={formData.year}
                    onChange={e => setFormData({...formData, year: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Plate No</label>
                  <input
                    type="text"
                    value={formData.plateNo}
                    onChange={e => setFormData({...formData, plateNo: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Contract ID</label>
                  <input
                    type="text"
                    value={formData.contractId}
                    onChange={e => setFormData({...formData, contractId: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Return Date</label>
                  <input
                    type="date"
                    value={formData.returnDate}
                    onChange={e => setFormData({...formData, returnDate: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Return Mileage</label>
                  <input
                    type="number"
                    value={formData.returnMileage}
                    onChange={e => setFormData({...formData, returnMileage: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Condition</label>
                  <select
                    value={formData.condition}
                    onChange={e => setFormData({...formData, condition: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  >
                    <option>EXCELLENT</option>
                    <option>GOOD</option>
                    <option>FAIR</option>
                    <option>POOR</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Book Value (AED)</label>
                  <input
                    type="number"
                    value={formData.bookValue}
                    onChange={e => setFormData({...formData, bookValue: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Residual Value (AED)</label>
                  <input
                    type="number"
                    value={formData.residualValue}
                    onChange={e => setFormData({...formData, residualValue: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Asking Price (AED)</label>
                  <input
                    type="number"
                    value={formData.askingPrice}
                    onChange={e => setFormData({...formData, askingPrice: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Buyer Type</label>
                  <select
                    value={formData.buyerType}
                    onChange={e => setFormData({...formData, buyerType: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  >
                    <option>AUCTION</option>
                    <option>DEALER</option>
                    <option>DIRECT</option>
                    <option>STAFF</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Notes</label>
                  <textarea
                    value={formData.notes}
                    onChange={e => setFormData({...formData, notes: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100 h-20"
                  />
                </div>
              </div>
              <div className="flex gap-3 p-6 border-t border-slate-700">
                <button
                  onClick={() => setShowNewModal(false)}
                  className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleNewVehicle}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition"
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit Vehicle Modal */}
        {showEditModal && selectedVehicle && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-slate-800 border border-slate-700 rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between p-6 border-b border-slate-700">
                <h2 className="text-xl font-bold">Update Vehicle: {selectedVehicle.remarketingNo}</h2>
                <button
                  onClick={() => setShowEditModal(false)}
                  className="text-slate-400 hover:text-slate-200 transition"
                >
                  X
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Stage</label>
                  <select
                    value={editData.stage}
                    onChange={e => setEditData({...editData, stage: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  >
                    <option>AVAILABLE</option>
                    <option>LISTED</option>
                    <option>OFFER_RECEIVED</option>
                    <option>NEGOTIATING</option>
                    <option>SOLD</option>
                    <option>WRITTEN_OFF</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Sale Price (AED)</label>
                  <input
                    type="number"
                    value={editData.salePrice}
                    onChange={e => setEditData({...editData, salePrice: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Buyer Name</label>
                  <input
                    type="text"
                    value={editData.buyerName}
                    onChange={e => setEditData({...editData, buyerName: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Sale Date</label>
                  <input
                    type="date"
                    value={editData.saleDate}
                    onChange={e => setEditData({...editData, saleDate: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
              </div>
              <div className="flex gap-3 p-6 border-t border-slate-700">
                <button
                  onClick={() => setShowEditModal(false)}
                  className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleEditVehicle}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
