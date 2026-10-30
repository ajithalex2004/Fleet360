'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  Layers, Package, AlertTriangle, CheckCircle2, Clock, Plus,
  Download, UploadCloud, Search, Filter, RefreshCw, X, ShieldCheck,
  FileSpreadsheet, ArrowRight, Key, ShieldAlert, Calendar, CheckCheck,
} from 'lucide-react';
import { PageHeader, KpiCard, Panel, StatusPill } from '@/components/ui/page-theme';
import {
  fetchDrayageWorkspaceCached,
  getCachedDrayageData,
  invalidateDrayageClientCache,
} from '@/lib/logistics/drayage-client-cache';

interface DrayageContainer {
  id: string;
  containerNumber: string;
  size: string;
  containerType: string;
  shipmentType: string;
  status: string;
  customerName: string;
  terminalName: string;
  warehouseName: string;
  doExpiryDate: string | null;
  dischargeDate: string;
  emptyReturnDate: string | null;
  sealNumber: string | null;
  weightKg: number;
  customsInspection: boolean;
  municipalityInspection: boolean;
  cpipInspection: boolean;
  mercInspection: boolean;
  boxcareInspection: boolean;
  linkedTrailerPlate: string | null;
  demurrage: {
    status: 'SAFE' | 'WARNING' | 'CRITICAL_OVERDUE' | 'RETURNED';
    freeDaysAllowed: number;
    daysInPort: number;
    freeDaysRemaining: number;
    overdueDays: number;
    tierLabel: string;
    dailyRateAed: number;
    accruedPenaltyAed: number;
  };
  pcsTokenNumber?: string | null;
  pcsSlotStart?: string | null;
  pcsSlotEnd?: string | null;
  pcsTokenStatus?: string | null;
  inspectionStatus?: string | null;
  inspectionSealNumber?: string | null;
  inspectionClearedBy?: string | null;
  inspectionClearedAt?: string | null;
  doStatus?: string | null;
  doRevalidatedAt?: string | null;
}

