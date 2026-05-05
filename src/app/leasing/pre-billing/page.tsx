'use client';
import { contractToPreBilling } from '@/lib/autoFill';
import React, { useState, useCallback, useEffect } from 'react';

interface PreBillingStatement {
  id: string;
  statementNo: string;
  contractId: string;
  lesseeName: string;
  billingPeriod: string;
  dueDate: string;
  baseRent: number;
  fuelCharges: number;
  fineCharges: number;
  maintenanceCharges: number;
  overageCharges: number;
  otherCharges: number;
  vat: number;
  total: number;
  status: string;
}

interface FormData {
  contractId: string;
  billingPeriod: string;
  dueDate: string;
  baseRent: number;
  fuelCharges: number;
  fineCharges: number;
  maintenanceCharges: number;
  overageCharges: number;
  otherCharges: number;
}

export default function PreBillingPage() {
  const [statements, setStatements] = useState<PreBillingStatement[]>([]);
  const [filteredStatements, setFilteredStatements] = useState<PreBillingStatement[]>([]);
  const [statusFilter, setStatusFilter] = useState('All');
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [formData, setFormData] = useState<FormData>({
    contractId: '',
    billingPeriod: '',
    dueDate: '',
    baseRent: 0,
    fuelCharges: 0,
    fineCharges: 0,
    maintenanceCharges: 0,
    overageCharges: 0,
    otherCharges: 0,
  });
  const [calculatedVAT, setCalculatedVAT] = useState(0);
  const [calculatedTotal, setCalculatedTotal] = useState(0);

  const fetchStatements = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/leasing/pre-billing');
      if (response.ok) {
        const data = await response.json();
        setStatements(data);
      }
    } catch (error) {
      console.error('Failed to fetch pre-billing statements:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatements();
  }, [fetchStatements]);

  useEffect(() => {
    let filtered = statements;

    if (statusFilter !== 'All') {
      filtered = filtered.filter((s) => s.status === statusFilter);
    }

    setFilteredStatements(filtered);
  }, [statusFilter, statements]);

  const calculateTotals = (data: FormData) => {
    const subtotal =
      data.baseRent +
      data.fuelCharges +
      data.fineCharges +
      data.maintenanceCharges +
      data.overageCharges +
      data.otherCharges;
    const vat = subtotal * 0.05;
    const total = subtotal + vat;
    setCalculatedVAT(vat);
    setCalculatedTotal(total);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    const updatedData = {
      ...formData,
      [name]: name === 'contractId' || name === 'billingPeriod' || name === 'dueDate' ? value : parseFloat(value) || 0,
    };
    setFormData(updatedData);
    calculateTotals(updatedData);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/leasing/pre-billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          vat: calculatedVAT,
          total: calculatedTotal,
        }),
      });
      if (response.ok) {
        setFormData({
          contractId: '',
          billingPeriod: '',
          dueDate: '',
          baseRent: 0,
          fuelCharges: 0,
          fineCharges: 0,
          maintenanceCharges: 0,
          overageCharges: 0,
          otherCharges: 0,
        });
        setCalculatedVAT(0);
        setCalculatedTotal(0);
        setShowModal(false);
        fetchStatements();
      }
    } catch (error) {
      console.error('Failed to create pre-billing statement:', error);
    }
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    try {
      const response = await fetch(`/api/leasing/pre-billing/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (response.ok) {
        fetchStatements();
      }
    } catch (error) {
      console.error('Failed to update pre-billing statement:', error);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'DRAFT':
        return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
      case 'SENT':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'CONFIRMED':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      case 'DISPUTED':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      case 'FINALIZED':
        return 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30';
      default:
        return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
    }
  };

  const statusCounts = {
    DRAFT: statements.filter((s) => s.status === 'DRAFT').length,
    SENT: statements.filter((s) => s.status === 'SENT').length,
    CONFIRMED: statements.filter((s) => s.status === 'CONFIRMED').length,
    DISPUTED: statements.filter((s) => s.status === 'DISPUTED').length,
    FINALIZED: statements.filter((s) => s.status === 'FINALIZED').length,
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
          <h1 className="text-4xl font-bold text-white mb-2">Pre-Billing Statements</h1>
          <p className="text-slate-400">Generate and manage monthly billing statements</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3 text-sm font-medium text-white hover:opacity-90 transition-all"
        >
          + Generate Statement
        </button>
      </div>

      {/* Status Pipeline */}
      <div className="grid grid-cols-5 gap-4">
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm text-center">
          <div className="text-2xl font-bold text-slate-400">{statusCounts.DRAFT}</div>
          <div className="text-xs text-slate-400 mt-2">DRAFT</div>
        </div>
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm text-center">
          <div className="text-2xl font-bold text-blue-400">{statusCounts.SENT}</div>
          <div className="text-xs text-slate-400 mt-2">SENT</div>
        </div>
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm text-center">
          <div className="text-2xl font-bold text-emerald-400">{statusCounts.CONFIRMED}</div>
          <div className="text-xs text-slate-400 mt-2">CONFIRMED</div>
        </div>
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm text-center">
          <div className="text-2xl font-bold text-amber-400">{statusCounts.DISPUTED}</div>
          <div className="text-xs text-slate-400 mt-2">DISPUTED</div>
        </div>
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm text-center">
          <div className="text-2xl font-bold text-indigo-400">{statusCounts.FINALIZED}</div>
          <div className="text-xs text-slate-400 mt-2">FINALIZED</div>
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
          <option>SENT</option>
          <option>CONFIRMED</option>
          <option>DISPUTED</option>
          <option>FINALIZED</option>
        </select>
      </div>

      {/* Pre-Billing Statements Table */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-800/50">
            <tr className="border-b border-white/5">
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Statement No</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Contract</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Lessee</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Billing Period</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Due Date</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Base Rent</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Fuel</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Fines</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Overage</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Other</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">VAT</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Total</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Status</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredStatements.map((statement) => (
              <tr key={statement.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                <td className="px-6 py-4 text-sm font-medium text-white">{statement.statementNo}</td>
                <td className="px-6 py-4 text-sm text-white">{statement.contractId}</td>
                <td className="px-6 py-4 text-sm text-white">{statement.lesseeName}</td>
                <td className="px-6 py-4 text-sm text-slate-200">{statement.billingPeriod}</td>
                <td className="px-6 py-4 text-sm text-slate-200">{statement.dueDate}</td>
                <td className="px-6 py-4 text-sm text-white">
                  AED {statement.baseRent.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </td>
                <td className="px-6 py-4 text-sm text-white">
                  AED {statement.fuelCharges.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </td>
                <td className="px-6 py-4 text-sm text-white">
                  AED {statement.fineCharges.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </td>
                <td className="px-6 py-4 text-sm text-white">
                  AED {statement.overageCharges.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </td>
                <td className="px-6 py-4 text-sm text-white">
                  AED {statement.otherCharges.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </td>
                <td className="px-6 py-4 text-sm text-white">
                  AED {statement.vat.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </td>
                <td className="px-6 py-4 text-sm font-medium text-white">
                  AED {statement.total.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </td>
                <td className="px-6 py-4 text-sm">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(statement.status)}`}>
                    {statement.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm space-x-2">
                  {statement.status === 'DRAFT' && (
                    <button
                      onClick={() => handleStatusChange(statement.id, 'SENT')}
                      className="text-blue-400 hover:text-blue-300 transition-colors text-xs"
                    >
                      Send
                    </button>
                  )}
                  {statement.status === 'SENT' && (
                    <>
                      <button
                        onClick={() => handleStatusChange(statement.id, 'CONFIRMED')}
                        className="text-emerald-400 hover:text-emerald-300 transition-colors text-xs"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => handleStatusChange(statement.id, 'DISPUTED')}
                        className="text-amber-400 hover:text-amber-300 transition-colors text-xs"
                      >
                        Dispute
                      </button>
                    </>
                  )}
                  {statement.status === 'CONFIRMED' && (
                    <button
                      onClick={() => handleStatusChange(statement.id, 'FINALIZED')}
                      className="text-indigo-400 hover:text-indigo-300 transition-colors text-xs"
                    >
                      Finalize
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Generate Statement Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-800/95 border border-white/10 rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">Generate Pre-Billing Statement</h2>
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
                  <label className="block text-sm font-medium text-slate-300 mb-2">Billing Period (YYYY-MM)</label>
                  <input
                    type="text"
                    name="billingPeriod"
                    value={formData.billingPeriod}
                    onChange={handleInputChange}
                    required
                    placeholder="2026-04"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Due Date</label>
                  <input
                    type="date"
                    name="dueDate"
                    value={formData.dueDate}
                    onChange={handleInputChange}
                    required
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Base Rent</label>
                  <input
                    type="number"
                    name="baseRent"
                    value={formData.baseRent}
                    onChange={handleInputChange}
                    required
                    placeholder="6500"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Fuel Charges</label>
                  <input
                    type="number"
                    name="fuelCharges"
                    value={formData.fuelCharges}
                    onChange={handleInputChange}
                    placeholder="0"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Fine Charges</label>
                  <input
                    type="number"
                    name="fineCharges"
                    value={formData.fineCharges}
                    onChange={handleInputChange}
                    placeholder="0"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Maintenance Charges</label>
                  <input
                    type="number"
                    name="maintenanceCharges"
                    value={formData.maintenanceCharges}
                    onChange={handleInputChange}
                    placeholder="0"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Overage Charges</label>
                  <input
                    type="number"
                    name="overageCharges"
                    value={formData.overageCharges}
                    onChange={handleInputChange}
                    placeholder="0"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Other Charges</label>
                  <input
                    type="number"
                    name="otherCharges"
                    value={formData.otherCharges}
                    onChange={handleInputChange}
                    placeholder="0"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">VAT (5%)</label>
                  <div className="px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white text-sm font-medium">
                    AED {calculatedVAT.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Total</label>
                  <div className="px-4 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm font-medium">
                    AED {calculatedTotal.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 rounded-lg bg-blue-600 text-white font-medium py-2 hover:bg-blue-700 transition-colors"
                >
                  Generate Statement
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
