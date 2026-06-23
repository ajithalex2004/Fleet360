'use client';
import React, { useState, useEffect, useCallback, Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { BadgeCheck, Clock3, CalendarClock, Layers3 } from 'lucide-react';
import { addMonths, quotationToContract } from '@/lib/autoFill';
import RowActionMenu from '@/components/ui/RowActionMenu';
import DataTableToolbar from '@/components/ui/DataTableToolbar';
import SmartDataGridHeader from '@/components/ui/SmartDataGridHeader';
import { KpiCard, KpiGrid } from '@/components/ui/page-theme';
import { useDataTableColumns, type DataTableColumn } from '@/hooks/useDataTableColumns';
import { downloadXLSX } from '@/lib/exportUtils';
import { downloadTablePdf } from '@/lib/exportTablePdf';

interface Vehicle {
  id: string;
  vehicleId?: string | null;
  type: string;
  make: string;
  model: string;
  year?: number | null;
  licensePlate: string;
  driver: string;
  monthlyRate: number;
  status: string;
  branchId?: string | null;
  branchName?: string | null;
  fleetStatus?: string | null;
  lastOdometer?: number | null;
}

interface FleetVehicleOption {
  id: string;
  vehicleCode: string | null;
  licensePlate: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  makeModelYear: string;
  vehicleTypeName: string | null;
  vehicleClass: string | null;
  vehicleGroup: string | null;
  branchId: string | null;
  branchName: string | null;
  status: string | null;
  lastOdometer: number | null;
}

interface BranchOption {
  id: string;
  name: string;
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
  status: 'Active' | 'Draft' | 'Pending Approval' | 'Expired' | 'Terminated' | 'Closed';
  branch: string;
  vehicles?: Vehicle[];
}

type SortKey =
  | 'contractNumber'
  | 'lessee'
  | 'agreementType'
  | 'leaseType'
  | 'vehicleCount'
  | 'duration'
  | 'monthlyRate'
  | 'status'
  | 'branch';

type ColumnFilters = {
  contractNumber: string;
  lessee: string;
  agreementType: string;
  leaseType: string;
  vehicleCount: string;
  duration: string;
  monthlyRate: string;
  status: string;
  branch: string;
};

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
  openingBranchId: string;
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

const formatLeaseTypeLabel = (value: Contract['leaseType']) =>
  value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const DEFAULT_AGREEMENT_COLUMNS: DataTableColumn<SortKey>[] = [
  { key: 'contractNumber', label: 'Contract #', visible: true },
  { key: 'lessee', label: 'Lessee', visible: true },
  { key: 'agreementType', label: 'Agreement Type', visible: true },
  { key: 'leaseType', label: 'Lease Type', visible: true },
  { key: 'vehicleCount', label: 'Vehicles', visible: true },
  { key: 'duration', label: 'Term', visible: true },
  { key: 'monthlyRate', label: 'Monthly Rate', visible: true },
  { key: 'status', label: 'Status', visible: true },
  { key: 'branch', label: 'Branch', visible: true },
];

export default function ContractsV2Page() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewContract, setShowNewContract] = useState(false);
  const [showPaymentSchedule, setShowPaymentSchedule] = useState<string | null>(null);
  const [showTableFilters, setShowTableFilters] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [expandedVehicles, setExpandedVehicles] = useState<Set<string>>(new Set());
  const [quickSearch, setQuickSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('contractNumber');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>({
    contractNumber: '',
    lessee: '',
    agreementType: '',
    leaseType: '',
    vehicleCount: '',
    duration: '',
    monthlyRate: '',
    status: '',
    branch: '',
  });
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null);
  const [showAddVehicle, setShowAddVehicle] = useState<Contract | null>(null);
  const [newVehicleForm, setNewVehicleForm] = useState({ type: '', make: '', model: '', licensePlate: '', driver: '', monthlyRate: '' });
  const [addingVehicle, setAddingVehicle] = useState(false);
  const [addVehicleMsg, setAddVehicleMsg] = useState('');
  const [fleetVehicles, setFleetVehicles] = useState<FleetVehicleOption[]>([]);
  const [fleetVehiclesLoading, setFleetVehiclesLoading] = useState(false);
  const [selectedFleetVehicleId, setSelectedFleetVehicleId] = useState('');
  const [showOtherBranchVehicles, setShowOtherBranchVehicles] = useState(false);
  const [newContractVehicleId, setNewContractVehicleId] = useState('');
  const [newContractShowOtherBranches, setNewContractShowOtherBranches] = useState(false);
  const [showCloseContract, setShowCloseContract] = useState<Contract | null>(null);
  const [closingContract, setClosingContract] = useState(false);
  const [closeContractMsg, setCloseContractMsg] = useState('');
  const [closeContractForm, setCloseContractForm] = useState({
    closingBranchId: '',
    returnCondition: 'GOOD',
    returnMileage: '',
    depositSettlementAmount: '',
    finalReceiptAmount: '',
    finalReceiptPaymentMethod: 'BANK_TRANSFER',
    finalReceiptNotes: '',
  });
  const [saving, setSaving] = useState(false);

  const [newContractForm, setNewContractForm] = useState<NewContractForm>({
    step: 1, lessee: '', agreementType: 'INDIVIDUAL', masterContractId: '',
    leaseType: 'LONG_TERM', durationMonths: '', startDate: '', endDate: '',
    monthlyRate: '', currency: 'AED', securityDeposit: '', mileageCap: '',
    branch: '', openingBranchId: '', vehicles: [], insuranceIncluded: false, maintenanceIncluded: false,
    driverIncluded: false, notes: '',
  });

  const [paymentScheduleMonths, setPaymentScheduleMonths] = useState('12');
  const [paymentVatRate, setPaymentVatRate] = useState('5');
  const [paymentPreview, setPaymentPreview] = useState<any[]>([]);
  const [paymentScheduleMsg, setPaymentScheduleMsg] = useState('');
  const {
    columns,
    visibleColumns,
    toggleColumn,
    moveColumn,
    resizeColumn,
  } = useDataTableColumns<SortKey>('leasing-contracts-v2-columns', DEFAULT_AGREEMENT_COLUMNS);

  const getColumnStyle = useCallback(
    (key: SortKey) => {
      const column = visibleColumns.find((item) => item.key === key);
      return column?.width ? { width: `${column.width}px`, minWidth: `${column.width}px` } : undefined;
    },
    [visibleColumns],
  );

  const loadContracts = useCallback(() => {
    fetch('/api/leasing/contracts-v2')
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(data => setContracts(Array.isArray(data) ? data : MOCK_CONTRACTS))
      .catch(() => setContracts(MOCK_CONTRACTS))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadContracts(); }, [loadContracts]);

  const loadFleetVehicles = useCallback(() => {
    setFleetVehiclesLoading(true);
    fetch('/api/fleet/vehicles/dropdown?availableOnly=1&excludeLeaseAssigned=1')
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(data => setFleetVehicles(Array.isArray(data?.vehicles) ? data.vehicles : []))
      .catch(() => setFleetVehicles([]))
      .finally(() => setFleetVehiclesLoading(false));
  }, []);

  useEffect(() => { loadFleetVehicles(); }, [loadFleetVehicles]);

  const branchOptions = useMemo<BranchOption[]>(() => {
    const options = new Map<string, string>();
    for (const vehicle of fleetVehicles) {
      if (vehicle.branchId) options.set(vehicle.branchId, vehicle.branchName || vehicle.branchId);
    }
    for (const contract of contracts) {
      if (contract.branch) options.set(contract.branch, contract.branch);
    }
    return [...options.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [contracts, fleetVehicles]);

  const vehicleLabel = useCallback((vehicle: FleetVehicleOption) => {
    const plate = vehicle.licensePlate || vehicle.vehicleCode || 'Unregistered';
    const model = vehicle.makeModelYear && vehicle.makeModelYear.length > 1 ? vehicle.makeModelYear : [vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(' ');
    const branch = vehicle.branchName ? ` - ${vehicle.branchName}` : '';
    return `${plate} - ${model || 'Vehicle'}${branch}`;
  }, []);

  const fleetToContractVehicle = useCallback((vehicle: FleetVehicleOption, monthlyRate?: number): Vehicle => ({
    id: `fleet-${vehicle.id}`,
    vehicleId: vehicle.id,
    type: vehicle.vehicleTypeName || vehicle.vehicleClass || vehicle.vehicleGroup || 'Vehicle',
    make: vehicle.make || '',
    model: vehicle.model || vehicle.makeModelYear || '',
    year: vehicle.year,
    licensePlate: vehicle.licensePlate || vehicle.vehicleCode || '',
    driver: '',
    monthlyRate: monthlyRate ?? Number(newContractForm.monthlyRate || 0),
    status: 'Selected',
    branchId: vehicle.branchId,
    branchName: vehicle.branchName,
    fleetStatus: vehicle.status,
    lastOdometer: vehicle.lastOdometer,
  }), [newContractForm.monthlyRate]);

  const filteredFleetVehiclesForNewContract = useMemo(() => (
    fleetVehicles.filter(vehicle => (
      newContractShowOtherBranches ||
      !newContractForm.openingBranchId ||
      vehicle.branchId === newContractForm.openingBranchId
    ))
  ), [fleetVehicles, newContractForm.openingBranchId, newContractShowOtherBranches]);

  const filteredFleetVehiclesForAdd = useMemo(() => (
    fleetVehicles.filter(vehicle => (
      showOtherBranchVehicles ||
      !showAddVehicle?.branch ||
      vehicle.branchId === showAddVehicle.branch
    ))
  ), [fleetVehicles, showAddVehicle?.branch, showOtherBranchVehicles]);

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
      status: { Active: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', Draft: 'bg-slate-500/20 text-slate-400 border-slate-500/30', 'Pending Approval': 'bg-amber-500/20 text-amber-400 border-amber-500/30', Expired: 'bg-rose-500/20 text-rose-400 border-rose-500/30', Terminated: 'bg-red-500/20 text-red-400 border-red-500/30', Closed: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
    };
    return map[type]?.[value] ?? 'bg-slate-500/20 text-slate-400 border-slate-500/30';
  };

  const calcDuration = (start: string, end: string) => {
    const s = new Date(start), e = new Date(end);
    const m = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
    return isNaN(m) || m < 0 ? '-' : `${m} mo`;
  };

  const getContractDurationMonths = (contract: Pick<Contract, 'startDate' | 'endDate' | 'durationMonths'>) => {
    const explicit = Number(contract.durationMonths ?? 0);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;

    const start = new Date(contract.startDate);
    const end = new Date(contract.endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 12;

    const months = Math.max(
      1,
      (end.getFullYear() - start.getFullYear()) * 12 +
        (end.getMonth() - start.getMonth()) +
        (end.getDate() >= start.getDate() ? 0 : -1),
    );

    return months;
  };

  const updateColumnFilter = (key: keyof ColumnFilters, value: string) => {
    setColumnFilters((prev) => ({ ...prev, [key]: value }));
  };

  const toggleSort = (key: SortKey) => {
    setSortKey((prevKey) => {
      if (prevKey === key) {
        setSortDirection((prevDirection) => (prevDirection === 'asc' ? 'desc' : 'asc'));
        return prevKey;
      }
      setSortDirection('asc');
      return key;
    });
  };

  const filtered = useMemo(() => {
    const normalizedQuickSearch = quickSearch.trim().toLowerCase();
    const normalizedContract = columnFilters.contractNumber.trim().toLowerCase();
    const normalizedLessee = columnFilters.lessee.trim().toLowerCase();
    const normalizedBranch = columnFilters.branch.trim().toLowerCase();
    const normalizedVehicleCount = columnFilters.vehicleCount.trim().toLowerCase();
    const normalizedDuration = columnFilters.duration.trim().toLowerCase();
    const normalizedMonthlyRate = columnFilters.monthlyRate.trim().toLowerCase();

    const visibleContracts = contracts.filter((c) => {
      const vehicleCountLabel = String(c.vehicleCount ?? c.vehicles?.length ?? 0);
      const durationLabel = calcDuration(c.startDate, c.endDate).toLowerCase();
      const monthlyRateLabel = String(c.monthlyRate ?? 0);

      if (!showInactive && c.status !== 'Active') return false;
      if (
        normalizedQuickSearch &&
        !c.contractNumber.toLowerCase().includes(normalizedQuickSearch) &&
        !c.lessee.toLowerCase().includes(normalizedQuickSearch)
      ) return false;
      if (normalizedContract && !c.contractNumber.toLowerCase().includes(normalizedContract)) return false;
      if (normalizedLessee && !c.lessee.toLowerCase().includes(normalizedLessee)) return false;
      if (columnFilters.agreementType && c.agreementType !== columnFilters.agreementType) return false;
      if (columnFilters.leaseType && c.leaseType !== columnFilters.leaseType) return false;
      if (normalizedVehicleCount && !vehicleCountLabel.includes(normalizedVehicleCount)) return false;
      if (normalizedDuration && !durationLabel.includes(normalizedDuration)) return false;
      if (normalizedMonthlyRate && !monthlyRateLabel.includes(normalizedMonthlyRate)) return false;
      if (columnFilters.status && c.status !== columnFilters.status) return false;
      if (normalizedBranch && !(c.branch || '').toLowerCase().includes(normalizedBranch)) return false;
      return true;
    });

    return [...visibleContracts].sort((a, b) => {
      const direction = sortDirection === 'asc' ? 1 : -1;

      const getValue = (contract: Contract) => {
        switch (sortKey) {
          case 'contractNumber':
            return contract.contractNumber;
          case 'lessee':
            return contract.lessee;
          case 'agreementType':
            return contract.agreementType;
          case 'leaseType':
            return contract.leaseType;
          case 'vehicleCount':
            return contract.vehicleCount ?? contract.vehicles?.length ?? 0;
          case 'duration':
            return getContractDurationMonths(contract);
          case 'monthlyRate':
            return contract.monthlyRate ?? 0;
          case 'status':
            return contract.status;
          case 'branch':
            return contract.branch || '';
          default:
            return contract.contractNumber;
        }
      };

      const left = getValue(a);
      const right = getValue(b);

      if (typeof left === 'number' && typeof right === 'number') {
        return (left - right) * direction;
      }

      return String(left).localeCompare(String(right)) * direction;
    });
  }, [columnFilters, contracts, quickSearch, showInactive, sortDirection, sortKey]);

  const stats = {
    active: contracts.filter(c => c.status === 'Active').length,
    draftPending: contracts.filter(c => c.status === 'Draft' || c.status === 'Pending Approval').length,
    expiring: contracts.filter(c => {
      const d = (new Date(c.endDate).getTime() - Date.now()) / 86400000;
      return d > 0 && d <= 30;
    }).length,
    multiVehicle: contracts.filter(c => (c.vehicleCount ?? 0) > 1).length,
  };

  const getColumnValue = (contract: Contract, key: SortKey) => {
    switch (key) {
      case 'contractNumber':
        return contract.contractNumber;
      case 'lessee':
        return contract.lessee;
      case 'agreementType':
        return contract.agreementType;
      case 'leaseType':
        return formatLeaseTypeLabel(contract.leaseType);
      case 'vehicleCount':
        return `${contract.vehicleCount ?? contract.vehicles?.length ?? 0}`;
      case 'duration':
        return calcDuration(contract.startDate, contract.endDate);
      case 'monthlyRate':
        return `${(contract.monthlyRate ?? 0).toLocaleString()} AED`;
      case 'status':
        return contract.status;
      case 'branch':
        return contract.branch || '-';
      default:
        return '';
    }
  };

  const exportColumns = visibleColumns.map((column) => column.label);
  const exportRows = filtered.map((contract) =>
    visibleColumns.reduce<Record<string, string | number>>((row, column) => {
      row[column.label] = getColumnValue(contract, column.key);
      return row;
    }, {}),
  );

  const renderFilterControl = (key: SortKey) => {
    switch (key) {
      case 'agreementType':
        return (
          <select value={columnFilters.agreementType} onChange={(e) => updateColumnFilter('agreementType', e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-white focus:border-blue-500/50 focus:outline-none">
            <option value="">All</option>
            <option value="MASTER">Master</option>
            <option value="INDIVIDUAL">Individual</option>
          </select>
        );
      case 'leaseType':
        return (
          <select value={columnFilters.leaseType} onChange={(e) => updateColumnFilter('leaseType', e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-white focus:border-blue-500/50 focus:outline-none">
            <option value="">All</option>
            <option value="LONG_TERM">Long Term</option>
            <option value="SHORT_TERM">Short Term</option>
            <option value="DAILY">Daily</option>
            <option value="MONTHLY">Monthly</option>
          </select>
        );
      case 'status':
        return (
          <select value={columnFilters.status} onChange={(e) => updateColumnFilter('status', e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-white focus:border-blue-500/50 focus:outline-none">
            <option value="">All</option>
            <option value="Active">Active</option>
            <option value="Draft">Draft</option>
            <option value="Pending Approval">Pending Approval</option>
            <option value="Expired">Expired</option>
            <option value="Terminated">Terminated</option>
            <option value="Closed">Closed</option>
          </select>
        );
      case 'vehicleCount':
        return <input type="text" placeholder="Units..." value={columnFilters.vehicleCount} onChange={(e) => updateColumnFilter('vehicleCount', e.target.value)} className="w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500/50 focus:outline-none" />;
      case 'duration':
        return <input type="text" placeholder="e.g. 36" value={columnFilters.duration} onChange={(e) => updateColumnFilter('duration', e.target.value)} className="w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500/50 focus:outline-none" />;
      case 'monthlyRate':
        return <input type="text" placeholder="Amount..." value={columnFilters.monthlyRate} onChange={(e) => updateColumnFilter('monthlyRate', e.target.value)} className="w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500/50 focus:outline-none" />;
      case 'branch':
        return <input type="text" placeholder="Search..." value={columnFilters.branch} onChange={(e) => updateColumnFilter('branch', e.target.value)} className="w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500/50 focus:outline-none" />;
      case 'contractNumber':
        return <input type="text" placeholder="Search..." value={columnFilters.contractNumber} onChange={(e) => updateColumnFilter('contractNumber', e.target.value)} className="w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500/50 focus:outline-none" />;
      case 'lessee':
        return <input type="text" placeholder="Search..." value={columnFilters.lessee} onChange={(e) => updateColumnFilter('lessee', e.target.value)} className="w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500/50 focus:outline-none" />;
      default:
        return null;
    }
  };

  const renderContractCell = (contract: Contract, key: SortKey) => {
    const style = getColumnStyle(key);
    switch (key) {
      case 'contractNumber':
        return (
          <td className="smart-data-grid-cell px-4 py-3.5" style={style}>
            <div className="text-sm font-bold text-white whitespace-nowrap">{contract.contractNumber}</div>
            <div className="mt-1 text-xs text-slate-500">Contract record</div>
          </td>
        );
      case 'lessee':
        return (
          <td className="smart-data-grid-cell px-4 py-3.5" style={style}>
            <div className="text-sm font-medium text-white">{contract.lessee}</div>
            <div className="mt-1 text-xs text-slate-500">{contract.agreementType === 'MASTER' ? 'Corporate account' : 'Individual account'}</div>
          </td>
        );
      case 'agreementType':
        return (
          <td className="smart-data-grid-cell px-4 py-3.5" style={style}>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${getBadge('agreement', contract.agreementType)}`}>{contract.agreementType}</span>
          </td>
        );
      case 'leaseType':
        return (
          <td className="smart-data-grid-cell px-4 py-3.5" style={style}>
            <span className={`inline-flex whitespace-nowrap px-2 py-0.5 rounded-full text-xs font-medium border ${getBadge('lease', contract.leaseType)}`}>{formatLeaseTypeLabel(contract.leaseType)}</span>
          </td>
        );
      case 'vehicleCount':
        return (
          <td className="smart-data-grid-cell px-4 py-3.5" style={style}>
            <button onClick={() => setExpandedVehicles(prev => {
              const next = new Set(prev);
              if (next.has(contract.id)) next.delete(contract.id); else next.add(contract.id);
              return next;
            })}
              className="px-3 py-1 rounded-full bg-slate-700/60 text-white text-xs font-semibold hover:bg-slate-600/60 transition-colors">
              {contract.vehicleCount ?? (contract.vehicles?.length ?? 0)} unit{(contract.vehicleCount ?? 0) !== 1 ? 's' : ''}
            </button>
          </td>
        );
      case 'duration':
        return (
          <td className="smart-data-grid-cell px-4 py-3.5" style={style}>
            <div className="text-sm font-semibold text-white">{calcDuration(contract.startDate, contract.endDate)}</div>
            <div className="mt-1 text-xs text-slate-500">{contract.startDate} to {contract.endDate}</div>
          </td>
        );
      case 'monthlyRate':
        return <td className="smart-data-grid-cell px-4 py-3.5 text-sm font-semibold text-white" style={style}>{(contract.monthlyRate ?? 0).toLocaleString()} AED</td>;
      case 'status':
        return (
          <td className="smart-data-grid-cell px-4 py-3.5" style={style}>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${getBadge('status', contract.status)}`}>{contract.status}</span>
          </td>
        );
      case 'branch':
        return <td className="smart-data-grid-cell px-4 py-3.5" style={style}><div className="text-sm text-slate-200">{contract.branch || '-'}</div></td>;
      default:
        return null;
    }
  };

  const handleCreateContract = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/leasing/contracts-v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newContractForm, allowCrossBranchOverride: newContractShowOtherBranches }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setShowNewContract(false);
        setNewContractForm({ step: 1, lessee: '', agreementType: 'INDIVIDUAL', masterContractId: '', leaseType: 'LONG_TERM', durationMonths: '', startDate: '', endDate: '', monthlyRate: '', currency: 'AED', securityDeposit: '', mileageCap: '', branch: '', openingBranchId: '', vehicles: [], insuranceIncluded: false, maintenanceIncluded: false, driverIncluded: false, notes: '' });
        setNewContractVehicleId('');
        setNewContractShowOtherBranches(false);
        loadFleetVehicles();
        loadContracts();
        if (Array.isArray(data.approvalRequests) && data.approvalRequests.length > 0) {
          alert(`${data.approvalRequests.length} cross-branch vehicle assignment approval request(s) were queued.`);
        }
      } else { alert(data.error ?? 'Failed to create contract'); }
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
      <KpiGrid>
        {[
          { label: 'Active', value: stats.active, accent: 'emerald' as const, icon: BadgeCheck, sub: 'Live contracts' },
          { label: 'Draft / Pending', value: stats.draftPending, accent: 'amber' as const, icon: Clock3, sub: 'Needs action' },
          { label: 'Expiring This Month', value: stats.expiring, accent: 'rose' as const, icon: CalendarClock, sub: 'Renew soon' },
          { label: 'Multi-Vehicle', value: stats.multiVehicle, accent: 'violet' as const, icon: Layers3, sub: 'Fleet bundles' },
        ].map((s) => (
          <KpiCard
            key={s.label}
            label={s.label}
            value={s.value}
            accent={s.accent}
            icon={s.icon}
            sub={s.sub}
          />
        ))}
      </KpiGrid>

      <div className="mb-4 flex justify-end">
        <DataTableToolbar
          filtersOpen={showTableFilters}
          onToggleFilters={() => setShowTableFilters((current) => !current)}
          onExportExcel={() => downloadXLSX('lease-agreements-export', exportRows, exportColumns)}
          onExportPdf={() => downloadTablePdf({
            filename: 'lease-agreements-export.pdf',
            title: 'Lease Agreements',
            columns: exportColumns,
            rows: exportRows,
          })}
          columns={columns}
          onToggleColumn={toggleColumn}
          onMoveColumn={moveColumn}
          onResizeColumn={(key, direction) => resizeColumn(key, direction === 'wider' ? 24 : -24)}
          leftSlot={(
            <label className="data-grid-toggle flex min-w-max items-center gap-3 rounded-full border border-white/12 bg-slate-950/45 px-3 py-1.5 text-sm font-semibold text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <span className={`data-grid-toggle-track relative inline-flex h-8 w-14 items-center rounded-full border transition ${showInactive ? 'data-grid-toggle-track--active border-blue-300/55 bg-blue-500/35 shadow-[0_0_0_3px_rgba(59,130,246,0.18)]' : 'border-white/15 bg-slate-800/90'}`}>
                <span className={`inline-block h-6 w-6 rounded-full bg-white shadow-sm transition ${showInactive ? 'data-grid-toggle-thumb--active translate-x-7' : 'translate-x-1'}`} />
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={showInactive}
                  onChange={(e) => setShowInactive(e.target.checked)}
                />
              </span>
              <span className="data-grid-toggle-label inline-block whitespace-nowrap tracking-[0.01em] text-slate-50">Show Inactive</span>
            </label>
          )}
        />
      </div>

      {/* Grid Table */}
      <div className="smart-data-grid-surface">
        <table className="w-full min-w-[1320px]">
          <SmartDataGridHeader
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSort={(key) => toggleSort(key as SortKey)}
            columns={visibleColumns.map((column) => ({
              key: column.key,
              label: column.label,
              sortable: true,
              width: column.width,
              headerClassName: 'text-[11px] uppercase tracking-[0.08em]',
              filterClassName: 'px-4 py-2',
              filter: showTableFilters ? renderFilterControl(column.key) : undefined,
            }))}
            actionHeader="Actions"
            actionFilter={
              showTableFilters ? (
                <button
                  type="button"
                  onClick={() => {
                    setColumnFilters({
                      contractNumber: '',
                      lessee: '',
                      agreementType: '',
                      leaseType: '',
                      vehicleCount: '',
                      duration: '',
                      monthlyRate: '',
                      status: '',
                      branch: '',
                    });
                    setQuickSearch('');
                    setSortKey('contractNumber');
                    setSortDirection('asc');
                  }}
                  className="rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-300 transition hover:border-white/20 hover:text-white"
                >
                  Reset
                </button>
              ) : undefined
            }
          />
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={visibleColumns.length + 1} className="px-4 py-12 text-center text-slate-500">No contracts found</td></tr>
            ) : filtered.map(c => (
              <React.Fragment key={c.id}>
                <tr className="border-b border-white/5 hover:bg-white/[0.03] transition-colors">
                  {visibleColumns.map((column) => (
                    <React.Fragment key={column.key}>
                      {renderContractCell(c, column.key)}
                    </React.Fragment>
                  ))}
                  <td className="smart-data-grid-cell px-4 py-3.5">
                    <RowActionMenu
                      side="top"
                      actions={[
                        {
                          label: 'View',
                          tone: 'info',
                          onSelect: () => setSelectedContract(c),
                        },
                        {
                          label: 'Download PDF (EN)',
                          tone: 'success',
                          onSelect: () => window.open(`/api/leasing/contracts-v2/${c.id}/pdf?lang=en&download=1`, '_blank', 'noopener,noreferrer'),
                        },
                        {
                          label: 'Download PDF (AR)',
                          tone: 'success',
                          onSelect: () => window.open(`/api/leasing/contracts-v2/${c.id}/pdf?lang=ar&download=1`, '_blank', 'noopener,noreferrer'),
                        },
                        {
                          label: 'Add Vehicle',
                          tone: 'accent',
                          onSelect: () => {
                            setShowAddVehicle(c);
                            setSelectedFleetVehicleId('');
                            setShowOtherBranchVehicles(false);
                            setNewVehicleForm({ type: '', make: '', model: '', licensePlate: '', driver: '', monthlyRate: '' });
                            setAddVehicleMsg('');
                            loadFleetVehicles();
                          },
                        },
                        {
                          label: 'Close Agreement',
                          tone: 'danger',
                          disabled: c.status !== 'Active',
                          onSelect: () => {
                            setShowCloseContract(c);
                            setCloseContractForm({
                              closingBranchId: c.branch || '',
                              returnCondition: 'GOOD',
                              returnMileage: '',
                              depositSettlementAmount: '',
                              finalReceiptAmount: '',
                              finalReceiptPaymentMethod: 'BANK_TRANSFER',
                              finalReceiptNotes: '',
                            });
                            setCloseContractMsg('');
                          },
                        },
                        {
                          label: 'Payments',
                          tone: 'warning',
                          onSelect: () => {
                            setShowPaymentSchedule(c.id);
                            setPaymentScheduleMonths(String(getContractDurationMonths(c)));
                            setPaymentPreview([]);
                            setPaymentScheduleMsg('');
                          },
                        },
                      ]}
                    />
                    <div className="hidden flex gap-1.5 flex-wrap">
                      <button
                        onClick={() => setSelectedContract(c)}
                        className="px-2.5 py-1 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 text-xs hover:bg-blue-500/30 transition-all font-medium">
                        View
                      </button>
                      <a
                        href={`/api/leasing/contracts-v2/${c.id}/pdf?lang=en&download=1`}
                        className="px-2.5 py-1 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs hover:bg-emerald-500/30 transition-all font-medium"
                        title="Download bilingual lease agreement (EN layout)">
                        PDF·EN
                      </a>
                      <a
                        href={`/api/leasing/contracts-v2/${c.id}/pdf?lang=ar&download=1`}
                        className="px-2.5 py-1 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs hover:bg-emerald-500/30 transition-all font-medium"
                        title="Download bilingual lease agreement (AR layout)">
                        PDF·AR
                      </a>
                      <button
                        onClick={() => { setShowAddVehicle(c); setNewVehicleForm({ type: '', make: '', model: '', licensePlate: '', driver: '', monthlyRate: '' }); setAddVehicleMsg(''); }}
                        className="px-2.5 py-1 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs hover:bg-indigo-500/30 transition-all font-medium">
                        Add Vehicle
                      </button>
                      <button
                        onClick={() => {
                          setShowPaymentSchedule(c.id);
                          setPaymentScheduleMonths(String(getContractDurationMonths(c)));
                          setPaymentPreview([]);
                          setPaymentScheduleMsg('');
                        }}
                        className="px-2.5 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs hover:bg-amber-500/30 transition-all font-medium">
                        Payments
                      </button>
                    </div>
                  </td>
                </tr>
                {/* Expanded vehicles */}
                {expandedVehicles.has(c.id) && (
                  <tr className="border-b border-white/5 bg-slate-800/30">
                    <td colSpan={visibleColumns.length + 1} className="px-6 py-4">
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
                onClick={() => { setShowAddVehicle(selectedContract); setSelectedContract(null); setSelectedFleetVehicleId(''); setShowOtherBranchVehicles(false); setNewVehicleForm({ type: '', make: '', model: '', licensePlate: '', driver: '', monthlyRate: '' }); setAddVehicleMsg(''); loadFleetVehicles(); }}
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
            <div className="p-6 space-y-4">
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label className="block text-xs font-semibold text-slate-400">Available Fleet Vehicle</label>
                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                    <input
                      type="checkbox"
                      checked={showOtherBranchVehicles}
                      onChange={(e) => setShowOtherBranchVehicles(e.target.checked)}
                      className="h-4 w-4 accent-indigo-500"
                    />
                    Show other branches
                  </label>
                </div>
                <select
                  value={selectedFleetVehicleId}
                  onChange={(e) => setSelectedFleetVehicleId(e.target.value)}
                  className="w-full px-3 py-2.5 bg-slate-900/60 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                >
                  <option value="">{fleetVehiclesLoading ? 'Loading vehicles...' : 'Select available vehicle'}</option>
                  {filteredFleetVehiclesForAdd.map(vehicle => (
                    <option key={vehicle.id} value={vehicle.id}>{vehicleLabel(vehicle)}</option>
                  ))}
                </select>
                <p className="mt-2 text-xs text-slate-500">
                  Default list shows only available vehicles in this agreement's opening branch. Other branch selections queue an approval override.
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Monthly Rate Override (AED)</label>
                <input
                  type="number"
                  placeholder={`${showAddVehicle.monthlyRate || 0}`}
                  value={newVehicleForm.monthlyRate}
                  onChange={e => setNewVehicleForm(p => ({ ...p, monthlyRate: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-900/60 border border-white/10 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
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
                disabled={addingVehicle || !selectedFleetVehicleId}
                onClick={async () => {
                  setAddingVehicle(true);
                  setAddVehicleMsg('');
                  try {
                    const res = await fetch(`/api/leasing/contracts-v2/${showAddVehicle.id}/vehicles`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        vehicleId: selectedFleetVehicleId,
                        monthlyRate: parseFloat(newVehicleForm.monthlyRate) || showAddVehicle.monthlyRate || 0,
                        allowCrossBranchOverride: showOtherBranchVehicles,
                      }),
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
                      loadFleetVehicles();
                      setTimeout(() => setShowAddVehicle(null), 1200);
                    } else {
                      const approvalId = data?.approvalRequest?.id;
                      setAddVehicleMsg(
                        approvalId
                          ? `Error: Cross-branch override queued for approval (${approvalId}). Approve it, then retry with the approved request.`
                          : `Error: ${data.error ?? data.message ?? 'Failed to add vehicle'}`,
                      );
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

      {/*  CLOSE AGREEMENT MODAL  */}
      {showCloseContract && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-white/10 rounded-2xl w-full max-w-2xl shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <div>
                <h2 className="text-xl font-bold text-white">Close Agreement</h2>
                <p className="text-xs text-slate-400 mt-0.5">{showCloseContract.contractNumber} &middot; {showCloseContract.lessee}</p>
              </div>
              <button onClick={() => setShowCloseContract(null)} className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white text-lg transition-all">x</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Close Branch</label>
                  <select
                    value={closeContractForm.closingBranchId}
                    onChange={(e) => setCloseContractForm(p => ({ ...p, closingBranchId: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-slate-900/60 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="">Select branch</option>
                    {branchOptions.map(branch => (
                      <option key={branch.id} value={branch.id}>{branch.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Return Condition</label>
                  <select
                    value={closeContractForm.returnCondition}
                    onChange={(e) => setCloseContractForm(p => ({ ...p, returnCondition: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-slate-900/60 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="GOOD">Good</option>
                    <option value="FAIR">Fair</option>
                    <option value="DAMAGED">Damaged</option>
                    <option value="TOTAL_LOSS">Total loss</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Return Mileage</label>
                  <input
                    type="number"
                    value={closeContractForm.returnMileage}
                    onChange={(e) => setCloseContractForm(p => ({ ...p, returnMileage: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-slate-900/60 border border-white/10 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500"
                    placeholder="Final odometer"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Deposit Settlement (AED)</label>
                  <input
                    type="number"
                    value={closeContractForm.depositSettlementAmount}
                    onChange={(e) => setCloseContractForm(p => ({ ...p, depositSettlementAmount: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-slate-900/60 border border-white/10 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500"
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Final Receipt Amount (AED)</label>
                  <input
                    type="number"
                    value={closeContractForm.finalReceiptAmount}
                    onChange={(e) => setCloseContractForm(p => ({ ...p, finalReceiptAmount: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-slate-900/60 border border-white/10 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500"
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Receipt Method</label>
                  <select
                    value={closeContractForm.finalReceiptPaymentMethod}
                    onChange={(e) => setCloseContractForm(p => ({ ...p, finalReceiptPaymentMethod: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-slate-900/60 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="BANK_TRANSFER">Bank transfer</option>
                    <option value="CASH">Cash</option>
                    <option value="CARD">Card</option>
                    <option value="CHEQUE">Cheque</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Settlement Notes</label>
                <textarea
                  value={closeContractForm.finalReceiptNotes}
                  onChange={(e) => setCloseContractForm(p => ({ ...p, finalReceiptNotes: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2.5 bg-slate-900/60 border border-white/10 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500 resize-none"
                  placeholder="Close notes, damage remarks, deposit adjustment details..."
                />
              </div>
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-200">
                Closing releases all active agreement vehicles back to Fleet Master as AVAILABLE and moves them to the close branch when a branch is selected.
              </div>
              {closeContractMsg && (
                <div className={`rounded-lg border px-4 py-2 text-sm ${closeContractMsg.startsWith('Error') ? 'border-rose-500/20 bg-rose-500/10 text-rose-300' : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'}`}>
                  {closeContractMsg}
                </div>
              )}
            </div>
            <div className="p-6 border-t border-white/10 flex gap-3 justify-end">
              <button
                onClick={() => setShowCloseContract(null)}
                className="px-5 py-2.5 rounded-xl border border-white/10 text-slate-300 hover:bg-white/5 font-medium transition-all text-sm"
              >
                Cancel
              </button>
              <button
                disabled={closingContract || !closeContractForm.closingBranchId}
                onClick={async () => {
                  setClosingContract(true);
                  setCloseContractMsg('');
                  try {
                    const res = await fetch(`/api/leasing/contracts-v2/${showCloseContract.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        action: 'close',
                        closingBranchId: closeContractForm.closingBranchId,
                        returnCondition: closeContractForm.returnCondition,
                        returnMileage: closeContractForm.returnMileage,
                        depositSettlementAmount: closeContractForm.depositSettlementAmount,
                        finalReceiptAmount: closeContractForm.finalReceiptAmount,
                        finalReceiptPaymentMethod: closeContractForm.finalReceiptPaymentMethod,
                        finalReceiptNotes: closeContractForm.finalReceiptNotes,
                      }),
                    });
                    const data = await res.json().catch(() => ({}));
                    if (res.ok) {
                      setCloseContractMsg('Agreement closed and Fleet vehicles released.');
                      await loadContracts();
                      loadFleetVehicles();
                      setTimeout(() => setShowCloseContract(null), 900);
                    } else {
                      setCloseContractMsg(`Error: ${data.error ?? data.message ?? 'Failed to close agreement'}`);
                    }
                  } catch {
                    setCloseContractMsg('Error: Could not connect to server');
                  } finally {
                    setClosingContract(false);
                  }
                }}
                className="px-6 py-2.5 rounded-xl bg-rose-600 text-white font-bold hover:bg-rose-500 transition-all disabled:opacity-50 text-sm"
              >
                {closingContract ? 'Closing...' : 'Close Agreement'}
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
                <button onClick={() => { setPaymentScheduleMsg(''); generatePaymentPreview(); }}
                  className="px-5 py-2.5 rounded-xl bg-amber-600 text-white font-semibold hover:bg-amber-500 transition-all text-sm">
                  Generate Preview
                </button>
                {paymentScheduleMsg && (
                  <div className={`px-4 py-2 rounded-lg text-sm border ${
                    paymentScheduleMsg.startsWith('Error:')
                      ? 'bg-rose-500/10 text-rose-300 border-rose-500/20'
                      : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                  }`}>
                    {paymentScheduleMsg}
                  </div>
                )}
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
                            const data = await res.json().catch(() => ({}));
                            if (res.ok) {
                              const replaced = Number(data?.replacedPendingRows ?? 0);
                              setPaymentScheduleMsg(
                                replaced > 0
                                  ? `Payment schedule saved. Replaced ${replaced} pending row(s).`
                                  : 'Payment schedule saved successfully.',
                              );
                              setPaymentPreview([]);
                            } else {
                              setPaymentScheduleMsg(`Error: ${data?.error ?? 'Failed to save payment schedule'}`);
                            }
                          } catch {
                            setPaymentScheduleMsg('Error: Could not connect to server');
                          }
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
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">Opening Branch</label>
                    <select value={newContractForm.openingBranchId}
                      onChange={e => {
                        const branchId = e.target.value;
                        setNewContractForm(p => ({
                          ...p,
                          branch: branchId,
                          openingBranchId: branchId,
                          vehicles: newContractShowOtherBranches
                            ? p.vehicles
                            : p.vehicles.filter(v => !branchId || v.branchId === branchId),
                        }));
                      }}
                      className="w-full px-3 py-2.5 bg-slate-900/60 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500/50">
                      <option value="">Select branch</option>
                      {branchOptions.map(branch => (
                        <option key={branch.id} value={branch.id}>{branch.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </>)}

              {/* Step 2 */}
              {newContractForm.step === 2 && (<>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-white">Assign Fleet Vehicles <span className="text-slate-500 font-normal">(optional - can add later)</span></h3>
                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                    <input
                      type="checkbox"
                      checked={newContractShowOtherBranches}
                      onChange={(e) => setNewContractShowOtherBranches(e.target.checked)}
                      className="h-4 w-4 accent-blue-500"
                    />
                    Show other branches
                  </label>
                </div>
                <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Available Fleet Vehicle</label>
                  <div className="flex gap-3">
                    <select
                      value={newContractVehicleId}
                      onChange={(e) => setNewContractVehicleId(e.target.value)}
                      className="min-w-0 flex-1 px-3 py-2.5 bg-slate-900/60 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500/50"
                    >
                      <option value="">{fleetVehiclesLoading ? 'Loading vehicles...' : 'Select available vehicle'}</option>
                      {filteredFleetVehiclesForNewContract.map(vehicle => (
                        <option key={vehicle.id} value={vehicle.id}>{vehicleLabel(vehicle)}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!newContractVehicleId}
                      onClick={() => {
                        const selected = fleetVehicles.find(vehicle => vehicle.id === newContractVehicleId);
                        if (!selected) return;
                        setNewContractForm(p => {
                          if (p.vehicles.some(vehicle => vehicle.vehicleId === selected.id)) return p;
                          return { ...p, vehicles: [...p.vehicles, fleetToContractVehicle(selected)] };
                        });
                        setNewContractVehicleId('');
                      }}
                      className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-blue-500 disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    Only AVAILABLE Fleet Master vehicles are shown. Other-branch vehicles require approval when attached after the agreement is created.
                  </p>
                </div>
                <div className="space-y-3">
                  {newContractForm.vehicles.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-500">
                      No Fleet vehicles selected yet.
                    </div>
                  ) : newContractForm.vehicles.map((v, idx) => (
                    <div key={v.id} className="bg-slate-900/50 border border-white/10 rounded-xl p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-bold text-white">{v.licensePlate || 'Unregistered'} - {v.make} {v.model}</p>
                          <p className="mt-1 text-xs text-slate-400">{v.type} {v.branchName ? `- ${v.branchName}` : ''}</p>
                          {v.lastOdometer !== null && v.lastOdometer !== undefined && (
                            <p className="mt-1 text-xs text-slate-500">Odometer: {Number(v.lastOdometer).toLocaleString()}</p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setNewContractForm(p => ({ ...p, vehicles: p.vehicles.filter((_, i) => i !== idx) }))}
                          className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-300 hover:bg-rose-500/20"
                        >
                          Remove
                        </button>
                      </div>
                      <div className="mt-3">
                        <label className="block text-xs font-semibold text-slate-400 mb-1.5">Monthly Rate Override (AED)</label>
                        <input
                          type="number"
                          value={v.monthlyRate || ''}
                          onChange={e => {
                            const up = [...newContractForm.vehicles];
                            up[idx] = { ...up[idx], monthlyRate: parseFloat(e.target.value) || 0 };
                            setNewContractForm(p => ({ ...p, vehicles: up }));
                          }}
                          className="w-full px-3 py-2 bg-slate-800/60 border border-white/10 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500/50"
                        />
                      </div>
                    </div>
                  ))}
                </div>
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
