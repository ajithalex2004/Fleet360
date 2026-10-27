'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  Navigation, Package, Truck, CheckCircle2, AlertTriangle, RefreshCw,
  Search, ShieldCheck, MapPin, Send, MessageSquare, Clock, Plus,
  Layers, Unplug, ArrowRight, Eye, UserCheck, Key, FileText, Check,
} from 'lucide-react';
import { PageHeader, KpiCard, Panel, StatusPill } from '@/components/ui/page-theme';

interface DrayageJob {
  id: string;
  jobCode: string;
  jobPhase: 'L1' | 'L2';
  parentJobId: string | null;
  shipmentType: string;
  status: string;
  priority: string;
  customerName: string;
  warehouseName: string;
  terminalName: string;
  containerId: string | null;
  containerNumber: string;
  containerSize: string;
  containerType: string;
  tokenNumber: string | null;
  assignedVehiclePlate: string | null;
  assignedDriverName: string | null;
  assignedTrailerPlate: string | null;
  placementLocation: 'RAMP' | 'YARD' | null;
  trailerDetached: boolean;
  l2Activated: boolean;
  rateAmountAed: number;
  driverAllowanceAed: number;
  customsInspection: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
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

interface DispatchMessage {
  id: string;
  jobId: string;
  jobCode: string;
  senderRole: 'DISPATCHER' | 'DRIVER';
  senderName: string;
  message: string;
  isUrgent: boolean;
  createdAt: string;
}

export default function DrayageJobTrackingPage() {
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<DrayageJob[]>([]);
  const [statusLogs, setStatusLogs] = useState<StatusLog[]>([]);
  const [messages, setMessages] = useState<DispatchMessage[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  // EDI verification state
  const [ediLoading, setEdiLoading] = useState(false);
  const [ediResult, setEdiResult] = useState<any | null>(null);

  // Multi-leg modal state
  const [showLegModal, setShowLegModal] = useState(false);
  const [legType, setLegType] = useState('CUSTOMS_INSPECTION');
  const [legPickup, setLegPickup] = useState('');
  const [legDropoff, setLegDropoff] = useState('');
  const [legRate, setLegRate] = useState(250);
  const [submittingLeg, setSubmittingLeg] = useState(false);

  // Chat input
  const [chatInput, setChatInput] = useState('');
  const [chatUrgent, setChatUrgent] = useState(false);
  const [sendingChat, setSendingChat] = useState(false);

  // Status updating
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/logistics/drayage');
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || errJson?.message || 'Failed to load tracking data');
      }
      const data = await res.json();
      const allJobs: DrayageJob[] = data.jobs || [];
      setJobs(allJobs);
      setStatusLogs(data.statusLogs || []);
      setMessages(data.messages || []);

