'use client';
import { contractToEarlyTermination, toDateInput } from '@/lib/autoFill';
import React, { useState, useCallback, useEffect } from 'react';

interface Termination {
  id: string;
  terminationNo: string;
  contractId: string;
  requestDate: string;
  effectiveDate: string;
  remainingMonths: number;
  monthlyRate: number;
  penaltyPct: number;
  penaltyAmount: number;
  outstandingPayments: number;
  depositRefund: number;
  settlementTotal: number;
  status: string;
}

interface FormData {
  contractId: string;
  remainingMonths: number;
  monthlyRate: number;
  penaltyPct: number;
  outstandingPayments: number;
  depositRefund: number;
  effectiveDate: string;
}

export default function EarlyTerminationsPage() {
  const [terminations, setTerminations] = useState<Termination[]>([]);
  const [filteredTerminations, setFilteredTerminations] = useState<Termination[]>([]);
  const [statusFilter, setStatusFilter] = useState('All');
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [calculatorData, setCalculatorData] = useState({
    contractId: '',
    remainingMonths: 0,
    monthlyRate: 0,
    penaltyPct: 20,
    outstandingPayments: 0,
    depositRefund: 0,
  });
  const [calculatedValues, setCalculatedValues] = useState({
    penaltyAmount: 0,
    totalSettlement: 0,
  });
  const [formData, setFormData] = useState<FormData>({
    contractId: '',
    remainingMonths: 0,
    monthlyRate: 0,
    penaltyPct: 20,
    outstandingPayments: 0,
    depositRefund: 0,
    effectiveDate: '',
  });

  const fetchTerminations = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/leasing/early-terminations');
      if (response.ok) {
        const data = await response.json();
        setTerminations(data);
      }
    } catch (error) {
      console.error('Failed to fetch terminations:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTerminations();
  }, [fetchTerminations]);

  useEffect(() => {
    let filtered = terminations;

    if (statusFilter !== 'All') {
      filtered = filtered.filter((t) => t.status === statusFilter);
    }

    setFilteredTerminations(filtered);
  }, [statusFilter, terminations]);

  const calculateTermination = (data: typeof calculatorData) => {
    const penaltyAmount = (data.monthlyRate * data.remainingMonths * data.penaltyPct) / 100;
    const totalSettlement = penaltyAmount + data.outstandingPayments - data.depositRefund;
    setCalculatedValues({
      penaltyAmount,
      totalSettlement,
    });
  };

  const handleCalculatorChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    const updatedData = {
      ...calculatorData,
      [name]: name === 'contractId' ? value : parseFloat(value) || 0,
    };
    setCalculatorData(updatedData);
    calculateTermination(updatedData);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === 'effectiveDate' ? value : parseFloat(value) || (name === 'contractId' ? value : 0),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/leasing/early-terminations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (response.ok) {
        setFormData({
          contractId: '',
          remainingMonths: 0,
          monthlyRate: 0,
          penaltyPct: 20,
          outstandingPayments: 0,
          depositRefund: 0,
          effectiveDate: '',
        });
        setShowModal(false);
        fetchTerminations();
      }
    } catch (error) {
      console.error('Failed to create termination:', error);
    }
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    try {
      const response = await fetch(`/api/leasing/early-terminations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (response.ok) {
        fetchTerminations();
      }
    } catch (error) {
      console.error('Failed to update termination:', error);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'DRAFT':
        return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
      case 'PENDING_APPROVAL':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      case 'APPROVED':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'EXECUTED':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      case 'CANCELLED':
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

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">Early Terminations</h1>
          <p className="text-slate-400">Manage contract early termination requests</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3 text-sm font-medium text-white hover:opacity-90 transition-all"
        >
          + New Termination
        </button>
      </div>

      {/* Calculator Widget */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm">
        <h3 className="text-lg font-semibold text-white mb-4">Settlement Calculator</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">Contract ID</label>
            <input
              type="text"
              name="contractId"
              value={calculatorData.contractId}
              onChange={handleCalculatorChange}
              onBlur={async (e) => {
                const val = e.target.value.trim();
                if (!val) return;
                try {
                  const res = await fetch(`/api/leasing/contracts-v2?search=${encodeURIComponent(val)}`);
                  const data = await res.json();
                  const contract = Array.isArray(data) ? data.find((cc: any) => cc.contractNumber === val || cc.id === val) : null;
                  if (contract) {
                    const filled = contractToEarlyTermination(contract);
                    setCalculatorData((prev: any) => ({
                      ...prev,
                      remainingMonths: filled.remainingMonths,
                      monthlyRate:     filled.monthlyRate,
                      penaltyPct:      filled.penaltyPct,
                    }));
                  }
                } catch {}
              }}
              placeholder="LC-001 (tab out to auto-fill)"
              className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">Remaining Months</label>
            <input
              type="number"
              name="remainingMonths"
              value={calculatorData.remainingMonths}
              onChange={handleCalculatorChange}
              placeholder="12"
              className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">Monthly Rate</label>
            <input
              type="number"
              name="monthlyRate"
              value={calculatorData.monthlyRate}
              onChange={handleCalculatorChange}
              placeholder="5000"
              className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">Penalty %</label>
            <input
              type="number"
              name="penaltyPct"
              value={calculatorData.penaltyPct}
              onChange={handleCalculatorChange}
              placeholder="20"
              className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">Outstanding Payments</label>
            <input
              type="number"
              name="outstandingPayments"
              value={calculatorData.outstandingPayments}
              onChange={handleCalculatorChange}
              placeholder="0"
              className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">Deposit Refund</label>
            <input
              type="number"
              name="depositRefund"
              value={calculatorData.depositRefund}
              onChange={handleCalculatorChange}
              placeholder="0"
              className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">Penalty Amount</label>
            <div className="px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white text-sm font-medium">
              AED {calculatedValues.penaltyAmount.toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">Total Settlement</label>
            <div className="px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm font-medium">
              AED {calculatedValues.totalSettlement.toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </div>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex gap-4 flex-wrap">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2 rounded-lg bg-slate-800/50 border border-white/10 text-white focus:border-blue-500 focus:outline-none transition-all"
        >
          <option>All</option>
          <option>DRAFT</option>
          <option>PENDING_APPROVAL</option>
          <option>APPROVED</option>
          <option>EXECUTED</option>
          <option>CANCELLED</option>
        </select>
      </div>

      {/* Terminations Table */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-800/50">
            <tr className="border-b border-white/5">
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Termination No</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Contract</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Request Date</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Effective Date</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Remaining Months</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Monthly Rate</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Penalty %</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Penalty Amount</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Outstanding</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Deposit Refund</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Settlement Total</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Status</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredTerminations.map((term) => (
              <tr key={term.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                <td className="px-6 py-4 text-sm font-medium text-white">{term.terminationNo}</td>
                <td className="px-6 py-4 text-sm text-white">{term.contractId}</td>
                <td className="px-6 py-4 text-sm text-slate-200">{term.requestDate}</td>
                <td className="px-6 py-4 text-sm text-slate-200">{term.effectiveDate}</td>
                <td className="px-6 py-4 text-sm text-white">{term.remainingMonths}</td>
                <td className="px-6 py-4 text-sm text-white font-medium">AED {term.monthlyRate.toLocaleString()}</td>
                <td className="px-6 py-4 text-sm text-white">{term.penaltyPct}%</td>
                <td className="px-6 py-4 text-sm text-white font-medium">
                  AED {term.penaltyAmount.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </td>
                <td className="px-6 py-4 text-sm text-white font-medium">
                  AED {term.outstandingPayments.toLocaleString()}
                </td>
                <td className="px-6 py-4 text-sm text-white font-medium">
                  AED {term.depositRefund.toLocaleString()}
                </td>
                <td className="px-6 py-4 text-sm text-emerald-400 font-medium">
                  AED {term.settlementTotal.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </td>
                <td className="px-6 py-4 text-sm">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(term.status)}`}>
                    {term.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm space-x-2">
                  {term.status === 'DRAFT' && (
                    <button
                      onClick={() => handleStatusChange(term.id, 'PENDING_APPROVAL')}
                      className="text-blue-400 hover:text-blue-300 transition-colors text-xs"
                    >
                      Submit
                    </button>
                  )}
                  {term.status === 'PENDING_APPROVAL' && (
                    <>
                      <button
                        onClick={() => handleStatusChange(term.id, 'APPROVED')}
                        className="text-emerald-400 hover:text-emerald-300 transition-colors text-xs"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleStatusChange(term.id, 'CANCELLED')}
                        className="text-rose-400 hover:text-rose-300 transition-colors text-xs"
                      >
                        Reject
                      </button>
                    </>
                  )}
                  {term.status === 'APPROVED' && (
                    <button
                      onClick={() => handleStatusChange(term.id, 'EXECUTED')}
                      className="text-emerald-400 hover:text-emerald-300 transition-colors text-xs"
                    >
                      Execute
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* New Termination Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-800/95 border border-white/10 rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">New Early Termination</h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                X
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
                    placeholder="LC-001"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Effective Date</label>
                  <input
                    type="date"
                    name="effectiveDate"
                    value={formData.effectiveDate}
                    onChange={handleInputChange}
                    required
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Remaining Months</label>
                  <input
                    type="number"
                    name="remainingMonths"
                    value={formData.remainingMonths}
                    onChange={handleInputChange}
                    required
                    placeholder="12"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
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
                  <label className="block text-sm font-medium text-slate-300 mb-2">Penalty %</label>
                  <input
                    type="number"
                    name="penaltyPct"
                    value={formData.penaltyPct}
                    onChange={handleInputChange}
                    required
                    placeholder="20"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Outstanding Payments</label>
                  <input
                    type="number"
                    name="outstandingPayments"
                    value={formData.outstandingPayments}
                    onChange={handleInputChange}
                    placeholder="0"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Deposit Refund</label>
                  <input
                    type="number"
                    name="depositRefund"
                    value={formData.depositRefund}
                    onChange={handleInputChange}
                    placeholder="0"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 rounded-lg bg-blue-600 text-white font-medium py-2 hover:bg-blue-700 transition-colors"
                >
                  Create Termination
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 rounded-lg bg-slate-700 text-white font-medium py-2 hover:bg-slate-600 transition-colors"
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
