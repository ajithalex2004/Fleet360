'use client';
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { BadgeCheck, Clock3, Send, XCircle, TimerReset } from 'lucide-react';
import RowActionMenu from '@/components/ui/RowActionMenu';
import SmartDataGridHeader from '@/components/ui/SmartDataGridHeader';
import { KpiCard, KpiGrid, PageHeader } from '@/components/ui/page-theme';

interface Renewal {
  id: string;
  renewalNo: string;
  originalContractId: string;
  originalContract?: {
    contractNumber?: string;
    endDate?: string;
    monthlyRate?: number;
  };
  newStartDate: string;
  newEndDate: string;
  proposedRate: number;
  renewalType: string;
  status: string;
  customerResponseDate?: string;
}

interface Contract {
  id: string;
  contractNumber: string;
  lessee: string;
  lesseeId?: string | null;
}

interface Lessee {
  id: string;
  name: string;
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
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [lessees, setLessees] = useState<Lessee[]>([]);
  const [statusFilter, setStatusFilter] = useState('All');
  const [selectedLesseeId, setSelectedLesseeId] = useState('');
  const [sortKey, setSortKey] = useState<'renewalNo' | 'contract' | 'newStartDate' | 'newEndDate' | 'proposedRate' | 'renewalType' | 'status' | 'customerResponseDate'>('renewalNo');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [columnFilters, setColumnFilters] = useState({
    renewalNo: '',
    contract: '',
    newStartDate: '',
    newEndDate: '',
    proposedRate: '',
    renewalType: 'All',
    status: 'All',
    customerResponseDate: '',
  });
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

  const fetchContractsAndLessees = useCallback(async () => {
    try {
      const [contractsRes, lesseesRes] = await Promise.all([
        fetch('/api/leasing/contracts-v2'),
        fetch('/api/leasing/lessees'),
      ]);
      if (contractsRes.ok) {
        const data = await contractsRes.json();
        setContracts(Array.isArray(data) ? data : []);
      }
      if (lesseesRes.ok) {
        const data = await lesseesRes.json();
        setLessees(Array.isArray(data) ? data : data.lessees ?? []);
      }
    } catch (error) {
      console.error('Failed to fetch contracts / lessees:', error);
    }
  }, []);

  useEffect(() => {
    fetchRenewals();
    fetchContractsAndLessees();
  }, [fetchRenewals, fetchContractsAndLessees]);

