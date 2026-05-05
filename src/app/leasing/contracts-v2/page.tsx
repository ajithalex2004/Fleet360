'use client';
import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { addMonths, quotationToContract } from '@/lib/autoFill';

interface Vehicle {
  id: string;
  type: string;
  make: string;
  model: string;
  licensePlate: string;
  driver: string;
  monthlyRate: number;
  status: string;
}

interface Contract {
  id: string;
  contractNumber: string;
  agreementType: 'MASTER' | 'INDIVIDUAL';
  lessee: string;
  leaseType: 'LONG_TERM' | 'SHORT_TERM' | 'DAILY' | 'MONTHLY';
  vehicleCount: number;
  durationMonths?: string | number;
  startDate: string;
  endDate: string;
  monthlyRate: number;
  totalValue?: number;
  insurance: boolean;
  maintenance: boolean;
  driver: boolean;
  status: 'Active' | 'Draft' | 'Pending Approval' | 'Expired' | 'Terminated';
  branch: string;
  vehicles?: Vehicle[];
}

interface NewContractForm {
  step: 1 | 2 | 3;
  lessee: string;
  agreementType: 'MASTER' | 'INDIVIDUAL';
  masterContractId: string;
  leaseType: 'LONG_TERM' | 'SHORT_TERM' | 'DAILY' | 'MONTHLY';
  durationMonths: string;
  startDate: string;
  endDate: string;
  monthlyRate: string;
  currency: string;
  securityDeposit: string;
  mileageCap: string;
  branch: string;
  vehicles: Vehicle[];
  insuranceIncluded: boolean;
  maintenanceIncluded: boolean;
  driverIncluded: boolean;
  notes: string;
  quotationId?: string;
}

