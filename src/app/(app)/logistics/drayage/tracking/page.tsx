'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import {
  Radio, Compass, Truck, Layers, Zap,
} from 'lucide-react';

const DrayageCorridorLiveMap = dynamic(
  () => import('@/components/logistics/drayage/DrayageCorridorLiveMap'),
  {
    ssr: false,
    loading: () => (
      <div className="h-[620px] rounded-2xl bg-slate-900 animate-pulse flex flex-col items-center justify-center text-xs text-blue-400 gap-2 border border-slate-800">
        <RefreshCw className="w-5 h-5 animate-spin text-blue-500" />
        <span>Initializing Real-Time UAE Corridor Telematics Radar...</span>
      </div>
    ),
  }
);
import {
  Navigation,
  Package,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ShieldCheck,
  Send,
  MessageSquare,
  Clock,
  Plus,
  Settings,
  Copy,
  ExternalLink,
  Share2,
} from 'lucide-react';
import { KpiCard, PageHeader, Panel, StatusPill } from '@/components/ui/page-theme';
import { DrayageSuperAdminConfigModal } from '@/components/logistics/drayage/DrayageSuperAdminConfigModal';
import {
  DEFAULT_DRAYAGE_AUTOMATION_CONFIG,
  type DrayageAutomationConfig,
} from '@/lib/logistics/drayage-domain';
import type {
  DrayageCorridorTerminal,
  DrayageCorridorWarehouse,
  DrayageCorridorGeofence,
  DrayageCorridorVehicle,
} from '@/components/logistics/drayage/DrayageCorridorLiveMap';

