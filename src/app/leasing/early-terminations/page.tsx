'use client';
import { contractToEarlyTermination, toDateInput } from '@/lib/autoFill';
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import RowActionMenu from '@/components/ui/RowActionMenu';
import SmartDataGridHeader from '@/components/ui/SmartDataGridHeader';

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

interface Contract {
  id: string;
  contractNumber: string;
  lessee: string;
  lesseeId?: string | null;
  startDate: string;
  endDate: string;
  monthlyRate: number;
  status: string;
}

interface Lessee {
  id: string;
  name: string;
}

interface FormData {
  lesseeId?: string;
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
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [lessees, setLessees] = useState<Lessee[]>([]);
  const [statusFilter, setStatusFilter] = useState('All');
  const [sortKey, setSortKey] = useState<'terminationNo' | 'contractId' | 'requestDate' | 'effectiveDate' | 'remainingMonths' | 'monthlyRate' | 'penaltyPct' | 'penaltyAmount' | 'outstandingPayments' | 'depositRefund' | 'settlementTotal' | 'status'>('terminationNo');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [columnFilters, setColumnFilters] = useState({
    terminationNo: '',
    contract: '',
    requestDate: '',
    effectiveDate: '',
    remainingMonths: '',
    monthlyRate: '',
    penaltyPct: '',
    penaltyAmount: '',
    outstandingPayments: '',
    depositRefund: '',
    settlementTotal: '',
    status: 'All',
  });
  const [selectedCalculatorLesseeId, setSelectedCalculatorLesseeId] = useState('');
  const [selectedFormLesseeId, setSelectedFormLesseeId] = useState('');
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

  const fetchContractsAndLessees = useCallback(async () => {
    try {
      const [contractsRes, lesseesRes] = await Promise.all([
        fetch('/api/leasing/contracts-v2'),
        fetch('/api/leasing/lessees'),
      ]);
      if (contractsRes.ok) {
        const contractsData = await contractsRes.json();
        setContracts(Array.isArray(contractsData) ? contractsData : []);
      }
      if (lesseesRes.ok) {
        const lesseesData = await lesseesRes.json();
        setLessees(Array.isArray(lesseesData) ? lesseesData : lesseesData.lessees ?? []);
      }
    } catch (error) {
      console.error('Failed to fetch contracts / lessees:', error);
    }
  }, []);

  useEffect(() => {
    fetchTerminations();
    fetchContractsAndLessees();
  }, [fetchTerminations, fetchContractsAndLessees]);

  const contractLabelById = useMemo(
    () => new Map(contracts.map((contract) => [contract.id, `${contract.contractNumber} - ${contract.lessee}`])),
    [contracts],
  );

