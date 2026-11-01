'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  CheckCircle2,
  Clock,
  Copy,
  MapPin,
  MessageSquare,
  Navigation,
  Package,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type {
  DrayageCorridorTerminal,
  DrayageCorridorWarehouse,
  DrayageCorridorGeofence,
  DrayageCorridorVehicle,
} from '@/components/logistics/drayage/DrayageCorridorLiveMap';

const DrayageCorridorLiveMap = dynamic(
  () => import('@/components/logistics/drayage/DrayageCorridorLiveMap'),
  {
    ssr: false,
    loading: () => (
      <div className="h-[460px] rounded-2xl bg-slate-900 animate-pulse flex flex-col items-center justify-center text-xs text-blue-400 gap-2 border border-slate-800">
        <RefreshCw className="w-5 h-5 animate-spin text-blue-500" />
        <span>Loading Live UAE Freight Corridor Map...</span>
      </div>
    ),
  },
);

interface MilestoneStep {
  stageNum: number;
  code: string;
  title: string;
  subtitle: string;
  state: 'COMPLETED' | 'CURRENT' | 'UPCOMING';
  timestamp: string | null;
  notes: string | null;
}

interface StatusLogItem {
  id: string;
  jobId: string;
  jobCode: string;
  status: string;
  notes: string;
  actor: string;
  timestamp: string;
}

interface PortalPayload {
  portalReadOnly: boolean;
  verifiedToken: string;
  refreshedAt: string;
  currentStageIndex: number;
  job: {
    id: string;
    jobCode: string;
    jobPhase: 'L1' | 'L2';
    shipmentType: string;
    status: string;
    priority: string;
    customerName: string;
    terminalName: string;
    warehouseName: string;
    containerNumber: string;
    containerSize: string;
    containerType: string;
    shippingLine: string;
    tokenNumber: string | null;
    assignedVehiclePlate: string | null;
    assignedDriverName: string | null;
    assignedTrailerPlate: string | null;
    placementLocation: 'RAMP' | 'YARD' | null;
    trailerDetached: boolean;
    l2Activated: boolean;
    etcTime: string | null;
    currentLat: number | null;
    currentLng: number | null;
    podSignatureName: string | null;
    podSignedAt: string | null;
    podPhotoUrl: string | null;
    portSlotPrediction?: {
      predictedGateArrivalLabel: string;
      totalEtaMinutes: number;
      corridorName: string;
    };
    customerPortal?: {
      customerWhatsApp: string;
      customerEmail: string;
      autoAlertsEnabled: boolean;
    };
    createdAt: string;
    updatedAt: string;
  };
  milestones: MilestoneStep[];
  statusLogs: StatusLogItem[];
  alertLogs: StatusLogItem[];
  corridorMap: {
    terminals: DrayageCorridorTerminal[];
    warehouses: DrayageCorridorWarehouse[];
    geofences: DrayageCorridorGeofence[];
    vehicles: DrayageCorridorVehicle[];
  };
}