/** EDI clearance check result shown on the tracking card (the fields read here). */
interface EdiVerification {
  providerLabel?: string;
  verifiedAt: string;
  customsStatus?: string;
  doStatus?: string;
  vesselName?: string;
  tokenNumber?: string;
}

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
  etcTime?: string | null;
  etcAlertStatus?: string;
  rateAmountAed: number;
  driverAllowanceAed: number;
  customsInspection: boolean;
  currentLat?: number | null;
  currentLng?: number | null;
  cargoWeightKg?: number;
  shippingLine?: string;
  bogieJobId?: string | null;
  streetTurnJobId?: string | null;
  doExpiryDate?: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  riskRadar?: {
    portFreeTimeExpiry: string;
    portDemurrageHoursRemaining: number;
    portFreeDaysAllowed: number;
    portDailyDemurrageAed: number;
    lineDetentionExpiry: string;
    lineDetentionHoursRemaining: number;
    lineFreeDaysAllowed: number;
    lineDailyDetentionAed: number;
    doExpiryDate: string;
    doHoursRemaining: number;
    minHoursRemaining: number;
    primaryRiskFactor: 'PORT_DEMURRAGE' | 'LINE_DETENTION' | 'DO_EXPIRY' | 'SAFE';
    within24hPenaltyWindow: boolean;
    autoEscalatedCritical: boolean;
    dailyCombinedPenaltyAed: number;
    accruedExposureAed: number;
    status: 'EXPIRED' | 'CRITICAL_24H' | 'WARNING_48H' | 'SAFE';
  };
  portSlotPrediction?: {
    hasActiveToken: boolean;
    tokenNumber: string | null;
    pcsProvider: 'DP_WORLD_DUBAI_TRADE' | 'AD_PORTS_MAQTA';
    slotStart: string;
    slotEnd: string;
    slotWindowLabel: string;
    corridorName: string;
    trafficCondition: 'HEAVY_CONGESTION' | 'MODERATE_FLOW' | 'FREE_FLOW';
    avgCorridorSpeedKmh: number;
    distanceToPortKm: number;
    drivingEtaMinutes: number;
    gateQueueWaitMinutes: number;
    totalEtaMinutes: number;
    predictedGateArrivalIso: string;
    predictedGateArrivalLabel: string;
    slotBufferMinutes: number;
    willMissSlot: boolean;
    slotRiskStatus: 'SLOT_MISS_RISK' | 'TIGHT_BUFFER' | 'ON_TIME';
    recommendation: string;
  };
  customerPortal?: {
    trackingToken: string;
    shareablePath: string;
    jobCode: string;
    containerNumber: string;
    customerName: string;
    customerWhatsApp: string;
    customerEmail: string;
    autoAlertsEnabled: boolean;
    lastAlertSentAt: string | null;
    lastAlertSummary: string | null;
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

function getOperationalStageIndex(status: string, trailerDetached?: boolean): number {
  const s = (status || '').toUpperCase();
  if (['EMPTY_DEPOSITED', 'CONTAINER_DROPPED', 'COMPLETED', 'STREET_TURNED'].includes(s)) {
    return 6;
  }
  if (
    ['CONTAINER_DETACHED', 'TRAILER_DETACHED', 'REASSIGN_TRAILER_DETACHED', 'READY_FOR_PICKUP', 'WAITING_MT_RETURN'].includes(s)
  ) {
    return 5;
  }
  if (['PLACED_AT_RAMP', 'REASSIGN_PLACED_AT_RAMP', 'PLACED_AT_YARD', 'REASSIGN_PLACED_AT_YARD'].includes(s)) {
    return trailerDetached ? 5 : 4;
  }
  if (['IN_TRANSIT', 'EN_ROUTE_WAREHOUSE', 'EN_ROUTE_TERMINAL', 'EMPTY_AT_PORT'].includes(s)) {
    return 3;
  }
  if (['LOADED', 'CONTAINER_PICKED', 'UNDER_INSPECTION', 'TRAILER_ATTACHED'].includes(s)) {
    return 2;
  }
  if (['AT_PORT', 'ARRIVED_AT_PORT'].includes(s)) {
    return 1;
  }
  return 0;
}

export default function DrayageJobTrackingPage() {
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<DrayageJob[]>([]);
  const [statusLogs, setStatusLogs] = useState<StatusLog[]>([]);
  const [messages, setMessages] = useState<DispatchMessage[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [terminals, setTerminals] = useState<DrayageCorridorTerminal[]>([]);
  const [warehouses, setWarehouses] = useState<DrayageCorridorWarehouse[]>([]);
  const [geofences, setGeofences] = useState<DrayageCorridorGeofence[]>([]);
  const [vehicles, setVehicles] = useState<DrayageCorridorVehicle[]>([]);
  const [viewMode, setViewMode] = useState<'SPLIT' | 'RADAR' | 'CONSOLE'>('SPLIT');

  // EDI verification state
  const [ediLoading, setEdiLoading] = useState(false);
  const [ediResult, setEdiResult] = useState<EdiVerification | null>(null);

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
  const [etcModalOpen, setEtcModalOpen] = useState(false);
  const [targetStatusForEtc, setTargetStatusForEtc] = useState<'PLACED_AT_RAMP' | 'CONTAINER_DETACHED'>('PLACED_AT_RAMP');
  const [selectedEtcHours, setSelectedEtcHours] = useState(3);
  const [customEtcInput, setCustomEtcInput] = useState('');
  const [autoL2DispatchEnabled, setAutoL2DispatchEnabled] = useState(true);
  const [togglingAutoL2, setTogglingAutoL2] = useState(false);
  const [automationConfig, setAutomationConfig] = useState<DrayageAutomationConfig>(DEFAULT_DRAYAGE_AUTOMATION_CONFIG);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [customerWhatsAppInput, setCustomerWhatsAppInput] = useState('+971 50 482 9104');
  const [customerEmailInput, setCustomerEmailInput] = useState('logistics-ops@shipper.ae');
  const [customerAutoAlerts, setCustomerAutoAlerts] = useState(true);
  const [sendingCustomerAlert, setSendingCustomerAlert] = useState(false);
  const [copiedTrackingLink, setCopiedTrackingLink] = useState(false);
  const [, setTick] = useState(0);

  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4500);
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
      setTerminals(data.terminals || []);
      setWarehouses(data.warehouses || []);
      setGeofences(data.geofences || []);
      setVehicles(data.vehicles || []);
      if (data.automationConfig) {
        setAutomationConfig({
          ...DEFAULT_DRAYAGE_AUTOMATION_CONFIG,
          ...data.automationConfig,
        });
        if (typeof data.automationConfig.autoL2DispatchEnabled === 'boolean') {
          setAutoL2DispatchEnabled(data.automationConfig.autoL2DispatchEnabled);
        }
      }

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
    const thresholdMins = automationConfig.thresholdMinutes || 30;
    const timer = setInterval(async () => {
      setTick((t) => t + 1);
      if (autoL2DispatchEnabled) {
        const hasPendingThresholdJob = jobs.some(
          (j) =>
            j.jobPhase === 'L1' &&
            !j.l2Activated &&
            j.placementLocation !== 'YARD' &&
            j.etcTime &&
            new Date(j.etcTime).getTime() - Date.now() <= thresholdMins * 60 * 1000,
        );
        if (hasPendingThresholdJob) {
          try {
            const res = await fetch('/api/logistics/drayage', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'check_etc_timers',
                thresholdMinutes: thresholdMins,
                preAssignTractor: true,
              }),
            });
            if (res.ok) {
              const checkRes = await res.json();
              if (Array.isArray(checkRes.activated) && checkRes.activated.length > 0) {
                const first = checkRes.activated[0];
                showToast(
                  'success',
                  `⚡ Auto-L2 @ T-${thresholdMins}m triggered ${first.l2JobCode}${first.vehiclePlate ? ` · Pre-Assigned ${first.vehiclePlate} (${first.driverName} · ${first.matchScorePct}% Match)` : ''}!`,
                );
                await loadData();
              }
            }
          } catch {
            // Silent background poll
          }
        }
      }
    }, 30000);
    return () => clearInterval(timer);
  }, [autoL2DispatchEnabled, automationConfig.thresholdMinutes, jobs, loadData]);

  // Toggle Tenant Manual vs Auto-L2 (T-30m) Dispatch Mode
  const handleToggleAutoL2Mode = async (enabled: boolean) => {
    try {
      setTogglingAutoL2(true);
      setAutoL2DispatchEnabled(enabled);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'toggle_auto_l2_mode',
          enabled,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update L2 dispatch mode');
      showToast(
        'success',
        enabled
          ? '⚡ Switched to Auto-L2 Dispatch & 4-Factor Pre-Assignment (Triggers @ T-30m before ETC)'
          : '🛠️ Switched to Manual L2 Dispatch Mode (Dispatcher triggers L2 manually)',
      );
      await loadData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error toggling L2 dispatch mode');
    } finally {
      setTogglingAutoL2(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [loadData]);

  const activeJob = useMemo(() => {
    return jobs.find((j) => j.id === selectedJobId) || jobs[0] || null;
  }, [jobs, selectedJobId]);

  useEffect(() => {
    if (activeJob?.customerPortal) {
      setCustomerWhatsAppInput(activeJob.customerPortal.customerWhatsApp || '+971 50 482 9104');
      setCustomerEmailInput(activeJob.customerPortal.customerEmail || 'logistics-ops@shipper.ae');
      setCustomerAutoAlerts(Boolean(activeJob.customerPortal.autoAlertsEnabled ?? true));
    }
  }, [activeJob?.id, activeJob?.customerPortal]);

  const handleCopyCustomerTrackingLink = () => {
    if (!activeJob?.customerPortal?.shareablePath || typeof window === 'undefined') return;
    const fullUrl = `${window.location.origin}${activeJob.customerPortal.shareablePath}`;
    navigator.clipboard.writeText(fullUrl);
    setCopiedTrackingLink(true);
    showToast('success', `Copied read-only Customer Tracking Link for ${activeJob.jobCode} (${activeJob.containerNumber})`);
    setTimeout(() => setCopiedTrackingLink(false), 3000);
  };

  const handleSendCustomerMilestoneAlert = async (savePrefsOnly = false) => {
    if (!activeJob) return;
    try {
      setSendingCustomerAlert(true);
      await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_customer_alert_preferences',
          jobId: activeJob.id,
          customerWhatsApp: customerWhatsAppInput,
          customerEmail: customerEmailInput,
          autoAlertsEnabled: customerAutoAlerts,
        }),
      });
      if (!savePrefsOnly) {
        const res = await fetch('/api/logistics/drayage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'send_customer_milestone_alert',
            jobId: activeJob.id,
            customerWhatsApp: customerWhatsAppInput,
            customerEmail: customerEmailInput,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to send customer milestone alert');
        showToast(
          'success',
          `📲 Sent WhatsApp (${data.whatsappTo}) & Email (${data.emailTo}) Milestone Alert with Live Tracking Portal link!`,
        );
      } else {
        showToast('success', 'Saved Customer WhatsApp & Email milestone notification settings.');
      }
      await loadData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error sending customer milestone alert');
    } finally {
      setSendingCustomerAlert(false);
    }
  };

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
    etcTime?: string | null,
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
          etcTime: etcTime || undefined,
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

  // Extend ETC timer
  const handleExtendEtc = async (minutesToAdd: number) => {
    if (!activeJob) return;
    try {
      setUpdatingStatus(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'extend_etc',
          jobId: activeJob.id,
          minutesToAdd,
          actor: 'Dispatch Console',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to extend ETC');
      showToast('success', `ETC extended by +${minutesToAdd}m (New ETC: ${new Date(data.etcTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`);
      await loadData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error extending ETC');
    } finally {
      setUpdatingStatus(false);
    }
  };

  // Trigger L2 Empty Return (with 4-Factor Telematics Pre-Assignment)
  const handleTriggerL2 = async () => {
    if (!activeJob) return;
    try {
      setUpdatingStatus(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'activate_l2',
          l1JobId: activeJob.id,
          preAssignTractor: true,
          triggerSource: autoL2DispatchEnabled ? 'AUTO_T30' : 'MANUAL_DISPATCH',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to activate L2 empty return');
      showToast(
        'success',
        `L2 Empty Return ${data.l2JobCode} activated${
          data.preAssigned && data.vehiclePlate
            ? ` · 4-Factor Pre-Assigned to ${data.vehiclePlate} (${data.driverName} · ${data.matchScorePct}% Match)`
            : '!'
        }`,
      );
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

  // Auto-Rebook PCS Token Slot when E11/E311 traffic causes gate slot miss
  const handleRebookPcsSlot = async () => {
    if (!activeJob) return;
    try {
      setUpdatingStatus(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'rebook_pcs_slot',
          jobId: activeJob.id,
          actor: 'Port Slot Risk Predictor',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to rebook PCS token slot');
      showToast(
        'success',
        `🔄 Auto-Rebooked PCS Token ${data.tokenNumber} · New Gate Slot: ${data.slotWindowLabel} (Aligned with live E11/E311 ETA)!`,
      );
      await loadData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error rebooking PCS slot');
    } finally {
      setUpdatingStatus(false);
    }
  };

  // Swap to a nearer prime mover via 4-Factor Telematics to rescue the port slot window
  const handleSwapSlotRescueTractor = async () => {
    if (!activeJob) return;
    try {
      setUpdatingStatus(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'swap_slot_rescue_tractor',
          jobId: activeJob.id,
          actor: 'Port Slot Risk Predictor',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to swap rescue tractor');
      showToast(
        'success',
        `🚛 Swapped to nearer Prime Mover ${data.vehiclePlate} (${data.driverName} · ${data.matchScorePct}% 4-Factor Match) — Gate ETA now ON TIME!`,
      );
      await loadData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error swapping tractor');
    } finally {
      setUpdatingStatus(false);
    }
  };

  // Revalidate Delivery Order (+5 Days) to clear <24h Demurrage/DO risk
  const handleRevalidateDo = async () => {
    if (!activeJob) return;
    try {
      setUpdatingStatus(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'revalidate_delivery_order',
          jobId: activeJob.id,
          containerId: activeJob.containerId,
          extendDays: 5,
          actor: 'Demurrage & Free-Time Radar',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to revalidate DO');
      showToast('success', `✓ eDO & Free-Time Window Extended by +${data.daysExtended} Days for ${activeJob.containerNumber}!`);
      await loadData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error revalidating DO');
    } finally {
      setUpdatingStatus(false);
    }
  };

  // Simulate E11/E311 Traffic Delay & <24h Demurrage/Detention Risk for 1-click testing
  const handleSimulateTrafficRisk = async () => {
    if (!activeJob) return;
    try {
      setUpdatingStatus(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'simulate_slot_traffic_delay',
          jobId: activeJob.id,
          actor: 'Dispatch Console Simulator',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to simulate traffic risk');
      showToast(
        'success',
        `⚠️ Simulated E11/E311 Heavy Congestion & <24h Free-Time Threshold on ${data.jobCode}! See remediation options below.`,
      );
      await loadData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error simulating traffic delay');
    } finally {
      setUpdatingStatus(false);
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
          <div className="flex flex-wrap items-center gap-2">
            {/* Tenant Toggle: Manual vs Auto-L2 Dispatch & Pre-Assignment on ETC Threshold (T-30 mins) */}
            <div
              className="flex items-center rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-0.5 text-xs shadow-sm"
              title="Tenant Dispatch Automation Mode: Switch between Manual L2 Dispatch and Automatic L2 Dispatch + 4-Factor Pre-Assignment at T-30 mins before Offloading ETC"
            >
              <button
                type="button"
                disabled={togglingAutoL2}
                onClick={() => handleToggleAutoL2Mode(false)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-semibold transition-all ${
                  !autoL2DispatchEnabled
                    ? 'bg-slate-700 text-white shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                Manual L2
              </button>
              <button
                type="button"
                disabled={togglingAutoL2}
                onClick={() => handleToggleAutoL2Mode(true)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-bold transition-all ${
                  autoL2DispatchEnabled
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                <Zap className="w-3.5 h-3.5 fill-current" />
                Auto-L2 @ T-{automationConfig.thresholdMinutes || 30}m
              </button>
            </div>

            <button
              type="button"
              onClick={() => setConfigModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 dark:bg-slate-800 border border-slate-700 text-xs font-bold text-white hover:bg-slate-800 transition-colors shadow-sm"
              title="Open Super Admin Drayage Engine Configuration (4-Factor Weights, T-30m Timer, Street-Turn Radius, Demurrage Thresholds)"
            >
              <Settings className="w-3.5 h-3.5 text-sky-400" />
              Engine Config
            </button>

            <div className="flex items-center rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-0.5 text-xs shadow-sm">
              <button
                type="button"
                onClick={() => setViewMode('SPLIT')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all ${
                  viewMode === 'SPLIT'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                <Compass className="w-3.5 h-3.5 text-blue-300" />
                Split Radar & Console
              </button>
              <button
                type="button"
                onClick={() => setViewMode('RADAR')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all ${
                  viewMode === 'RADAR'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                Full Corridor Radar
              </button>
              <button
                type="button"
                onClick={() => setViewMode('CONSOLE')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all ${
                  viewMode === 'CONSOLE'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                <Package className="w-3.5 h-3.5" />
                Console Only
              </button>
            </div>
            <button
              onClick={loadData}
              disabled={loading}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors shadow-sm"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        }
      />

      {/* Real-Time Telematics & Fleet Corridor KPI Ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard
          label="On Freight Corridors (E11/E311)"
          value={jobs.filter((j) => j.status === 'IN_TRANSIT').length}
          icon={Truck}
          accent="blue"
        />
        <KpiCard
          label="Dual-20FT Bogie Dispatches"
          value={jobs.filter((j) => Boolean(j.bogieJobId)).length}
          icon={Layers}
          accent="violet"
        />
        <KpiCard
          label="Street-Turn Triangulations"
          value={jobs.filter((j) => Boolean(j.streetTurnJobId) || j.status === 'STREET_TURNED').length}
          icon={RefreshCw}
          accent="emerald"
        />
        <KpiCard
          label="Detached at Warehouse Ramps"
          value={jobs.filter((j) => j.trailerDetached || j.status === 'PLACED_AT_RAMP' || j.placementLocation === 'RAMP').length}
          icon={Clock}
          accent="amber"
        />
        <KpiCard
          label="Port PCS / Gate Clearance"
          value={`${jobs.filter((j) => j.tokenNumber).length} / ${jobs.length}`}
          icon={ShieldCheck}
          accent="cyan"
        />
      </div>

{/* Real-Time Telematics Corridor Map (Full Radar or Split) */}
      {(viewMode === 'RADAR' || viewMode === 'SPLIT') && (
        <DrayageCorridorLiveMap
          jobs={jobs}
          terminals={terminals}
          warehouses={warehouses}
          geofences={geofences}
          vehicles={vehicles}
          selectedJobId={selectedJobId}
          onSelectJob={(id) => setSelectedJobId(id)}
          onAdvanceStage={(status) => handleUpdateStatus(status)}
          onVerifyEdi={(provider) => handleVerifyEdi(provider)}
          onOpenChat={(id) => {
            setSelectedJobId(id);
          }}
          fullHeight={viewMode === 'RADAR'}
        />
      )}

      {/* Main Split Layout: Left Active Jobs Selector / Right Detailed Execution Console */}
      {viewMode !== 'RADAR' && (
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

                  <div className="flex flex-wrap items-center gap-2">
                    {activeJob.customerPortal?.shareablePath && (
                      <>
                        <button
                          type="button"
                          onClick={handleCopyCustomerTrackingLink}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-xs font-bold text-emerald-400 hover:bg-emerald-500/25 transition-colors"
                          title="Copy read-only token-secured Customer Tracking Portal link"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          {copiedTrackingLink ? 'Link Copied!' : 'Copy Customer Link'}
                        </button>
                        <a
                          href={activeJob.customerPortal.shareablePath}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 border border-blue-500/40 text-xs font-bold text-blue-300 hover:bg-blue-600/30 transition-colors"
                          title="Open Zero-Login Read-Only Customer Tracking Portal in a new tab"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Customer Portal
                        </a>
                      </>
                    )}
                    <button
                      onClick={() => setShowLegModal(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-main)] hover:border-blue-500/40 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5 text-blue-400" />
                      Add Intermediate Leg
                    </button>
                    {activeJob.jobPhase === 'L1' && !activeJob.l2Activated && (() => {
                      const currentStage = getOperationalStageIndex(activeJob.status, activeJob.trailerDetached);
                      const canTriggerL2 =
                        currentStage >= 4 &&
                        activeJob.placementLocation !== 'YARD' &&
                        Boolean(activeJob.etcTime);
                      return (
                        <button
                          onClick={handleTriggerL2}
                          disabled={updatingStatus || !canTriggerL2}
                          title={
                            canTriggerL2
                              ? 'Activate L2 Empty Return job now'
                              : 'Locked: Requires container Placed at Ramp with Offloading ETC set'
                          }
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                            canTriggerL2
                              ? 'bg-amber-500/15 border-amber-500/30 text-amber-500 hover:bg-amber-500/25 cursor-pointer'
                              : 'bg-slate-500/10 border-[var(--border-subtle)] text-[var(--text-muted)] opacity-45 cursor-not-allowed'
                          }`}
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          Trigger L2 Empty Return
                        </button>
                      );
                    })()}
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

                {/* =========================================================================
                    DEMURRAGE, DETENTION & PORT SLOT RISK INTELLIGENCE PANEL
                    ========================================================================= */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {/* 1. Demurrage & Free-Time Countdown Radar */}
                  {activeJob.riskRadar && (
                    <div
                      className={`p-3.5 rounded-xl border space-y-2.5 ${
                        activeJob.riskRadar.within24hPenaltyWindow
                          ? 'bg-rose-500/10 border-rose-500/40'
                          : activeJob.riskRadar.status === 'WARNING_48H'
                          ? 'bg-amber-500/10 border-amber-500/30'
                          : 'bg-[var(--bg-main)] border-[var(--border-subtle)]'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <AlertTriangle
                            className={`w-4 h-4 shrink-0 ${
                              activeJob.riskRadar.within24hPenaltyWindow
                                ? 'text-rose-400 animate-pulse'
                                : 'text-amber-400'
                            }`}
                          />
                          <span className="text-xs font-bold text-[var(--text-main)]">
                            Demurrage & Free-Time Countdown Radar
                          </span>
                        </div>
                        {activeJob.riskRadar.within24hPenaltyWindow ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-600 text-white shadow-sm animate-pulse">
                            🚨 CRITICAL (&lt;24H PENALTY)
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            🟢 FREE TIME ACTIVE
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-3 gap-2 text-[11px]">
                        <div className="p-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                          <span className="text-[9px] uppercase text-[var(--text-muted)] block">Port Demurrage</span>
                          <strong
                            className={`font-mono text-xs ${
                              activeJob.riskRadar.portDemurrageHoursRemaining <= 24 ? 'text-rose-400' : 'text-emerald-400'
                            }`}
                          >
                            {activeJob.riskRadar.portDemurrageHoursRemaining <= 0
                              ? `Overdue (${Math.abs(activeJob.riskRadar.portDemurrageHoursRemaining)}h)`
                              : `${activeJob.riskRadar.portDemurrageHoursRemaining}h left`}
                          </strong>
                          <div className="text-[9px] text-[var(--text-muted)]">
                            {activeJob.riskRadar.portFreeDaysAllowed}d free · AED {activeJob.riskRadar.portDailyDemurrageAed}/d
                          </div>
                        </div>

                        <div className="p-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                          <span className="text-[9px] uppercase text-[var(--text-muted)] block">Line Detention</span>
                          <strong
                            className={`font-mono text-xs ${
                              activeJob.riskRadar.lineDetentionHoursRemaining <= 24 ? 'text-rose-400' : 'text-amber-400'
                            }`}
                          >
                            {activeJob.riskRadar.lineDetentionHoursRemaining <= 0
                              ? `Overdue (${Math.abs(activeJob.riskRadar.lineDetentionHoursRemaining)}h)`
                              : `${activeJob.riskRadar.lineDetentionHoursRemaining}h left`}
                          </strong>
                          <div className="text-[9px] text-[var(--text-muted)]">
                            {activeJob.riskRadar.lineFreeDaysAllowed}d box · AED {activeJob.riskRadar.lineDailyDetentionAed}/d
                          </div>
                        </div>

                        <div className="p-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                          <span className="text-[9px] uppercase text-[var(--text-muted)] block">DO Expiry</span>
                          <strong
                            className={`font-mono text-xs ${
                              activeJob.riskRadar.doHoursRemaining <= 24 ? 'text-rose-400' : 'text-blue-400'
                            }`}
                          >
                            {activeJob.riskRadar.doHoursRemaining <= 0
                              ? `Expired`
                              : `${activeJob.riskRadar.doHoursRemaining}h left`}
                          </strong>
                          <div className="text-[9px] text-[var(--text-muted)]">
                            {new Date(activeJob.riskRadar.doExpiryDate).toLocaleDateString()}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[10px]">
                        <span className="text-[var(--text-muted)]">
                          {activeJob.riskRadar.within24hPenaltyWindow
                            ? `Auto-escalated priority to CRITICAL · Exposure: AED ${activeJob.riskRadar.dailyCombinedPenaltyAed}/day`
                            : `Combined post-free tariff: AED ${activeJob.riskRadar.dailyCombinedPenaltyAed}/day`}
                        </span>
                        <button
                          type="button"
                          onClick={handleRevalidateDo}
                          disabled={updatingStatus}
                          className="px-2.5 py-1 rounded-lg bg-blue-600/20 border border-blue-500/40 text-blue-300 hover:bg-blue-600/30 font-bold transition-colors"
                        >
                          +5d Revalidate eDO
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 2. Port Appointment Window & Gate Queue Predictor */}
                  {activeJob.portSlotPrediction && (
                    <div
                      className={`p-3.5 rounded-xl border space-y-2.5 ${
                        activeJob.portSlotPrediction.willMissSlot
                          ? 'bg-rose-500/10 border-rose-500/40'
                          : activeJob.portSlotPrediction.slotRiskStatus === 'TIGHT_BUFFER'
                          ? 'bg-amber-500/10 border-amber-500/30'
                          : 'bg-[var(--bg-main)] border-[var(--border-subtle)]'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Clock
                            className={`w-4 h-4 shrink-0 ${
                              activeJob.portSlotPrediction.willMissSlot
                                ? 'text-rose-400 animate-pulse'
                                : 'text-cyan-400'
                            }`}
                          />
                          <span className="text-xs font-bold text-[var(--text-main)]">
                            Port Appointment & Gate Queue Predictor
                          </span>
                        </div>
                        {activeJob.portSlotPrediction.willMissSlot ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-600 text-white shadow-sm animate-pulse">
                            ⚠️ SLOT MISS ({Math.abs(activeJob.portSlotPrediction.slotBufferMinutes)}M LATE)
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            ✓ ETA ON SCHEDULE (+{activeJob.portSlotPrediction.slotBufferMinutes}m)
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-3 gap-2 text-[11px]">
                        <div className="p-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                          <span className="text-[9px] uppercase text-[var(--text-muted)] block">PCS Gate Window</span>
                          <strong className="font-mono text-xs text-[var(--text-main)]">
                            {activeJob.portSlotPrediction.slotWindowLabel}
                          </strong>
                          <div className="text-[9px] text-emerald-400 font-mono truncate">
                            {activeJob.portSlotPrediction.tokenNumber || 'Token Pending'}
                          </div>
                        </div>

                        <div className="p-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                          <span className="text-[9px] uppercase text-[var(--text-muted)] block">Live Corridor ETA</span>
                          <strong
                            className={`font-mono text-xs ${
                              activeJob.portSlotPrediction.willMissSlot ? 'text-rose-400' : 'text-cyan-400'
                            }`}
                          >
                            {activeJob.portSlotPrediction.predictedGateArrivalLabel} ({activeJob.portSlotPrediction.totalEtaMinutes}m)
                          </strong>
                          <div className="text-[9px] text-[var(--text-muted)] truncate">
                            {activeJob.portSlotPrediction.distanceToPortKm}km @ {activeJob.portSlotPrediction.avgCorridorSpeedKmh}km/h
                          </div>
                        </div>

                        <div className="p-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                          <span className="text-[9px] uppercase text-[var(--text-muted)] block">Gate OCR Queue</span>
                          <strong className="font-mono text-xs text-amber-400">
                            +{activeJob.portSlotPrediction.gateQueueWaitMinutes} mins
                          </strong>
                          <div className="text-[9px] text-[var(--text-muted)] truncate">
                            {activeJob.portSlotPrediction.trafficCondition.replace('_', ' ')}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={handleRebookPcsSlot}
                            disabled={updatingStatus}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500 text-slate-950 hover:bg-amber-400 text-[10px] font-bold transition-colors shadow-sm"
                            title="Automatically rebook DP World / AD Ports PCS token to the next 2-hour window matching live E11/E311 ETA"
                          >
                            <RefreshCw className="w-3 h-3" />
                            Auto-Rebook PCS Token
                          </button>
                          <button
                            type="button"
                            onClick={handleSwapSlotRescueTractor}
                            disabled={updatingStatus}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-500 text-[10px] font-bold transition-colors shadow-sm"
                            title="Swap to nearest available prime mover via 4-Factor Telematics to make the current gate slot"
                          >
                            <Truck className="w-3 h-3" />
                            Swap Tractor (4-Factor)
                          </button>
                        </div>
                        {!activeJob.portSlotPrediction.willMissSlot && (
                          <button
                            type="button"
                            onClick={handleSimulateTrafficRisk}
                            disabled={updatingStatus}
                            className="px-2 py-1 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 text-[10px] font-semibold transition-colors"
                            title="Simulate E11/E311 heavy congestion & <24h free-time risk to test automated slot rebooking or tractor swap"
                          >
                            ⚡ Test E11/E311 Delay
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Offloading ETC Countdown & Management */}
                {activeJob.jobPhase === 'L1' && (activeJob.etcTime || activeJob.placementLocation === 'RAMP' || activeJob.status === 'PLACED_AT_RAMP' || activeJob.trailerDetached) && (
                  <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                        <Clock className="w-4 h-4 animate-pulse" />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold text-amber-400">Destuffing & Offload Timer (ETC)</span>
                          {activeJob.etcTime && new Date(activeJob.etcTime).getTime() <= Date.now() ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
                              ⚠️ EXPIRED - L2 READY
                            </span>
                          ) : activeJob.etcTime && new Date(activeJob.etcTime).getTime() - Date.now() <= (automationConfig.thresholdMinutes || 30) * 60 * 1000 ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 animate-pulse">
                              ⚡ T-{automationConfig.thresholdMinutes || 30}M THRESHOLD ACTIVE · 4-FACTOR PRE-ASSIGN
                            </span>
                          ) : activeJob.etcTime ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                              ⏳ ACTIVE TIMER
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-500/20 text-slate-400">
                              NO ETC SET
                            </span>
                          )}
                          <button
                            type="button"
                            disabled={togglingAutoL2}
                            onClick={() => handleToggleAutoL2Mode(!autoL2DispatchEnabled)}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border transition-all ${
                              autoL2DispatchEnabled
                                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30'
                                : 'bg-slate-700/60 text-slate-300 border-slate-500/40 hover:bg-slate-700'
                            }`}
                            title="Click to switch Tenant L2 Turnaround Mode between Auto-L2 and Manual L2 Dispatch"
                          >
                            <Zap className="w-2.5 h-2.5" />
                            {autoL2DispatchEnabled
                              ? `Mode: Auto-L2 & 4-Factor Pre-Assign @ T-${automationConfig.thresholdMinutes || 30}m (Click for Manual)`
                              : `Mode: Manual L2 Dispatch (Click for Auto-L2 @ T-${automationConfig.thresholdMinutes || 30}m)`}
                          </button>
                        </div>
                        <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                          {activeJob.etcTime ? (
                            <>
                              Expected Completion: <strong className="text-[var(--text-main)] font-mono">{new Date(activeJob.etcTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>
                              {' · '}
                              <span className={new Date(activeJob.etcTime).getTime() <= Date.now() ? 'text-rose-400 font-semibold' : 'text-amber-400 font-semibold'}>
                                {new Date(activeJob.etcTime).getTime() <= Date.now()
                                  ? 'Offloading completed - Dynamic L2 activation triggered'
                                  : `${Math.max(1, Math.round((new Date(activeJob.etcTime).getTime() - Date.now()) / 60000))} mins remaining`}
                              </span>
                              {' · '}
                              <span className="text-emerald-400 font-medium">
                                {autoL2DispatchEnabled
                                  ? `Auto-triggers L2 & 4-Factor tractor pre-assignment at T-${automationConfig.thresholdMinutes || 30}m`
                                  : 'Manual L2 trigger mode active'}
                              </span>
                            </>
                          ) : (
                            'Set ETC from driver mobile app or click button below to activate Leg 2 automation'
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {!activeJob.l2Activated && (
                        <button
                          onClick={async () => {
                            const t25Iso = new Date(Date.now() + 25 * 60 * 1000).toISOString();
                            await handleUpdateStatus(
                              activeJob.status === 'IN_TRANSIT' ? 'PLACED_AT_RAMP' : activeJob.status,
                              'RAMP',
                              activeJob.trailerDetached,
                              t25Iso,
                            );
                          }}
                          disabled={updatingStatus}
                          className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25 text-xs font-bold transition-colors"
                          title="Set Offload ETC to T-25 mins to test T-30m Auto-L2 Dispatch & 4-Factor Pre-Assignment"
                        >
                          ⚡ Set ETC T-25m (Test T-30m)
                        </button>
                      )}
                      <button
                        onClick={() => handleExtendEtc(60)}
                        disabled={updatingStatus}
                        className="px-2.5 py-1 rounded-lg bg-[var(--bg-main)] border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 text-xs font-semibold transition-colors"
                        title="Extend Offload ETC by 1 hour"
                      >
                        +1 Hour
                      </button>
                      <button
                        onClick={() => handleExtendEtc(120)}
                        disabled={updatingStatus}
                        className="px-2.5 py-1 rounded-lg bg-[var(--bg-main)] border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 text-xs font-semibold transition-colors"
                        title="Extend Offload ETC by 2 hours"
                      >
                        +2 Hours
                      </button>
                      {!activeJob.l2Activated && (() => {
                        const currentStage = getOperationalStageIndex(activeJob.status, activeJob.trailerDetached);
                        const canTriggerL2 =
                          currentStage >= 4 &&
                          activeJob.placementLocation !== 'YARD' &&
                          Boolean(activeJob.etcTime);
                        return (
                          <button
                            onClick={handleTriggerL2}
                            disabled={updatingStatus || !canTriggerL2}
                            title={
                              canTriggerL2
                                ? 'Activate L2 Empty Return job now & pre-assign nearest tractor via 4-Factor Telematics'
                                : 'Requires container Placed at Ramp with Offloading ETC set'
                            }
                            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg font-bold text-xs transition-colors shadow-sm ${
                              canTriggerL2
                                ? 'bg-amber-500 text-slate-950 hover:bg-amber-400 cursor-pointer'
                                : 'bg-slate-500/20 text-[var(--text-muted)] opacity-50 cursor-not-allowed'
                            }`}
                          >
                            <RefreshCw className="w-3 h-3" />
                            Trigger L2 & Pre-Assign
                          </button>
                        );
                      })()}
                    </div>
                  </div>
                )}

                {/* Execution Stage Action Buttons */}
                {(() => {
                  const currentStage = getOperationalStageIndex(activeJob.status, activeJob.trailerDetached);
                  const stages: Array<{
                    stageNum: number;
                    label: string;
                    variant?: 'default' | 'amber' | 'emerald';
                    onClick: () => void;
                  }> = [
                    {
                      stageNum: 1,
                      label: '1. Gated In Port',
                      onClick: () => handleUpdateStatus('AT_PORT'),
                    },
                    {
                      stageNum: 2,
                      label: '2. Container Loaded',
                      onClick: () => handleUpdateStatus('LOADED'),
                    },
                    {
                      stageNum: 3,
                      label: '3. In Transit (E11)',
                      onClick: () => handleUpdateStatus('IN_TRANSIT'),
                    },
                    {
                      stageNum: 4,
                      label: '4. Placed at Ramp',
                      onClick: () => {
                        setTargetStatusForEtc('PLACED_AT_RAMP');
                        setEtcModalOpen(true);
                      },
                    },
                    {
                      stageNum: 5,
                      label: '5. Detach Trailer',
                      variant: 'amber',
                      onClick: () => {
                        if (activeJob.jobPhase === 'L1' && !activeJob.etcTime) {
                          setTargetStatusForEtc('CONTAINER_DETACHED');
                          setEtcModalOpen(true);
                        } else {
                          handleUpdateStatus('CONTAINER_DETACHED', 'RAMP', true);
                        }
                      },
                    },
                    {
                      stageNum: 6,
                      label: '6. Complete & Deposit MT',
                      variant: 'emerald',
                      onClick: () => handleUpdateStatus('EMPTY_DEPOSITED', undefined, false),
                    },
                  ];

                  return (
                    <div className="pt-2">
                      <div className="text-[11px] font-bold text-[var(--text-main)] mb-2 flex items-center justify-between">
                        <span>Operational Stage Actions:</span>
                        <span className="text-[10px] text-[var(--text-muted)]">
                          {currentStage >= 6
                            ? 'Workflow completed'
                            : `Current Stage: ${currentStage}/6 · Only Stage ${currentStage + 1} is enabled`}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {stages.map((st) => {
                          const isPast = st.stageNum < currentStage;
                          const isCurrent = st.stageNum === currentStage;
                          const isNext = st.stageNum === currentStage + 1;
                          const isFuture = st.stageNum > currentStage + 1;

                          let btnClass =
                            'px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all inline-flex items-center gap-1.5 ';
                          if (isPast) {
                            btnClass +=
                              'bg-slate-500/5 border-[var(--border-subtle)] text-[var(--text-muted)] opacity-45 cursor-not-allowed line-through';
                          } else if (isCurrent) {
                            btnClass +=
                              'bg-blue-500/15 border-blue-500/50 text-blue-600 dark:text-blue-400 ring-1 ring-blue-500/30 cursor-not-allowed';
                          } else if (isNext) {
                            if (st.variant === 'amber') {
                              btnClass +=
                                'bg-amber-600 text-white border-amber-500 hover:bg-amber-500 shadow-sm cursor-pointer';
                            } else if (st.variant === 'emerald') {
                              btnClass +=
                                'bg-emerald-600 text-white border-emerald-500 hover:bg-emerald-500 shadow-sm cursor-pointer';
                            } else {
                              btnClass +=
                                'bg-blue-600 text-white border-blue-500 hover:bg-blue-500 shadow-sm cursor-pointer';
                            }
                          } else if (isFuture) {
                            btnClass +=
                              'bg-[var(--bg-main)] border-[var(--border-subtle)] text-[var(--text-muted)] opacity-35 cursor-not-allowed';
                          }

                          const tooltip = isPast
                            ? 'Completed stage (locked — cannot revert to a previous status)'
                            : isCurrent
                            ? 'Current active stage'
                            : isNext
                            ? 'Click to advance to the immediate next stage'
                            : `Locked: Complete Stage ${currentStage + 1} first`;

                          return (
                            <button
                              key={st.stageNum}
                              onClick={isNext ? st.onClick : undefined}
                              disabled={updatingStatus || !isNext}
                              title={tooltip}
                              className={btnClass}
                            >
                              {isPast && <span aria-hidden="true">✓</span>}
                              {isCurrent && <span aria-hidden="true">●</span>}
                              <span>{st.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Live Customer Tracking Link (Shareable Portal) & Automated WhatsApp/Email Milestone Alerts */}
              {activeJob.customerPortal && (
                <Panel
                  title="Live Customer Tracking Link (Shareable Portal) & Automated Milestone Alerts"
                  subtitle={`Read-only, token-secured customer portal for ${activeJob.jobCode} (${activeJob.containerNumber}) with live corridor map, 6-stage timeline, Offloading ETC & automated WhatsApp/Email notifications`}
                  icon={Share2}
                  accent="emerald"
                  actions={
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleCopyCustomerTrackingLink}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 transition-colors shadow-sm"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        {copiedTrackingLink ? 'Tracking Link Copied!' : 'Copy Shareable Link'}
                      </button>
                      <a
                        href={activeJob.customerPortal.shareablePath}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 border border-blue-500/40 text-xs font-bold text-blue-300 hover:bg-blue-600/30 transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Open Customer Portal
                      </a>
                    </div>
                  }
                >
                  <div className="space-y-3 text-xs">
                    {/* Token-Secured Shareable URL Bar */}
                    <div className="p-3 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <span className="text-[10px] uppercase tracking-wider text-emerald-400 font-bold block">
                          Zero-Login Token-Secured Customer Portal URL ({activeJob.jobCode} · {activeJob.containerNumber})
                        </span>
                        <code className="text-[11px] font-mono text-[var(--text-main)] break-all">
                          {typeof window !== 'undefined'
                            ? `${window.location.origin}${activeJob.customerPortal.shareablePath}`
                            : activeJob.customerPortal.shareablePath}
                        </code>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shrink-0">
                        HMAC-SHA256 Verified · Read-Only
                      </span>
                    </div>

                    {/* Customer WhatsApp & Email Milestone Alert Controls */}
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                      <div className="md:col-span-4">
                        <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-bold mb-1">
                          Customer WhatsApp (Milestone Alerts)
                        </label>
                        <input
                          type="text"
                          value={customerWhatsAppInput}
                          onChange={(e) => setCustomerWhatsAppInput(e.target.value)}
                          placeholder="+971 50 482 9104"
                          className="w-full px-3 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono text-xs focus:outline-none focus:border-blue-500"
                        />
                      </div>

                      <div className="md:col-span-4">
                        <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-bold mb-1">
                          Customer Email (Milestone & e-POD)
                        </label>
                        <input
                          type="email"
                          value={customerEmailInput}
                          onChange={(e) => setCustomerEmailInput(e.target.value)}
                          placeholder="operations@customer.ae"
                          className="w-full px-3 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono text-xs focus:outline-none focus:border-blue-500"
                        />
                      </div>

                      <div className="md:col-span-4 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={sendingCustomerAlert}
                          onClick={() => void handleSendCustomerMilestoneAlert(false)}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold text-xs transition-colors shadow-sm"
                        >
                          <Send className="w-3.5 h-3.5" />
                          {sendingCustomerAlert ? 'Dispatching...' : 'Send WhatsApp & Email Alert'}
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[var(--border-subtle)]">
                      <label className="inline-flex items-center gap-2 cursor-pointer text-[11px] text-[var(--text-main)] font-medium">
                        <input
                          type="checkbox"
                          checked={customerAutoAlerts}
                          onChange={(e) => {
                            setCustomerAutoAlerts(e.target.checked);
                          }}
                          className="rounded border-[var(--border-subtle)] text-emerald-500"
                        />
                        <span>
                          Auto-trigger WhatsApp & Email milestone alerts on every stage change (Gated In, Container Loaded, In Transit, Placed at Ramp, Completed)
                        </span>
                      </label>

                      {activeJob.customerPortal.lastAlertSummary && (
                        <span className="text-[10px] font-mono text-emerald-400 truncate max-w-md">
                          Last Alert: {activeJob.customerPortal.lastAlertSummary}
                        </span>
                      )}
                    </div>
                  </div>
                </Panel>
              )}

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
      )}

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

      {/* ETC Modal */}
      {etcModalOpen && activeJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3.5 border-b border-[var(--border-subtle)]">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-amber-500" />
                <h3 className="font-bold text-sm text-[var(--text-main)]">Set Offloading ETC (Leg 2 Trigger)</h3>
              </div>
              <button
                onClick={() => setEtcModalOpen(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] p-1 rounded-lg transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="py-4 space-y-4 text-xs">
              <div className="p-3.5 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] space-y-1.5">
                <div className="flex justify-between text-[var(--text-muted)]">
                  <span className="font-semibold">Container:</span>
                  <span className="font-mono font-bold text-[var(--text-main)]">{activeJob.containerNumber}</span>
                </div>
                <div className="flex justify-between text-[var(--text-muted)]">
                  <span className="font-semibold">Facility / Ramp:</span>
                  <span className="font-bold text-[var(--text-main)] text-right">{activeJob.warehouseName}</span>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-[var(--text-muted)] mb-2">
                  Estimated Offload Duration (Driver Mobile Preset):
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[1, 2, 3, 4].map((hrs) => (
                    <button
                      key={hrs}
                      type="button"
                      onClick={() => {
                        setSelectedEtcHours(hrs);
                        setCustomEtcInput('');
                      }}
                      className={`py-2.5 px-1 rounded-xl text-xs font-bold border transition-all ${
                        selectedEtcHours === hrs && !customEtcInput
                          ? 'bg-amber-500 text-slate-950 border-amber-500 shadow-sm'
                          : 'bg-[var(--bg-main)] text-[var(--text-main)] border-[var(--border-strong)] hover:border-amber-500/60'
                      }`}
                    >
                      +{hrs} {hrs === 1 ? 'Hour' : 'Hours'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-[var(--text-muted)] mb-1.5">
                  Or Custom Estimated Time of Completion:
                </label>
                <input
                  type="datetime-local"
                  value={customEtcInput}
                  onChange={(e) => setCustomEtcInput(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-main)] border border-[var(--border-strong)] text-xs font-medium text-[var(--text-main)] focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="p-3 rounded-xl bg-blue-600/10 border border-blue-500/30 text-[11px] text-blue-700 dark:text-blue-300 leading-relaxed">
                💡 When this timer expires, Fleet360&apos;s background engine will dynamically activate <strong>Leg 2 Empty Return</strong> with <strong>HIGH priority</strong> and pair it with the nearest available prime mover.
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3.5 border-t border-[var(--border-subtle)]">
              <button
                onClick={() => setEtcModalOpen(false)}
                className="px-4 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs font-bold text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const etcIso = customEtcInput
                    ? new Date(customEtcInput).toISOString()
                    : new Date(Date.now() + selectedEtcHours * 3600000).toISOString();
                  handleUpdateStatus(targetStatusForEtc, 'RAMP', targetStatusForEtc === 'CONTAINER_DETACHED', etcIso);
                  setEtcModalOpen(false);
                }}
                disabled={updatingStatus}
                className="px-4 py-2 rounded-lg bg-amber-500 text-slate-950 font-bold text-xs hover:bg-amber-400 transition-colors shadow-sm"
              >
                Confirm & Start Timer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Super Admin Drayage Configuration Modal */}
      <DrayageSuperAdminConfigModal
        open={configModalOpen}
        onClose={() => setConfigModalOpen(false)}
        config={automationConfig}
        onSaved={(updated) => {
          setAutomationConfig(updated);
          setAutoL2DispatchEnabled(updated.autoL2DispatchEnabled);
          showToast(
            'success',
            `⚙️ Drayage Policy Updated: Auto-L2 @ T-${updated.thresholdMinutes}m · Street-Turn ≤${updated.streetTurnRadiusKm}km · Weights ${updated.weightProximityPct}/${updated.weightIdlenessPct}/${updated.weightWorkloadPct}/${updated.weightAvailabilityPct}%`,
          );
          loadData();
        }}
      />
    </div>
  );
}