      if (allJobs.length > 0 && !selectedJobId) {
        setSelectedJobId(allJobs[0].id);
      }
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to load tracking workspace');
    } finally {
      setLoading(false);
    }
  }, [selectedJobId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const activeJob = useMemo(() => {
    return jobs.find((j) => j.id === selectedJobId) || jobs[0] || null;
  }, [jobs, selectedJobId]);

  const jobLogs = useMemo(() => {
    if (!activeJob) return [];
    return statusLogs.filter((l) => l.jobId === activeJob.id || l.jobCode === activeJob.jobCode);
  }, [statusLogs, activeJob]);

  const jobMessages = useMemo(() => {
    if (!activeJob) return [];
    return messages.filter((m) => m.jobId === activeJob.id || m.jobCode === activeJob.jobCode);
  }, [messages, activeJob]);

  // Handle stage transition
  const handleUpdateStatus = async (
    newStatus: string,
    placement?: 'RAMP' | 'YARD',
    detach?: boolean,
  ) => {
    if (!activeJob) return;
    try {
      setUpdatingStatus(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_status',
          jobId: activeJob.id,
          status: newStatus,
          placementLocation: placement,
          detachTrailer: detach,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update stage status');
      showToast('success', `Job transitioned to ${newStatus}`);
      await loadData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error updating stage');
    } finally {
      setUpdatingStatus(false);
    }
  };

  // Trigger L2 Empty Return
  const handleTriggerL2 = async () => {
    if (!activeJob) return;
    try {
      setUpdatingStatus(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'activate_l2', l1JobId: activeJob.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to activate L2 empty return');
      showToast('success', `L2 Empty Return job ${data.l2JobCode} activated!`);
      await loadData();
      if (data.l2JobId) setSelectedJobId(data.l2JobId);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error activating L2');
    } finally {
      setUpdatingStatus(false);
    }
  };

  // Verify Port EDI
  const handleVerifyEdi = async (provider: 'DUBAI_TRADE_DPWORLD' | 'AD_PORTS_MAQTA') => {
    if (!activeJob) return;
    try {
      setEdiLoading(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify_port_edi', jobId: activeJob.id, provider }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'EDI verification failed');
      setEdiResult(data);
      showToast('success', `${data.providerLabel}: Customs Cleared & Gate Pass Validated!`);
      await loadData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'EDI check failed');
    } finally {
      setEdiLoading(false);
    }
  };

  // Append Itinerary Leg
  const handleAddItineraryLeg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeJob) return;
    try {
      setSubmittingLeg(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'append_itinerary_leg',
          jobId: activeJob.id,
          legType,
          pickupLocation: legPickup || activeJob.terminalName,
          dropoffLocation: legDropoff || 'Customs Inspection Yard',
          rateAed: legRate,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to append itinerary leg');
      showToast('success', `Appended ${legType} (+AED ${data.addedRateAed}) to trip!`);
      setShowLegModal(false);
      await loadData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error adding leg');
    } finally {
      setSubmittingLeg(false);
    }
  };

  // Send Dispatch Chat Message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeJob || !chatInput.trim()) return;
    try {
      setSendingChat(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send_dispatch_message',
          jobId: activeJob.id,
          senderRole: 'DISPATCHER',
          senderName: 'Port Operations Desk',
          message: chatInput.trim(),
          isUrgent: chatUrgent,
        }),
      });
      if (!res.ok) throw new Error('Failed to send message');
      setChatInput('');
      setChatUrgent(false);
      await loadData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error sending message');
    } finally {
      setSendingChat(false);
    }
  };

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
        title="Live Job Tracking & Execution Console"
        subtitle="Manage execution stages, DP World Dubai Trade & AD Ports Maqta EDI gate checks, multi-leg additions, and driver communications"
        icon={Navigation}
        accent="blue"
        actions={
          <button
            onClick={loadData}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        }
      />

      {/* Main Split Layout: Left Active Jobs Selector / Right Detailed Execution Console */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Jobs List (4 cols) */}
        <div className="lg:col-span-4 space-y-3">
          <div className="p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-between">
            <span className="text-xs font-bold text-[var(--text-main)]">Active Drayage Jobs</span>
            <span className="text-[11px] font-semibold text-[var(--text-muted)]">{jobs.length} Jobs</span>
          </div>

          <div className="space-y-2 max-h-[780px] overflow-y-auto pr-1">
            {jobs.map((job) => {
              const selected = activeJob?.id === job.id;
              return (
                <div
                  key={job.id}
                  onClick={() => setSelectedJobId(job.id)}
                  className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                    selected
                      ? 'bg-blue-600/10 border-blue-500 text-[var(--text-main)] shadow-sm'
                      : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] hover:border-[var(--border-strong)]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-bold text-xs">{job.jobCode}</span>
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
                    <StatusPill status={job.status.toLowerCase()} label={job.status} />
                  </div>

                  <div className="font-mono font-semibold text-xs text-[var(--text-main)] flex items-center gap-2">
                    <span>{job.containerNumber}</span>
                    <span className="text-[10px] font-normal text-[var(--text-muted)]">({job.containerSize})</span>
                  </div>

                  <div className="text-[11px] text-[var(--text-muted)] truncate mt-1">
                    {job.terminalName} → {job.warehouseName}
                  </div>

                  <div className="text-[10px] text-[var(--text-muted)] pt-2 mt-2 border-t border-[var(--border-subtle)] flex items-center justify-between">
                    <span>{job.assignedVehiclePlate || 'Tractor unassigned'}</span>
                    <span>AED {job.rateAmountAed.toLocaleString()}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Active Job Execution Console (8 cols) */}
        <div className="lg:col-span-8 space-y-6">
          {activeJob ? (
            <>
              {/* Job Banner Card */}
              <div className="p-5 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-black font-mono text-[var(--text-main)]">{activeJob.jobCode}</h2>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                          activeJob.jobPhase === 'L2'
                            ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                            : 'bg-blue-500/15 text-blue-400 border-blue-500/30'
                        }`}
                      >
                        {activeJob.jobPhase} Trip
                      </span>
                      <StatusPill status={activeJob.status.toLowerCase()} label={activeJob.status} />
                    </div>
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                      {activeJob.customerName} · {activeJob.shipmentType} Manifest
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowLegModal(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-main)] hover:border-blue-500/40 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5 text-blue-400" />
                      Add Intermediate Leg
                    </button>
                    {activeJob.jobPhase === 'L1' && !activeJob.l2Activated && (
                      <button
                        onClick={handleTriggerL2}
                        disabled={updatingStatus}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-xs font-semibold text-amber-400 hover:bg-amber-500/25 transition-colors"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Trigger L2 Empty Return
                      </button>
                    )}
                  </div>
                </div>

                {/* Key Attributes */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div className="p-2.5 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                    <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] block">Container</span>
                    <strong className="font-mono text-[var(--text-main)] text-sm">{activeJob.containerNumber}</strong>
                    <div className="text-[10px] text-[var(--text-muted)]">{activeJob.containerSize} · {activeJob.containerType}</div>
                  </div>

                  <div className="p-2.5 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                    <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] block">Gate Token</span>
                    <strong className="font-mono text-emerald-400 text-sm">
                      {activeJob.tokenNumber || 'No Token Yet'}
                    </strong>
                    <div className="text-[10px] text-[var(--text-muted)]">Verified Gate Pass</div>
                  </div>

                  <div className="p-2.5 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                    <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] block">Assigned Fleet</span>
                    <strong className="text-[var(--text-main)] text-sm">
                      {activeJob.assignedVehiclePlate || 'Unassigned'}
                    </strong>
                    <div className="text-[10px] text-[var(--text-muted)] truncate">
                      {activeJob.assignedDriverName || 'No Driver'} · {activeJob.assignedTrailerPlate || 'Chassis'}
                    </div>
                  </div>

                  <div className="p-2.5 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                    <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] block">Commercial Value</span>
                    <strong className="font-mono text-[var(--text-main)] text-sm">
                      AED {activeJob.rateAmountAed.toLocaleString()}
                    </strong>
                    <div className="text-[10px] text-[var(--text-muted)]">
                      Driver Allowance: AED {activeJob.driverAllowanceAed}
                    </div>
                  </div>
                </div>

                {/* Execution Stage Action Buttons */}
                <div className="pt-2">
                  <div className="text-[11px] font-bold text-[var(--text-main)] mb-2 flex items-center justify-between">
                    <span>Operational Stage Actions:</span>
                    <span className="text-[10px] text-[var(--text-muted)]">Click button to advance workflow</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => handleUpdateStatus('AT_PORT')}
                      disabled={updatingStatus}
                      className="px-3 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-main)] hover:border-blue-500 hover:text-blue-400 transition-colors"
                    >
                      1. Gated In Port
                    </button>
                    <button
                      onClick={() => handleUpdateStatus('LOADED')}
                      disabled={updatingStatus}
                      className="px-3 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-main)] hover:border-blue-500 hover:text-blue-400 transition-colors"
                    >
                      2. Container Loaded
                    </button>
                    <button
                      onClick={() => handleUpdateStatus('IN_TRANSIT')}
                      disabled={updatingStatus}
                      className="px-3 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-main)] hover:border-blue-500 hover:text-blue-400 transition-colors"
                    >
                      3. In Transit (E11)
                    </button>
                    <button
                      onClick={() => handleUpdateStatus('PLACED_AT_RAMP', 'RAMP', false)}
                      disabled={updatingStatus}
                      className="px-3 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-main)] hover:border-blue-500 hover:text-blue-400 transition-colors"
                    >
                      4. Placed at Ramp
                    </button>
                    <button
                      onClick={() => handleUpdateStatus('CONTAINER_DETACHED', 'RAMP', true)}
                      disabled={updatingStatus}
                      className="px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-xs font-semibold text-amber-400 hover:bg-amber-500/25 transition-colors"
                    >
                      5. Detach Trailer
                    </button>
                    <button
                      onClick={() => handleUpdateStatus('EMPTY_DEPOSITED', undefined, false)}
                      disabled={updatingStatus}
                      className="px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/25 transition-colors"
                    >
                      6. Complete & Deposit MT
                    </button>
                  </div>
                </div>
              </div>

              {/* Port EDI Verification Panel */}
              <Panel
                title="Port Community System (PCS) EDI Verification"
                subtitle="Live status query with Dubai Trade (DP World Jebel Ali) and Maqta Gateway (AD Ports Khalifa Port)"
                icon={ShieldCheck}
                accent="cyan"
                actions={
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleVerifyEdi('DUBAI_TRADE_DPWORLD')}
                      disabled={ediLoading}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/15 border border-blue-500/30 text-xs font-semibold text-blue-400 hover:bg-blue-600/25 transition-colors"
                    >
                      <ShieldCheck className={`w-3.5 h-3.5 ${ediLoading ? 'animate-spin' : ''}`} />
                      Verify DP World Dubai Trade
                    </button>
                    <button
                      onClick={() => handleVerifyEdi('AD_PORTS_MAQTA')}
                      disabled={ediLoading}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600/15 border border-cyan-500/30 text-xs font-semibold text-cyan-400 hover:bg-cyan-600/25 transition-colors"
                    >
                      <ShieldCheck className={`w-3.5 h-3.5 ${ediLoading ? 'animate-spin' : ''}`} />
                      Verify AD Ports Maqta
                    </button>
                  </div>
                }
              >
                {ediResult ? (
                  <div className="p-4 rounded-xl bg-[var(--bg-main)] border border-emerald-500/30 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-emerald-400 flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        EDI Electronic Clearance Received ({ediResult.providerLabel})
                      </span>
                      <span className="font-mono text-[10px] text-[var(--text-muted)]">
                        {new Date(ediResult.verifiedAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 text-[11px]">
                      <div>
                        Customs Status: <strong className="text-emerald-400">{ediResult.customsStatus}</strong>
                      </div>
                      <div>
                        Delivery Order: <strong className="text-emerald-400">{ediResult.doStatus}</strong>
                      </div>
                      <div>
                        Vessel / Berth: <strong className="text-[var(--text-main)]">{ediResult.vesselName}</strong>
                      </div>
                      <div>
                        Gate Pass: <strong className="text-emerald-400">APPROVED (Token: {ediResult.tokenNumber})</strong>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="py-6 text-center text-xs text-[var(--text-muted)]">
                    Click either &quot;Verify DP World Dubai Trade&quot; or &quot;Verify AD Ports Maqta&quot; to ping the port community EDI API and authenticate customs seal, DO expiry, and OCR gate pass readiness.
                  </div>
                )}
              </Panel>

              {/* Chat & Status Logs Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Dispatcher <-> Driver Chat */}
                <Panel
                  title="Dispatcher ↔ Driver Communications"
                  subtitle="Instruction thread with urgent alert flag"
                  icon={MessageSquare}
                  accent="blue"
                >
                  <div className="flex flex-col h-[320px]">
                    <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                      {jobMessages.length === 0 ? (
                        <div className="py-12 text-center text-xs text-[var(--text-muted)]">
                          No dispatch messages on this job yet. Send an instruction or checkpoint notice below.
                        </div>
                      ) : (
                        jobMessages.map((msg) => {
                          const isDriver = msg.senderRole === 'DRIVER';
                          return (
                            <div
                              key={msg.id}
                              className={`p-2.5 rounded-xl text-xs max-w-[85%] space-y-1 ${
                                isDriver
                                  ? 'bg-[var(--bg-main)] border border-[var(--border-subtle)] mr-auto'
                                  : 'bg-blue-600/15 border border-blue-500/30 text-blue-200 ml-auto'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2 text-[10px] text-[var(--text-muted)]">
                                <strong>{msg.senderName}</strong>
                                <span>{new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                              </div>
                              <p className="leading-relaxed text-[var(--text-main)]">{msg.message}</p>
                              {msg.isUrgent && (
                                <span className="inline-block px-1.5 py-0.2 rounded text-[9px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
                                  URGENT
                                </span>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>

                    <form onSubmit={handleSendMessage} className="pt-3 border-t border-[var(--border-subtle)] space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          placeholder="Type dispatch instruction to driver..."
                          className="flex-1 text-xs px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                        />
                        <button
                          type="submit"
                          disabled={sendingChat || !chatInput.trim()}
                          className="px-3.5 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-500 transition-colors disabled:opacity-50"
                        >
                          <Send className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <label className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={chatUrgent}
                          onChange={(e) => setChatUrgent(e.target.checked)}
                          className="rounded border-[var(--border-subtle)] text-rose-600"
                        />
                        <span>Flag as URGENT instruction</span>
                      </label>
                    </form>
                  </div>
                </Panel>

                {/* Status Timeline Logs */}
                <Panel
                  title="Execution Status Timeline"
                  subtitle="Audit trail of stage events & inspections"
                  icon={Clock}
                  accent="amber"
                >
                  <div className="h-[320px] overflow-y-auto space-y-3 pr-1">
                    {jobLogs.length === 0 ? (
                      <div className="py-12 text-center text-xs text-[var(--text-muted)]">
                        No audit events recorded yet.
                      </div>
                    ) : (
                      jobLogs.map((log) => (
                        <div key={log.id} className="flex items-start gap-2.5 text-xs">
                          <div className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                          <div className="space-y-0.5 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-[var(--text-main)] font-mono text-[11px]">{log.status}</span>
                              <span className="text-[10px] text-[var(--text-muted)]">
                                {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {log.actor}
                              </span>
                            </div>
                            <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">{log.notes}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </Panel>
              </div>
            </>
          ) : (
            <Panel title="Select a Job" icon={Package} accent="blue">
              <div className="py-20 text-center text-xs text-[var(--text-muted)]">
                Select an active drayage job from the left queue to open its execution console.
              </div>
            </Panel>
          )}
        </div>
      </div>

      {/* Multi-Leg Itinerary Modal */}
      {showLegModal && activeJob && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl p-6 space-y-4">
            <h3 className="text-sm font-bold text-[var(--text-main)] flex items-center gap-2">
              <Plus className="w-4 h-4 text-blue-400" />
              Append Intermediate Leg to {activeJob.jobCode}
            </h3>
            <p className="text-xs text-[var(--text-muted)]">
              Add regulatory stops (Customs Inspection, Dubai Municipality, Fumigation, or Weighbridge) and adjust trip revenue.
            </p>

            <form onSubmit={handleAddItineraryLeg} className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">Leg Type</label>
                <select
                  value={legType}
                  onChange={(e) => setLegType(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                >
                  <option value="CUSTOMS_INSPECTION">Dubai Customs Inspection Bay</option>
                  <option value="DM_INSPECTION">Dubai Municipality (DM) Food Sampling</option>
                  <option value="FUMIGATION">Plant Protection / Merc Fumigation</option>
                  <option value="WEIGHBRIDGE">Government Certified Weighbridge Tare</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">Pickup Point</label>
                <input
                  type="text"
                  value={legPickup}
                  onChange={(e) => setLegPickup(e.target.value)}
                  placeholder={activeJob.terminalName}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">Dropoff / Inspection Destination</label>
                <input
                  type="text"
                  value={legDropoff}
                  onChange={(e) => setLegDropoff(e.target.value)}
                  placeholder="e.g. JAFZA Customs Scanning Facility"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">Additional Charge (AED)</label>
                <input
                  type="number"
                  value={legRate}
                  onChange={(e) => setLegRate(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => setShowLegModal(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingLeg}
                  className="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-500 transition-colors shadow-sm disabled:opacity-50"
                >
                  {submittingLeg ? 'Adding Leg...' : 'Append Leg to Trip'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
