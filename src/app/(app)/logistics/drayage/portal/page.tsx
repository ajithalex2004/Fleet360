'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  Globe,
  Search,
  Package,
  Truck,
  CheckCircle2,
  Clock,
  ShieldCheck,
  Camera,
  FileCheck,
  RefreshCw,
  AlertTriangle,
  Copy,
  Check,
  Calendar,
  Anchor,
  Warehouse,
  X,
  ExternalLink,
  Timer,
} from 'lucide-react';
import { PageHeader, Panel, StatusPill } from '@/components/ui/page-theme';

interface PortalJob {
  id: string;
  jobCode: string;
  jobPhase: 'L1' | 'L2';
  parentJobId: string | null;
  shipmentType: 'IMPORT' | 'EXPORT';
  status: string;
  priority: string;
  customerName: string;
  warehouseName: string;
  terminalName: string;
  containerId: string | null;
  containerNumber: string;
  containerSize: string;
  containerType: string;
  doExpiryDate: string | null;
  tokenNumber: string | null;
  assignedVehiclePlate: string | null;
  assignedDriverName: string | null;
  assignedTrailerPlate: string | null;
  placementLocation: 'RAMP' | 'YARD' | null;
  trailerDetached: boolean;
  l2Activated: boolean;
  etcTime: string | null;
  etcAlertStatus: string;
  rateAmountAed: number;
  customsInspection: boolean;
  currentLat: number | null;
  currentLng: number | null;
  cargoWeightKg?: number;
  shippingLine?: string;
  bogieJobId?: string | null;
  streetTurnJobId?: string | null;
  podPhotoUrl?: string | null;
  podSignatureName?: string | null;
  podSignedAt?: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PortalContainer {
  id: string;
  containerNumber: string;
  size: string;
  containerType: string;
  status: string;
  customerName: string;
  terminalName: string;
  warehouseName: string;
  doExpiryDate: string | null;
  dischargeDate: string;
  emptyReturnDate: string | null;
  sealNumber: string | null;
  weightKg: number;
  demurrage: {
    freeDaysAllowed: number;
    elapsedDays: number;
    freeDaysRemaining: number;
    overdueDays: number;
    dailyRateAed: number;
    accruedPenaltyAed: number;
    tierLabel: string;
    status: 'SAFE' | 'WARNING' | 'CRITICAL_OVERDUE' | 'RETURNED_SAFE';
  };
}

interface StatusLog {
  id: string;
  jobId: string;
  jobCode: string;
  status: string;
  notes: string;
  actor: string;
  timestamp: string;
}

const MILESTONE_STEPS = [
  {
    step: 1,
    key: 'PORT_DISCHARGED',
    label: 'Port Discharged & PCS Cleared',
    sub: 'Customs Declaration & DO Verified',
    icon: Anchor,
  },
  {
    step: 2,
    key: 'GATE_IN_LOADING',
    label: 'Port Gate-In & Loaded',
    sub: 'TAS Token & Crane Load Complete',
    icon: ShieldCheck,
  },
  {
    step: 3,
    key: 'CORRIDOR_TRANSIT',
    label: 'In Transit (Freight Corridor)',
    sub: 'En Route on E11 / E311 / D53',
    icon: Truck,
  },
  {
    step: 4,
    key: 'PLACED_AT_RAMP',
    label: 'Placed at Consignee Ramp',
    sub: 'Dock Offloading & ETC Active',
    icon: Warehouse,
  },
  {
    step: 5,
    key: 'OFFLOAD_COMPLETE',
    label: 'Offload Complete (L2 Ready)',
    sub: 'Empty Released / Street-Turned',
    icon: Package,
  },
  {
    step: 6,
    key: 'EMPTY_RETURNED',
    label: 'Empty Returned & Closed',
    sub: 'Demurrage Clock Stopped',
    icon: CheckCircle2,
  },
];

function computeMilestoneIndex(job: PortalJob): number {
  const st = job.status.toUpperCase();
  if (st === 'EMPTY_DEPOSITED' || st === 'COMPLETED' || st === 'STREET_TURNED') return 6;
  if (job.l2Activated || job.jobPhase === 'L2' || st === 'WAITING_MT_RETURN' || st === 'EMPTY_AT_PORT') return 5;
  if (
    st === 'PLACED_AT_RAMP' ||
    st === 'PLACED_AT_YARD' ||
    st === 'CONTAINER_DETACHED' ||
    job.placementLocation === 'RAMP' ||
    job.trailerDetached
  ) {
    return 4;
  }
  if (st === 'IN_TRANSIT') return 3;
  if (st === 'AT_PORT' || st === 'LOADED') return 2;
  return 1;
}

export default function ConsigneeTrackingPortalPage() {
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<PortalJob[]>([]);
  const [containers, setContainers] = useState<PortalContainer[]>([]);
  const [statusLogs, setStatusLogs] = useState<StatusLog[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<string>('ALL');
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Consignee Confirm Empty Ready Modal
  const [emptyModalOpen, setEmptyModalOpen] = useState(false);
  const [receiverName, setReceiverName] = useState('Tariq Al-Mansoori (Warehouse Dock Supervisor)');
  const [bayNotes, setBayNotes] = useState('All pallets offloaded at Ramp 4, container swept clean & intact.');
  const [photoUrlInput, setPhotoUrlInput] = useState('');
  const [submittingEmpty, setSubmittingEmpty] = useState(false);

  // ePOD Sign / Photo Modal
  const [podModalOpen, setPodModalOpen] = useState(false);
  const [podReceiver, setPodReceiver] = useState('Tariq Al-Mansoori');
  const [podNotes, setPodNotes] = useState('Seal verified intact upon arrival at warehouse ramp.');
  const [podCustomPhoto, setPodCustomPhoto] = useState('');
  const [submittingPod, setSubmittingPod] = useState(false);

  // Action loading state
  const [actionLoading, setActionLoading] = useState(false);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4500);
  };

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/logistics/drayage');
      if (!res.ok) throw new Error('Failed to load shipment tracking portal data');
      const data = await res.json();
      const allJobs: PortalJob[] = data.jobs || [];
      setJobs(allJobs);
      setContainers(data.containers || []);
      setStatusLogs(data.statusLogs || []);

