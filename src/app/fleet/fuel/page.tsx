'use client';

import React, { useState, useEffect } from 'react';

interface FuelLog {
  id: string;
  vehicleId: string;
  driverId: string | null;
  fuelDate: string;
  liters: number;
  costPerLiter: number | null;
  totalCost: number | null;
  mileage: number | null;
  station: string | null;
}

interface FuelCard {
  id: string;
  cardNumber: string;
  vehicleId: string | null;
  driverId: string | null;
  monthlyLimit: number | null;
  currentBalance: number | null;
  isActive: boolean | null;
  expiryDate: string | null;
}

interface FuelSummary {
  totalLiters: number;
  totalCost: number;
  avgCostPerLiter: number;
}

export default function FuelManagement() {
  const [activeTab, setActiveTab] = useState<'logs' | 'cards'>('logs');
  const [fuelLogs, setFuelLogs] = useState<FuelLog[]>([]);
  const [fuelCards, setFuelCards] = useState<FuelCard[]>([]);
  const [summary, setSummary] = useState<FuelSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showLogModal, setShowLogModal] = useState(false);
  const [showCardModal, setShowCardModal] = useState(false);
  const [logFormData, setLogFormData] = useState({
    vehicle: '',
    driver: '',
    date: '',
    liters: '',
    costPerLiter: '',
    mileage: '',
    station: '',
  });
  const [cardFormData, setCardFormData] = useState({
    cardNumber: '',
    vehicle: '',
    driver: '',
    monthlyLimit: '',
    expiry: '',
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');

      const [logsRes, cardsRes, summaryRes] = await Promise.all([
        fetch('/api/fleet/fuel-logs'),
        fetch('/api/fleet/fuel-cards'),
        fetch('/api/fleet/fuel-logs/summary'),
      ]);

      if (!logsRes.ok || !cardsRes.ok || !summaryRes.ok) throw new Error('Failed to fetch data');

      const logsData = await logsRes.json();
      const cardsData = await cardsRes.json();
      const summaryData = await summaryRes.json();

      // API returns paginated envelope { data: [], total, page, limit }
      setFuelLogs(Array.isArray(logsData) ? logsData : (logsData.data ?? []));
      setFuelCards(Array.isArray(cardsData) ? cardsData : (cardsData.data ?? []));
      // Summary returns { currentMonth: {...}, monthly: [...] }
      setSummary(summaryData.currentMonth ?? summaryData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load fuel data');
    } finally {
      setLoading(false);
    }
  };

  const handleAddLog = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/fleet/fuel-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(logFormData),
      });
      if (!res.ok) throw new Error('Failed to add fuel log');
      setShowLogModal(false);
      setLogFormData({ vehicle: '', driver: '', date: '', liters: '', costPerLiter: '', mileage: '', station: '' });
      fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add fuel log');
    }
  };

  const handleAddCard = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/fleet/fuel-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cardFormData),
      });
      if (!res.ok) throw new Error('Failed to add fuel card');
      setShowCardModal(false);
      setCardFormData({ cardNumber: '', vehicle: '', driver: '', monthlyLimit: '', expiry: '' });
      fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add fuel card');
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
        <p className="font-medium">Error loading fuel management</p>
        <p className="text-sm mt-1">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Fuel Management</h1>
          <p className="text-slate-400 mt-1">Track fuel consumption and fuel card usage</p>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
            <p className="text-slate-400 text-sm font-medium mb-2">Total Liters This Month</p>
            <p className="text-3xl font-bold text-white">{(Number(summary.totalLiters) || 0).toFixed(1)}</p>
            <p className="text-xs text-slate-500 mt-2">⛽ Liters</p>
          </div>

          <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
            <p className="text-slate-400 text-sm font-medium mb-2">Total Cost This Month</p>
            <p className="text-3xl font-bold text-white">AED {(Number(summary.totalCost) || 0).toFixed(2)}</p>
            <p className="text-xs text-slate-500 mt-2">💰 Cost</p>
          </div>

          <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
            <p className="text-slate-400 text-sm font-medium mb-2">Avg Cost Per Liter</p>
            <p className="text-3xl font-bold text-white">AED {(Number(summary.avgCostPerLiter) || 0).toFixed(2)}</p>
            <p className="text-xs text-slate-500 mt-2">📊 Rate</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-white/10">
        <div className="flex gap-8">
          <button
            onClick={() => setActiveTab('logs')}
            className={`pb-4 px-2 font-medium transition-all ${
              activeTab === 'logs'
                ? 'text-orange-400 border-b-2 border-orange-400'
                : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            Fuel Logs
          </button>
          <button
            onClick={() => setActiveTab('cards')}
            className={`pb-4 px-2 font-medium transition-all ${
              activeTab === 'cards'
                ? 'text-orange-400 border-b-2 border-orange-400'
                : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            Fuel Cards
          </button>
        </div>
      </div>

      {/* Fuel Logs Tab */}
      {activeTab === 'logs' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => setShowLogModal(true)}
              className="rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 px-6 py-2 text-sm font-medium text-white hover:shadow-lg hover:shadow-orange-500/20 transition-all"
            >
              + New Fuel Log
            </button>
          </div>

          <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 overflow-hidden">
            {fuelLogs.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-4xl mb-3">⛽</div>
                <p className="text-slate-400">No fuel logs recorded</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-800/50">
                    <tr className="border-b border-white/5">
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Vehicle</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Driver</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Date</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Liters</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Cost/Liter</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Total Cost</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Mileage</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Station</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fuelLogs.map((log) => (
                      <tr key={log.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="px-6 py-4 text-sm text-white font-medium font-mono">{log.vehicleId?.slice(0, 8)}…</td>
                        <td className="px-6 py-4 text-sm text-slate-200">{log.driverId ? log.driverId.slice(0, 8) + '…' : '—'}</td>
                        <td className="px-6 py-4 text-sm text-slate-200">{new Date(log.fuelDate).toLocaleDateString()}</td>
                        <td className="px-6 py-4 text-sm text-slate-200">{(log.liters ?? 0).toFixed(2)} L</td>
                        <td className="px-6 py-4 text-sm text-slate-200">AED {(log.costPerLiter ?? 0).toFixed(2)}</td>
                        <td className="px-6 py-4 text-sm font-medium text-white">AED {(log.totalCost ?? 0).toFixed(2)}</td>
                        <td className="px-6 py-4 text-sm text-slate-200">{log.mileage ?? '—'} km</td>
                        <td className="px-6 py-4 text-sm text-slate-200">{log.station ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Fuel Cards Tab */}
      {activeTab === 'cards' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => setShowCardModal(true)}
              className="rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 px-6 py-2 text-sm font-medium text-white hover:shadow-lg hover:shadow-orange-500/20 transition-all"
            >
              + New Fuel Card
            </button>
          </div>

          <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 overflow-hidden">
            {fuelCards.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-4xl mb-3">💳</div>
                <p className="text-slate-400">No fuel cards on file</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-800/50">
                    <tr className="border-b border-white/5">
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Card Number</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Vehicle</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Driver</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Monthly Limit</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Current Balance</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Expiry</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fuelCards.map((card) => (
                      <tr key={card.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="px-6 py-4 text-sm font-mono text-white">•••• {card.cardNumber.slice(-4)}</td>
                        <td className="px-6 py-4 text-sm text-slate-200 font-mono">{card.vehicleId ? card.vehicleId.slice(0, 8) + '…' : '—'}</td>
                        <td className="px-6 py-4 text-sm text-slate-200 font-mono">{card.driverId ? card.driverId.slice(0, 8) + '…' : '—'}</td>
                        <td className="px-6 py-4 text-sm text-slate-200">AED {(card.monthlyLimit ?? 0).toFixed(2)}</td>
                        <td className="px-6 py-4 text-sm text-white font-medium">AED {(card.currentBalance ?? 0).toFixed(2)}</td>
                        <td className="px-6 py-4 text-sm text-slate-200">{card.expiryDate ? new Date(card.expiryDate).toLocaleDateString() : '—'}</td>
                        <td className="px-6 py-4 text-sm">
                          <span
                            className={`px-3 py-1 rounded-full text-xs font-medium ${
                              card.isActive !== false
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                : 'bg-red-500/20 text-red-400 border border-red-500/30'
                            }`}
                          >
                            {card.isActive !== false ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Fuel Log Modal */}
      {showLogModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 border border-white/10 rounded-2xl p-8 max-w-md w-full">
            <h2 className="text-2xl font-bold text-white mb-6">New Fuel Log</h2>

            <form onSubmit={handleAddLog} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Vehicle</label>
                <input
                  type="text"
                  value={logFormData.vehicle}
                  onChange={(e) => setLogFormData({ ...logFormData, vehicle: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Driver</label>
                <input
                  type="text"
                  value={logFormData.driver}
                  onChange={(e) => setLogFormData({ ...logFormData, driver: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Date</label>
                <input
                  type="date"
                  value={logFormData.date}
                  onChange={(e) => setLogFormData({ ...logFormData, date: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">Liters</label>
                  <input
                    type="number"
                    step="0.01"
                    value={logFormData.liters}
                    onChange={(e) => setLogFormData({ ...logFormData, liters: e.target.value })}
                    className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">Cost/Liter</label>
                  <input
                    type="number"
                    step="0.01"
                    value={logFormData.costPerLiter}
                    onChange={(e) => setLogFormData({ ...logFormData, costPerLiter: e.target.value })}
                    className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Mileage</label>
                <input
                  type="number"
                  value={logFormData.mileage}
                  onChange={(e) => setLogFormData({ ...logFormData, mileage: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Station</label>
                <input
                  type="text"
                  value={logFormData.station}
                  onChange={(e) => setLogFormData({ ...logFormData, station: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                  required
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 px-4 py-2 text-sm font-medium text-white hover:shadow-lg hover:shadow-orange-500/20 transition-all"
                >
                  Add Log
                </button>
                <button
                  type="button"
                  onClick={() => setShowLogModal(false)}
                  className="flex-1 rounded-xl bg-slate-700 px-4 py-2 text-sm font-medium text-slate-400 hover:bg-slate-600 transition-all"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Fuel Card Modal */}
      {showCardModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 border border-white/10 rounded-2xl p-8 max-w-md w-full">
            <h2 className="text-2xl font-bold text-white mb-6">New Fuel Card</h2>

            <form onSubmit={handleAddCard} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Card Number</label>
                <input
                  type="text"
                  value={cardFormData.cardNumber}
                  onChange={(e) => setCardFormData({ ...cardFormData, cardNumber: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Vehicle</label>
                <input
                  type="text"
                  value={cardFormData.vehicle}
                  onChange={(e) => setCardFormData({ ...cardFormData, vehicle: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Driver</label>
                <input
                  type="text"
                  value={cardFormData.driver}
                  onChange={(e) => setCardFormData({ ...cardFormData, driver: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Monthly Limit (AED)</label>
                <input
                  type="number"
                  step="0.01"
                  value={cardFormData.monthlyLimit}
                  onChange={(e) => setCardFormData({ ...cardFormData, monthlyLimit: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Expiry Date</label>
                <input
                  type="date"
                  value={cardFormData.expiry}
                  onChange={(e) => setCardFormData({ ...cardFormData, expiry: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                  required
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 px-4 py-2 text-sm font-medium text-white hover:shadow-lg hover:shadow-orange-500/20 transition-all"
                >
                  Add Card
                </button>
                <button
                  type="button"
                  onClick={() => setShowCardModal(false)}
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