function ContractParamsReader({ onFromQuotation }: { onFromQuotation: (id: string) => void }) {
  const sp = useSearchParams();
  useEffect(() => {
    const q = sp.get('fromQuotation');
    if (q) { onFromQuotation(q); window.history.replaceState(null, '', '/leasing/contracts-v2'); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

const MOCK_CONTRACTS: Contract[] = [
  {
    id: '1', contractNumber: 'LC-V2-001', agreementType: 'MASTER',
    lessee: 'Global Logistics LLC', leaseType: 'LONG_TERM',
    vehicleCount: 3, startDate: '2024-01-15', endDate: '2027-01-15',
    monthlyRate: 15000, insurance: true, maintenance: true, driver: false,
    status: 'Active', branch: 'Dubai HQ',
    vehicles: [
      { id: 'v1', type: 'Van', make: 'Mercedes', model: 'Sprinter', licensePlate: 'DXB-001', driver: 'Ahmed', monthlyRate: 5000, status: 'Active' },
      { id: 'v2', type: 'SUV', make: 'BMW', model: 'X5', licensePlate: 'DXB-002', driver: 'Fatima', monthlyRate: 5500, status: 'Active' },
      { id: 'v3', type: 'Sedan', make: 'Toyota', model: 'Camry', licensePlate: 'DXB-003', driver: 'Mohammed', monthlyRate: 4500, status: 'Active' },
    ],
  },
  {
    id: '2', contractNumber: 'LC-V2-002', agreementType: 'INDIVIDUAL',
    lessee: 'Ahmed Al-Mansouri', leaseType: 'SHORT_TERM',
    vehicleCount: 1, startDate: '2024-06-01', endDate: '2024-12-01',
    monthlyRate: 3500, insurance: true, maintenance: false, driver: false,
    status: 'Active', branch: 'Abu Dhabi',
    vehicles: [
      { id: 'v4', type: 'SUV', make: 'BMW', model: 'X7', licensePlate: 'AUH-001', driver: 'N/A', monthlyRate: 3500, status: 'Active' },
    ],
  },
  {
    id: '3', contractNumber: 'LC-V2-003', agreementType: 'INDIVIDUAL',
    lessee: 'Fatima Al-Nakhli', leaseType: 'MONTHLY',
    vehicleCount: 1, startDate: '2025-02-01', endDate: '2025-03-01',
    monthlyRate: 2500, insurance: false, maintenance: false, driver: false,
    status: 'Draft', branch: 'Dubai HQ',
    vehicles: [
      { id: 'v5', type: 'Sedan', make: 'Toyota', model: 'Corolla', licensePlate: 'DXB-005', driver: 'N/A', monthlyRate: 2500, status: 'Draft' },
    ],
  },
  {
    id: '4', contractNumber: 'LC-V2-004', agreementType: 'MASTER',
    lessee: 'Enterprise Corp', leaseType: 'LONG_TERM',
    vehicleCount: 5, startDate: '2024-03-01', endDate: '2026-03-01',
    monthlyRate: 22000, insurance: true, maintenance: true, driver: true,
    status: 'Pending Approval', branch: 'Dubai HQ', vehicles: [],
  },
];

export default function ContractsV2Page() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewContract, setShowNewContract] = useState(false);
  const [showPaymentSchedule, setShowPaymentSchedule] = useState<string | null>(null);
  const [expandedVehicles, setExpandedVehicles] = useState<Set<string>>(new Set());
  const [filterStatus, setFilterStatus] = useState('');
  const [filterAgreementType, setFilterAgreementType] = useState('');
  const [filterLeaseType, setFilterLeaseType] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null);
  const [showAddVehicle, setShowAddVehicle] = useState<Contract | null>(null);
  const [newVehicleForm, setNewVehicleForm] = useState({ type: '', make: '', model: '', licensePlate: '', driver: '', monthlyRate: '' });
  const [addingVehicle, setAddingVehicle] = useState(false);
  const [addVehicleMsg, setAddVehicleMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const [newContractForm, setNewContractForm] = useState<NewContractForm>({
    step: 1, lessee: '', agreementType: 'INDIVIDUAL', masterContractId: '',
    leaseType: 'LONG_TERM', durationMonths: '', startDate: '', endDate: '',
    monthlyRate: '', currency: 'AED', securityDeposit: '', mileageCap: '',
    branch: '', vehicles: [], insuranceIncluded: false, maintenanceIncluded: false,
    driverIncluded: false, notes: '',
  });

  const [paymentScheduleMonths, setPaymentScheduleMonths] = useState('12');
  const [paymentVatRate, setPaymentVatRate] = useState('5');
  const [paymentPreview, setPaymentPreview] = useState<any[]>([]);

  const loadContracts = useCallback(() => {
    fetch('/api/leasing/contracts-v2')
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(data => setContracts(Array.isArray(data) ? data : MOCK_CONTRACTS))
      .catch(() => setContracts(MOCK_CONTRACTS))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadContracts(); }, [loadContracts]);

  const prefillFromQuotation = useCallback(async (quotationId: string) => {
    try {
      const res = await fetch(`/api/leasing/quotations/${quotationId}`);
      if (!res.ok) return;
      const q = await res.json();
      const filled = quotationToContract(q);
      setNewContractForm(prev => ({
        ...prev,
        lessee: q.lesseeName ?? q.lesseeId ?? '',
        leaseType: (filled.leaseType as any) ?? 'LONG_TERM',
        durationMonths: String(q.durationMonths ?? ''),
        startDate: filled.startDate,
        endDate: filled.endDate,
        monthlyRate: String(filled.monthlyRate),
        securityDeposit: String(filled.securityDeposit),
        currency: filled.currency,
        mileageCap: q.mileageCap ? String(q.mileageCap) : '',
        insuranceIncluded: filled.insuranceIncluded,
        maintenanceIncluded: filled.maintenanceIncluded,
        driverIncluded: filled.driverIncluded,
        notes: filled.notes,
        quotationId,
      }));
      setShowNewContract(true);
    } catch(e) { console.error('Failed to load quotation:', e); }
  }, []);

  const getBadge = (type: string, value: string) => {
    const map: Record<string, Record<string, string>> = {
      agreement: { MASTER: 'bg-amber-500/20 text-amber-400 border-amber-500/30', INDIVIDUAL: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
      lease: { LONG_TERM: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30', SHORT_TERM: 'bg-teal-500/20 text-teal-400 border-teal-500/30', DAILY: 'bg-orange-500/20 text-orange-400 border-orange-500/30', MONTHLY: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' },
      status: { Active: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', Draft: 'bg-slate-500/20 text-slate-400 border-slate-500/30', 'Pending Approval': 'bg-amber-500/20 text-amber-400 border-amber-500/30', Expired: 'bg-rose-500/20 text-rose-400 border-rose-500/30', Terminated: 'bg-red-500/20 text-red-400 border-red-500/30' },
    };
    return map[type]?.[value] ?? 'bg-slate-500/20 text-slate-400 border-slate-500/30';
  };

  const calcDuration = (start: string, end: string) => {
    const s = new Date(start), e = new Date(end);
    const m = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
    return isNaN(m) || m < 0 ? '-' : `${m} mo`;
  };

  const filtered = contracts.filter(c => {
    if (filterStatus && c.status !== filterStatus) return false;
    if (filterAgreementType && c.agreementType !== filterAgreementType) return false;
    if (filterLeaseType && c.leaseType !== filterLeaseType) return false;
    if (searchTerm && !c.contractNumber.toLowerCase().includes(searchTerm.toLowerCase()) &&
        !c.lessee.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  const stats = {
    active: contracts.filter(c => c.status === 'Active').length,
    draftPending: contracts.filter(c => c.status === 'Draft' || c.status === 'Pending Approval').length,
    expiring: contracts.filter(c => {
      const d = (new Date(c.endDate).getTime() - Date.now()) / 86400000;
      return d > 0 && d <= 30;
    }).length,
    multiVehicle: contracts.filter(c => (c.vehicleCount ?? 0) > 1).length,
  };

  const handleCreateContract = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/leasing/contracts-v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newContractForm),
      });
      if (res.ok) {
        setShowNewContract(false);
        setNewContractForm({ step: 1, lessee: '', agreementType: 'INDIVIDUAL', masterContractId: '', leaseType: 'LONG_TERM', durationMonths: '', startDate: '', endDate: '', monthlyRate: '', currency: 'AED', securityDeposit: '', mileageCap: '', branch: '', vehicles: [], insuranceIncluded: false, maintenanceIncluded: false, driverIncluded: false, notes: '' });
        loadContracts();
      } else { alert('Failed to create contract'); }
    } catch { alert('Error creating contract'); }
    finally { setSaving(false); }
  };

  const generatePaymentPreview = () => {
    const contract = contracts.find(c => c.id === showPaymentSchedule);
    if (!contract) return;
    const months = parseInt(paymentScheduleMonths) || 12;
    const rate = contract.monthlyRate || 0;
    const vat = parseFloat(paymentVatRate) / 100;
    const preview = Array.from({ length: months }, (_, i) => {
      const due = new Date(contract.startDate);
      due.setMonth(due.getMonth() + i + 1);
      return { month: i + 1, amount: rate, vat: rate * vat, total: rate * (1 + vat), dueDate: due.toISOString().split('T')[0] };
    });
    setPaymentPreview(preview);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400 animate-pulse">Loading contracts...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Suspense fallback={null}>
        <ContractParamsReader onFromQuotation={prefillFromQuotation} />
      </Suspense>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-white mb-1">Lease Agreements</h1>
          <p className="text-slate-400 text-sm">Manage master and individual lease contracts</p>
        </div>
        <button onClick={() => setShowNewContract(true)}
          className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:opacity-90 transition-opacity shadow-lg">
          + New Contract
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Active', value: stats.active, color: 'from-emerald-500 to-teal-600' },
          { label: 'Draft / Pending', value: stats.draftPending, color: 'from-amber-500 to-orange-600' },
          { label: 'Expiring This Month', value: stats.expiring, color: 'from-rose-500 to-pink-600' },
          { label: 'Multi-Vehicle', value: stats.multiVehicle, color: 'from-purple-500 to-indigo-600' },
        ].map((s, i) => (
          <div key={i} className="bg-slate-800/50 border border-white/10 rounded-2xl p-4">
            <p className="text-slate-400 text-xs font-medium mb-1">{s.label}</p>
            <p className={`text-2xl font-bold bg-gradient-to-r ${s.color} bg-clip-text text-transparent`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-4 flex gap-4 flex-wrap items-end">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Search</label>
          <input type="text" placeholder="Contract # or Lessee" value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full px-3 py-2 bg-slate-900/60 border border-white/10 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500/50" />
        </div>
        {[
          { label: 'Status', val: filterStatus, setVal: setFilterStatus, opts: [['', 'All Status'], ['Active', 'Active'], ['Draft', 'Draft'], ['Pending Approval', 'Pending Approval'], ['Expired', 'Expired']] },
          { label: 'Agreement Type', val: filterAgreementType, setVal: setFilterAgreementType, opts: [['', 'All Types'], ['MASTER', 'Master'], ['INDIVIDUAL', 'Individual']] },
          { label: 'Lease Type', val: filterLeaseType, setVal: setFilterLeaseType, opts: [['', 'All Lease Types'], ['LONG_TERM', 'Long Term'], ['SHORT_TERM', 'Short Term'], ['DAILY', 'Daily'], ['MONTHLY', 'Monthly']] },
        ].map(({ label, val, setVal, opts }) => (
          <div key={label} className="flex-1 min-w-[140px]">
            <label className="block text-xs font-medium text-slate-400 mb-1.5">{label}</label>
            <select value={val} onChange={e => setVal(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900/60 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500/50">
              {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/5">
              {['Contract #', 'Type', 'Lessee', 'Lease Type', 'Vehicles', 'Duration', 'Monthly Rate', 'Status', 'Branch', 'Actions'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-300 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-12 text-center text-slate-500">No contracts found</td></tr>
            ) : filtered.map(c => (
              <React.Fragment key={c.id}>
                <tr className="border-b border-white/5 hover:bg-white/[0.03] transition-colors">
                  <td className="px-4 py-3.5 text-sm font-bold text-white whitespace-nowrap">{c.contractNumber}</td>
                  <td className="px-4 py-3.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${getBadge('agreement', c.agreementType)}`}>{c.agreementType}</span>
                  </td>
                  <td className="px-4 py-3.5 text-sm text-white">{c.lessee}</td>
                  <td className="px-4 py-3.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${getBadge('lease', c.leaseType)}`}>{c.leaseType.replace('_', ' ')}</span>
                  </td>
                  <td className="px-4 py-3.5">
                    <button onClick={() => setExpandedVehicles(prev => { const n = new Set(prev); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })}
                      className="px-3 py-1 rounded-full bg-slate-700/60 text-white text-xs font-semibold hover:bg-slate-600/60 transition-colors">
                      {c.vehicleCount ?? (c.vehicles?.length ?? 0)} unit{(c.vehicleCount ?? 0) !== 1 ? 's' : ''} {expandedVehicles.has(c.id) ? '' : ''}
                    </button>
                  </td>
                  <td className="px-4 py-3.5 text-sm font-semibold text-white">{calcDuration(c.startDate, c.endDate)}</td>
                  <td className="px-4 py-3.5 text-sm font-semibold text-white">{(c.monthlyRate ?? 0).toLocaleString()} AED</td>
                  <td className="px-4 py-3.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${getBadge('status', c.status)}`}>{c.status}</span>
                  </td>
                  <td className="px-4 py-3.5 text-sm text-white">{c.branch || '-'}</td>
                  <td className="px-4 py-3.5">
                    <div className="flex gap-1.5 flex-wrap">
                      <button
                        onClick={() => setSelectedContract(c)}
                        className="px-2.5 py-1 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 text-xs hover:bg-blue-500/30 transition-all font-medium">
                        View
                      </button>
                      <button
                        onClick={() => { setShowAddVehicle(c); setNewVehicleForm({ type: '', make: '', model: '', licensePlate: '', driver: '', monthlyRate: '' }); setAddVehicleMsg(''); }}
                        className="px-2.5 py-1 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs hover:bg-indigo-500/30 transition-all font-medium">
                        Add Vehicle
                      </button>
                      <button
                        onClick={() => { setShowPaymentSchedule(c.id); setPaymentPreview([]); }}
                        className="px-2.5 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs hover:bg-amber-500/30 transition-all font-medium">
                        Payments
                      </button>
                    </div>
                  </td>
                </tr>
                {/* Expanded vehicles */}
                {expandedVehicles.has(c.id) && (
                  <tr className="border-b border-white/5 bg-slate-800/30">
                    <td colSpan={10} className="px-6 py-4">
                      <div className="bg-slate-900/50 rounded-xl p-4">
                        <p className="text-xs font-semibold text-slate-300 mb-3">Vehicles in {c.contractNumber}:</p>
                        {(c.vehicles ?? []).length === 0 ? (
                          <p className="text-slate-500 text-sm">No vehicles linked yet. Use "Add Vehicle" to attach.</p>
                        ) : (
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-white/5">
                                {['Type', 'Make / Model', 'License Plate', 'Driver', 'Monthly Rate', 'Status'].map(h => (
                                  <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-slate-300">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {(c.vehicles ?? []).map(v => (
                                <tr key={v.id} className="border-b border-white/5">
                                  <td className="px-3 py-2 text-white">{v.type}</td>
                                  <td className="px-3 py-2 text-white">{v.make} {v.model}</td>
                                  <td className="px-3 py-2 text-slate-200">{v.licensePlate}</td>
                                  <td className="px-3 py-2 text-slate-200">{v.driver || '-'}</td>
                                  <td className="px-3 py-2 text-white font-semibold">{(v.monthlyRate ?? 0).toLocaleString()} AED</td>
                                  <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-xs border ${getBadge('status', v.status)}`}>{v.status}</span></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/*  VIEW CONTRACT MODAL  */}
      {selectedContract && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <div>
                <h2 className="text-xl font-bold text-white">{selectedContract.contractNumber}</h2>
                <p className="text-xs text-slate-400 mt-0.5">{selectedContract.agreementType} &middot; {selectedContract.leaseType.replace('_', ' ')}</p>
              </div>
              <button onClick={() => setSelectedContract(null)} className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white text-lg transition-all">x</button>
            </div>
            <div className="p-6 space-y-5">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Lessee', value: selectedContract.lessee },
                  { label: 'Branch', value: selectedContract.branch || '-' },
                  { label: 'Start Date', value: selectedContract.startDate },
                  { label: 'End Date', value: selectedContract.endDate },
                  { label: 'Duration', value: calcDuration(selectedContract.startDate, selectedContract.endDate) },
                  { label: 'Monthly Rate', value: `${(selectedContract.monthlyRate ?? 0).toLocaleString()} AED` },
                  { label: 'Status', value: selectedContract.status },
                  { label: 'Vehicle Count', value: `${selectedContract.vehicleCount ?? (selectedContract.vehicles?.length ?? 0)} unit(s)` },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-slate-700/30 border border-white/10 rounded-xl p-3">
                    <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">{label}</p>
                    <p className="text-sm font-semibold text-white">{value}</p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Insurance', value: selectedContract.insurance ? 'Included' : 'Not Included', ok: selectedContract.insurance },
                  { label: 'Maintenance', value: selectedContract.maintenance ? 'Included' : 'Not Included', ok: selectedContract.maintenance },
                  { label: 'Driver', value: selectedContract.driver ? 'Included' : 'Not Included', ok: selectedContract.driver },
                ].map(({ label, value, ok }) => (
                  <div key={label} className={`border rounded-xl p-3 ${ok ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-slate-700/30 border-white/10'}`}>
                    <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">{label}</p>
                    <p className={`text-sm font-semibold ${ok ? 'text-emerald-400' : 'text-slate-400'}`}>{value}</p>
                  </div>
                ))}
              </div>
              {(selectedContract.vehicles ?? []).length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Assigned Vehicles</h4>
                  <div className="space-y-2">
                    {(selectedContract.vehicles ?? []).map(v => (
                      <div key={v.id} className="bg-slate-700/30 border border-white/10 rounded-xl px-4 py-3 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-white">{v.make} {v.model} <span className="text-slate-400 font-normal text-xs">({v.type})</span></p>
                          <p className="text-xs text-slate-500">{v.licensePlate}{v.driver && v.driver !== 'N/A' ? `  Driver: ${v.driver}` : ''}</p>
                        </div>
                        <span className="text-sm font-bold text-emerald-400">{(v.monthlyRate ?? 0).toLocaleString()} AED</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="p-6 border-t border-white/10 flex gap-3 justify-end">
              <button
                onClick={() => { setShowAddVehicle(selectedContract); setSelectedContract(null); setNewVehicleForm({ type: '', make: '', model: '', licensePlate: '', driver: '', monthlyRate: '' }); setAddVehicleMsg(''); }}
                className="px-5 py-2.5 rounded-xl bg-indigo-600/80 border border-indigo-500/40 text-white hover:bg-indigo-600 font-medium transition-all text-sm">
                Add Vehicle
              </button>
              <button onClick={() => setSelectedContract(null)}
                className="px-6 py-2.5 rounded-xl border border-white/10 text-slate-300 hover:bg-white/5 font-medium transition-all text-sm">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/*  ADD VEHICLE MODAL  */}
      {showAddVehicle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <div>
                <h2 className="text-xl font-bold text-white">Add Vehicle</h2>
                <p className="text-xs text-slate-400 mt-0.5">Contract: {showAddVehicle.contractNumber} &middot; {showAddVehicle.lessee}</p>
              </div>
              <button onClick={() => setShowAddVehicle(null)} className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white text-lg transition-all">x</button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              {[
                { key: 'type', label: 'Vehicle Type', placeholder: 'e.g. SUV, Sedan, Van' },
                { key: 'make', label: 'Make', placeholder: 'e.g. Toyota' },
                { key: 'model', label: 'Model', placeholder: 'e.g. Land Cruiser' },
                { key: 'licensePlate', label: 'License Plate', placeholder: 'DXB-001' },
                { key: 'driver', label: 'Driver (optional)', placeholder: 'Driver name' },
                { key: 'monthlyRate', label: 'Monthly Rate (AED)', placeholder: '0' },
              ].map(({ key, label, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">{label}</label>
                  <input
                    type={key === 'monthlyRate' ? 'number' : 'text'}
                    placeholder={placeholder}
                    value={(newVehicleForm as any)[key]}
                    onChange={e => setNewVehicleForm(p => ({ ...p, [key]: e.target.value }))}
                    className="w-full px-3 py-2 bg-slate-900/60 border border-white/10 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500" />
                </div>
              ))}
            </div>
            {addVehicleMsg && (
              <div className={`mx-6 mb-4 px-4 py-2 rounded-lg text-sm ${addVehicleMsg.startsWith('Error') ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'}`}>
                {addVehicleMsg}
              </div>
            )}
            <div className="p-6 border-t border-white/10 flex gap-3 justify-end">
              <button onClick={() => setShowAddVehicle(null)}
                className="px-5 py-2.5 rounded-xl border border-white/10 text-slate-300 hover:bg-white/5 font-medium transition-all text-sm">Cancel</button>
              <button
                disabled={addingVehicle || !newVehicleForm.type || !newVehicleForm.licensePlate}
                onClick={async () => {
                  setAddingVehicle(true);
                  setAddVehicleMsg('');
                  try {
                    const res = await fetch(`/api/leasing/contracts-v2/${showAddVehicle.id}/vehicles`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ ...newVehicleForm, monthlyRate: parseFloat(newVehicleForm.monthlyRate) || 0 }),
                    });
                    const data = await res.json();
                    if (res.ok) {
                      setAddVehicleMsg('Vehicle added successfully!');
                      // Update the contract in state
                      setContracts(prev => prev.map(c => c.id === showAddVehicle.id ? {
                        ...c,
                        vehicleCount: (c.vehicleCount ?? 0) + 1,
                        vehicles: [...(c.vehicles ?? []), data],
                      } : c));
                      setTimeout(() => setShowAddVehicle(null), 1200);
                    } else {
                      setAddVehicleMsg(`Error: ${data.error ?? 'Failed to add vehicle'}`);
                    }
                  } catch {
                    setAddVehicleMsg('Error: Could not connect to server');
                  }
                  setAddingVehicle(false);
                }}
                className="px-6 py-2.5 rounded-xl bg-indigo-600 text-white font-bold hover:bg-indigo-500 transition-all disabled:opacity-50 text-sm">
                {addingVehicle ? 'Adding...' : 'Add Vehicle'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/*  PAYMENT SCHEDULE MODAL  */}
      {showPaymentSchedule && (() => {
        const contract = contracts.find(c => c.id === showPaymentSchedule);
        if (!contract) return null;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-slate-800 border border-white/10 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl">
              <div className="flex items-center justify-between p-6 border-b border-white/10">
                <div>
                  <h2 className="text-xl font-bold text-white">Payment Schedule</h2>
                  <p className="text-xs text-slate-400 mt-0.5">{contract.contractNumber} &middot; {contract.lessee}</p>
                </div>
                <button onClick={() => { setShowPaymentSchedule(null); setPaymentPreview([]); }}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white text-lg transition-all">x</button>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">Number of Months</label>
                    <input type="number" min="1" max="60" value={paymentScheduleMonths}
                      onChange={e => setPaymentScheduleMonths(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-900/60 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">VAT Rate (%)</label>
                    <input type="number" min="0" max="30" step="0.5" value={paymentVatRate}
                      onChange={e => setPaymentVatRate(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-900/60 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500" />
                  </div>
                </div>
                <button onClick={generatePaymentPreview}
                  className="px-5 py-2.5 rounded-xl bg-amber-600 text-white font-semibold hover:bg-amber-500 transition-all text-sm">
                  Generate Preview
                </button>
                {paymentPreview.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-semibold text-white">Payment Schedule Preview</p>
                      <p className="text-xs text-slate-400">Total: {paymentPreview.reduce((a, p) => a + p.total, 0).toLocaleString()} AED</p>
                    </div>
                    <div className="overflow-x-auto rounded-xl border border-white/10">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-white/5 bg-slate-900/40">
                            {['Month', 'Due Date', 'Amount', 'VAT', 'Total'].map(h => (
                              <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-slate-300">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {paymentPreview.map(p => (
                            <tr key={p.month} className="border-b border-white/5 hover:bg-white/[0.02]">
                              <td className="px-4 py-2.5 text-white font-semibold">{p.month}</td>
                              <td className="px-4 py-2.5 text-slate-200">{p.dueDate}</td>
                              <td className="px-4 py-2.5 text-white">{p.amount.toLocaleString()} AED</td>
                              <td className="px-4 py-2.5 text-amber-400">{p.vat.toLocaleString(undefined, { maximumFractionDigits: 2 })} AED</td>
                              <td className="px-4 py-2.5 text-emerald-400 font-bold">{p.total.toLocaleString(undefined, { maximumFractionDigits: 2 })} AED</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex gap-3 justify-end mt-4">
                      <button
                        onClick={async () => {
                          try {
                            const res = await fetch(`/api/leasing/contracts-v2/${showPaymentSchedule}/payments`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ months: parseInt(paymentScheduleMonths), vatRate: parseFloat(paymentVatRate), payments: paymentPreview }),
                            });
                            if (res.ok) { setShowPaymentSchedule(null); setPaymentPreview([]); }
                            else alert('Failed to save payment schedule');
                          } catch { alert('Error saving payment schedule'); }
                        }}
                        className="px-6 py-2.5 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-500 transition-all text-sm">
                        Confirm &amp; Save
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/*  NEW CONTRACT MODAL  */}
      {showNewContract && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <div>
                <h2 className="text-xl font-bold text-white">New Lease Contract</h2>
                <p className="text-xs text-slate-400 mt-0.5">Step {newContractForm.step} of 3</p>
              </div>
              <button onClick={() => setShowNewContract(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white text-lg transition-all">x</button>
            </div>

            {/* Step bar */}
            <div className="flex gap-1.5 px-6 pt-5 pb-1">
              {[1, 2, 3].map(n => (
                <div key={n} className={`flex-1 h-1.5 rounded-full ${n <= newContractForm.step ? 'bg-blue-500' : 'bg-slate-700'}`} />
              ))}
            </div>
            <div className="flex gap-1.5 px-6 pb-5 pt-1">
              {[['Contract Info', 1], ['Vehicles', 2], ['Inclusions', 3]].map(([label, n]) => (
                <p key={n} className={`flex-1 text-xs text-center font-medium ${newContractForm.step === n ? 'text-blue-400' : 'text-slate-600'}`}>{label}</p>
              ))}
            </div>

            <div className="px-6 pb-6 space-y-4">
              {/* Step 1 */}
              {newContractForm.step === 1 && (<>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Lessee Name / ID</label>
                  <input type="text" value={newContractForm.lessee}
                    onChange={e => setNewContractForm(p => ({ ...p, lessee: e.target.value }))}
                    placeholder="Enter lessee name or ID"
                    className="w-full px-3 py-2.5 bg-slate-900/60 border border-white/10 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500/50" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">Agreement Type</label>
                    <select value={newContractForm.agreementType}
                      onChange={e => setNewContractForm(p => ({ ...p, agreementType: e.target.value as any }))}
                      className="w-full px-3 py-2.5 bg-slate-900/60 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500/50">
                      <option value="INDIVIDUAL">Individual</option>
                      <option value="MASTER">Master</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">Lease Type</label>
                    <select value={newContractForm.leaseType}
                      onChange={e => setNewContractForm(p => ({ ...p, leaseType: e.target.value as any }))}
                      className="w-full px-3 py-2.5 bg-slate-900/60 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500/50">
                      <option value="LONG_TERM">Long Term</option>
                      <option value="SHORT_TERM">Short Term</option>
                      <option value="DAILY">Daily</option>
                      <option value="MONTHLY">Monthly</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">Duration (months)</label>
                    <input type="number" min="1" placeholder="e.g. 24" value={newContractForm.durationMonths}
                      onChange={e => {
                        const d = parseInt(e.target.value) || 0;
                        const s = newContractForm.startDate;
                        setNewContractForm(p => ({ ...p, durationMonths: e.target.value, endDate: d && s ? addMonths(s, d) : p.endDate }));
                      }}
                      className="w-full px-3 py-2.5 bg-slate-900/60 border border-white/10 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500/50" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">Start Date</label>
                    <input type="date" value={newContractForm.startDate}
                      onChange={e => {
                        const s = e.target.value;
                        const d = parseInt(newContractForm.durationMonths) || 0;
                        setNewContractForm(p => ({ ...p, startDate: s, endDate: d && s ? addMonths(s, d) : p.endDate }));
                      }}
                      className="w-full px-3 py-2.5 bg-slate-900/60 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500/50" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">End Date {newContractForm.durationMonths && <span className="text-emerald-400">(auto)</span>}</label>
                    <input type="date" value={newContractForm.endDate}
                      onChange={e => setNewContractForm(p => ({ ...p, endDate: e.target.value }))}
                      className={`w-full px-3 py-2.5 bg-slate-900/60 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-blue-500/50 ${newContractForm.durationMonths ? 'text-emerald-400' : 'text-white'}`} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">Monthly Rate</label>
                    <input type="number" value={newContractForm.monthlyRate} placeholder="0"
                      onChange={e => setNewContractForm(p => ({ ...p, monthlyRate: e.target.value }))}
                      className="w-full px-3 py-2.5 bg-slate-900/60 border border-white/10 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500/50" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">Currency</label>
                    <select value={newContractForm.currency}
                      onChange={e => setNewContractForm(p => ({ ...p, currency: e.target.value }))}
                      className="w-full px-3 py-2.5 bg-slate-900/60 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500/50">
                      <option>AED</option><option>USD</option><option>EUR</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">Security Deposit</label>
                    <input type="number" value={newContractForm.securityDeposit} placeholder="0"
                      onChange={e => setNewContractForm(p => ({ ...p, securityDeposit: e.target.value }))}
                      className="w-full px-3 py-2.5 bg-slate-900/60 border border-white/10 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500/50" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">Mileage Cap (annual)</label>
                    <input type="number" value={newContractForm.mileageCap} placeholder="km per year"
                      onChange={e => setNewContractForm(p => ({ ...p, mileageCap: e.target.value }))}
                      className="w-full px-3 py-2.5 bg-slate-900/60 border border-white/10 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500/50" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">Branch</label>
                    <select value={newContractForm.branch}
                      onChange={e => setNewContractForm(p => ({ ...p, branch: e.target.value }))}
                      className="w-full px-3 py-2.5 bg-slate-900/60 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500/50">
                      <option value="">Select branch</option>
                      <option>Dubai HQ</option><option>Abu Dhabi</option><option>Sharjah</option>
                    </select>
                  </div>
                </div>
              </>)}

              {/* Step 2 */}
              {newContractForm.step === 2 && (<>
                <h3 className="text-sm font-semibold text-white mb-2">Assign Vehicles <span className="text-slate-500 font-normal">(optional  can add later)</span></h3>
                {newContractForm.vehicles.map((v, idx) => (
                  <div key={v.id} className="bg-slate-900/50 border border-white/10 rounded-xl p-4">
                    <div className="flex justify-between items-center mb-3">
                      <p className="text-sm font-medium text-slate-300">Vehicle {idx + 1}</p>
                      <button onClick={() => setNewContractForm(p => ({ ...p, vehicles: p.vehicles.filter((_, i) => i !== idx) }))}
                        className="text-rose-400 hover:text-rose-300 text-xs font-medium">Remove</button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {[['type', 'Type (SUV, Sedan...)'], ['make', 'Make'], ['model', 'Model'], ['licensePlate', 'License Plate'], ['driver', 'Driver ID'], ['monthlyRate', 'Monthly Rate']].map(([f, pl]) => (
                        <input key={f} type={f === 'monthlyRate' ? 'number' : 'text'} placeholder={pl}
                          value={(v as any)[f]}
                          onChange={e => { const up = [...newContractForm.vehicles]; up[idx] = { ...up[idx], [f]: f === 'monthlyRate' ? parseFloat(e.target.value) : e.target.value }; setNewContractForm(p => ({ ...p, vehicles: up })); }}
                          className="px-3 py-2 bg-slate-800/60 border border-white/10 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500/50" />
                      ))}
                    </div>
                  </div>
                ))}
                <button onClick={() => setNewContractForm(p => ({ ...p, vehicles: [...p.vehicles, { id: `new-${Date.now()}`, type: '', make: '', model: '', licensePlate: '', driver: '', monthlyRate: 0, status: 'Draft' }] }))}
                  className="w-full py-2.5 border border-dashed border-blue-500/40 rounded-xl text-blue-400 hover:bg-blue-500/5 transition-colors text-sm font-medium">
                  + Add Vehicle
                </button>
              </>)}

              {/* Step 3 */}
              {newContractForm.step === 3 && (<>
                <h3 className="text-sm font-semibold text-white mb-3">Bundled Services &amp; Notes</h3>
                <div className="space-y-3">
                  {[
                    { key: 'insuranceIncluded', label: 'Insurance Included', desc: 'Full comprehensive insurance coverage' },
                    { key: 'maintenanceIncluded', label: 'Maintenance Included', desc: 'Scheduled service and repairs' },
                    { key: 'driverIncluded', label: 'Driver Included', desc: 'Professional driver assigned to vehicle' },
                  ].map(({ key, label, desc }) => (
                    <label key={key} className={`flex items-center gap-4 p-4 rounded-xl border cursor-pointer transition-all ${(newContractForm as any)[key] ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-slate-900/40 border-white/10 hover:border-white/20'}`}>
                      <input type="checkbox" checked={(newContractForm as any)[key]}
                        onChange={e => setNewContractForm(p => ({ ...p, [key]: e.target.checked }))}
                        className="w-4 h-4 accent-emerald-500" />
                      <div>
                        <p className={`text-sm font-semibold ${(newContractForm as any)[key] ? 'text-emerald-400' : 'text-slate-300'}`}>{label}</p>
                        <p className="text-xs text-slate-500">{desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Notes</label>
                  <textarea value={newContractForm.notes} rows={3}
                    onChange={e => setNewContractForm(p => ({ ...p, notes: e.target.value }))}
                    placeholder="Additional terms or notes..."
                    className="w-full px-3 py-2.5 bg-slate-900/60 border border-white/10 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500/50 resize-none" />
                </div>
              </>)}
            </div>

            {/* Footer nav */}
            <div className="px-6 pb-6 flex gap-3 justify-between">
              {newContractForm.step > 1 ? (
                <button onClick={() => setNewContractForm(p => ({ ...p, step: (p.step - 1) as any }))}
                  className="px-5 py-2.5 rounded-xl border border-white/10 text-slate-300 hover:bg-white/5 font-medium transition-all text-sm">Back</button>
              ) : <span />}
              {newContractForm.step < 3 ? (
                <button onClick={() => setNewContractForm(p => ({ ...p, step: (p.step + 1) as any }))}
                  className="px-6 py-2.5 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-500 transition-all text-sm">Next</button>
              ) : (
                <button onClick={handleCreateContract} disabled={saving || !newContractForm.lessee}
                  className="px-6 py-2.5 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-500 transition-all disabled:opacity-50 text-sm">
                  {saving ? 'Creating...' : 'Create Contract'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