export default function DrayageContainersPage() {
  const cached = getCachedDrayageData();
  const [loading, setLoading] = useState(!cached?.containers);
  const [containers, setContainers] = useState<DrayageContainer[]>(cached?.containers || []);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [gateFilter, setGateFilter] = useState<'ALL' | 'GATE_READY' | 'HOLD_PENDING' | 'DO_EXPIRED'>('ALL');

  // Create Container Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [containerNumber, setContainerNumber] = useState('');
  const [size, setSize] = useState('40HC');
  const [containerType, setContainerType] = useState('DRY');
  const [customerName, setCustomerName] = useState('Al-Futtaim Logistics LLC');
  const [terminalName, setTerminalName] = useState('Jebel Ali Port - Terminal 1 (DP World)');
  const [warehouseName, setWarehouseName] = useState('JAFZA South Bonded Fulfillment Hub (Gate 5)');
  const [doExpiryDate, setDoExpiryDate] = useState(new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10));
  const [dischargeDate, setDischargeDate] = useState(new Date().toISOString().slice(0, 10));
  const [sealNumber, setSealNumber] = useState('');
  const [weightKg, setWeightKg] = useState(22400);
  const [customsInspection, setCustomsInspection] = useState(true);
  const [municipalityInspection, setMunicipalityInspection] = useState(false);
  const [submittingCreate, setSubmittingCreate] = useState(false);

  // Bulk Upload state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [csvRawText, setCsvRawText] = useState('');

  // Option C: Inspection Clearance Modal
  const [inspectModal, setInspectModal] = useState<{
    open: boolean;
    container: DrayageContainer | null;
    agency: 'CUSTOMS' | 'MUNICIPALITY' | 'CPIP' | 'MERC' | 'BOXCARE' | 'ALL';
    newSeal: string;
    clearedBy: string;
    notes: string;
  }>({
    open: false,
    container: null,
    agency: 'CUSTOMS',
    newSeal: '',
    clearedBy: 'Dubai Customs Officer',
    notes: 'Physical inspection completed at port bay. Container resealed.',
  });

  // Option C: PCS e-Token Booking Modal
  const [tokenModal, setTokenModal] = useState<{
    open: boolean;
    container: DrayageContainer | null;
    slotWindowMinutes: number;
    terminalName: string;
  }>({
    open: false,
    container: null,
    slotWindowMinutes: 120,
    terminalName: 'Jebel Ali Port - Terminal 1 (DP World)',
  });

  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  const loadContainers = useCallback(async (forceFresh = false) => {
    try {
      if (!getCachedDrayageData()?.containers) {
        setLoading(true);
      }
      const data = await fetchDrayageWorkspaceCached({ forceFresh });
      setContainers(data?.containers || []);
    } catch (err) {
      if (!getCachedDrayageData()?.containers) {
        showToast('error', err instanceof Error ? err.message : 'Failed to fetch containers');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadContainers();
  }, [loadContainers]);

  const handleCreateContainer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!containerNumber.trim()) {
      showToast('error', 'Container number is required');
      return;
    }

    try {
      setSubmittingCreate(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_container',
          containerNumber: containerNumber.trim().toUpperCase(),
          size,
          containerType,
          customerName,
          terminalName,
          warehouseName,
          doExpiryDate,
          dischargeDate,
          sealNumber: sealNumber || `SL-${Math.floor(100000 + Math.random() * 900000)}`,
          weightKg: Number(weightKg),
          customsInspection,
          municipalityInspection,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create container');
      showToast('success', `Container ${containerNumber.toUpperCase()} added to inventory!`);
      setShowCreateModal(false);
      setContainerNumber('');
      invalidateDrayageClientCache();
      await loadContainers(true);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error creating container');
    } finally {
      setSubmittingCreate(false);
    }
  };

  const handleDownloadCsvTemplate = () => {
    const csvContent =
      'data:text/csv;charset=utf-8,ContainerNumber,Size,Type,CustomerName,TerminalName,WarehouseName,DOExpiryDate,DischargeDate,SealNumber,WeightKg\n' +
      'MSCU8492014,40HC,DRY,Al-Futtaim Logistics,Jebel Ali T1,JAFZA South Hub,2026-11-05,2026-10-25,SL-884120,22400\n' +
      'MAEU5910283,40HC,DRY,Landmark Retail,Jebel Ali T2,NIP Mega DC,2026-11-02,2026-10-24,SL-391044,26200\n';
    const encoded = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encoded);
    link.setAttribute('download', 'containers_upload_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleParseCsvUpload = async () => {
    const lines = csvRawText
      .split(/[\r\n]+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('ContainerNumber'));

    if (lines.length === 0) {
      showToast('error', 'No valid rows found in CSV data');
      return;
    }

    const parsedItems = lines.map((line) => {
      const parts = line.split(',').map((p) => p.trim().replace(/^"|"$/g, ''));
      return {
        containerNumber: parts[0] || 'MSCU' + Math.floor(1000000 + Math.random() * 9000000),
        size: parts[1] || '40HC',
        containerType: parts[2] || 'DRY',
        customerName: parts[3] || 'Al-Futtaim Logistics LLC',
        terminalName: parts[4] || 'Jebel Ali Port - Terminal 1 (DP World)',
        warehouseName: parts[5] || 'JAFZA South Bonded Fulfillment Hub',
        doExpiryDate: parts[6] || new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
        dischargeDate: parts[7] || new Date().toISOString().slice(0, 10),
        sealNumber: parts[8] || `SL-${Math.floor(100000 + Math.random() * 900000)}`,
        weightKg: Number(parts[9] || 22000),
      };
    });

    try {
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_container',
          containers: parsedItems,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to bulk import containers');
      showToast('success', `Imported ${data.createdCount} container(s) successfully!`);
      setShowUploadModal(false);
      setCsvRawText('');
      invalidateDrayageClientCache();
      await loadContainers(true);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error bulk importing');
    }
  };

  // Option C: Revalidate Delivery Order (+5 Days)
  const handleRevalidateDo = async (container: DrayageContainer) => {
    try {
      setActionLoading(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'revalidate_delivery_order',
          containerId: container.id,
          extendDays: 5,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to revalidate Delivery Order');
      showToast('success', `eDO for ${container.containerNumber} revalidated (+5 Days)! Valid til ${new Date(data.newDoExpiry).toLocaleDateString()}`);
      invalidateDrayageClientCache();
      await loadContainers(true);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'eDO revalidation failed');
    } finally {
      setActionLoading(false);
    }
  };

  // Option C: Submit Inspection Clearance
  const handleClearInspection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inspectModal.container) return;
    try {
      setActionLoading(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'clear_port_inspection',
          containerId: inspectModal.container.id,
          agency: inspectModal.agency,
          newSealNumber: inspectModal.newSeal || undefined,
          clearedBy: inspectModal.clearedBy,
          notes: inspectModal.notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to clear port inspection');
      showToast('success', `Inspection (${inspectModal.agency}) cleared for ${inspectModal.container.containerNumber}! Seal verified.`);
      setInspectModal({ ...inspectModal, open: false, container: null });
      invalidateDrayageClientCache();
      await loadContainers(true);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Inspection clearance failed');
    } finally {
      setActionLoading(false);
    }
  };

  // Option C: Book PCS Gate Token
  const handleBookToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenModal.container) return;
    try {
      setActionLoading(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'book_pcs_token',
          containerId: tokenModal.container.id,
          terminalName: tokenModal.terminalName,
          slotWindowMinutes: tokenModal.slotWindowMinutes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to book PCS Token');
      showToast('success', `PCS Gate Token ${data.tokenNumber} confirmed for ${tokenModal.container.containerNumber}!`);
      setTokenModal({ ...tokenModal, open: false, container: null });
      invalidateDrayageClientCache();
      await loadContainers(true);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Token booking failed');
    } finally {
      setActionLoading(false);
    }
  };

  // Helper: Determine PCS Gate Readiness status
  const getPcsGateReadiness = (c: DrayageContainer) => {
    const isDoExpired = c.doExpiryDate && new Date(c.doExpiryDate).getTime() < Date.now();
    const hasActiveHold = c.customsInspection || c.municipalityInspection || c.cpipInspection || c.mercInspection || c.boxcareInspection;
    const hasToken = Boolean(c.pcsTokenNumber);

    if (isDoExpired) {
      return { status: 'DO_EXPIRED', label: 'DO EXPIRED', color: 'bg-rose-500/15 text-rose-300 border-rose-500/30' };
    }
    if (hasActiveHold) {
      return { status: 'HOLD_PENDING', label: 'HOLD PENDING', color: 'bg-amber-500/15 text-amber-300 border-amber-500/30' };
    }
    if (hasToken) {
      return { status: 'TOKEN_ACTIVE', label: `TOKEN: ${c.pcsTokenNumber}`, color: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' };
    }
    return { status: 'GATE_READY', label: 'GATE READY', color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' };
  };

  // Filtered list
  const filteredContainers = useMemo(() => {
    return containers.filter((c) => {
      if (statusFilter !== 'ALL' && c.status !== statusFilter) return false;
      if (typeFilter !== 'ALL' && c.containerType !== typeFilter) return false;

      if (gateFilter !== 'ALL') {
        const readiness = getPcsGateReadiness(c);
        if (gateFilter === 'GATE_READY' && readiness.status !== 'GATE_READY' && readiness.status !== 'TOKEN_ACTIVE') return false;
        if (gateFilter === 'HOLD_PENDING' && readiness.status !== 'HOLD_PENDING') return false;
        if (gateFilter === 'DO_EXPIRED' && readiness.status !== 'DO_EXPIRED') return false;
      }

      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          c.containerNumber.toLowerCase().includes(q) ||
          c.customerName.toLowerCase().includes(q) ||
          c.terminalName.toLowerCase().includes(q) ||
          (c.pcsTokenNumber && c.pcsTokenNumber.toLowerCase().includes(q)) ||
          (c.linkedTrailerPlate && c.linkedTrailerPlate.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [containers, statusFilter, typeFilter, gateFilter, search]);

  const warningCount = containers.filter((c) => c.demurrage.status === 'WARNING').length;
  const overdueCount = containers.filter((c) => c.demurrage.status === 'CRITICAL_OVERDUE').length;
  const gateReadyCount = containers.filter((c) => {
    const r = getPcsGateReadiness(c);
    return r.status === 'GATE_READY' || r.status === 'TOKEN_ACTIVE';
  }).length;
  const holdsCount = containers.filter((c) => getPcsGateReadiness(c).status === 'HOLD_PENDING').length;
  const totalDemurrageAed = containers.reduce((acc, c) => acc + c.demurrage.accruedPenaltyAed, 0);

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-4 right-4 z-50 px-4 py-2.5 rounded-xl shadow-2xl border text-xs font-semibold flex items-center gap-2 ${
            toast.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200'
              : 'bg-rose-950/90 border-rose-500/40 text-rose-200'
          }`}
        >
          {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertTriangle className="w-4 h-4 text-rose-400" />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Header */}
      <PageHeader
        title="Port Container Inventory & PCS Compliance Desk"
        subtitle="Manage FCL container inventory, Dubai Trade / ATLP e-Tokens, Customs inspection holds, and eDO validity"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => loadContainers(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] hover:border-[var(--border-strong)] transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Sync PCS
            </button>
            <button
              onClick={handleDownloadCsvTemplate}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Template
            </button>
            <button
              onClick={() => setShowUploadModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/10 border border-blue-500/30 text-blue-400 text-xs font-semibold hover:bg-blue-600/20 transition-colors"
            >
              <UploadCloud className="w-3.5 h-3.5 text-blue-400" />
              Bulk CSV
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-500 transition-colors shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Container
            </button>
          </div>
        }
      />

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard
          label="Tracked Containers"
          value={containers.length}
          icon={Layers}
          accent="blue"
          sub="Dry, Reefer & Special"
        />
        <KpiCard
          label="PCS Gate Ready"
          value={gateReadyCount}
          icon={ShieldCheck}
          accent="emerald"
          sub="Valid eDO + Cleared"
        />
        <KpiCard
          label="Inspection Holds"
          value={holdsCount}
          icon={ShieldAlert}
          accent="amber"
          sub="Customs / CPIP Pending"
        />
        <KpiCard
          label="Approaching Free-Days (<48h)"
          value={warningCount}
          icon={Clock}
          accent="amber"
          sub="Expiring within 2 days"
        />
        <KpiCard
          label="In Ocean Demurrage"
          value={overdueCount}
          icon={AlertTriangle}
          accent="rose"
          sub={`AED ${totalDemurrageAed.toLocaleString()} penalty`}
        />
      </div>

      {/* Filter and Inventory Table */}
      <Panel
        title={`Container Inventory (${filteredContainers.length} Units)`}
        icon={Package}
        accent="blue"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={gateFilter}
              onChange={(e) => setGateFilter(e.target.value as any)}
              className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] outline-none focus:border-blue-500 font-semibold"
            >
              <option value="ALL">All PCS States</option>
              <option value="GATE_READY">Gate Ready / Token Booked</option>
              <option value="HOLD_PENDING">Inspection Holds Pending</option>
              <option value="DO_EXPIRED">DO Expired</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] outline-none focus:border-blue-500"
            >
              <option value="ALL">All Statuses</option>
              <option value="AT_PORT_DISCHARGED">At Port Discharged</option>
              <option value="IN_TRANSIT">In Transit</option>
              <option value="PLACED_AT_RAMP">Placed at Ramp</option>
              <option value="CONTAINER_DETACHED">Chassis Detached</option>
              <option value="EMPTY_DEPOSITED">Empty Deposited</option>
            </select>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] outline-none focus:border-blue-500"
            >
              <option value="ALL">All Types</option>
              <option value="DRY">DRY</option>
              <option value="REEFER">REEFER</option>
              <option value="OPEN_TOP">OPEN TOP</option>
              <option value="FLAT_RACK">FLAT RACK</option>
            </select>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[var(--text-muted)]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search container, token, trailer..."
                className="pl-8 pr-3 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] outline-none focus:border-blue-500 w-48 md:w-56"
              />
            </div>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-[var(--bg-main)] text-[var(--text-muted)] uppercase tracking-wider text-[10px] border-b border-[var(--border-subtle)]">
              <tr>
                <th className="py-2.5 px-3 font-semibold">Container Number</th>
                <th className="py-2.5 px-3 font-semibold">Type & Weight</th>
                <th className="py-2.5 px-3 font-semibold">Terminal & Destination</th>
                <th className="py-2.5 px-3 font-semibold">Demurrage Clock</th>
                <th className="py-2.5 px-3 font-semibold">PCS Gate Readiness & eDO</th>
                <th className="py-2.5 px-3 font-semibold">Port Inspection Holds</th>
                <th className="py-2.5 px-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)] text-[var(--text-main)]">
              {filteredContainers.map((c) => {
                const isOverdue = c.demurrage.status === 'CRITICAL_OVERDUE';
                const readiness = getPcsGateReadiness(c);
                const hasHold = c.customsInspection || c.municipalityInspection || c.cpipInspection || c.mercInspection || c.boxcareInspection;
                const isDoExpired = c.doExpiryDate && new Date(c.doExpiryDate).getTime() < Date.now();

                return (
                  <tr key={c.id} className="hover:bg-[var(--bg-surface-hover)] transition-colors">
                    <td className="py-3 px-3">
                      <div className="font-mono font-bold text-sm text-[var(--text-main)]">{c.containerNumber}</div>
                      <div className="text-[10px] text-[var(--text-muted)] truncate max-w-[140px]">{c.customerName}</div>
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-semibold">{c.size} · {c.containerType}</div>
                      <div className="text-[10px] text-[var(--text-muted)] font-mono">
                        {c.weightKg.toLocaleString()} kg · Seal: {c.sealNumber || 'SL-PENDING'}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-medium truncate max-w-[170px]">{c.terminalName}</div>
                      <div className="text-[10px] text-[var(--text-muted)] truncate max-w-[170px]">
                        Dest: {c.warehouseName}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      {isOverdue ? (
                        <div className="text-rose-400 font-bold">
                          {c.demurrage.overdueDays}d Overdue
                          <div className="text-[10px] text-[var(--text-muted)] font-normal">AED {c.demurrage.accruedPenaltyAed.toLocaleString()}</div>
                        </div>
                      ) : (
                        <div className="text-emerald-400 font-semibold">
                          {c.demurrage.freeDaysRemaining}d Remaining
                          <div className="text-[10px] text-[var(--text-muted)] font-normal">
                            Discharged: {new Date(c.dischargeDate).toLocaleDateString()}
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <div className="space-y-1">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border ${readiness.color}`}>
                          {readiness.status === 'GATE_READY' && <ShieldCheck className="w-3 h-3" />}
                          {readiness.status === 'TOKEN_ACTIVE' && <Key className="w-3 h-3" />}
                          {readiness.status === 'HOLD_PENDING' && <ShieldAlert className="w-3 h-3" />}
                          {readiness.status === 'DO_EXPIRED' && <AlertTriangle className="w-3 h-3" />}
                          {readiness.label}
                        </span>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          eDO Valid: {c.doExpiryDate ? new Date(c.doExpiryDate).toLocaleDateString() : 'N/A'}
                          {isDoExpired && <span className="text-rose-400 ml-1 font-bold">(EXPIRED)</span>}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      {hasHold ? (
                        <div className="flex flex-wrap gap-1">
                          {c.customsInspection && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                              CUSTOMS
                            </span>
                          )}
                          {c.municipalityInspection && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-500/15 text-purple-300 border border-purple-500/30">
                              MUNICIPALITY
                            </span>
                          )}
                          {c.cpipInspection && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/15 text-blue-300 border border-blue-500/30">
                              CPIP
                            </span>
                          )}
                          {c.mercInspection && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                              MERC
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-[10px] text-emerald-400 font-semibold">
                          <CheckCheck className="w-3.5 h-3.5" />
                          <span>All Inspections Cleared</span>
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {hasHold && (
                          <button
                            onClick={() =>
                              setInspectModal({
                                open: true,
                                container: c,
                                agency: c.customsInspection ? 'CUSTOMS' : 'ALL',
                                newSeal: `CUST-${c.containerNumber.slice(-5)}`,
                                clearedBy: 'Dubai Customs Officer',
                                notes: 'Physical inspection completed at inspection bay. Verified seal intact.',
                              })
                            }
                            className="px-2 py-1 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 text-[10px] font-bold transition-colors"
                          >
                            Clear Hold
                          </button>
                        )}
                        {!c.pcsTokenNumber && !hasHold && !isDoExpired && (
                          <button
                            onClick={() =>
                              setTokenModal({
                                open: true,
                                container: c,
                                slotWindowMinutes: 120,
                                terminalName: c.terminalName,
                              })
                            }
                            className="px-2 py-1 rounded bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/25 text-[10px] font-bold transition-colors"
                          >
                            Book Token
                          </button>
                        )}
                        {isDoExpired && (
                          <button
                            onClick={() => handleRevalidateDo(c)}
                            disabled={actionLoading}
                            className="px-2 py-1 rounded bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 text-[10px] font-bold transition-colors"
                          >
                            Revalidate eDO
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Option C: Multi-Agency Inspection Clearance Modal */}
      {inspectModal.open && inspectModal.container && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <div>
                <h3 className="text-sm font-bold text-[var(--text-main)] flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-amber-400" />
                  Port Inspection & Customs Clearance
                </h3>
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                  Container {inspectModal.container.containerNumber} at {inspectModal.container.terminalName}
                </p>
              </div>
              <button
                onClick={() => setInspectModal({ ...inspectModal, open: false, container: null })}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleClearInspection} className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">Clearance Agency</label>
                <select
                  value={inspectModal.agency}
                  onChange={(e) => setInspectModal({ ...inspectModal, agency: e.target.value as any })}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-amber-500"
                >
                  <option value="CUSTOMS">Dubai Customs / Federal Customs Authority</option>
                  <option value="MUNICIPALITY">Dubai Municipality (Food Safety / Public Health)</option>
                  <option value="CPIP">CPIP (Container Port Inspection Platform)</option>
                  <option value="MERC">MERC Inspection</option>
                  <option value="BOXCARE">Boxcare Inspection</option>
                  <option value="ALL">Clear All Agency Holds</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">New Customs Seal Number (Post-Inspection)</label>
                <input
                  type="text"
                  required
                  value={inspectModal.newSeal}
                  onChange={(e) => setInspectModal({ ...inspectModal, newSeal: e.target.value.toUpperCase() })}
                  placeholder="e.g. CUST-84920"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono font-bold outline-none focus:border-amber-500"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">Clearing Officer / Inspector Name</label>
                <input
                  type="text"
                  required
                  value={inspectModal.clearedBy}
                  onChange={(e) => setInspectModal({ ...inspectModal, clearedBy: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-amber-500"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">Inspection Notes & Bay Remarks</label>
                <textarea
                  rows={2}
                  value={inspectModal.notes}
                  onChange={(e) => setInspectModal({ ...inspectModal, notes: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => setInspectModal({ ...inspectModal, open: false, container: null })}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-bold hover:bg-amber-500 shadow-sm disabled:opacity-50"
                >
                  {actionLoading ? 'Clearing Hold...' : 'Certify & Clear Inspection'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Option C: PCS e-Token Booking Modal */}
      {tokenModal.open && tokenModal.container && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <div>
                <h3 className="text-sm font-bold text-[var(--text-main)] flex items-center gap-2">
                  <Key className="w-4 h-4 text-cyan-400" />
                  Book PCS Terminal Gate e-Token
                </h3>
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                  Dubai Trade / ATLP e-Appointment for {tokenModal.container.containerNumber}
                </p>
              </div>
              <button
                onClick={() => setTokenModal({ ...tokenModal, open: false, container: null })}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleBookToken} className="space-y-3.5 text-xs">
              <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-[11px] text-cyan-200">
                Booking an e-Token generates an official Port Gate pass and reserves a dedicated terminal gate slot window.
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">Port Terminal Gate</label>
                <input
                  type="text"
                  readOnly
                  value={tokenModal.terminalName}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">Gate Appointment Slot Window</label>
                <select
                  value={tokenModal.slotWindowMinutes}
                  onChange={(e) => setTokenModal({ ...tokenModal, slotWindowMinutes: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-cyan-500"
                >
                  <option value={120}>Immediate Slot (Next 2 Hours)</option>
                  <option value={240}>4-Hour Standard Window</option>
                  <option value={480}>Full Day Terminal Gate Access</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => setTokenModal({ ...tokenModal, open: false, container: null })}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-1.5 rounded-lg bg-cyan-600 text-white text-xs font-bold hover:bg-cyan-500 shadow-sm disabled:opacity-50"
                >
                  {actionLoading ? 'Booking e-Token...' : 'Confirm e-Token Appointment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Container Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <h3 className="text-sm font-bold text-[var(--text-main)] flex items-center gap-2">
                <Plus className="w-4 h-4 text-blue-400" />
                Add New Container to Inventory
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateContainer} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Container Number *</label>
                  <input
                    type="text"
                    value={containerNumber}
                    onChange={(e) => setContainerNumber(e.target.value.toUpperCase())}
                    placeholder="e.g. MSCU9912041"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono font-bold uppercase outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Size</label>
                  <select
                    value={size}
                    onChange={(e) => setSize(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                  >
                    <option value="40HC">40HC (High Cube)</option>
                    <option value="40FT">40FT (Standard)</option>
                    <option value="20FT">20FT (Dry Box)</option>
                    <option value="45HC">45HC (High Cube)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Type</label>
                  <select
                    value={containerType}
                    onChange={(e) => setContainerType(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                  >
                    <option value="DRY">DRY (General Merchandise)</option>
                    <option value="REEFER">REEFER (3-Day Free Limit)</option>
                    <option value="OPEN_TOP">OPEN TOP</option>
                    <option value="FLAT_RACK">FLAT RACK</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Gross Weight (kg)</label>
                  <input
                    type="number"
                    value={weightKg}
                    onChange={(e) => setWeightKg(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Discharge Date</label>
                  <input
                    type="date"
                    value={dischargeDate}
                    onChange={(e) => setDischargeDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">DO Expiry Date</label>
                  <input
                    type="date"
                    value={doExpiryDate}
                    onChange={(e) => setDoExpiryDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingCreate}
                  className="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-500 transition-colors shadow-sm disabled:opacity-50"
                >
                  {submittingCreate ? 'Saving...' : 'Add Container'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk CSV Paste Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <h3 className="text-sm font-bold text-[var(--text-main)] flex items-center gap-2">
                <UploadCloud className="w-4 h-4 text-blue-400" />
                Bulk CSV Container Upload
              </h3>
              <button
                onClick={() => setShowUploadModal(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              Paste CSV contents below matching columns: <code>ContainerNumber,Size,Type,CustomerName,TerminalName,WarehouseName,DOExpiryDate,DischargeDate,SealNumber,WeightKg</code>
            </p>
            <textarea
              rows={6}
              value={csvRawText}
              onChange={(e) => setCsvRawText(e.target.value)}
              placeholder="Paste raw CSV lines here..."
              className="w-full text-xs font-mono p-3 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
            />
            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={() => setShowUploadModal(false)}
                className="px-3 py-1.5 rounded-lg text-xs text-[var(--text-muted)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleParseCsvUpload}
                className="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-500 transition-colors"
              >
                Upload & Create Containers
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
