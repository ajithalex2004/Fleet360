'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  UserCheck, Truck, Layers, Package, CheckCircle2, AlertTriangle, RefreshCw,
  Search, Filter, Plus, ShieldCheck, Compass, ArrowRight, X, ExternalLink,
  Sparkles, Key,
} from 'lucide-react';
import { PageHeader, KpiCard, Panel, StatusPill } from '@/components/ui/page-theme';
import {
  fetchDrayageWorkspaceCached,
  getCachedDrayageData,
  invalidateDrayageClientCache,
} from '@/lib/logistics/drayage-client-cache';

interface DrayageJob {
  id: string;
  jobCode: string;
  jobPhase: 'L1' | 'L2';
  shipmentType: string;
  status: string;
  priority: string;
  customerName: string;
  warehouseName: string;
  terminalName: string;
  containerNumber: string;
  containerSize: string;
  containerType: string;
  tokenNumber: string | null;
  assignedVehicleId: string | null;
  assignedVehiclePlate: string | null;
  assignedDriverId: string | null;
  assignedDriverName: string | null;
  assignedTrailerId: string | null;
  assignedTrailerPlate: string | null;
  rateAmountAed: number;
  driverAllowanceAed: number;
  notes: string | null;
  createdAt: string;
}

interface MappedVehicle {
  id: string;
  plateNumber: string;
  make: string;
  model: string;
  status: string;
}

interface MappedDriver {
  id: string;
  fullName: string;
  phone: string | null;
  status: string;
  complianceOk: boolean;
}

interface DrayageTrailer {
  id: string;
  plateNumber: string;
  trailerType: string;
  masterStatus: string;
  operationalStatus: string;
}

