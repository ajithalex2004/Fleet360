'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { 
  Car, 
  Layers, 
  Building2, 
  MapPin, 
  Calendar, 
  Gauge, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  X, 
  Search, 
  Filter, 
  ArrowRight,
  ShieldCheck,
  CornerDownLeft,
  ChevronRight,
  MoreVertical,
  ExternalLink,
  RotateCcw,
} from 'lucide-react';

interface Allocation {
  id: string;
  vehicleId: string;
  vehicleCode?: string;
  licensePlate?: string;
  plateNumber?: string;
  make?: string;
  model?: string;
  currentVehicleStatus?: string;
  allocatedToType?: string;
  allocatedToName: string;
  regionId?: string;
  regionName?: string;
  departmentId?: string;
  departmentName?: string;
  unitId?: string;
  unitName?: string;
  allocationDate: string;
  expectedReturnDate: string;
  actualReturnDate: string;
  purpose: string;
  authorizedBy: string;
  mileageAtAllocation: number;
  mileageAtReturn: number;
  status: string;
  notes: string;
}

interface VehicleOption {
  id: string;
  vehicleCode?: string;
  licensePlate?: string;
  plateNumber?: string;
  make?: string;
  model?: string;
  year?: number;
  status?: string;
  odometerReading?: number;
}

interface HierarchyNode {
  id: string;
  name: string;
  code?: string;
  level: string;
  parentId?: string;
  parent_id?: string;
}

const EMPTY_FORM = {
  vehicleId: '',
  regionId: '',
  regionName: '',
  departmentId: '',
  departmentName: '',
  unitId: '',
  unitName: '',
  allocatedToName: '',
  allocationDate: new Date().toISOString().slice(0, 10),
  expectedReturnDate: '',
  purpose: '',
  authorizedBy: '',
  mileageAtAllocation: 0,
  notes: '',
};

const EMPTY_RETURN = {
  actualReturnDate: new Date().toISOString().slice(0, 10),
  mileageAtReturn: 0,
};