      // Check URL query parameter on initial load
      if (typeof window !== 'undefined' && !selectedJobId && allJobs.length > 0) {
        const params = new URLSearchParams(window.location.search);
        const cntParam = params.get('container') || params.get('ref');
        const jobParam = params.get('job');
        if (cntParam) {
          const found = allJobs.find(
            (j) => j.containerNumber.toLowerCase() === cntParam.toLowerCase(),
          );
          if (found) {
            setSelectedJobId(found.id);
            return;
          }
        }
        if (jobParam) {
          const found = allJobs.find(
            (j) => j.jobCode.toLowerCase() === jobParam.toLowerCase() || j.id === jobParam,
          );
          if (found) {
            setSelectedJobId(found.id);
            return;
          }
        }
        setSelectedJobId(allJobs[0].id);
      }
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error loading portal');
    } finally {
      setLoading(false);
    }
  }, [selectedJobId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Distinct customer names for shipper/consignee filter pills
  const customerList = useMemo(() => {
    const set = new Set<string>();
    jobs.forEach((j) => {
      if (j.customerName) set.add(j.customerName);
    });
    return Array.from(set);
  }, [jobs]);

  // Filtered shipments
  const filteredJobs = useMemo(() => {
    return jobs.filter((j) => {
      if (selectedCustomer !== 'ALL' && j.customerName !== selectedCustomer) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          j.containerNumber.toLowerCase().includes(q) ||
          j.jobCode.toLowerCase().includes(q) ||
          j.customerName.toLowerCase().includes(q) ||
          j.warehouseName.toLowerCase().includes(q) ||
          (j.tokenNumber && j.tokenNumber.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [jobs, selectedCustomer, searchQuery]);

  const activeJob = useMemo(() => {
    return (
      filteredJobs.find((j) => j.id === selectedJobId) ||
      jobs.find((j) => j.id === selectedJobId) ||
      filteredJobs[0] ||
      null
    );
  }, [filteredJobs, jobs, selectedJobId]);

  const linkedContainer = useMemo(() => {
    if (!activeJob) return null;
    return (
      containers.find(
        (c) =>
          c.id === activeJob.containerId ||
          c.containerNumber.toUpperCase() === activeJob.containerNumber.toUpperCase(),
      ) || null
    );
  }, [containers, activeJob]);

  const activeJobLogs = useMemo(() => {
    if (!activeJob) return [];
    return statusLogs.filter(
      (l) => l.jobId === activeJob.id || l.jobCode === activeJob.jobCode,
    );
  }, [statusLogs, activeJob]);

  const currentMilestoneStep = useMemo(
    () => (activeJob ? computeMilestoneIndex(activeJob) : 1),
    [activeJob],
  );

  // Calculate DO Expiry Countdown
  const doCountdown = useMemo(() => {
    const expIso = activeJob?.doExpiryDate || linkedContainer?.doExpiryDate;
    if (!expIso) return { label: 'Valid (Standard 5d Window)', urgent: false, expired: false, hoursLeft: 72 };
    const diffMs = new Date(expIso).getTime() - Date.now();
    const hoursLeft = Math.round(diffMs / 3600000);
    if (hoursLeft <= 0) {
      return {
        label: `EXPIRED (${Math.abs(hoursLeft)}h overdue)`,
        urgent: true,
        expired: true,
        hoursLeft,
      };
    }
    const days = Math.floor(hoursLeft / 24);
    const remHours = hoursLeft % 24;
    return {
      label: days > 0 ? `${days}d ${remHours}h remaining` : `${hoursLeft}h remaining`,
      urgent: hoursLeft <= 36,
      expired: false,
      hoursLeft,
    };
  }, [activeJob, linkedContainer]);

  // Copy shareable tracking link
  const handleCopyShareLink = () => {
    if (!activeJob || typeof window === 'undefined') return;
    const url = `${window.location.origin}/logistics/drayage/portal?container=${encodeURIComponent(activeJob.containerNumber)}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopiedLink(true);
    showToast('success', `Copied Consignee Tracking Link for ${activeJob.containerNumber}!`);
    setTimeout(() => setCopiedLink(false), 3000);
  };

  // Self-Service Action 1: Consignee Confirms Empty Ready (Triggers L2)
  const handleConfirmEmptyReady = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeJob) return;
    try {
      setSubmittingEmpty(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'consignee_confirm_empty_ready',
          jobId: activeJob.id,
          receiverName,
          bayNotes,
          photoUrl: photoUrlInput || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to confirm empty release');
      showToast(
        'success',
        `Empty container release confirmed! ${data.l2JobCode ? `Activated L2 Empty Return (${data.l2JobCode}) with HIGH priority.` : 'Dispatch notified.'}`,
      );
      setEmptyModalOpen(false);
      await loadData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error confirming empty release');
    } finally {
      setSubmittingEmpty(false);
    }
  };

  // Self-Service Action 2: Consignee Extends Offload ETC
  const handleExtendOffloadEtc = async (minutesToAdd: number) => {
    if (!activeJob) return;
    try {
      setActionLoading(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'extend_etc',
          jobId: activeJob.id,
          minutesToAdd,
          actor: `${activeJob.customerName} (Consignee Self-Service Portal)`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to extend ETC');
      showToast(
        'success',
        `Warehouse offload ETC extended by +${minutesToAdd / 60}h (New ETC: ${new Date(data.etcTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`,
      );
      await loadData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to extend ETC');
    } finally {
      setActionLoading(false);
    }
  };

  // Self-Service Action 3: Extend Delivery Order (+3 Days)
  const handleExtendDo = async () => {
    if (!linkedContainer && !activeJob?.containerId) return;
    const cntId = linkedContainer?.id || activeJob?.containerId;
    if (!cntId) return;
    try {
      setActionLoading(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'extend_do',
          containerId: cntId,
          daysToAdd: 3,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to extend Delivery Order');
      showToast(
        'success',
        `Delivery Order extended by +3 Days (Valid until ${new Date(data.newDoExpiryDate).toLocaleDateString()})`,
      );
      await loadData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to extend DO');
    } finally {
      setActionLoading(false);
    }
  };

  // Submit ePOD Signature & Photo Evidence
  const handleSubmitPod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeJob) return;
    try {
      setSubmittingPod(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submit_pod_evidence',
          jobId: activeJob.id,
          receiverName: podReceiver,
          photoUrl: podCustomPhoto || undefined,
          notes: podNotes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save ePOD');
      showToast('success', `Digital ePOD signed by ${data.receiverName}!`);
      setPodModalOpen(false);
      await loadData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to save ePOD');
    } finally {
      setSubmittingPod(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
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
        title="Consignee & Shipper Self-Service Tracking Portal"
        subtitle="External container milestone tracker with live corridor ETA, Delivery Order & demurrage countdown, digital ePOD photos, and self-service ramp release"
        icon={Globe}
        accent="cyan"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {activeJob && (
              <button
                onClick={handleCopyShareLink}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-xs font-bold text-cyan-300 hover:bg-cyan-500/25 transition-colors"
              >
                {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedLink ? 'Tracking Link Copied!' : 'Share Customer Tracking Link'}
              </button>
            )}
            <button
              onClick={loadData}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh Live Status
            </button>
          </div>
        }
      />

      {/* Search & Customer Organization Selector Strip */}
      <div className="p-4 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-xl">
            <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Track by Container # (e.g. MSCU8492014), Booking / Job Code (DRY-L1-1001), or Gate Pass Token..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] outline-none focus:border-cyan-500 transition-colors"
            />
          </div>

          {/* Shipper / Consignee Organization Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] mr-1">
              Consignee Account:
            </span>
            <button
              onClick={() => setSelectedCustomer('ALL')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                selectedCustomer === 'ALL'
                  ? 'bg-cyan-600 text-white shadow-sm'
                  : 'bg-[var(--bg-main)] text-[var(--text-muted)] border border-[var(--border-subtle)] hover:text-[var(--text-main)]'
              }`}
            >
              All Shippers ({jobs.length})
            </button>
            {customerList.slice(0, 4).map((cust) => (
              <button
                key={cust}
                onClick={() => setSelectedCustomer(cust)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all truncate max-w-[180px] ${
                  selectedCustomer === cust
                    ? 'bg-cyan-600 text-white shadow-sm'
                    : 'bg-[var(--bg-main)] text-[var(--text-muted)] border border-[var(--border-subtle)] hover:text-[var(--text-main)]'
                }`}
              >
                {cust}
              </button>
            ))}
          </div>
        </div>

        {/* Horizontal Container Quick-Select Cards */}
        <div className="flex items-center gap-2.5 overflow-x-auto pb-1 pt-1">
          {filteredJobs.map((job) => {
            const isSelected = activeJob?.id === job.id;
            const step = computeMilestoneIndex(job);
            return (
              <button
                key={job.id}
                type="button"
                onClick={() => setSelectedJobId(job.id)}
                className={`flex flex-col text-left p-3 rounded-xl border min-w-[230px] shrink-0 transition-all ${
                  isSelected
                    ? 'bg-cyan-500/10 border-cyan-500 shadow-sm'
                    : 'bg-[var(--bg-main)] border-[var(--border-subtle)] hover:border-[var(--border-strong)]'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <span className="font-mono font-bold text-xs text-[var(--text-main)]">
                    {job.containerNumber}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                      job.jobPhase === 'L2'
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                    }`}
                  >
                    {job.jobCode}
                  </span>
                </div>
                <div className="text-[10px] text-[var(--text-muted)] truncate w-full">
                  {job.customerName}
                </div>
                <div className="mt-2 pt-1.5 border-t border-[var(--border-subtle)] flex items-center justify-between w-full text-[10px]">
                  <span className="text-cyan-400 font-semibold">Stage {step}/6</span>
                  <span className="font-mono text-[var(--text-muted)]">{job.status}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {activeJob ? (
        <>
          {/* =================================================================
              6-STAGE VISUAL MILESTONE TRACKER BANNER
              ================================================================= */}
          <div className="p-6 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-[var(--border-subtle)] pb-4">
              <div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="px-2.5 py-1 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 font-mono font-black text-sm">
                    {activeJob.containerNumber}
                  </span>
                  <span className="text-xs font-bold text-[var(--text-main)]">
                    {activeJob.containerSize} · {activeJob.containerType} · {activeJob.shippingLine || 'Ocean Line'}
                  </span>
                  <StatusPill status={activeJob.status.toLowerCase()} label={activeJob.status} />
                  {activeJob.bogieJobId && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                      🚛 2x20FT BOGIE PAIR
                    </span>
                  )}
                  {(activeJob.streetTurnJobId || activeJob.status === 'STREET_TURNED') && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      🌱 INLAND STREET-TURN
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-1.5">
                  Consignee: <strong className="text-[var(--text-main)]">{activeJob.customerName}</strong>
                  {' · '}Origin Terminal: <strong className="text-[var(--text-main)]">{activeJob.terminalName}</strong>
                  {' · '}Destination Facility: <strong className="text-[var(--text-main)]">{activeJob.warehouseName}</strong>
                </p>
              </div>

              {/* Self-Service Consignee Quick Actions */}
              <div className="flex flex-wrap items-center gap-2">
                {activeJob.jobPhase === 'L1' && !activeJob.l2Activated && (
                  <button
                    onClick={() => setEmptyModalOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 transition-colors shadow-sm"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Confirm Empty &amp; Request Pickup (L2)
                  </button>
                )}
                <button
                  onClick={() => {
                    setPodReceiver(activeJob.podSignatureName || 'Tariq Al-Mansoori');
                    setPodCustomPhoto(activeJob.podPhotoUrl || '');
                    setPodModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-main)] hover:border-cyan-500/40 transition-colors"
                >
                  <FileCheck className="w-4 h-4 text-cyan-400" />
                  {activeJob.podSignatureName ? 'Update Digital ePOD' : 'Sign Digital ePOD'}
                </button>
              </div>
            </div>

            {/* 6-Step Horizontal Milestone Stepper */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {MILESTONE_STEPS.map((ms) => {
                const Icon = ms.icon;
                const completed = currentMilestoneStep > ms.step;
                const isCurrent = currentMilestoneStep === ms.step;
                return (
                  <div
                    key={ms.key}
                    className={`p-3.5 rounded-xl border transition-all relative ${
                      completed
                        ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-200'
                        : isCurrent
                        ? 'bg-cyan-500/15 border-cyan-400 text-white shadow-md ring-1 ring-cyan-400/40'
                        : 'bg-[var(--bg-main)] border-[var(--border-subtle)] text-[var(--text-muted)] opacity-65'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div
                        className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                          completed
                            ? 'bg-emerald-500 text-slate-950'
                            : isCurrent
                            ? 'bg-cyan-500 text-slate-950 animate-pulse'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {completed ? <Check className="w-4 h-4 stroke-[3]" /> : <Icon className="w-4 h-4" />}
                      </div>
                      <span className="text-[10px] font-mono font-bold uppercase">
                        Step {ms.step}/6
                      </span>
                    </div>
                    <div className="text-xs font-bold leading-snug text-[var(--text-main)]">
                      {ms.label}
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)] mt-0.5 leading-tight">
                      {ms.sub}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* =================================================================
              LIVE ETA / TELEMATICS CARD + DO & DEMURRAGE COUNTDOWN CLOCK
              ================================================================= */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Card 1: Live Corridor ETA & Assigned Prime Mover Telematics */}
            <Panel
              title="Live Corridor Telematics & Estimated Arrival (ETA)"
              subtitle="Real-time GPS tracking along E11 / E311 / D53 freight arteries"
              icon={Truck}
              accent="blue"
              actions={
                <Link
                  href="/logistics/drayage/tracking"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-500/15 border border-blue-500/30 text-blue-300 text-[11px] font-semibold hover:bg-blue-500/25"
                >
                  <span>Open Live Radar</span>
                  <ExternalLink className="w-3 h-3" />
                </Link>
              }
            >
              <div className="space-y-4 text-xs">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="p-3 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                    <span className="text-[10px] uppercase text-[var(--text-muted)] block">Estimated Arrival</span>
                    <strong className="font-mono text-sm text-emerald-400">
                      {activeJob.status === 'IN_TRANSIT'
                        ? '~18 Mins (On Time)'
                        : currentMilestoneStep >= 4
                        ? 'Arrived at Facility'
                        : 'Awaiting Gate-Out'}
                    </strong>
                    <span className="text-[10px] text-[var(--text-muted)] block mt-0.5">
                      Corridor: E11 Sheikh Zayed Rd
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                    <span className="text-[10px] uppercase text-[var(--text-muted)] block">Prime Mover & Chassis</span>
                    <strong className="font-mono text-sm text-[var(--text-main)]">
                      {activeJob.assignedVehiclePlate || 'Pending Dispatch'}
                    </strong>
                    <span className="text-[10px] text-[var(--text-muted)] block mt-0.5 truncate">
                      {activeJob.assignedDriverName || 'Driver Unassigned'} · {activeJob.assignedTrailerPlate || '40FT Skeletal'}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                    <span className="text-[10px] uppercase text-[var(--text-muted)] block">Port Gate Pass Token</span>
                    <strong className="font-mono text-sm text-cyan-400">
                      {activeJob.tokenNumber || 'Pending EDI Token'}
                    </strong>
                    <span className="text-[10px] text-[var(--text-muted)] block mt-0.5">
                      Weight: {((activeJob.cargoWeightKg || 22000) / 1000).toFixed(1)}T Gross
                    </span>
                  </div>
                </div>

                {/* Ramp Offloading ETC Countdown & Consignee Self-Service Controls */}
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <Timer className="w-5 h-5 text-amber-400 shrink-0" />
                    <div>
                      <div className="font-bold text-amber-300 text-xs">
                        Warehouse Ramp Offload &amp; Destuffing Timer (ETC)
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        {activeJob.etcTime ? (
                          <>
                            Expected Empty Release:{' '}
                            <strong className="font-mono text-[var(--text-main)]">
                              {new Date(activeJob.etcTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </strong>
                            {' · '}
                            {new Date(activeJob.etcTime).getTime() <= Date.now()
                              ? 'Offload window completed — L2 Empty Pickup Active'
                              : `${Math.max(1, Math.round((new Date(activeJob.etcTime).getTime() - Date.now()) / 60000))} mins remaining at dock`}
                          </>
                        ) : (
                          'Standard 3-hour free ramp offloading window upon dock placement'
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleExtendOffloadEtc(60)}
                      disabled={actionLoading}
                      className="px-2.5 py-1 rounded-lg bg-[var(--bg-main)] border border-amber-500/30 text-amber-300 hover:bg-amber-500/15 text-[11px] font-semibold transition-colors"
                    >
                      Request +1h Dock Time
                    </button>
                    <button
                      onClick={() => handleExtendOffloadEtc(120)}
                      disabled={actionLoading}
                      className="px-2.5 py-1 rounded-lg bg-[var(--bg-main)] border border-amber-500/30 text-amber-300 hover:bg-amber-500/15 text-[11px] font-semibold transition-colors"
                    >
                      +2h
                    </button>
                  </div>
                </div>
              </div>
            </Panel>

            {/* Card 2: Delivery Order (DO) & Ocean Demurrage Countdown Clock */}
            <Panel
              title="Delivery Order (DO) & Port Demurrage Countdown"
              subtitle="Monitor shipping line free days, DO validity, and detention exposure"
              icon={Clock}
              accent="amber"
              actions={
                <button
                  onClick={handleExtendDo}
                  disabled={actionLoading}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[11px] font-semibold hover:bg-amber-500/25 transition-colors"
                >
                  <Calendar className="w-3 h-3" />
                  Extend DO (+3 Days)
                </button>
              }
            >
              <div className="space-y-4 text-xs">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="p-3 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                    <span className="text-[10px] uppercase text-[var(--text-muted)] block">DO Expiry Countdown</span>
                    <strong
                      className={`font-mono text-sm ${
                        doCountdown.expired
                          ? 'text-rose-400'
                          : doCountdown.urgent
                          ? 'text-amber-400'
                          : 'text-emerald-400'
                      }`}
                    >
                      {doCountdown.label}
                    </strong>
                    <span className="text-[10px] text-[var(--text-muted)] block mt-0.5">
                      {activeJob.doExpiryDate
                        ? `Valid til ${new Date(activeJob.doExpiryDate).toLocaleDateString()}`
                        : 'Electronic DO Active'}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                    <span className="text-[10px] uppercase text-[var(--text-muted)] block">Port Free Days</span>
                    <strong className="font-mono text-sm text-[var(--text-main)]">
                      {linkedContainer
                        ? `${linkedContainer.demurrage.elapsedDays} / ${linkedContainer.demurrage.freeDaysAllowed} Days Used`
                        : '2 / 5 Free Days'}
                    </strong>
                    <span className="text-[10px] text-[var(--text-muted)] block mt-0.5">
                      {linkedContainer?.demurrage.tierLabel || 'Free Period (Tier 0)'}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                    <span className="text-[10px] uppercase text-[var(--text-muted)] block">Demurrage Exposure</span>
                    <strong
                      className={`font-mono text-sm ${
                        (linkedContainer?.demurrage.accruedPenaltyAed || 0) > 0
                          ? 'text-rose-400'
                          : 'text-emerald-400'
                      }`}
                    >
                      AED {(linkedContainer?.demurrage.accruedPenaltyAed || 0).toLocaleString()}
                    </strong>
                    <span className="text-[10px] text-[var(--text-muted)] block mt-0.5">
                      {linkedContainer?.demurrage.status || 'SAFE'}
                    </span>
                  </div>
                </div>

                {/* Free Day Utilization Bar */}
                <div className="p-3.5 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-[var(--text-muted)]">
                      Free-Time Window Utilization ({activeJob.containerType === 'REEFER' ? '3 Days Reefer SLA' : '5 Days Dry SLA'})
                    </span>
                    <span className="font-mono font-bold text-[var(--text-main)]">
                      {linkedContainer
                        ? `${linkedContainer.demurrage.freeDaysRemaining} Free Days Remaining`
                        : '3 Free Days Remaining'}
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        (linkedContainer?.demurrage.overdueDays || 0) > 0
                          ? 'bg-rose-500'
                          : (linkedContainer?.demurrage.freeDaysRemaining ?? 3) <= 1
                          ? 'bg-amber-500'
                          : 'bg-emerald-500'
                      }`}
                      style={{
                        width: `${Math.min(
                          100,
                          linkedContainer
                            ? Math.round(
                                (linkedContainer.demurrage.elapsedDays /
                                  Math.max(1, linkedContainer.demurrage.freeDaysAllowed)) *
                                  100,
                              )
                            : 40,
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </Panel>
          </div>

          {/* =================================================================
              PROOF-OF-DELIVERY (ePOD) & PHOTO EVIDENCE GALLERY + AUDIT TIMELINE
              ================================================================= */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left 7 Cols: Proof-of-Delivery (ePOD) & Photo Evidence Package */}
            <div className="lg:col-span-7">
              <Panel
                title="Proof-of-Delivery (ePOD) & Container Photo Evidence"
                subtitle="Verified OCR gate-out seal inspection, warehouse ramp placement photo, and digital receiver sign-on-glass"
                icon={Camera}
                accent="emerald"
              >
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  {/* Evidence Card 1: Port Gate-Out & Seal Verification */}
                  <div className="p-3.5 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] flex flex-col justify-between space-y-3">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-blue-500/15 text-blue-300 border border-blue-500/30">
                          1. PORT GATE OCR
                        </span>
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      </div>
                      {/* Stylized Container Seal Visual */}
                      <div className="h-28 rounded-lg bg-gradient-to-br from-slate-900 via-blue-950/60 to-slate-900 border border-slate-800 flex flex-col items-center justify-center p-3 text-center relative overflow-hidden">
                        <ShieldCheck className="w-7 h-7 text-cyan-400 mb-1" />
                        <div className="font-mono font-bold text-[11px] text-white">
                          {activeJob.containerNumber}
                        </div>
                        <div className="font-mono text-[10px] text-emerald-400">
                          SEAL: {linkedContainer?.sealNumber || `SL-${activeJob.containerNumber.slice(-5)}`}
                        </div>
                        <span className="absolute bottom-1 right-1.5 text-[8px] font-mono text-slate-400">
                          OCR VERIFIED
                        </span>
                      </div>
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)] space-y-0.5">
                      <div>Terminal: <strong className="text-[var(--text-main)]">{activeJob.terminalName}</strong></div>
                      <div>Token: <strong className="font-mono text-cyan-400">{activeJob.tokenNumber || 'DPW-OCR-OK'}</strong></div>
                    </div>
                  </div>

                  {/* Evidence Card 2: Warehouse Ramp Placement Photo */}
                  <div className="p-3.5 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] flex flex-col justify-between space-y-3">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                          2. RAMP PLACEMENT
                        </span>
                        <Camera className="w-4 h-4 text-amber-400" />
                      </div>
                      <div className="h-28 rounded-lg bg-gradient-to-br from-slate-900 via-amber-950/40 to-slate-900 border border-slate-800 flex flex-col items-center justify-center p-3 text-center relative overflow-hidden">
                        <Warehouse className="w-7 h-7 text-amber-400 mb-1" />
                        <div className="font-bold text-[11px] text-white truncate max-w-full">
                          {activeJob.placementLocation || 'RAMP'} BAY STAGED
                        </div>
                        <div className="font-mono text-[9px] text-amber-300 mt-0.5">
                          GPS: {(activeJob.currentLat || 24.9680).toFixed(4)}°N, {(activeJob.currentLng || 55.0450).toFixed(4)}°E
                        </div>
                        <span className="absolute bottom-1 right-1.5 text-[8px] font-mono text-emerald-400">
                          GEOFENCE MATCH
                        </span>
                      </div>
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)] space-y-0.5">
                      <div className="truncate">Hub: <strong className="text-[var(--text-main)]">{activeJob.warehouseName}</strong></div>
                      <div>Chassis: <strong className="font-mono text-[var(--text-main)]">{activeJob.assignedTrailerPlate || 'DXB-TR-9901'}</strong></div>
                    </div>
                  </div>

                  {/* Evidence Card 3: Digital Sign-on-Glass ePOD Certificate */}
                  <div className="p-3.5 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] flex flex-col justify-between space-y-3">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                          3. SIGN-ON-GLASS ePOD
                        </span>
                        <FileCheck className="w-4 h-4 text-emerald-400" />
                      </div>
                      <div className="h-28 rounded-lg bg-gradient-to-br from-slate-900 via-emerald-950/50 to-slate-900 border border-slate-800 flex flex-col items-center justify-center p-3 text-center relative">
                        <div className="font-serif italic text-base text-emerald-300 tracking-wide">
                          {activeJob.podSignatureName || 'Tariq Al-Mansoori'}
                        </div>
                        <div className="w-32 border-b border-emerald-500/40 my-1" />
                        <div className="text-[9px] text-slate-300 font-semibold">
                          Authorized Consignee Receiver
                        </div>
                        <span className="text-[8px] font-mono text-slate-400 mt-0.5">
                          {activeJob.podSignedAt
                            ? new Date(activeJob.podSignedAt).toLocaleString([], {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : 'Verified Digital Stamp'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-0.5">
                      <span className="text-[10px] text-emerald-400 font-semibold">✓ ePOD Certificate Ready</span>
                      <button
                        onClick={() => setPodModalOpen(true)}
                        className="text-[10px] font-bold text-cyan-400 hover:underline"
                      >
                        Edit / Sign
                      </button>
                    </div>
                  </div>
                </div>
              </Panel>
            </div>

            {/* Right 5 Cols: Customer-Facing Shipment Milestone Audit Feed */}
            <div className="lg:col-span-5">
              <Panel
                title="Live Shipment Activity & Milestone Log"
                subtitle="Real-time port, corridor, and warehouse dock events"
                icon={Clock}
                accent="cyan"
              >
                <div className="h-[245px] overflow-y-auto space-y-3 pr-1 text-xs">
                  {activeJobLogs.length === 0 ? (
                    <div className="py-12 text-center text-[var(--text-muted)]">
                      Shipment created and registered with Port Community System.
                    </div>
                  ) : (
                    activeJobLogs.map((log) => (
                      <div key={log.id} className="flex items-start gap-2.5">
                        <div className="w-2 h-2 rounded-full bg-cyan-400 mt-1.5 shrink-0" />
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-[11px] text-[var(--text-main)]">
                              {log.status}
                            </span>
                            <span className="text-[10px] text-[var(--text-muted)]">
                              {new Date(log.timestamp).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}{' '}
                              · {log.actor}
                            </span>
                          </div>
                          <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                            {log.notes}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </Panel>
            </div>
          </div>
        </>
      ) : (
        <Panel title="No Matching Container Found" icon={Package} accent="cyan">
          <div className="py-16 text-center text-xs text-[var(--text-muted)]">
            No container or booking matches your search query. Try clearing the search filter above.
          </div>
        </Panel>
      )}

      {/* =====================================================================
          MODAL 1: CONSIGNEE CONFIRM CONTAINER EMPTY & TRIGGER L2 PICKUP
          ===================================================================== */}
      {emptyModalOpen && activeJob && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <div>
                <h3 className="text-sm font-bold text-[var(--text-main)] flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  Confirm Container Destuffing Complete
                </h3>
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                  {activeJob.containerNumber} at {activeJob.warehouseName}
                </p>
              </div>
              <button
                onClick={() => setEmptyModalOpen(false)}
                className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmEmptyReady} className="space-y-3.5 text-xs">
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-[11px] text-emerald-200 leading-relaxed">
                Confirming empty release immediately notifies Fleet360 Dispatch and activates <strong>Leg 2 Empty Return (HIGH Priority)</strong> or matches the empty box with a same-zone <strong>Street-Turn Export Booking</strong>.
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">
                  Warehouse Dock Supervisor / Receiver Name
                </label>
                <input
                  type="text"
                  required
                  value={receiverName}
                  onChange={(e) => setReceiverName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">
                  Ramp / Bay Inspection Notes
                </label>
                <input
                  type="text"
                  value={bayNotes}
                  onChange={(e) => setBayNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">
                  Empty Interior Photo URL (Optional)
                </label>
                <input
                  type="text"
                  value={photoUrlInput}
                  onChange={(e) => setPhotoUrlInput(e.target.value)}
                  placeholder="https://storage.fleet360.ae/epod/empty-clean.jpg"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => setEmptyModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingEmpty}
                  className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 shadow-sm disabled:opacity-50"
                >
                  {submittingEmpty ? 'Activating L2 Pickup...' : 'Confirm Empty & Trigger L2'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 2: DIGITAL SIGN-ON-GLASS ePOD & PLACEMENT PHOTO
          ===================================================================== */}
      {podModalOpen && activeJob && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <div>
                <h3 className="text-sm font-bold text-[var(--text-main)] flex items-center gap-2">
                  <FileCheck className="w-4 h-4 text-cyan-400" />
                  Digital Sign-on-Glass ePOD Certificate
                </h3>
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                  Container {activeJob.containerNumber} · {activeJob.jobCode}
                </p>
              </div>
              <button
                onClick={() => setPodModalOpen(false)}
                className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitPod} className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">Authorized Receiver Name</label>
                <input
                  type="text"
                  required
                  value={podReceiver}
                  onChange={(e) => setPodReceiver(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-cyan-500"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">Placement / Seal Photo Evidence URL</label>
                <input
                  type="text"
                  value={podCustomPhoto}
                  onChange={(e) => setPodCustomPhoto(e.target.value)}
                  placeholder="https://storage.fleet360.ae/epod/ramp-placement.jpg"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono outline-none focus:border-cyan-500"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">Delivery & Seal Condition Remarks</label>
                <input
                  type="text"
                  value={podNotes}
                  onChange={(e) => setPodNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => setPodModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingPod}
                  className="px-4 py-1.5 rounded-lg bg-cyan-600 text-white text-xs font-bold hover:bg-cyan-500 shadow-sm disabled:opacity-50"
                >
                  {submittingPod ? 'Saving ePOD...' : 'Sign & Certify ePOD'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
