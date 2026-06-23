'use client';

import Link from 'next/link';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowRight, ShieldCheck, FileWarning, Banknote } from 'lucide-react';
import { KpiCard, KpiGrid, PageHeader } from '@/components/ui/page-theme';
import SmartDataGridHeader from '@/components/ui/SmartDataGridHeader';

interface Claim {
  id: string;
  claimType: 'ACCIDENT' | 'THEFT' | 'FIRE' | 'NATURAL' | 'OTHER';
  claimDate: string;
  incidentDate: string;
  description: string;
  claimAmount: number;
  deductible: number;
}

interface InsurancePolicy {
  id: string;
  policyNo: string;
  contract: string;
  insurer: string;
  coverageType: 'COMPREHENSIVE' | 'THIRD_PARTY' | 'FLEET' | 'TPL';
  premium: number;
  startDate: string;
  expiryDate: string;
  daysToExpiry: number;
  status: 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED' | 'CANCELLED';
  renewalReminderDays: number;
  deductible: number;
  contractId: string;
  notes: string;
  claims: Claim[];
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

type InsuranceSortKey =
  | 'policyNo'
  | 'lessee'
  | 'contract'
  | 'insurer'
  | 'coverageType'
  | 'premium'
  | 'expiryDate'
  | 'daysToExpiry'
  | 'claims'
  | 'status';

type InsuranceColumnFilters = {
  policyNo: string;
  lessee: string;
  contract: string;
  insurer: string;
  coverageType: string;
  premium: string;
  expiryDate: string;
  daysToExpiry: string;
  claims: string;
  status: string;
};

const getStatusBadgeColor = (status: string) => {
  switch (status) {
    case 'ACTIVE':
      return 'bg-emerald-900/30 text-emerald-200 border-emerald-700';
    case 'EXPIRING_SOON':
      return 'bg-orange-900/30 text-orange-200 border-orange-700';
    case 'EXPIRED':
      return 'bg-red-900/30 text-red-200 border-red-700';
    case 'CANCELLED':
      return 'bg-slate-700/30 text-slate-300 border-slate-600';
    default:
      return 'bg-slate-700/30 text-slate-300 border-slate-600';
  }
};

const getExpiryColor = (days: number) => {
  if (days < 0) return 'text-red-400';
  if (days <= 30) return 'text-orange-400';
  if (days <= 60) return 'text-amber-400';
  return 'text-emerald-400';
};

export default function InsurancePage() {
  const [policies, setPolicies] = useState<InsurancePolicy[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [lessees, setLessees] = useState<Lessee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [selectedLesseeId, setSelectedLesseeId] = useState('');
  const [selectedContractId, setSelectedContractId] = useState('');
  const [sortKey, setSortKey] = useState<InsuranceSortKey>('expiryDate');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [columnFilters, setColumnFilters] = useState<InsuranceColumnFilters>({
    policyNo: '',
    lessee: '',
    contract: '',
    insurer: '',
    coverageType: '',
    premium: '',
    expiryDate: '',
    daysToExpiry: '',
    claims: '',
    status: '',
  });

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [policiesRes, contractsRes, lesseesRes] = await Promise.all([
        fetch('/api/leasing/insurance'),
        fetch('/api/leasing/contracts-v2'),
        fetch('/api/leasing/lessees'),
      ]);

      if (!policiesRes.ok) throw new Error('Failed to fetch lease insurance status');
      const policiesData = await policiesRes.json();
      setPolicies(Array.isArray(policiesData) ? policiesData : []);

      if (contractsRes.ok) {
        const contractsData = await contractsRes.json();
        setContracts(Array.isArray(contractsData) ? contractsData : []);
      }

      if (lesseesRes.ok) {
        const lesseesData = await lesseesRes.json();
        setLessees(Array.isArray(lesseesData) ? lesseesData : lesseesData.lessees ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error fetching insurance status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const contractById = useMemo(
    () => new Map(contracts.map((contract) => [contract.id, contract])),
    [contracts],
  );

  const lesseeContracts = selectedLesseeId
    ? contracts.filter((contract) => contract.lesseeId === selectedLesseeId)
    : contracts;

  useEffect(() => {
    if (selectedContractId && !lesseeContracts.some((contract) => contract.id === selectedContractId)) {
      setSelectedContractId('');
    }
  }, [lesseeContracts, selectedContractId]);

  const filteredPolicies = useMemo(() => {
    const normalizedPolicyNo = columnFilters.policyNo.trim().toLowerCase();
    const normalizedLessee = columnFilters.lessee.trim().toLowerCase();
    const normalizedContract = columnFilters.contract.trim().toLowerCase();
    const normalizedInsurer = columnFilters.insurer.trim().toLowerCase();
    const normalizedPremium = columnFilters.premium.trim().toLowerCase();
    const normalizedExpiryDate = columnFilters.expiryDate.trim().toLowerCase();
    const normalizedDaysToExpiry = columnFilters.daysToExpiry.trim().toLowerCase();
    const normalizedClaims = columnFilters.claims.trim().toLowerCase();

    const visiblePolicies = policies.filter((policy) => {
      if (statusFilter !== 'All' && policy.status !== statusFilter) return false;
      const linkedContract = contractById.get(policy.contractId);
      const lesseeName = linkedContract?.lessee ?? '';

      if (selectedLesseeId && linkedContract?.lesseeId !== selectedLesseeId) return false;
      if (selectedContractId && policy.contractId !== selectedContractId) return false;
      if (normalizedPolicyNo && !policy.policyNo.toLowerCase().includes(normalizedPolicyNo)) return false;
      if (normalizedLessee && !lesseeName.toLowerCase().includes(normalizedLessee)) return false;
      if (normalizedContract && !policy.contract.toLowerCase().includes(normalizedContract)) return false;
      if (normalizedInsurer && !policy.insurer.toLowerCase().includes(normalizedInsurer)) return false;
      if (columnFilters.coverageType && policy.coverageType !== columnFilters.coverageType) return false;
      if (normalizedPremium && !String(policy.premium).includes(normalizedPremium)) return false;
      if (normalizedExpiryDate && !policy.expiryDate.toLowerCase().includes(normalizedExpiryDate)) return false;
      if (normalizedDaysToExpiry && !String(policy.daysToExpiry).includes(normalizedDaysToExpiry)) return false;
      if (normalizedClaims && !String(policy.claims.length).includes(normalizedClaims)) return false;
      if (columnFilters.status && policy.status !== columnFilters.status) return false;
      return true;
    });

    return [...visiblePolicies].sort((left, right) => {
      const leftContract = contractById.get(left.contractId);
      const rightContract = contractById.get(right.contractId);

      const leftValue: Record<InsuranceSortKey, string | number> = {
        policyNo: left.policyNo,
        lessee: leftContract?.lessee ?? '',
        contract: left.contract,
        insurer: left.insurer,
        coverageType: left.coverageType,
        premium: left.premium,
        expiryDate: left.expiryDate,
        daysToExpiry: left.daysToExpiry,
        claims: left.claims.length,
        status: left.status,
      };
      const rightValue: Record<InsuranceSortKey, string | number> = {
        policyNo: right.policyNo,
        lessee: rightContract?.lessee ?? '',
        contract: right.contract,
        insurer: right.insurer,
        coverageType: right.coverageType,
        premium: right.premium,
        expiryDate: right.expiryDate,
        daysToExpiry: right.daysToExpiry,
        claims: right.claims.length,
        status: right.status,
      };

      const a = leftValue[sortKey];
      const b = rightValue[sortKey];
      const comparison =
        typeof a === 'number' && typeof b === 'number'
          ? a - b
          : String(a).localeCompare(String(b));

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [columnFilters, contractById, policies, selectedContractId, selectedLesseeId, sortDirection, sortKey, statusFilter]);

  const expiringSoonCount = filteredPolicies.filter(
    (policy) => policy.daysToExpiry <= 30 && policy.status !== 'EXPIRED' && policy.status !== 'CANCELLED',
  ).length;
  const activeCount = filteredPolicies.filter((policy) => policy.status === 'ACTIVE').length;
  const totalClaims = filteredPolicies.reduce((sum, policy) => sum + policy.claims.length, 0);
  const totalPremium = filteredPolicies.reduce((sum, policy) => sum + policy.premium, 0);

  const updateColumnFilter = (key: keyof InsuranceColumnFilters, value: string) => {
    setColumnFilters((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="min-h-screen bg-[#0c1a3e] p-6 text-slate-100">
      <div className="mx-auto max-w-7xl space-y-6">
        <PageHeader
          title="Lease Insurance Status"
          subtitle="Lease-scoped insurance visibility for active contracts, lessees, expiries, and claim impact."
          accent="blue"
          actions={(
            <Link
              href="/fleet/insurance"
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
            >
              Open Fleet Insurance <ArrowRight size={16} />
            </Link>
          )}
        />

        {expiringSoonCount > 0 && (
          <div className="flex items-start gap-3 rounded-lg border border-orange-700 bg-orange-900/30 p-4">
            <AlertCircle className="mt-0.5 text-orange-400" size={20} />
            <div>
              <p className="font-semibold text-orange-200">Expiring lease-linked policies</p>
              <p className="text-sm text-orange-300">
                {expiringSoonCount} {expiringSoonCount === 1 ? 'policy is' : 'policies are'} expiring within 30 days.
                Coordinate renewal from Fleet Insurance.
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-700 bg-red-900/30 p-4">
            <p className="text-red-200">{error}</p>
          </div>
        )}

        <KpiGrid>
          <KpiCard label="Visible Policies" value={filteredPolicies.length} accent="slate" icon={ShieldCheck} sub="Lease-linked view" />
          <KpiCard label="Active" value={activeCount} accent="emerald" icon={ShieldCheck} sub="Currently covered" />
          <KpiCard label="Claims" value={totalClaims} accent="amber" icon={FileWarning} sub="Across selected policies" />
          <KpiCard label="Premium Value" value={`AED ${totalPremium.toLocaleString()}`} accent="blue" icon={Banknote} sub={`${expiringSoonCount} expiring soon`} />
        </KpiGrid>

        <div className="flex flex-wrap gap-3 rounded-2xl border border-white/5 bg-slate-800/40 p-4">
          <select
            value={selectedLesseeId}
            onChange={(e) => setSelectedLesseeId(e.target.value)}
            className="min-w-[220px] rounded-xl border border-white/10 bg-slate-800 px-4 py-2.5 text-sm text-white focus:border-blue-500/50 focus:outline-none"
          >
            <option value="">All lessees</option>
            {lessees.map((lessee) => (
              <option key={lessee.id} value={lessee.id}>
                {lessee.name}
              </option>
            ))}
          </select>
          <select
            value={selectedContractId}
            onChange={(e) => setSelectedContractId(e.target.value)}
            className="min-w-[220px] rounded-xl border border-white/10 bg-slate-800 px-4 py-2.5 text-sm text-white focus:border-blue-500/50 focus:outline-none"
          >
            <option value="">All contracts</option>
            {lesseeContracts.map((contract) => (
              <option key={contract.id} value={contract.id}>
                {contract.contractNumber ?? contract.id.slice(0, 8)}
                {contract.lessee ? ` - ${contract.lessee}` : ''}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-2">
            {['All', 'ACTIVE', 'EXPIRING_SOON', 'EXPIRED', 'CANCELLED'].map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`rounded-lg px-4 py-2 text-sm transition ${
                  statusFilter === status
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center text-slate-400">Loading lease insurance status...</div>
        ) : (
          <div className="smart-data-grid-surface">
            <table className="w-full text-sm">
              <SmartDataGridHeader
                sortKey={sortKey}
                sortDirection={sortDirection}
                onSort={(key) => {
                  const nextKey = key as InsuranceSortKey;
                  if (sortKey === nextKey) {
                    setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
                    return;
                  }
                  setSortKey(nextKey);
                  setSortDirection('asc');
                }}
                columnResizeStorageKey="leasing-insurance-column-widths"
                columns={[
                  {
                    key: 'policyNo',
                    label: 'Policy No',
                    sortable: true,
                    filter: (
                      <input
                        value={columnFilters.policyNo}
                        onChange={(e) => updateColumnFilter('policyNo', e.target.value)}
                        placeholder="Search..."
                        className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                      />
                    ),
                  },
                  {
                    key: 'lessee',
                    label: 'Customer / Lessee',
                    sortable: true,
                    filter: (
                      <input
                        value={columnFilters.lessee}
                        onChange={(e) => updateColumnFilter('lessee', e.target.value)}
                        placeholder="Search..."
                        className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                      />
                    ),
                  },
                  {
                    key: 'contract',
                    label: 'Contract',
                    sortable: true,
                    filter: (
                      <input
                        value={columnFilters.contract}
                        onChange={(e) => updateColumnFilter('contract', e.target.value)}
                        placeholder="Search..."
                        className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                      />
                    ),
                  },
                  {
                    key: 'insurer',
                    label: 'Insurer',
                    sortable: true,
                    filter: (
                      <input
                        value={columnFilters.insurer}
                        onChange={(e) => updateColumnFilter('insurer', e.target.value)}
                        placeholder="Search..."
                        className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                      />
                    ),
                  },
                  {
                    key: 'coverageType',
                    label: 'Coverage',
                    sortable: true,
                    filter: (
                      <select
                        value={columnFilters.coverageType}
                        onChange={(e) => updateColumnFilter('coverageType', e.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                      >
                        <option value="">All</option>
                        <option value="COMPREHENSIVE">Comprehensive</option>
                        <option value="THIRD_PARTY">Third Party</option>
                        <option value="FLEET">Fleet</option>
                        <option value="TPL">TPL</option>
                      </select>
                    ),
                  },
                  {
                    key: 'premium',
                    label: 'Premium',
                    sortable: true,
                    headerClassName: 'text-right',
                    filterClassName: 'text-right',
                    filter: (
                      <input
                        value={columnFilters.premium}
                        onChange={(e) => updateColumnFilter('premium', e.target.value)}
                        placeholder="AED..."
                        className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-right text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                      />
                    ),
                  },
                  {
                    key: 'expiryDate',
                    label: 'Expiry',
                    sortable: true,
                    filter: (
                      <input
                        value={columnFilters.expiryDate}
                        onChange={(e) => updateColumnFilter('expiryDate', e.target.value)}
                        placeholder="YYYY-MM-DD"
                        className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                      />
                    ),
                  },
                  {
                    key: 'daysToExpiry',
                    label: 'Days',
                    sortable: true,
                    headerClassName: 'text-center',
                    filterClassName: 'text-center',
                    filter: (
                      <input
                        value={columnFilters.daysToExpiry}
                        onChange={(e) => updateColumnFilter('daysToExpiry', e.target.value)}
                        placeholder="Days..."
                        className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-center text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                      />
                    ),
                  },
                  {
                    key: 'claims',
                    label: 'Claims',
                    sortable: true,
                    headerClassName: 'text-center',
                    filterClassName: 'text-center',
                    filter: (
                      <input
                        value={columnFilters.claims}
                        onChange={(e) => updateColumnFilter('claims', e.target.value)}
                        placeholder="Count..."
                        className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-center text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                      />
                    ),
                  },
                  {
                    key: 'status',
                    label: 'Status',
                    sortable: true,
                    filter: (
                      <select
                        value={columnFilters.status}
                        onChange={(e) => updateColumnFilter('status', e.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                      >
                        <option value="">All</option>
                        <option value="ACTIVE">Active</option>
                        <option value="EXPIRING_SOON">Expiring Soon</option>
                        <option value="EXPIRED">Expired</option>
                        <option value="CANCELLED">Cancelled</option>
                      </select>
                    ),
                  },
                ]}
                actionHeader="Action"
              />
              <tbody>
                {filteredPolicies.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-12 text-center text-slate-500">
                      No lease-linked insurance policies found for the selected filters.
                    </td>
                  </tr>
                ) : (
                  filteredPolicies.map((policy) => {
                    const linkedContract = contractById.get(policy.contractId);
                    return (
                      <tr key={policy.id} className="border-b border-slate-700 hover:bg-slate-750">
                        <td className="px-4 py-3">{policy.policyNo}</td>
                        <td className="px-4 py-3">{linkedContract?.lessee ?? '-'}</td>
                        <td className="px-4 py-3">{policy.contract}</td>
                        <td className="px-4 py-3">{policy.insurer}</td>
                        <td className="px-4 py-3">{policy.coverageType}</td>
                        <td className="px-4 py-3 text-right">{policy.premium.toFixed(2)} AED</td>
                        <td className="px-4 py-3 text-sm">{policy.expiryDate}</td>
                        <td className={`px-4 py-3 text-center font-semibold ${getExpiryColor(policy.daysToExpiry)}`}>
                          {policy.daysToExpiry}
                        </td>
                        <td className="px-4 py-3 text-center">{policy.claims.length}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded border px-2 py-1 text-xs ${getStatusBadgeColor(policy.status)}`}>
                            {policy.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            href="/fleet/insurance"
                            className="text-sm text-blue-300 transition hover:text-blue-200"
                          >
                            Manage in Fleet
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
