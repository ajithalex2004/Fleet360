'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Truck,
  Layers,
  Plus,
  Trash2,
  Edit3,
  Search,
  CheckCircle2,
  AlertTriangle,
  Download,
  X,
  MapPin,
  Settings2,
  Palette,
  RotateCcw,
} from 'lucide-react';
import { PageHeader, KpiCard, Panel, StatusPill } from '@/components/ui/page-theme';

interface TrailerTypeMaster {
  code: string;
  name: string;
  defaultCapacityTons: number;
  description: string;
  isCustom?: boolean;
}

interface OperationalStatusMaster {
  code: string;
  label: string;
  tone: 'emerald' | 'blue' | 'amber' | 'cyan' | 'purple' | 'rose' | 'slate';
  description: string;
  isCustom?: boolean;
}

const DEFAULT_TRAILER_TYPES: TrailerTypeMaster[] = [
  { code: '40FT_SKELETAL', name: '40FT Skeletal', defaultCapacityTons: 45, description: 'Standard container chassis for 40ft & 40HC dry and reefer containers' },
  { code: '20FT_SKELETAL', name: '20FT Skeletal', defaultCapacityTons: 36, description: 'Heavy-duty 20ft container chassis or bogie double configuration' },
  { code: '40FT_FLATBED', name: '40FT Flatbed', defaultCapacityTons: 45, description: 'Flatbed trailer suitable for container transport or breakbulk cargo' },
  { code: '45FT_REEFER_CHASSIS', name: '45FT Reefer Chassis', defaultCapacityTons: 40, description: 'Chassis with integrated diesel generator for active reefer cooling' },
  { code: '40FT_LOWBED', name: '40FT Lowbed', defaultCapacityTons: 60, description: 'Lowbed heavy-haul chassis for high-cube or out-of-gauge containers' },
  { code: '20FT_TIPPING_CHASSIS', name: '20FT Tipping Chassis', defaultCapacityTons: 35, description: 'Hydraulic tipping chassis for bulk resin and grain discharge' },
];

const DEFAULT_OPERATIONAL_STATUSES: OperationalStatusMaster[] = [
  { code: 'EMPTY', label: 'EMPTY', tone: 'emerald', description: 'Chassis is bare/empty, parked or moving to terminal for mounting' },
  { code: 'LOADED_FCL', label: 'LOADED FCL', tone: 'blue', description: 'Mounted with laden import or export container' },
  { code: 'DETACHED_AT_RAMP', label: 'DETACHED AT RAMP', tone: 'amber', description: 'Chassis uncoupled at customer warehouse dock for destuffing' },
  { code: 'DETACHED_AT_YARD', label: 'DETACHED AT YARD', tone: 'cyan', description: 'Chassis staged in carrier holding yard awaiting slot assignment' },
  { code: 'EN_ROUTE_MT', label: 'EN ROUTE MT', tone: 'purple', description: 'Empty container mounted, traveling to port or depot for return' },
  { code: 'UNDER_INSPECTION', label: 'UNDER INSPECTION', tone: 'rose', description: 'Temporary workshop hold for tyre, brake, or RTA roadworthiness inspection' },
];

const getToneClasses = (tone: OperationalStatusMaster['tone']) => {
  switch (tone) {
    case 'emerald':
      return 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400';
    case 'blue':
      return 'bg-blue-500/15 border-blue-500/30 text-blue-400';
    case 'amber':
      return 'bg-amber-500/15 border-amber-500/30 text-amber-400';
    case 'cyan':
      return 'bg-cyan-500/15 border-cyan-500/30 text-cyan-400';
    case 'purple':
      return 'bg-purple-500/15 border-purple-500/30 text-purple-400';
    case 'rose':
      return 'bg-rose-500/15 border-rose-500/30 text-rose-400';
    case 'slate':
    default:
      return 'bg-slate-500/15 border-slate-500/30 text-slate-400';
  }
};