  const displayedRenewals = useMemo(() => {
    const filtered = renewals.filter((renewal) => {
      const contractLabel = renewal.originalContract?.contractNumber || renewal.originalContractId;
      const statusMatch = statusFilter === 'All' || renewal.status === statusFilter;
      const renewalNoMatch = !columnFilters.renewalNo || renewal.renewalNo.toLowerCase().includes(columnFilters.renewalNo.toLowerCase());
      const contractMatch = !columnFilters.contract || contractLabel.toLowerCase().includes(columnFilters.contract.toLowerCase());
      const startMatch = !columnFilters.newStartDate || renewal.newStartDate.includes(columnFilters.newStartDate);
      const endMatch = !columnFilters.newEndDate || renewal.newEndDate.includes(columnFilters.newEndDate);
      const rateMatch = !columnFilters.proposedRate || String(renewal.proposedRate).includes(columnFilters.proposedRate);
      const typeMatch = columnFilters.renewalType === 'All' || renewal.renewalType === columnFilters.renewalType;
      const inlineStatusMatch = columnFilters.status === 'All' || renewal.status === columnFilters.status;
      const responseMatch = !columnFilters.customerResponseDate || (renewal.customerResponseDate ?? '').includes(columnFilters.customerResponseDate);
      return statusMatch && renewalNoMatch && contractMatch && startMatch && endMatch && rateMatch && typeMatch && inlineStatusMatch && responseMatch;
    });

    filtered.sort((left, right) => {
      const leftContract = left.originalContract?.contractNumber || left.originalContractId;
      const rightContract = right.originalContract?.contractNumber || right.originalContractId;
      const leftValue = ({
        renewalNo: left.renewalNo,
        contract: leftContract,
        newStartDate: left.newStartDate,
        newEndDate: left.newEndDate,
        proposedRate: left.proposedRate,
        renewalType: left.renewalType,
        status: left.status,
        customerResponseDate: left.customerResponseDate ?? '',
      })[sortKey];
      const rightValue = ({
        renewalNo: right.renewalNo,
        contract: rightContract,
        newStartDate: right.newStartDate,
        newEndDate: right.newEndDate,
        proposedRate: right.proposedRate,
        renewalType: right.renewalType,
        status: right.status,
        customerResponseDate: right.customerResponseDate ?? '',
      })[sortKey];

      const comparison =
        typeof leftValue === 'number' && typeof rightValue === 'number'
          ? leftValue - rightValue
          : String(leftValue).localeCompare(String(rightValue));

      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [columnFilters, renewals, sortDirection, sortKey, statusFilter]);

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDirection('asc');
  };

  const filteredContracts = selectedLesseeId
    ? contracts.filter((contract) => contract.lesseeId === selectedLesseeId)
    : contracts;

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
        setSelectedLesseeId('');
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

  useEffect(() => {
    if (formData.originalContractId && !filteredContracts.some((contract) => contract.id === formData.originalContractId)) {
      setFormData((prev) => ({ ...prev, originalContractId: '' }));
    }
  }, [filteredContracts, formData.originalContractId]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PROPOSED':
        return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
      case 'SENT_TO_CUSTOMER':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'ACCEPTED':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      case 'REJECTED':
        return 'bg-rose-500/20 text-rose-400 border-rose-500/30';
      case 'EXPIRED':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      default:
        return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
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
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <PageHeader
        title="Renewals"
        subtitle="Manage contract renewals and extensions"
        accent="blue"
        actions={(
          <button
            onClick={() => setShowModal(true)}
            className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3 text-sm font-medium text-white hover:opacity-90 transition-all"
          >
            + Propose Renewal
          </button>
        )}
      />

      {/* Status Pipeline */}
      <KpiGrid>
        <KpiCard label="Proposed" value={statusCounts.PROPOSED} accent="slate" icon={Clock3} sub="Draft offers" />
        <KpiCard label="Sent to Customer" value={statusCounts.SENT_TO_CUSTOMER} accent="blue" icon={Send} sub="Awaiting reply" />
        <KpiCard label="Accepted" value={statusCounts.ACCEPTED} accent="emerald" icon={BadgeCheck} sub="Ready to execute" />
        <KpiCard label="Rejected" value={statusCounts.REJECTED} accent="rose" icon={XCircle} sub="Declined offers" />
        <KpiCard label="Expired" value={statusCounts.EXPIRED} accent="amber" icon={TimerReset} sub="Response window closed" />
      </KpiGrid>

      {/* Filter Bar */}
      <div className="flex gap-4 flex-wrap">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2 rounded-lg bg-slate-800/50 border border-white/10 text-white focus:border-blue-500 focus:outline-none transition-all"
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
      <div className="smart-data-grid-surface p-6 backdrop-blur-sm">
        <table className="w-full">
          <SmartDataGridHeader
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSort={(key) => toggleSort(key as typeof sortKey)}
            columnResizeStorageKey="leasing-renewals-column-widths"
            columns={[
              {
                key: 'renewalNo',
                label: 'Renewal No',
                sortable: true,
                filter: <input value={columnFilters.renewalNo} onChange={(e) => setColumnFilters((prev) => ({ ...prev, renewalNo: e.target.value }))} placeholder="Search..." className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none" />,
              },
              {
                key: 'contract',
                label: 'Original Contract',
                sortable: true,
                filter: <input value={columnFilters.contract} onChange={(e) => setColumnFilters((prev) => ({ ...prev, contract: e.target.value }))} placeholder="Search..." className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none" />,
              },
              {
                key: 'newStartDate',
                label: 'New Start',
                sortable: true,
                filter: <input value={columnFilters.newStartDate} onChange={(e) => setColumnFilters((prev) => ({ ...prev, newStartDate: e.target.value }))} placeholder="YYYY-MM-DD" className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none" />,
              },
              {
                key: 'newEndDate',
                label: 'New End',
                sortable: true,
                filter: <input value={columnFilters.newEndDate} onChange={(e) => setColumnFilters((prev) => ({ ...prev, newEndDate: e.target.value }))} placeholder="YYYY-MM-DD" className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none" />,
              },
              {
                key: 'proposedRate',
                label: 'Proposed Rate',
                sortable: true,
                filter: <input value={columnFilters.proposedRate} onChange={(e) => setColumnFilters((prev) => ({ ...prev, proposedRate: e.target.value }))} placeholder="Amount..." className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none" />,
              },
              {
                key: 'renewalType',
                label: 'Renewal Type',
                sortable: true,
                filter: <select value={columnFilters.renewalType} onChange={(e) => setColumnFilters((prev) => ({ ...prev, renewalType: e.target.value }))} className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-white focus:border-blue-500 focus:outline-none"><option>All</option><option>SAME_TERMS</option><option>REVISED_TERMS</option><option>UPGRADE</option><option>DOWNGRADE</option></select>,
              },
              {
                key: 'status',
                label: 'Status',
                sortable: true,
                filter: <select value={columnFilters.status} onChange={(e) => setColumnFilters((prev) => ({ ...prev, status: e.target.value }))} className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-white focus:border-blue-500 focus:outline-none"><option>All</option><option>PROPOSED</option><option>SENT_TO_CUSTOMER</option><option>ACCEPTED</option><option>REJECTED</option><option>EXPIRED</option></select>,
              },
              {
                key: 'customerResponseDate',
                label: 'Customer Response Date',
                sortable: true,
                filter: <input value={columnFilters.customerResponseDate} onChange={(e) => setColumnFilters((prev) => ({ ...prev, customerResponseDate: e.target.value }))} placeholder="YYYY-MM-DD" className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none" />,
              },
            ]}
            actionHeader="Actions"
          />
          <tbody>
            {displayedRenewals.map((renewal) => (
              <tr key={renewal.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                <td className="px-6 py-4 text-sm font-medium text-white">{renewal.renewalNo}</td>
                <td className="px-6 py-4 text-sm text-white">{renewal.originalContract?.contractNumber || renewal.originalContractId}</td>
                <td className="px-6 py-4 text-sm text-slate-200">{renewal.newStartDate}</td>
                <td className="px-6 py-4 text-sm text-slate-200">{renewal.newEndDate}</td>
                <td className="px-6 py-4 text-sm font-medium text-white">AED {renewal.proposedRate.toLocaleString()}</td>
                <td className="px-6 py-4 text-sm text-white">{renewal.renewalType}</td>
                <td className="px-6 py-4 text-sm">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(renewal.status)}`}>
                    {renewal.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-slate-200">
                  {renewal.customerResponseDate || '-'}
                </td>
                <td className="px-6 py-4 text-sm">
                  <RowActionMenu
                    actions={[
                      ...(renewal.status === 'PROPOSED'
                        ? [
                            {
                              label: 'Send to customer',
                              onSelect: () => handleStatusChange(renewal.id, 'SENT_TO_CUSTOMER'),
                            },
                          ]
                        : []),
                      ...(renewal.status === 'SENT_TO_CUSTOMER'
                        ? [
                            {
                              label: 'Accept',
                              onSelect: () => handleStatusChange(renewal.id, 'ACCEPTED'),
                            },
                            {
                              label: 'Reject',
                              onSelect: () => handleStatusChange(renewal.id, 'REJECTED'),
                              tone: 'danger' as const,
                            },
                          ]
                        : []),
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Propose Renewal Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-800/95 border border-white/10 rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">Propose Renewal</h2>
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
                  <label className="block text-sm font-medium text-slate-300 mb-2">Customer / Lessee</label>
                  <select
                    value={selectedLesseeId}
                    onChange={(e) => setSelectedLesseeId(e.target.value)}
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">All lessees</option>
                    {lessees.map((lessee) => (
                      <option key={lessee.id} value={lessee.id}>
                        {lessee.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Original Contract</label>
                  <select
                    name="originalContractId"
                    value={formData.originalContractId}
                    onChange={handleInputChange}
                    required
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">Select a contract</option>
                    {filteredContracts.map((contract) => (
                      <option key={contract.id} value={contract.id}>
                        {contract.contractNumber} - {contract.lessee}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Renewal Type</label>
                  <select
                    name="renewalType"
                    value={formData.renewalType}
                    onChange={handleInputChange}
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-blue-500 focus:outline-none"
                  >
                    <option>SAME_TERMS</option>
                    <option>REVISED_TERMS</option>
                    <option>UPGRADE</option>
                    <option>DOWNGRADE</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Proposed Start Date</label>
                  <input
                    type="date"
                    name="proposedStartDate"
                    value={formData.proposedStartDate}
                    onChange={handleInputChange}
                    required
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Proposed End Date</label>
                  <input
                    type="date"
                    name="proposedEndDate"
                    value={formData.proposedEndDate}
                    onChange={handleInputChange}
                    required
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Proposed Monthly Rate</label>
                  <input
                    type="number"
                    name="proposedMonthlyRate"
                    value={formData.proposedMonthlyRate}
                    onChange={handleInputChange}
                    required
                    placeholder="6500"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Initiated By</label>
                  <input
                    type="text"
                    name="initiatedBy"
                    value={formData.initiatedBy}
                    onChange={handleInputChange}
                    required
                    placeholder="John Doe"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Notes</label>
                <textarea
                  name="notes"
                  value={formData.notes}
                  onChange={handleInputChange}
                  placeholder="Additional notes..."
                  rows={3}
                  className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 rounded-lg bg-blue-600 text-white font-medium py-2 hover:bg-blue-700 transition-colors"
                >
                  Propose Renewal
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