const badge = (text: string, color: string) => (
  <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${color}`}>{text}</span>
);

const statusColor: Record<string, string> = {
  ACTIVE: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  RETURNED: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  CANCELLED: 'bg-slate-500/15 text-[var(--text-muted)] border-slate-500/30',
};

export default function AllocationsPage() {
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [activeActionMenuId, setActiveActionMenuId] = useState<string | null>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-allocation-actions]')) {
        setActiveActionMenuId(null);
      }
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [stats, setStats] = useState({ totalActive: 0, returnsToday: 0, overdue: 0, available: 0 });

  // Vehicle master dropdown list
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [loadingVehicles, setLoadingVehicles] = useState(false);

  // Cascading Hierarchy: Region -> Department -> Unit
  const [regions, setRegions] = useState<HierarchyNode[]>([]);
  const [departments, setDepartments] = useState<HierarchyNode[]>([]);
  const [units, setUnits] = useState<HierarchyNode[]>([]);
  const [loadingDepts, setLoadingDepts] = useState(false);
  const [loadingUnits, setLoadingUnits] = useState(false);

  // Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formData, setFormData] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Return modal state
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returningAlloc, setReturningAlloc] = useState<Allocation | null>(null);
  const [returnData, setReturnData] = useState({ ...EMPTY_RETURN });
  const [returnError, setReturnError] = useState('');
  const [returnSaving, setReturnSaving] = useState(false);

  // Fetch allocation list
  const fetchAllocations = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      params.set('page', String(page));
      params.set('limit', '20');
      const res = await fetch(`/api/fleet/allocations?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch allocations');
      const data = await res.json();
      const items: Allocation[] = data.data ?? data.items ?? (Array.isArray(data) ? data : []);
      setAllocations(items);
      setTotalPages(data.totalPages ?? 1);

      // Stats
      const now = new Date();
      const active = items.filter(a => a.status === 'ACTIVE');
      const today = now.toISOString().slice(0, 10);
      const returnsToday = active.filter(a => a.expectedReturnDate?.slice(0, 10) === today).length;
      const overdue = active.filter(a => a.expectedReturnDate && new Date(a.expectedReturnDate) < now).length;
      setStats({
        totalActive: active.length,
        returnsToday,
        overdue,
        available: data.availableVehicles ?? 0,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, page]);

  // Fetch available vehicles for dropdown
  const loadVehicles = useCallback(async () => {
    setLoadingVehicles(true);
    try {
      const res = await fetch('/api/fleet/vehicles?limit=500');
      if (res.ok) {
        const json = await res.json();
        setVehicles(json.data || []);
      }
    } catch (err) {
      console.error('Failed to load vehicles:', err);
    } finally {
      setLoadingVehicles(false);
    }
  }, []);

  // Fetch Regions
  const loadRegions = useCallback(async () => {
    try {
      const res = await fetch('/api/customer-hierarchy?level=REGION');
      if (res.ok) {
        const json = await res.json();
        setRegions(Array.isArray(json) ? json : []);
      }
    } catch (err) {
      console.error('Failed to load regions:', err);
    }
  }, []);

  // Fetch Departments by parent Region
  const loadDepartments = useCallback(async (regionId: string) => {
    if (!regionId) {
      setDepartments([]);
      setUnits([]);
      return;
    }
    setLoadingDepts(true);
    try {
      const res = await fetch(`/api/customer-hierarchy?level=DEPARTMENT&parentId=${encodeURIComponent(regionId)}`);
      if (res.ok) {
        const json = await res.json();
        setDepartments(Array.isArray(json) ? json : []);
      }
    } catch (err) {
      console.error('Failed to load departments:', err);
    } finally {
      setLoadingDepts(false);
    }
  }, []);

  // Fetch Units / Sections by parent Department
  const loadUnits = useCallback(async (deptId: string) => {
    if (!deptId) {
      setUnits([]);
      return;
    }
    setLoadingUnits(true);
    try {
      const res = await fetch(`/api/customer-hierarchy?level=UNIT&parentId=${encodeURIComponent(deptId)}`);
      if (res.ok) {
        const json = await res.json();
        setUnits(Array.isArray(json) ? json : []);
      }
    } catch (err) {
      console.error('Failed to load units:', err);
    } finally {
      setLoadingUnits(false);
    }
  }, []);

  useEffect(() => {
    fetchAllocations();
    loadVehicles();
    loadRegions();
  }, [fetchAllocations, loadVehicles, loadRegions]);

  const openCreate = () => {
    setFormData({
      ...EMPTY_FORM,
      allocationDate: new Date().toISOString().slice(0, 10),
    });
    setDepartments([]);
    setUnits([]);
    setFormError('');
    setShowCreateModal(true);
  };

  const handleRegionChange = (regionId: string) => {
    const sel = regions.find(r => r.id === regionId);
    setFormData(f => ({
      ...f,
      regionId,
      regionName: sel ? sel.name : '',
      departmentId: '',
      departmentName: '',
      unitId: '',
      unitName: '',
    }));
    loadDepartments(regionId);
  };

  const handleDepartmentChange = (deptId: string) => {
    const sel = departments.find(d => d.id === deptId);
    setFormData(f => ({
      ...f,
      departmentId: deptId,
      departmentName: sel ? sel.name : '',
      unitId: '',
      unitName: '',
    }));
    loadUnits(deptId);
  };

  const handleUnitChange = (unitId: string) => {
    const sel = units.find(u => u.id === unitId);
    setFormData(f => ({
      ...f,
      unitId,
      unitName: sel ? sel.name : '',
    }));
  };

  const handleVehicleChange = (vehicleId: string) => {
    const sel = vehicles.find(v => v.id === vehicleId);
    setFormData(f => ({
      ...f,
      vehicleId,
      mileageAtAllocation: sel?.odometerReading ?? f.mileageAtAllocation,
    }));
  };

  const openReturn = (alloc: Allocation) => {
    setReturningAlloc(alloc);
    setReturnData({
      actualReturnDate: new Date().toISOString().slice(0, 10),
      mileageAtReturn: alloc.mileageAtAllocation || 0,
    });
    setReturnError('');
    setShowReturnModal(true);
  };

  const handleSaveAllocation = async () => {
    setFormError('');
    if (!formData.vehicleId) {
      setFormError('Please select a vehicle from the dropdown.');
      return;
    }
    if (!formData.regionId) {
      setFormError('Please select a Region.');
      return;
    }
    if (!formData.departmentId) {
      setFormError('Please select a Department.');
      return;
    }
    if (!formData.allocationDate) {
      setFormError('Allocation date is required.');
      return;
    }

    setSaving(true);
    try {
      const hierarchyPath = [formData.regionName, formData.departmentName, formData.unitName].filter(Boolean).join(' > ');

      const payload = {
        ...formData,
        allocatedToName: formData.allocatedToName.trim() || hierarchyPath,
        status: 'ACTIVE',
      };

      const res = await fetch('/api/fleet/allocations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || data.message || 'Failed to save allocation');
      }

      setShowCreateModal(false);
      fetchAllocations();
      loadVehicles(); // refresh vehicle list statuses
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleReturn = async () => {
    if (!returningAlloc) return;
    setReturnError('');
    if (!returnData.actualReturnDate) {
      setReturnError('Return date is required.');
      return;
    }
    setReturnSaving(true);
    try {
      const res = await fetch(`/api/fleet/allocations/${returningAlloc.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...returnData,
          status: 'RETURNED',
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || data.message || 'Return failed');
      }
      setShowReturnModal(false);
      fetchAllocations();
      loadVehicles();
    } catch (err: unknown) {
      setReturnError(err instanceof Error ? err.message : 'Return failed');
    } finally {
      setReturnSaving(false);
    }
  };

  const handleCancel = async (id: string) => {
    if (!confirm('Cancel this active allocation? Vehicle will be returned to available fleet.')) return;
    try {
      const res = await fetch(`/api/fleet/allocations/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CANCELLED' }),
      });
      if (!res.ok) throw new Error('Cancel failed');
      fetchAllocations();
      loadVehicles();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Cancel failed');
    }
  };

  const isOverdue = (alloc: Allocation) =>
    alloc.status === 'ACTIVE' && !!alloc.expectedReturnDate && new Date(alloc.expectedReturnDate) < new Date();

  const inputCls =
    'bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2.5 text-[var(--text-main)] text-xs focus:border-orange-500 focus:outline-none w-full transition-colors';
  const labelCls = 'block text-xs font-semibold text-[var(--text-muted)] mb-1';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)] flex items-center gap-2">
            <Layers className="w-6 h-6 text-orange-500" />
            Fleet Allocations
          </h1>
          <p className="text-[var(--text-muted)] text-xs mt-1">
            Hierarchical assignments (Region → Department → Unit) and vehicle returns
          </p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white rounded-xl text-xs font-semibold transition-all shadow-lg shadow-orange-500/20 flex items-center gap-1.5"
        >
          <span>+ New Allocation</span>
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-4 shadow-sm">
          <p className="text-xs font-semibold text-[var(--text-muted)] mb-1">Total Active Allocations</p>
          <p className="text-2xl font-bold text-amber-400">{stats.totalActive}</p>
        </div>
        <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-4 shadow-sm">
          <p className="text-xs font-semibold text-[var(--text-muted)] mb-1">Expected Returns Today</p>
          <p className="text-2xl font-bold text-blue-400">{stats.returnsToday}</p>
        </div>
        <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-4 shadow-sm">
          <p className="text-xs font-semibold text-[var(--text-muted)] mb-1">Overdue Return Alerts</p>
          <p className="text-2xl font-bold text-rose-400">{stats.overdue}</p>
        </div>
        <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-4 shadow-sm">
          <p className="text-xs font-semibold text-[var(--text-muted)] mb-1">Available Fleet Units</p>
          <p className="text-2xl font-bold text-emerald-400">{stats.available}</p>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 px-4 py-3 rounded-xl text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Filter Bar */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search vehicle plate, region, department, unit, or purpose..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="w-full bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-xl pl-9 pr-4 py-2 text-xs text-[var(--text-main)] placeholder-[var(--text-muted)] focus:outline-none focus:border-orange-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-[var(--text-muted)]" />
          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
            className="bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-xs text-[var(--text-main)] focus:outline-none focus:border-orange-500"
          >
            <option value="">All Statuses</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="RETURNED">RETURNED</option>
            <option value="CANCELLED">CANCELLED</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[var(--bg-surface-hover)] border-b border-[var(--border-subtle)]">
                <th className="px-4 py-3.5 text-left font-bold text-[var(--text-muted)] uppercase tracking-wider">Vehicle</th>
                <th className="px-4 py-3.5 text-left font-bold text-[var(--text-muted)] uppercase tracking-wider">Allocated Hierarchy</th>
                <th className="px-4 py-3.5 text-left font-bold text-[var(--text-muted)] uppercase tracking-wider">Purpose</th>
                <th className="px-4 py-3.5 text-left font-bold text-[var(--text-muted)] uppercase tracking-wider">Allocation Date</th>
                <th className="px-4 py-3.5 text-left font-bold text-[var(--text-muted)] uppercase tracking-wider">Expected Return</th>
                <th className="px-4 py-3.5 text-left font-bold text-[var(--text-muted)] uppercase tracking-wider">Actual Return</th>
                <th className="px-4 py-3.5 text-right font-bold text-[var(--text-muted)] uppercase tracking-wider">Mileage (Alloc)</th>
                <th className="px-4 py-3.5 text-right font-bold text-[var(--text-muted)] uppercase tracking-wider">Mileage (Return)</th>
                <th className="px-4 py-3.5 text-center font-bold text-[var(--text-muted)] uppercase tracking-wider">Status</th>
                <th className="px-4 py-3.5 text-center font-bold text-[var(--text-muted)] uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]/50">
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-[var(--text-muted)]">
                    Loading allocations...
                  </td>
                </tr>
              ) : allocations.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-[var(--text-muted)]">
                    No allocations found. Click "+ New Allocation" to assign a vehicle.
                  </td>
                </tr>
              ) : (
                allocations.map(alloc => (
                  <tr
                    key={alloc.id}
                    className={`transition-colors ${isOverdue(alloc) ? 'bg-rose-500/5 hover:bg-rose-500/10' : 'hover:bg-[var(--bg-surface-hover)]'}`}
                  >
                    {/* Vehicle */}
                    <td className="px-4 py-3">
                      <div className="font-bold text-[var(--text-main)] flex items-center gap-1.5">
                        <Car className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                        <span>{alloc.plateNumber || alloc.licensePlate || alloc.vehicleCode || 'Vehicle'}</span>
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        {alloc.make ? `${alloc.make} ${alloc.model || ''}` : `ID: ${alloc.vehicleId}`}
                      </div>
                    </td>

                    {/* Allocated Hierarchy (Region > Department > Unit) without Allocated to ID column */}
                    <td className="px-4 py-3">
                      {alloc.regionName || alloc.departmentName || alloc.unitName ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1 flex-wrap text-[11px]">
                            {alloc.regionName && (
                              <span className="px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20 font-semibold">
                                {alloc.regionName}
                              </span>
                            )}
                            {alloc.regionName && alloc.departmentName && (
                              <ChevronRight className="w-3 h-3 text-[var(--text-muted)] shrink-0" />
                            )}
                            {alloc.departmentName && (
                              <span className="px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-400 border border-purple-500/20 font-semibold">
                                {alloc.departmentName}
                              </span>
                            )}
                            {alloc.unitName && (
                              <ChevronRight className="w-3 h-3 text-[var(--text-muted)] shrink-0" />
                            )}
                            {alloc.unitName && (
                              <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">
                                {alloc.unitName}
                              </span>
                            )}
                          </div>
                          {alloc.allocatedToName && alloc.allocatedToName !== `${alloc.regionName} > ${alloc.departmentName} > ${alloc.unitName}` && (
                            <div className="text-[11px] text-[var(--text-muted)] font-medium">
                              {alloc.allocatedToName}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-[var(--text-main)] font-semibold text-xs">
                          {alloc.allocatedToName || '—'}
                        </div>
                      )}
                    </td>

                    {/* Purpose */}
                    <td className="px-4 py-3 text-[var(--text-muted)] max-w-xs truncate" title={alloc.purpose}>
                      {alloc.purpose || '—'}
                    </td>

                    {/* Allocation Date */}
                    <td className="px-4 py-3 text-[var(--text-muted)] font-mono">
                      {alloc.allocationDate ? new Date(alloc.allocationDate).toLocaleDateString() : '—'}
                    </td>

                    {/* Expected Return */}
                    <td className="px-4 py-3 font-mono">
                      <span className={isOverdue(alloc) ? 'text-rose-400 font-bold flex items-center gap-1' : 'text-[var(--text-muted)]'}>
                        {isOverdue(alloc) && <AlertCircle className="w-3 h-3" />}
                        {alloc.expectedReturnDate ? new Date(alloc.expectedReturnDate).toLocaleDateString() : '—'}
                      </span>
                    </td>

                    {/* Actual Return */}
                    <td className="px-4 py-3 text-[var(--text-muted)] font-mono">
                      {alloc.actualReturnDate ? new Date(alloc.actualReturnDate).toLocaleDateString() : '—'}
                    </td>

                    {/* Mileage (Alloc) */}
                    <td className="px-4 py-3 text-right text-[var(--text-muted)] font-mono">
                      {alloc.mileageAtAllocation != null ? `${Number(alloc.mileageAtAllocation).toLocaleString()} km` : '—'}
                    </td>

                    {/* Mileage (Return) */}
                    <td className="px-4 py-3 text-right text-[var(--text-muted)] font-mono">
                      {alloc.mileageAtReturn != null && alloc.mileageAtReturn > 0
                        ? `${Number(alloc.mileageAtReturn).toLocaleString()} km`
                        : '—'}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3 text-center">
                      {badge(alloc.status, statusColor[alloc.status] ?? 'bg-slate-500/15 text-[var(--text-muted)]')}
                    </td>

                    {/* Actions Column (3-Dot Menu) */}
                    <td className="px-4 py-3 text-center whitespace-nowrap relative" data-allocation-actions>
                      <div className="inline-block text-left relative">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveActionMenuId(prev => prev === alloc.id ? null : alloc.id);
                          }}
                          className={`p-2 rounded-xl border transition flex items-center justify-center ${
                            activeActionMenuId === alloc.id
                              ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border-cyan-500/50 shadow-md ring-2 ring-cyan-500/20'
                              : 'bg-[var(--bg-canvas)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)] border-[var(--border-subtle)]'
                          }`}
                          title="Allocation Actions"
                          aria-label="Allocation Actions"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>

                        {activeActionMenuId === alloc.id && (
                          <div
                            className="absolute right-0 mt-2 w-64 rounded-2xl bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-700 shadow-2xl shadow-slate-900/25 z-50 py-1.5 text-left divide-y divide-slate-200 dark:divide-slate-800 animate-in fade-in zoom-in-95 duration-100"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800/80">
                              <div className="text-[11px] uppercase font-black tracking-wider text-cyan-700 dark:text-cyan-400">
                                {alloc.vehicleCode || alloc.plateNumber || 'Allocation'}
                              </div>
                              <div className="text-xs font-bold text-slate-950 dark:text-slate-200 truncate mt-0.5">
                                {alloc.make} {alloc.model} {alloc.plateNumber ? `(${alloc.plateNumber})` : ''}
                              </div>
                            </div>

                            <div className="py-1">
                              {alloc.status === 'ACTIVE' && (
                                <button
                                  onClick={() => {
                                    openReturn(alloc);
                                    setActiveActionMenuId(null);
                                  }}
                                  className="w-full px-4 py-2.5 text-xs font-bold text-emerald-800 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-slate-800 flex items-center gap-3 transition"
                                >
                                  <span className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400">
                                    <CornerDownLeft className="w-4 h-4 shrink-0" />
                                  </span>
                                  <span>Process Return &amp; Odometer</span>
                                </button>
                              )}

                              <a
                                href={`/fleet/vehicles?search=${encodeURIComponent(alloc.plateNumber || alloc.vehicleCode || '')}`}
                                className="w-full px-4 py-2.5 text-xs font-bold text-slate-950 dark:text-white hover:bg-cyan-50 dark:hover:bg-slate-800 flex items-center gap-3 transition"
                                onClick={() => setActiveActionMenuId(null)}
                              >
                                <span className="p-1.5 rounded-lg bg-cyan-100 dark:bg-cyan-950/80 text-cyan-700 dark:text-cyan-400">
                                  <ExternalLink className="w-4 h-4 shrink-0" />
                                </span>
                                <span>View Vehicle in Fleet Master</span>
                              </a>
                            </div>

                            {alloc.status === 'ACTIVE' && (
                              <div className="py-1">
                                <button
                                  onClick={() => {
                                    setActiveActionMenuId(null);
                                    handleCancel(alloc.id);
                                  }}
                                  className="w-full px-4 py-2.5 text-xs font-bold text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-slate-800 flex items-center gap-3 transition"
                                >
                                  <span className="p-1.5 rounded-lg bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-400">
                                    <X className="w-4 h-4 shrink-0" />
                                  </span>
                                  <span>Cancel Allocation</span>
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border-subtle)] text-xs text-[var(--text-muted)]">
            <span>Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 bg-[var(--bg-canvas)] border border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-40 rounded-lg text-[var(--text-main)] transition-colors"
              >
                Prev
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 bg-[var(--bg-canvas)] border border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-40 rounded-lg text-[var(--text-main)] transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* New Allocation Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-orange-500/10 text-orange-400 rounded-xl border border-orange-500/20">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-[var(--text-main)]">New Fleet Allocation</h2>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Allocate vehicle to Region, Department & Unit hierarchy
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setShowCreateModal(false)} 
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors text-xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="px-6 py-5 space-y-6">
              {formError && (
                <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 px-4 py-3 rounded-xl text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Section 1: Vehicle Selection (Dropdown) */}
              <div>
                <p className="text-xs font-bold text-orange-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Car className="w-3.5 h-3.5" /> 1. Select Vehicle
                </p>
                <div>
                  <label className={labelCls}>
                    Vehicle ID / Plate Number <span className="text-rose-400">*</span>
                  </label>
                  <select
                    value={formData.vehicleId}
                    onChange={e => handleVehicleChange(e.target.value)}
                    className={inputCls}
                    required
                  >
                    <option value="">— Select Vehicle from Fleet Master —</option>
                    {vehicles.map(v => {
                      const plate = v.plateNumber || v.licensePlate || v.vehicleCode || 'No Plate';
                      const details = [v.make, v.model, v.year].filter(Boolean).join(' ');
                      const isAvailable = v.status === 'AVAILABLE';
                      return (
                        <option key={v.id} value={v.id}>
                          {plate} {details ? `• ${details}` : ''} ({v.status || 'UNKNOWN'}{v.odometerReading ? ` • ${v.odometerReading.toLocaleString()} km` : ''})
                        </option>
                      );
                    })}
                  </select>
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">
                    Select the target vehicle to assign. Its current odometer reading will be automatically populated.
                  </p>
                </div>
              </div>

              {/* Section 2: Hierarchy Allocation (Region --> Department --> Unit) */}
              <div>
                <p className="text-xs font-bold text-orange-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5" /> 2. Allocated Organizational Hierarchy
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Region Dropdown */}
                  <div>
                    <label className={labelCls}>
                      Region <span className="text-rose-400">*</span>
                    </label>
                    <select
                      value={formData.regionId}
                      onChange={e => handleRegionChange(e.target.value)}
                      className={inputCls}
                      required
                    >
                      <option value="">— Select Region —</option>
                      {regions.map(r => (
                        <option key={r.id} value={r.id}>
                          {r.name} {r.code ? `(${r.code})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Department Dropdown */}
                  <div>
                    <label className={labelCls}>
                      Department <span className="text-rose-400">*</span>
                    </label>
                    <select
                      value={formData.departmentId}
                      onChange={e => handleDepartmentChange(e.target.value)}
                      disabled={!formData.regionId || loadingDepts}
                      className={`${inputCls} disabled:opacity-50`}
                      required
                    >
                      <option value="">
                        {!formData.regionId ? 'Select Region First' : loadingDepts ? 'Loading Departments...' : '— Select Department —'}
                      </option>
                      {departments.map(d => (
                        <option key={d.id} value={d.id}>
                          {d.name} {d.code ? `(${d.code})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Unit / Section Dropdown */}
                  <div>
                    <label className={labelCls}>
                      Unit / Section <span className="text-[var(--text-muted)] font-normal">(Optional)</span>
                    </label>
                    <select
                      value={formData.unitId}
                      onChange={e => handleUnitChange(e.target.value)}
                      disabled={!formData.departmentId || loadingUnits}
                      className={`${inputCls} disabled:opacity-50`}
                    >
                      <option value="">
                        {!formData.departmentId ? 'Select Department First' : loadingUnits ? 'Loading Units...' : '— Select Unit / Section —'}
                      </option>
                      {units.map(u => (
                        <option key={u.id} value={u.id}>
                          {u.name} {u.code ? `(${u.code})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Optional Custom Custodian / Team Label */}
                <div className="mt-3">
                  <label className={labelCls}>
                    Specific Team / Project Custodian Name <span className="text-[var(--text-muted)] font-normal">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    value={formData.allocatedToName}
                    onChange={e => setFormData(f => ({ ...f, allocatedToName: e.target.value }))}
                    className={inputCls}
                    placeholder="Defaults to: Region > Department > Unit"
                  />
                </div>
              </div>

              {/* Section 3: Dates & Details */}
              <div>
                <p className="text-xs font-bold text-orange-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" /> 3. Schedule & Authorization
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Allocation Date *</label>
                    <input
                      type="date"
                      value={formData.allocationDate}
                      onChange={e => setFormData(f => ({ ...f, allocationDate: e.target.value }))}
                      className={inputCls}
                      required
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Expected Return Date</label>
                    <input
                      type="date"
                      value={formData.expectedReturnDate}
                      onChange={e => setFormData(f => ({ ...f, expectedReturnDate: e.target.value }))}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Purpose of Allocation</label>
                    <input
                      type="text"
                      value={formData.purpose}
                      onChange={e => setFormData(f => ({ ...f, purpose: e.target.value }))}
                      className={inputCls}
                      placeholder="e.g. VIP Protocol, Site Inspection, Cargo Transport"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Authorized By</label>
                    <input
                      type="text"
                      value={formData.authorizedBy}
                      onChange={e => setFormData(f => ({ ...f, authorizedBy: e.target.value }))}
                      className={inputCls}
                      placeholder="e.g. Operations Manager"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Mileage at Allocation (km)</label>
                    <input
                      type="number"
                      min={0}
                      value={formData.mileageAtAllocation}
                      onChange={e => setFormData(f => ({ ...f, mileageAtAllocation: Number(e.target.value) }))}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Internal Notes</label>
                    <input
                      type="text"
                      value={formData.notes}
                      onChange={e => setFormData(f => ({ ...f, notes: e.target.value }))}
                      className={inputCls}
                      placeholder="Additional remarks or conditions"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--border-subtle)]">
              <button
                onClick={() => setShowCreateModal(false)}
                disabled={saving}
                className="px-4 py-2 bg-[var(--bg-canvas)] border border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-main)] rounded-xl text-xs font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveAllocation}
                disabled={saving}
                className="px-5 py-2 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition-all shadow-md shadow-orange-500/20"
              >
                {saving ? 'Creating Allocation...' : 'Confirm Allocation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Process Return Modal */}
      {showReturnModal && returningAlloc && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
              <div className="flex items-center gap-2">
                <CornerDownLeft className="w-5 h-5 text-emerald-400" />
                <h2 className="text-base font-bold text-[var(--text-main)]">Process Vehicle Return</h2>
              </div>
              <button 
                onClick={() => setShowReturnModal(false)} 
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {returnError && (
                <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 px-4 py-3 rounded-xl text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{returnError}</span>
                </div>
              )}

              <div className="p-3 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-xs space-y-1">
                <div className="font-bold text-[var(--text-main)]">
                  {returningAlloc.plateNumber || returningAlloc.licensePlate || returningAlloc.vehicleCode}
                </div>
                <div className="text-[var(--text-muted)]">
                  Allocated To: <strong className="text-[var(--text-main)]">{returningAlloc.allocatedToName}</strong>
                </div>
                <div className="text-[var(--text-muted)]">
                  Mileage at Outgoing: <strong className="font-mono text-orange-400">{Number(returningAlloc.mileageAtAllocation || 0).toLocaleString()} km</strong>
                </div>
              </div>

              <div>
                <label className={labelCls}>Actual Return Date *</label>
                <input
                  type="date"
                  value={returnData.actualReturnDate}
                  onChange={e => setReturnData(d => ({ ...d, actualReturnDate: e.target.value }))}
                  className={inputCls}
                  required
                />
              </div>

              <div>
                <label className={labelCls}>Mileage at Return (km) *</label>
                <input
                  type="number"
                  min={returningAlloc.mileageAtAllocation || 0}
                  value={returnData.mileageAtReturn}
                  onChange={e => setReturnData(d => ({ ...d, mileageAtReturn: Number(e.target.value) }))}
                  className={inputCls}
                  required
                />
                <p className="text-[11px] text-[var(--text-muted)] mt-1">
                  Vehicle odometer reading in Fleet Master will be updated to this value upon return.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--border-subtle)]">
              <button
                onClick={() => setShowReturnModal(false)}
                disabled={returnSaving}
                className="px-4 py-2 bg-[var(--bg-canvas)] border border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-main)] rounded-xl text-xs font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleReturn}
                disabled={returnSaving}
                className="px-5 py-2 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition-all shadow-md shadow-emerald-500/20"
              >
                {returnSaving ? 'Processing Return...' : 'Confirm Return'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