interface DrayageTrailer {
  id: string;
  plateNumber: string;
  trailerType: string;
  capacityTons: number;
  masterStatus: 'AVAILABLE' | 'IN_USE' | 'MAINTENANCE';
  operationalStatus: string;
  linkedContainerNumber: string | null;
  currentLocation: string | null;
}

import {
  fetchDrayageWorkspaceCached,
  getCachedDrayageData,
  invalidateDrayageClientCache,
} from '@/lib/logistics/drayage-client-cache';

export default function DrayageTrailersPage() {
  const cached = getCachedDrayageData();
  const [, setLoading] = useState(!cached?.trailers);
  const [trailers, setTrailers] = useState<DrayageTrailer[]>(cached?.trailers || []);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Master Configuration State
  const [trailerTypes, setTrailerTypes] = useState<TrailerTypeMaster[]>(DEFAULT_TRAILER_TYPES);
  const [operationalStatuses, setOperationalStatuses] = useState<OperationalStatusMaster[]>(DEFAULT_OPERATIONAL_STATUSES);
  const [showMasterModal, setShowMasterModal] = useState(false);
  const [masterTab, setMasterTab] = useState<'TYPES' | 'STATUSES'>('STATUSES');

  // New Trailer Type Form State
  const [newTypeCode, setNewTypeCode] = useState('');
  const [newTypeName, setNewTypeName] = useState('');
  const [newTypeCapacity, setNewTypeCapacity] = useState(45);
  const [newTypeDesc, setNewTypeDesc] = useState('');

  // New Operational Status Form State
  const [newStatusCode, setNewStatusCode] = useState('');
  const [newStatusLabel, setNewStatusLabel] = useState('');
  const [newStatusTone, setNewStatusTone] = useState<OperationalStatusMaster['tone']>('cyan');
  const [newStatusDesc, setNewStatusDesc] = useState('');

  // Add / Edit Trailer Modal
  const [showModal, setShowModal] = useState(false);
  const [editingTrailer, setEditingTrailer] = useState<DrayageTrailer | null>(null);
  const [plateNumber, setPlateNumber] = useState('');
  const [trailerType, setTrailerType] = useState('40FT_SKELETAL');
  const [capacityTons, setCapacityTons] = useState(45);
  const [masterStatus, setMasterStatus] = useState<'AVAILABLE' | 'IN_USE' | 'MAINTENANCE'>('AVAILABLE');
  const [operationalStatus, setOperationalStatus] = useState('EMPTY');
  const [currentLocation, setCurrentLocation] = useState('Jebel Ali Main Yard');
  const [submitting, setSubmitting] = useState(false);

  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  // Load masters from localStorage on client
  useEffect(() => {
    try {
      const savedTypes = localStorage.getItem('fleet360_drayage_trailer_types_master');
      if (savedTypes) {
        const parsed = JSON.parse(savedTypes);
        if (Array.isArray(parsed) && parsed.length > 0) setTrailerTypes(parsed);
      }
      const savedStatuses = localStorage.getItem('fleet360_drayage_operational_statuses_master');
      if (savedStatuses) {
        const parsed = JSON.parse(savedStatuses);
        if (Array.isArray(parsed) && parsed.length > 0) setOperationalStatuses(parsed);
      }
    } catch {
      // ignore
    }
  }, []);

  const loadTrailers = useCallback(async (forceFresh = false) => {
    try {
      if (!getCachedDrayageData()?.trailers) {
        setLoading(true);
      }
      const data = await fetchDrayageWorkspaceCached({ forceFresh });
      setTrailers(data?.trailers || []);
    } catch (err) {
      if (!getCachedDrayageData()?.trailers) {
        showToast('error', err instanceof Error ? err.message : 'Failed to fetch trailers');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTrailers();
  }, [loadTrailers]);

  const handleOpenAdd = () => {
    setEditingTrailer(null);
    setPlateNumber(`DXB-TR-${Math.floor(1000 + Math.random() * 9000)}`);
    const initialType = trailerTypes[0]?.code || '40FT_SKELETAL';
    const initialCapacity = trailerTypes[0]?.defaultCapacityTons || 45;
    const initialStatus = operationalStatuses[0]?.code || 'EMPTY';
    setTrailerType(initialType);
    setCapacityTons(initialCapacity);
    setMasterStatus('AVAILABLE');
    setOperationalStatus(initialStatus);
    setCurrentLocation('Jebel Ali Main Yard');
    setShowModal(true);
  };

  const handleOpenEdit = (t: DrayageTrailer) => {
    setEditingTrailer(t);
    setPlateNumber(t.plateNumber);
    setTrailerType(t.trailerType);
    setCapacityTons(t.capacityTons);
    setMasterStatus(t.masterStatus);
    setOperationalStatus(t.operationalStatus);
    setCurrentLocation(t.currentLocation || 'Jebel Ali Main Yard');
    setShowModal(true);
  };

  const handleTypeChange = (selectedCode: string) => {
    setTrailerType(selectedCode);
    if (!editingTrailer) {
      const matched = trailerTypes.find((t) => t.code === selectedCode);
      if (matched) {
        setCapacityTons(matched.defaultCapacityTons);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!plateNumber.trim()) {
      showToast('error', 'Plate number is required');
      return;
    }

    try {
      setSubmitting(true);
      const action = editingTrailer ? 'update_trailer' : 'create_trailer';
      const body = {
        action,
        id: editingTrailer?.id,
        plateNumber: plateNumber.trim().toUpperCase(),
        trailerType,
        capacityTons: Number(capacityTons),
        masterStatus,
        operationalStatus,
        currentLocation,
      };

      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save trailer');

      showToast('success', editingTrailer ? 'Trailer updated successfully!' : 'Trailer registered successfully!');
      setShowModal(false);
      invalidateDrayageClientCache();
      await loadTrailers(true);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error saving trailer');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string, plate: string) => {
    if (!confirm(`Are you sure you want to delete trailer ${plate}?`)) return;
    try {
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_trailer', id }),
      });
      if (!res.ok) throw new Error('Failed to delete trailer');
      showToast('success', `Trailer ${plate} deleted`);
      invalidateDrayageClientCache();
      await loadTrailers(true);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error deleting trailer');
    }
  };

  // Master Management Handlers
  const handleAddTrailerType = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTypeCode.trim() || !newTypeName.trim()) {
      showToast('error', 'Type Code and Display Name are required');
      return;
    }
    const formattedCode = newTypeCode.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    if (trailerTypes.some((t) => t.code === formattedCode)) {
      showToast('error', `Trailer Type '${formattedCode}' already exists`);
      return;
    }
    const updated: TrailerTypeMaster[] = [
      ...trailerTypes,
      {
        code: formattedCode,
        name: newTypeName.trim(),
        defaultCapacityTons: Number(newTypeCapacity) || 45,
        description: newTypeDesc.trim() || 'Custom trailer chassis type',
        isCustom: true,
      },
    ];
    setTrailerTypes(updated);
    try {
      localStorage.setItem('fleet360_drayage_trailer_types_master', JSON.stringify(updated));
    } catch {
      // ignore
    }
    setNewTypeCode('');
    setNewTypeName('');
    setNewTypeCapacity(45);
    setNewTypeDesc('');
    showToast('success', `Trailer Type '${formattedCode}' added to Master`);
  };

  const handleDeleteTrailerType = (code: string) => {
    if (!confirm(`Remove trailer type '${code}' from master options?`)) return;
    const updated = trailerTypes.filter((t) => t.code !== code);
    setTrailerTypes(updated);
    try {
      localStorage.setItem('fleet360_drayage_trailer_types_master', JSON.stringify(updated));
    } catch {
      // ignore
    }
    showToast('success', `Trailer type '${code}' removed`);
  };

  const handleAddOperationalStatus = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStatusCode.trim() || !newStatusLabel.trim()) {
      showToast('error', 'Status Code and Status Label are required');
      return;
    }
    const formattedCode = newStatusCode.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    if (operationalStatuses.some((s) => s.code === formattedCode)) {
      showToast('error', `Operational Status '${formattedCode}' already exists`);
      return;
    }
    const updated: OperationalStatusMaster[] = [
      ...operationalStatuses,
      {
        code: formattedCode,
        label: newStatusLabel.trim().toUpperCase(),
        tone: newStatusTone,
        description: newStatusDesc.trim() || 'Custom operational status',
        isCustom: true,
      },
    ];
    setOperationalStatuses(updated);
    try {
      localStorage.setItem('fleet360_drayage_operational_statuses_master', JSON.stringify(updated));
    } catch {
      // ignore
    }
    setNewStatusCode('');
    setNewStatusLabel('');
    setNewStatusDesc('');
    showToast('success', `Operational Status '${formattedCode}' added to Master`);
  };

  const handleDeleteOperationalStatus = (code: string) => {
    if (!confirm(`Remove operational status '${code}' from master options?`)) return;
    const updated = operationalStatuses.filter((s) => s.code !== code);
    setOperationalStatuses(updated);
    try {
      localStorage.setItem('fleet360_drayage_operational_statuses_master', JSON.stringify(updated));
    } catch {
      // ignore
    }
    showToast('success', `Operational status '${code}' removed`);
  };

  const handleResetMasterDefaults = () => {
    if (!confirm('Reset Trailer Types and Operational Statuses back to factory defaults?')) return;
    setTrailerTypes(DEFAULT_TRAILER_TYPES);
    setOperationalStatuses(DEFAULT_OPERATIONAL_STATUSES);
    try {
      localStorage.removeItem('fleet360_drayage_trailer_types_master');
      localStorage.removeItem('fleet360_drayage_operational_statuses_master');
    } catch {
      // ignore
    }
    showToast('success', 'Master configurations reset to factory defaults');
  };

  const handleExportCsv = () => {
    const headers = ['PlateNumber', 'Type', 'CapacityTons', 'MasterStatus', 'OperationalStatus', 'LinkedContainer', 'Location'];
    const rows = filteredTrailers.map((t) => [
      t.plateNumber,
      t.trailerType,
      t.capacityTons,
      t.masterStatus,
      t.operationalStatus,
      t.linkedContainerNumber || 'None',
      `"${t.currentLocation || 'Jebel Ali'}"`,
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encoded = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encoded);
    link.setAttribute('download', `trailers_inventory_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredTrailers = useMemo(() => {
    return trailers.filter((t) => {
      if (typeFilter !== 'ALL' && t.trailerType !== typeFilter) return false;
      if (statusFilter !== 'ALL' && t.operationalStatus !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          t.plateNumber.toLowerCase().includes(q) ||
          t.trailerType.toLowerCase().includes(q) ||
          (t.linkedContainerNumber && t.linkedContainerNumber.toLowerCase().includes(q)) ||
          (t.currentLocation && t.currentLocation.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [trailers, search, typeFilter, statusFilter]);

  const availableCount = trailers.filter((t) => t.masterStatus === 'AVAILABLE').length;
  const inUseCount = trailers.filter((t) => t.masterStatus === 'IN_USE').length;
  const detachedCount = trailers.filter(
    (t) => t.operationalStatus === 'DETACHED_AT_RAMP' || t.operationalStatus === 'DETACHED_AT_YARD',
  ).length;

  return (
    <div className="space-y-6">
      {/* Toast Alert */}
      {toast && (
        <div
          className={`fixed top-5 right-5 z-50 flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg text-xs font-semibold ${
            toast.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200'
              : 'bg-rose-950/90 border-rose-500/40 text-rose-200'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Page Header */}
      <PageHeader
        title="Drayage Chassis & Trailer Management"
        subtitle="Manage 20ft/40ft skeletal chassis, flatbeds, lowbeds, ramp/yard detach statuses, and dynamic master configurations"
        icon={Truck}
        accent="blue"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowMasterModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-main)] hover:border-blue-500/40 hover:text-blue-400 transition-colors shadow-sm"
              title="Configure Trailer Types & Operational Statuses Master"
            >
              <Settings2 className="w-3.5 h-3.5 text-blue-400" />
              Manage Types & Statuses
            </button>
            <button
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
            <button
              onClick={handleOpenAdd}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-500 transition-colors shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Trailer
            </button>
          </div>
        }
      />

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Total Trailers & Chassis"
          value={trailers.length}
          icon={Layers}
          accent="blue"
          sub="Skeletal, flatbed & reefer"
        />
        <KpiCard
          label="Available for Dispatch"
          value={availableCount}
          icon={CheckCircle2}
          accent="emerald"
          sub="Ready in yard"
        />
        <KpiCard
          label="In Active Haulage"
          value={inUseCount}
          icon={Truck}
          accent="cyan"
          sub="Coupled to prime movers"
        />
        <KpiCard
          label="Detached at Ramp / Yard"
          value={detachedCount}
          icon={AlertTriangle}
          accent="amber"
          sub="Awaiting L2 empty return"
        />
      </div>

      {/* Trailer Inventory Table */}
      <Panel
        title={`Chassis Inventory (${filteredTrailers.length} Units)`}
        icon={Layers}
        accent="blue"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] outline-none focus:border-blue-500"
            >
              <option value="ALL">All Chassis Types ({trailerTypes.length})</option>
              {trailerTypes.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.name}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] outline-none focus:border-blue-500"
            >
              <option value="ALL">All Operational Statuses ({operationalStatuses.length})</option>
              {operationalStatuses.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.label}
                </option>
              ))}
            </select>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[var(--text-muted)]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search plate, type, container..."
                className="pl-8 pr-3 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] outline-none focus:border-blue-500 w-48 md:w-60"
              />
            </div>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-[var(--bg-main)] text-[var(--text-muted)] uppercase tracking-wider text-[10px] border-b border-[var(--border-subtle)]">
              <tr>
                <th className="py-2.5 px-3 font-semibold">Plate Number</th>
                <th className="py-2.5 px-3 font-semibold">Chassis Type</th>
                <th className="py-2.5 px-3 font-semibold">Capacity</th>
                <th className="py-2.5 px-3 font-semibold">Master Status</th>
                <th className="py-2.5 px-3 font-semibold">Operational Status</th>
                <th className="py-2.5 px-3 font-semibold">Linked Container</th>
                <th className="py-2.5 px-3 font-semibold">Current Location</th>
                <th className="py-2.5 px-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)] text-[var(--text-main)]">
              {filteredTrailers.map((t) => {
                const matchedStatus = operationalStatuses.find((s) => s.code === t.operationalStatus);
                const toneClasses = getToneClasses(matchedStatus?.tone || 'slate');
                const matchedType = trailerTypes.find((tt) => tt.code === t.trailerType);

                return (
                  <tr key={t.id} className="hover:bg-[var(--bg-surface-hover)] transition-colors">
                    <td className="py-3 px-3 font-mono font-bold text-sm text-[var(--text-main)]">{t.plateNumber}</td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded bg-[var(--bg-main)] border border-[var(--border-subtle)] font-medium text-[11px]">
                        {matchedType?.name || t.trailerType}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono">{t.capacityTons} Tons</td>
                    <td className="py-3 px-3">
                      <StatusPill status={t.masterStatus.toLowerCase()} label={t.masterStatus} />
                    </td>
                    <td className="py-3 px-3 font-semibold">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${toneClasses}`}>
                        {matchedStatus?.label || t.operationalStatus}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      {t.linkedContainerNumber ? (
                        <span className="font-mono font-bold text-[var(--text-main)]">
                          {t.linkedContainerNumber}
                        </span>
                      ) : (
                        <span className="text-[var(--text-muted)] italic text-[11px]">None</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-[var(--text-muted)]">
                      <div className="flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-[var(--text-muted)]" />
                        <span>{t.currentLocation || 'Jebel Ali Yard'}</span>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleOpenEdit(t)}
                          className="p-1 rounded-lg text-[var(--text-muted)] hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                          title="Edit chassis details"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(t.id, t.plateNumber)}
                          className="p-1 rounded-lg text-[var(--text-muted)] hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                          title="Delete chassis"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Master Configuration Modal (Trailer Types & Operational Statuses) */}
      {showMasterModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-3xl rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl p-6 space-y-5 my-8 max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-[var(--border-subtle)] pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-600/15 text-blue-400 flex items-center justify-center shrink-0 border border-blue-500/20">
                  <Settings2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[var(--text-main)]">
                    Chassis & Operational Status Master
                  </h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    Define equipment chassis classifications and custom operational status stages for container drayage.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowMasterModal(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] p-1.5 rounded-lg hover:bg-[var(--bg-surface-hover)] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Navigation Tabs */}
            <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] pb-2 text-xs">
              <button
                onClick={() => setMasterTab('STATUSES')}
                className={`px-3.5 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-1.5 ${
                  masterTab === 'STATUSES'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-main)]'
                }`}
              >
                <Palette className="w-3.5 h-3.5" />
                Operational Statuses Master ({operationalStatuses.length})
              </button>
              <button
                onClick={() => setMasterTab('TYPES')}
                className={`px-3.5 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-1.5 ${
                  masterTab === 'TYPES'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-main)]'
                }`}
              >
                <Truck className="w-3.5 h-3.5" />
                Trailer / Chassis Types Master ({trailerTypes.length})
              </button>
            </div>

            {/* Tab 1: Operational Statuses Master */}
            {masterTab === 'STATUSES' && (
              <div className="space-y-5">
                {/* Add Status Form */}
                <form
                  onSubmit={handleAddOperationalStatus}
                  className="p-4 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] space-y-3 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-[var(--text-main)] flex items-center gap-2">
                      <Plus className="w-4 h-4 text-blue-400" />
                      Add Additional Operational Status
                    </h4>
                    <span className="text-[10px] text-[var(--text-muted)]">
                      Instantly appears in trailer registration and inventory filters
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label className="font-semibold text-[var(--text-muted)]">Status Code *</label>
                      <input
                        type="text"
                        value={newStatusCode}
                        onChange={(e) => setNewStatusCode(e.target.value.toUpperCase())}
                        placeholder="e.g. CUSTOMS_HOLD"
                        className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono font-bold uppercase outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-semibold text-[var(--text-muted)]">Display Label *</label>
                      <input
                        type="text"
                        value={newStatusLabel}
                        onChange={(e) => setNewStatusLabel(e.target.value)}
                        placeholder="e.g. Customs Hold"
                        className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] font-medium outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-semibold text-[var(--text-muted)]">Badge Tone / Color</label>
                      <select
                        value={newStatusTone}
                        onChange={(e) => setNewStatusTone(e.target.value as Parameters<typeof setNewStatusTone>[0])}
                        className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500 font-semibold"
                      >
                        <option value="emerald">Emerald (Green - Available / Clear)</option>
                        <option value="blue">Blue (Active / In-Transit)</option>
                        <option value="amber">Amber (Warning / Detached / Waiting)</option>
                        <option value="cyan">Cyan (Staged / Yard)</option>
                        <option value="purple">Purple (En Route MT / Depot)</option>
                        <option value="rose">Rose (Hold / Critical / Maintenance)</option>
                        <option value="slate">Slate (Neutral / Inactive)</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="font-semibold text-[var(--text-muted)]">Operational Description</label>
                    <input
                      type="text"
                      value={newStatusDesc}
                      onChange={(e) => setNewStatusDesc(e.target.value)}
                      placeholder="e.g. Trailer container detained under UAE customs or regulatory hold"
                      className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="flex justify-end pt-1">
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 text-white font-bold text-xs hover:bg-blue-500 transition-colors shadow-sm"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Operational Status
                    </button>
                  </div>
                </form>

                {/* Statuses List Table */}
                <div className="rounded-xl border border-[var(--border-subtle)] overflow-hidden">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-[var(--bg-main)] text-[var(--text-muted)] uppercase tracking-wider text-[10px] border-b border-[var(--border-subtle)]">
                      <tr>
                        <th className="py-2.5 px-3 font-semibold">Badge Preview</th>
                        <th className="py-2.5 px-3 font-semibold">Status Code</th>
                        <th className="py-2.5 px-3 font-semibold">Description</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-subtle)] text-[var(--text-main)]">
                      {operationalStatuses.map((s) => (
                        <tr key={s.code} className="hover:bg-[var(--bg-surface-hover)] transition-colors">
                          <td className="py-2.5 px-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getToneClasses(s.tone)}`}>
                              {s.label}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-mono font-bold text-[11px] text-[var(--text-main)]">
                            {s.code}
                          </td>
                          <td className="py-2.5 px-3 text-[var(--text-muted)] text-[11px]">
                            {s.description}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            {s.isCustom ? (
                              <button
                                onClick={() => handleDeleteOperationalStatus(s.code)}
                                className="p-1 rounded-lg text-rose-400 hover:bg-rose-500/10 transition-colors"
                                title="Remove custom status"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <span className="text-[10px] text-[var(--text-muted)] font-mono">SYSTEM</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Tab 2: Trailer / Chassis Types Master */}
            {masterTab === 'TYPES' && (
              <div className="space-y-5">
                {/* Add Type Form */}
                <form
                  onSubmit={handleAddTrailerType}
                  className="p-4 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] space-y-3 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-[var(--text-main)] flex items-center gap-2">
                      <Plus className="w-4 h-4 text-blue-400" />
                      Add Additional Chassis / Trailer Type
                    </h4>
                    <span className="text-[10px] text-[var(--text-muted)]">
                      Custom chassis specifications for fleet registration
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label className="font-semibold text-[var(--text-muted)]">Type Code *</label>
                      <input
                        type="text"
                        value={newTypeCode}
                        onChange={(e) => setNewTypeCode(e.target.value.toUpperCase())}
                        placeholder="e.g. 53FT_EXTENDABLE"
                        className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono font-bold uppercase outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-semibold text-[var(--text-muted)]">Display Name *</label>
                      <input
                        type="text"
                        value={newTypeName}
                        onChange={(e) => setNewTypeName(e.target.value)}
                        placeholder="e.g. 53FT Extendable Chassis"
                        className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] font-medium outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-semibold text-[var(--text-muted)]">Default Capacity (Tons)</label>
                      <input
                        type="number"
                        value={newTypeCapacity}
                        onChange={(e) => setNewTypeCapacity(Number(e.target.value))}
                        className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="font-semibold text-[var(--text-muted)]">Chassis Description</label>
                    <input
                      type="text"
                      value={newTypeDesc}
                      onChange={(e) => setNewTypeDesc(e.target.value)}
                      placeholder="e.g. Extendable multi-axle chassis for oversized container logistics"
                      className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="flex justify-end pt-1">
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 text-white font-bold text-xs hover:bg-blue-500 transition-colors shadow-sm"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Chassis Type
                    </button>
                  </div>
                </form>

                {/* Types List Table */}
                <div className="rounded-xl border border-[var(--border-subtle)] overflow-hidden">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-[var(--bg-main)] text-[var(--text-muted)] uppercase tracking-wider text-[10px] border-b border-[var(--border-subtle)]">
                      <tr>
                        <th className="py-2.5 px-3 font-semibold">Chassis Name</th>
                        <th className="py-2.5 px-3 font-semibold">Code</th>
                        <th className="py-2.5 px-3 font-semibold">Capacity</th>
                        <th className="py-2.5 px-3 font-semibold">Description</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-subtle)] text-[var(--text-main)]">
                      {trailerTypes.map((tt) => (
                        <tr key={tt.code} className="hover:bg-[var(--bg-surface-hover)] transition-colors">
                          <td className="py-2.5 px-3 font-bold text-[var(--text-main)]">
                            {tt.name}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px] text-[var(--text-muted)]">
                            {tt.code}
                          </td>
                          <td className="py-2.5 px-3 font-mono">
                            {tt.defaultCapacityTons} Tons
                          </td>
                          <td className="py-2.5 px-3 text-[var(--text-muted)] text-[11px]">
                            {tt.description}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            {tt.isCustom ? (
                              <button
                                onClick={() => handleDeleteTrailerType(tt.code)}
                                className="p-1 rounded-lg text-rose-400 hover:bg-rose-500/10 transition-colors"
                                title="Remove custom type"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <span className="text-[10px] text-[var(--text-muted)] font-mono">SYSTEM</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Modal Footer */}
            <div className="flex items-center justify-between pt-4 border-t border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={handleResetMasterDefaults}
                className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-rose-400 transition-colors font-semibold"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Restore Factory Defaults
              </button>
              <button
                type="button"
                onClick={() => setShowMasterModal(false)}
                className="px-4 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs font-bold text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Trailer Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <h3 className="text-sm font-bold text-[var(--text-main)] flex items-center gap-2">
                <Truck className="w-4 h-4 text-blue-400" />
                {editingTrailer ? `Edit Chassis: ${editingTrailer.plateNumber}` : 'Register New Chassis / Trailer'}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">Plate Number *</label>
                <input
                  type="text"
                  value={plateNumber}
                  onChange={(e) => setPlateNumber(e.target.value.toUpperCase())}
                  placeholder="e.g. DXB-TR-9905"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono font-bold uppercase outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-[var(--text-muted)]">Chassis / Trailer Type</label>
                  <button
                    type="button"
                    onClick={() => {
                      setShowModal(false);
                      setMasterTab('TYPES');
                      setShowMasterModal(true);
                    }}
                    className="text-[10px] text-blue-400 hover:underline flex items-center gap-0.5"
                  >
                    <Settings2 className="w-3 h-3" />
                    Manage Master
                  </button>
                </div>
                <select
                  value={trailerType}
                  onChange={(e) => handleTypeChange(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                >
                  {trailerTypes.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.name} ({t.defaultCapacityTons} Tons)
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Capacity (Tons)</label>
                  <input
                    type="number"
                    value={capacityTons}
                    onChange={(e) => setCapacityTons(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Master Status</label>
                  <select
                    value={masterStatus}
                    onChange={(e) => setMasterStatus(e.target.value as Parameters<typeof setMasterStatus>[0])}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                  >
                    <option value="AVAILABLE">AVAILABLE</option>
                    <option value="IN_USE">IN_USE</option>
                    <option value="MAINTENANCE">MAINTENANCE</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-[var(--text-muted)]">Operational Status</label>
                  <button
                    type="button"
                    onClick={() => {
                      setShowModal(false);
                      setMasterTab('STATUSES');
                      setShowMasterModal(true);
                    }}
                    className="text-[10px] text-blue-400 hover:underline flex items-center gap-0.5"
                  >
                    <Plus className="w-3 h-3" />
                    Add Custom Status
                  </button>
                </div>
                <select
                  value={operationalStatus}
                  onChange={(e) => setOperationalStatus(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500 font-semibold"
                >
                  {operationalStatuses.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.label} ({s.code})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">Current Location</label>
                <input
                  type="text"
                  value={currentLocation}
                  onChange={(e) => setCurrentLocation(e.target.value)}
                  placeholder="e.g. Jebel Ali Port Main Yard"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[var(--text-muted)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-500 transition-colors shadow-sm disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : editingTrailer ? 'Update Chassis' : 'Register Chassis'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
