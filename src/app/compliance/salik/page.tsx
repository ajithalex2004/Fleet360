'use client';

import React, { useState, useEffect } from 'react';

interface SalikAccount {
  id: string;
  tagNumber: string;
  vehicle: string;
  balance: number;
  autoRecharge: boolean;
  rechargeAmount: number;
  status: 'active' | 'inactive' | 'low_balance';
}

export default function SalikPage() {
  const [accounts, setAccounts] = useState<SalikAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    tagNumber: '',
    vehicle: '',
    initialBalance: '500',
    autoRecharge: false,
    rechargeAmount: '200',
  });

  useEffect(() => {
    fetchAccounts();
  }, []);

  const fetchAccounts = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/compliance/salik');
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts || []);
      }
    } catch (error) {
      console.error('Error fetching Salik accounts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/compliance/salik', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        setShowModal(false);
        setFormData({
          tagNumber: '',
          vehicle: '',
          initialBalance: '500',
          autoRecharge: false,
          rechargeAmount: '200',
        });
        fetchAccounts();
      }
    } catch (error) {
      console.error('Error creating Salik account:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const lowBalanceAccounts = accounts.filter((a) => a.balance < 50);

  const getStatusColor = (status: string) => {
    if (status === 'active') return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    if (status === 'low_balance') return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
    return 'bg-slate-500/20 text-slate-300 border-slate-500/30';
  };

  const getBalanceColor = (balance: number) => {
    if (balance < 50) return 'text-rose-400 font-bold';
    if (balance < 100) return 'text-amber-400';
    return 'text-emerald-400';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">Salik Accounts</h1>
          <p className="text-slate-400">Manage toll tag accounts and balances</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-all"
        >
          + Add Salik Account
        </button>
      </div>

      {/* Low Balance Alert */}
      {lowBalanceAccounts.length > 0 && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-6">
          <p className="text-rose-400 font-semibold mb-3">Low Balance Alert</p>
          <p className="text-slate-300 text-sm">
            {lowBalanceAccounts.length} account(s) with balance below AED 50:
          </p>
          <ul className="mt-2 space-y-1">
            {lowBalanceAccounts.map((acc) => (
              <li key={acc.id} className="text-slate-400 text-sm">
                • {acc.tagNumber} ({acc.vehicle}) - AED {acc.balance.toFixed(2)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Table */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-800/50 border-b border-white/5">
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Tag Number</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Vehicle</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Balance (AED)</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Auto-Recharge</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Recharge Amount</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Status</th>
            </tr>
          </thead>
          <tbody>
            {accounts.length > 0 ? (
              accounts.map((account) => (
                <tr key={account.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-6 py-4 text-sm text-white font-medium">{account.tagNumber}</td>
                  <td className="px-6 py-4 text-sm text-white">{account.vehicle}</td>
                  <td className={`px-6 py-4 text-sm font-medium ${getBalanceColor(account.balance)}`}>
                    AED {account.balance.toFixed(2)}
                  </td>
                  <td className="px-6 py-4 text-sm text-white">
                    {account.autoRecharge ? (
                      <span className="text-emerald-400">Yes</span>
                    ) : (
                      <span className="text-slate-200">No</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-white">AED {account.rechargeAmount}</td>
                  <td className="px-6 py-4 text-sm">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(account.status)}`}>
                      {account.status.replace('_', ' ')}
                    </span>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-slate-200">
                  No Salik accounts found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-2xl border border-white/10 p-8 w-full max-w-md">
            <h2 className="text-2xl font-bold text-white mb-6">Add Salik Account</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Tag Number</label>
                <input
                  type="text"
                  value={formData.tagNumber}
                  onChange={(e) => setFormData({ ...formData, tagNumber: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  placeholder="SAL-12345"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Vehicle</label>
                <input
                  type="text"
                  value={formData.vehicle}
                  onChange={(e) => setFormData({ ...formData, vehicle: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  placeholder="Vehicle ID"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Initial Balance (AED)</label>
                <input
                  type="number"
                  value={formData.initialBalance}
                  onChange={(e) => setFormData({ ...formData, initialBalance: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  placeholder="500"
                  required
                />
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="autoRecharge"
                  checked={formData.autoRecharge}
                  onChange={(e) => setFormData({ ...formData, autoRecharge: e.target.checked })}
                  className="w-4 h-4 cursor-pointer text-white"
                />
                <label htmlFor="autoRecharge" className="text-sm text-slate-300 cursor-pointer">
                  Enable Auto-Recharge
                </label>
              </div>
              {formData.autoRecharge && (
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Recharge Amount (AED)</label>
                  <input
                    type="number"
                    value={formData.rechargeAmount}
                    onChange={(e) => setFormData({ ...formData, rechargeAmount: e.target.value })}
                    className="w-full bg-slate-700/50 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    placeholder="200"
                    required
                  />
                </div>
              )}
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2 rounded-lg bg-slate-700 text-white font-medium hover:bg-slate-600 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-medium hover:opacity-90 transition-all"
                >
                  Add Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
