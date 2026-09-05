'use client';
import { contractToRenewal, toDateInput } from '@/lib/autoFill';
import React, { useState, useCallback, useEffect } from 'react';

interface Renewal {
  id: string;
  renewalNo: string;
  originalContractId: string;
  newStartDate: string;
  newEndDate: string;
  proposedRate: number;
  renewalType: string;
  status: string;
  customerResponseDate?: string;
}

interface Contract {
  id: string;
  lessee: string;
}

interface FormData {
  originalContractId: string;
  renewalType: string;
  proposedStartDate: string;
  proposedEndDate: string;
  proposedMonthlyRate: number;
  initiatedBy: string;
  notes: string;
}

export default function RenewalsPage() {
  const [renewals, setRenewals] = useState<Renewal[]>([]);
  const [filteredRenewals, setFilteredRenewals] = useState<Renewal[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [statusFilter, setStatusFilter] = useState('All');
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [formData, setFormData] = useState<FormData>({
    originalContractId: '',
    renewalType: 'SAME_TERMS',
    proposedStartDate: '',
    proposedEndDate: '',
    proposedMonthlyRate: 0,
    initiatedBy: '',
    notes: '',
  });

  const fetchRenewals = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/leasing/renewals');
      if (response.ok) {
        const data = await response.json();
        setRenewals(data);
      }
    } catch (error) {
      console.error('Failed to fetch renewals:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchContracts = useCallback(async () => {
    try {
      const response = await fetch('/api/leasing/contracts-v2');
      if (response.ok) {
        const data = await response.json();
        setContracts(data);
      }
    } catch (error) {
      console.error('Failed to fetch contracts:', error);
    }
  }, []);

  useEffect(() => {
    fetchRenewals();
    fetchContracts();
  }, [fetchRenewals, fetchContracts]);

  useEffect(() => {
    let filtered = renewals;

    if (statusFilter !== 'All') {
      filtered = filtered.filter((r) => r.status === statusFilter);
    }

    setFilteredRenewals(filtered);
  }, [statusFilter, renewals]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === 'proposedMonthlyRate' ? parseFloat(value) : value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/leasing/renewals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (response.ok) {
        setFormData({
          originalContractId: '',
          renewalType: 'SAME_TERMS',
          proposedStartDate: '',
          proposedEndDate: '',
          proposedMonthlyRate: 0,
          initiatedBy: '',
          notes: '',
        });
        setShowModal(false);
        fetchRenewals();
      }
    } catch (error) {
      console.error('Failed to create renewal:', error);
    }
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    try {
      const response = await fetch(`/api/leasing/renewals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (response.ok) {
        fetchRenewals();
      }
    } catch (error) {
      console.error('Failed to update renewal:', error);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PROPOSED':
        return 'bg-slate-500/20 text-[var(--text-muted)] border-slate-500/30';
      case 'SENT_TO_CUSTOMER':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'ACCEPTED':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      case 'REJECTED':
        return 'bg-rose-500/20 text-rose-400 border-rose-500/30';
      case 'EXPIRED':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      default:
        return 'bg-slate-500/20 text-[var(--text-muted)] border-slate-500/30';
    }
  };

  const statusCounts = {
    PROPOSED: renewals.filter((r) => r.status === 'PROPOSED').length,
    SENT_TO_CUSTOMER: renewals.filter((r) => r.status === 'SENT_TO_CUSTOMER').length,
    ACCEPTED: renewals.filter((r) => r.status === 'ACCEPTED').length,
    REJECTED: renewals.filter((r) => r.status === 'REJECTED').length,
    EXPIRED: renewals.filter((r) => r.status === 'EXPIRED').length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[var(--text-muted)]">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-[var(--text-main)] mb-2">Renewals</h1>
          <p className="text-[var(--text-muted)]">Manage contract renewals and extensions</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3 text-sm font-medium text-white hover:opacity-90 transition-all"
        >
          + Propose Renewal
        </button>
      </div>

      {/* Status Pipeline */}
      <div className="grid grid-cols-5 gap-4">
        <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6 backdrop-blur-sm text-center">
          <div className="text-2xl font-bold text-[var(--text-main)]">{statusCounts.PROPOSED}</div>
          <div className="text-xs text-[var(--text-muted)] mt-2">PROPOSED</div>
        </div>
        <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6 backdrop-blur-sm text-center">
          <div className="text-2xl font-bold text-blue-400">{statusCounts.SENT_TO_CUSTOMER}</div>
          <div className="text-xs text-[var(--text-muted)] mt-2">SENT TO CUSTOMER</div>
        </div>
        <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6 backdrop-blur-sm text-center">
          <div className="text-2xl font-bold text-emerald-400">{statusCounts.ACCEPTED}</div>
          <div className="text-xs text-[var(--text-muted)] mt-2">ACCEPTED</div>
        </div>
        <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6 backdrop-blur-sm text-center">
          <div className="text-2xl font-bold text-rose-400">{statusCounts.REJECTED}</div>
          <div className="text-xs text-[var(--text-muted)] mt-2">REJECTED</div>
        </div>
        <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6 backdrop-blur-sm text-center">
          <div className="text-2xl font-bold text-amber-400">{statusCounts.EXPIRED}</div>
          <div className="text-xs text-[var(--text-muted)] mt-2">EXPIRED</div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex gap-4 flex-wrap">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2 rounded-lg bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-blue-500 focus:outline-none transition-all"
        >
          <option>All</option>
          <option>PROPOSED</option>
          <option>SENT_TO_CUSTOMER</option>
          <option>ACCEPTED</option>
          <option>REJECTED</option>
          <option>EXPIRED</option>
        </select>
      </div>

      {/* Renewals Table */}
      <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6 backdrop-blur-sm overflow-x-auto">
        <table className="w-full">
          <thead className="bg-[var(--bg-surface)]/50">
            <tr className="border-b border-[var(--border-subtle)]">
              <th className="px-6 py-3 text-left text-sm font-semibold text-[var(--text-muted)]">Renewal No</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-[var(--text-muted)]">Original Contract</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-[var(--text-muted)]">New Start</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-[var(--text-muted)]">New End</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-[var(--text-muted)]">Proposed Rate</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-[var(--text-muted)]">Renewal Type</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-[var(--text-muted)]">Status</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-[var(--text-muted)]">Customer Response Date</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-[var(--text-muted)]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredRenewals.map((renewal) => (
              <tr key={renewal.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] transition-colors">
                <td className="px-6 py-4 text-sm font-medium text-[var(--text-main)]">{renewal.renewalNo}</td>
                <td className="px-6 py-4 text-sm text-[var(--text-main)]">{renewal.originalContractId}</td>
                <td className="px-6 py-4 text-sm text-[var(--text-main)]">{renewal.newStartDate}</td>
                <td className="px-6 py-4 text-sm text-[var(--text-main)]">{renewal.newEndDate}</td>
                <td className="px-6 py-4 text-sm font-medium text-[var(--text-main)]">AED {renewal.proposedRate.toLocaleString()}</td>
                <td className="px-6 py-4 text-sm text-[var(--text-main)]">{renewal.renewalType}</td>
                <td className="px-6 py-4 text-sm">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(renewal.status)}`}>
                    {renewal.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-[var(--text-main)]">
                  {renewal.customerResponseDate || '-'}
                </td>
                <td className="px-6 py-4 text-sm space-x-2">
                  {renewal.status === 'PROPOSED' && (
                    <button
                      onClick={() => handleStatusChange(renewal.id, 'SENT_TO_CUSTOMER')}
                      className="text-blue-400 hover:text-blue-300 transition-colors text-xs"
                    >
                      Send
                    </button>
                  )}
                  {renewal.status === 'SENT_TO_CUSTOMER' && (
                    <>
                      <button
                        onClick={() => handleStatusChange(renewal.id, 'ACCEPTED')}
                        className="text-emerald-400 hover:text-emerald-300 transition-colors text-xs"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => handleStatusChange(renewal.id, 'REJECTED')}
                        className="text-rose-400 hover:text-rose-300 transition-colors text-xs"
                      >
                        Reject
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Propose Renewal Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[var(--bg-surface)]/95 border border-[var(--border-subtle)] rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-[var(--text-main)]">Propose Renewal</h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
              >
                X
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Original Contract</label>
                  <select
                    name="originalContractId"
                    value={formData.originalContractId}
                    onChange={handleInputChange}
                    required
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">Select a contract</option>
                    {contracts.map((contract) => (
                      <option key={contract.id} value={contract.id}>
                        {contract.id} - {contract.lessee}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Renewal Type</label>
                  <select
                    name="renewalType"
                    value={formData.renewalType}
                    onChange={handleInputChange}
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-blue-500 focus:outline-none"
                  >
                    <option>SAME_TERMS</option>
                    <option>REVISED_TERMS</option>
                    <option>UPGRADE</option>
                    <option>DOWNGRADE</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Proposed Start Date</label>
                  <input
                    type="date"
                    name="proposedStartDate"
                    value={formData.proposedStartDate}
                    onChange={handleInputChange}
                    required
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Proposed End Date</label>
                  <input
                    type="date"
                    name="proposedEndDate"
                    value={formData.proposedEndDate}
                    onChange={handleInputChange}
                    required
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Proposed Monthly Rate</label>
                  <input
                    type="number"
                    name="proposedMonthlyRate"
                    value={formData.proposedMonthlyRate}
                    onChange={handleInputChange}
                    required
                    placeholder="6500"
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Initiated By</label>
                  <input
                    type="text"
                    name="initiatedBy"
                    value={formData.initiatedBy}
                    onChange={handleInputChange}
                    required
                    placeholder="John Doe"
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Notes</label>
                <textarea
                  name="notes"
                  value={formData.notes}
                  onChange={handleInputChange}
                  placeholder="Additional notes..."
                  rows={3}
                  className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 rounded-lg bg-blue-600 text-[var(--text-main)] font-medium py-2 hover:bg-blue-700 transition-colors"
                >
                  Propose Renewal
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 rounded-lg bg-[var(--bg-surface-hover)] text-[var(--text-main)] font-medium py-2 hover:bg-[var(--bg-surface-hover)] transition-colors"
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
