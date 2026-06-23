'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { AlertTriangle, BadgeCheck, ShieldX, Users } from 'lucide-react';
import { KpiCard, KpiGrid, PageHeader } from '@/components/ui/page-theme';

interface ActiveLeaseContract {
  id: string;
  contractNumber?: string | null;
  lesseeId?: string | null;
  lessee?: string | null;
}

interface Driver {
  id: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  contactNumber: string | null;
  nationality: string | null;
  licenseNumber: string | null;
  licenseExpiry: string | null;
  licenseType: string | null;
  emiratesId: string | null;
  emiratesIdExpiry: string | null;
  visaExpiry: string | null;
  status: string | null;
  driverType: string | null;
  activeAllocations: number;
  totalAllocations: number;
  activeContracts?: ActiveLeaseContract[];
  licenseExpiryStatus: 'OK' | 'EXPIRING_SOON' | 'EXPIRED' | null;
  emiratesIdExpiryStatus: 'OK' | 'EXPIRING_SOON' | 'EXPIRED' | null;
  visaExpiryStatus: 'OK' | 'EXPIRING_SOON' | 'EXPIRED' | null;
}

interface Lessee {
  id: string;
  name: string;
}

const EXPIRY_PILL: Record<string, string> = {
  EXPIRED: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  EXPIRING_SOON: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  OK: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
};

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-GB') : '-');
const displayName = (driver: Driver) =>
  driver.name ?? ([driver.firstName, driver.lastName].filter(Boolean).join(' ') || '-');

