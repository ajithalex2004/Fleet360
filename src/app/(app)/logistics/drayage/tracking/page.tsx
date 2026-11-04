'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  Radio, Compass, Truck, Layers,
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
  MapPin,
} from 'lucide-react';
import { KpiCard, PageHeader, Panel, StatusPill } from '@/components/ui/page-theme';
import { DrayageSuperAdminConfigModal } from '@/components/logistics/drayage/DrayageSuperAdminConfigModal';
import { usePermissions } from '@/contexts/PermissionContext';
import {
  DEFAULT_DRAYAGE_AUTOMATION_CONFIG,
  resolveOperationalMilestoneLocation,
  type DrayageAutomationConfig,
} from '@/lib/logistics/drayage-domain';
import {
  fetchDrayageWorkspaceCached,
  getCachedDrayageData,
  invalidateDrayageClientCache,
  subscribeDrayageLiveUpdates,
} from '@/lib/logistics/drayage-client-cache';
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
    customerToken?: string;
    customerShareablePath?: string;
    clientToken?: string;
    clientShareablePath?: string;
    rampToken?: string;
    rampShareablePath?: string;
    customerLinkActive?: boolean;
    clientLinkActive?: boolean;
    rampLinkActive?: boolean;
    jobCode: string;
    containerNumber: string;
    customerName: string;
    customerWhatsApp: string;
    customerEmail: string;
    clientName?: string;
    clientWhatsApp?: string;
    clientEmail?: string;
    rampContactName?: string;
    rampWhatsApp?: string;
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
  location?: string;
}

function formatTimelineDateTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const datePart = d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const timePart = d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${datePart}, ${timePart}`;
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

function getOperationalStageIndex(status: string, trailerDetached?: boolean, isL2?: boolean): number {
  const s = (status || '').toUpperCase();
  if (isL2) {
    if (['EMPTY_DEPOSITED', 'CONTAINER_DROPPED', 'CONTAINER_DELIVERED', 'COMPLETED', 'STREET_TURNED'].includes(s)) {
      return 5;
    }
    if (s === 'UNDER_INSPECTION') {
      return 4;
    }
    if (['AT_PORT', 'ARRIVED_AT_PORT', 'EMPTY_AT_PORT'].includes(s)) {
      return 3;
    }
    if (['IN_TRANSIT', 'EN_ROUTE_TERMINAL', 'EN_ROUTE_WAREHOUSE'].includes(s)) {
      return 2;
    }
    if (['LOADED', 'CONTAINER_PICKED', 'TRAILER_ATTACHED'].includes(s)) {
      return 1;
    }
    return 0;
  }
  if (['EMPTY_DEPOSITED', 'CONTAINER_DROPPED', 'CONTAINER_DELIVERED', 'COMPLETED', 'STREET_TURNED'].includes(s)) {
    return 6;
  }
  if (
    [
      'CONTAINER_DETACHED',
      'TRAILER_DETACHED',
      'REASSIGN_TRAILER_DETACHED',
      'READY_FOR_PICKUP',
      'CONTAINER_OFFLOADED',
      'FCL_REASSIGN',
      'MT_REASSIGN',
      'WAITING_MT_RETURN',
    ].includes(s)
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
  const { user } = usePermissions();
  const isSuperAdmin = user?.roleCode === 'SUPER_ADMIN';
  const [loading, setLoading] = useState(true);
  const [showUrgentDemurrage, setShowUrgentDemurrage] = useState(false);
  const [jobs, setJobs] = useState<DrayageJob[]>([]);
  const [statusLogs, setStatusLogs] = useState<StatusLog[]>([]);
  const [messages, setMessages] = useState<DispatchMessage[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [terminals, setTerminals] = useState<DrayageCorridorTerminal[]>([]);
  const [warehouses, setWarehouses] = useState<DrayageCorridorWarehouse[]>([]);
  const [geofences, setGeofences] = useState<DrayageCorridorGeofence[]>([]);
  const [vehicles, setVehicles] = useState<DrayageCorridorVehicle[]>([]);
  const [drivers, setDrivers] = useState<Array<{ id: string; fullName: string; employeeId?: string | null; licenseNumber?: string | null }>>([]);
  const [viewMode, setViewMode] = useState<'SPLIT' | 'RADAR' | 'CONSOLE'>('SPLIT');

  // EDI verification state
  const [ediLoading, setEdiLoading] = useState(false);
  const [ediResult, setEdiResult] = useState<EdiVerification | null>(null);

  // Multi-leg modal state
  const [showLegModal, setShowLegModal] = useState(false);
  const [legType, setLegType] = useState('CUSTOMS_INSPECTION');
  const [legPickup, setLegPickup] = useState('');
  const [legDropoff, setLegDropoff] = useState('');
  const [legRate, setLegRate] = useState(0);
  const [submittingLeg, setSubmittingLeg] = useState(false);

  // Chat input
  const [chatInput, setChatInput] = useState('');
  const [chatUrgent, setChatUrgent] = useState(false);
  const [chatBroadcast, setChatBroadcast] = useState(false);
  const [sendingChat, setSendingChat] = useState(false);

  // Status updating
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [etcModalOpen, setEtcModalOpen] = useState(false);
  const [targetStatusForEtc, setTargetStatusForEtc] = useState<'PLACED_AT_RAMP' | 'CONTAINER_DETACHED'>('PLACED_AT_RAMP');
  const [selectedEtcHours, setSelectedEtcHours] = useState(3);
  const [customEtcInput, setCustomEtcInput] = useState('');
  const [automationConfig, setAutomationConfig] = useState<DrayageAutomationConfig>(DEFAULT_DRAYAGE_AUTOMATION_CONFIG);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [customerWhatsAppInput, setCustomerWhatsAppInput] = useState('');
  const [customerEmailInput, setCustomerEmailInput] = useState('');
  const [customerAutoAlerts, setCustomerAutoAlerts] = useState(true);
  const [sendingCustomerAlert, setSendingCustomerAlert] = useState(false);
  const [copiedTrackingLink, setCopiedTrackingLink] = useState(false);
  const [nowTickMs, setNowTickMs] = useState(() => Date.now());
  const alertedEtcJobsRef = useRef<Record<string, 'T15' | 'EXPIRED'>>({});

  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4500);
  };

  const loadData = useCallback(async (forceFreshInput?: boolean | unknown) => {
    const forceFresh = typeof forceFreshInput === 'boolean' ? forceFreshInput : true;
    try {
      if (!getCachedDrayageData()?.jobs) {
        setLoading(true);
      }
      const data = await fetchDrayageWorkspaceCached({ forceFresh });
      const allJobs: DrayageJob[] = data.jobs || [];
      setJobs(allJobs);
      setStatusLogs(data.statusLogs || []);
      setMessages(data.messages || []);
      setTerminals(data.terminals || []);
      setWarehouses(data.warehouses || []);
      setGeofences(data.geofences || []);
      setVehicles(data.vehicles || []);
      setDrivers(data.drivers || []);
      if (data.automationConfig) {
        setAutomationConfig({
          ...DEFAULT_DRAYAGE_AUTOMATION_CONFIG,
          ...data.automationConfig,
        });
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
    const timer = setInterval(async () => {
      const now = Date.now();
      setNowTickMs(now);

      let hasExpiredEtcJob = false;
      for (const j of jobs) {
        if (j.jobPhase !== 'L1' || j.l2Activated || j.status === 'COMPLETED') continue;
        const st = (j.status || '').toUpperCase();
        const etcMs = j.etcTime ? new Date(j.etcTime).getTime() : null;
        const minsLeft = etcMs !== null && !isNaN(etcMs) ? Math.ceil((etcMs - now) / 60000) : null;

        if (minsLeft !== null && minsLeft <= 0) {
          hasExpiredEtcJob = true;
          if (alertedEtcJobsRef.current[j.id] !== 'EXPIRED') {
            alertedEtcJobsRef.current[j.id] = 'EXPIRED';
            showToast(
              'error',
              `🚨 ETC EXPIRED — Reassign / Action Required for ${j.jobCode} (${j.containerNumber}) at ${j.warehouseName}!`,
            );
          }
        } else if (minsLeft !== null && minsLeft > 0 && minsLeft <= 15) {
          if (!alertedEtcJobsRef.current[j.id]) {
            alertedEtcJobsRef.current[j.id] = 'T15';
            showToast(
              'error',
              `⏳ T-15M REASSIGN ALERT: ${j.jobCode} (${j.containerNumber}) at ${j.warehouseName} has ${minsLeft}m remaining before ETC expiry!`,
            );
          }
        } else if (st === 'READY_FOR_PICKUP' || st === 'CONTAINER_OFFLOADED') {
          hasExpiredEtcJob = true;
        }
      }

      if (hasExpiredEtcJob) {
        try {
          const res = await fetch('/api/logistics/drayage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'check_etc_timers',
              thresholdMinutes: 0,
              preAssignTractor: false,
            }),
          });
          if (res.ok) {
            const checkRes = await res.json();
            if (Array.isArray(checkRes.activated) && checkRes.activated.length > 0) {
              const first = checkRes.activated[0];
              showToast(
                'success',
                `⚡ L2 Empty Return ${first.l2JobCode} automatically triggered upon ETC completion!`,
              );
              await loadData();
            } else if (Array.isArray(checkRes.reassigned) && checkRes.reassigned.length > 0) {
              const firstReassign = checkRes.reassigned[0];
              showToast(
                'error',
                `🚨 ETC Expired for ${firstReassign.jobCode} — Transitioned to ${firstReassign.newStatus} for Dispatcher Reassign!`,
              );
              await loadData();
            }
          }
        } catch {
          // Silent background poll
        }
      }
    }, 15000);
    return () => clearInterval(timer);
  }, [jobs, loadData]);

  useEffect(() => {
    loadData(false);
    const unsubscribe = subscribeDrayageLiveUpdates((data) => {
      if (!data) return;
      setJobs(data.jobs || []);
      setStatusLogs(data.statusLogs || []);
      setMessages(data.messages || []);
      setTerminals(data.terminals || []);
      setWarehouses(data.warehouses || []);
      setGeofences(data.geofences || []);
      setVehicles(data.vehicles || []);
      setDrivers(data.drivers || []);
    });
    return () => unsubscribe();
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

  const handleCopyRoleTrackingLink = (role: 'CUSTOMER' | 'CLIENT' | 'RAMP' = 'CUSTOMER') => {
    if (!activeJob?.customerPortal || typeof window === 'undefined') return;
    const cp = activeJob.customerPortal;
    if ((role === 'CUSTOMER' || role === 'CLIENT') && cp.customerLinkActive === false) {
      showToast(
        'error',
        `${role === 'CLIENT' ? 'Client' : 'Customer'} Link only activates upon Vehicle & Driver Assignment (ASSIGNED status).`,
      );
      return;
    }
    if (role === 'RAMP' && !cp.rampLinkActive) {
      showToast('error', 'Ramp Link only activates once the container reaches PLACED_AT_RAMP status.');
      return;
    }
    const path =
      role === 'RAMP'
        ? cp.rampShareablePath || cp.shareablePath
        : role === 'CLIENT'
        ? cp.clientShareablePath || cp.shareablePath
        : cp.customerShareablePath || cp.shareablePath;
    const fullUrl = `${window.location.origin}${path}`;
    navigator.clipboard.writeText(fullUrl);
    setCopiedTrackingLink(true);
    showToast(
      'success',
      `Copied ${role} Portal Link for ${activeJob.jobCode} (${activeJob.containerNumber})`,
    );
    setTimeout(() => setCopiedTrackingLink(false), 3000);
  };


  const handleSendCustomerMilestoneAlert = async (
    savePrefsOnly = false,
    targetRole: 'CUSTOMER' | 'CLIENT' | 'RAMP' = 'CUSTOMER',
  ) => {
    if (!activeJob) return;
    const cp = activeJob.customerPortal;
    if (!savePrefsOnly) {
      if ((targetRole === 'CUSTOMER' || targetRole === 'CLIENT') && cp?.customerLinkActive === false) {
        showToast(
          'error',
          `${targetRole === 'CLIENT' ? 'Client' : 'Customer'} Link only activates upon Vehicle & Driver Assignment (ASSIGNED status).`,
        );
        return;
      }
      if (targetRole === 'RAMP' && !cp?.rampLinkActive) {
        showToast('error', 'Ramp Link only activates once the container reaches PLACED_AT_RAMP status.');
        return;
      }
    }
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
            targetRole,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to send milestone alert');
        showToast(
          'success',
          `📲 Sent ${targetRole} Link via WhatsApp (${data.whatsappTo || 'N/A'}) & Email (${data.emailTo || 'N/A'})!`,
        );
      } else {
        showToast('success', 'Saved Customer/Client/Ramp milestone notification settings.');
      }
      await loadData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error sending milestone alert');
    } finally {
      setSendingCustomerAlert(false);
    }
  };

  const jobLogs = useMemo(() => {
    if (!activeJob) return [];
    const rawForJob = statusLogs.filter((l) => l.jobId === activeJob.id || l.jobCode === activeJob.jobCode);
    const directStatuses = new Set(
      rawForJob
        .filter((l) => !/^MILESTONE_ALERT_/i.test(l.status))
        .map((l) => l.status.toUpperCase()),
    );
    const seenMilestoneFallback = new Set<string>();
    const assignedDriver = drivers.find(
      (d) =>
        Boolean(
          activeJob.assignedDriverName &&
            d.fullName.trim().toLowerCase() === activeJob.assignedDriverName.trim().toLowerCase(),
        ),
    );
    const driverStageSet = new Set([
      'ACCEPTED',
      'CONTAINER_PICKED',
      'TRAILER_ATTACHED',
      'ARRIVED_AT_PORT',
      'AT_PORT',
      'UNDER_INSPECTION',
      'EN_ROUTE_WAREHOUSE',
      'EN_ROUTE_TERMINAL',
      'IN_TRANSIT',
      'PLACED_AT_RAMP',
      'PLACED_AT_YARD',
      'TRAILER_DETACHED',
      'CONTAINER_DETACHED',
      'CONTAINER_DROPPED',
      'EMPTY_DEPOSITED',
      'COMPLETED',
      'EPOD_SIGNED',
      'DRIVER_EXPENSE_RECEIPT',
    ]);
    const systemActorSet = new Set([
      'dispatcher',
      'customer alert engine (whatsapp + email)',
      'dispatch console',
      'dispatcher console',
      'port operations desk',
      'auto-l2 dispatch engine (t-30m)',
    ]);

    return rawForJob
      .filter((l) => {
        if (!/^MILESTONE_ALERT_/i.test(l.status)) return true;
        const cleanSt = l.status.replace(/^MILESTONE_ALERT_/i, '').toUpperCase();
        if (directStatuses.has(cleanSt)) return false;
        if (seenMilestoneFallback.has(cleanSt)) return false;
        seenMilestoneFallback.add(cleanSt);
        return true;
      })
      .map((l) => {
        const cleanStatus = l.status.replace(/^MILESTONE_ALERT_/i, '');
        const cleanNotes = (l.notes || '')
          .replace(/\[(?:CUSTOMER|CLIENT|RAMP)\s+Alert[^\]]*\](\s*\+\s*\[Email[^\]]*\])?/gi, '')
          .replace(/·?\s*Milestone\s+"[^"]*"/gi, '')
          .replace(/·?\s*ETC\s+[^·]+(?=\s*·|$)/gi, '')
          .replace(/·?\s*(?:Customer|Client|Ramp)\s+Link[^·]*/gi, '')
          .replace(/^Execution stage updated to [A-Z0-9_-]+(?:\s*\((?:RAMP|YARD)\))?/i, '')
          .replace(/\s*·?\s*\[LOC:[^\]]+\]/gi, '')
          .replace(/^\s*[·\-|]+\s*/, '')
          .replace(/\s*[·\-|]+\s*$/, '')
          .trim();

        const matchedTerm = terminals.find(
          (t) => t.name.trim().toLowerCase() === activeJob.terminalName.trim().toLowerCase(),
        );
        const matchedWh = warehouses.find(
          (w) => w.name.trim().toLowerCase() === activeJob.warehouseName.trim().toLowerCase(),
        );
        const resolvedLocation =
          l.location ||
          resolveOperationalMilestoneLocation({
            status: cleanStatus,
            rawNotes: l.notes,
            jobPhase: activeJob.jobPhase,
            jobCode: activeJob.jobCode,
            terminalName: activeJob.terminalName,
            warehouseName: activeJob.warehouseName,
            termLat: matchedTerm?.lat,
            termLng: matchedTerm?.lng,
            whLat: matchedWh?.lat,
            whLng: matchedWh?.lng,
          });

        const rawActor = (l.actor || '').trim();
        const baseActor = rawActor.replace(/\s*\([^)]*\)\s*$/, '').trim();
        const matchedDrv =
          drivers.find((d) => d.fullName.trim().toLowerCase() === baseActor.toLowerCase()) ||
          assignedDriver;
        let displayActor = rawActor;
        if (driverStageSet.has(cleanStatus.toUpperCase()) || drivers.some((d) => d.fullName.trim().toLowerCase() === baseActor.toLowerCase())) {
          const drvName =
            matchedDrv?.fullName ||
            (baseActor && !systemActorSet.has(baseActor.toLowerCase()) ? baseActor : activeJob.assignedDriverName || 'Driver');
          const empId = matchedDrv?.employeeId || matchedDrv?.licenseNumber || null;
          displayActor = empId && !rawActor.includes(`(${empId})`) ? `${drvName} (${empId})` : rawActor || drvName;
        } else if (!rawActor || systemActorSet.has(rawActor.toLowerCase())) {
          displayActor = user?.username || rawActor || 'dispatcher';
        }

        return {
          ...l,
          status: cleanStatus,
          notes: cleanNotes,
          actor: displayActor,
          location: resolvedLocation,
        };
      });
  }, [statusLogs, activeJob, drivers, terminals, warehouses, user?.username]);

  const jobMessages = useMemo(() => {
    if (!activeJob) return [];
    return messages.filter(
      (m) =>
        m.jobId === activeJob.id ||
        m.jobCode === activeJob.jobCode ||
        m.jobId === 'BROADCAST' ||
        m.jobCode === 'BROADCAST',
    );
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
          actor: user?.username || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update stage status');
      const finalStatus =
        data.status ||
        (['CONTAINER_DROPPED', 'EMPTY_DEPOSITED', 'CONTAINER_DELIVERED'].includes(newStatus.toUpperCase())
          ? 'COMPLETED'
          : newStatus);
      showToast('success', `Job transitioned to ${finalStatus}`);
      await loadData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error updating stage');
    } finally {
      setUpdatingStatus(false);
    }
  };

  // Extend ETC timer
  const handleExtendEtc = async (minutesToAdd: number, targetJobId?: string) => {
    const jobIdToExtend = targetJobId || activeJob?.id;
    if (!jobIdToExtend) return;
    try {
      setUpdatingStatus(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'extend_etc',
          jobId: jobIdToExtend,
          minutesToAdd,
          actor: user?.username || 'dispatcher',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to extend ETC');
      delete alertedEtcJobsRef.current[jobIdToExtend];
      showToast('success', `ETC extended by +${minutesToAdd}m (New ETC: ${new Date(data.etcTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`);
      await loadData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error extending ETC');
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
        body: JSON.stringify({
          action: 'activate_l2',
          l1JobId: activeJob.id,
          preAssignTractor: false,
          triggerSource: 'MANUAL_DISPATCH',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to activate L2 empty return');
      showToast(
        'success',
        `L2 Empty Return ${data.l2JobCode} activated for assignment!`,
      );
      await loadData();
      if (data.l2JobId) setSelectedJobId(data.l2JobId);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error activating L2');
    } finally {
      setUpdatingStatus(false);
    }
  };

  // Dispatcher Reassign & Offload ETC Alerts (@ T-15m and Upon Expiry)
  const reassignEtcAlerts = useMemo(() => {
    const items: Array<{
      job: DrayageJob;
      alertLevel: 'EXPIRED' | 'T15_WARNING';
      minsLeft: number | null;
      isYardReassign: boolean;
    }> = [];
    for (const j of jobs) {
      if (j.jobPhase !== 'L1' || j.l2Activated) continue;
      const st = (j.status || '').toUpperCase();
      if (['COMPLETED', 'EMPTY_DEPOSITED', 'CONTAINER_DROPPED', 'STREET_TURNED', 'CANCELLED'].includes(st)) {
        continue;
      }
      const isReassignStatus = st === 'FCL_REASSIGN' || st === 'MT_REASSIGN';
      const etcMs = j.etcTime ? new Date(j.etcTime).getTime() : null;
      const minsLeft = etcMs !== null && !isNaN(etcMs) ? Math.ceil((etcMs - nowTickMs) / 60000) : null;
      const isYardReassign =
        isReassignStatus ||
        (j.placementLocation || '').toUpperCase() === 'YARD' ||
        st === 'PLACED_AT_YARD' ||
        st === 'REASSIGN_PLACED_AT_YARD';

      if (isReassignStatus || (minsLeft !== null && minsLeft <= 0)) {
        items.push({
          job: j,
          alertLevel: 'EXPIRED',
          minsLeft,
          isYardReassign,
        });
      } else if (minsLeft !== null && minsLeft > 0 && minsLeft <= 15) {
        items.push({
          job: j,
          alertLevel: 'T15_WARNING',
          minsLeft,
          isYardReassign,
        });
      }
    }
    return items.sort((a, b) => {
      if (a.alertLevel !== b.alertLevel) return a.alertLevel === 'EXPIRED' ? -1 : 1;
      return (a.minsLeft ?? 0) - (b.minsLeft ?? 0);
    });
  }, [jobs, nowTickMs]);

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

  // Send Dispatch Chat Message (Individual Driver/Job or Broadcast to All Active Drivers)
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeJob || !chatInput.trim()) return;
    const wasBroadcast = chatBroadcast;
    try {
      setSendingChat(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send_dispatch_message',
          jobId: wasBroadcast ? 'BROADCAST' : activeJob.id,
          senderRole: 'DISPATCHER',
          senderName: 'Port Operations Desk',
          message: chatInput.trim(),
          isUrgent: chatUrgent,
          isBroadcast: wasBroadcast,
        }),
      });
      if (!res.ok) throw new Error('Failed to send message');
      setChatInput('');
      setChatUrgent(false);
      setChatBroadcast(false);
      showToast(
        'success',
        wasBroadcast
          ? '📢 Broadcast notification sent to ALL active drivers!'
          : `💬 Message sent to ${activeJob.assignedDriverName || 'Assigned Driver'} (${activeJob.jobCode})`,
      );
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
            {isSuperAdmin && (
            <button
              type="button"
              onClick={() => setConfigModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 dark:bg-slate-800 border border-slate-700 text-xs font-bold text-white hover:bg-slate-800 transition-colors shadow-sm"
              title="Open Super Admin Drayage Engine Configuration (4-Factor Weights, Reassign T-15m Alert, Street-Turn Radius, Demurrage Thresholds)"
            >
              <Settings className="w-3.5 h-3.5 text-sky-400" />
              Engine Config
            </button>
            )}

            <button
              type="button"
              onClick={() => setShowUrgentDemurrage((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-sm ${
                showUrgentDemurrage
                  ? 'bg-rose-600 text-white shadow-rose-500/20'
                  : 'bg-[var(--bg-surface)] border border-rose-500/40 text-rose-400 hover:bg-rose-500/10'
              }`}
              title="Click to show or hide Urgent Demurrage & Port Slot Risk Intelligence"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Urgent Demurrage Alert</span>
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

      {/* Dispatcher Reassign & Offload ETC Alert Banner (@ T-15m & Upon Expiry) */}
      {reassignEtcAlerts.length > 0 && (
        <div
          className={`rounded-2xl border p-4 shadow-lg transition-all ${
            reassignEtcAlerts.some((a) => a.alertLevel === 'EXPIRED')
              ? 'bg-rose-950/35 border-rose-500/50 shadow-rose-500/10'
              : 'bg-amber-950/35 border-amber-500/50 shadow-amber-500/10'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-3 border-b border-[var(--border-subtle)]">
            <div className="flex flex-wrap items-center gap-2.5">
              <div
                className={`w-8 h-8 rounded-xl flex items-center justify-center border ${
                  reassignEtcAlerts.some((a) => a.alertLevel === 'EXPIRED')
                    ? 'bg-rose-500/20 border-rose-500/40 text-rose-400'
                    : 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                }`}
              >
                <AlertTriangle className="w-4 h-4 animate-pulse" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-black uppercase tracking-wider text-[var(--text-main)]">
                    Dispatcher Reassign &amp; Offload ETC Alert Center
                  </span>
                  {reassignEtcAlerts.filter((a) => a.alertLevel === 'EXPIRED').length > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-500 text-white animate-pulse">
                      🚨 {reassignEtcAlerts.filter((a) => a.alertLevel === 'EXPIRED').length} EXPIRED · REASSIGN NOW
                    </span>
                  )}
                  {reassignEtcAlerts.filter((a) => a.alertLevel === 'T15_WARNING').length > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-500 text-slate-950 animate-pulse">
                      ⏳ {reassignEtcAlerts.filter((a) => a.alertLevel === 'T15_WARNING').length} AT T-15M THRESHOLD
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                  Proactive Dispatcher alerts fire at <strong>T-15 minutes</strong> before Offloading / Yard ETC and immediately <strong>Upon Expiry</strong> so tractors can be reassigned without delay.
                </p>
              </div>
            </div>
            <Link
              href="/logistics/drayage/assignment"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-sm transition-colors"
            >
              <Truck className="w-3.5 h-3.5" />
              <span>Open Assignment &amp; Reassign Queue</span>
              <ExternalLink className="w-3 h-3" />
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {reassignEtcAlerts.map(({ job, alertLevel, minsLeft, isYardReassign }) => {
              const isExpired = alertLevel === 'EXPIRED';
              const isSelected = activeJob?.id === job.id;
              return (
                <div
                  key={job.id}
                  onClick={() => setSelectedJobId(job.id)}
                  className={`p-3 rounded-xl border cursor-pointer transition-all flex flex-col justify-between gap-2.5 ${
                    isExpired
                      ? 'bg-rose-500/10 border-rose-500/40 hover:border-rose-400'
                      : 'bg-amber-500/10 border-amber-500/40 hover:border-amber-400'
                  } ${isSelected ? 'ring-2 ring-blue-500' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                            isExpired
                              ? 'bg-rose-500 text-white animate-pulse'
                              : 'bg-amber-500 text-slate-950'
                          }`}
                        >
                          {isExpired
                            ? '🚨 ETC EXPIRED · REASSIGN DUE'
                            : `⏳ T-15M ALERT (${minsLeft}m left)`}
                        </span>
                        <span className="font-mono font-bold text-xs text-[var(--text-main)]">
                          {job.jobCode}
                        </span>
                        <span className="font-mono text-xs font-semibold text-blue-400">
                          {job.containerNumber} ({job.containerSize})
                        </span>
                        <StatusPill status={job.status.toLowerCase()} label={job.status} />
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)] mt-1">
                        <strong className="text-[var(--text-main)]">{job.warehouseName}</strong> ({job.placementLocation || (isYardReassign ? 'YARD' : 'RAMP')}) · Customer: {job.customerName}
                      </div>
                      <div className="text-[11px] mt-0.5">
                        {job.etcTime ? (
                          <span className={isExpired ? 'text-rose-300 font-bold' : 'text-amber-300 font-bold'}>
                            ETC: {new Date(job.etcTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            {' · '}
                            {isExpired
                              ? minsLeft !== null && minsLeft < 0
                                ? `Expired ${Math.abs(minsLeft)}m ago — Reassign tractor now (FCL_REASSIGN / MT_REASSIGN)`
                                : `Timer Expired — Reassign tractor now (FCL_REASSIGN / MT_REASSIGN)`
                              : `Approaching expiry in ${minsLeft} minute(s) — Prepare tractor reassignment`}
                          </span>
                        ) : (
                          <span className="text-rose-300 font-bold">
                            Status {job.status} — Immediate Tractor Reassignment Required
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div
                    className="flex flex-wrap items-center justify-end gap-1.5 pt-2 border-t border-[var(--border-subtle)]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedJobId(job.id)}
                      className="px-2.5 py-1 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[11px] font-semibold text-[var(--text-main)] hover:border-blue-500/50 transition-colors"
                    >
                      Inspect Job
                    </button>
                    <button
                      type="button"
                      disabled={updatingStatus}
                      onClick={() => handleExtendEtc(30, job.id)}
                      className="px-2.5 py-1 rounded-lg bg-[var(--bg-surface)] border border-amber-500/40 text-[11px] font-bold text-amber-400 hover:bg-amber-500/15 transition-colors"
                      title="Extend ETC by +30 minutes"
                    >
                      +30m ETC
                    </button>
                    <button
                      type="button"
                      disabled={updatingStatus}
                      onClick={() => handleExtendEtc(60, job.id)}
                      className="px-2.5 py-1 rounded-lg bg-[var(--bg-surface)] border border-amber-500/40 text-[11px] font-bold text-amber-400 hover:bg-amber-500/15 transition-colors"
                      title="Extend ETC by +1 hour"
                    >
                      +1h ETC
                    </button>
                    <Link
                      href="/logistics/drayage/assignment"
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                        isExpired
                          ? 'bg-rose-500 hover:bg-rose-400 text-white shadow-sm'
                          : 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-sm'
                      }`}
                    >
                      <Truck className="w-3 h-3" />
                      <span>Reassign Tractor</span>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
              const jobSt = (job.status || '').toUpperCase();
              const jobEtcMs = job.etcTime ? new Date(job.etcTime).getTime() : null;
              const jobMinsLeft =
                jobEtcMs !== null && !isNaN(jobEtcMs) ? Math.ceil((jobEtcMs - nowTickMs) / 60000) : null;
              const isJobEtcExpired =
                job.jobPhase === 'L1' &&
                !job.l2Activated &&
                jobSt !== 'COMPLETED' &&
                (jobSt === 'FCL_REASSIGN' || jobSt === 'MT_REASSIGN' || (jobMinsLeft !== null && jobMinsLeft <= 0));
              const isJobEtcT15 =
                job.jobPhase === 'L1' &&
                !job.l2Activated &&
                jobSt !== 'COMPLETED' &&
                !isJobEtcExpired &&
                jobMinsLeft !== null &&
                jobMinsLeft > 0 &&
                jobMinsLeft <= 15;

              return (
                <div
                  key={job.id}
                  onClick={() => setSelectedJobId(job.id)}
                  className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                    selected
                      ? 'bg-blue-600/10 border-blue-500 text-[var(--text-main)] shadow-sm'
                      : isJobEtcExpired
                      ? 'bg-rose-500/10 border-rose-500/50 hover:border-rose-400'
                      : isJobEtcT15
                      ? 'bg-amber-500/10 border-amber-500/50 hover:border-amber-400'
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

                  {(isJobEtcExpired || isJobEtcT15) && (
                    <div className="mb-1.5">
                      {isJobEtcExpired ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse">
                          🚨 ETC EXPIRED · REASSIGN REQUIRED
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse">
                          ⏳ REASSIGN ALERT @ T-{jobMinsLeft}M
                        </span>
                      )}
                    </div>
                  )}

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
                          disabled={activeJob.customerPortal.customerLinkActive === false}
                          onClick={() => handleCopyRoleTrackingLink('CUSTOMER')}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-xs font-bold text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          title={
                            activeJob.customerPortal.customerLinkActive === false
                              ? 'Customer Link activates upon Vehicle & Driver Assignment (ASSIGNED status)'
                              : 'Copy Customer (Consignor/Shipper) Tracking Link'
                          }
                        >
                          <Copy className="w-3.5 h-3.5" />
                          {copiedTrackingLink ? 'Copied!' : 'Customer Link'}
                        </button>
                        <button
                          type="button"
                          disabled={activeJob.customerPortal.clientLinkActive === false}
                          onClick={() => handleCopyRoleTrackingLink('CLIENT')}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/40 text-xs font-bold text-cyan-400 hover:bg-cyan-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          title={
                            activeJob.customerPortal.clientLinkActive === false
                              ? 'Client Link activates upon Vehicle & Driver Assignment (ASSIGNED status)'
                              : 'Copy Client (Consignee/End User) Tracking Link'
                          }
                        >
                          <Copy className="w-3.5 h-3.5" />
                          Client Link
                        </button>
                        <button
                          type="button"
                          disabled={!activeJob.customerPortal.rampLinkActive}
                          onClick={() => handleCopyRoleTrackingLink('RAMP')}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/40 text-xs font-bold text-amber-400 hover:bg-amber-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          title={
                            !activeJob.customerPortal.rampLinkActive
                              ? 'Ramp Link activates only upon PLACED_AT_RAMP status'
                              : 'Copy Ramp Supervisor Stuffing/Destuffing Link'
                          }
                        >
                          <Copy className="w-3.5 h-3.5" />
                          Ramp Link
                        </button>
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
                      const isInitialYardDrop =
                        activeJob.placementLocation === 'YARD' &&
                        ['PLACED_AT_YARD', 'FCL_REASSIGN', 'MT_REASSIGN'].includes(
                          (activeJob.status || '').toUpperCase(),
                        );
                      const canTriggerL2 = currentStage >= 4 && !isInitialYardDrop;
                      return (
                        <button
                          onClick={handleTriggerL2}
                          disabled={updatingStatus || !canTriggerL2}
                          title={
                            canTriggerL2
                              ? 'Activate L2 Empty Return job now'
                              : 'Locked: Requires container Placed at Ramp, Ready for Pickup, or Reassigned'
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
                    DEMURRAGE, DETENTION & PORT SLOT RISK INTELLIGENCE PANEL (Shown on clicking Urgent Demurrage Alert)
                    ========================================================================= */}
                {showUrgentDemurrage && (
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
                )}

                {/* Offloading & Reassign ETC Countdown & Dispatcher Alert Management (@ T-15m & Upon Expiry) */}
                {activeJob.jobPhase === 'L1' &&
                  (activeJob.etcTime ||
                    activeJob.placementLocation === 'RAMP' ||
                    activeJob.placementLocation === 'YARD' ||
                    ['PLACED_AT_RAMP', 'PLACED_AT_YARD', 'FCL_REASSIGN', 'MT_REASSIGN', 'REASSIGN_PLACED_AT_RAMP'].includes(
                      (activeJob.status || '').toUpperCase(),
                    ) ||
                    activeJob.trailerDetached) && (() => {
                    const activeSt = (activeJob.status || '').toUpperCase();
                    const activeEtcMs = activeJob.etcTime ? new Date(activeJob.etcTime).getTime() : null;
                    const activeMinsLeft =
                      activeEtcMs !== null && !isNaN(activeEtcMs)
                        ? Math.ceil((activeEtcMs - nowTickMs) / 60000)
                        : null;
                    const isEtcExpired =
                      activeSt === 'FCL_REASSIGN' ||
                      activeSt === 'MT_REASSIGN' ||
                      (activeMinsLeft !== null && activeMinsLeft <= 0);
                    const isEtcT15 =
                      !isEtcExpired && activeMinsLeft !== null && activeMinsLeft > 0 && activeMinsLeft <= 15;
                    const isYardPlacement =
                      activeJob.placementLocation === 'YARD' ||
                      ['PLACED_AT_YARD', 'FCL_REASSIGN', 'MT_REASSIGN'].includes(activeSt);

                    return (
                      <div
                        className={`p-3.5 rounded-xl border flex flex-wrap items-center justify-between gap-3 transition-all ${
                          isEtcExpired
                            ? 'bg-rose-500/15 border-rose-500/50'
                            : isEtcT15
                            ? 'bg-amber-500/15 border-amber-500/50'
                            : 'bg-amber-500/10 border-amber-500/30'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`w-8 h-8 rounded-lg border flex items-center justify-center ${
                              isEtcExpired
                                ? 'bg-rose-500/20 border-rose-500/40 text-rose-400'
                                : 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                            }`}
                          >
                            <Clock className="w-4 h-4 animate-pulse" />
                          </div>
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`text-xs font-bold ${
                                  isEtcExpired ? 'text-rose-300' : 'text-amber-400'
                                }`}
                              >
                                Destuffing, Yard &amp; Reassign Timer (ETC)
                              </span>
                              {isEtcExpired ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-black bg-rose-500 text-white animate-pulse">
                                  🚨 ETC EXPIRED — REASSIGN TRACTOR REQUIRED
                                </span>
                              ) : isEtcT15 ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-black bg-amber-500 text-slate-950 animate-pulse">
                                  ⏳ T-15M DISPATCHER ALERT ({activeMinsLeft}m remaining) · PREPARE REASSIGN
                                </span>
                              ) : activeJob.etcTime ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                  ⏳ ACTIVE TIMER ({activeMinsLeft}m left)
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-500/20 text-slate-400">
                                  NO ETC SET
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                              {activeJob.etcTime ? (
                                <>
                                  Expected Completion:{' '}
                                  <strong className="text-[var(--text-main)] font-mono">
                                    {new Date(activeJob.etcTime).toLocaleTimeString([], {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </strong>
                                  {' · '}
                                  <span
                                    className={
                                      isEtcExpired
                                        ? 'text-rose-400 font-bold'
                                        : isEtcT15
                                        ? 'text-amber-300 font-bold'
                                        : 'text-amber-400 font-semibold'
                                    }
                                  >
                                    {isEtcExpired
                                      ? 'Offloading / Yard timer expired — Dispatcher Reassign required (FCL_REASSIGN / MT_REASSIGN)'
                                      : `${activeMinsLeft} mins remaining`}
                                  </span>
                                  {' · '}
                                  <span className="text-sky-400 font-medium">
                                    Alerts Dispatcher @ T-15m &amp; Upon Expiry
                                  </span>
                                </>
                              ) : (
                                'Set ETC timer from console or driver app — Dispatcher will be alerted at T-15m and upon expiry'
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {!activeJob.l2Activated && (
                            <>
                              <button
                                onClick={async () => {
                                  const t14Iso = new Date(Date.now() + 14 * 60 * 1000).toISOString();
                                  delete alertedEtcJobsRef.current[activeJob.id];
                                  await handleUpdateStatus(
                                    activeJob.status === 'IN_TRANSIT' ? 'PLACED_AT_RAMP' : activeJob.status,
                                    activeJob.placementLocation || 'RAMP',
                                    activeJob.trailerDetached,
                                    t14Iso,
                                  );
                                  showToast(
                                    'error',
                                    `⏳ T-15M REASSIGN ALERT: ${activeJob.jobCode} (${activeJob.containerNumber}) is within 15 minutes of ETC expiry!`,
                                  );
                                }}
                                disabled={updatingStatus}
                                className="px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 hover:bg-amber-500/25 text-xs font-bold transition-colors"
                                title="Set ETC to T-14 mins to test the T-15m Dispatcher Reassign Alert"
                              >
                                ⏳ Test T-15m Alert
                              </button>
                              <button
                                onClick={async () => {
                                  const expIso = new Date(Date.now() - 60 * 1000).toISOString();
                                  delete alertedEtcJobsRef.current[activeJob.id];
                                  await handleUpdateStatus(
                                    activeJob.shipmentType === 'EXPORT' ? 'MT_REASSIGN' : 'FCL_REASSIGN',
                                    activeJob.placementLocation || 'RAMP',
                                    true,
                                    expIso,
                                  );
                                  showToast(
                                    'error',
                                    `🚨 ETC EXPIRED — Reassign Required for ${activeJob.jobCode} (${activeJob.containerNumber})!`,
                                  );
                                }}
                                disabled={updatingStatus}
                                className="px-2.5 py-1 rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-300 hover:bg-rose-500/25 text-xs font-bold transition-colors"
                                title="Simulate ETC Expiry now to trigger the Expired Reassign Alert"
                              >
                                🚨 Test Expiry Alert
                              </button>
                            </>
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
                          {(isEtcExpired || isYardPlacement) ? (
                            <Link
                              href="/logistics/drayage/assignment"
                              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-500 hover:bg-rose-400 text-white font-bold text-xs transition-colors shadow-sm"
                              title="Open Assignment Queue to Reassign a Tractor for this container"
                            >
                              <Truck className="w-3 h-3" />
                              <span>Reassign Tractor</span>
                            </Link>
                          ) : (
                            !activeJob.l2Activated && (() => {
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
                                      : 'Requires container Placed at Ramp with Offloading ETC set'
                                  }
                                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg font-bold text-xs transition-colors shadow-sm ${
                                    canTriggerL2
                                      ? 'bg-amber-500 text-slate-950 hover:bg-amber-400 cursor-pointer'
                                      : 'bg-slate-500/20 text-[var(--text-muted)] opacity-50 cursor-not-allowed'
                                  }`}
                                >
                                  <RefreshCw className="w-3 h-3" />
                                  Trigger L2 Empty Return
                                </button>
                              );
                            })()
                          )}
                        </div>
                      </div>
                    );
                  })()}

                {/* Execution Stage Action Buttons */}
                {(() => {
                  const isL2Job = activeJob.jobPhase === 'L2' || activeJob.jobCode.includes('-L2');
                  const currentStage = getOperationalStageIndex(
                    activeJob.status,
                    activeJob.trailerDetached,
                    isL2Job,
                  );
                  const stages: Array<{
                    stageNum: number;
                    label: string;
                    variant?: 'default' | 'amber' | 'emerald';
                    onClick: () => void;
                  }> = isL2Job
                    ? [
                        {
                          stageNum: 1,
                          label: '1. Container Picked (Warehouse)',
                          onClick: () => handleUpdateStatus('CONTAINER_PICKED'),
                        },
                        {
                          stageNum: 2,
                          label: '2. En Route to Terminal',
                          onClick: () => handleUpdateStatus('EN_ROUTE_TERMINAL'),
                        },
                        {
                          stageNum: 3,
                          label: '3. Arrived at Port',
                          onClick: () => handleUpdateStatus('ARRIVED_AT_PORT'),
                        },
                        {
                          stageNum: 4,
                          label: '4. Under Inspection',
                          onClick: () => handleUpdateStatus('UNDER_INSPECTION'),
                        },
                        {
                          stageNum: 5,
                          label: '5. Container Dropped (Complete L2)',
                          variant: 'emerald',
                          onClick: () => handleUpdateStatus('CONTAINER_DROPPED', undefined, true),
                        },
                      ]
                    : [
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
                              'bg-blue-700 text-white border-blue-800 shadow-sm cursor-default';
                          } else if (isNext) {
                            btnClass +=
                              'bg-amber-100 hover:bg-amber-200 text-amber-900 border-amber-300 dark:bg-amber-400/20 dark:hover:bg-amber-400/30 dark:text-amber-200 dark:border-amber-400/50 shadow-sm cursor-pointer';
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

              {/* Role-Scoped Stakeholder Links (Customer, Client, Ramp) & Automated Milestone Alerts */}
              {activeJob.customerPortal && (
                <Panel
                  title="Role-Scoped Stakeholder Links (Customer, Client & Ramp) & Automated Alerts"
                  icon={Share2}
                  accent="emerald"
                  actions={
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border whitespace-nowrap ${
                          activeJob.customerPortal.customerLinkActive !== false
                            ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                            : 'bg-amber-500/15 border-amber-500/40 text-amber-400'
                        }`}
                      >
                        {activeJob.customerPortal.customerLinkActive !== false
                          ? '✓ Customer & Client Active'
                          : '⏳ Assign Vehicle & Driver'}
                      </span>
                      <span
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border whitespace-nowrap ${
                          activeJob.customerPortal.rampLinkActive
                            ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                            : 'bg-[var(--bg-main)] border-[var(--border-subtle)] text-[var(--text-muted)]'
                        }`}
                      >
                        {activeJob.customerPortal.rampLinkActive
                          ? '✓ Ramp Link Active'
                          : '🔒 Ramp @ PLACED_AT_RAMP'}
                      </span>
                    </div>
                  }
                >
                  <div className="space-y-3.5 text-xs">
                    {/* 3 Role-Scoped Shareable Links Grid */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                      {/* 1. Customer Link (Consignor / Shipper) */}
                      <div className="p-3.5 rounded-xl bg-[var(--bg-main)] border border-emerald-500/30 flex flex-col justify-between gap-2.5 overflow-hidden">
                        <div className="min-w-0">
                          <div className="flex items-start justify-between gap-2 mb-1.5">
                            <div className="min-w-0">
                              <div className="text-[11px] uppercase tracking-wider text-emerald-400 font-bold truncate">
                                1. Customer Link
                              </div>
                              <div className="text-[10px] text-[var(--text-muted)] font-medium">
                                Consignor / Shipper
                              </div>
                            </div>
                            <span
                              className={`shrink-0 whitespace-nowrap px-2 py-0.5 rounded-md text-[9px] font-bold border ${
                                activeJob.customerPortal.customerLinkActive !== false
                                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                                  : 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                              }`}
                            >
                              {activeJob.customerPortal.customerLinkActive !== false
                                ? '✓ ACTIVE'
                                : '🔒 NEEDS ASSIGNED'}
                            </span>
                          </div>
                          <p className="text-[11px] text-[var(--text-muted)] mb-2 line-clamp-2 min-h-[2rem]">
                            Read-only live map, 6-stage milestones & signed ePOD for {activeJob.customerName}.
                          </p>
                          <code
                            title={
                              typeof window !== 'undefined'
                                ? `${window.location.origin}${activeJob.customerPortal.customerShareablePath || activeJob.customerPortal.shareablePath}`
                                : activeJob.customerPortal.customerShareablePath || activeJob.customerPortal.shareablePath
                            }
                            className="text-[11px] font-mono text-[var(--text-main)] truncate block bg-black/20 border border-[var(--border-subtle)] px-2.5 py-1.5 rounded-lg"
                          >
                            {typeof window !== 'undefined'
                              ? `${window.location.origin}${activeJob.customerPortal.customerShareablePath || activeJob.customerPortal.shareablePath}`
                              : activeJob.customerPortal.customerShareablePath || activeJob.customerPortal.shareablePath}
                          </code>
                        </div>
                        <div className="flex items-center gap-2 pt-0.5">
                          <button
                            type="button"
                            disabled={activeJob.customerPortal.customerLinkActive === false}
                            onClick={() => handleCopyRoleTrackingLink('CUSTOMER')}
                            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] font-bold transition-colors whitespace-nowrap"
                          >
                            <Copy className="w-3 h-3 shrink-0" />
                            Copy Short Link
                          </button>
                          <a
                            href={
                              activeJob.customerPortal.customerLinkActive === false
                                ? undefined
                                : activeJob.customerPortal.customerShareablePath || activeJob.customerPortal.shareablePath
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => {
                              if (activeJob.customerPortal?.customerLinkActive === false) {
                                e.preventDefault();
                                showToast('error', 'Customer Link only activates upon Vehicle & Driver Assignment.');
                              }
                            }}
                            className={`inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold whitespace-nowrap ${
                              activeJob.customerPortal.customerLinkActive === false
                                ? 'opacity-40 cursor-not-allowed'
                                : 'hover:bg-emerald-500/25'
                            }`}
                          >
                            <ExternalLink className="w-3 h-3 shrink-0" />
                            Open
                          </a>
                        </div>
                      </div>

                      {/* 2. Client Link (Consignee / End User) */}
                      <div className="p-3.5 rounded-xl bg-[var(--bg-main)] border border-cyan-500/30 flex flex-col justify-between gap-2.5 overflow-hidden">
                        <div className="min-w-0">
                          <div className="flex items-start justify-between gap-2 mb-1.5">
                            <div className="min-w-0">
                              <div className="text-[11px] uppercase tracking-wider text-cyan-400 font-bold truncate">
                                2. Client Link
                              </div>
                              <div className="text-[10px] text-[var(--text-muted)] font-medium">
                                Consignee / End User
                              </div>
                            </div>
                            <span
                              className={`shrink-0 whitespace-nowrap px-2 py-0.5 rounded-md text-[9px] font-bold border ${
                                activeJob.customerPortal.clientLinkActive !== false
                                  ? 'bg-cyan-500/15 border-cyan-500/30 text-cyan-300'
                                  : 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                              }`}
                            >
                              {activeJob.customerPortal.clientLinkActive !== false
                                ? '✓ ACTIVE'
                                : '🔒 NEEDS ASSIGNED'}
                            </span>
                          </div>
                          <p className="text-[11px] text-[var(--text-muted)] mb-2 line-clamp-2 min-h-[2rem]">
                            Live ETA, milestones, ePOD & destination visibility for {activeJob.customerPortal.clientName || activeJob.warehouseName}.
                          </p>
                          <code
                            title={
                              typeof window !== 'undefined'
                                ? `${window.location.origin}${activeJob.customerPortal.clientShareablePath || activeJob.customerPortal.shareablePath}`
                                : activeJob.customerPortal.clientShareablePath || activeJob.customerPortal.shareablePath
                            }
                            className="text-[11px] font-mono text-[var(--text-main)] truncate block bg-black/20 border border-[var(--border-subtle)] px-2.5 py-1.5 rounded-lg"
                          >
                            {typeof window !== 'undefined'
                              ? `${window.location.origin}${activeJob.customerPortal.clientShareablePath || activeJob.customerPortal.shareablePath}`
                              : activeJob.customerPortal.clientShareablePath || activeJob.customerPortal.shareablePath}
                          </code>
                        </div>
                        <div className="flex items-center gap-2 pt-0.5">
                          <button
                            type="button"
                            disabled={activeJob.customerPortal.clientLinkActive === false}
                            onClick={() => handleCopyRoleTrackingLink('CLIENT')}
                            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] font-bold transition-colors whitespace-nowrap"
                          >
                            <Copy className="w-3 h-3 shrink-0" />
                            Copy Short Link
                          </button>
                          <a
                            href={
                              activeJob.customerPortal.clientLinkActive === false
                                ? undefined
                                : activeJob.customerPortal.clientShareablePath || activeJob.customerPortal.shareablePath
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => {
                              if (activeJob.customerPortal?.clientLinkActive === false) {
                                e.preventDefault();
                                showToast('error', 'Client Link only activates upon Vehicle & Driver Assignment.');
                              }
                            }}
                            className={`inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 text-[11px] font-bold whitespace-nowrap ${
                              activeJob.customerPortal.clientLinkActive === false
                                ? 'opacity-40 cursor-not-allowed'
                                : 'hover:bg-cyan-500/25'
                            }`}
                          >
                            <ExternalLink className="w-3 h-3 shrink-0" />
                            Open
                          </a>
                        </div>
                      </div>

                      {/* 3. Ramp Link (Stuffing / Destuffing Completion) */}
                      <div className="p-3.5 rounded-xl bg-[var(--bg-main)] border border-amber-500/30 flex flex-col justify-between gap-2.5 overflow-hidden">
                        <div className="min-w-0">
                          <div className="flex items-start justify-between gap-2 mb-1.5">
                            <div className="min-w-0">
                              <div className="text-[11px] uppercase tracking-wider text-amber-400 font-bold truncate">
                                3. Ramp Link
                              </div>
                              <div className="text-[10px] text-[var(--text-muted)] font-medium">
                                Stuffing / Destuffing
                              </div>
                            </div>
                            <span
                              className={`shrink-0 whitespace-nowrap px-2 py-0.5 rounded-md text-[9px] font-bold border ${
                                activeJob.customerPortal.rampLinkActive
                                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                                  : 'bg-slate-500/15 border-[var(--border-subtle)] text-[var(--text-muted)]'
                              }`}
                            >
                              {activeJob.customerPortal.rampLinkActive
                                ? '✓ ACTIVE'
                                : '🔒 AT RAMP'}
                            </span>
                          </div>
                          <p className="text-[11px] text-[var(--text-muted)] mb-2 line-clamp-2 min-h-[2rem]">
                            Dock supervisor link to confirm Stuffing/Destuffing completion at {activeJob.warehouseName}.
                          </p>
                          <code
                            title={
                              typeof window !== 'undefined'
                                ? `${window.location.origin}${activeJob.customerPortal.rampShareablePath || activeJob.customerPortal.shareablePath}`
                                : activeJob.customerPortal.rampShareablePath || activeJob.customerPortal.shareablePath
                            }
                            className="text-[11px] font-mono text-[var(--text-main)] truncate block bg-black/20 border border-[var(--border-subtle)] px-2.5 py-1.5 rounded-lg"
                          >
                            {typeof window !== 'undefined'
                              ? `${window.location.origin}${activeJob.customerPortal.rampShareablePath || activeJob.customerPortal.shareablePath}`
                              : activeJob.customerPortal.rampShareablePath || activeJob.customerPortal.shareablePath}
                          </code>
                        </div>
                        <div className="flex items-center gap-2 pt-0.5">
                          <button
                            type="button"
                            disabled={!activeJob.customerPortal.rampLinkActive}
                            onClick={() => handleCopyRoleTrackingLink('RAMP')}
                            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] font-bold transition-colors whitespace-nowrap"
                          >
                            <Copy className="w-3 h-3 shrink-0" />
                            Copy Short Link
                          </button>
                          <a
                            href={
                              !activeJob.customerPortal.rampLinkActive
                                ? undefined
                                : activeJob.customerPortal.rampShareablePath || activeJob.customerPortal.shareablePath
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => {
                              if (!activeJob.customerPortal?.rampLinkActive) {
                                e.preventDefault();
                                showToast('error', 'Ramp Link only activates once the container reaches PLACED_AT_RAMP status.');
                              }
                            }}
                            className={`inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 text-[11px] font-bold whitespace-nowrap ${
                              !activeJob.customerPortal.rampLinkActive
                                ? 'opacity-40 cursor-not-allowed'
                                : 'hover:bg-amber-500/25'
                            }`}
                          >
                            <ExternalLink className="w-3 h-3 shrink-0" />
                            Open
                          </a>
                        </div>
                      </div>
                    </div>

                    {/* Customer / Client / Ramp WhatsApp & Email Milestone Alert Controls */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end pt-1">
                      <div className="lg:col-span-3">
                        <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-bold mb-1">
                          Recipient WhatsApp
                        </label>
                        <input
                          type="text"
                          value={customerWhatsAppInput}
                          onChange={(e) => setCustomerWhatsAppInput(e.target.value)}
                          placeholder="+971 50 482 9104"
                          className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono text-xs focus:outline-none focus:border-blue-500"
                        />
                      </div>

                      <div className="lg:col-span-3">
                        <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-bold mb-1">
                          Recipient Email
                        </label>
                        <input
                          type="email"
                          value={customerEmailInput}
                          onChange={(e) => setCustomerEmailInput(e.target.value)}
                          placeholder="operations@customer.ae"
                          className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono text-xs focus:outline-none focus:border-blue-500"
                        />
                      </div>

                      <div className="lg:col-span-6 grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <button
                          type="button"
                          disabled={sendingCustomerAlert || activeJob.customerPortal.customerLinkActive === false}
                          onClick={() => void handleSendCustomerMilestoneAlert(false, 'CUSTOMER')}
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold text-[11px] transition-colors shadow-sm whitespace-nowrap"
                        >
                          <Send className="w-3 h-3 shrink-0" />
                          Send Customer Link
                        </button>
                        <button
                          type="button"
                          disabled={sendingCustomerAlert || activeJob.customerPortal.clientLinkActive === false}
                          onClick={() => void handleSendCustomerMilestoneAlert(false, 'CLIENT')}
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white font-bold text-[11px] transition-colors shadow-sm whitespace-nowrap"
                        >
                          <Send className="w-3 h-3 shrink-0" />
                          Send Client Link
                        </button>
                        <button
                          type="button"
                          disabled={sendingCustomerAlert || !activeJob.customerPortal.rampLinkActive}
                          onClick={() => void handleSendCustomerMilestoneAlert(false, 'RAMP')}
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white font-bold text-[11px] transition-colors shadow-sm whitespace-nowrap"
                        >
                          <Send className="w-3 h-3 shrink-0" />
                          Send Ramp Link
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--border-subtle)]">
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
                          Auto-activate & send Customer/Client links upon Vehicle & Driver Assignment, and Ramp Link upon PLACED_AT_RAMP
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

              {/* Chat & Status Logs Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Dispatcher <-> Driver Chat */}
                <Panel
                  title="Dispatcher ↔ Driver Communications"
                  subtitle="Real-time instructions & fleet broadcast channel"
                  icon={MessageSquare}
                  accent="blue"
                >
                  <div className="flex flex-col h-[340px]">
                    {/* Clean recipient & job context strip */}
                    <div
                      className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 mb-3 rounded-lg border text-xs ${
                        chatBroadcast
                          ? 'bg-amber-500/10 border-amber-500/30 text-amber-500'
                          : 'bg-blue-500/10 border-blue-500/25 text-[var(--text-main)]'
                      }`}
                    >
                      {chatBroadcast ? (
                        <span className="font-semibold flex items-center gap-1.5">
                          <span>📢</span>
                          <span>Broadcasting to All Active Drivers in Fleet</span>
                        </span>
                      ) : (
                        <>
                          <span className="font-semibold truncate">
                            👤 Driver: {activeJob.assignedDriverName || 'Unassigned'}
                            {activeJob.assignedVehiclePlate ? ` (${activeJob.assignedVehiclePlate})` : ''}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-blue-600 text-white font-mono text-[11px] font-bold shrink-0">
                            {activeJob.jobCode}
                          </span>
                        </>
                      )}
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                      {jobMessages.length === 0 ? (
                        <div className="py-10 text-center text-xs text-[var(--text-muted)]">
                          No dispatch messages on {activeJob.jobCode} ({activeJob.assignedDriverName || 'Unassigned'}) yet. Send an individual instruction or toggle Broadcast below.
                        </div>
                      ) : (
                        jobMessages.map((msg) => {
                          const isDriver = msg.senderRole === 'DRIVER';
                          const isBroadcastMsg = msg.jobId === 'BROADCAST' || msg.jobCode === 'BROADCAST';
                          return (
                            <div
                              key={msg.id}
                              className={`p-3 rounded-xl text-xs max-w-[88%] space-y-1.5 ${
                                isDriver
                                  ? 'bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] mr-auto'
                                  : isBroadcastMsg
                                  ? 'bg-amber-500/10 border border-amber-500/30 text-[var(--text-main)] ml-auto'
                                  : 'bg-blue-500/10 border border-blue-500/30 text-[var(--text-main)] ml-auto'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-3 text-[10px] text-[var(--text-muted)]">
                                <strong className="text-[11px] font-bold text-[var(--text-main)]">{msg.senderName}</strong>
                                <span className="font-mono shrink-0">{formatTimelineDateTime(msg.createdAt)}</span>
                              </div>
                              <p className="leading-relaxed text-[var(--text-main)] break-words">{msg.message}</p>
                              {(isBroadcastMsg || msg.isUrgent) && (
                                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                                  {isBroadcastMsg && (
                                    <span className="inline-block px-2 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-500 border border-amber-500/30">
                                      📢 BROADCAST TO ALL DRIVERS
                                    </span>
                                  )}
                                  {msg.isUrgent && (
                                    <span className="inline-block px-2 py-0.5 rounded text-[9px] font-bold bg-rose-500/20 text-rose-500 border border-rose-500/30">
                                      🚨 URGENT
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>

                    <form onSubmit={handleSendMessage} className="pt-3 mt-2 border-t border-[var(--border-subtle)] space-y-2.5">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          placeholder={
                            chatBroadcast
                              ? '📢 Type broadcast notification to ALL active drivers...'
                              : `Message ${activeJob.assignedDriverName || 'driver'} on ${activeJob.jobCode}...`
                          }
                          className="flex-1 min-w-0 text-xs px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                        />
                        <button
                          type="submit"
                          disabled={sendingChat || !chatInput.trim()}
                          className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-white text-xs font-semibold transition-colors disabled:opacity-50 shrink-0 ${
                            chatBroadcast ? 'bg-amber-600 hover:bg-amber-500' : 'bg-blue-600 hover:bg-blue-500'
                          }`}
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>Send</span>
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <label className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={chatUrgent}
                            onChange={(e) => setChatUrgent(e.target.checked)}
                            className="rounded border-[var(--border-subtle)] text-rose-600"
                          />
                          <span>Flag as URGENT instruction</span>
                        </label>

                        <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-amber-500 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={chatBroadcast}
                            onChange={(e) => setChatBroadcast(e.target.checked)}
                            className="rounded border-amber-500/40 text-amber-600"
                          />
                          <span>📢 Broadcast to All Active Drivers</span>
                        </label>
                      </div>
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
                  <div className="h-[340px] overflow-y-auto space-y-3 pr-1">
                    {jobLogs.length === 0 ? (
                      <div className="py-12 text-center text-xs text-[var(--text-muted)]">
                        No audit events recorded yet.
                      </div>
                    ) : (
                      jobLogs.map((log) => (
                        <div key={log.id} className="flex items-start gap-2.5 text-xs">
                          <div className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                          <div className="space-y-0.5 min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-[var(--text-main)] font-mono text-[11px]">{log.status}</span>
                              <span className="text-[10px] text-[var(--text-muted)] font-mono">
                                {formatTimelineDateTime(log.timestamp)} · {log.actor}
                              </span>
                            </div>
                            {log.location ? (
                              <div className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
                                <MapPin className="w-3 h-3 text-blue-400 shrink-0" />
                                <span className="truncate">{log.location}</span>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </Panel>
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
          showToast(
            'success',
            `⚙️ Drayage Policy Updated: Street-Turn ≤${updated.streetTurnRadiusKm}km · Weights ${updated.weightProximityPct}/${updated.weightIdlenessPct}/${updated.weightWorkloadPct}/${updated.weightAvailabilityPct}%`,
          );
          loadData();
        }}
      />
    </div>
  );
}
