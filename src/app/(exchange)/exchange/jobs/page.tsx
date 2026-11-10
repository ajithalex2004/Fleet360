/**
 * src/app/(exchange)/exchange/jobs/page.tsx
 *
 * Phase 4 & Phase 15: Jobs & Outsourced Trips Management for Transport Partners.
 * Handles:
 * - Requests, Quote Submissions & Revisions (Rev N+1)
 * - Structured RFQ Decline (OutsourceDeclineReason — FUNC-3)
 * - Awards with Frozen SHA-256 Rate-Card Snapshots & Agency/Principal Commercial Terms
 * - 4-Step Driver Milestone & Live GPS Telemetry Tracker + 1-Click ePOD PDF Download (FUNC-2)
 * - Vehicle/Driver Assignments with Stage-2 serviceDate Compliance Readiness Guard (FUNC-2)
 */

'use client';

import React, { useEffect, useState } from 'react';
import {
  Clock,
  MapPin,
  CheckCircle2,
  Copy,
  ExternalLink,
  Send,
  Hash,
  ShieldCheck,
  Zap,
  X,
  Download,
  Navigation,
  AlertTriangle,
  Ban,
} from 'lucide-react';

interface PartnerQuoteRow {
  id: string;
  revisionNo: number;
  amount: number | string;
  vatAmount: number | string;
  totalAmount: number | string;
  currency: string;
  status: string;
  notes?: string | null;
}

interface OutsourceRequestRow {
  id: string;
  requestNumber: string;
  domain: string;
  pricingMethod: string;
  status: string;
  serviceDate: string;
  pickupTime: string;
  pickupLocation: string;
  dropoffLocation: string;
  requiredCapacity: number;
  vehicleTypeRequired?: string | null;
  specialInstructions?: string | null;
  opportunity?: { closesAt?: string | null } | null;
  quotes?: PartnerQuoteRow[];
  invitedPartners?: Array<{ status: string; declineReason?: string | null }>;
}

interface PartnerAssignmentRow {
  id: string;
  vehiclePlate?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  isTokenRevoked?: boolean | null;
  reachedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  lastLat?: number | null;
  lastLng?: number | null;
  pod?: {
    passengerCount?: number | null;
    signedByName?: string | null;
    sealNumber?: string | null;
    deliveredWeightKg?: number | null;
    damageConditionNotes?: string | null;
  } | null;
  events?: Array<{
    id: string;
    eventType: string;
    latitude?: number | null;
    longitude?: number | null;
    createdAt: string;
  }>;
}

interface OutsourceAwardRow {
  id: string;
  status: string;
  totalAwarded: number | string;
  partnerId: string;
  commercialSnapshot?: Record<string, any> | null;
  request?: OutsourceRequestRow | null;
  assignment?: PartnerAssignmentRow | null;
}

interface PartnerVehicleRow {
  id: string;
  licensePlate: string;
  vehicleType: string;
  mulkiyaExpiry?: string | null;
}

interface PartnerDriverRow {
  id: string;
  fullName: string;
  mobileNumber: string;
  licenseExpiry?: string | null;
  permitExpiry?: string | null;
}

const DECLINE_REASONS: Array<{ code: string; label: string }> = [
  { code: 'NO_VEHICLE', label: 'No suitable vehicle available for requested date/time' },
  { code: 'NO_DRIVER', label: 'No qualified driver available for shift' },
  { code: 'AREA_NOT_SUPPORTED', label: 'Pickup or drop-off zone outside operating coverage' },
  { code: 'TIMING_NOT_POSSIBLE', label: 'Lead time or schedule window cannot be met' },
  { code: 'PRICE_NOT_VIABLE', label: 'Target tariff / commercial terms not viable' },
  { code: 'COMPLIANCE_RESTRICTION', label: 'Special permit or zone pass restriction' },
  { code: 'OTHER', label: 'Other operational reason' },
];