export default function DrayageAssignmentPage() {
  const cached = getCachedDrayageData();
  const [loading, setLoading] = useState(!cached?.jobs);
  const [jobs, setJobs] = useState<DrayageJob[]>(cached?.jobs || []);
  const [vehicles, setVehicles] = useState<MappedVehicle[]>(cached?.vehicles || []);
  const [drivers, setDrivers] = useState<MappedDriver[]>(cached?.drivers || []);
  const [trailers, setTrailers] = useState<DrayageTrailer[]>(cached?.trailers || []);
  const [search, setSearch] = useState('');
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);

  // Modals
  const [assigningJob, setAssigningJob] = useState<DrayageJob | null>(null);
  const [editingTokenJob, setEditingTokenJob] = useState<DrayageJob | null>(null);
  const [newTokenValue, setNewTokenValue] = useState('');
  const [isBogieAssign, setIsBogieAssign] = useState(false);

  // Assignment Modal Fields
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [selectedDriverId, setSelectedDriverId] = useState('');
  const [selectedTrailerId, setSelectedTrailerId] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [submittingAssign, setSubmittingAssign] = useState(false);

  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  const loadData = useCallback(async (forceFresh = false) => {
    try {
      if (!getCachedDrayageData()?.jobs) {
        setLoading(true);
      }
      const data = await fetchDrayageWorkspaceCached({ forceFresh });
      setJobs(data?.jobs || []);
      setVehicles(data?.vehicles || []);
      setDrivers(data?.drivers || []);
      setTrailers(data?.trailers || []);
    } catch (err) {
      if (!getCachedDrayageData()?.jobs) {
        showToast('error', err instanceof Error ? err.message : 'Failed to fetch data');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Open modal for single job
  const handleOpenAssign = (job: DrayageJob) => {
    setAssigningJob(job);
    setIsBogieAssign(false);
    setSelectedVehicleId(job.assignedVehicleId || (availableVehicles[0]?.id ?? ''));
    setSelectedDriverId(job.assignedDriverId || (availableDrivers[0]?.id ?? ''));
    setSelectedTrailerId(job.assignedTrailerId || (availableTrailers[0]?.id ?? ''));
    setTokenInput(job.tokenNumber || `DPW-TKN-${Math.floor(1000 + Math.random() * 9000)}`);
  };

  // Open modal for bogie merge
  const handleOpenBogieModal = () => {
    if (selectedJobIds.length < 2) {
      showToast('error', 'Select at least 2 twenty-foot jobs to assign as a Bogie trip');
      return;
    }
    const firstJob = jobs.find((j) => j.id === selectedJobIds[0]);
    if (!firstJob) return;
    setAssigningJob(firstJob);
    setIsBogieAssign(true);
    setSelectedVehicleId(availableVehicles[0]?.id ?? '');
    setSelectedDriverId(availableDrivers[0]?.id ?? '');
    setSelectedTrailerId(availableTrailers[0]?.id ?? '');
    setTokenInput(`DPW-BG-${Math.floor(1000 + Math.random() * 9000)}`);
  };

  const handleConfirmAssignment = async () => {
    if (!selectedVehicleId || !selectedDriverId || !selectedTrailerId) {
      showToast('error', 'Please select a Vehicle, Driver, and Trailer');
      return;
    }
    const veh = vehicles.find((v) => v.id === selectedVehicleId);
    const drv = drivers.find((d) => d.id === selectedDriverId);
    const tr = trailers.find((t) => t.id === selectedTrailerId);

    try {
      setSubmittingAssign(true);
      if (isBogieAssign) {
        const res = await fetch('/api/logistics/drayage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create_bogie_trip',
            jobIds: selectedJobIds,
            vehicleId: selectedVehicleId,
            vehiclePlate: veh?.plateNumber || 'DXB-TRACTOR',
            driverId: selectedDriverId,
            driverName: drv?.fullName || 'Assigned Driver',
            trailerId: selectedTrailerId,
            trailerPlate: tr?.plateNumber || 'DXB-TR-9901',
            tokenNumber: tokenInput,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to assign Bogie trip');
        showToast('success', `Bogie dispatch ${data.bogieRef} created for ${data.count} jobs!`);
        setSelectedJobIds([]);
      } else if (assigningJob) {
        const res = await fetch('/api/logistics/drayage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'assign_job',
            jobId: assigningJob.id,
            vehicleId: selectedVehicleId,
            vehiclePlate: veh?.plateNumber || 'DXB-TRACTOR',
            driverId: selectedDriverId,
            driverName: drv?.fullName || 'Assigned Driver',
            trailerId: selectedTrailerId,
            trailerPlate: tr?.plateNumber || 'DXB-TR-9901',
            tokenNumber: tokenInput,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to assign job');
        showToast('success', `Job ${assigningJob.jobCode} assigned with token ${data.tokenNumber}!`);
      }
      setAssigningJob(null);
      invalidateDrayageClientCache();
      await loadData(true);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error during assignment');
    } finally {
      setSubmittingAssign(false);
    }
  };

  const handleUpdateToken = async () => {
    if (!editingTokenJob || !newTokenValue.trim()) return;
    try {
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_token',
          jobId: editingTokenJob.id,
          tokenNumber: newTokenValue.trim().toUpperCase(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update token');
      showToast('success', `Token updated to ${data.tokenNumber}!`);
      setEditingTokenJob(null);
      invalidateDrayageClientCache();
      await loadData(true);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error updating token');
    }
  };

  // Asset availability
  const availableVehicles = useMemo(() => vehicles.filter((v) => v.status !== 'ON_DRAYAGE_TRIP'), [vehicles]);
  const availableDrivers = useMemo(() => drivers.filter((d) => d.status === 'ACTIVE' && d.complianceOk), [drivers]);
  const availableTrailers = useMemo(() => trailers.filter((t) => t.masterStatus === 'AVAILABLE'), [trailers]);

  // Filter unassigned jobs & all jobs
  const unassignedJobs = useMemo(
    () => jobs.filter((j) => j.status === 'PENDING' || !j.assignedVehicleId),
    [jobs],
  );

  const filteredJobs = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return jobs;
    return jobs.filter(
      (j) =>
        j.jobCode.toLowerCase().includes(q) ||
        j.containerNumber.toLowerCase().includes(q) ||
        j.customerName.toLowerCase().includes(q) ||
        (j.tokenNumber && j.tokenNumber.toLowerCase().includes(q)),
    );
  }, [jobs, search]);

  // Bogie merge candidates (20FT pending jobs)
  const bogieCandidates = useMemo(
    () => unassignedJobs.filter((j) => j.containerSize === '20FT'),
    [unassignedJobs],
  );

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
        title="Drayage Job Assignment & Token Dispatch"
        subtitle="Pair prime movers, drivers, chassis, and port gate passes (DP World Dubai Trade / AD Ports Maqta)"
        icon={UserCheck}
        accent="blue"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => loadData(true)}
              disabled={loading}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <Link
              href="/logistics/drayage/create-jobs"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-500 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              New Job
            </Link>
          </div>
        }
      />

      {/* Availability KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Unassigned Queue"
          value={unassignedJobs.length}
          icon={Package}
          accent="amber"
          sub="Awaiting dispatch"
        />
        <KpiCard
          label="Available Prime Movers"
          value={availableVehicles.length}
          icon={Truck}
          accent="blue"
          sub={`of ${vehicles.length} total mapped`}
        />
        <KpiCard
          label="Available Drivers"
          value={availableDrivers.length}
          icon={UserCheck}
          accent="emerald"
          sub={`of ${drivers.length} compliant drivers`}
        />
        <KpiCard
          label="Available Chassis"
          value={availableTrailers.length}
          icon={Layers}
          accent="cyan"
          sub={`of ${trailers.length} trailers`}
        />
      </div>

      {/* Smart Bogie Merge Suggestion Banner */}
      {bogieCandidates.length >= 2 && (
        <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/30 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-[var(--text-main)]">
                Smart Bogie Suggestion: {bogieCandidates.length} unassigned 20FT container jobs ready for pairing!
              </h4>
              <p className="text-[11px] text-[var(--text-muted)]">
                Save fuel and tractor hours by combining 2x20FT containers onto a single prime mover on the same corridor.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setSelectedJobIds(bogieCandidates.slice(0, 2).map((c) => c.id));
                handleOpenBogieModal();
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-500 transition-colors shadow-sm"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Pair Top 2 in Bogie Trip
            </button>
          </div>
        </div>
      )}

      {/* Main Jobs Queue Panel */}
      <Panel
        title={`Drayage Jobs Queue (${filteredJobs.length} Jobs)`}
        subtitle="Select and assign prime movers, drivers, chassis, and token credentials"
        icon={Package}
        accent="blue"
        actions={
          <div className="flex items-center gap-2">
            {selectedJobIds.length >= 2 && (
              <button
                onClick={handleOpenBogieModal}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-500 transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Assign Selected {selectedJobIds.length} as Bogie Trip
              </button>
            )}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[var(--text-muted)]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search job, container, token..."
                className="pl-8 pr-3 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] outline-none focus:border-blue-500 w-48 md:w-64"
              />
            </div>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-[var(--bg-main)] text-[var(--text-muted)] uppercase tracking-wider text-[10px] border-b border-[var(--border-subtle)]">
              <tr>
                <th className="py-2.5 px-3 w-8">
                  <input
                    type="checkbox"
                    checked={selectedJobIds.length > 0 && selectedJobIds.length === unassignedJobs.length}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedJobIds(unassignedJobs.map((j) => j.id));
                      else setSelectedJobIds([]);
                    }}
                    className="rounded border-[var(--border-subtle)] text-blue-600"
                  />
                </th>
                <th className="py-2.5 px-3 font-semibold">Job & Phase</th>
                <th className="py-2.5 px-3 font-semibold">Container & Route</th>
                <th className="py-2.5 px-3 font-semibold">Port Gate Token</th>
                <th className="py-2.5 px-3 font-semibold">Assigned Assets</th>
                <th className="py-2.5 px-3 font-semibold">Status</th>
                <th className="py-2.5 px-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)] text-[var(--text-main)]">
              {filteredJobs.map((job) => {
                const isSelected = selectedJobIds.includes(job.id);
                const isAssigned = Boolean(job.assignedVehicleId);
                return (
                  <tr
                    key={job.id}
                    className={`hover:bg-[var(--bg-surface-hover)] transition-colors ${
                      isSelected ? 'bg-blue-600/5' : ''
                    }`}
                  >
                    <td className="py-3 px-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedJobIds((prev) => [...prev, job.id]);
                          else setSelectedJobIds((prev) => prev.filter((id) => id !== job.id));
                        }}
                        className="rounded border-[var(--border-subtle)] text-blue-600"
                      />
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-bold font-mono text-[var(--text-main)] flex items-center gap-1.5">
                        <span>{job.jobCode}</span>
                        <span
                          className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                            job.jobPhase === 'L2'
                              ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                              : 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                          }`}
                        >
                          {job.jobPhase}
                        </span>
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)] truncate max-w-[140px]">{job.customerName}</div>
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-mono font-semibold flex items-center gap-1.5">
                        <span>{job.containerNumber}</span>
                        <span className="text-[10px] font-normal text-[var(--text-muted)]">({job.containerSize})</span>
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)] truncate max-w-[180px]">
                        {job.terminalName} → {job.warehouseName}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      {job.tokenNumber ? (
                        <div className="flex items-center gap-1 font-mono font-bold text-emerald-400">
                          <Key className="w-3 h-3 shrink-0" />
                          <span>{job.tokenNumber}</span>
                          <button
                            onClick={() => {
                              setEditingTokenJob(job);
                              setNewTokenValue(job.tokenNumber || '');
                            }}
                            className="text-[10px] text-[var(--text-muted)] hover:text-blue-400 ml-1 underline"
                          >
                            Edit
                          </button>
                        </div>
                      ) : (
                        <span className="text-[var(--text-muted)] italic text-[11px]">No Token</span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      {isAssigned ? (
                        <div className="space-y-0.5">
                          <div className="font-semibold">{job.assignedVehiclePlate}</div>
                          <div className="text-[10px] text-[var(--text-muted)]">
                            {job.assignedDriverName} · {job.assignedTrailerPlate || 'Chassis'}
                          </div>
                        </div>
                      ) : (
                        <span className="text-amber-400 text-[11px] font-medium">Pending Assignment</span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <StatusPill status={job.status.toLowerCase()} label={job.status} />
                    </td>
                    <td className="py-3 px-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleOpenAssign(job)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600/15 border border-blue-500/30 text-blue-400 hover:bg-blue-600/25 text-[11px] font-semibold transition-colors"
                        >
                          {isAssigned ? 'Reassign' : 'Assign Fleet'}
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

      {/* Assignment Modal */}
      {assigningJob && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <div>
                <h3 className="text-sm font-bold text-[var(--text-main)] flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-blue-400" />
                  {isBogieAssign ? 'Assign Bogie Double-Container Trip' : `Assign Assets: ${assigningJob.jobCode}`}
                </h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  {isBogieAssign
                    ? `Assigning ${selectedJobIds.length} containers to a single prime mover and chassis`
                    : `Container ${assigningJob.containerNumber} (${assigningJob.containerSize})`}
                </p>
              </div>
              <button
                onClick={() => setAssigningJob(null)}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Select Prime Mover */}
              <div className="space-y-1.5">
                <label className="font-semibold text-[var(--text-muted)]">Fleet360 Tractor / Prime Mover *</label>
                <select
                  value={selectedVehicleId}
                  onChange={(e) => setSelectedVehicleId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                >
                  <option value="">-- Choose Prime Mover --</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.plateNumber} · {v.make} {v.model} ({v.status})
                    </option>
                  ))}
                </select>
              </div>

              {/* Select Driver */}
              <div className="space-y-1.5">
                <label className="font-semibold text-[var(--text-muted)]">Fleet360 Heavy Duty Driver *</label>
                <select
                  value={selectedDriverId}
                  onChange={(e) => setSelectedDriverId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                >
                  <option value="">-- Choose Driver --</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.fullName} ({d.phone || 'No phone'}) - {d.status}
                    </option>
                  ))}
                </select>
              </div>

              {/* Select Chassis / Trailer */}
              <div className="space-y-1.5">
                <label className="font-semibold text-[var(--text-muted)]">Skeletal / Flatbed Chassis *</label>
                <select
                  value={selectedTrailerId}
                  onChange={(e) => setSelectedTrailerId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                >
                  <option value="">-- Choose Chassis --</option>
                  {trailers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.plateNumber} · {t.trailerType} ({t.masterStatus} - {t.operationalStatus})
                    </option>
                  ))}
                </select>
              </div>

              {/* Port Gate Token */}
              <div className="space-y-1.5">
                <label className="font-semibold text-[var(--text-muted)]">Port Gate Token / Appointment Code</label>
                <input
                  type="text"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value.toUpperCase())}
                  placeholder="e.g. DPW-TKN-8841"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono font-bold uppercase outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-[var(--border-subtle)] flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setAssigningJob(null)}
                className="px-3 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmAssignment}
                disabled={submittingAssign}
                className="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-500 transition-colors shadow-sm disabled:opacity-50"
              >
                {submittingAssign ? 'Assigning Assets...' : 'Confirm Assignment & Token'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Token Modal */}
      {editingTokenJob && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl p-5 space-y-4">
            <h4 className="text-xs font-bold text-[var(--text-main)] flex items-center gap-2">
              <Key className="w-4 h-4 text-emerald-400" />
              Update Gate Token for {editingTokenJob.jobCode}
            </h4>
            <input
              type="text"
              value={newTokenValue}
              onChange={(e) => setNewTokenValue(e.target.value.toUpperCase())}
              placeholder="e.g. DPW-TKN-9021"
              className="w-full text-xs font-mono font-bold p-2.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500 uppercase"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingTokenJob(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--text-muted)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUpdateToken}
                className="px-3.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500 transition-colors"
              >
                Save Token
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