export default function CustomerDrayageTrackingPortalPage() {
  const params = useParams();
  const token = String(params?.token || '');

  const [portalData, setPortalData] = useState<PortalPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [, setTick] = useState(0);

  // Customer WhatsApp & Email Subscription Form
  const [whatsappInput, setWhatsappInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [autoAlertsEnabled, setAutoAlertsEnabled] = useState(true);
  const [savingAlerts, setSavingAlerts] = useState(false);
  const [confirmingEmpty, setConfirmingEmpty] = useState(false);

  const showNotice = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4500);
  };

  const fetchPortalData = useCallback(
    async (silent = false) => {
      if (!token) return;
      try {
        if (!silent) setLoading(true);
        else setRefreshing(true);

        const res = await fetch(
          `/api/driver-app/customer-tracking?token=${encodeURIComponent(token)}`,
          { cache: 'no-store' },
        );
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Invalid or expired tracking link');
        }
        setPortalData(data);
        setError(null);

        if (data.job?.customerPortal && !silent) {
          setWhatsappInput(data.job.customerPortal.customerWhatsApp || '+971 50 482 9104');
          setEmailInput(data.job.customerPortal.customerEmail || 'logistics-ops@shipper.ae');
          setAutoAlertsEnabled(Boolean(data.job.customerPortal.autoAlertsEnabled ?? true));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load tracking portal');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token],
  );

  useEffect(() => {
    void fetchPortalData(false);
  }, [fetchPortalData]);

  // 15s live auto-refresh + 1s countdown ticker for Offloading ETC
  useEffect(() => {
    const poll = setInterval(() => {
      void fetchPortalData(true);
    }, 15000);
    const clock = setInterval(() => {
      setTick((t) => t + 1);
    }, 10000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [fetchPortalData]);

  const handleCopyShareableUrl = () => {
    if (typeof window === 'undefined') return;
    navigator.clipboard.writeText(window.location.href);
    setCopiedLink(true);
    showNotice('✓ Shareable Customer Tracking Link copied to clipboard!');
    setTimeout(() => setCopiedLink(false), 3000);
  };

  const handleSaveAlertSubscriptions = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSavingAlerts(true);
      const res = await fetch('/api/driver-app/customer-tracking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          action: 'update_subscriptions',
          customerWhatsApp: whatsappInput,
          customerEmail: emailInput,
          autoAlertsEnabled,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update alert preferences');
      showNotice(
        `✓ Saved & dispatched live milestone update to WhatsApp (${whatsappInput}) and Email (${emailInput})!`,
      );
      await fetchPortalData(true);
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'Failed to update subscriptions');
    } finally {
      setSavingAlerts(false);
    }
  };

  const handleConfirmOffloadingComplete = async () => {
    try {
      setConfirmingEmpty(true);
      const res = await fetch('/api/driver-app/customer-tracking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          action: 'confirm_offloading_complete',
          consigneeContact: `${portalData?.job?.customerName || 'Consignee'} (${whatsappInput || 'Portal'})`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to confirm empty ready');
      showNotice(
        `✓ Offloading confirmed! L2 Empty Return ${data.l2JobCode || ''} activated for immediate pickup.`,
      );
      await fetchPortalData(true);
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'Error confirming offloading');
    } finally {
      setConfirmingEmpty(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
        <RefreshCw className="w-8 h-8 text-blue-400 animate-spin mb-3" />
        <h1 className="text-base font-bold">Loading Live Container Tracking Portal...</h1>
        <p className="text-xs text-slate-400 mt-1">
          Verifying cryptographic shareable token & syncing UAE corridor telematics
        </p>
      </div>
    );
  }

  if (error || !portalData?.job) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full p-6 rounded-2xl bg-slate-900 border border-rose-500/40 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto font-black text-lg">
            !
          </div>
          <h1 className="text-lg font-extrabold text-white">Invalid or Expired Tracking Link</h1>
          <p className="text-xs text-slate-300 leading-relaxed">
            {error || 'This shareable tracking token could not be verified. Please request a fresh tracking link from your logistics dispatcher.'}
          </p>
        </div>
      </div>
    );
  }

  const job = portalData.job;
  const milestones: MilestoneStep[] = portalData.milestones || [];
  const statusLogs: StatusLogItem[] = portalData.statusLogs || [];
  const alertLogs: StatusLogItem[] = portalData.alertLogs || [];
  const currentStageIndex = Number(portalData.currentStageIndex ?? 1);

  const etcRemainingMins = job.etcTime
    ? Math.round((new Date(job.etcTime).getTime() - Date.now()) / 60000)
    : null;

  const shareWhatsAppHref = `https://wa.me/${(whatsappInput || '+971504829104').replace(/[^\d]/g, '')}?text=${encodeURIComponent(
    `📦 *Fleet360 Live Container Tracking*\n• *Job:* ${job.jobCode}\n• *Container:* ${job.containerNumber} (${job.containerSize})\n• *Status:* ${job.status}\n• *Route:* ${job.terminalName} → ${job.warehouseName}\n🔗 *Track Live Corridor Map & ETC:* ${typeof window !== 'undefined' ? window.location.href : ''}`,
  )}`;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-14">
      {/* Top Notification Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 max-w-md px-4 py-3 rounded-xl bg-emerald-600 text-white text-xs font-bold shadow-2xl border border-emerald-400 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{toast}</span>
        </div>
      )}

      {/* Zero-Login Customer Portal Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
              <Navigation className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-black tracking-tight text-white">
                  FLEET360 LIVE CUSTOMER TRACKING PORTAL
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  READ-ONLY TOKEN-SECURED
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Zero-Login Shipper & Consignee Visibility · {job.customerName} · Live UAE Corridor GPS & Milestone Feed
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopyShareableUrl}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-slate-100 transition-colors"
            >
              <Copy className="w-3.5 h-3.5 text-blue-400" />
              {copiedLink ? 'Link Copied!' : 'Copy Tracking Link'}
            </button>

            <a
              href={shareWhatsAppHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors shadow-sm"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Share on WhatsApp
            </a>

            <button
              type="button"
              onClick={() => void fetchPortalData(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-xs font-bold text-blue-300 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Live Sync (15s)
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 space-y-6">
        {/* Container & Job Summary Banner */}
        <section className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="font-mono text-xl font-black text-white">{job.containerNumber}</span>
                <span className="px-2.5 py-0.5 rounded-lg text-xs font-mono font-bold bg-blue-500/20 text-blue-300 border border-blue-500/40">
                  {job.jobCode} · {job.jobPhase}
                </span>
                <span className="px-2.5 py-0.5 rounded-lg text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  {job.status.replace(/_/g, ' ')}
                </span>
                <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                  {job.containerSize} · {job.containerType} · {job.shippingLine}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1.5 flex flex-wrap items-center gap-2">
                <span>
                  Customer: <strong className="text-slate-200">{job.customerName}</strong>
                </span>
                <span>•</span>
                <span>
                  Corridor: <strong className="text-slate-200">{job.terminalName}</strong> →{' '}
                  <strong className="text-slate-200">{job.warehouseName}</strong>
                </span>
              </p>
            </div>

            <div className="text-right text-xs text-slate-400">
              <div>
                Stage Progress: <strong className="text-blue-400 font-mono">Stage {currentStageIndex} of 6</strong>
              </div>
              <div className="text-[11px] mt-0.5">
                Last Telematics Ping:{' '}
                <span className="font-mono text-slate-300">
                  {new Date(portalData.refreshedAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              </div>
            </div>
          </div>

          {/* 4-Column Customer Telemetry Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
              <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
                Origin Port & PCS Gate Token
              </span>
              <strong className="text-slate-100 text-sm block mt-0.5 truncate">{job.terminalName}</strong>
              <div className="text-[11px] text-emerald-400 font-mono mt-1">
                Token: {job.tokenNumber || 'Verified Gate Pass'}
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
              <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
                Destination Facility / Ramp
              </span>
              <strong className="text-slate-100 text-sm block mt-0.5 truncate">{job.warehouseName}</strong>
              <div className="text-[11px] text-slate-400 mt-1">
                Placement: <strong className="text-amber-300">{job.placementLocation || 'RAMP'}</strong>
                {job.podSignatureName ? ` · Signed: ${job.podSignatureName}` : ''}
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
              <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
                Assigned Prime Mover & Driver
              </span>
              <strong className="text-slate-100 text-sm font-mono block mt-0.5">
                {job.assignedVehiclePlate || 'Assigned Tractor'}
              </strong>
              <div className="text-[11px] text-slate-400 mt-1 truncate">
                {job.assignedDriverName || 'Verified Driver'} · Chassis {job.assignedTrailerPlate || 'Coupled'}
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950 border border-amber-500/30">
              <span className="text-[10px] uppercase tracking-wider text-amber-400 font-bold block">
                Offloading ETC & Corridor ETA
              </span>
              {job.etcTime ? (
                <>
                  <strong className="text-amber-300 text-sm font-mono block mt-0.5">
                    ETC:{' '}
                    {new Date(job.etcTime).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </strong>
                  <div className="text-[11px] text-emerald-400 font-semibold mt-1">
                    {etcRemainingMins !== null && etcRemainingMins <= 0
                      ? '✓ Offloading window completed — L2 Return Ready'
                      : `${etcRemainingMins} mins remaining at customer ramp`}
                  </div>
                </>
              ) : (
                <>
                  <strong className="text-cyan-300 text-sm font-mono block mt-0.5">
                    ETA: {job.portSlotPrediction?.predictedGateArrivalLabel || 'On Schedule'} (
                    {job.portSlotPrediction?.totalEtaMinutes || 22}m)
                  </strong>
                  <div className="text-[11px] text-slate-400 mt-1 truncate">
                    {job.portSlotPrediction?.corridorName || 'E11 / E311 UAE Freight Corridor'}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Offloading ETC Banner & Customer Self-Service "Confirm Empty Ready" */}
          {(job.etcTime || job.status === 'PLACED_AT_RAMP' || job.placementLocation === 'RAMP') && (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                  <Clock className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-extrabold text-amber-300">
                      LIVE OFFLOADING / DESTUFFING COUNTDOWN (RAMP ETC)
                    </span>
                    {etcRemainingMins !== null && etcRemainingMins <= 30 && etcRemainingMins > 0 && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                        ⚡ Auto-L2 Empty Return Pre-Assigned
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-300 mt-0.5">
                    {job.etcTime ? (
                      <>
                        Scheduled Ramp Completion:{' '}
                        <strong className="font-mono text-white">
                          {new Date(job.etcTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </strong>{' '}
                        ({etcRemainingMins !== null && etcRemainingMins > 0 ? `${etcRemainingMins} minutes left` : 'Ready for Empty Pickup'})
                      </>
                    ) : (
                      'Container positioned at customer dock bay. Confirm below once destuffing is finished.'
                    )}
                  </p>
                </div>
              </div>

              {job.jobPhase === 'L1' && !job.l2Activated && (
                <button
                  type="button"
                  disabled={confirmingEmpty}
                  onClick={handleConfirmOffloadingComplete}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-extrabold shadow-lg transition-all"
                >
                  {confirmingEmpty
                    ? 'Notifying Dispatch...'
                    : '✓ Confirm Offloading Complete (Request Empty Pickup)'}
                </button>
              )}
            </div>
          )}
        </section>

        {/* 6-Stage Horizontal Milestone Progress Bar */}
        <section className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-extrabold text-white flex items-center gap-2">
                <Package className="w-4 h-4 text-blue-400" />
                Live Container Milestone Timeline
              </h2>
              <p className="text-xs text-slate-400">
                Real-time stage progression verified by Port PCS EDI, Driver Mobile OCR & GPS Geofences
              </p>
            </div>
            <span className="text-xs font-mono text-blue-400 font-bold">
              {Math.min(100, Math.round((currentStageIndex / 6) * 100))}% Complete
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
            {milestones.map((m) => {
              const isDone = m.state === 'COMPLETED';
              const isCurrent = m.state === 'CURRENT';
              return (
                <div
                  key={m.stageNum}
                  className={`p-3.5 rounded-xl border transition-all flex flex-col justify-between ${
                    isDone
                      ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-200'
                      : isCurrent
                      ? 'bg-blue-600/20 border-blue-400 text-white ring-1 ring-blue-400/50 shadow-lg'
                      : 'bg-slate-950/70 border-slate-800 text-slate-500'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1.5">
                      <span className="text-[10px] font-mono font-extrabold uppercase">
                        Stage {m.stageNum}
                      </span>
                      {isDone ? (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300">
                          ✓ DONE
                        </span>
                      ) : isCurrent ? (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500 text-white animate-pulse">
                          ● ACTIVE
                        </span>
                      ) : (
                        <span className="text-[9px] font-mono text-slate-600">PENDING</span>
                      )}
                    </div>
                    <div className="text-xs font-extrabold leading-snug">{m.title}</div>
                    <p className="text-[11px] opacity-80 mt-1 leading-relaxed">{m.subtitle}</p>
                  </div>

                  {m.timestamp && (
                    <div className="mt-2.5 pt-2 border-t border-white/10 text-[10px] font-mono opacity-90">
                      {new Date(m.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}{' '}
                      · {new Date(m.timestamp).toLocaleDateString()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Live Corridor Map (Read-Only Customer View) */}
        <section className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-sm font-extrabold text-white flex items-center gap-2">
              <MapPin className="w-4 h-4 text-emerald-400" />
              Live UAE Freight Corridor Map (Jebel Ali / Khalifa Port ↔ Warehouse Geofence)
            </h2>
            <span className="text-[11px] text-slate-400">
              Read-Only Customer Radar · Live Prime Mover Telemetry
            </span>
          </div>
          <DrayageCorridorLiveMap
            jobs={[{ ...job, rateAmountAed: 0 }]}
            terminals={portalData.corridorMap?.terminals || []}
            warehouses={portalData.corridorMap?.warehouses || []}
            geofences={portalData.corridorMap?.geofences || []}
            vehicles={portalData.corridorMap?.vehicles || []}
            selectedJobId={job.id}
            onSelectJob={() => {}}
            onAdvanceStage={() => {}}
            onVerifyEdi={() => {}}
            onOpenChat={() => {}}
          />
        </section>

        {/* Bottom Grid: Automated WhatsApp/Email Milestone Alerts + Audit Trail */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Automated WhatsApp & Email Milestone Subscriptions (6 cols) */}
          <div className="lg:col-span-6 p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
            <div className="flex items-start justify-between gap-2 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  Automated WhatsApp & Email Milestone Alerts
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Instant notifications whenever {job.containerNumber} transitions across port, corridor, ramp, or e-POD stages
                </p>
              </div>
              <span
                className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold border ${
                  autoAlertsEnabled
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}
              >
                {autoAlertsEnabled ? 'AUTO-ALERTS ON' : 'MANUAL ONLY'}
              </span>
            </div>

            <form onSubmit={handleSaveAlertSubscriptions} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">
                    Customer WhatsApp Number (UAE / Intl)
                  </label>
                  <input
                    type="text"
                    value={whatsappInput}
                    onChange={(e) => setWhatsappInput(e.target.value)}
                    placeholder="+971 50 482 9104"
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">
                    Customer Operations Email
                  </label>
                  <input
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="operations@customer.ae"
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300 pt-1">
                <input
                  type="checkbox"
                  checked={autoAlertsEnabled}
                  onChange={(e) => setAutoAlertsEnabled(e.target.checked)}
                  className="rounded border-slate-600 text-emerald-500"
                />
                <span>
                  Automatically send WhatsApp & Email alerts on every milestone change (Gated In, Loaded, In Transit, Placed @ Ramp, Completed)
                </span>
              </label>

              <div className="flex flex-wrap items-center gap-2 pt-2">
                <button
                  type="submit"
                  disabled={savingAlerts}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-extrabold text-xs shadow transition"
                >
                  {savingAlerts
                    ? 'Sending Milestone Alert...'
                    : 'Save & Send Live Milestone Alert Now (WhatsApp + Email)'}
                </button>
              </div>
            </form>

            {/* Recent WhatsApp & Email Alert Delivery Logs */}
            <div className="pt-3 border-t border-slate-800 space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Recent Automated WhatsApp & Email Deliveries ({alertLogs.length})
              </div>
              {alertLogs.length === 0 ? (
                <p className="text-xs text-slate-500 py-2">
                  Alerts will appear here automatically as stages progress or when you click &ldquo;Save & Send Live Milestone Alert Now&rdquo;.
                </p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {alertLogs.map((al) => (
                    <div
                      key={al.id}
                      className="p-2.5 rounded-xl bg-slate-950 border border-emerald-500/30 text-[11px] space-y-1"
                    >
                      <div className="flex items-center justify-between text-emerald-400 font-bold">
                        <span>✓ {al.status.replace('MILESTONE_ALERT_', '')}</span>
                        <span className="font-mono text-[10px] text-slate-400">
                          {new Date(al.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <p className="text-slate-300 leading-relaxed">{al.notes}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Verified Milestone & e-POD Audit Log (6 cols) */}
          <div className="lg:col-span-6 p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
            <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-400" />
                  Verified Milestone & Digital e-POD Audit Trail
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Timestamped port gate passes, Gemini Vision OCR seal checks & ramp signatures
                </p>
              </div>
              {job.podSignatureName && (
                <span className="px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold">
                  ✍️ e-POD Signed: {job.podSignatureName}
                </span>
              )}
            </div>

            <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
              {statusLogs.length === 0 ? (
                <p className="text-xs text-slate-500 py-8 text-center">No milestone events recorded yet.</p>
              ) : (
                statusLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-start gap-3 text-xs"
                  >
                    <div className="w-2.5 h-2.5 rounded-full bg-blue-400 mt-1 shrink-0" />
                    <div className="space-y-0.5 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono font-bold text-white text-[11px]">{log.status}</span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {new Date(log.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}{' '}
                          · {log.actor}
                        </span>
                      </div>
                      <p className="text-slate-300 text-[11px] leading-relaxed">{log.notes}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