  const displayedTerminations = useMemo(() => {
    const filtered = terminations.filter((term) => {
      const contractLabel = contractLabelById.get(term.contractId) ?? term.contractId;
      return (
        (statusFilter === 'All' || term.status === statusFilter) &&
        (!columnFilters.terminationNo || term.terminationNo.toLowerCase().includes(columnFilters.terminationNo.toLowerCase())) &&
        (!columnFilters.contract || contractLabel.toLowerCase().includes(columnFilters.contract.toLowerCase())) &&
        (!columnFilters.requestDate || term.requestDate.includes(columnFilters.requestDate)) &&
        (!columnFilters.effectiveDate || term.effectiveDate.includes(columnFilters.effectiveDate)) &&
        (!columnFilters.remainingMonths || String(term.remainingMonths).includes(columnFilters.remainingMonths)) &&
        (!columnFilters.monthlyRate || String(term.monthlyRate).includes(columnFilters.monthlyRate)) &&
        (!columnFilters.penaltyPct || String(term.penaltyPct).includes(columnFilters.penaltyPct)) &&
        (!columnFilters.penaltyAmount || String(term.penaltyAmount).includes(columnFilters.penaltyAmount)) &&
        (!columnFilters.outstandingPayments || String(term.outstandingPayments).includes(columnFilters.outstandingPayments)) &&
        (!columnFilters.depositRefund || String(term.depositRefund).includes(columnFilters.depositRefund)) &&
        (!columnFilters.settlementTotal || String(term.settlementTotal).includes(columnFilters.settlementTotal)) &&
        (columnFilters.status === 'All' || term.status === columnFilters.status)
      );
    });

    filtered.sort((left, right) => {
      const leftValue = ({
        terminationNo: left.terminationNo,
        contractId: contractLabelById.get(left.contractId) ?? left.contractId,
        requestDate: left.requestDate,
        effectiveDate: left.effectiveDate,
        remainingMonths: left.remainingMonths,
        monthlyRate: left.monthlyRate,
        penaltyPct: left.penaltyPct,
        penaltyAmount: left.penaltyAmount,
        outstandingPayments: left.outstandingPayments,
        depositRefund: left.depositRefund,
        settlementTotal: left.settlementTotal,
        status: left.status,
      })[sortKey];
      const rightValue = ({
        terminationNo: right.terminationNo,
        contractId: contractLabelById.get(right.contractId) ?? right.contractId,
        requestDate: right.requestDate,
        effectiveDate: right.effectiveDate,
        remainingMonths: right.remainingMonths,
        monthlyRate: right.monthlyRate,
        penaltyPct: right.penaltyPct,
        penaltyAmount: right.penaltyAmount,
        outstandingPayments: right.outstandingPayments,
        depositRefund: right.depositRefund,
        settlementTotal: right.settlementTotal,
        status: right.status,
      })[sortKey];
      const comparison =
        typeof leftValue === 'number' && typeof rightValue === 'number'
          ? leftValue - rightValue
          : String(leftValue).localeCompare(String(rightValue));
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [columnFilters, contractLabelById, sortDirection, sortKey, statusFilter, terminations]);

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDirection('asc');
  };

  const calculateTermination = useCallback((data: typeof calculatorData) => {
    const penaltyAmount = (data.monthlyRate * data.remainingMonths * data.penaltyPct) / 100;
    const totalSettlement = penaltyAmount + data.outstandingPayments - data.depositRefund;
    setCalculatedValues({
      penaltyAmount,
      totalSettlement,
    });
  }, []);

  const autofillTerminationFields = useCallback((contractId: string, target: 'calculator' | 'form') => {
    const contract = contracts.find((item) => item.id === contractId);
    if (!contract) return;
    const filled = contractToEarlyTermination({ ...contract, lesseeId: contract.lesseeId ?? undefined });
    if (target === 'calculator') {
      const next = {
        contractId,
        remainingMonths: filled.remainingMonths,
        monthlyRate: filled.monthlyRate,
        penaltyPct: filled.penaltyPct,
        outstandingPayments: calculatorData.outstandingPayments,
        depositRefund: calculatorData.depositRefund,
      };
      setCalculatorData(next);
      calculateTermination(next);
      return;
    }

    setFormData((prev) => ({
      ...prev,
      contractId,
      remainingMonths: filled.remainingMonths,
      monthlyRate: filled.monthlyRate,
      penaltyPct: filled.penaltyPct,
      effectiveDate: prev.effectiveDate || toDateInput(new Date().toISOString()),
    }));
  }, [calculateTermination, calculatorData.depositRefund, calculatorData.outstandingPayments, contracts]);

  const handleCalculatorChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'contractId') {
      const updatedData = {
        ...calculatorData,
        contractId: value,
      };
      setCalculatorData(updatedData);
      autofillTerminationFields(value, 'calculator');
      return;
    }
    const updatedData = {
      ...calculatorData,
      [name]: parseFloat(value) || 0,
    };
    setCalculatorData(updatedData);
    calculateTermination(updatedData);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'contractId') {
      setFormData((prev) => ({ ...prev, contractId: value }));
      autofillTerminationFields(value, 'form');
      return;
    }
    setFormData((prev) => ({
      ...prev,
      [name]: name === 'effectiveDate' ? value : parseFloat(value) || 0,
    }));
  };

  const calculatorContracts = selectedCalculatorLesseeId
    ? contracts.filter((contract) => contract.lesseeId === selectedCalculatorLesseeId)
    : contracts;

  const formContracts = selectedFormLesseeId
    ? contracts.filter((contract) => contract.lesseeId === selectedFormLesseeId)
    : contracts;

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
            <label className="block text-xs font-medium text-slate-400 mb-2">Customer / Lessee</label>
            <select
              value={selectedCalculatorLesseeId}
              onChange={(e) => {
                setSelectedCalculatorLesseeId(e.target.value);
                setCalculatorData((prev) => ({ ...prev, contractId: '' }));
              }}
              className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-blue-500 focus:outline-none text-sm"
            >
              <option value="">All lessees</option>
              {lessees.map((lessee) => (
                <option key={lessee.id} value={lessee.id}>{lessee.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">Contract</label>
            <select
              name="contractId"
              value={calculatorData.contractId}
              onChange={handleCalculatorChange}
              className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-blue-500 focus:outline-none text-sm"
            >
              <option value="">Select a contract</option>
              {calculatorContracts.map((contract) => (
                <option key={contract.id} value={contract.id}>
                  {contract.contractNumber} - {contract.lessee}
                </option>
              ))}
            </select>
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
      <div className="smart-data-grid-surface p-6 backdrop-blur-sm">
        <table className="w-full">
          <SmartDataGridHeader
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSort={(key) => toggleSort(key as typeof sortKey)}
            columnResizeStorageKey="leasing-early-terminations-column-widths"
            columns={[
              { key: 'terminationNo', label: 'Termination No', sortable: true, filter: <input value={columnFilters.terminationNo} onChange={(e) => setColumnFilters((prev) => ({ ...prev, terminationNo: e.target.value }))} placeholder="Search..." className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none" /> },
              { key: 'contractId', label: 'Contract', sortable: true, filter: <input value={columnFilters.contract} onChange={(e) => setColumnFilters((prev) => ({ ...prev, contract: e.target.value }))} placeholder="Search..." className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none" /> },
              { key: 'requestDate', label: 'Request Date', sortable: true, filter: <input value={columnFilters.requestDate} onChange={(e) => setColumnFilters((prev) => ({ ...prev, requestDate: e.target.value }))} placeholder="YYYY-MM-DD" className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none" /> },
              { key: 'effectiveDate', label: 'Effective Date', sortable: true, filter: <input value={columnFilters.effectiveDate} onChange={(e) => setColumnFilters((prev) => ({ ...prev, effectiveDate: e.target.value }))} placeholder="YYYY-MM-DD" className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none" /> },
              { key: 'remainingMonths', label: 'Remaining Months', sortable: true, filter: <input value={columnFilters.remainingMonths} onChange={(e) => setColumnFilters((prev) => ({ ...prev, remainingMonths: e.target.value }))} placeholder="e.g. 12" className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none" /> },
              { key: 'monthlyRate', label: 'Monthly Rate', sortable: true, filter: <input value={columnFilters.monthlyRate} onChange={(e) => setColumnFilters((prev) => ({ ...prev, monthlyRate: e.target.value }))} placeholder="Amount..." className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none" /> },
              { key: 'penaltyPct', label: 'Penalty %', sortable: true, filter: <input value={columnFilters.penaltyPct} onChange={(e) => setColumnFilters((prev) => ({ ...prev, penaltyPct: e.target.value }))} placeholder="%" className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none" /> },
              { key: 'penaltyAmount', label: 'Penalty Amount', sortable: true, filter: <input value={columnFilters.penaltyAmount} onChange={(e) => setColumnFilters((prev) => ({ ...prev, penaltyAmount: e.target.value }))} placeholder="Amount..." className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none" /> },
              { key: 'outstandingPayments', label: 'Outstanding', sortable: true, filter: <input value={columnFilters.outstandingPayments} onChange={(e) => setColumnFilters((prev) => ({ ...prev, outstandingPayments: e.target.value }))} placeholder="Amount..." className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none" /> },
              { key: 'depositRefund', label: 'Deposit Refund', sortable: true, filter: <input value={columnFilters.depositRefund} onChange={(e) => setColumnFilters((prev) => ({ ...prev, depositRefund: e.target.value }))} placeholder="Amount..." className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none" /> },
              { key: 'settlementTotal', label: 'Settlement Total', sortable: true, filter: <input value={columnFilters.settlementTotal} onChange={(e) => setColumnFilters((prev) => ({ ...prev, settlementTotal: e.target.value }))} placeholder="Amount..." className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none" /> },
              { key: 'status', label: 'Status', sortable: true, filter: <select value={columnFilters.status} onChange={(e) => setColumnFilters((prev) => ({ ...prev, status: e.target.value }))} className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-white focus:border-blue-500 focus:outline-none"><option>All</option><option>DRAFT</option><option>PENDING_APPROVAL</option><option>APPROVED</option><option>EXECUTED</option><option>CANCELLED</option></select> },
            ]}
            actionHeader="Actions"
          />
          <tbody>
            {displayedTerminations.map((term) => (
              <tr key={term.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                <td className="px-6 py-4 text-sm font-medium text-white">{term.terminationNo}</td>
                <td className="px-6 py-4 text-sm text-white">{contractLabelById.get(term.contractId) ?? term.contractId}</td>
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
                <td className="px-6 py-4 text-sm">
                  <RowActionMenu
                    actions={[
                      ...(term.status === 'DRAFT'
                        ? [
                            {
                              label: 'Submit',
                              onSelect: () => handleStatusChange(term.id, 'PENDING_APPROVAL'),
                            },
                          ]
                        : []),
                      ...(term.status === 'PENDING_APPROVAL'
                        ? [
                            {
                              label: 'Approve',
                              onSelect: () => handleStatusChange(term.id, 'APPROVED'),
                            },
                            {
                              label: 'Reject',
                              onSelect: () => handleStatusChange(term.id, 'CANCELLED'),
                              tone: 'danger' as const,
                            },
                          ]
                        : []),
                      ...(term.status === 'APPROVED'
                        ? [
                            {
                              label: 'Execute',
                              onSelect: () => handleStatusChange(term.id, 'EXECUTED'),
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
                  <label className="block text-sm font-medium text-slate-300 mb-2">Customer / Lessee</label>
                  <select
                    value={selectedFormLesseeId}
                    onChange={(e) => {
                      setSelectedFormLesseeId(e.target.value);
                      setFormData((prev) => ({ ...prev, contractId: '' }));
                    }}
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">All lessees</option>
                    {lessees.map((lessee) => (
                      <option key={lessee.id} value={lessee.id}>{lessee.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Contract</label>
                  <select
                    name="contractId"
                    value={formData.contractId}
                    onChange={handleInputChange}
                    required
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">Select a contract</option>
                    {formContracts.map((contract) => (
                      <option key={contract.id} value={contract.id}>
                        {contract.contractNumber} - {contract.lessee}
                      </option>
                    ))}
                  </select>
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