export default function LeasingDriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [lessees, setLessees] = useState<Lessee[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLesseeId, setSelectedLesseeId] = useState('');
  const [selectedContractId, setSelectedContractId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [driversRes, lesseesRes] = await Promise.all([
        fetch('/api/leasing/drivers'),
        fetch('/api/leasing/lessees'),
      ]);
      const driversData = driversRes.ok ? await driversRes.json() : [];
      const lesseesData = lesseesRes.ok ? await lesseesRes.json() : [];
      setDrivers(Array.isArray(driversData) ? driversData : []);
      setLessees(Array.isArray(lesseesData) ? lesseesData : lesseesData.lessees ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const contractOptions = useMemo(() => {
    const unique = new Map<string, ActiveLeaseContract>();
    for (const driver of drivers) {
      for (const contract of driver.activeContracts ?? []) {
        if (!unique.has(contract.id)) unique.set(contract.id, contract);
      }
    }
    const allContracts = [...unique.values()];
    return selectedLesseeId
      ? allContracts.filter((contract) => contract.lesseeId === selectedLesseeId)
      : allContracts;
  }, [drivers, selectedLesseeId]);

  useEffect(() => {
    if (selectedContractId && !contractOptions.some((contract) => contract.id === selectedContractId)) {
      setSelectedContractId('');
    }
  }, [contractOptions, selectedContractId]);

  const filteredDrivers = useMemo(() => drivers.filter((driver) => {
    const contracts = driver.activeContracts ?? [];
    if (selectedLesseeId && !contracts.some((contract) => contract.lesseeId === selectedLesseeId)) return false;
    if (selectedContractId && !contracts.some((contract) => contract.id === selectedContractId)) return false;
    return true;
  }), [drivers, selectedContractId, selectedLesseeId]);

  const stats = useMemo(() => ({
    total: filteredDrivers.length,
    activeAllocs: filteredDrivers.reduce((sum, driver) => sum + driver.activeAllocations, 0),
    licenseExpiring: filteredDrivers.filter((driver) => driver.licenseExpiryStatus === 'EXPIRING_SOON').length,
    licenseExpired: filteredDrivers.filter((driver) => driver.licenseExpiryStatus === 'EXPIRED').length,
  }), [filteredDrivers]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Driver Assignment Status"
        subtitle="Lease-scoped view of assigned chauffeurs, contract allocations, and compliance alerts."
        accent="emerald"
        actions={(
          <Link
            href="/driver-mgmt"
            className="inline-flex items-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500"
          >
            Open Driver Master
          </Link>
        )}
      />

      <div className="flex flex-wrap gap-3 rounded-xl border border-white/10 bg-slate-800/40 p-4">
        <select
          value={selectedLesseeId}
          onChange={(e) => setSelectedLesseeId(e.target.value)}
          className="min-w-[220px] rounded-lg border border-white/10 bg-slate-900 px-4 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
        >
          <option value="">All lessees</option>
          {lessees.map((lessee) => (
            <option key={lessee.id} value={lessee.id}>{lessee.name}</option>
          ))}
        </select>
        <select
          value={selectedContractId}
          onChange={(e) => setSelectedContractId(e.target.value)}
          className="min-w-[220px] rounded-lg border border-white/10 bg-slate-900 px-4 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
        >
          <option value="">All contracts</option>
          {contractOptions.map((contract) => (
            <option key={contract.id} value={contract.id}>
              {contract.contractNumber ?? contract.id.slice(0, 8)}{contract.lessee ? ` - ${contract.lessee}` : ''}
            </option>
          ))}
        </select>
      </div>

      <KpiGrid>
        <KpiCard label="Assigned Drivers" value={stats.total} accent="slate" icon={Users} sub="Visible under filters" />
        <KpiCard label="Active Allocations" value={stats.activeAllocs} accent="emerald" icon={BadgeCheck} sub="Live contract links" />
        <KpiCard label="Licence Expiring" value={stats.licenseExpiring} accent="amber" icon={AlertTriangle} sub="Within 30 days" />
        <KpiCard label="Licence Expired" value={stats.licenseExpired} accent="rose" icon={ShieldX} sub="Needs renewal action" />
      </KpiGrid>

      {loading ? (
        <div className="text-slate-500">Loading...</div>
      ) : filteredDrivers.length === 0 ? (
        <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-8 text-center text-slate-400">
          No lease-assigned drivers found for the selected filters.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/60">
              <tr className="text-left text-xs text-slate-400">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Assigned Lease Contracts</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Licence</th>
                <th className="px-4 py-3">EID</th>
                <th className="px-4 py-3">Visa</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Allocations</th>
              </tr>
            </thead>
            <tbody>
              {filteredDrivers.map((driver) => (
                <tr key={driver.id} className="border-t border-white/5 hover:bg-white/5">
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">{displayName(driver)}</div>
                    <div className="text-[11px] text-slate-500">{driver.driverType ?? '-'} · {driver.nationality ?? '-'}</div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <div className="flex flex-wrap gap-2">
                      {(driver.activeContracts ?? []).map((contract) => (
                        <span key={contract.id} className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-200">
                          {contract.contractNumber ?? contract.id.slice(0, 8)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <div className="text-slate-200">{driver.contactNumber ?? '-'}</div>
                    <div className="text-slate-500">{driver.email ?? ''}</div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <div className="font-mono text-slate-200">{driver.licenseNumber ?? '-'}</div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="text-slate-500">{fmt(driver.licenseExpiry)}</span>
                      {driver.licenseExpiryStatus && (
                        <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${EXPIRY_PILL[driver.licenseExpiryStatus] ?? ''}`}>
                          {driver.licenseExpiryStatus}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <div className="text-slate-200">{fmt(driver.emiratesIdExpiry)}</div>
                    {driver.emiratesIdExpiryStatus && driver.emiratesIdExpiryStatus !== 'OK' && (
                      <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${EXPIRY_PILL[driver.emiratesIdExpiryStatus]}`}>
                        {driver.emiratesIdExpiryStatus}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <div className="text-slate-200">{fmt(driver.visaExpiry)}</div>
                    {driver.visaExpiryStatus && driver.visaExpiryStatus !== 'OK' && (
                      <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${EXPIRY_PILL[driver.visaExpiryStatus]}`}>
                        {driver.visaExpiryStatus}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full border px-2 py-0.5 text-xs ${driver.status === 'ACTIVE' ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-300' : 'border-slate-500/40 bg-slate-500/20 text-slate-400'}`}>
                      {driver.status ?? '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="font-medium text-white">{driver.activeAllocations} <span className="text-xs text-slate-500">active</span></div>
                    <div className="text-xs text-slate-500">{driver.totalAllocations} total</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-xl border border-white/5 bg-slate-800/30 p-5 text-sm text-slate-400">
        <p>
          To allocate or release a driver, open a contract from{' '}
          <Link href="/leasing/contracts-v2" className="text-emerald-400 hover:underline">Contracts</Link>.
          Driver master records, license updates, and lifecycle changes belong in{' '}
          <Link href="/driver-mgmt" className="text-emerald-400 hover:underline">Driver Management</Link>.
        </p>
      </div>
    </div>
  );
}