export default function ExchangeJobsPage() {
  const [activeTab, setActiveTab] = useState<'REQUESTS' | 'AWARDS'>('REQUESTS');
  const [requests, setRequests] = useState<OutsourceRequestRow[]>([]);
  const [awards, setAwards] = useState<OutsourceAwardRow[]>([]);
  const [vehicles, setVehicles] = useState<PartnerVehicleRow[]>([]);
  const [drivers, setDrivers] = useState<PartnerDriverRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals state
  const [selectedRequestForQuote, setSelectedRequestForQuote] = useState<OutsourceRequestRow | null>(null);
  const [selectedRequestForDecline, setSelectedRequestForDecline] = useState<OutsourceRequestRow | null>(null);
  const [selectedAwardForAssign, setSelectedAwardForAssign] = useState<OutsourceAwardRow | null>(null);
  const [generatedDriverLink, setGeneratedDriverLink] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [liveSyncEnabled, setLiveSyncEnabled] = useState(true);
  const [lastLiveSyncAt, setLastLiveSyncAt] = useState<string | null>(null);

  const emitExchangeEvent = (type: string) => {
    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        const bc = new BroadcastChannel('fleet360-exchange-live');
        bc.postMessage({ type, source: 'exchange-jobs', timestamp: Date.now() });
        bc.close();
      }
    } catch {
      // Ignore if BroadcastChannel is unavailable
    }
  };

  const loadAll = async () => {
    setLoading(true);
    try {
      const [resReq, resAward, resVeh, resDrv] = await Promise.all([
        fetch('/api/exchange/jobs/requests').then((r) => r.json()),
        fetch('/api/exchange/jobs/awards').then((r) => r.json()),
        fetch('/api/exchange/partner/fleet').then((r) => r.json()),
        fetch('/api/exchange/partner/drivers').then((r) => r.json()),
      ]);
      setRequests(resReq.requests || []);
      setAwards(resAward.awards || []);
      setVehicles(resVeh.vehicles || []);
      setDrivers(resDrv.drivers || []);
    } catch {
      // Fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  // ARCH-5: Cross-Portal Live Sync (BroadcastChannel + 10s Live Driver Telemetry & Award Stream)
  useEffect(() => {
    if (!liveSyncEnabled) return;
    let bc: BroadcastChannel | null = null;
    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        bc = new BroadcastChannel('fleet360-exchange-live');
        bc.onmessage = () => {
          setLastLiveSyncAt(new Date().toLocaleTimeString('en-AE'));
          void loadAll();
        };
      }
    } catch {
      // Fallback
    }

    const timer = setInterval(() => {
      setLastLiveSyncAt(new Date().toLocaleTimeString('en-AE'));
      void loadAll();
    }, 10_000);

    return () => {
      clearInterval(timer);
      if (bc) bc.close();
    };
  }, [liveSyncEnabled]);

  const showToast = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 4000);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Page Title & Tabs */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-white">Jobs & Outsourced Trips</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Review invitations, submit or revise quotations, inspect frozen SHA-256 rate-card snapshots, assign resources, and monitor 4-step driver telemetry.
          </p>
        </div>

        {/* Tab Switcher + Live Sync */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLiveSyncEnabled((v) => !v)}
            title={
              liveSyncEnabled
                ? `Live Driver Telemetry & Award Stream Active${lastLiveSyncAt ? ` (Last sync: ${lastLiveSyncAt})` : ''}`
                : 'Click to resume Live Driver Telemetry & Award Stream'
            }
            className={`px-3 py-2 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition ${
              liveSyncEnabled
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                : 'bg-slate-900 border-slate-800 text-slate-400'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                liveSyncEnabled ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
              }`}
            />
            <span>{liveSyncEnabled ? 'LIVE 10s' : 'PAUSED'}</span>
          </button>
          <div className="flex p-1 bg-slate-900 border border-slate-800 rounded-2xl">
            <button
              onClick={() => setActiveTab('REQUESTS')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
                activeTab === 'REQUESTS'
                  ? 'bg-cyan-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              📥 Open Requests ({requests.length})
            </button>
            <button
              onClick={() => setActiveTab('AWARDS')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
                activeTab === 'AWARDS'
                  ? 'bg-cyan-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              🏆 Awarded Jobs ({awards.length})
            </button>
          </div>
        </div>
      </div>

      {/* Feedback Toast */}
      {feedback && (
        <div className="p-3 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-semibold flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{feedback}</span>
        </div>
      )}

      {/* Driver Execution Link */}
      {generatedDriverLink && (
        <div className="p-4 rounded-2xl bg-cyan-950/30 border border-cyan-500/40 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-bold text-cyan-300 flex items-center gap-1.5">
              <Send className="w-3.5 h-3.5" />
              Driver Execution Link Generated
            </span>
            <button onClick={() => setGeneratedDriverLink(null)} className="text-slate-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-[11px] text-slate-400">
            Already dispatched to the driver via WhatsApp/SMS — copy or open it below if you need it directly.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 font-mono text-[11px]">
              {`${window.location.origin}${generatedDriverLink}`}
            </code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(`${window.location.origin}${generatedDriverLink}`);
                showToast('✓ Driver trip link copied to clipboard!');
              }}
              className="px-2.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-[11px] flex items-center gap-1 shadow shrink-0"
            >
              <Copy className="w-3 h-3" />
              <span>Copy</span>
            </button>
            <a
              href={generatedDriverLink}
              target="_blank"
              rel="noreferrer"
              className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white shrink-0"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      )}

      {/* TAB 1: OPEN REQUESTS */}
      {activeTab === 'REQUESTS' && (
        <div className="space-y-4">
          {loading ? (
            <div className="p-12 text-center text-xs text-slate-500 rounded-3xl bg-slate-900/40 border border-slate-800 flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              Loading open requests...
            </div>
          ) : requests.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {requests.map((r) => {
                const existingQuote = r.quotes?.[0];
                const inviteRow = r.invitedPartners?.[0];
                const isDeclined = inviteRow?.status === 'DECLINED';
                return (
                  <div
                    key={r.id}
                    className="p-5 rounded-3xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 transition space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-cyan-400 font-bold text-xs">{r.requestNumber}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-bold">
                          {r.domain || 'PASSENGER_TRANSPORT'}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-cyan-300 border border-slate-700 font-bold">
                          {r.pricingMethod}
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-400 flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-500" />
                        <span>
                          {r.opportunity?.closesAt
                            ? `Closes ${new Date(r.opportunity.closesAt).toLocaleDateString()}`
                            : 'No deadline set'}
                        </span>
                      </span>
                    </div>

                    <div className="space-y-1.5 text-xs">
                      <div className="text-white font-bold flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                        <span>{r.pickupLocation} → {r.dropoffLocation}</span>
                      </div>
                      <div className="text-slate-400 flex items-center gap-4 text-[11px]">
                        <span>📅 {new Date(r.serviceDate).toLocaleDateString()}</span>
                        <span>⏰ {r.pickupTime}</span>
                        <span>👥 Capacity: {r.requiredCapacity}</span>
                      </div>
                      {r.specialInstructions && (
                        <div className="text-[11px] text-slate-400 bg-slate-950 p-2.5 rounded-xl border border-slate-800/60 mt-2">
                          <span className="font-semibold text-slate-300">Instructions:</span> {r.specialInstructions}
                        </div>
                      )}
                    </div>

                    <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2 flex-wrap">
                      {isDeclined ? (
                        <span className="text-xs text-rose-400 font-semibold flex items-center gap-1">
                          <Ban className="w-3.5 h-3.5" />
                          <span>Declined ({inviteRow?.declineReason || 'DECLINED'})</span>
                        </span>
                      ) : existingQuote ? (
                        <div className="text-xs">
                          <span className="text-slate-400">Your Quote (Rev {existingQuote.revisionNo}): </span>
                          <span className="font-bold text-emerald-400">AED {Number(existingQuote.totalAmount).toFixed(2)}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-amber-400 font-semibold">Awaiting Quotation</span>
                      )}

                      <div className="flex items-center gap-2">
                        {!existingQuote && !isDeclined && (
                          <button
                            type="button"
                            onClick={() => setSelectedRequestForDecline(r)}
                            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-rose-500/20 hover:text-rose-300 text-slate-300 font-bold text-xs border border-slate-700 transition"
                          >
                            Decline RFQ
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setSelectedRequestForQuote(r)}
                          className="px-3.5 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow transition active:scale-95"
                        >
                          {existingQuote ? `Revise Quote (Rev ${(existingQuote.revisionNo || 1) + 1})` : 'Submit Quote'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-12 text-center text-xs text-slate-500 rounded-3xl bg-slate-900/40 border border-slate-800">
              No open requests found. When enterprise clients invite you, they will appear here.
            </div>
          )}
        </div>
      )}

      {/* TAB 2: AWARDED JOBS */}
      {activeTab === 'AWARDS' && (
        <div className="space-y-4">
          {loading ? (
            <div className="p-12 text-center text-xs text-slate-500 rounded-3xl bg-slate-900/40 border border-slate-800 flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              Loading awarded jobs...
            </div>
          ) : awards.length > 0 ? (
            <div className="space-y-3">
              {awards.map((a) => {
                const assignment = a.assignment;
                const pod = assignment?.pod;
                const snap = (a.commercialSnapshot || {}) as Record<string, any>;
                const rcSnap = (snap.rateCardSnapshot || {}) as Record<string, any>;
                const ancillary = (rcSnap.ancillaryCharges || {}) as Record<string, any>;
                const commercialModel = snap.commercialModel || 'AGENCY';
                const snapshotHash = rcSnap.snapshotHash || snap.snapshotHash || null;
                const isFailoverPromoted = Boolean(snap.failoverPromotedAt || snap.failoverHistory);

                // Phase 15 (FUNC-2): 4-Step Milestone & Live GPS Telemetry
                const latestGpsEvent = (assignment?.events || []).find(
                  (ev) => ev.latitude != null && ev.longitude != null
                );
                const liveLat = assignment?.lastLat ?? latestGpsEvent?.latitude ?? null;
                const liveLng = assignment?.lastLng ?? latestGpsEvent?.longitude ?? null;
                const steps = [
                  { label: '1. Assigned', done: Boolean(assignment?.vehiclePlate) },
                  { label: '2. Reached Pickup', done: Boolean(assignment?.reachedAt) },
                  { label: '3. Trip Started', done: Boolean(assignment?.startedAt) },
                  { label: '4. Completed & ePOD', done: Boolean(assignment?.completedAt || pod || a.status === 'COMPLETED') },
                ];

                return (
                  <div
                    key={a.id}
                    className="p-5 rounded-3xl bg-slate-900/60 border border-slate-800 space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-emerald-400 font-bold text-xs">
                            {a.request?.requestNumber || a.id.slice(0, 8)}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-bold">
                            {a.request?.domain || 'PASSENGER_TRANSPORT'}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-bold">
                            {a.status}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-bold">
                            {commercialModel} MODEL
                          </span>
                          {isFailoverPromoted && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 font-bold flex items-center gap-1">
                              <Zap className="w-3 h-3" /> Standby Failover Promoted
                            </span>
                          )}
                        </div>
                        <div className="text-sm font-bold text-white mt-1">
                          {a.request?.pickupLocation} → {a.request?.dropoffLocation}
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-xs text-slate-400">Awarded Commercials</div>
                        <div className="text-base font-black text-white">AED {Number(a.totalAwarded).toFixed(2)}</div>
                      </div>
                    </div>

                    {/* Frozen SHA-256 Rate-Card Snapshot & Ancillary Terms Banner */}
                    <div className="p-3 rounded-2xl bg-slate-950/90 border border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px]">
                      <div className="flex items-center gap-2 text-slate-300">
                        <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0" />
                        <span>
                          <strong>Frozen Commercial Terms:</strong> Free Wait{' '}
                          <span className="text-white font-mono">{ancillary.freeWaitingMinutes ?? 30}m</span> · Detention{' '}
                          <span className="text-white font-mono">AED {ancillary.waitingFeePerHour ?? 100}/hr</span> · SLA Cancel Penalty{' '}
                          <span className="text-amber-400 font-mono">{ancillary.cancellationFeePct ?? 25}%</span>
                        </span>
                      </div>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-900 border border-slate-800 font-mono text-[10px] text-cyan-400 shrink-0">
                        <Hash className="w-3 h-3" />
                        {snapshotHash ? `v${rcSnap.version ?? 1} · SHA-256 ${String(snapshotHash).slice(0, 12)}…` : 'v1 · IMMUTABLE SNAPSHOT'}
                      </span>
                    </div>

                    {/* Phase 15 (FUNC-2): 4-Step Driver Execution Milestone Bar & Live GPS Coordinate Pill */}
                    <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800/80 space-y-2.5 text-xs">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <span className="text-[11px] font-bold text-slate-300">
                          4-Step Execution Milestones & Live Telemetry
                        </span>
                        {liveLat != null && liveLng != null ? (
                          <span className="px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 text-[10px] font-mono font-bold flex items-center gap-1">
                            <Navigation className="w-3 h-3 text-cyan-400" />
                            <span>
                              GPS {Number(liveLat).toFixed(4)}, {Number(liveLng).toFixed(4)}
                            </span>
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-500">
                            GPS updates upon driver magic-link check-in
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {steps.map((st) => (
                          <div
                            key={st.label}
                            className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-bold flex items-center gap-1.5 ${
                              st.done
                                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                : 'bg-slate-900 text-slate-500 border-slate-800'
                            }`}
                          >
                            <CheckCircle2 className={`w-3.5 h-3.5 ${st.done ? 'text-emerald-400' : 'text-slate-600'}`} />
                            <span>{st.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Operational Assignment / Driver Execution Link */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                      <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800/80">
                        <span className="text-slate-400 text-[11px] block">Assigned Vehicle</span>
                        <span className="font-bold text-white font-mono mt-0.5 block">
                          {assignment?.vehiclePlate || '⚠️ Vehicle not assigned'}
                        </span>
                      </div>

                      <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800/80">
                        <span className="text-slate-400 text-[11px] block">Assigned Driver</span>
                        <span className="font-bold text-white mt-0.5 block">
                          {assignment?.driverName ? `${assignment.driverName} (${assignment.driverPhone})` : '⚠️ Driver not assigned'}
                        </span>
                      </div>

                      <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800/80 flex flex-col justify-between">
                        <span className="text-slate-400 text-[11px] block">Driver Execution Link</span>
                        {assignment?.isTokenRevoked ? (
                          <span className="text-[11px] text-rose-400 mt-1 font-bold">
                            ⛔ Driver Token Revoked (Compliance / Failover)
                          </span>
                        ) : assignment ? (
                          <span className="text-[11px] text-emerald-400 mt-1 flex items-center gap-1">
                            <Send className="w-3 h-3" />
                            Delivered to driver via WhatsApp/SMS
                          </span>
                        ) : (
                          <span className="text-[11px] text-amber-400">Assign driver to generate link</span>
                        )}
                      </div>
                    </div>

                    {/* Milestones & POD Summary */}
                    {pod && (
                      <div className="p-3 rounded-2xl bg-emerald-950/30 border border-emerald-500/30 text-xs flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2 text-emerald-300 font-semibold">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          <span>
                            ePOD Verified (
                            {pod.passengerCount != null
                              ? `Passengers: ${pod.passengerCount}`
                              : pod.deliveredWeightKg != null
                              ? `Delivered Weight: ${pod.deliveredWeightKg} kg`
                              : pod.sealNumber
                              ? `Seal: ${pod.sealNumber}`
                              : 'Multi-Vertical ePOD Captured'}
                            )
                          </span>
                        </div>
                        <span className="text-[11px] text-slate-400">Signed by: {pod.signedByName || 'Site Lead'}</span>
                      </div>
                    )}

                    {/* Action Bar */}
                    <div className="flex justify-end items-center gap-2 pt-2 border-t border-slate-800/60 flex-wrap">
                      {(pod || assignment?.completedAt || a.status === 'COMPLETED') && (
                        <a
                          href={`/api/exchange/awards/${a.id}/epod-pdf`}
                          target="_blank"
                          rel="noreferrer"
                          className="px-3.5 py-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 font-bold text-xs border border-emerald-500/30 inline-flex items-center gap-1.5 transition"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Download ePOD PDF</span>
                        </a>
                      )}
                      <button
                        onClick={() => setSelectedAwardForAssign(a)}
                        className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs border border-slate-700 transition"
                      >
                        {assignment ? 'Reassign Driver / Vehicle' : 'Assign Vehicle & Driver'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-12 text-center text-xs text-slate-500 rounded-3xl bg-slate-900/40 border border-slate-800">
              No awarded jobs found yet.
            </div>
          )}
        </div>
      )}

      {/* ── MODAL 1: SUBMIT / REVISE QUOTE ── */}
      {selectedRequestForQuote && (
        <SubmitQuoteModal
          request={selectedRequestForQuote}
          onClose={() => setSelectedRequestForQuote(null)}
          onSubmitted={(revNo) => {
            setSelectedRequestForQuote(null);
            showToast(
              revNo && revNo > 1
                ? `✓ Quote revised to Rev ${revNo} successfully!`
                : '✓ Quotation submitted successfully!'
            );
            void loadAll();
            emitExchangeEvent(revNo && revNo > 1 ? 'QUOTE_REVISED' : 'QUOTE_SUBMITTED');
          }}
        />
      )}

      {/* ── MODAL 1B: DECLINE RFQ INVITATION (FUNC-3) ── */}
      {selectedRequestForDecline && (
        <DeclineRequestModal
          request={selectedRequestForDecline}
          onClose={() => setSelectedRequestForDecline(null)}
          onDeclined={() => {
            setSelectedRequestForDecline(null);
            showToast('✓ RFQ invitation declined with structured operational reason.');
            void loadAll();
            emitExchangeEvent('RFQ_DECLINED');
          }}
        />
      )}

      {/* ── MODAL 2: ASSIGN DRIVER & VEHICLE ── */}
      {selectedAwardForAssign && (
        <AssignDriverModal
          award={selectedAwardForAssign}
          vehicles={vehicles}
          drivers={drivers}
          onClose={() => setSelectedAwardForAssign(null)}
          onAssigned={(link) => {
            setSelectedAwardForAssign(null);
            setGeneratedDriverLink(link);
            showToast('✓ Vehicle and Driver assigned! Driver execution link generated.');
            void loadAll();
            emitExchangeEvent('DRIVER_ASSIGNED');
          }}
        />
      )}
    </div>
  );
}

// ── SUBMIT / REVISE QUOTE MODAL COMPONENT ──────────────────────────────────

function SubmitQuoteModal({
  request,
  onClose,
  onSubmitted,
}: {
  request: OutsourceRequestRow;
  onClose: () => void;
  onSubmitted: (revisionNo?: number) => void;
}) {
  const existingQuote = request.quotes?.[0];
  const [amount, setAmount] = useState<string>(
    existingQuote?.amount != null ? String(Number(existingQuote.amount)) : ''
  );
  const [notes, setNotes] = useState<string>(existingQuote?.notes || '');
  const [submitting, setSubmitting] = useState(false);

  const subtotal = Number(amount) || 0;
  const vat = subtotal * 0.05;
  const total = subtotal + vat;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subtotal) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/exchange/jobs/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: existingQuote ? 'REVISE' : 'SUBMIT',
          quoteId: existingQuote?.id,
          requestId: request.id,
          amount: subtotal,
          vatAmount: vat,
          notes,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to submit quote');
      }
      const data = await res.json().catch(() => ({}));
      onSubmitted(data?.quote?.revisionNo);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error submitting quote');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-950 border border-slate-800 rounded-3xl p-6 max-w-md w-full space-y-4 shadow-2xl text-xs">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-sm font-bold text-white">
              {existingQuote
                ? `Revise Commercial Quotation (Rev ${(existingQuote.revisionNo || 1) + 1})`
                : 'Commercial Quotation'}
            </h3>
            <p className="text-[11px] text-slate-400">Request: {request.requestNumber}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 space-y-1">
            <span className="text-[10px] text-slate-400 font-semibold uppercase">Trip Route</span>
            <div className="text-white font-bold">{request.pickupLocation} → {request.dropoffLocation}</div>
            <div className="text-slate-400 text-[11px]">{new Date(request.serviceDate).toLocaleDateString()} at {request.pickupTime}</div>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Base Price (AED) *</label>
            <input
              type="number"
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 4500"
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-white text-sm font-bold focus:outline-none focus:border-cyan-500 font-mono"
            />
          </div>

          {/* Pricing Breakdown */}
          <div className="p-3 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-1 text-[11px]">
            <div className="flex justify-between text-slate-400">
              <span>Subtotal:</span>
              <span className="font-mono text-white font-semibold">AED {subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>UAE VAT (5%):</span>
              <span className="font-mono text-white font-semibold">AED {vat.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-cyan-300 font-bold pt-1 border-t border-slate-800">
              <span>Total Quoted Amount:</span>
              <span className="font-mono text-cyan-400">AED {total.toFixed(2)}</span>
            </div>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Commercial Notes / Terms</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Includes driver fuel & tolls; 50-seat luxury coach"
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button type="button" onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !subtotal}
              className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold shadow-lg shadow-cyan-600/30 transition disabled:opacity-50"
            >
              {submitting
                ? 'Submitting...'
                : existingQuote
                ? `Submit Rev ${(existingQuote.revisionNo || 1) + 1}`
                : 'Submit Quote'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── DECLINE RFQ MODAL COMPONENT (FUNC-3) ──────────────────────────────────

function DeclineRequestModal({
  request,
  onClose,
  onDeclined,
}: {
  request: OutsourceRequestRow;
  onClose: () => void;
  onDeclined: () => void;
}) {
  const [declineReason, setDeclineReason] = useState<string>('NO_VEHICLE');
  const [declineNotes, setDeclineNotes] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/exchange/jobs/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'DECLINE',
          requestId: request.id,
          declineReason,
          declineNotes,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to decline RFQ');
      }
      onDeclined();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error declining RFQ');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-slate-950 border border-slate-800 rounded-3xl p-6 max-w-md w-full space-y-4 shadow-2xl text-xs">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-sm font-bold text-white">Decline Outsource Request</h3>
            <p className="text-[11px] text-slate-400">Request: {request.requestNumber}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-slate-300 font-semibold mb-1">Structured Decline Reason *</label>
            <select
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-cyan-500"
            >
              {DECLINE_REASONS.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Operational Notes (Optional)</label>
            <textarea
              rows={2}
              value={declineNotes}
              onChange={(e) => setDeclineNotes(e.target.value)}
              placeholder="e.g. All 50-seater coaches committed to Abu Dhabi shift at 06:00."
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button type="button" onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold transition disabled:opacity-50"
            >
              {submitting ? 'Declining...' : 'Confirm Decline'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── ASSIGN DRIVER & VEHICLE MODAL COMPONENT (with Stage-2 serviceDate Guard) ──

function AssignDriverModal({
  award,
  vehicles,
  drivers,
  onClose,
  onAssigned,
}: {
  award: OutsourceAwardRow;
  vehicles: PartnerVehicleRow[];
  drivers: PartnerDriverRow[];
  onClose: () => void;
  onAssigned: (link: string) => void;
}) {
  const hasRegisteredVehicles = vehicles.length > 0;
  const hasRegisteredDrivers = drivers.length > 0;

  const [vehiclePlate, setVehiclePlate] = useState<string>(vehicles[0]?.licensePlate || '');
  const [driverName, setDriverName] = useState<string>(drivers[0]?.fullName || '');
  const [driverPhone, setDriverPhone] = useState<string>(drivers[0]?.mobileNumber || '+971501234567');
  const [submitting, setSubmitting] = useState(false);

  const cutoffMs = award.request?.serviceDate
    ? new Date(award.request.serviceDate).getTime()
    : Date.now();

  const isVehicleReadyForServiceDate = (v: PartnerVehicleRow): boolean => {
    if (!v.mulkiyaExpiry) return true;
    const ms = new Date(v.mulkiyaExpiry).getTime();
    return Number.isNaN(ms) || ms >= cutoffMs;
  };

  const isDriverReadyForServiceDate = (d: PartnerDriverRow): boolean => {
    const dates = [d.licenseExpiry, d.permitExpiry]
      .filter(Boolean)
      .map((iso) => new Date(iso as string).getTime())
      .filter((ms) => !Number.isNaN(ms));
    if (dates.length === 0) return true;
    return Math.min(...dates) >= cutoffMs;
  };

  const selectedVehicleObj = vehicles.find((v) => v.licensePlate === vehiclePlate);
  const selectedDriverObj = drivers.find((d) => d.fullName === driverName);
  const hasStage2Blocker =
    (selectedVehicleObj && !isVehicleReadyForServiceDate(selectedVehicleObj)) ||
    (selectedDriverObj && !isDriverReadyForServiceDate(selectedDriverObj));

  const handleDriverSelect = (fullName: string) => {
    setDriverName(fullName);
    const match = drivers.find((d) => d.fullName === fullName);
    if (match) setDriverPhone(match.mobileNumber);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vehiclePlate || !driverName) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/exchange/jobs/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          awardId: award.id,
          partnerId: award.partnerId,
          vehiclePlate,
          driverName,
          driverPhone,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to assign resources');
      }
      const json = await res.json();
      onAssigned(json.driverSecureUrl);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error assigning driver');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-950 border border-slate-800 rounded-3xl p-6 max-w-md w-full space-y-4 shadow-2xl text-xs">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-sm font-bold text-white">Assign Vehicle & Driver</h3>
            <p className="text-[11px] text-slate-400">
              Stage-2 Pre-Dispatch Gate checked against serviceDate (
              {award.request?.serviceDate
                ? new Date(award.request.serviceDate).toLocaleDateString()
                : 'Today'}
              )
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {hasStage2Blocker && (
          <div className="p-3 rounded-2xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-[11px] flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>
              <strong>Stage-2 Pre-Dispatch Gate Warning:</strong> The selected vehicle Mulkiya or driver permit expires before the scheduled trip <code>serviceDate</code> and will be rejected by the compliance guard.
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-slate-300 font-semibold mb-1">Select Partner Vehicle *</label>
            {hasRegisteredVehicles ? (
              <select
                required
                value={vehiclePlate}
                onChange={(e) => setVehiclePlate(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white font-mono uppercase focus:outline-none focus:border-cyan-500"
              >
                {vehicles.map((v) => {
                  const ready = isVehicleReadyForServiceDate(v);
                  return (
                    <option key={v.id} value={v.licensePlate}>
                      {v.licensePlate} — {v.vehicleType} {ready ? '[✓ STAGE-2 READY]' : '[⛔ MULKIYA EXPIRED BY SERVICE DATE]'}
                    </option>
                  );
                })}
              </select>
            ) : (
              <input
                type="text"
                required
                value={vehiclePlate}
                onChange={(e) => setVehiclePlate(e.target.value)}
                placeholder="e.g. Dubai K 44102 (no vehicles registered yet)"
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white font-mono uppercase focus:outline-none focus:border-cyan-500"
              />
            )}
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Driver Full Name *</label>
            {hasRegisteredDrivers ? (
              <select
                required
                value={driverName}
                onChange={(e) => handleDriverSelect(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-cyan-500"
              >
                {drivers.map((d) => {
                  const ready = isDriverReadyForServiceDate(d);
                  return (
                    <option key={d.id} value={d.fullName}>
                      {d.fullName} ({d.mobileNumber}) {ready ? '[✓ STAGE-2 READY]' : '[⛔ PERMIT EXPIRED BY SERVICE DATE]'}
                    </option>
                  );
                })}
              </select>
            ) : (
              <input
                type="text"
                required
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                placeholder="e.g. Rashid Tariq (no drivers registered yet)"
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-cyan-500"
              />
            )}
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Driver Mobile Phone *</label>
            <input
              type="text"
              required
              value={driverPhone}
              onChange={(e) => setDriverPhone(e.target.value)}
              placeholder="+971 50 123 4567"
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button type="button" onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-lg shadow-emerald-600/30 transition disabled:opacity-50"
            >
              {submitting ? 'Generating...' : 'Confirm & Generate Link'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
