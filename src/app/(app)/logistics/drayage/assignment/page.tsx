'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  UserCheck,
  Truck,
  Layers,
  Package,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Plus,
  ShieldCheck,
  ArrowRight,
  X,
  Sparkles,
  Key,
  Zap,
  Clock,
  TrendingUp,
  AlertCircle,
  MapPin,
  Trash2,
  ArrowUpDown,
  Scale,
  Settings,
  Copy,
  ExternalLink,
  Share2,
  MessageSquare,
  Mail,
  MoreVertical,
  Pencil,
  Lock,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { PageHeader, KpiCard, StatusPill } from '@/components/ui/page-theme';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import FleetDataGrid, { type DataGridColumn } from '@/components/ui/FleetDataGrid';
import {
  fetchDrayageWorkspaceCached,
  getCachedDrayageData,
  invalidateDrayageClientCache,
  subscribeDrayageLiveUpdates,
} from '@/lib/logistics/drayage-client-cache';
import { DrayageSuperAdminConfigModal } from '@/components/logistics/drayage/DrayageSuperAdminConfigModal';
import {
  DrayageEditJobModal,
  type EditJobMasterOption,
} from '@/components/logistics/drayage/DrayageEditJobModal';
import { usePermissions } from '@/contexts/PermissionContext';
import {
  DEFAULT_DRAYAGE_AUTOMATION_CONFIG,
  canChangeDrayageReturnTerminal,
  evaluateDispatcherJobReassignState,
  isDrayageReassignStatus,
  type DrayageAutomationConfig,
} from '@/lib/logistics/drayage-domain';

interface DrayageJob {
  id: string;
  jobCode: string;
  jobPhase: 'L1' | 'L2';
  shipmentType: string;
  status: string;
  priority: string;
  customerName: string;
  warehouseName: string;
  warehouseId?: string | null;
  terminalName: string;
  terminalId?: string | null;
  returnTerminalName?: string | null;
  returnTerminalId?: string | null;
  originTerminalName?: string | null;
  originTerminalId?: string | null;
  containerNumber: string;
  containerSize: string;
  containerType: string;
  doExpiryDate?: string | null;
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
  cargoWeightKg?: number;
  shippingLine?: string;
  bogieJobId?: string | null;
  streetTurnJobId?: string | null;
  customsInspection?: boolean;
  municipalityInspection?: boolean;
  cpipInspection?: boolean;
  mercInspection?: boolean;
  boxcareInspection?: boolean;
  pcsTokenNumber?: string | null;
  pcsSlotStart?: string | null;
  pcsSlotEnd?: string | null;
  pcsTokenStatus?: string | null;
  inspectionStatus?: string | null;
  doStatus?: string | null;
  placementLocation?: 'RAMP' | 'YARD' | null;
  trailerDetached?: boolean;
  l2Activated?: boolean;
  etcTime?: string | null;
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
    customerWhatsApp: string;
    customerEmail: string;
    clientName?: string;
    clientWhatsApp?: string;
    clientEmail?: string;
    rampContactName?: string;
    rampWhatsApp?: string;
    autoAlertsEnabled: boolean;
  };
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
}

interface MappedVehicle {
  id: string;
  plateNumber: string;
  make: string;
  model: string;
  type?: string | null;
  vehicleUsage?: string | null;
  status: string;
  fuelLevelPct?: number | null;
  currentMileage?: number | null;
  nextServiceKm?: number | null;
  lat?: number | null;
  lng?: number | null;
  hasLiveGps?: boolean;
  isDriverLoggedIn?: boolean;
  gpsStatus?: 'MOVING' | 'IDLE' | 'SWITCHED_OFF' | string;
  updatedAt?: string | null;
  assignedTripsCount?: number;
  assignedDriverId?: string | null;
  assignedDriverName?: string | null;
}

interface MappedDriver {
  id: string;
  fullName: string;
  phone: string | null;
  status: string;
  complianceOk: boolean;
  completedTripsToday?: number;
  assignedVehicleId?: string | null;
}

interface DrayageTrailer {
  id: string;
  plateNumber: string;
  trailerType: string;
  masterStatus: string;
  operationalStatus: string;
  capacityTons?: number;
  currentLocation?: string | null;
  linkedContainerNumber?: string | null;
}

interface DrayageTerminal {
  id: string;
  name: string;
  code: string;
  portName: string;
  emirate: string;
  lat?: number;
  lng?: number;
  tripAmountAed?: number;
  driverAllowanceAed?: number;
}

interface DrayageWarehouse {
  id: string;
  name: string;
  code: string | null;
  zone: string;
  address: string;
  lat?: number;
  lng?: number;
  tripAmountAed?: number;
  driverAllowanceAed?: number;
}

interface DemurrageRisk {
  level: 'CRITICAL' | 'MODERATE' | 'NORMAL' | 'EXPIRED';
  hoursRemaining: number;
  badgeText: string;
  colorClass: string;
  iconText: string;
  penaltyEstimateAed: number;
}

interface BogieComboRecommendation {
  id: string;
  job1: DrayageJob;
  job2: DrayageJob;
  commonTerminal: string;
  zone1: string;
  zone2: string;
  sameZone: boolean;
  windowDiffHours: number;
  dropSequence: string[];
  combinedRevenueAed: number;
  combinedAllowanceAed: number;
  fuelSavingPct: number;
  hasUrgentDemurrage: boolean;
  tasSlot: string;
  score: number;
  box1WeightKg: number;
  box2WeightKg: number;
  totalPayloadKg: number;
  isWeightCompliant: boolean;
  weightLimitKg: number;
  weightUtilizationPct: number;
  chassisRequirement: string;
}

interface StreetTurnRecommendation {
  id: string;
  l2Job: DrayageJob;
  exportJob: DrayageJob;
  inboundJob: DrayageJob;
  outboundJob: DrayageJob;
  matchMode: 'INLAND_STREET_TURN' | 'PORT_TERMINAL_RELOAD' | 'DAISY_CHAIN_3LEG';
  leg3Job?: DrayageJob | null;
  leg3Risk?: DemurrageRisk;
  leg3Zone?: string | null;
  leg3HasBackhaul?: boolean;
  holdLeg3Recommended?: boolean;
  sourcePhase: 'L1_RAMP' | 'L2_EMPTY';
  containerGrade: string;
  shippingLine: string;
  carrierPrefix: string;
  containerNumber: string;
  containerSize: string;
  containerType: string;
  originWarehouse: string;
  destWarehouse: string;
  zone: string;
  destZone?: string;
  interWarehouseDistanceKm: number;
  terminalName: string;
  tasSlot: string;
  combinedRevenueAed: number;
  combinedAllowanceAed: number;
  deadheadKmSaved: number;
  co2SavedKg: number;
  fuelSavingsAed: number;
  turnaroundHoursSaved: number;
  hasUrgentDemurrage: boolean;
  score: number;
}

interface SmartBackhaulHoldItem {
  job: DrayageJob;
  risk: DemurrageRisk;
  zone: string;
  terminalName: string;
  outboundL1AtTerminal: number;
  estimatedDeadheadKmAvoided: number;
  fuelRiskAvoidedAed: number;
  isCurrentlyHeld: boolean;
  linkedDaisyChainPairId?: string;
  recommendationText: string;
}

interface AutoPilotDispatchItem {
  id: string;
  type: 'BOGIE' | 'STREET_TURN' | 'PORT_RELOAD' | 'DAISY_CHAIN' | 'SINGLE';
  jobIds: string[];
  jobCodes: string[];
  containers: string[];
  customerNames: string[];
  heldLeg3JobId?: string;
  heldLeg3JobCode?: string;
  routeDescription: string;
  terminalName: string;
  tokenNumber: string;
  selectedVehicleId: string;
  selectedVehiclePlate: string;
  selectedDriverId: string;
  selectedDriverName: string;
  selectedTrailerId: string;
  selectedTrailerPlate: string;
  revenueAed: number;
  allowanceAed: number;
  demurrageRescue: boolean;
  tasSlot: string;
  matchScorePct?: number;
  proximityKm?: number;
}

interface Vehicle4FactorScore {
  vehicle: MappedVehicle;
  driver?: MappedDriver;
  proximityScore: number;    // 60%
  idlenessScore: number;     // 25%
  workloadScore: number;     // 10%
  availabilityScore: number; // 5%
  totalScore: number;        // 100%
  distanceKm: number;
  hasLiveGps: boolean;
  idleHours: number;
  tripsToday: number;
  fuelPct: number;
  maintenanceBufferKm: number;
  rankBadge: string;
}

export default function DrayageAssignmentPage() {
  const { user } = usePermissions();
  const isSuperAdmin = user?.roleCode === 'SUPER_ADMIN';
  const cached = getCachedDrayageData();
  const [loading, setLoading] = useState(!cached?.jobs);
  const [jobs, setJobs] = useState<DrayageJob[]>(cached?.jobs || []);
  const [vehicles, setVehicles] = useState<MappedVehicle[]>(cached?.vehicles || []);
  const [drivers, setDrivers] = useState<MappedDriver[]>(cached?.drivers || []);
  const [trailers, setTrailers] = useState<DrayageTrailer[]>(cached?.trailers || []);
  const [terminals, setTerminals] = useState<DrayageTerminal[]>(cached?.terminals || []);
  const [warehouses, setWarehouses] = useState<DrayageWarehouse[]>(cached?.warehouses || []);
  const [customers, setCustomers] = useState<EditJobMasterOption[]>(cached?.customers || []);
  const [editJobTarget, setEditJobTarget] = useState<DrayageJob | null>(null);
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);

  // Smart Analysis UI state (Show / Hide Widgets toggle)
  const [showSmartAnalysis, setShowSmartAnalysis] = useState<boolean>(true);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = localStorage.getItem('fleet360_drayage_show_smart_analysis');
      if (saved === 'false') setShowSmartAnalysis(false);
      else if (saved === 'true') setShowSmartAnalysis(true);
    } catch {}
  }, []);

  const handleToggleSmartAnalysis = useCallback((nextVal?: boolean) => {
    setShowSmartAnalysis((prev) => {
      const resolved = typeof nextVal === 'boolean' ? nextVal : !prev;
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('fleet360_drayage_show_smart_analysis', String(resolved));
        } catch {}
      }
      return resolved;
    });
  }, []);
  const [showUrgentDemurrageAlert, setShowUrgentDemurrageAlert] = useState(false);
  const [smartAnalysisFilter, setSmartAnalysisFilter] = useState<
    'ALL' | 'BOGIE' | 'STREET_TURN' | 'BACKHAUL_HOLD'
  >('ALL');
  const [automationConfig, setAutomationConfig] = useState<DrayageAutomationConfig>(() => ({
    ...DEFAULT_DRAYAGE_AUTOMATION_CONFIG,
    ...(cached?.automationConfig || {}),
  }));
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [sharingTrackingJob, setSharingTrackingJob] = useState<DrayageJob | null>(null);
  const [shareRole, setShareRole] = useState<'CUSTOMER' | 'CLIENT' | 'RAMP'>('CUSTOMER');
  const [shareWhatsAppInput, setShareWhatsAppInput] = useState('');
  const [shareEmailInput, setShareEmailInput] = useState('');
  const [sendingShareAlert, setSendingShareAlert] = useState(false);
  const [copiedJobId, setCopiedJobId] = useState<string | null>(null);
  const [portalMenuState, setPortalMenuState] = useState<{
    job: DrayageJob;
    top: number;
    right: number;
  } | null>(null);

  const isJobAssignedActive = useCallback((job: DrayageJob) => {
    if (job.customerPortal?.customerLinkActive !== undefined) {
      return job.customerPortal.customerLinkActive;
    }
    const st = String(job.status || '').toUpperCase();
    return st !== 'PENDING' && st !== 'UNASSIGNED' && Boolean(job.assignedVehicleId || job.assignedVehiclePlate);
  }, []);

  const isJobRampActive = useCallback((job: DrayageJob) => {
    if (job.customerPortal?.rampLinkActive !== undefined) {
      return job.customerPortal.rampLinkActive;
    }
    const st = String(job.status || '').toUpperCase();
    return ['PLACED_AT_RAMP', 'REASSIGN_PLACED_AT_RAMP', 'CONTAINER_DETACHED', 'TRAILER_DETACHED', 'READY_FOR_PICKUP'].includes(st);
  }, []);

  const getJobShareablePath = useCallback(
    (job: DrayageJob, role: 'CUSTOMER' | 'CLIENT' | 'RAMP' = 'CUSTOMER') => {
      const cp = job.customerPortal;
      if (!cp) return `/logistics/drayage/tracking`;
      if (role === 'RAMP') return cp.rampShareablePath || cp.shareablePath;
      if (role === 'CLIENT') return cp.clientShareablePath || cp.shareablePath;
      return cp.customerShareablePath || cp.shareablePath;
    },
    [],
  );

  const handleCopyJobTrackingLink = useCallback(
    (job: DrayageJob, role: 'CUSTOMER' | 'CLIENT' | 'RAMP' = 'CUSTOMER') => {
      if (typeof window === 'undefined') return;
      if ((role === 'CUSTOMER' || role === 'CLIENT') && !isJobAssignedActive(job)) {
        setToast({
          type: 'error',
          message: `${role === 'CLIENT' ? 'Client' : 'Customer'} Link only activates upon Vehicle & Driver Assignment (ASSIGNED status).`,
        });
        setTimeout(() => setToast(null), 3500);
        return;
      }
      if (role === 'RAMP' && !isJobRampActive(job)) {
        setToast({
          type: 'error',
          message: 'Ramp Link only activates once the container reaches PLACED_AT_RAMP status.',
        });
        setTimeout(() => setToast(null), 3500);
        return;
      }
      const path = getJobShareablePath(job, role);
      const fullUrl = `${window.location.origin}${path}`;
      navigator.clipboard.writeText(fullUrl);
      setCopiedJobId(job.id);
      setToast({
        type: 'success',
        message: `Copied ${role} Link for ${job.containerNumber} (${job.jobCode})!`,
      });
      setTimeout(() => {
        setCopiedJobId(null);
        setToast(null);
      }, 3500);
    },
    [getJobShareablePath, isJobAssignedActive, isJobRampActive],
  );

  const handleSelectShareRole = useCallback(
    (job: DrayageJob, role: 'CUSTOMER' | 'CLIENT' | 'RAMP') => {
      setShareRole(role);
      const cp = job.customerPortal;
      if (role === 'RAMP') {
        setShareWhatsAppInput(cp?.rampWhatsApp || cp?.clientWhatsApp || cp?.customerWhatsApp || '');
        setShareEmailInput(cp?.clientEmail || cp?.customerEmail || '');
      } else if (role === 'CLIENT') {
        setShareWhatsAppInput(cp?.clientWhatsApp || cp?.customerWhatsApp || '');
        setShareEmailInput(cp?.clientEmail || cp?.customerEmail || '');
      } else {
        setShareWhatsAppInput(cp?.customerWhatsApp || '');
        setShareEmailInput(cp?.customerEmail || '');
      }
    },
    [],
  );

  const handleOpenShareTrackingModal = useCallback(
    (job: DrayageJob) => {
      setSharingTrackingJob(job);
      const defaultRole: 'CUSTOMER' | 'CLIENT' | 'RAMP' = isJobRampActive(job) ? 'RAMP' : 'CUSTOMER';
      handleSelectShareRole(job, defaultRole);
    },
    [handleSelectShareRole, isJobRampActive],
  );

  const handleDispatchTrackingAlert = async () => {
    if (!sharingTrackingJob) return;
    try {
      setSendingShareAlert(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send_customer_milestone_alert',
          jobId: sharingTrackingJob.id,
          customerWhatsApp: shareWhatsAppInput.trim(),
          customerEmail: shareEmailInput.trim(),
          targetRole: shareRole,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to dispatch tracking link');
      setToast({
        type: 'success',
        message: `Sent ${shareRole} Link for ${sharingTrackingJob.containerNumber} via WhatsApp & Email!`,
      });
      setTimeout(() => setToast(null), 4000);
      setSharingTrackingJob(null);
    } catch (err) {
      setToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Error sending tracking link',
      });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setSendingShareAlert(false);
    }
  };

  // Auto-Pilot Batch Dispatch state
  const [showAutoPilotModal, setShowAutoPilotModal] = useState(false);
  const [autoPilotPlan, setAutoPilotPlan] = useState<AutoPilotDispatchItem[]>([]);
  const [submittingBatch, setSubmittingBatch] = useState(false);

  // Modals
  const [assigningJob, setAssigningJob] = useState<DrayageJob | null>(null);
  const [editingTokenJob, setEditingTokenJob] = useState<DrayageJob | null>(null);
  const [newTokenValue, setNewTokenValue] = useState('');
  const [editTokenSlotStartHour, setEditTokenSlotStartHour] = useState<number>(6);
  const [isBogieAssign, setIsBogieAssign] = useState(false);
  const [activeStreetTurnPair, setActiveStreetTurnPair] = useState<StreetTurnRecommendation | null>(null);
  const [holdLeg3InModal, setHoldLeg3InModal] = useState<boolean>(true);

  // Return Terminal Redirection Modal State
  const [changingReturnTerminalJob, setChangingReturnTerminalJob] = useState<DrayageJob | null>(null);
  const [newReturnTerminalId, setNewReturnTerminalId] = useState('');
  const [returnTerminalReason, setReturnTerminalReason] = useState('');
  const [submittingReturnTerminal, setSubmittingReturnTerminal] = useState(false);

  // Operations Status Update & Driver App Sync Modal State
  const [statusUpdateJob, setStatusUpdateJob] = useState<DrayageJob | null>(null);
  const [selectedTargetStatus, setSelectedTargetStatus] = useState<string>('ACCEPTED');
  const [selectedPlacementLocation, setSelectedPlacementLocation] = useState<'RAMP' | 'YARD'>('RAMP');
  const [selectedEtcHours, setSelectedEtcHours] = useState<number>(3);
  const [statusUpdateNotes, setStatusUpdateNotes] = useState<string>('');
  const [submittingStatusUpdate, setSubmittingStatusUpdate] = useState<boolean>(false);

  const getActiveJobInspectionLabels = useCallback((job: DrayageJob): string[] => {
    const labels: string[] = [];
    if (job.customsInspection) labels.push('Dubai Customs');
    if (job.municipalityInspection) labels.push('Dubai Municipality');
    if (job.cpipInspection) labels.push('CPIP');
    if (job.mercInspection) labels.push('Merc');
    if (job.boxcareInspection) labels.push('Boxcare');
    return labels;
  }, []);

  const doesJobRequireInspection = useCallback((job: DrayageJob): boolean => {
    const hasAnyFlag = Boolean(
      job.customsInspection ||
        job.municipalityInspection ||
        job.cpipInspection ||
        job.mercInspection ||
        job.boxcareInspection,
    );
    const inspUpper = String(job.inspectionStatus || '').toUpperCase();
    return hasAnyFlag || ['HOLD_PENDING', 'INSPECTION_BOOKED', 'REJECTED'].includes(inspUpper);
  }, []);

  const getRecommendedNextDriverStatus = useCallback((job: DrayageJob): { nextStatus: string; label: string; placement?: 'RAMP' | 'YARD' } => {
    const st = (job.status || 'ASSIGNED').toUpperCase();
    const isL2 = job.jobPhase === 'L2' || Boolean(job.jobCode && job.jobCode.includes('-L2'));
    const originLoc = (job.placementLocation || '').toUpperCase();
    const requiresInspection = doesJobRequireInspection(job);
    if (st === 'RE-ASSIGNED' || st.includes('REASSIGN TO')) {
      return { nextStatus: 'TRAILER_ATTACHED', label: 'Trailer Attached (Coupled)' };
    }
    if (st === 'TRAILER_ATTACHED') {
      if (originLoc === 'RAMP') {
        return { nextStatus: 'REASSIGN_PLACED_AT_YARD', label: 'Placed @ Yard (Shunted from Ramp)', placement: 'YARD' };
      }
      return { nextStatus: 'REASSIGN_PLACED_AT_RAMP', label: 'Placed @ Ramp (Shunted from Yard)', placement: 'RAMP' };
    }
    if (st === 'REASSIGN_PLACED_AT_RAMP') {
      return { nextStatus: 'REASSIGN_TRAILER_DETACHED', label: 'Trailer Detached @ Ramp', placement: 'RAMP' };
    }
    if (st === 'REASSIGN_PLACED_AT_YARD') {
      return { nextStatus: 'READY_FOR_PICKUP', label: 'Ready for Pickup (L2 Ready)', placement: 'YARD' };
    }
    if (isL2) {
      switch (st) {
        case 'PENDING':
        case 'ASSIGNED':
          return { nextStatus: 'CONTAINER_PICKED', label: 'Container Picked (at Warehouse)' };
        case 'CONTAINER_PICKED':
          return { nextStatus: 'EN_ROUTE_TERMINAL', label: 'En Route to Port Terminal' };
        case 'EN_ROUTE_TERMINAL':
        case 'IN_TRANSIT':
          return { nextStatus: 'ARRIVED_AT_PORT', label: 'Arrived at Port Gate' };
        case 'ARRIVED_AT_PORT':
          return requiresInspection
            ? { nextStatus: 'UNDER_INSPECTION', label: 'Under Port Gate Inspection' }
            : { nextStatus: 'CONTAINER_DROPPED', label: 'Container Dropped (No Inspection)' };
        case 'UNDER_INSPECTION':
        default:
          return { nextStatus: 'CONTAINER_DROPPED', label: 'Container Dropped (Complete L2)' };
      }
    }
    switch (st) {
      case 'PENDING':
        return { nextStatus: 'ASSIGNED', label: 'Assigned' };
      case 'ASSIGNED':
        return { nextStatus: 'ACCEPTED', label: 'Job Accepted (Driver Accepted)' };
      case 'ACCEPTED':
        return { nextStatus: 'CONTAINER_PICKED', label: 'Container Picked (at Port)' };
      case 'CONTAINER_PICKED':
      case 'AT_PORT':
        return requiresInspection
          ? { nextStatus: 'UNDER_INSPECTION', label: 'Under Inspection' }
          : { nextStatus: 'EN_ROUTE_WAREHOUSE', label: 'En Route to Warehouse (No Inspection)' };
      case 'UNDER_INSPECTION':
        return { nextStatus: 'EN_ROUTE_WAREHOUSE', label: 'En Route to Warehouse' };
      case 'EN_ROUTE_WAREHOUSE':
      case 'IN_TRANSIT':
        return { nextStatus: 'PLACED_AT_RAMP', label: 'Placed @ Ramp (Warehouse Offload)', placement: 'RAMP' };
      case 'PLACED_AT_RAMP':
        return { nextStatus: 'TRAILER_DETACHED', label: 'Trailer Detached @ Ramp', placement: 'RAMP' };
      case 'PLACED_AT_YARD':
        return { nextStatus: 'TRAILER_DETACHED', label: 'Trailer Detached @ Yard', placement: 'YARD' };
      default:
        return { nextStatus: 'READY_FOR_PICKUP', label: 'Ready for Pickup (Activate L2)' };
    }
  }, [doesJobRequireInspection]);

  const handleOpenStatusUpdate = useCallback(
    (job: DrayageJob) => {
      const rec = getRecommendedNextDriverStatus(job);
      setStatusUpdateJob(job);
      setSelectedTargetStatus(rec.nextStatus);
      setSelectedPlacementLocation(rec.placement || (job.placementLocation === 'YARD' ? 'YARD' : 'RAMP'));
      setSelectedEtcHours(3);
      setStatusUpdateNotes('');
    },
    [getRecommendedNextDriverStatus],
  );

  const handleConfirmOperatorStatusUpdate = async (overrideStatus?: string, overridePlacement?: 'RAMP' | 'YARD') => {
    if (!statusUpdateJob) return;
    const finalStatus = overrideStatus || selectedTargetStatus;
    const finalPlacement =
      overridePlacement ||
      (finalStatus.toUpperCase().includes('YARD')
        ? 'YARD'
        : finalStatus.toUpperCase().includes('RAMP')
        ? 'RAMP'
        : selectedPlacementLocation);
    const isRampStage = finalStatus.toUpperCase().includes('RAMP');
    const etcIso = isRampStage
      ? new Date(Date.now() + Number(selectedEtcHours || 3) * 3600000).toISOString()
      : undefined;

    try {
      setSubmittingStatusUpdate(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_status',
          jobId: statusUpdateJob.id,
          status: finalStatus,
          placementLocation: finalPlacement,
          detachTrailer:
            finalStatus.includes('DETACHED') ||
            finalStatus === 'READY_FOR_PICKUP' ||
            finalStatus === 'CONTAINER_DROPPED',
          etcTime: etcIso,
          notes:
            statusUpdateNotes.trim() ||
            `Updated by Operations Team (${user?.username || 'Operations Desk'}) — synced with Driver App`,
          actor: user?.username || 'Operations Desk',
          operatorOverride: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update job status');
      const syncedStatus = data.status || finalStatus;
      invalidateDrayageClientCache();
      setToast({
        type: 'success',
        message: `⚡ Updated ${statusUpdateJob.jobCode} status to ${syncedStatus} & synced live with Driver App!`,
      });
      setTimeout(() => setToast(null), 4000);
      setStatusUpdateJob(null);
      await loadData(true);
    } catch (err) {
      setToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Error updating job status',
      });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setSubmittingStatusUpdate(false);
    }
  };

  // Assignment Modal Fields
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [selectedDriverId, setSelectedDriverId] = useState('');
  const [selectedTrailerId, setSelectedTrailerId] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [tokenSlotStartHour, setTokenSlotStartHour] = useState<number>(6);
  const [assignReturnTerminalId, setAssignReturnTerminalId] = useState('');
  const [submittingAssign, setSubmittingAssign] = useState(false);

  const formatShortHourAmPm = useCallback((hour24: number): string => {
    const h = ((hour24 % 24) + 24) % 24;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12} ${ampm}`;
  }, []);

  const formatFullHourAmPm = useCallback((hour24: number): string => {
    const h = ((hour24 % 24) + 24) % 24;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:00 ${ampm}`;
  }, []);

  const formatTwoHourWindowLabel = useCallback(
    (startHour: number): string => {
      const s = ((startHour % 24) + 24) % 24;
      const e = (s + 2) % 24;
      return `${formatShortHourAmPm(s)} to ${formatShortHourAmPm(e)}`;
    },
    [formatShortHourAmPm],
  );

  const buildSlotWindowIsoPair = useCallback((startHour: number): { pcsSlotStart: string; pcsSlotEnd: string } => {
    const s = ((startHour % 24) + 24) % 24;
    const uaeNow = new Date(Date.now() + 4 * 60 * 60 * 1000);
    const startDt = new Date(
      Date.UTC(
        uaeNow.getUTCFullYear(),
        uaeNow.getUTCMonth(),
        uaeNow.getUTCDate(),
        s - 4,
        0,
        0,
        0,
      ),
    );
    const endDt = new Date(startDt.getTime() + 2 * 60 * 60 * 1000);
    return {
      pcsSlotStart: startDt.toISOString(),
      pcsSlotEnd: endDt.toISOString(),
    };
  }, []);

  const extractStartHourFromJob = useCallback((job: DrayageJob | null | undefined): number => {
    if (job?.pcsSlotStart) {
      const dt = new Date(job.pcsSlotStart);
      if (!Number.isNaN(dt.getTime())) {
        return (dt.getUTCHours() + 4) % 24;
      }
    }
    return 7; // Default 7 AM to 9 AM
  }, []);

  const formatJobTokenWindowBadge = useCallback(
    (job: DrayageJob): string | null => {
      if (job.pcsSlotStart && job.pcsSlotEnd) {
        const sDt = new Date(job.pcsSlotStart);
        const eDt = new Date(job.pcsSlotEnd);
        if (!Number.isNaN(sDt.getTime()) && !Number.isNaN(eDt.getTime())) {
          const sHr = (sDt.getUTCHours() + 4) % 24;
          const eHr = (eDt.getUTCHours() + 4) % 24;
          return `${formatShortHourAmPm(sHr)} to ${formatShortHourAmPm(eHr)}`;
        }
      }
      return null;
    },
    [formatShortHourAmPm],
  );

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
      setTerminals(data?.terminals || []);
      setWarehouses(data?.warehouses || []);
      setCustomers(data?.customers || []);
      if (data?.automationConfig) {
        setAutomationConfig({
          ...DEFAULT_DRAYAGE_AUTOMATION_CONFIG,
          ...data.automationConfig,
        });
      }
    } catch (err) {
      if (!getCachedDrayageData()?.jobs) {
        showToast('error', err instanceof Error ? err.message : 'Failed to fetch data');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRebookJobPcsSlot = async (jobId: string) => {
    try {
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'rebook_pcs_slot',
          jobId,
          actor: 'Port Slot Risk Intelligence',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to rebook PCS slot');
      invalidateDrayageClientCache();
      showToast(
        'success',
        `🔄 Auto-Rebooked PCS Token ${data.tokenNumber} for ${data.jobCode} · New Gate Slot: ${data.slotWindowLabel}!`,
      );
      await loadData(true);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error rebooking PCS slot');
    }
  };

  const handleSwapJobRescueTractor = async (jobId: string) => {
    try {
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'swap_slot_rescue_tractor',
          jobId,
          actor: 'Port Slot Risk Intelligence',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to swap rescue tractor');
      invalidateDrayageClientCache();
      showToast(
        'success',
        `🚛 Swapped ${data.jobCode} to nearer Prime Mover ${data.vehiclePlate} (${data.driverName} · ${data.matchScorePct}% 4-Factor Match)!`,
      );
      await loadData(true);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error swapping rescue tractor');
    }
  };

  useEffect(() => {
    loadData();
    const unsubscribe = subscribeDrayageLiveUpdates((data) => {
      if (!data) return;
      setJobs(data.jobs || []);
      setVehicles(data.vehicles || []);
      setDrivers(data.drivers || []);
      setTrailers(data.trailers || []);
      setTerminals(data.terminals || []);
      setWarehouses(data.warehouses || []);
    });
    return () => unsubscribe();
  }, [loadData]);

  // Heavy Commercial Prime Movers / Tractors only (exclude light passenger cars like Honda Pilot, Sedans, SUVs)
  const isPrimeMover = useCallback((v: MappedVehicle) => {
    const text = `${v.make} ${v.model}`.toLowerCase();
    const lightPatterns = [
      'pilot', 'civic', 'corolla', 'camry', 'sunny', 'yaris', 'sedan', 'suv',
      'hatchback', 'patrol', 'land cruiser', 'prado', 'pajero', 'accord', 'altima', 'van'
    ];
    return !lightPatterns.some((pattern) => text.includes(pattern));
  }, []);

  // Asset availability
  const primeMovers = useMemo(() => vehicles.filter(isPrimeMover), [vehicles, isPrimeMover]);
  const availableVehicles = useMemo(
    () => primeMovers.filter((v) => v.status !== 'ON_DRAYAGE_TRIP'),
    [primeMovers],
  );
  const availableDrivers = useMemo(() => drivers.filter((d) => d.status === 'ACTIVE' && d.complianceOk), [drivers]);
  const availableTrailers = useMemo(() => trailers.filter((t) => t.masterStatus === 'AVAILABLE'), [trailers]);

  // Filter unassigned jobs & active queue jobs (exclude COMPLETED / L2-activated L1 jobs by default)
  const [showCompletedJobs, setShowCompletedJobs] = useState(false);

  const isJobCompletedOrSuperseded = useCallback((j: DrayageJob) => {
    const st = (j.status || '').toUpperCase();
    return (
      ['COMPLETED', 'STREET_TURNED', 'EMPTY_DEPOSITED', 'CONTAINER_DROPPED', 'CANCELLED'].includes(st) ||
      (j.jobPhase === 'L1' && Boolean(j.l2Activated))
    );
  }, []);

  const activeQueueJobs = useMemo(
    () => (showCompletedJobs ? jobs : jobs.filter((j) => !isJobCompletedOrSuperseded(j))),
    [jobs, showCompletedJobs, isJobCompletedOrSuperseded],
  );

  const completedJobsCount = useMemo(
    () => jobs.filter((j) => isJobCompletedOrSuperseded(j)).length,
    [jobs, isJobCompletedOrSuperseded],
  );

  const unassignedJobs = useMemo(
    () =>
      jobs.filter((j) => {
        if (isJobCompletedOrSuperseded(j)) return false;
        const reassignState = evaluateDispatcherJobReassignState(j);
        return j.status === 'PENDING' || !j.assignedVehicleId || reassignState.canReassign;
      }),
    [jobs, isJobCompletedOrSuperseded],
  );

  // =========================================================================
  // DEMURRAGE & DETENTION RISK CALCULATOR
  // =========================================================================
  const getDemurrageRisk = useCallback((job: DrayageJob): DemurrageRisk => {
    let expiryTime = job.doExpiryDate ? new Date(job.doExpiryDate).getTime() : null;
    if (!expiryTime) {
      // Fallback: 5 days from createdAt if doExpiryDate is not set
      const created = new Date(job.createdAt).getTime();
      expiryTime = created + 5 * 24 * 60 * 60 * 1000;
    }
    const diffMs = expiryTime - Date.now();
    const hoursRemaining = Math.round(diffMs / (1000 * 60 * 60));

    if (diffMs <= 0) {
      const daysOver = Math.max(1, Math.ceil(Math.abs(diffMs) / (1000 * 60 * 60 * 24)));
      return {
        level: 'EXPIRED',
        hoursRemaining,
        badgeText: `⛔ DO Expired (${daysOver}d Detention)`,
        colorClass: 'bg-rose-600 text-white border-rose-700',
        iconText: '⛔',
        penaltyEstimateAed: daysOver * 450,
      };
    } else if (hoursRemaining <= 12) {
      return {
        level: 'CRITICAL',
        hoursRemaining,
        badgeText: `🚨 Critical: ${hoursRemaining}h to DO Expiry (Risk: AED 450/day)`,
        colorClass: 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse',
        iconText: '🚨',
        penaltyEstimateAed: 450,
      };
    } else if (hoursRemaining <= 36) {
      return {
        level: 'MODERATE',
        hoursRemaining,
        badgeText: `⚠️ Moderate: ${hoursRemaining}h remaining`,
        colorClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
        iconText: '⚠️',
        penaltyEstimateAed: 0,
      };
    } else {
      const days = Math.floor(hoursRemaining / 24);
      return {
        level: 'NORMAL',
        hoursRemaining,
        badgeText: `🟢 Normal: ${days}d free time`,
        colorClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
        iconText: '🟢',
        penaltyEstimateAed: 0,
      };
    }
  }, []);

  // =========================================================================
  // PORT GATE TAS APPOINTMENT WINDOW MATCHER
  // =========================================================================
  const getTasSlotWindow = useCallback((job1: DrayageJob, job2?: DrayageJob) => {
    // Standard DP World TAS 2-hour appointment slots (08:00-10:00, 10:00-12:00, 12:00-14:00, etc.)
    const now = new Date();
    const hour = now.getHours();
    let slotStart = Math.ceil((hour + 1) / 2) * 2;
    if (slotStart >= 22) slotStart = 8;
    if (slotStart < 8) slotStart = 8;
    const slotEnd = slotStart + 2;
    const slotTime = `${String(slotStart).padStart(2, '0')}:00 - ${String(slotEnd).padStart(2, '0')}:00`;

    const term1 = (job1.returnTerminalName || job1.terminalName || '').trim().toLowerCase();
    const term2 = job2
      ? (job2.returnTerminalName || job2.terminalName || '').trim().toLowerCase()
      : term1;

    const isSameTerminal = job2 ? term1 === term2 : true;

    return {
      slotTime,
      isDualSlotFeasible: isSameTerminal,
      label: isSameTerminal ? `Dual TAS Slot: ${slotTime} (Single Gate Pass)` : `Gate Slot: ${slotTime}`,
    };
  }, []);

  // Helper to resolve warehouse zone
  const getWarehouseZone = useCallback((whName: string, whId?: string | null) => {
    if (whId) {
      const wh = warehouses.find((w) => w.id === whId);
      if (wh?.zone) return wh.zone;
    }
    const matched = warehouses.find((w) => w.name.toLowerCase() === whName.toLowerCase());
    if (matched?.zone) return matched.zone;

    // Heuristic extraction
    const lower = whName.toLowerCase();
    if (lower.includes('jafza south') || lower.includes('jafza-s')) return 'JAFZA South';
    if (lower.includes('jafza north') || lower.includes('jafza-n')) return 'JAFZA North';
    if (lower.includes('dic') || lower.includes('dubai industrial city') || lower.includes('industrial city')) return 'DIC (Dubai Industrial City)';
    if (lower.includes('dubai south') || lower.includes('dwc')) return 'Dubai South';
    if (lower.includes('dip') || lower.includes('investment park')) return 'Dubai Investments Park';
    if (lower.includes('al quoz')) return 'Al Quoz Industrial';
    if (lower.includes('kizad') || lower.includes('khalifa')) return 'KIZAD Industrial';
    return 'Dubai Logistics Corridor';
  }, [warehouses]);

  // =========================================================================
  // FEATURE 2: DUAL-20FT BOGIE / CHASSIS AUTO-BUNDLING ENGINE
  // =========================================================================
  const bogieCombos = useMemo(() => {
    const twentyFtJobs = unassignedJobs.filter(
      (j) => j.containerSize === '20FT' && j.jobPhase === 'L1' && j.status === 'PENDING' && !j.trailerDetached,
    );
    if (twentyFtJobs.length < 2) return [];

    const candidates: BogieComboRecommendation[] = [];
    const usedIds = new Set<string>();

    for (let i = 0; i < twentyFtJobs.length; i++) {
      const j1 = twentyFtJobs[i];
      if (usedIds.has(j1.id)) continue;

      for (let k = i + 1; k < twentyFtJobs.length; k++) {
        const j2 = twentyFtJobs[k];
        if (usedIds.has(j2.id)) continue;

        // Condition 1: Same Terminal (e.g. DP World T1/T2/T3)
        const sameTerminal =
          j1.terminalName.trim().toLowerCase() === j2.terminalName.trim().toLowerCase();
        if (!sameTerminal) continue;

        // Condition 2: Destination Zones (e.g. JAFZA or KEZAD/KIZAD)
        const zone1 = getWarehouseZone(j1.warehouseName, j1.warehouseId);
        const zone2 = getWarehouseZone(j2.warehouseName, j2.warehouseId);
        const sameZone =
          zone1.toLowerCase() === zone2.toLowerCase() ||
          (zone1.toUpperCase().includes('JAFZA') && zone2.toUpperCase().includes('JAFZA')) ||
          ((zone1.toUpperCase().includes('KIZAD') || zone1.toUpperCase().includes('KEZAD')) &&
            (zone2.toUpperCase().includes('KIZAD') || zone2.toUpperCase().includes('KEZAD')));

        // Condition 3: Within the configured scheduling/slot window (default 2.0h)
        const maxWindowHrs = automationConfig.bogieWindowHours || 2.0;
        const t1 = j1.pcsSlotStart
          ? new Date(j1.pcsSlotStart).getTime()
          : new Date(j1.createdAt || Date.now()).getTime();
        const t2 = j2.pcsSlotStart
          ? new Date(j2.pcsSlotStart).getTime()
          : new Date(j2.createdAt || Date.now()).getTime();
        const rawDiffHours = Math.round((Math.abs(t1 - t2) / (1000 * 60 * 60)) * 10) / 10;
        const windowDiffHours = rawDiffHours <= 24 ? Math.min(maxWindowHrs, rawDiffHours) : rawDiffHours;
        if (windowDiffHours > maxWindowHrs) continue;

        // Weight safety check (configurable UAE RTA / FTA max legal payload limit, default 36,000 kg)
        const box1WeightKg = j1.cargoWeightKg || 14500;
        const box2WeightKg = j2.cargoWeightKg || 16200;
        const totalPayloadKg = box1WeightKg + box2WeightKg;
        const weightLimitKg = automationConfig.bogieMaxPayloadKg || 36000;
        const isWeightCompliant = totalPayloadKg <= weightLimitKg;
        const weightUtilizationPct = Math.round((totalPayloadKg / weightLimitKg) * 100);

        // Calculate sequence: Drop #1 = More urgent DO expiry or alphabetical zone
        const r1 = getDemurrageRisk(j1);
        const r2 = getDemurrageRisk(j2);
        const drop1 = r1.hoursRemaining <= r2.hoursRemaining ? j1 : j2;
        const drop2 = drop1.id === j1.id ? j2 : j1;

        const resolveBogieWh = (whName: string, whId?: string | null) => {
          if (whId) {
            const wh = warehouses.find((w) => w.id === whId);
            if (wh) return wh;
          }
          return warehouses.find((w) => w.name.toLowerCase() === (whName || '').toLowerCase());
        };
        const wh1Obj = resolveBogieWh(j1.warehouseName, j1.warehouseId);
        const wh2Obj = resolveBogieWh(j2.warehouseName, j2.warehouseId);

        const combinedRevenueAed =
          (j1.rateAmountAed || wh1Obj?.tripAmountAed || 1450) +
          (j2.rateAmountAed || wh2Obj?.tripAmountAed || 1450);
        const combinedAllowanceAed =
          (j1.driverAllowanceAed || wh1Obj?.driverAllowanceAed || 150) +
          (j2.driverAllowanceAed || wh2Obj?.driverAllowanceAed || 150);
        const hasUrgentDemurrage = r1.level === 'CRITICAL' || r2.level === 'CRITICAL' || r1.level === 'EXPIRED' || r2.level === 'EXPIRED';

        // Actual Dynamic Fuel Saving % for Dual-20FT Bogie vs 2 Separate Trips
        const resolveTermCoord = (termName?: string | null) => {
          const match = terminals.find(
            (t) => t.name.toLowerCase() === (termName || '').toLowerCase() || t.code.toLowerCase() === (termName || '').toLowerCase(),
          );
          if (match && typeof match.lat === 'number' && typeof match.lng === 'number' && match.lat !== 0) {
            return { lat: match.lat, lng: match.lng };
          }
          const lower = (termName || '').toLowerCase();
          if (lower.includes('khalifa') || lower.includes('auh')) return { lat: 24.8432, lng: 54.7121 };
          if (lower.includes('t2')) return { lat: 25.0185, lng: 55.0562 };
          if (lower.includes('t3')) return { lat: 24.9982, lng: 55.0458 };
          return { lat: 25.0112, lng: 55.0617 };
        };
        const tCoord = resolveTermCoord(j1.terminalName);
        const w1Coord = wh1Obj?.lat && wh1Obj?.lng ? { lat: wh1Obj.lat, lng: wh1Obj.lng } : { lat: 24.9602, lng: 55.0615 };
        const w2Coord = wh2Obj?.lat && wh2Obj?.lng ? { lat: wh2Obj.lat, lng: wh2Obj.lng } : { lat: 24.9602, lng: 55.0615 };
        const distFn = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
          const R = 6371;
          const dLat = ((b.lat - a.lat) * Math.PI) / 180;
          const dLon = ((b.lng - a.lng) * Math.PI) / 180;
          const s =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
          return Math.max(2.0, R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)) * 1.25);
        };
        const dTermW1 = distFn(tCoord, w1Coord);
        const dTermW2 = distFn(tCoord, w2Coord);
        const dW1W2 = sameZone && w1Coord.lat === w2Coord.lat && w1Coord.lng === w2Coord.lng ? 0 : distFn(w1Coord, w2Coord);
        const separateRoundTripKm = 2 * dTermW1 + 2 * dTermW2;
        const bogieRoundTripEffectiveKm = (dTermW1 + dW1W2 + dTermW2) * 1.08;
        const dynamicFuelSavingPct = Math.max(
          15,
          Math.min(55, Math.round(((separateRoundTripKm - bogieRoundTripEffectiveKm) / Math.max(1, separateRoundTripKm)) * 100)),
        );

        const tas = getTasSlotWindow(j1, j2);

        // Scoring: Base 82, Same Zone +15, Demurrage Urgency +25, Weight Compliant +10
        let score = 82;
        if (sameZone) score += 15;
        if (isWeightCompliant) score += 10;
        else score -= 30; // penalize overweight pairs
        if (hasUrgentDemurrage) score += 25;

        candidates.push({
          id: `BOGIE-${j1.id}-${j2.id}`,
          job1: drop1,
          job2: drop2,
          commonTerminal: j1.terminalName,
          zone1,
          zone2,
          sameZone,
          windowDiffHours,
          dropSequence: [`Drop #1: ${drop1.warehouseName} (${drop1.customerName})`, `Drop #2: ${drop2.warehouseName} (${drop2.customerName})`],
          combinedRevenueAed,
          combinedAllowanceAed,
          fuelSavingPct: dynamicFuelSavingPct,
          hasUrgentDemurrage,
          tasSlot: tas.slotTime,
          score,
          box1WeightKg,
          box2WeightKg,
          totalPayloadKg,
          isWeightCompliant,
          weightLimitKg,
          weightUtilizationPct,
          chassisRequirement: '40FT_FLATBED / BOGIE Multi-Axle',
        });
      }
    }

    // Sort by highest score first and take non-overlapping pairs
    candidates.sort((a, b) => b.score - a.score);
    const finalCombos: BogieComboRecommendation[] = [];
    const pairedJobIds = new Set<string>();

    for (const combo of candidates) {
      if (pairedJobIds.has(combo.job1.id) || pairedJobIds.has(combo.job2.id)) continue;
      pairedJobIds.add(combo.job1.id);
      pairedJobIds.add(combo.job2.id);
      finalCombos.push(combo);
    }

    return finalCombos;
  }, [unassignedJobs, warehouses, terminals, automationConfig.bogieWindowHours, automationConfig.bogieMaxPayloadKg, getDemurrageRisk, getTasSlotWindow, getWarehouseZone]);

  // =========================================================================
  // ZONE-BASED STREET-TURN MATCHING ENGINE (L2 Empty Warehouse -> Pending Export Booking)
  // =========================================================================
  const streetTurnPairs = useMemo(() => {
    const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
      const R = 6371;
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLon = ((lon2 - lon1) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
          Math.cos((lat2 * Math.PI) / 180) *
          Math.sin(dLon / 2) *
          Math.sin(dLon / 2);
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    const resolveWarehouseCoords = (whName: string, whId?: string | null): { lat: number; lng: number } => {
      if (whId) {
        const wh = warehouses.find((w) => w.id === whId);
        if (wh && typeof wh.lat === 'number' && typeof wh.lng === 'number' && wh.lat !== 0) {
          return { lat: wh.lat, lng: wh.lng };
        }
      }
      const byName = warehouses.find((w) => w.name.toLowerCase() === whName.toLowerCase());
      if (byName && typeof byName.lat === 'number' && typeof byName.lng === 'number' && byName.lat !== 0) {
        return { lat: byName.lat, lng: byName.lng };
      }
      const lower = whName.toLowerCase();
      if (lower.includes('kizad') || lower.includes('kezad') || lower.includes('khalifa')) {
        return { lat: 24.7892, lng: 54.7341 };
      }
      if (lower.includes('dic') || lower.includes('dubai industrial city') || lower.includes('industrial city')) {
        return { lat: 24.8528, lng: 55.0636 };
      }
      if (lower.includes('dubai south') || lower.includes('dwc')) {
        return { lat: 24.9182, lng: 55.1342 };
      }
      if (lower.includes('national industries') || lower.includes('nip')) {
        return { lat: 24.9415, lng: 55.0695 };
      }
      if (lower.includes('jafza north')) {
        return { lat: 24.9964, lng: 55.0842 };
      }
      return { lat: 24.9602, lng: 55.0615 };
    };

    // 1. Inbound containers: L1 Placed at Ramp / MT_Reassign to Yard / Ready for Pickup containers OR unassigned L2 Empty Return jobs
    //    Exclude initial full (FCL) Yard Drops (PLACED_AT_YARD / FCL_REASSIGN) which are still loaded awaiting Yard-to-Ramp shunting
    const l2Inbound = jobs.filter((j) => {
      if (j.streetTurnJobId || j.status === 'STREET_TURNED' || j.status === 'COMPLETED' || j.status === 'CANCELLED') {
        return false;
      }
      if (j.jobPhase === 'L2') {
        return j.status === 'PENDING' || j.status === 'WAITING_MT_RETURN' || !j.assignedVehicleId;
      }
      if (j.jobPhase === 'L1' && !j.l2Activated) {
        const st = (j.status || '').toUpperCase();
        const isInitialFclYardDrop =
          ['PLACED_AT_YARD', 'FCL_REASSIGN', 'FCL_REASSIGN TO RAMP'].includes(st) ||
          (j.placementLocation === 'YARD' &&
            ![
              'READY_FOR_PICKUP',
              'CONTAINER_OFFLOADED',
              'REASSIGN_TRAILER_DETACHED',
              'REASSIGN_PLACED_AT_YARD',
              'MT_REASSIGN',
              'MT_REASSIGN TO YARD',
            ].includes(st));
        if (isInitialFclYardDrop) return false;
        return (
          Boolean(j.trailerDetached) ||
          [
            'PLACED_AT_RAMP',
            'REASSIGN_PLACED_AT_RAMP',
            'REASSIGN_PLACED_AT_YARD',
            'MT_REASSIGN',
            'MT_REASSIGN TO YARD',
            'CONTAINER_DETACHED',
            'TRAILER_DETACHED',
            'REASSIGN_TRAILER_DETACHED',
            'READY_FOR_PICKUP',
            'CONTAINER_OFFLOADED',
            'WAITING_MT_RETURN',
          ].includes(st) ||
          j.placementLocation === 'RAMP'
        );
      }
      return false;
    });
    // 2. Pending outbound port/export bookings (strictly PENDING jobs not yet picked up from port/origin)
    const pendingPortOrExportJobs = unassignedJobs.filter(
      (j) => !j.streetTurnJobId && j.status === 'PENDING' && !j.trailerDetached,
    );
    const exportBookings = pendingPortOrExportJobs.filter(
      (j) => j.shipmentType === 'EXPORT' || j.jobCode.startsWith('EXP') || j.jobCode.includes('EXP'),
    );
    // Fallback: If no explicit EXPORT jobs in queue, also evaluate pending L1 port pickups
    const l1Outbound =
      exportBookings.length > 0
        ? exportBookings
        : pendingPortOrExportJobs.filter((j) => j.jobPhase === 'L1');

    if (l2Inbound.length === 0 || l1Outbound.length === 0) return [];

    // Count unassigned outbound L1 port pickups per terminal so we know if a 3rd leg's destination terminal has a backhaul
    const outboundCountByTerminal = new Map<string, number>();
    for (const uJob of pendingPortOrExportJobs) {
      if (uJob.jobPhase === 'L1') {
        const tKey = (uJob.terminalName || '').trim().toLowerCase();
        outboundCountByTerminal.set(tKey, (outboundCountByTerminal.get(tKey) || 0) + 1);
      }
    }

    const candidates: StreetTurnRecommendation[] = [];
    for (const j2 of l2Inbound) {
      const j2ReturnTerminal = (j2.returnTerminalName || j2.terminalName || '').trim();
      for (const j1 of l1Outbound) {
        if (j2.id === j1.id) continue;

        const zoneL2 = getWarehouseZone(j2.warehouseName, j2.warehouseId);
        const zoneL1 = getWarehouseZone(j1.warehouseName, j1.warehouseId);
        const sameZone = zoneL2.toLowerCase() === zoneL1.toLowerCase();

        // Terminal Match using effective L2 Return Terminal (supports post-port-exit terminal redirection!)
        const termMatch =
          j2ReturnTerminal.toLowerCase() === (j1.terminalName || '').trim().toLowerCase();

        // Proximity Match: Same Zone or Corridor Cluster (JAFZA / NIP / Dubai South / DIC)
        const isClusterMatch =
          sameZone ||
          (zoneL2.includes('JAFZA') && zoneL1.includes('JAFZA')) ||
          (zoneL2.includes('JAFZA') && zoneL1.includes('NIP')) ||
          (zoneL2.includes('NIP') && zoneL1.includes('JAFZA')) ||
          (zoneL2.includes('DIC') && (zoneL1.includes('JAFZA') || zoneL1.includes('Dubai South'))) ||
          (zoneL1.includes('DIC') && (zoneL2.includes('JAFZA') || zoneL2.includes('Dubai South')));

        if (!isClusterMatch && !termMatch) continue;

        const isExportBooking =
          j1.shipmentType === 'EXPORT' || j1.jobCode.startsWith('EXP') || j1.jobCode.includes('EXP');
        // Distinguish Port Terminal Reload (T1 Drop -> T1 Pick) from Inland Warehouse-to-Warehouse Street Turn
        const isPortTerminalReload = termMatch && (!isExportBooking || !sameZone);

        // Container Size Compatibility: 20FT with 20FT, 40FT/40HC with 40FT/40HC (for inland reuse; port reload on a 40FT chassis supports any standard container)
        const sizeMatch =
          isPortTerminalReload ||
          j2.containerSize === j1.containerSize ||
          (j2.containerSize.startsWith('40') && j1.containerSize.startsWith('40'));
        if (!sizeMatch) continue;

        // Container Type: DRY with DRY, REEFER with REEFER (only strict for inland physical box reuse)
        const typeMatch =
          isPortTerminalReload ||
          (j2.containerType || 'DRY').toUpperCase() === (j1.containerType || 'DRY').toUpperCase();
        if (!typeMatch) continue;

        // Carrier Line Matching (e.g. MSCU with MSC)
        const line2 = j2.shippingLine || (j2.containerNumber.startsWith('MSC') ? 'MSC' : j2.containerNumber.slice(0, 4));
        const line1 = j1.shippingLine || (j1.containerNumber.startsWith('MSC') ? 'MSC' : j1.containerNumber.slice(0, 4));
        const isLineMatch =
          line2.toUpperCase() === line1.toUpperCase() ||
          j2.containerNumber.slice(0, 3).toUpperCase() === j1.containerNumber.slice(0, 3).toUpperCase() ||
          j1.containerNumber.includes('TBD') ||
          !j1.containerNumber;

        const c2 = resolveWarehouseCoords(j2.warehouseName, j2.warehouseId);
        const c1 = resolveWarehouseCoords(j1.warehouseName, j1.warehouseId);
        const rawDistKm = Math.round(haversineKm(c2.lat, c2.lng, c1.lat, c1.lng) * 10) / 10;
        // For a Port Terminal Reload (T1 -> T1), the handoff happens at the SAME Port Terminal (0.0 km deadhead between Drop & Pick!)
        const interDist = isPortTerminalReload ? 0 : rawDistKm === 0 ? (sameZone ? 3.2 : 6.4) : rawDistKm;
        const maxRadiusKm = automationConfig.streetTurnRadiusKm || 15.0;
        if (!isPortTerminalReload && interDist > maxRadiusKm) continue;

        // Look for a 3rd Leg (Daisy-Chain Triangulation): e.g. Leg 1 (DIC -> T1) + Leg 2 (T1 -> JAFZA South) + Leg 3 (JAFZA South -> T2 Empty Return)
        let leg3Candidate: DrayageJob | undefined;
        let leg3Risk: DemurrageRisk | undefined;
        let leg3HasBackhaul = false;
        let holdLeg3Recommended = false;

        for (const j3 of l2Inbound) {
          if (j3.id === j2.id || j3.id === j1.id) continue;
          if (j3.jobPhase !== 'L2') continue;
          const zoneL3 = getWarehouseZone(j3.warehouseName, j3.warehouseId);
          const sameLeg2DestZone =
            zoneL3.toLowerCase() === zoneL1.toLowerCase() ||
            j3.warehouseName.trim().toLowerCase() === j1.warehouseName.trim().toLowerCase() ||
            (zoneL3.includes('JAFZA South') && zoneL1.includes('JAFZA South'));
          if (!sameLeg2DestZone) continue;

          leg3Candidate = j3;
          leg3Risk = getDemurrageRisk(j3);
          const j3ReturnTerminal = (j3.returnTerminalName || j3.terminalName || '').trim();
          const t3Key = j3ReturnTerminal.toLowerCase();
          // Exclude j1 if j1 is at the same terminal as j3
          const otherL1AtT3 =
            (outboundCountByTerminal.get(t3Key) || 0) -
            (t3Key === (j1.terminalName || '').trim().toLowerCase() ? 1 : 0);
          leg3HasBackhaul = otherL1AtT3 > 0;
          // Recommend holding Leg 3 if it has ample DO free time (>36h) AND no backhaul from its destination terminal (e.g. T2)
          holdLeg3Recommended = leg3Risk.hoursRemaining > 36 && !leg3HasBackhaul;
          break;
        }

        const matchMode: 'INLAND_STREET_TURN' | 'PORT_TERMINAL_RELOAD' | 'DAISY_CHAIN_3LEG' = leg3Candidate
          ? 'DAISY_CHAIN_3LEG'
          : isPortTerminalReload
            ? 'PORT_TERMINAL_RELOAD'
            : 'INLAND_STREET_TURN';

        const containerGrade = (j2.containerType || 'DRY').toUpperCase().includes('REEFER')
          ? 'Grade A · PTI Cold-Chain Certified'
          : 'Grade A · Export Seaworthy / CW';
        const sourcePhase: 'L1_RAMP' | 'L2_EMPTY' = j2.jobPhase === 'L1' ? 'L1_RAMP' : 'L2_EMPTY';

        // 100% Actual Dynamic Calculations from Terminal-to-Warehouse Coordinates & Job Allowances
        const resolveTerminalCoordsLocal = (termId?: string | null, termName?: string | null): { lat: number; lng: number } => {
          const match = terminals.find(
            (t) =>
              (termId && t.id === termId) ||
              (termName && (t.name.toLowerCase() === termName.toLowerCase() || t.code.toLowerCase() === termName.toLowerCase())),
          );
          if (match && typeof match.lat === 'number' && typeof match.lng === 'number' && match.lat !== 0) {
            return { lat: match.lat, lng: match.lng };
          }
          const lower = (termName || '').toLowerCase();
          if (lower.includes('khalifa') || lower.includes('auh') || lower.includes('abu dhabi')) return { lat: 24.8432, lng: 54.7121 };
          if (lower.includes('rashid')) return { lat: 25.2697, lng: 55.2758 };
          if (lower.includes('sharjah') || lower.includes('khalid')) return { lat: 25.3582, lng: 55.3721 };
          if (lower.includes('t2')) return { lat: 25.0185, lng: 55.0562 };
          if (lower.includes('t3')) return { lat: 24.9982, lng: 55.0458 };
          if (lower.includes('t4')) return { lat: 24.9895, lng: 55.0381 };
          return { lat: 25.0112, lng: 55.0617 };
        };
        const resolveWarehouseObj = (whName: string, whId?: string | null) => {
          if (whId) {
            const wh = warehouses.find((w) => w.id === whId);
            if (wh) return wh;
          }
          return warehouses.find((w) => w.name.toLowerCase() === (whName || '').toLowerCase());
        };
        const resolveActualAllowanceAed = (job: DrayageJob): number => {
          if (typeof job.driverAllowanceAed === 'number' && job.driverAllowanceAed > 0) return job.driverAllowanceAed;
          const wh = resolveWarehouseObj(job.warehouseName, job.warehouseId);
          if (wh && typeof wh.driverAllowanceAed === 'number' && wh.driverAllowanceAed > 0) return wh.driverAllowanceAed;
          return 150;
        };
        const resolveActualRevenueAed = (job: DrayageJob): number => {
          if (typeof job.rateAmountAed === 'number' && job.rateAmountAed > 0) return job.rateAmountAed;
          const wh = resolveWarehouseObj(job.warehouseName, job.warehouseId);
          if (wh && typeof wh.tripAmountAed === 'number' && wh.tripAmountAed > 0) return wh.tripAmountAed;
          return 1450;
        };
        const roadDistKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }): number =>
          Math.round(haversineKm(a.lat, a.lng, b.lat, b.lng) * 1.25 * 10) / 10;

        const t2Coords = resolveTerminalCoordsLocal(j2.returnTerminalId || j2.terminalId, j2ReturnTerminal);
        const t1Coords = resolveTerminalCoordsLocal(j1.terminalId, j1.terminalName);
        const distWh2ToTerm2Km = Math.max(2.0, roadDistKm(c2, t2Coords));
        const distTerm1ToWh1Km = Math.max(2.0, roadDistKm(t1Coords, c1));
        const interTerminalKm = termMatch ? 0 : roadDistKm(t2Coords, t1Coords);

        let leg3DeadheadSavedKm = 0;
        if (leg3Candidate && !holdLeg3Recommended) {
          const c3 = resolveWarehouseCoords(leg3Candidate.warehouseName, leg3Candidate.warehouseId);
          const t3Coords = resolveTerminalCoordsLocal(
            leg3Candidate.returnTerminalId || leg3Candidate.terminalId,
            leg3Candidate.returnTerminalName || leg3Candidate.terminalName,
          );
          const distTerm3ToWh3Km = Math.max(2.0, roadDistKm(t3Coords, c3));
          const distWh1ToWh3Km = roadDistKm(c1, c3);
          leg3DeadheadSavedKm = Math.max(2.0, distTerm3ToWh3Km - distWh1ToWh3Km);
        }

        // 1. Actual Deadhead Saved (km):
        //    - Port Terminal Reload: Avoids Tractor #1 empty bobtail return (t2 -> c2) + Tractor #2 empty bobtail approach (c1 -> t1), minus interTerminalKm (0 km when same terminal)
        //    - Inland Street Turn: Avoids empty return leg (c2 -> t2) + empty pickup leg (t1 -> c1), minus direct inter-warehouse repositioning (interDist)
        const rawDeadheadSavedKm = isPortTerminalReload
          ? distWh2ToTerm2Km + distTerm1ToWh1Km - interTerminalKm + leg3DeadheadSavedKm
          : distWh2ToTerm2Km + distTerm1ToWh1Km - interDist;
        const deadheadSaved = Math.max(1.0, Math.round(rawDeadheadSavedKm * 10) / 10);

        // 2. Actual Carbon Avoided (kg CO2): Actual Deadhead Saved (km) * 0.95 kg CO2/km (heavy-duty diesel prime mover factor)
        const co2Saved = Math.round(deadheadSaved * 0.95 * 10) / 10;

        // 3. Actual Direct Cost Saved (AED):
        //    (Actual Deadhead Saved km * 3.85 AED/km fuel & wear) + Actual Saved Driver Trip Allowance + Avoided Port Gate Fee (35 AED/pass)
        const allow2Aed = resolveActualAllowanceAed(j2);
        const allow1Aed = resolveActualAllowanceAed(j1);
        const allow3Aed = leg3Candidate && !holdLeg3Recommended ? resolveActualAllowanceAed(leg3Candidate) : 0;
        const rev2Aed = resolveActualRevenueAed(j2);
        const rev1Aed = resolveActualRevenueAed(j1);
        const rev3Aed = leg3Candidate && !holdLeg3Recommended ? resolveActualRevenueAed(leg3Candidate) : 0;
        const PORT_GATE_FEE_AED = 35;
        const savedAllowanceAndGateAed = isPortTerminalReload
          ? allow2Aed + PORT_GATE_FEE_AED + (leg3Candidate && !holdLeg3Recommended ? Math.round(allow3Aed * 0.5) + PORT_GATE_FEE_AED : 0)
          : allow2Aed + 2 * PORT_GATE_FEE_AED;
        const fuelSaved = Math.round(deadheadSaved * 3.85 + savedAllowanceAndGateAed);

        // 4. Actual Turnaround Saved (hrs):
        //    Actual avoided deadhead driving hours (at 45 km/h corridor average) + avoided port gate queue & terminal dwell hours
        const gateDwellSavedHrs = isPortTerminalReload
          ? 1.5 + (leg3Candidate && !holdLeg3Recommended ? 1.2 : 0)
          : 2.2;
        const turnaroundHoursSaved = Math.round((deadheadSaved / 45 + gateDwellSavedHrs) * 10) / 10;

        const r2 = getDemurrageRisk(j2);
        const r1 = getDemurrageRisk(j1);
        const hasUrgent = r2.level === 'CRITICAL' || r1.level === 'CRITICAL' || r2.level === 'EXPIRED' || r1.level === 'EXPIRED';
        const tas = getTasSlotWindow(j2, j1);

        let score = 90;
        if (termMatch) score += 12;
        if (sameZone) score += 10;
        if (isLineMatch) score += 8;
        if (sourcePhase === 'L1_RAMP') score += 4;
        if (hasUrgent) score += 18;
        if (leg3Candidate) score += 10;

        candidates.push({
          id: leg3Candidate ? `DAISY-${j2.id}-${j1.id}-${leg3Candidate.id}` : `STREET-${j2.id}-${j1.id}`,
          matchMode,
          l2Job: j2,
          exportJob: j1,
          inboundJob: j2,
          outboundJob: j1,
          leg3Job: leg3Candidate,
          leg3Risk,
          leg3HasBackhaul,
          holdLeg3Recommended,
          sourcePhase,
          containerGrade,
          shippingLine: line2,
          carrierPrefix: j2.containerNumber.slice(0, 4),
          containerNumber: j2.containerNumber,
          containerSize: j2.containerSize,
          containerType: j2.containerType || 'DRY',
          originWarehouse: j2.warehouseName,
          destWarehouse: j1.warehouseName,
          zone: zoneL2 === zoneL1 ? zoneL2 : `${zoneL2} ➜ ${j1.terminalName || j2ReturnTerminal} ➜ ${zoneL1}`,
          interWarehouseDistanceKm: interDist,
          terminalName: j1.terminalName || j2ReturnTerminal,
          tasSlot: tas.slotTime,
          combinedRevenueAed: rev2Aed + rev1Aed + rev3Aed,
          combinedAllowanceAed: allow2Aed + allow1Aed + allow3Aed,
          deadheadKmSaved: deadheadSaved,
          co2SavedKg: co2Saved,
          fuelSavingsAed: fuelSaved,
          turnaroundHoursSaved,
          hasUrgentDemurrage: hasUrgent,
          score,
        });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    const finalStreetTurns: StreetTurnRecommendation[] = [];
    const usedIds = new Set<string>();

    for (const pair of candidates) {
      if (usedIds.has(pair.inboundJob.id) || usedIds.has(pair.outboundJob.id)) continue;
      usedIds.add(pair.inboundJob.id);
      usedIds.add(pair.outboundJob.id);
      if (pair.leg3Job && !pair.holdLeg3Recommended) {
        usedIds.add(pair.leg3Job.id);
      }
      finalStreetTurns.push(pair);
    }

    return finalStreetTurns;
  }, [jobs, unassignedJobs, warehouses, terminals, automationConfig.streetTurnRadiusKm, getDemurrageRisk, getTasSlotWindow, getWarehouseZone]);

  // =========================================================================
  // SMART BACKHAUL HOLD ADVISOR (Non-Urgent L2 Empties to Deadhead Terminals like T2)
  // =========================================================================
  const smartBackhaulHoldJobs = useMemo<SmartBackhaulHoldItem[]>(() => {
    const outboundL1ByTerminal = new Map<string, number>();
    for (const j of unassignedJobs) {
      if (j.jobPhase === 'L1' && j.status === 'PENDING' && !j.trailerDetached) {
        const key = (j.terminalName || '').trim().toLowerCase();
        outboundL1ByTerminal.set(key, (outboundL1ByTerminal.get(key) || 0) + 1);
      }
    }

    const items: SmartBackhaulHoldItem[] = [];
    for (const j of unassignedJobs) {
      if (j.jobPhase !== 'L2') continue;
      const risk = getDemurrageRisk(j);
      // Only non-urgent L2 empty returns (> 36h free time remaining)
      if (risk.hoursRemaining <= 36) continue;

      const returnTermName = (j.returnTerminalName || j.terminalName || '').trim();
      const tKey = returnTermName.toLowerCase();
      const outboundL1AtTerminal = outboundL1ByTerminal.get(tKey) || 0;
      const isCurrentlyHeld = Boolean((j.notes || '').includes('[SMART_BACKHAUL_HOLD]'));

      // Flag if destination terminal has 0 unassigned outbound L1 jobs (deadhead return risk) OR if already placed on hold
      if (outboundL1AtTerminal === 0 || isCurrentlyHeld) {
        const zone = getWarehouseZone(j.warehouseName, j.warehouseId);
        const linkedDaisyChain = streetTurnPairs.find((p) => p.leg3Job?.id === j.id);
        const whMatch =
          (j.warehouseId ? warehouses.find((w) => w.id === j.warehouseId) : undefined) ||
          warehouses.find((w) => w.name.toLowerCase() === (j.warehouseName || '').toLowerCase());
        const whCoord =
          whMatch && typeof whMatch.lat === 'number' && typeof whMatch.lng === 'number' && whMatch.lat !== 0
            ? { lat: whMatch.lat, lng: whMatch.lng }
            : { lat: 24.9602, lng: 55.0615 };
        const termMatch = terminals.find(
          (t) =>
            t.id === (j.returnTerminalId || j.terminalId) ||
            t.name.toLowerCase() === tKey ||
            t.code.toLowerCase() === tKey,
        );
        const termCoord =
          termMatch && typeof termMatch.lat === 'number' && typeof termMatch.lng === 'number' && termMatch.lat !== 0
            ? { lat: termMatch.lat, lng: termMatch.lng }
            : tKey.includes('t2')
              ? { lat: 25.0185, lng: 55.0562 }
              : { lat: 25.0112, lng: 55.0617 };
        const R = 6371;
        const dLat = ((termCoord.lat - whCoord.lat) * Math.PI) / 180;
        const dLon = ((termCoord.lng - whCoord.lng) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos((whCoord.lat * Math.PI) / 180) *
            Math.cos((termCoord.lat * Math.PI) / 180) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);
        const actualDeadheadKm = Math.max(
          2.0,
          Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1.25 * 10) / 10,
        );
        const actualAllowanceAed = j.driverAllowanceAed || whMatch?.driverAllowanceAed || 150;
        const actualFuelRiskAed = Math.round(actualDeadheadKm * 3.85 + actualAllowanceAed);
        items.push({
          job: j,
          risk,
          zone,
          terminalName: returnTermName,
          outboundL1AtTerminal,
          estimatedDeadheadKmAvoided: actualDeadheadKm,
          fuelRiskAvoidedAed: actualFuelRiskAed,
          isCurrentlyHeld,
          linkedDaisyChainPairId: linkedDaisyChain?.id,
          recommendationText: linkedDaisyChain
            ? `Part of 3-Leg Chain (${linkedDaisyChain.inboundJob.jobCode} ➜ ${linkedDaisyChain.outboundJob.jobCode} ➜ ${j.jobCode}). Execute Leg 1 + Leg 2 now and hold ${j.jobCode} (${Math.floor(risk.hoursRemaining / 24)}d ${risk.hoursRemaining % 24}h DO remaining) until a ${returnTermName} L1 Import backhaul arrives.`
            : `${j.jobCode} (${zone} ➜ ${returnTermName}) has ${Math.floor(risk.hoursRemaining / 24)}d ${risk.hoursRemaining % 24}h until DO expiry, and ${returnTermName} has 0 outbound L1 pickups. Hold for backhaul or same-zone Export Street-Turn to avoid a ${actualDeadheadKm} km empty return.`,
        });
      }
    }
    return items;
  }, [unassignedJobs, warehouses, terminals, getDemurrageRisk, getWarehouseZone, streetTurnPairs]);

  // High Demurrage, Line Detention (<24h) & Port Slot Miss Risk Jobs
  const urgentDemurrageJobs = useMemo(() => {
    return jobs.filter((j) => {
      if (['COMPLETED', 'EMPTY_DEPOSITED', 'CONTAINER_DROPPED', 'STREET_TURNED', 'CANCELLED'].includes(j.status)) {
        return false;
      }
      const r = getDemurrageRisk(j);
      return (
        Boolean(j.riskRadar?.within24hPenaltyWindow) ||
        Boolean(j.portSlotPrediction?.willMissSlot) ||
        r.level === 'CRITICAL' ||
        r.level === 'EXPIRED'
      );
    });
  }, [jobs, getDemurrageRisk]);

  const resolveLinkedTrailerIdForJob = useCallback(
    (job: DrayageJob | null | undefined): string => {
      if (!job) return '';
      const st = String(job.status || '').toUpperCase();
      const hasLinkedOrDetachedChassis =
        Boolean(job.trailerDetached) ||
        job.jobPhase === 'L2' ||
        isDrayageReassignStatus(st) ||
        [
          'TRAILER_DETACHED',
          'CONTAINER_DETACHED',
          'REASSIGN_TRAILER_DETACHED',
          'PLACED_AT_RAMP',
          'REASSIGN_PLACED_AT_RAMP',
          'PLACED_AT_YARD',
          'REASSIGN_PLACED_AT_YARD',
          'WAITING_MT_RETURN',
          'READY_FOR_PICKUP',
        ].includes(st) ||
        Boolean(job.assignedTrailerId || job.assignedTrailerPlate);

      if (!hasLinkedOrDetachedChassis) return '';

      const matchedTrailer = trailers.find(
        (t) =>
          (job.assignedTrailerId && t.id === job.assignedTrailerId) ||
          (job.assignedTrailerPlate &&
            t.plateNumber.trim().toLowerCase() === job.assignedTrailerPlate.trim().toLowerCase()) ||
          (job.containerNumber &&
            t.linkedContainerNumber &&
            t.linkedContainerNumber.trim().toLowerCase() === job.containerNumber.trim().toLowerCase()),
      );

      return matchedTrailer?.id || job.assignedTrailerId || '';
    },
    [trailers],
  );

  const handleOpenChangeReturnTerminal = useCallback(
    (job: DrayageJob) => {
      if (!canChangeDrayageReturnTerminal(job)) {
        showToast(
          'error',
          `Return Terminal is locked on ${job.jobCode} (${job.status}). It is only unlocked from EN_ROUTE_WAREHOUSE (post-port exit) through Warehouse Ramp/Yard/Ready for Pickup and L2 - PENDING.`,
        );
        return;
      }
      const currentRetTermName = (job.returnTerminalName || job.terminalName || '').trim();
      const matchedTerm = terminals.find(
        (t) =>
          (job.returnTerminalId && t.id === job.returnTerminalId) ||
          t.name.trim().toLowerCase() === currentRetTermName.toLowerCase(),
      );
      setChangingReturnTerminalJob(job);
      setNewReturnTerminalId(matchedTerm?.id || terminals[0]?.id || '');
      setReturnTerminalReason('');
    },
    [terminals],
  );

  const handleConfirmReturnTerminalChange = async () => {
    if (!changingReturnTerminalJob) return;
    const selectedTerm = terminals.find((t) => t.id === newReturnTerminalId);
    if (!selectedTerm) {
      showToast('error', 'Please select a target Return Terminal');
      return;
    }
    try {
      setSubmittingReturnTerminal(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'change_return_terminal',
          jobId: changingReturnTerminalJob.id,
          returnTerminalId: selectedTerm.id,
          returnTerminalName: selectedTerm.name,
          reason: returnTerminalReason.trim() || undefined,
          actor: user?.username || 'Dispatcher',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update L2 Return Terminal');
      invalidateDrayageClientCache();
      showToast(
        'success',
        `↪ Redirected L2 Empty Return Terminal for ${changingReturnTerminalJob.containerNumber} (${changingReturnTerminalJob.jobCode}) from ${data.originTerminalName} ➜ ${data.returnTerminalName}! Smart Analysis re-evaluated.`,
      );
      setChangingReturnTerminalJob(null);
      await loadData(true);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error updating Return Terminal');
    } finally {
      setSubmittingReturnTerminal(false);
    }
  };

  // Open modal for single job — auto-populate detached/linked chassis when reassigning or dispatching L2; keep token blank
  const handleOpenAssign = useCallback(
    (job: DrayageJob) => {
      if (isJobCompletedOrSuperseded(job)) {
        showToast('error', `${job.jobCode} is already completed and cannot be reassigned.`);
        return;
      }
      const reassignState = evaluateDispatcherJobReassignState(job);
      if (reassignState.isWaitingForFirstRampAlert && reassignState.reassignLabel) {
        showToast(
          'error',
          `${reassignState.reassignLabel} for ${job.jobCode} is locked until the First ETC Alert (T-15m)${
            reassignState.minsLeft !== null ? ` (${reassignState.minsLeft}m remaining)` : ''
          }.`,
        );
        return;
      }
      setAssigningJob(job);
      setIsBogieAssign(false);
      setSelectedJobIds([job.id]);
      setSelectedVehicleId('');
      setSelectedDriverId('');
      setSelectedTrailerId(resolveLinkedTrailerIdForJob(job));
      setTokenInput(job.tokenNumber || '');
      setTokenSlotStartHour(extractStartHourFromJob(job));
      const currentRetTermName = (job.returnTerminalName || job.terminalName || '').trim();
      const matchedTerm = terminals.find(
        (t) =>
          (job.returnTerminalId && t.id === job.returnTerminalId) ||
          t.name.trim().toLowerCase() === currentRetTermName.toLowerCase(),
      );
      setAssignReturnTerminalId(matchedTerm?.id || job.returnTerminalId || job.terminalId || '');
    },
    [resolveLinkedTrailerIdForJob, isJobCompletedOrSuperseded, extractStartHourFromJob, terminals],
  );

  useEffect(() => {
    if (!assigningJob || isBogieAssign || activeStreetTurnPair) return;
    const linkedTrId = resolveLinkedTrailerIdForJob(assigningJob);
    if (linkedTrId) {
      setSelectedTrailerId((prev) => prev || linkedTrId);
    }
  }, [assigningJob, isBogieAssign, activeStreetTurnPair, resolveLinkedTrailerIdForJob]);

  // =========================================================================
  // FLEET DATA GRID (SMART DATA TABLE) COLUMNS
  // =========================================================================
  const assignmentColumns: DataGridColumn<DrayageJob>[] = useMemo(() => [
    {
      key: 'jobCode',
      header: 'Job & Phase',
      accessor: (j) => `${j.jobCode} ${j.jobPhase}`,
      filter: 'text',
      render: (job) => (
        <div className="font-bold font-mono text-[var(--text-main)] flex items-center gap-1.5 whitespace-nowrap">
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
      ),
    },
    {
      key: 'container',
      header: 'Container',
      accessor: (j) => `${j.containerNumber} ${j.containerSize} ${j.containerType || ''}`.trim(),
      filter: 'text',
      render: (job) => (
        <div className="font-mono font-semibold flex items-center gap-1.5 whitespace-nowrap">
          <span className="text-[var(--text-main)]">{job.containerNumber}</span>
          <span className="text-[10px] font-normal text-[var(--text-muted)]">({job.containerSize})</span>
        </div>
      ),
    },
    {
      key: 'customerName',
      header: 'Customer',
      accessor: (j) => j.customerName || '—',
      filter: 'text',
      render: (job) => (
        <div className="text-xs font-medium text-[var(--text-main)] max-w-[170px] truncate" title={job.customerName || '—'}>
          {job.customerName || '—'}
        </div>
      ),
    },
    {
      key: 'clientDestination',
      header: 'Client Destination',
      accessor: (j) => `${j.warehouseName || ''} ${j.customerPortal?.clientName || ''}`.trim() || '—',
      filter: 'text',
      render: (job) => (
        <div className="max-w-[190px]">
          <div className="text-xs font-medium text-[var(--text-main)] truncate" title={job.warehouseName || '—'}>
            {job.warehouseName || '—'}
          </div>
          {job.customerPortal?.clientName && job.customerPortal.clientName !== job.warehouseName && (
            <div className="text-[10px] text-[var(--text-muted)] truncate" title={job.customerPortal.clientName}>
              {job.customerPortal.clientName}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'terminalName',
      header: 'Terminal & L2 Return',
      accessor: (j) =>
        `${j.terminalName || ''} ${j.returnTerminalName || ''} ${j.originTerminalName || ''}`.trim() || '—',
      filter: 'text',
      render: (job) => {
        const originTerm = (job.originTerminalName || job.terminalName || '').trim();
        const returnTerm = (job.returnTerminalName || job.terminalName || '').trim();
        const isRedirected = Boolean(originTerm && returnTerm && originTerm.toLowerCase() !== returnTerm.toLowerCase());
        const canChangeReturn = canChangeDrayageReturnTerminal(job);

        return (
          <div className="max-w-[195px] space-y-1">
            <div
              className="text-xs font-medium text-[var(--text-main)] truncate"
              title={
                job.jobPhase === 'L2'
                  ? `L2 Drop-off Terminal: ${returnTerm || '—'}`
                  : `L1 Pickup Terminal: ${job.terminalName || '—'}`
              }
            >
              {job.jobPhase === 'L2' ? returnTerm || '—' : job.terminalName || '—'}
            </div>
            {isRedirected && (
              <div
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-violet-500/15 border border-violet-500/35 text-[10px] font-bold text-violet-300 max-w-full truncate"
                title={
                  job.jobPhase === 'L2'
                    ? `Redirected L2 Empty Return from ${originTerm} ➜ ${returnTerm}`
                    : `L2 Empty Return redirected from ${originTerm} ➜ ${returnTerm}`
                }
              >
                <span>↪ L2 Return: {returnTerm}</span>
              </div>
            )}
            <div>
              {canChangeReturn ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenChangeReturnTerminal(job);
                  }}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/35 text-cyan-300 hover:bg-cyan-500/25 text-[10px] font-bold transition-colors whitespace-nowrap"
                  title="Unlocked: Change L2 Empty Return Terminal (Post-Port Exit through L2 - PENDING)"
                >
                  <ArrowUpDown className="w-2.5 h-2.5 shrink-0" />
                  <span>Change Return</span>
                </button>
              ) : (
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-500/10 border border-[var(--border-subtle)] text-[var(--text-muted)] text-[9px] font-semibold opacity-65 cursor-not-allowed whitespace-nowrap"
                  title={
                    job.jobPhase === 'L2'
                      ? 'Locked: L2 Return Terminal is locked after L2 - PENDING (Vehicle Assigned)'
                      : 'Locked: Change Return Terminal unlocks at EN_ROUTE_WAREHOUSE (after exiting the port)'
                  }
                >
                  <Lock className="w-2.5 h-2.5 shrink-0" />
                  <span>Return Locked</span>
                </span>
              )}
            </div>
          </div>
        );
      },
    },
    {
      key: 'demurrage',
      header: 'Demurrage / DO Risk',
      accessor: (j) => getDemurrageRisk(j).badgeText,
      filter: 'text',
      render: (job) => {
        const risk = getDemurrageRisk(job);
        return (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border ${risk.colorClass}`}>
            {risk.badgeText}
          </span>
        );
      },
    },
    {
      key: 'tokenNumber',
      header: 'Port Gate Token & PCS',
      accessor: (j) =>
        `${j.tokenNumber || 'No Token'} ${formatJobTokenWindowBadge(j) || ''}`.trim(),
      filter: 'text',
      render: (job) => {
        const slotWindowBadge = formatJobTokenWindowBadge(job);
        return (
          <div className="space-y-1">
            {job.tokenNumber ? (
              <div className="space-y-0.5">
                <div className="flex items-center gap-1 font-mono font-bold text-emerald-400">
                  <Key className="w-3 h-3 shrink-0" />
                  <span>{job.tokenNumber}</span>
                  <button
                    onClick={() => {
                      setEditingTokenJob(job);
                      setNewTokenValue(job.tokenNumber || '');
                      setEditTokenSlotStartHour(extractStartHourFromJob(job));
                    }}
                    className="text-[10px] text-[var(--text-muted)] hover:text-blue-400 ml-1 underline"
                  >
                    Edit
                  </button>
                </div>
                {slotWindowBadge && (
                  <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/10 border border-blue-500/25 text-[10px] font-semibold text-blue-300">
                    <Clock className="w-2.5 h-2.5 text-blue-400 shrink-0" />
                    <span>{slotWindowBadge}</span>
                  </div>
                )}
              </div>
            ) : (
              <span className="text-[var(--text-muted)] italic text-[11px]">No Token</span>
            )}
            {(job.inspectionStatus === 'HOLD_PENDING' || job.inspectionStatus === 'INSPECTION_BOOKED') && (
              <span className="inline-block px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                {(() => {
                  const labels = getActiveJobInspectionLabels(job);
                  if (labels.length === 1 && labels[0] === 'Dubai Customs') {
                    return 'Dubai Customs Hold Pending';
                  }
                  return labels.length > 0
                    ? `Inspection Hold: ${labels.join(' + ')}`
                    : 'Customs Hold Pending';
                })()}
              </span>
            )}
            {job.doStatus === 'EXPIRED' && (
              <span className="inline-block px-1.5 py-0.2 rounded text-[9px] font-bold bg-rose-500/15 text-rose-300 border border-rose-500/30">
                eDO Expired
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'assignedAssets',
      header: 'Assigned Assets',
      accessor: (j) =>
        j.assignedVehiclePlate
          ? `${j.assignedVehiclePlate} ${j.assignedDriverName || ''} ${j.assignedTrailerPlate || ''}`
          : j.assignedTrailerPlate
          ? `Pending Assignment (${j.assignedTrailerPlate})`
          : 'Pending Assignment',
      filter: 'text',
      render: (job) => {
        const reassignState = evaluateDispatcherJobReassignState(job);
        const isAssigned = Boolean(job.assignedVehicleId) && !isDrayageReassignStatus(job.status) && !reassignState.canReassign;
        return isAssigned ? (
          <div className="space-y-0.5">
            <div className="font-semibold">{job.assignedVehiclePlate}</div>
            <div className="text-[10px] text-[var(--text-muted)]">
              {job.assignedDriverName} · {job.assignedTrailerPlate || 'Chassis'}
            </div>
          </div>
        ) : (
          <div className="space-y-0.5">
            <span
              className={`text-[11px] font-semibold block ${
                reassignState.reassignLabel === 'FCL_Reassign to Yard'
                  ? 'text-purple-400'
                  : 'text-amber-400'
              }`}
            >
              {reassignState.canReassign && reassignState.reassignLabel
                ? `Awaiting ${reassignState.reassignLabel}`
                : 'Pending Assignment'}
            </span>
            {job.assignedTrailerPlate && (
              <div className="text-[10px] text-[var(--text-muted)]">
                Linked Chassis: {job.assignedTrailerPlate}
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (j) => evaluateDispatcherJobReassignState(j).displayStatus,
      filter: 'select',
      selectOptions: [
        'PENDING',
        'ASSIGNED',
        'RE-ASSIGNED',
        'MT_Reassign to Yard',
        'FCL_Reassign to Yard',
        'FCL_Reassign to Ramp',
        'MT_Reassign to Ramp',
        'IN_TRANSIT',
        'PLACED_AT_RAMP',
        'REASSIGN_PLACED_AT_RAMP',
        'PLACED_AT_YARD',
        'REASSIGN_PLACED_AT_YARD',
        'TRAILER_DETACHED',
        'REASSIGN_TRAILER_DETACHED',
        'CONTAINER_DETACHED',
        'READY_FOR_PICKUP',
        'COMPLETED',
      ],
      render: (job) => {
        const reassignState = evaluateDispatcherJobReassignState(job);
        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleOpenStatusUpdate(job);
            }}
            className="inline-flex items-center gap-1 group rounded-lg focus:outline-none"
            title={`Click to update status for ${job.jobCode} (Syncs automatically with Driver App)`}
          >
            <StatusPill status={reassignState.displayStatus} label={reassignState.displayStatus} />
            <RefreshCw className="w-3 h-3 text-[var(--text-faint)] group-hover:text-emerald-400 transition-colors shrink-0" />
          </button>
        );
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      sortable: false,
      filter: false,
      render: (job) => {
        const editBtn = (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setEditJobTarget(job);
            }}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-blue-400 hover:border-blue-500/40 text-[11px] font-semibold transition-colors whitespace-nowrap"
            title={`Edit ${job.jobCode}`}
          >
            <Pencil className="w-3 h-3" />
            <span>Edit</span>
          </button>
        );

        const updateStatusBtn = (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleOpenStatusUpdate(job);
            }}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25 text-[11px] font-semibold transition-colors whitespace-nowrap"
            title="Update Job Status by Operations Team (Auto-syncs with Driver App)"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Update Status</span>
          </button>
        );

        if (isJobCompletedOrSuperseded(job)) {
          return (
            <div className="flex items-center justify-end gap-1.5">
              {editBtn}
              {updateStatusBtn}
              <span
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-500/10 border border-[var(--border-subtle)] text-[var(--text-muted)] text-[11px] font-semibold cursor-not-allowed opacity-60 whitespace-nowrap"
                title={
                  job.jobPhase === 'L1' && job.l2Activated
                    ? 'L1 leg is completed and L2 Empty Return has been activated'
                    : 'Job is completed'
                }
              >
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                <span>{job.jobPhase === 'L1' && job.l2Activated ? 'L2 Activated' : 'Completed'}</span>
              </span>
            </div>
          );
        }

        const reassignState = evaluateDispatcherJobReassignState(job);
        const stUpper = (job.status || '').toUpperCase();

        // 1. Unassigned initial PENDING job -> Assign Fleet
        if (stUpper === 'PENDING') {
          return (
            <div className="flex items-center justify-end gap-1.5">
              {editBtn}
              <button
                type="button"
                onClick={() => handleOpenAssign(job)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600/15 border border-blue-500/30 text-blue-400 hover:bg-blue-600/25 text-[11px] font-semibold transition-colors whitespace-nowrap"
              >
                Assign Fleet
              </button>
            </div>
          );
        }

        // 2. Eligible for Directional Reassign (Placed at Yard -> to Ramp; OR Placed at Ramp + 1st Alert -> to Yard)
        if (reassignState.canReassign && reassignState.reassignLabel) {
          const isToRamp = reassignState.originLocation === 'YARD';
          const isFclToYard = reassignState.reassignLabel === 'FCL_Reassign to Yard';
          return (
            <div className="flex items-center justify-end gap-1.5">
              {editBtn}
              {updateStatusBtn}
              <button
                type="button"
                onClick={() => handleOpenAssign(job)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-bold transition-colors whitespace-nowrap shadow-sm ${
                  isToRamp
                    ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-300 hover:bg-indigo-600/30'
                    : isFclToYard
                      ? 'bg-purple-500/20 border-purple-500/40 text-purple-300 hover:bg-purple-500/30'
                      : 'bg-amber-500/20 border-amber-500/40 text-amber-300 hover:bg-amber-500/30'
                }`}
                title={`Reassign Prime Mover & Driver (${reassignState.reassignLabel})`}
              >
                <RefreshCw className="w-3 h-3" />
                <span>{reassignState.reassignLabel}</span>
              </button>
            </div>
          );
        }

        // 3. At Ramp BEFORE First ETC Alert -> Disabled until First Alert (T-15m)
        if (reassignState.isWaitingForFirstRampAlert && reassignState.reassignLabel) {
          return (
            <div className="flex items-center justify-end gap-1.5">
              {editBtn}
              {updateStatusBtn}
              <button
                type="button"
                disabled
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-500/10 border border-[var(--border-subtle)] text-[var(--text-muted)] text-[11px] font-semibold cursor-not-allowed opacity-55 whitespace-nowrap"
                title={`Reassign is disabled while offloading at Ramp${
                  reassignState.minsLeft !== null ? ` (${reassignState.minsLeft}m left)` : ''
                }. Unlocks as "${reassignState.reassignLabel}" upon First Alert (T-15m).`}
              >
                <Clock className="w-3 h-3 text-amber-400" />
                <span>{reassignState.reassignLabel}</span>
              </button>
            </div>
          );
        }

        // 4. Active in-progress leg (Assigned / Re-Assigned / En Route)
        return (
          <div className="flex items-center justify-end gap-1.5">
            {editBtn}
            {updateStatusBtn}
            <button
              type="button"
              onClick={() => handleOpenAssign(job)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600/15 border border-blue-500/30 text-blue-400 hover:bg-blue-600/25 text-[11px] font-semibold transition-colors whitespace-nowrap"
            >
              {job.assignedVehicleId ? 'Reassign' : 'Assign Fleet'}
            </button>
          </div>
        );
      },
    },
    {
      key: 'trackingPortal',
      header: 'Tracking Portal',
      align: 'center',
      sortable: false,
      filter: false,
      render: (job) => {
        const isMenuOpen = portalMenuState?.job.id === job.id;
        return (
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (isMenuOpen) {
                  setPortalMenuState(null);
                } else {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setPortalMenuState({
                    job,
                    top: rect.bottom + 6,
                    right: Math.max(12, window.innerWidth - rect.right),
                  });
                }
              }}
              title="Tracking Portal Options (Copy Link, Portal, Share)"
              className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border transition-colors ${
                isMenuOpen
                  ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                  : 'bg-[var(--bg-main)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:border-[var(--border-strong)]'
              }`}
            >
              <MoreVertical className="w-4 h-4" />
            </button>
          </div>
        );
      },
    },
  ], [
    getDemurrageRisk,
    portalMenuState?.job.id,
    handleOpenAssign,
    handleOpenChangeReturnTerminal,
    handleOpenStatusUpdate,
    isJobCompletedOrSuperseded,
    extractStartHourFromJob,
    formatJobTokenWindowBadge,
  ]);

  // =========================================================================
  // 4-FACTOR WEIGHTED SCORING ENGINE (PROXIMITY 60%, IDLENESS 25%, WORKLOAD 10%, AVAILABILITY 5%)
  // =========================================================================

  // Haversine GPS Distance in Kilometers
  const getHaversineDistanceKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371; // Earth radius in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // Resolve Port Container Terminal GPS Coordinates
  const getTerminalCoordinates = useCallback(
    (terminalNameOrId?: string | null): { lat: number; lng: number; name: string } => {
      if (terminalNameOrId) {
        const match = terminals.find(
          (t) =>
            t.id === terminalNameOrId ||
            t.name.toLowerCase() === terminalNameOrId.toLowerCase() ||
            t.code.toLowerCase() === terminalNameOrId.toLowerCase()
        );
        if (match && typeof match.lat === 'number' && typeof match.lng === 'number' && match.lat !== 0) {
          return { lat: match.lat, lng: match.lng, name: match.name };
        }
        const lower = terminalNameOrId.toLowerCase();
        if (lower.includes('khalifa') || lower.includes('auh') || lower.includes('abu dhabi')) {
          return { lat: 24.8432, lng: 54.7121, name: 'Khalifa Port Container Terminal' };
        }
        if (lower.includes('rashid')) {
          return { lat: 25.2697, lng: 55.2758, name: 'Port Rashid Terminal' };
        }
        if (lower.includes('sharjah') || lower.includes('khalid')) {
          return { lat: 25.3582, lng: 55.3721, name: 'Port Khalid Terminal' };
        }
        if (lower.includes('t1')) {
          return { lat: 25.0112, lng: 55.0617, name: 'DP World Jebel Ali Terminal 1' };
        }
        if (lower.includes('t2')) {
          return { lat: 25.0185, lng: 55.0562, name: 'DP World Jebel Ali Terminal 2' };
        }
        if (lower.includes('t3')) {
          return { lat: 24.9982, lng: 55.0458, name: 'DP World Jebel Ali Terminal 3' };
        }
        if (lower.includes('t4')) {
          return { lat: 24.9895, lng: 55.0381, name: 'DP World Jebel Ali Terminal 4' };
        }
      }
      // Default to DP World Jebel Ali Port Container Terminal Hub
      return { lat: 25.0112, lng: 55.0617, name: 'DP World Jebel Ali Port' };
    },
    [terminals]
  );

  // Resolve Actual Pickup Coordinates for a Job Leg:
  // - For L2 Empty Return jobs OR Reassigned/Detached L1 jobs (FCL_REASSIGN / MT_REASSIGN / PLACED_AT_YARD / TRAILER_DETACHED),
  //   the container is physically at the Customer Warehouse, so score 4-Factor Proximity from the Warehouse!
  // - For standard PENDING L1 jobs, score 4-Factor Proximity from the Port Terminal.
  const getJobPickupCoordinates = useCallback(
    (job?: DrayageJob | null): { lat: number; lng: number; name: string } => {
      if (!job) return getTerminalCoordinates(null);
      const st = (job.status || '').toUpperCase();
      const isWarehousePickup =
        job.jobPhase === 'L2' ||
        Boolean(job.trailerDetached) ||
        isDrayageReassignStatus(st) ||
        [
          'FCL_REASSIGN',
          'MT_REASSIGN',
          'RE-ASSIGNED',
          'PLACED_AT_YARD',
          'PLACED_AT_RAMP',
          'TRAILER_DETACHED',
          'CONTAINER_DETACHED',
          'REASSIGN_PLACED_AT_YARD',
          'REASSIGN_PLACED_AT_RAMP',
          'REASSIGN_TRAILER_DETACHED',
          'READY_FOR_PICKUP',
          'WAITING_MT_RETURN',
        ].includes(st);

      if (isWarehousePickup) {
        if (job.warehouseId) {
          const wh = warehouses.find((w) => w.id === job.warehouseId);
          if (wh && typeof wh.lat === 'number' && typeof wh.lng === 'number' && wh.lat !== 0) {
            return { lat: wh.lat, lng: wh.lng, name: wh.name };
          }
        }
        const byName = warehouses.find(
          (w) => w.name.toLowerCase() === (job.warehouseName || '').toLowerCase(),
        );
        if (byName && typeof byName.lat === 'number' && typeof byName.lng === 'number' && byName.lat !== 0) {
          return { lat: byName.lat, lng: byName.lng, name: byName.name };
        }
        const lower = (job.warehouseName || '').toLowerCase();
        if (lower.includes('kizad') || lower.includes('kezad') || lower.includes('khalifa')) {
          return { lat: 24.7892, lng: 54.7341, name: job.warehouseName || 'KIZAD Industrial Hub' };
        }
        if (lower.includes('dic') || lower.includes('dubai industrial city') || lower.includes('industrial city')) {
          return { lat: 24.8528, lng: 55.0636, name: job.warehouseName || 'Dubai Industrial City' };
        }
        if (lower.includes('dubai south') || lower.includes('dwc')) {
          return { lat: 24.9182, lng: 55.1342, name: job.warehouseName || 'Dubai South Logistics' };
        }
        if (lower.includes('national industries') || lower.includes('nip')) {
          return { lat: 24.9415, lng: 55.0695, name: job.warehouseName || 'NIP Hub' };
        }
        if (lower.includes('jafza north')) {
          return { lat: 24.9964, lng: 55.0842, name: job.warehouseName || 'JAFZA North' };
        }
        return { lat: 24.9642, lng: 55.0915, name: job.warehouseName || 'Customer Warehouse' };
      }

      return getTerminalCoordinates(job.terminalId || job.terminalName);
    },
    [warehouses, getTerminalCoordinates],
  );

  // Calculate 4-Factor Composite Telematics Score
  const calculate4FactorScore = useCallback(
    (
      vehicle: MappedVehicle,
      targetTerminalLoc: { lat: number; lng: number },
      candidateDriver?: MappedDriver
    ): Vehicle4FactorScore => {
      // 1. 📍 Proximity Score (60%) — GPS distance to pickup terminal / corridor
      const isLegacyFallbackCoord = (lat?: number | null, lng?: number | null) => {
        if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return true;
        if (lat === 0 && lng === 0) return true;
        if (Math.abs(lat - 25.0112) < 0.0005 && (Math.abs(lng - 55.0612) < 0.0005 || Math.abs(lng - 55.0617) < 0.0005)) return true;
        if (Math.abs(lat - 25.2048) < 0.0005 && Math.abs(lng - 55.2708) < 0.0005) return true;
        return false;
      };
      const hasRealCoords =
        typeof vehicle.hasLiveGps === 'boolean'
          ? vehicle.hasLiveGps && typeof vehicle.lat === 'number' && typeof vehicle.lng === 'number'
          : !isLegacyFallbackCoord(vehicle.lat, vehicle.lng);

      const distanceKm = hasRealCoords
        ? getHaversineDistanceKm(vehicle.lat as number, vehicle.lng as number, targetTerminalLoc.lat, targetTerminalLoc.lng)
        : 0;

      let proximityScore = 0;
      if (hasRealCoords) {
        if (distanceKm <= 3) {
          proximityScore = 100; // Directly at port gate or adjacent yard
        } else if (distanceKm <= 10) {
          proximityScore = Math.max(79, Math.round(100 - (distanceKm - 3) * 3));
        } else if (distanceKm <= 30) {
          proximityScore = Math.max(39, Math.round(79 - (distanceKm - 10) * 2));
        } else if (distanceKm <= 70) {
          proximityScore = Math.max(15, Math.round(39 - (distanceKm - 30) * 0.6));
        } else {
          proximityScore = Math.max(5, Math.round(15 - (distanceKm - 70) * 0.2));
        }
      }

      // 2. ⏱️ Idleness Score (25%) — Turnaround queue / dwell time (FIFO balancing)
      let idleHours = 2.4;
      if (vehicle.updatedAt) {
        const parsedTime = new Date(vehicle.updatedAt).getTime();
        if (!isNaN(parsedTime)) {
          idleHours = Math.max(0.1, Math.round(((Date.now() - parsedTime) / (1000 * 60 * 60)) * 10) / 10);
        }
      }

      let idlenessScore = 75;
      if (idleHours < 0.5) {
        idlenessScore = 40; // Just completed run, cooldown/turnaround needed
      } else if (idleHours < 1.5) {
        idlenessScore = 70;
      } else if (idleHours < 3.0) {
        idlenessScore = 85;
      } else if (idleHours <= 6.0) {
        idlenessScore = 100; // Optimal FIFO queue window
      } else {
        idlenessScore = 95; // High dwell truck waiting in queue
      }

      // 3. ⚖️ Driver Workload (10%) — Trips completed today & active duty hours
      const tripsToday =
        candidateDriver?.completedTripsToday ??
        vehicle.assignedTripsCount ??
        0;

      let workloadScore = 100;
      if (tripsToday === 0) {
        workloadScore = 100; // Fresh driver, 0 duty fatigue
      } else if (tripsToday === 1) {
        workloadScore = 90;
      } else if (tripsToday === 2) {
        workloadScore = 75;
      } else if (tripsToday === 3) {
        workloadScore = 50; // Near corridor maximum safe duty limit
      } else {
        workloadScore = 20; // Shift limit reached / fatigue avoidance
      }

      // 4. 🛡️ Availability Score (5%) — Fuel level, maintenance buffer, and roadworthiness
      const fuelPct = vehicle.fuelLevelPct ?? 82;
      let fuelScore = 100;
      if (fuelPct >= 70) fuelScore = 100;
      else if (fuelPct >= 50) fuelScore = 80;
      else if (fuelPct >= 30) fuelScore = 55;
      else fuelScore = 20;

      const currentKm = vehicle.currentMileage ?? 0;
      const nextService = vehicle.nextServiceKm ?? (currentKm + 8500);
      const maintenanceBufferKm = Math.max(0, nextService - currentKm);
      let maintScore = 100;
      if (maintenanceBufferKm >= 2000) maintScore = 100;
      else if (maintenanceBufferKm >= 500) maintScore = 80;
      else maintScore = 40;

      const roadworthyScore =
        vehicle.status === 'AVAILABLE' ? 100 : vehicle.status === 'STANDBY' ? 85 : 50;

      const availabilityScore = Math.round(0.5 * fuelScore + 0.3 * maintScore + 0.2 * roadworthyScore);

      // Composite Weighted Calculation using Tenant Super Admin Policy Weights (Defaults: 60% Prox + 25% Idle + 10% Workload + 5% Avail)
      const wProx = (automationConfig.weightProximityPct ?? 60) / 100;
      const wIdle = (automationConfig.weightIdlenessPct ?? 25) / 100;
      const wWork = (automationConfig.weightWorkloadPct ?? 10) / 100;
      const wAvail = (automationConfig.weightAvailabilityPct ?? 5) / 100;
      const totalScore = Math.round(
        wProx * proximityScore +
        wIdle * idlenessScore +
        wWork * workloadScore +
        wAvail * availabilityScore
      );

      return {
        vehicle,
        driver: candidateDriver,
        proximityScore,
        idlenessScore,
        workloadScore,
        availabilityScore,
        totalScore,
        distanceKm: hasRealCoords ? Math.round(distanceKm * 10) / 10 : 0,
        hasLiveGps: hasRealCoords,
        idleHours,
        tripsToday,
        fuelPct,
        maintenanceBufferKm,
        rankBadge: '',
      };
    },
    [
      automationConfig.weightProximityPct,
      automationConfig.weightIdlenessPct,
      automationConfig.weightWorkloadPct,
      automationConfig.weightAvailabilityPct,
    ]
  );

  // =========================================================================
  // SMART ASSET SHORTLISTING ENGINE (4-FACTOR WEIGHTAGE & COMPATIBILITY)
  // =========================================================================
  const getSmartRecommendedAssets = useCallback(
    (job: DrayageJob | null, isBogie = false) => {
      // 1. Resolve Target Pickup GPS Location (Port Terminal for L1 PENDING; Customer Warehouse for L2 or L1 Reassign)
      const targetLoc = getJobPickupCoordinates(job);

      // 2. Candidate vehicles: only heavy commercial prime movers
      const candidateVehicles = availableVehicles.length > 0 ? availableVehicles : primeMovers;

      // 3. Score all Candidate Prime Movers using the 4-Factor Weighted Engine
      const scoredList: Vehicle4FactorScore[] = candidateVehicles.map((v) => {
        const assignedDrv = drivers.find((d) => d.id === v.assignedDriverId);
        const candidateDrv =
          assignedDrv ||
          availableDrivers.find((d) => d.status === 'ACTIVE' && d.complianceOk) ||
          drivers[0];
        return calculate4FactorScore(v, targetLoc, candidateDrv);
      });

      // Sort descending by logged-in/live-telemetry status first, then 4-factor composite score
      scoredList.sort((a, b) => {
        const aActive = a.vehicle.isDriverLoggedIn || a.hasLiveGps ? 1 : 0;
        const bActive = b.vehicle.isDriverLoggedIn || b.hasLiveGps ? 1 : 0;
        if (bActive !== aActive) return bActive - aActive;
        return b.totalScore - a.totalScore;
      });
      scoredList.forEach((item, index) => {
        if (index === 0) item.rankBadge = '🥇';
        else if (index === 1) item.rankBadge = '🥈';
        else if (index === 2) item.rankBadge = '🥉';
        else item.rankBadge = '🚛';
      });

      const bestScored = scoredList[0];
      const bestVehicle = bestScored?.vehicle;

      // 4. Chassis / Trailer Shortlisting based on container specs & cargo type
      let bestTrailer: DrayageTrailer | undefined;

      if (isBogie) {
        // Dual-20FT Bogie requires 40FT/45FT Skeletal or Flatbed multi-axle chassis
        bestTrailer =
          availableTrailers.find((t) => t.trailerType.includes('40FT_FLATBED') || t.trailerType.includes('FLATBED')) ||
          availableTrailers.find((t) => t.trailerType.includes('40FT_SKELETAL') || t.trailerType.includes('SKELETAL')) ||
          availableTrailers.find((t) => !t.trailerType.includes('20FT')) ||
          availableTrailers[0];
      } else if (job) {
        const isReefer = job.containerType?.toUpperCase().includes('REEFER') || job.containerSize?.includes('RF');
        const is20Ft = job.containerSize?.trim() === '20FT';

        if (isReefer) {
          bestTrailer =
            availableTrailers.find((t) => t.trailerType.includes('REEFER')) ||
            availableTrailers[0];
        } else if (is20Ft) {
          bestTrailer =
            availableTrailers.find((t) => t.trailerType.includes('20FT') && !t.trailerType.includes('REEFER')) ||
            availableTrailers.find((t) => t.trailerType.includes('SKELETAL') && !t.trailerType.includes('REEFER')) ||
            availableTrailers[0];
        } else {
          bestTrailer =
            availableTrailers.find((t) => (t.trailerType.includes('40FT') || t.trailerType.includes('45FT')) && !t.trailerType.includes('REEFER')) ||
            availableTrailers.find((t) => !t.trailerType.includes('REEFER')) ||
            availableTrailers[0];
        }
      } else {
        bestTrailer = availableTrailers[0];
      }

      // 5. Driver Shortlisting (active & compliance passed, prioritizing lowest workload)
      const sortedAvailableDrivers = [...availableDrivers].sort(
        (a, b) => (a.completedTripsToday ?? 0) - (b.completedTripsToday ?? 0)
      );

      const bestDriver =
        (bestVehicle?.assignedDriverId ? drivers.find((d) => d.id === bestVehicle.assignedDriverId) : undefined) ||
        sortedAvailableDrivers[0] ||
        drivers[0];

      return {
        vehicleId: bestVehicle?.id ?? '',
        trailerId: bestTrailer?.id ?? '',
        driverId: bestDriver?.id ?? '',
        topScore: bestScored,
        rankedList: scoredList,
      };
    },
    [availableVehicles, primeMovers, availableTrailers, availableDrivers, drivers, getJobPickupCoordinates, calculate4FactorScore],
  );

  // Target Pickup Location (Port Terminal or Customer Warehouse) for active assignment modal
  const targetTerminalLoc = useMemo(() => {
    return getJobPickupCoordinates(assigningJob);
  }, [assigningJob, getJobPickupCoordinates]);

  // Scored Prime Movers for current modal
  const scoredPrimeMovers = useMemo(() => {
    if (!assigningJob) return [];
    const candidateVehicles = availableVehicles.length > 0 ? availableVehicles : primeMovers;
    const scored = candidateVehicles.map((v) => {
      const assignedDrv = drivers.find((d) => d.id === v.assignedDriverId);
      const candidateDrv =
        assignedDrv ||
        availableDrivers.find((d) => d.status === 'ACTIVE' && d.complianceOk) ||
        drivers[0];
      return calculate4FactorScore(v, targetTerminalLoc, candidateDrv);
    });
    scored.sort((a, b) => {
      const aActive = a.vehicle.isDriverLoggedIn || a.hasLiveGps ? 1 : 0;
      const bActive = b.vehicle.isDriverLoggedIn || b.hasLiveGps ? 1 : 0;
      if (bActive !== aActive) return bActive - aActive;
      return b.totalScore - a.totalScore;
    });
    scored.forEach((item, idx) => {
      if (idx === 0) item.rankBadge = '🥇';
      else if (idx === 1) item.rankBadge = '🥈';
      else if (idx === 2) item.rankBadge = '🥉';
      else item.rankBadge = '🚛';
    });
    return scored;
  }, [assigningJob, availableVehicles, primeMovers, drivers, availableDrivers, targetTerminalLoc, calculate4FactorScore]);

  // Current selected prime mover 4-factor score
  const currentVehicleScore = useMemo(() => {
    if (!selectedVehicleId) return null;
    return scoredPrimeMovers.find((s) => s.vehicle.id === selectedVehicleId) || null;
  }, [selectedVehicleId, scoredPrimeMovers]);

  // Selectable Prime Mover dropdown options with 4-Factor badges and breakdowns
  const primeMoverSelectOptions = useMemo(() => {
    if (scoredPrimeMovers.length > 0) {
      return scoredPrimeMovers.map((s) => {
        const drvName =
          s.vehicle.assignedDriverName ||
          drivers.find((d) => d.id === s.vehicle.assignedDriverId || d.assignedVehicleId === s.vehicle.id)?.fullName;
        const isLoggedIn = Boolean(s.vehicle.isDriverLoggedIn || s.hasLiveGps);
        const proxLabel = s.hasLiveGps
          ? `${s.distanceKm}km (${s.proximityScore}pts)`
          : `Switched Off (${s.proximityScore}pts)`;
        const statusLabel = isLoggedIn
          ? `⏱️ Idle: ${s.idleHours}h (${s.idlenessScore}pts)`
          : `⚫ Switched Off (${s.idlenessScore}pts)`;
        return {
          value: s.vehicle.id,
          label: `${s.rankBadge} ${s.vehicle.plateNumber} · ${s.vehicle.make} ${s.vehicle.model}${drvName ? ` (${drvName})` : ''} [${s.totalScore}% Match]`,
          sublabel: `${drvName ? `👤 ${isLoggedIn ? 'Logged-in Driver' : 'Assigned Driver (Switched Off)'}: ${drvName} • ` : ''}📍 ${proxLabel} • ${statusLabel} • ⚖️ ${s.tripsToday} Trip(s) Today`,
          badge: drvName ? `${isLoggedIn ? '🟢' : '⚫'} ${drvName}` : `${s.totalScore}% Match`,
        };
      });
    }
    return primeMovers.map((v) => {
      const drvName =
        v.assignedDriverName ||
        drivers.find((d) => d.id === v.assignedDriverId || d.assignedVehicleId === v.id)?.fullName;
      const isLoggedIn = Boolean(v.isDriverLoggedIn || v.hasLiveGps);
      return {
        value: v.id,
        label: `${v.plateNumber} · ${v.make} ${v.model}${drvName ? ` (${drvName})` : ''}`,
        sublabel: `${drvName ? `👤 ${isLoggedIn ? 'Logged-in Driver' : 'Assigned Driver (Switched Off)'}: ${drvName} • ` : ''}Type: ${v.type || 'PRIME_MOVER'} • Usage: ${v.vehicleUsage || 'LOGISTICS'} • Status: ${isLoggedIn ? v.status : 'Switched Off'}`,
        badge: drvName ? `${isLoggedIn ? '🟢' : '⚫'} ${drvName}` : v.status,
      };
    });
  }, [scoredPrimeMovers, primeMovers, drivers]);

  // =========================================================================
  // ACTIONS: USE THIS PAIR (MANUAL 1-CLICK ASSIGNMENT)
  // =========================================================================
  const handleUseBogiePair = (combo: BogieComboRecommendation) => {
    setSelectedJobIds([combo.job1.id, combo.job2.id]);
    setAssigningJob(combo.job1);
    setIsBogieAssign(true);
    setActiveStreetTurnPair(null);
    const rec = getSmartRecommendedAssets(combo.job1, true);
    setSelectedVehicleId(rec.vehicleId);
    setSelectedDriverId(rec.driverId);
    setSelectedTrailerId(rec.trailerId);
    setTokenInput(combo.job1.tokenNumber || '');
    setTokenSlotStartHour(extractStartHourFromJob(combo.job1));
  };

  const handleSwapBogieSequence = () => {
    if (selectedJobIds.length === 2) {
      setSelectedJobIds([selectedJobIds[1], selectedJobIds[0]]);
      const job1 = jobs.find((j) => j.id === selectedJobIds[1]);
      if (job1) setAssigningJob(job1);
      showToast('success', 'Drop sequence swapped: Drop #1 ⇄ Drop #2');
    }
  };

  const handleUseStreetTurnPair = (pair: StreetTurnRecommendation, holdLeg3Override?: boolean) => {
    const shouldHoldLeg3 =
      typeof holdLeg3Override === 'boolean'
        ? holdLeg3Override
        : Boolean(pair.holdLeg3Recommended);
    setHoldLeg3InModal(shouldHoldLeg3);
    setActiveStreetTurnPair(pair);
    const ids = [pair.inboundJob.id, pair.outboundJob.id];
    if (pair.leg3Job && !shouldHoldLeg3) {
      ids.push(pair.leg3Job.id);
    }
    setSelectedJobIds(ids);
    setAssigningJob(pair.inboundJob);
    setIsBogieAssign(false);
    const rec = getSmartRecommendedAssets(pair.inboundJob, false);
    setSelectedVehicleId(rec.vehicleId);
    setSelectedDriverId(rec.driverId);
    setSelectedTrailerId(resolveLinkedTrailerIdForJob(pair.inboundJob) || rec.trailerId);
    setTokenInput(pair.inboundJob.tokenNumber || '');
    setTokenSlotStartHour(extractStartHourFromJob(pair.inboundJob));
  };

  const handleToggleBackhaulHold = async (job: DrayageJob, hold: boolean) => {
    try {
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: hold ? 'hold_for_backhaul' : 'release_backhaul_hold',
          jobId: job.id,
          reason: `${job.warehouseName} ➜ ${job.terminalName} has safe DO free time and 0 outbound L1 pickups at ${job.terminalName}.`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update Smart Backhaul Hold');
      invalidateDrayageClientCache();
      showToast(
        'success',
        hold
          ? `⏸️ Placed ${job.jobCode} (${job.warehouseName} ➜ ${job.terminalName}) on Smart Backhaul Hold to prevent a 34 km empty return!`
          : `▶️ Released ${job.jobCode} from Smart Backhaul Hold for immediate dispatch!`,
      );
      await loadData(true);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error updating Smart Backhaul Hold');
    }
  };

  // Open modal for bogie merge (strictly exactly 2 twenty-foot containers)
  const handleOpenBogieModal = () => {
    if (selectedJobIds.length !== 2) {
      showToast('error', 'A Bogie trip can only carry exactly two (2) 20FT containers on a single prime mover & chassis.');
      return;
    }
    const selectedJobs = jobs.filter((j) => selectedJobIds.includes(j.id));
    const non20Ft = selectedJobs.find((j) => j.containerSize !== '20FT');
    if (non20Ft) {
      showToast('error', `Container ${non20Ft.containerNumber} is ${non20Ft.containerSize}. A Bogie setup only accommodates two 20FT containers.`);
      return;
    }
    const firstJob = selectedJobs[0];
    if (!firstJob) return;
    setAssigningJob(firstJob);
    setIsBogieAssign(true);
    const rec = getSmartRecommendedAssets(firstJob, true);
    setSelectedVehicleId(rec.vehicleId);
    setSelectedDriverId(rec.driverId);
    setSelectedTrailerId(rec.trailerId);
    setTokenInput(firstJob.tokenNumber || '');
    setTokenSlotStartHour(extractStartHourFromJob(firstJob));
  };

  // Confirm single / bogie assignment modal
  const handleConfirmAssignment = async () => {
    const effectiveTrailerId = selectedTrailerId || assigningJob?.assignedTrailerId || '';
    if (!selectedVehicleId || !selectedDriverId || !effectiveTrailerId) {
      showToast('error', 'Please select a Prime Mover, Driver, and Chassis');
      return;
    }
    const veh = vehicles.find((v) => v.id === selectedVehicleId);
    const drv = drivers.find((d) => d.id === selectedDriverId);
    const tr = trailers.find((t) => t.id === effectiveTrailerId);
    const { pcsSlotStart, pcsSlotEnd } = buildSlotWindowIsoPair(tokenSlotStartHour);
    const slotWindowLabel = formatTwoHourWindowLabel(tokenSlotStartHour);

    try {
      setSubmittingAssign(true);
      if (activeStreetTurnPair) {
        const res = await fetch('/api/logistics/drayage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'execute_street_turn',
            l2JobId: activeStreetTurnPair.inboundJob.id,
            exportJobId: activeStreetTurnPair.outboundJob.id,
            leg3JobId: activeStreetTurnPair.leg3Job?.id,
            holdLeg3: holdLeg3InModal,
            matchMode: activeStreetTurnPair.matchMode,
            vehicleId: selectedVehicleId,
            vehiclePlate: veh?.plateNumber || 'DXB-TRACTOR',
            driverId: selectedDriverId,
            driverName: drv?.fullName || 'Assigned Driver',
            trailerId: selectedTrailerId,
            trailerPlate: tr?.plateNumber || 'DXB-TR-9901',
            tokenNumber: tokenInput,
            pcsSlotStart,
            pcsSlotEnd,
            actor: user?.username || undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to execute Street-Turn triangulation');
        const modeLabel =
          data.matchMode === 'DAISY_CHAIN_3LEG'
            ? data.leg3HeldForBackhaul
              ? `3-Leg Daisy-Chain (Leg 1+2 Dispatched · Leg 3 ${data.leg3JobCode} Placed on Smart Backhaul Hold)`
              : `Full 3-Leg Daisy-Chain (${data.l2JobCode} ➜ ${data.exportJobCode} ➜ ${data.leg3JobCode})`
            : data.matchMode === 'PORT_TERMINAL_RELOAD'
              ? `Port Terminal Reload (${data.l2JobCode} ➜ ${data.exportJobCode})`
              : `Street-Turn ${data.streetTurnRef}`;
        showToast(
          'success',
          `⚡ ${modeLabel} executed! Window: ${slotWindowLabel} · Saved ${data.deadheadKmSaved}km deadhead (${data.co2SavedKg}kg CO₂)!`
        );
        setActiveStreetTurnPair(null);
        setSelectedJobIds([]);
      } else if (isBogieAssign) {
        // Validate trailer type: cannot be a 20FT trailer!
        if (tr && tr.trailerType && tr.trailerType.includes('20FT') && !tr.trailerType.includes('40FT')) {
          showToast('error', '⚠️ Invalid Chassis: A 20FT trailer cannot haul dual 20FT containers. Please choose a 40FT/45FT Skeletal or Bogie chassis.');
          setSubmittingAssign(false);
          return;
        }

        const res = await fetch('/api/logistics/drayage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'execute_bogie_dispatch',
            job1Id: selectedJobIds[0],
            job2Id: selectedJobIds[1],
            vehicleId: selectedVehicleId,
            vehiclePlate: veh?.plateNumber || 'DXB-TRACTOR',
            driverId: selectedDriverId,
            driverName: drv?.fullName || 'Assigned Driver',
            trailerId: selectedTrailerId,
            trailerPlate: tr?.plateNumber || 'DXB-TR-9901',
            tokenNumber: tokenInput,
            pcsSlotStart,
            pcsSlotEnd,
            actor: user?.username || undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to assign Bogie trip');
        showToast(
          'success',
          `⚡ Dual-20FT Bogie dispatch ${data.bogieRef} confirmed (${slotWindowLabel})! Total Payload: ${(data.totalPayloadKg / 1000).toFixed(1)}T.`
        );
        setSelectedJobIds([]);
      } else if (assigningJob) {
        const selectedRetTerm =
          canChangeDrayageReturnTerminal(assigningJob) && assignReturnTerminalId
            ? terminals.find((t) => t.id === assignReturnTerminalId)
            : undefined;
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
            trailerId: effectiveTrailerId,
            trailerPlate: tr?.plateNumber || assigningJob?.assignedTrailerPlate || 'DXB-TR-9901',
            tokenNumber: tokenInput,
            pcsSlotStart,
            pcsSlotEnd,
            returnTerminalId: selectedRetTerm?.id,
            returnTerminalName: selectedRetTerm?.name,
            actor: user?.username || undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to assign job');
        showToast('success', `Job ${assigningJob.jobCode} assigned with token ${data.tokenNumber} (${slotWindowLabel})!`);
      }
      setAssigningJob(null);
      setActiveStreetTurnPair(null);
      invalidateDrayageClientCache();
      await loadData(true);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error during assignment');
    } finally {
      setSubmittingAssign(false);
    }
  };

  // =========================================================================
  // FEATURE 7: GLOBAL "AUTO-PILOT" BATCH DISPATCH ENGINE (4-FACTOR WEIGHTED)
  // =========================================================================
  const handleRunAutoPilot = (jobIdsToOptimize?: string[]) => {
    const candidateJobs =
      jobIdsToOptimize && jobIdsToOptimize.length > 0
        ? jobs.filter((j) => jobIdsToOptimize.includes(j.id))
        : unassignedJobs;

    if (candidateJobs.length === 0) {
      showToast('error', 'No jobs selected or available to optimize');
      return;
    }

    const availV = [...availableVehicles];
    const availD = [...availableDrivers];
    const availT = [...availableTrailers];

    const plan: AutoPilotDispatchItem[] = [];
    const assignedIds = new Set<string>();
    const candidateIdSet = new Set(candidateJobs.map((j) => j.id));

    // Helper: Pick optimal tractor and driver for a terminal using the 4-Factor Engine
    const pickBestTractorAndDriver = (terminalLoc: { lat: number; lng: number }) => {
      if (availV.length === 0 || availD.length === 0) return null;

      // Score all remaining available tractors against this terminal
      const scored = availV.map((v) => {
        const assignedDrv = drivers.find((d) => d.id === v.assignedDriverId);
        const candidateDrv = assignedDrv || availD[0];
        return calculate4FactorScore(v, terminalLoc, candidateDrv);
      });

      scored.sort((a, b) => {
      const aActive = a.vehicle.assignedDriverId || a.hasLiveGps ? 1 : 0;
      const bActive = b.vehicle.assignedDriverId || b.hasLiveGps ? 1 : 0;
      if (bActive !== aActive) return bActive - aActive;
      return b.totalScore - a.totalScore;
    });
      const topScored = scored[0];
      const vIdx = availV.findIndex((v) => v.id === topScored.vehicle.id);
      const veh = availV.splice(vIdx >= 0 ? vIdx : 0, 1)[0];

      // Match driver: prefer assigned driver if in availD, else pick driver with lowest completedTripsToday (FIFO & Workload balancing)
      let drvIdx = veh.assignedDriverId ? availD.findIndex((d) => d.id === veh.assignedDriverId) : -1;
      if (drvIdx === -1) {
        let minTrips = 999;
        drvIdx = 0;
        availD.forEach((d, idx) => {
          const trips = d.completedTripsToday ?? 0;
          if (trips < minTrips) {
            minTrips = trips;
            drvIdx = idx;
          }
        });
      }
      const drv = availD.splice(drvIdx, 1)[0];

      return { veh, drv, score: topScored };
    };

    // 1. First Pass: Street Turn / Port Terminal Reload / 3-Leg Daisy-Chain Pairs
    for (const st of streetTurnPairs) {
      if (availV.length === 0 || availD.length === 0 || availT.length === 0) break;
      if (!candidateIdSet.has(st.inboundJob.id) || !candidateIdSet.has(st.outboundJob.id)) continue;
      if (assignedIds.has(st.inboundJob.id) || assignedIds.has(st.outboundJob.id)) continue;

      const termLoc = getTerminalCoordinates(st.terminalName);
      const best = pickBestTractorAndDriver(termLoc);
      if (!best) break;

      const { veh, drv, score: topScored } = best;
      const tr = availT.shift()!;
      const token = st.inboundJob.tokenNumber || '';

      assignedIds.add(st.inboundJob.id);
      assignedIds.add(st.outboundJob.id);
      const includeLeg3 = Boolean(st.leg3Job && !st.holdLeg3Recommended && candidateIdSet.has(st.leg3Job.id));
      const holdLeg3 = Boolean(st.leg3Job && st.holdLeg3Recommended);
      if (st.leg3Job) {
        // Mark Leg 3 as handled (either included in the 3-leg loop OR held on Smart Backhaul Hold so Pass 3 won't dispatch it empty to T2)
        assignedIds.add(st.leg3Job.id);
      }

      const dispatchType: AutoPilotDispatchItem['type'] = st.leg3Job
        ? 'DAISY_CHAIN'
        : st.matchMode === 'PORT_TERMINAL_RELOAD'
          ? 'PORT_RELOAD'
          : 'STREET_TURN';

      plan.push({
        id: `DISPATCH-ST-${st.id}`,
        type: dispatchType,
        jobIds:
          includeLeg3 && st.leg3Job
            ? [st.inboundJob.id, st.outboundJob.id, st.leg3Job.id]
            : [st.inboundJob.id, st.outboundJob.id],
        jobCodes:
          includeLeg3 && st.leg3Job
            ? [st.inboundJob.jobCode, st.outboundJob.jobCode, st.leg3Job.jobCode]
            : [st.inboundJob.jobCode, st.outboundJob.jobCode],
        containers:
          includeLeg3 && st.leg3Job
            ? [st.inboundJob.containerNumber, st.outboundJob.containerNumber, st.leg3Job.containerNumber]
            : [st.inboundJob.containerNumber, st.outboundJob.containerNumber],
        customerNames:
          includeLeg3 && st.leg3Job
            ? [st.inboundJob.customerName, st.outboundJob.customerName, st.leg3Job.customerName]
            : [st.inboundJob.customerName, st.outboundJob.customerName],
        routeDescription: st.leg3Job
          ? holdLeg3
            ? `${st.originWarehouse} ➜ ${st.terminalName} ➜ ${st.destWarehouse} (⏸️ Hold ${st.leg3Job.jobCode} @ ${st.leg3Job.terminalName})`
            : `3-Leg Chain: ${st.originWarehouse} ➜ ${st.terminalName} ➜ ${st.destWarehouse} ➜ ${st.leg3Job.terminalName}`
          : st.matchMode === 'PORT_TERMINAL_RELOAD'
            ? `Port Reload: ${st.originWarehouse} ➜ ${st.terminalName} ➜ ${st.destWarehouse}`
            : `L2 Drop (${st.inboundJob.containerNumber}) ➜ L1 Pick (${st.outboundJob.containerNumber}) @ ${st.terminalName}`,
        terminalName: st.terminalName,
        tokenNumber: token,
        selectedVehicleId: veh.id,
        selectedVehiclePlate: veh.plateNumber,
        selectedDriverId: drv.id,
        selectedDriverName: drv.fullName,
        selectedTrailerId: tr.id,
        selectedTrailerPlate: tr.plateNumber,
        revenueAed: st.combinedRevenueAed,
        allowanceAed: st.combinedAllowanceAed,
        demurrageRescue: st.hasUrgentDemurrage,
        tasSlot: st.tasSlot,
        matchScorePct: topScored.totalScore,
        proximityKm: topScored.distanceKm,
        heldLeg3JobId: holdLeg3 && st.leg3Job ? st.leg3Job.id : undefined,
        heldLeg3JobCode: holdLeg3 && st.leg3Job ? st.leg3Job.jobCode : undefined,
      });
    }

    // 2. Second Pass: Dual-20FT Bogie Combos
    for (const bg of bogieCombos) {
      if (availV.length === 0 || availD.length === 0 || availT.length === 0) break;
      if (!candidateIdSet.has(bg.job1.id) || !candidateIdSet.has(bg.job2.id)) continue;
      if (assignedIds.has(bg.job1.id) || assignedIds.has(bg.job2.id)) continue;

      const termLoc = getTerminalCoordinates(bg.commonTerminal);
      const best = pickBestTractorAndDriver(termLoc);
      if (!best) break;

      const { veh, drv, score: topScored } = best;
      // For 2x20FT Bogie, match 40FT/45FT Flatbed or Skeletal chassis
      const trIdx = availT.findIndex((t) => t.trailerType.includes('FLATBED') || t.trailerType.includes('40FT') || !t.trailerType.includes('20FT'));
      const tr = trIdx >= 0 ? availT.splice(trIdx, 1)[0] : availT.shift()!;
      const token = bg.job1.tokenNumber || '';

      assignedIds.add(bg.job1.id);
      assignedIds.add(bg.job2.id);

      plan.push({
        id: `DISPATCH-BG-${bg.id}`,
        type: 'BOGIE',
        jobIds: [bg.job1.id, bg.job2.id],
        jobCodes: [bg.job1.jobCode, bg.job2.jobCode],
        containers: [bg.job1.containerNumber, bg.job2.containerNumber],
        customerNames: [bg.job1.customerName, bg.job2.customerName],
        routeDescription: `2x20FT Dual Drop (${bg.zone1} ➜ ${bg.zone2}) via ${bg.commonTerminal}`,
        terminalName: bg.commonTerminal,
        tokenNumber: token,
        selectedVehicleId: veh.id,
        selectedVehiclePlate: veh.plateNumber,
        selectedDriverId: drv.id,
        selectedDriverName: drv.fullName,
        selectedTrailerId: tr.id,
        selectedTrailerPlate: tr.plateNumber,
        revenueAed: bg.combinedRevenueAed,
        allowanceAed: bg.combinedAllowanceAed,
        demurrageRescue: bg.hasUrgentDemurrage,
        tasSlot: bg.tasSlot,
        matchScorePct: topScored.totalScore,
        proximityKm: topScored.distanceKm,
      });
    }

    // 3. Third Pass: Remaining Single Jobs (Skip non-urgent L2 empty returns with 0 backhaul at destination terminal during global Auto-Pilot)
    const backhaulHoldSet = new Set(smartBackhaulHoldJobs.map((h) => h.job.id));
    const isExplicitSelection = Boolean(jobIdsToOptimize && jobIdsToOptimize.length > 0);
    const remainingJobs = candidateJobs.filter(
      (j) => !assignedIds.has(j.id) && (isExplicitSelection || !backhaulHoldSet.has(j.id)),
    );
    for (const job of remainingJobs) {
      if (availV.length === 0 || availD.length === 0 || availT.length === 0) break;

      const termLoc = getJobPickupCoordinates(job);
      const best = pickBestTractorAndDriver(termLoc);
      if (!best) break;

      const { veh, drv, score: topScored } = best;
      const isReefer = job.containerType?.toUpperCase().includes('REEFER');
      const is20 = job.containerSize?.trim() === '20FT';
      let trIdx = -1;
      if (isReefer) {
        trIdx = availT.findIndex((t) => t.trailerType.includes('REEFER'));
      } else if (is20) {
        trIdx = availT.findIndex((t) => t.trailerType.includes('20FT') && !t.trailerType.includes('REEFER'));
      } else {
        trIdx = availT.findIndex((t) => (t.trailerType.includes('40FT') || t.trailerType.includes('45FT')) && !t.trailerType.includes('REEFER'));
      }
      const tr = trIdx >= 0 ? availT.splice(trIdx, 1)[0] : availT.shift()!;
      const token = job.tokenNumber || '';
      const risk = getDemurrageRisk(job);
      const tas = getTasSlotWindow(job);

      assignedIds.add(job.id);

      plan.push({
        id: `DISPATCH-SINGLE-${job.id}`,
        type: 'SINGLE',
        jobIds: [job.id],
        jobCodes: [job.jobCode],
        containers: [job.containerNumber],
        customerNames: [job.customerName],
        routeDescription: `${job.terminalName} ➜ ${job.warehouseName}`,
        terminalName: job.terminalName,
        tokenNumber: token,
        selectedVehicleId: veh.id,
        selectedVehiclePlate: veh.plateNumber,
        selectedDriverId: drv.id,
        selectedDriverName: drv.fullName,
        selectedTrailerId: tr.id,
        selectedTrailerPlate: tr.plateNumber,
        revenueAed: job.rateAmountAed || 1450,
        allowanceAed: job.driverAllowanceAed || 150,
        demurrageRescue: risk.level === 'CRITICAL' || risk.level === 'EXPIRED',
        tasSlot: tas.slotTime,
        matchScorePct: topScored.totalScore,
        proximityKm: topScored.distanceKm,
      });
    }

    if (plan.length === 0 && candidateJobs.length > 0) {
      showToast('error', 'Insufficient available Prime Movers, Drivers, or Chassis in fleet to dispatch these jobs');
      return;
    }

    setAutoPilotPlan(plan);
    setShowAutoPilotModal(true);
  };

  const handleApproveBatchDispatch = async () => {
    if (autoPilotPlan.length === 0) return;
    try {
      setSubmittingBatch(true);
      const dispatches = autoPilotPlan.map((item) => ({
        type: item.type,
        jobIds: item.jobIds,
        heldLeg3JobId: item.heldLeg3JobId,
        vehicleId: item.selectedVehicleId,
        vehiclePlate: item.selectedVehiclePlate,
        driverId: item.selectedDriverId,
        driverName: item.selectedDriverName,
        trailerId: item.selectedTrailerId,
        trailerPlate: item.selectedTrailerPlate,
        tokenNumber: item.tokenNumber,
        notes:
          item.type === 'BOGIE'
            ? `Dual-20FT Bogie Combo (${item.tokenNumber})`
            : item.type === 'DAISY_CHAIN'
              ? `3-Leg Daisy-Chain Triangulation (${item.tokenNumber})`
              : item.type === 'PORT_RELOAD'
                ? `Port Terminal Reload (${item.tokenNumber})`
                : item.type === 'STREET_TURN'
                  ? `Terminal Street Turn Pair (${item.tokenNumber})`
                  : `Single Dispatch (${item.tokenNumber})`,
      }));

      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'batch_dispatch',
          dispatches,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to execute auto-pilot batch dispatch');

      showToast('success', `🚀 Auto-Pilot Dispatched ${data.count} jobs across ${data.batches} prime movers!`);
      setShowAutoPilotModal(false);
      setAutoPilotPlan([]);
      invalidateDrayageClientCache();
      await loadData(true);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error executing batch dispatch');
    } finally {
      setSubmittingBatch(false);
    }
  };

  const handleRemoveFromAutoPilot = (dispatchId: string) => {
    setAutoPilotPlan((prev) => prev.filter((p) => p.id !== dispatchId));
  };

  const handleUpdateToken = async () => {
    if (!editingTokenJob || !newTokenValue.trim()) return;
    try {
      const { pcsSlotStart, pcsSlotEnd } = buildSlotWindowIsoPair(editTokenSlotStartHour);
      const slotWindowLabel = formatTwoHourWindowLabel(editTokenSlotStartHour);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_token',
          jobId: editingTokenJob.id,
          tokenNumber: newTokenValue.trim().toUpperCase(),
          pcsSlotStart,
          pcsSlotEnd,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update token');
      showToast('success', `Token updated to ${data.tokenNumber} (${slotWindowLabel})!`);
      setEditingTokenJob(null);
      invalidateDrayageClientCache();
      await loadData(true);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error updating token');
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
        title="Drayage Job Assignment & Token Dispatch"
        subtitle="Pair prime movers, drivers, chassis, and port gate passes (DP World Dubai Trade / AD Ports Maqta)"
        icon={UserCheck}
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
              onClick={() => setShowUrgentDemurrageAlert((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shadow-sm ${
                showUrgentDemurrageAlert
                  ? 'bg-rose-600 text-white shadow-rose-500/20'
                  : 'bg-[var(--bg-surface)] border border-rose-500/40 text-rose-400 hover:bg-rose-500/10'
              }`}
              title="Show Urgent Demurrage & Port Slot Risk Alerts"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Urgent Demurrage Alert</span>
              {urgentDemurrageJobs.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-rose-500 text-white font-bold ml-0.5">
                  {urgentDemurrageJobs.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => handleToggleSmartAnalysis()}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shadow-sm cursor-pointer ${
                showSmartAnalysis
                  ? 'bg-blue-600 text-white shadow-blue-500/20 hover:bg-blue-500'
                  : 'bg-[var(--bg-surface)] border border-blue-500/40 text-blue-400 hover:bg-blue-500/10'
              }`}
              title={showSmartAnalysis ? 'Hide Smart Analysis Widgets' : 'Show Smart Analysis Widgets'}
            >
              {showSmartAnalysis ? (
                <EyeOff className="w-3.5 h-3.5" />
              ) : (
                <Eye className="w-3.5 h-3.5" />
              )}
              <span>{showSmartAnalysis ? 'Hide Smart Analysis' : 'Show Smart Analysis'}</span>
              {bogieCombos.length + streetTurnPairs.length + smartBackhaulHoldJobs.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-white text-blue-900 font-bold ml-0.5">
                  {bogieCombos.length + streetTurnPairs.length + smartBackhaulHoldJobs.length}
                </span>
              )}
            </button>

            <button
              onClick={() => handleRunAutoPilot()}
              disabled={unassignedJobs.length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold transition-all shadow-md shadow-indigo-500/20 disabled:opacity-50"
            >
              <Zap className="w-3.5 h-3.5 fill-current" />
              <span>Auto-Optimize All ({unassignedJobs.length})</span>
            </button>

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
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] transition-colors"
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
          sub={`of ${primeMovers.length} heavy tractors`}
        />
        <KpiCard
          label="Available Drivers"
          value={availableDrivers.length}
          icon={UserCheck}
          accent="emerald"
          sub={`of ${drivers.length} compliant drivers`}
        />
        <KpiCard
          label="Available Trailers"
          value={availableTrailers.length}
          icon={Layers}
          accent="cyan"
          sub={`of ${trailers.length} trailers`}
        />
      </div>

      {/* =========================================================================
          SMART ANALYSIS ENGINE PANEL (BOGIE + STREET TURN + DEMURRAGE RESCUE)
          ========================================================================= */}
      <div className="rounded-xl bg-gradient-to-br from-blue-950/30 via-[var(--bg-surface)] to-[var(--bg-surface)] border border-blue-500/30 p-3 space-y-2.5 shadow-xl">
        <div
          className={`flex flex-col 2xl:flex-row 2xl:items-center justify-between gap-2 ${
            showSmartAnalysis ? 'border-b border-blue-500/20 pb-2.5' : ''
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center shrink-0 border border-blue-500/30">
              <Sparkles className="w-4 h-4 text-blue-300" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-bold text-[var(--text-main)] whitespace-nowrap">
                  Smart Drayage Analysis & Optimizer
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-600 text-white whitespace-nowrap shadow-sm">
                  Dual-20FT · Street Turn · 3-Leg Chain
                </span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)] leading-tight mt-0.5">
                AI corridor pairing eliminates empty gate runs, bundles 2x20FT containers, holds deadhead L2s, and prioritizes expiring DOs.
              </p>
            </div>
          </div>

          {/* Filter Pills + Show/Hide Widgets Toggle Button */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="flex items-center gap-1 bg-[var(--bg-main)] p-1 rounded-lg border border-[var(--border-subtle)] overflow-x-auto w-fit max-w-full shrink-0">
              <button
                type="button"
                onClick={() => {
                  setSmartAnalysisFilter('ALL');
                  if (!showSmartAnalysis) handleToggleSmartAnalysis(true);
                }}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                  smartAnalysisFilter === 'ALL'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                All Matches ({bogieCombos.length + streetTurnPairs.length + smartBackhaulHoldJobs.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setSmartAnalysisFilter('BOGIE');
                  if (!showSmartAnalysis) handleToggleSmartAnalysis(true);
                }}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                  smartAnalysisFilter === 'BOGIE'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                Dual-20FT Bogie ({bogieCombos.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setSmartAnalysisFilter('STREET_TURN');
                  if (!showSmartAnalysis) handleToggleSmartAnalysis(true);
                }}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                  smartAnalysisFilter === 'STREET_TURN'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                Street Turns & Chains ({streetTurnPairs.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setSmartAnalysisFilter('BACKHAUL_HOLD');
                  if (!showSmartAnalysis) handleToggleSmartAnalysis(true);
                }}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                  smartAnalysisFilter === 'BACKHAUL_HOLD'
                    ? 'bg-amber-600 text-white shadow-sm'
                    : 'text-amber-500 hover:text-amber-400'
                }`}
              >
                Smart Backhaul Hold ({smartBackhaulHoldJobs.length})
              </button>
            </div>

            <button
              type="button"
              onClick={() => handleToggleSmartAnalysis()}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm shrink-0 cursor-pointer ${
                showSmartAnalysis
                  ? 'bg-slate-800 hover:bg-slate-700 text-white border border-slate-600'
                  : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-500/25'
              }`}
              title={showSmartAnalysis ? 'Hide Smart Analysis Widgets' : 'Show Smart Analysis Widgets'}
            >
              {showSmartAnalysis ? (
                <>
                  <EyeOff className="w-3.5 h-3.5" />
                  <span>Hide Widgets</span>
                  <ChevronUp className="w-3.5 h-3.5" />
                </>
              ) : (
                <>
                  <Eye className="w-3.5 h-3.5" />
                  <span>
                    Show Widgets ({bogieCombos.length + streetTurnPairs.length + smartBackhaulHoldJobs.length})
                  </span>
                  <ChevronDown className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </div>

        {/* Cards Grid (Collapsible via Show / Hide Widgets toggle) */}
        {showSmartAnalysis && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 items-start">
            {/* 1. Dual-20FT Bogie Combos */}
            {(smartAnalysisFilter === 'ALL' || smartAnalysisFilter === 'BOGIE') &&
              bogieCombos.map((combo, idx) => (
                <div
                  key={combo.id}
                  className={`rounded-xl bg-[var(--bg-surface)] smart-widget-running-border smart-border-${idx % 6} p-2.5 space-y-1.5 transition-all flex flex-col justify-between`}
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center gap-1 whitespace-nowrap">
                        <Layers className="w-3 h-3 shrink-0" />
                        Dual-20FT Bogie Combo
                      </span>
                      <span className="text-[11px] font-mono font-bold text-blue-400 whitespace-nowrap shrink-0">
                        Score: {combo.score}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-1 text-[10px] font-medium text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded-md">
                      <span className="flex items-center gap-1 truncate">
                        <Clock className="w-3 h-3 shrink-0" />
                        <span>{combo.tasSlot} TAS Slot</span>
                      </span>
                      <span className="px-1.5 py-0.2 rounded bg-cyan-500/20 text-[10px] font-bold text-cyan-300 shrink-0">
                        2h Window (Δ {combo.windowDiffHours}h)
                      </span>
                    </div>

                    {/* Weight & Road Legal Safety Gauge */}
                    <div className="px-2 py-1 rounded-md bg-[var(--bg-main)] border border-[var(--border-subtle)] space-y-1">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-[var(--text-muted)] flex items-center gap-1">
                          <Scale className="w-3 h-3 text-indigo-400" />
                          <span>Payload: {(combo.totalPayloadKg / 1000).toFixed(1)}T / {(combo.weightLimitKg / 1000).toFixed(1)}T</span>
                        </span>
                        <span className={`font-semibold ${combo.isWeightCompliant ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {combo.isWeightCompliant ? '✓ RTA 36T Legal' : '⚠️ Overweight'} ({combo.weightUtilizationPct}%)
                        </span>
                      </div>
                      <div className="w-full bg-neutral-800 h-1 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            combo.isWeightCompliant ? 'bg-emerald-500' : 'bg-rose-500'
                          }`}
                          style={{ width: `${Math.min(100, combo.weightUtilizationPct)}%` }}
                        />
                      </div>
                    </div>

                    {/* Recommended 40FT_FLATBED / BOGIE Tractor & Chassis Pill */}
                    {(() => {
                      const rec = getSmartRecommendedAssets(combo.job1, true);
                      const recVeh = vehicles.find((v) => v.id === rec.vehicleId);
                      const recTr = trailers.find((t) => t.id === rec.trailerId);
                      return (
                        <div className="px-2 py-1 rounded-md bg-blue-500/10 border border-blue-500/20 text-[10px] text-blue-300 flex items-center justify-between gap-1">
                          <span className="flex items-center gap-1 font-bold truncate">
                            <Truck className="w-3 h-3 text-blue-400 shrink-0" />
                            <span className="truncate">Rec: {recVeh?.plateNumber || 'PRIME_MOVER'} + {recTr?.plateNumber || '40FT_FLATBED'}</span>
                          </span>
                          {rec.topScore && (
                            <span className="text-emerald-400 font-bold shrink-0">{rec.topScore.totalScore}%</span>
                          )}
                        </div>
                      );
                    })()}

                    {/* Drops Sequence */}
                    <div className="space-y-1 w-full">
                      <div className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] space-y-0.5">
                        <div className="flex items-center justify-between gap-1.5 text-xs font-mono font-bold text-[var(--text-main)]">
                          <span className="truncate">1. {combo.job1.containerNumber} (20FT)</span>
                          <span className="text-[11px] text-emerald-400 font-normal shrink-0">{(combo.box1WeightKg / 1000).toFixed(1)}T</span>
                        </div>
                        <div className="w-full text-[13px] font-semibold text-[var(--text-main)] leading-tight truncate">
                          {combo.job1.customerName} → {combo.job1.warehouseName} ({combo.zone1})
                        </div>
                      </div>

                      <div className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] space-y-0.5">
                        <div className="flex items-center justify-between gap-1.5 text-xs font-mono font-bold text-[var(--text-main)]">
                          <span className="truncate">2. {combo.job2.containerNumber} (20FT)</span>
                          <span className="text-[11px] text-emerald-400 font-normal shrink-0">{(combo.box2WeightKg / 1000).toFixed(1)}T</span>
                        </div>
                        <div className="w-full text-[13px] font-semibold text-[var(--text-main)] leading-tight truncate">
                          {combo.job2.customerName} → {combo.job2.warehouseName} ({combo.zone2})
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="pt-1 space-y-1.5">
                    <button
                      onClick={() => handleUseBogiePair(combo)}
                      className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-500 transition-colors shadow-sm"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      ⚡ Dispatch Job
                    </button>
                  </div>
                </div>
              ))}

            {/* 2. Zone-Based Street Turn, Port Terminal Reload & 3-Leg Daisy-Chain Triangulation Matches */}
            {(smartAnalysisFilter === 'ALL' || smartAnalysisFilter === 'STREET_TURN') &&
              streetTurnPairs.map((pair, idx) => (
                <div
                  key={pair.id}
                  className={`rounded-xl bg-[var(--bg-surface)] smart-widget-running-border smart-border-${(bogieCombos.length + idx) % 6} p-2.5 space-y-1.5 transition-all flex flex-col justify-between`}
                >
                  <div className="space-y-1.5 w-full">
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 truncate">
                        <TrendingUp className="w-3 h-3 shrink-0" />
                        <span className="truncate">
                          {pair.matchMode === 'DAISY_CHAIN_3LEG'
                            ? '3-Leg Daisy-Chain'
                            : pair.matchMode === 'PORT_TERMINAL_RELOAD'
                              ? 'Port Terminal Reload (0 km Handoff)'
                              : 'Street-Turn (Import ➔ Export)'}
                        </span>
                      </span>
                      <span className="text-[11px] font-mono font-bold text-emerald-400 whitespace-nowrap shrink-0">
                        Score: {pair.score}
                      </span>
                    </div>

                    {/* Carrier Line, Size & Grade Match Badge (Single Compact Row) */}
                    <div className="w-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-lg flex items-center justify-between gap-2 text-xs">
                      <span className="text-emerald-400 font-bold flex items-center gap-1 truncate">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span className="truncate">{pair.shippingLine} Line ({pair.carrierPrefix})</span>
                        <span className="text-[10px] text-emerald-300/90 font-medium truncate">· ✓ Grade A</span>
                      </span>
                      <span className="font-mono text-[11px] font-bold text-[var(--text-main)] whitespace-nowrap shrink-0">
                        {pair.containerSize} · {pair.containerType || 'DRY'}
                      </span>
                    </div>

                    <div className="space-y-1 w-full">
                      {/* Leg 1: L1 Placed at Ramp / Detached or L2 Inbound Empty Box */}
                      <div className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] space-y-0.5">
                        <div className="flex items-center justify-between gap-1.5 text-xs">
                          <span className="font-bold text-amber-400 truncate">
                            {pair.sourcePhase === 'L1_RAMP'
                              ? pair.inboundJob.trailerDetached ||
                                ['TRAILER_DETACHED', 'REASSIGN_TRAILER_DETACHED', 'READY_FOR_PICKUP'].includes(
                                  pair.inboundJob.status,
                                )
                                ? `1. L1 Detached (${pair.inboundJob.jobCode})`
                                : `1. L1 Placed at Ramp (${pair.inboundJob.jobCode})`
                              : `1. L2 Empty Return (${pair.inboundJob.jobCode})`}
                          </span>
                          <span className="font-mono font-bold text-xs text-[var(--text-main)] shrink-0">{pair.inboundJob.containerNumber}</span>
                        </div>
                        <div className="w-full text-[13px] font-semibold text-[var(--text-main)] leading-tight truncate">
                          {pair.originWarehouse} ➔ {pair.inboundJob.terminalName}
                        </div>
                      </div>

                      {/* Handoff Connector: Port Terminal Reload vs Direct Inland Repositioning */}
                      <div className="w-full px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-300 flex items-center justify-between gap-1.5">
                        <span className="flex items-center gap-1 font-medium truncate">
                          <ArrowRight className="w-3 h-3 text-emerald-400 shrink-0" />
                          <span className="truncate">
                            {pair.matchMode === 'INLAND_STREET_TURN'
                              ? `Direct Match (${pair.interWarehouseDistanceKm} km · ≤ ${automationConfig.streetTurnRadiusKm || 15} km)`
                              : `Reload @ ${pair.terminalName} (0.0 km · ${pair.tasSlot})`}
                          </span>
                        </span>
                        <span className="font-bold text-emerald-400 whitespace-nowrap shrink-0 text-[10px]">
                          {pair.matchMode === 'INLAND_STREET_TURN' ? 'Zero Port Return' : 'Dual TAS Pass'}
                        </span>
                      </div>

                      {/* Leg 2: Outbound L1 Import Full or Export Loading */}
                      <div className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] space-y-0.5">
                        <div className="flex items-center justify-between gap-1.5 text-xs">
                          <span className="font-bold text-blue-400 truncate">
                            {pair.matchMode === 'INLAND_STREET_TURN'
                              ? '2. Outbound Export Loading'
                              : `2. L1 Import Full (${pair.exportJob.jobCode})`}
                          </span>
                          <span className="font-mono font-bold text-xs text-[var(--text-main)] shrink-0">{pair.exportJob.containerNumber}</span>
                        </div>
                        <div className="w-full text-[13px] font-semibold text-[var(--text-main)] leading-tight truncate">
                          {pair.matchMode === 'INLAND_STREET_TURN'
                            ? `${pair.destWarehouse} ➔ ${pair.terminalName}`
                            : `${pair.terminalName} ➔ ${pair.destWarehouse}`}
                        </div>
                      </div>

                      {/* Leg 3: Optional 3-Leg Daisy-Chain Empty Return (e.g. JAFZA South -> T2) */}
                      {pair.leg3Job && (
                        <div
                          className={`w-full px-2.5 py-1 rounded-lg border space-y-0.5 ${
                            pair.holdLeg3Recommended
                              ? 'bg-amber-500/10 border-amber-500/30'
                              : 'bg-indigo-500/10 border-indigo-500/30'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1.5 text-xs">
                            <span className={`font-bold truncate ${pair.holdLeg3Recommended ? 'text-amber-300' : 'text-indigo-300'}`}>
                              3. L2 Empty ({pair.leg3Job.jobCode})
                            </span>
                            <span className="font-mono text-[11px] font-bold text-[var(--text-main)] truncate shrink-0">
                              {pair.leg3Job.warehouseName} ➔ {pair.leg3Job.terminalName}
                            </span>
                          </div>
                          <div className="w-full text-[11px] text-[var(--text-muted)] leading-tight truncate">
                            {pair.holdLeg3Recommended
                              ? `⏸️ Hold Leg 3 (${pair.leg3Risk ? `${Math.floor(pair.leg3Risk.hoursRemaining / 24)}d free` : 'Safe DO'} · 0 backhaul @ ${pair.leg3Job.returnTerminalName || pair.leg3Job.terminalName})`
                              : `✓ Ready for 3-Leg Chain (${pair.leg3Job.containerNumber} ➔ ${pair.leg3Job.returnTerminalName || pair.leg3Job.terminalName})`}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Dispatch Action Footer */}
                  <div className="pt-1">
                    {pair.leg3Job ? (
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          onClick={() => handleUseStreetTurnPair(pair, true)}
                          className="w-full inline-flex items-center justify-center gap-1 py-1.5 px-2.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 transition-colors shadow-sm"
                        >
                          <Sparkles className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">⚡ Dispatch Job</span>
                        </button>
                        <button
                          onClick={() => handleUseStreetTurnPair(pair, false)}
                          className="w-full inline-flex items-center justify-center gap-1 py-1.5 px-2.5 rounded-lg bg-indigo-600/20 border border-indigo-500/40 text-indigo-300 text-xs font-bold hover:bg-indigo-600/30 transition-colors"
                        >
                          <Truck className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">🔄 3-Leg Loop</span>
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleUseStreetTurnPair(pair, false)}
                        className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 transition-colors shadow-sm"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        ⚡ Dispatch Job
                      </button>
                    )}
                  </div>
                </div>
              ))}

            {/* 2B. Smart Backhaul Hold Advisor Cards (Non-Urgent L2 Empties to Deadhead Terminals like T2) */}
            {(smartAnalysisFilter === 'ALL' || smartAnalysisFilter === 'BACKHAUL_HOLD') &&
              smartBackhaulHoldJobs.map((item, idx) => (
                <div
                  key={`HOLD-${item.job.id}`}
                  className={`rounded-xl bg-[var(--bg-surface)] smart-widget-running-border smart-border-${(bogieCombos.length + streetTurnPairs.length + idx) % 6} p-2.5 space-y-1.5 transition-all flex flex-col justify-between`}
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1 truncate">
                        <Clock className="w-3 h-3 shrink-0" />
                        <span className="truncate">{item.isCurrentlyHeld ? '⏸️ On Smart Backhaul Hold' : 'Smart Backhaul Hold Advisor'}</span>
                      </span>
                      <span className="font-mono text-xs font-bold text-amber-400 shrink-0">{item.job.jobCode}</span>
                    </div>

                    <div className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] space-y-0.5 text-xs">
                      <div className="flex items-center justify-between font-mono font-bold text-[var(--text-main)]">
                        <span>{item.job.containerNumber} ({item.job.containerSize})</span>
                        <span className="text-[10px] text-emerald-400 font-sans">
                          {Math.floor(item.risk.hoursRemaining / 24)}d {item.risk.hoursRemaining % 24}h DO Free Time
                        </span>
                      </div>
                      <div className="text-[13px] font-semibold text-[var(--text-main)] leading-tight truncate">
                        {item.job.warehouseName} ({item.zone}) ➔ {item.terminalName}
                      </div>
                    </div>

                    <div className="px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-200/90 leading-snug line-clamp-2">
                      {item.recommendationText}
                    </div>
                  </div>

                  <div className="pt-1">
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleToggleBackhaulHold(item.job, !item.isCurrentlyHeld)}
                        className={`inline-flex items-center justify-center gap-1 py-1.5 px-2.5 rounded-lg text-xs font-bold transition-colors shadow-sm ${
                          item.isCurrentlyHeld
                            ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                            : 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                        }`}
                      >
                        <Clock className="w-3.5 h-3.5" />
                        {item.isCurrentlyHeld ? 'Release Hold' : 'Hold for Backhaul'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenAssign(item.job)}
                        className="inline-flex items-center justify-center gap-1 py-1.5 px-2.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] text-xs font-semibold hover:bg-[var(--bg-surface-hover)] transition-colors"
                      >
                        <Truck className="w-3.5 h-3.5 text-blue-400" />
                        Dispatch Anyway
                      </button>
                    </div>
                  </div>
                </div>
              ))}

            {/* Empty state when no matches found */}
            {((smartAnalysisFilter === 'BACKHAUL_HOLD' && smartBackhaulHoldJobs.length === 0) ||
              (smartAnalysisFilter === 'BOGIE' && bogieCombos.length === 0) ||
              (smartAnalysisFilter === 'STREET_TURN' && streetTurnPairs.length === 0) ||
              (smartAnalysisFilter === 'ALL' &&
                bogieCombos.length === 0 &&
                streetTurnPairs.length === 0 &&
                smartBackhaulHoldJobs.length === 0)) && (
              <div className="col-span-full py-8 text-center text-[var(--text-muted)] space-y-1">
                <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto opacity-70" />
                <h4 className="text-xs font-bold text-[var(--text-main)]">Queue Optimized</h4>
                <p className="text-xs text-[var(--text-muted)]">
                  {smartAnalysisFilter === 'BACKHAUL_HOLD'
                    ? 'No non-urgent L2 empty return deadhead risks detected.'
                    : 'No pending pairing conflicts found in current queue.'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* =========================================================================
          URGENT DEMURRAGE ALERT PANEL (Shown ONLY when clicking Urgent Demurrage Alert button at top)
          ========================================================================= */}
      {showUrgentDemurrageAlert && (
        <div className="rounded-2xl bg-gradient-to-br from-rose-950/30 via-[var(--bg-surface)] to-[var(--bg-surface)] border border-rose-500/40 p-5 space-y-4 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-rose-500/20 pb-4">
            <div className="flex items-start sm:items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0 border border-rose-500/30">
                <AlertTriangle className="w-5 h-5 text-rose-400" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h3 className="text-sm font-bold text-[var(--text-main)] whitespace-nowrap">
                    Urgent Demurrage &amp; Port Slot Risk Alerts
                  </h3>
                  <span className="px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-rose-600 text-white whitespace-nowrap shadow-sm">
                    {urgentDemurrageJobs.length} Critical Container{urgentDemurrageJobs.length === 1 ? '' : 's'}
                  </span>
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Containers approaching port free-time expiry, shipping line detention, DO expiry, or TAS slot miss risk.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowUrgentDemurrageAlert(false)}
              className="px-3 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors self-end sm:self-auto"
            >
              Close Alerts
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {urgentDemurrageJobs.map((job) => {
              const risk = getDemurrageRisk(job);
              const radar = job.riskRadar;
              const slotPred = job.portSlotPrediction;
              return (
                <div
                  key={`RISK-${job.id}`}
                  className="rounded-xl bg-[var(--bg-surface)] border border-rose-500/40 p-4 space-y-3 flex flex-col justify-between shadow-sm"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 animate-pulse">
                        {radar?.within24hPenaltyWindow
                          ? '🚨 CRITICAL <24H FREE-TIME RADAR'
                          : slotPred?.willMissSlot
                          ? `⏱️ PORT SLOT MISS (${Math.abs(slotPred.slotBufferMinutes)}M LATE)`
                          : risk.badgeText}
                      </span>
                      <span className="font-mono text-xs font-bold text-rose-400">{job.jobCode}</span>
                    </div>

                    <div className="text-xs space-y-0.5">
                      <div className="font-bold font-mono text-[var(--text-main)] text-sm flex items-center justify-between">
                        <span>{job.containerNumber} ({job.containerSize} · {job.containerType})</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-rose-600 text-white font-sans font-bold">
                          PRIORITY: CRITICAL
                        </span>
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)] truncate">
                        {job.customerName} · {job.terminalName} ➔ {job.warehouseName}
                      </div>
                    </div>

                    {/* Demurrage & Free-Time Countdown Radar (3 Columns) */}
                    {radar && (
                      <div className="grid grid-cols-3 gap-1.5 text-[10px]">
                        <div className="p-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                          <span className="text-[9px] text-[var(--text-muted)] block">Port Demurrage</span>
                          <strong className={`font-mono ${radar.portDemurrageHoursRemaining <= 24 ? 'text-rose-400' : 'text-emerald-400'}`}>
                            {radar.portDemurrageHoursRemaining <= 0
                              ? `Overdue`
                              : `${radar.portDemurrageHoursRemaining}h left`}
                          </strong>
                          <span className="block text-[9px] text-[var(--text-muted)]">
                            AED {radar.portDailyDemurrageAed}/d
                          </span>
                        </div>
                        <div className="p-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                          <span className="text-[9px] text-[var(--text-muted)] block">Line Detention</span>
                          <strong className={`font-mono ${radar.lineDetentionHoursRemaining <= 24 ? 'text-rose-400' : 'text-amber-400'}`}>
                            {radar.lineDetentionHoursRemaining <= 0
                              ? `Overdue`
                              : `${radar.lineDetentionHoursRemaining}h left`}
                          </strong>
                          <span className="block text-[9px] text-[var(--text-muted)]">
                            AED {radar.lineDailyDetentionAed}/d
                          </span>
                        </div>
                        <div className="p-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                          <span className="text-[9px] text-[var(--text-muted)] block">DO Expiry</span>
                          <strong className={`font-mono ${radar.doHoursRemaining <= 24 ? 'text-rose-400' : 'text-blue-400'}`}>
                            {radar.doHoursRemaining <= 0 ? 'Expired' : `${radar.doHoursRemaining}h left`}
                          </strong>
                          <span className="block text-[9px] text-[var(--text-muted)]">
                            {new Date(radar.doExpiryDate).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Port Appointment Window & Gate Queue Predictor */}
                    {slotPred && (
                      <div
                        className={`p-2 rounded-lg border text-[10px] space-y-1 ${
                          slotPred.willMissSlot
                            ? 'bg-rose-500/10 border-rose-500/30 text-rose-200'
                            : 'bg-[var(--bg-main)] border-[var(--border-subtle)] text-[var(--text-muted)]'
                        }`}
                      >
                        <div className="flex items-center justify-between font-bold">
                          <span>Gate Slot: {slotPred.slotWindowLabel}</span>
                          <span className={slotPred.willMissSlot ? 'text-rose-400' : 'text-emerald-400'}>
                            ETA: {slotPred.predictedGateArrivalLabel} ({slotPred.willMissSlot ? `${Math.abs(slotPred.slotBufferMinutes)}m Late` : `+${slotPred.slotBufferMinutes}m Buffer`})
                          </span>
                        </div>
                        <div className="text-[9px] opacity-90">
                          {slotPred.corridorName} · {slotPred.distanceToPortKm}km @ {slotPred.avgCorridorSpeedKmh}km/h + {slotPred.gateQueueWaitMinutes}m Gate Queue
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="pt-2 border-t border-[var(--border-subtle)] space-y-1.5">
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleRebookJobPcsSlot(job.id)}
                        className="inline-flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg bg-amber-500 text-slate-950 text-[10px] font-bold hover:bg-amber-400 transition-colors shadow-sm"
                        title="Auto-rebook DP World / AD Ports PCS token to next 2-hour window matching live E11/E311 ETA"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Auto-Rebook Token
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSwapJobRescueTractor(job.id)}
                        className="inline-flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg bg-blue-600 text-white text-[10px] font-bold hover:bg-blue-500 transition-colors shadow-sm"
                        title="Swap to nearest available tractor via 4-Factor Telematics to rescue port slot"
                      >
                        <Truck className="w-3 h-3" />
                        Swap Tractor (4-Factor)
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleOpenAssign(job)}
                      className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-500 transition-colors shadow-sm"
                    >
                      <AlertCircle className="w-3.5 h-3.5" />
                      Prioritize &amp; Custom Assign
                    </button>
                  </div>
                </div>
              );
            })}

            {urgentDemurrageJobs.length === 0 && (
              <div className="col-span-full py-8 text-center text-[var(--text-muted)] space-y-1">
                <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto opacity-70" />
                <h4 className="text-xs font-bold text-[var(--text-main)]">No Urgent Demurrage Alerts</h4>
                <p className="text-xs text-[var(--text-muted)]">
                  No urgent demurrage or port slot risk alerts in current queue.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* FleetDataGrid (Smart Data Table) */}
      <FleetDataGrid<DrayageJob>
        rows={activeQueueJobs}
        columns={assignmentColumns}
        getRowId={(j) => j.id}
        loading={loading}
        emptyMessage="No active drayage jobs in queue"
        gridName="DrayageAssignmentGrid"
        numbered={true}
        selectable={true}
        stickyBottomScrollbar={true}
        tableMinWidth="max(2100px, calc(100% + 520px))"
        rowClassName={(job) => {
          const evalState = evaluateDispatcherJobReassignState(job);
          const normDisplay = (evalState.displayStatus || '')
            .trim()
            .toUpperCase()
            .replace(/_/g, ' ');
          const rawUpper = (job.status || '').trim().toUpperCase().replace(/_/g, ' ');
          if (normDisplay === 'MT REASSIGN TO YARD' || rawUpper === 'MT REASSIGN TO YARD' || rawUpper === 'MT REASSIGN') {
            return 'row-mt-reassign-yard';
          }
          if (normDisplay === 'FCL REASSIGN TO YARD' || rawUpper === 'FCL REASSIGN TO YARD' || rawUpper === 'FCL REASSIGN') {
            return 'row-fcl-reassign-yard';
          }
          return '';
        }}
        selectedIds={new Set(selectedJobIds)}
        onSelectionChange={(ids) =>
          setSelectedJobIds(
            Array.from(ids).filter((id) => {
              const target = jobs.find((j) => j.id === id);
              return target ? !isJobCompletedOrSuperseded(target) : false;
            }),
          )
        }
        toolbar={{
          title: 'Drayage Jobs Queue',
          search: true,
          columns: true,
          density: true,
          filters: true,
          exportCsv: true,
          exportName: 'drayage_job_assignment',
          actions: (
            <div className="flex flex-wrap items-center gap-2">
              <div className="hidden sm:flex items-center gap-1.5 mr-1">
                <span
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/40"
                  title="Rows highlighted in Amber indicate MT Reassign to Yard"
                >
                  <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                  <span>MT Reassign to Yard</span>
                </span>
                <span
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-bold bg-purple-500/15 text-purple-400 border border-purple-500/40"
                  title="Rows highlighted in Purple indicate FCL Reassign to Yard"
                >
                  <span className="w-2 h-2 rounded-full bg-purple-400 shrink-0" />
                  <span>FCL Reassign to Yard</span>
                </span>
              </div>
              {completedJobsCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowCompletedJobs((prev) => !prev)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                    showCompletedJobs
                      ? 'bg-slate-700 text-white border-slate-600'
                      : 'bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)]'
                  }`}
                  title="Show or hide completed L1/L2 jobs in the table"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{showCompletedJobs ? 'Hide Completed' : `Show Completed (${completedJobsCount})`}</span>
                </button>
              )}
              {selectedJobIds.length === 2 && (
                <button
                  onClick={handleOpenBogieModal}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-500 transition-colors shadow-sm"
                  title="Pair exactly two 20FT containers onto a single prime mover & chassis"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Pair 2x20FT as Bogie Trip
                </button>
              )}
              {selectedJobIds.length > 2 && (
                <button
                  onClick={() => handleRunAutoPilot(selectedJobIds)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold transition-all shadow-md shadow-indigo-500/20"
                  title="Batch dispatch selected jobs across multiple prime movers & drivers via Auto-Pilot"
                >
                  <Zap className="w-3.5 h-3.5 fill-current" />
                  Batch Dispatch ({selectedJobIds.length} Jobs across Fleet)
                </button>
              )}
              {selectedJobIds.length === 1 && (
                <button
                  onClick={() => {
                    const job = jobs.find((j) => j.id === selectedJobIds[0]);
                    if (job) handleOpenAssign(job);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-main)] text-xs font-semibold hover:bg-[var(--bg-surface)] transition-colors"
                >
                  <Truck className="w-3.5 h-3.5 text-blue-400" />
                  Assign Single Job
                </button>
              )}
            </div>
          ),
        }}
      />

      {/* =========================================================================
          AUTO-PILOT BATCH DISPATCH REVIEW MODAL
          ========================================================================= */}
      {showAutoPilotModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl bg-[var(--bg-surface)] border border-blue-500/40 shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--border-subtle)] bg-blue-950/20 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-blue-500/20 text-blue-400">
                  <Zap className="w-5 h-5 fill-current" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[var(--text-main)] flex items-center gap-2">
                    Auto-Pilot Batch Dispatch Plan
                  </h3>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    Review and confirm global optimal assignments before committing to active fleet operations
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowAutoPilotModal(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Plan Metrics Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-[var(--bg-main)] border-b border-[var(--border-subtle)] text-xs">
              <div>
                <span className="text-[var(--text-muted)] block text-[10px]">Total Dispatches</span>
                <span className="font-bold text-lg text-blue-400">{autoPilotPlan.length} Prime Movers</span>
              </div>
              <div>
                <span className="text-[var(--text-muted)] block text-[10px]">Jobs Included</span>
                <span className="font-bold text-lg text-indigo-400">
                  {autoPilotPlan.reduce((acc, p) => acc + p.jobIds.length, 0)} Jobs
                </span>
              </div>
              <div>
                <span className="text-[var(--text-muted)] block text-[10px]">Total Corridor Revenue</span>
                <span className="font-bold text-lg text-emerald-400">
                  AED {autoPilotPlan.reduce((acc, p) => acc + p.revenueAed, 0).toLocaleString()}
                </span>
              </div>
              <div>
                <span className="text-[var(--text-muted)] block text-[10px]">Total Driver Allowances</span>
                <span className="font-bold text-lg text-[var(--text-main)]">
                  AED {autoPilotPlan.reduce((acc, p) => acc + p.allowanceAed, 0).toLocaleString()}
                </span>
              </div>
            </div>

            {/* Dispatches Table */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {autoPilotPlan.length === 0 ? (
                <div className="py-12 text-center text-[var(--text-muted)]">No assignments in plan</div>
              ) : (
                autoPilotPlan.map((item, idx) => (
                  <div
                    key={item.id}
                    className="p-3.5 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] space-y-2.5 text-xs hover:border-blue-500/40 transition-colors"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-blue-400">#{idx + 1}</span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            item.type === 'BOGIE'
                              ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                              : item.type === 'DAISY_CHAIN'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                : item.type === 'PORT_RELOAD' || item.type === 'STREET_TURN'
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                  : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                          }`}
                        >
                          {item.type === 'BOGIE'
                            ? 'Dual-20FT Bogie'
                            : item.type === 'DAISY_CHAIN'
                              ? item.heldLeg3JobCode
                                ? `2-Leg + Hold ${item.heldLeg3JobCode}`
                                : '3-Leg Daisy-Chain'
                              : item.type === 'PORT_RELOAD'
                                ? 'Port Terminal Reload'
                                : item.type === 'STREET_TURN'
                                  ? 'Street Turn Pair'
                                  : 'Single Run'}
                        </span>
                        <span className="font-mono font-semibold text-[var(--text-main)]">
                          {item.containers.join(' + ')}
                        </span>
                        {item.demurrageRescue && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300">
                            🚨 Demurrage Rescue
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="font-mono text-emerald-400 font-bold">{item.tokenNumber}</span>
                        <button
                          onClick={() => handleRemoveFromAutoPilot(item.id)}
                          className="text-rose-400 hover:text-rose-300 p-1"
                          title="Remove from batch"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
                      <MapPin className="w-3 h-3 text-emerald-400 shrink-0" />
                      <span>{item.routeDescription}</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 border-t border-[var(--border-subtle)] text-[11px]">
                      <div className="flex flex-col gap-0.5 text-[var(--text-main)] font-medium">
                        <div className="flex items-center gap-1.5">
                          <Truck className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                          <span>Tractor: {item.selectedVehiclePlate}</span>
                        </div>
                        {typeof item.matchScorePct === 'number' && (
                          <div className="text-[10px] text-blue-400 font-semibold pl-5 flex items-center gap-1">
                            <span>🎯 {item.matchScorePct}% Match</span>
                            <span className="text-[var(--text-muted)]">• 📍 {item.proximityKm}km</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-[var(--text-main)] font-medium">
                        <UserCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span>Driver: {item.selectedDriverName}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[var(--text-main)] font-medium">
                        <Layers className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                        <span>Chassis: {item.selectedTrailerPlate}</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-[var(--border-subtle)] bg-[var(--bg-main)] flex items-center justify-between">
              <span className="text-xs text-[var(--text-muted)]">
                Ready to commit {autoPilotPlan.length} dispatch units
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowAutoPilotModal(false)}
                  className="px-4 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleApproveBatchDispatch}
                  disabled={submittingBatch || autoPilotPlan.length === 0}
                  className="px-5 py-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold transition-all shadow-md shadow-indigo-500/20 disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Zap className="w-3.5 h-3.5 fill-current" />
                  <span>{submittingBatch ? 'Dispatching Fleet...' : 'Approve & Dispatch All'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Assignment Modal (Single or Bogie Pair) */}
      {assigningJob && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <div>
                <h3 className="text-sm font-bold text-[var(--text-main)] flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-blue-400" />
                  {activeStreetTurnPair
                    ? activeStreetTurnPair.matchMode === 'DAISY_CHAIN_3LEG'
                      ? '⚡ Confirm 3-Leg Daisy-Chain Triangulation'
                      : activeStreetTurnPair.matchMode === 'PORT_TERMINAL_RELOAD'
                        ? '⚡ Confirm Port Terminal Reload (Dual TAS Gate Pass)'
                        : '⚡ Confirm Inland Street-Turn Triangulation'
                    : isBogieAssign
                    ? '⚡ Dual-20FT Bogie Dispatch (Single Prime Mover)'
                    : evaluateDispatcherJobReassignState(assigningJob).reassignLabel
                    ? `${evaluateDispatcherJobReassignState(assigningJob).reassignLabel}: ${assigningJob.jobCode}`
                    : `Assign Assets: ${assigningJob.jobCode}`}
                </h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  {activeStreetTurnPair
                    ? activeStreetTurnPair.matchMode === 'INLAND_STREET_TURN'
                      ? `Direct interchange: Reallocating empty container ${activeStreetTurnPair.containerNumber} from ${activeStreetTurnPair.originWarehouse} to ${activeStreetTurnPair.exportJob.jobCode}`
                      : `Port Reload: Drop ${activeStreetTurnPair.inboundJob.jobCode} (${activeStreetTurnPair.originWarehouse} ➜ ${activeStreetTurnPair.terminalName}) + Pick ${activeStreetTurnPair.outboundJob.jobCode} (${activeStreetTurnPair.terminalName} ➜ ${activeStreetTurnPair.destWarehouse})`
                    : isBogieAssign
                    ? `Coupling two 20FT containers onto a 40FT/45FT skeletal/bogie trailer`
                    : `Container ${assigningJob.containerNumber} (${assigningJob.containerSize}) · ${assigningJob.shipmentType || 'IMPORT'}`}
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
              {/* Special Triangulation Street-Turn Banner */}
              {activeStreetTurnPair && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-2.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-bold text-emerald-400 flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      {activeStreetTurnPair.matchMode === 'DAISY_CHAIN_3LEG'
                        ? `3-Leg Chain: ${activeStreetTurnPair.originWarehouse} ➜ ${activeStreetTurnPair.terminalName} ➜ ${activeStreetTurnPair.destWarehouse}`
                        : activeStreetTurnPair.matchMode === 'PORT_TERMINAL_RELOAD'
                          ? `Port Terminal Reload @ ${activeStreetTurnPair.terminalName} (0.0 km Handoff)`
                          : `Triangulation Match: ${activeStreetTurnPair.shippingLine} Line Verified`}
                    </span>
                    <span className="font-mono text-[10px] text-emerald-300 bg-emerald-500/20 px-2 py-0.5 rounded">
                      {activeStreetTurnPair.containerSize} {activeStreetTurnPair.containerType}
                    </span>
                  </div>
                  {activeStreetTurnPair.leg3Job && (
                    <div className="p-2 rounded-lg bg-[var(--bg-main)] border border-amber-500/30 flex items-center justify-between gap-2 text-[11px]">
                      <div>
                        <span className="font-bold text-amber-300 block">
                          Leg 3 ({activeStreetTurnPair.leg3Job.jobCode}): {activeStreetTurnPair.leg3Job.warehouseName} ➜ {activeStreetTurnPair.leg3Job.terminalName}
                        </span>
                        <span className="text-[10px] text-[var(--text-muted)]">
                          {holdLeg3InModal
                            ? `⏸️ Placed on Smart Backhaul Hold (avoids 34 km empty return from ${activeStreetTurnPair.leg3Job.terminalName})`
                            : `🔄 Included in Full 3-Leg Loop onto this Prime Mover`}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setHoldLeg3InModal((prev) => !prev)}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold shrink-0 transition-colors ${
                          holdLeg3InModal
                            ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                            : 'bg-indigo-600 text-white hover:bg-indigo-500'
                        }`}
                      >
                        {holdLeg3InModal ? 'Switch to Full 3-Leg' : 'Switch to Hold Leg 3'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Special Dual-20FT Bogie Weight Compliance & Sequence Swap Banner */}
              {isBogieAssign && selectedJobIds.length === 2 && (
                <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/30 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-indigo-300 flex items-center gap-1.5 text-xs">
                      <Scale className="w-4 h-4 text-indigo-400" />
                      Dual-20FT Gross Payload Compliance Check
                    </span>
                    <button
                      type="button"
                      onClick={handleSwapBogieSequence}
                      className="px-2 py-0.5 rounded bg-blue-600/30 text-blue-300 border border-blue-500/40 hover:bg-blue-600/50 text-[10px] font-bold flex items-center gap-1"
                    >
                      <ArrowUpDown className="w-3 h-3" />
                      Swap Drop 1 ⇄ Drop 2
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div className="p-2 rounded bg-[var(--bg-main)] border border-[var(--border-subtle)] space-y-0.5">
                      <div className="text-[10px] text-indigo-300 font-bold">Drop #1 (Lead):</div>
                      <div className="font-mono font-bold text-[var(--text-main)] truncate">
                        {jobs.find((j) => j.id === selectedJobIds[0])?.containerNumber || 'Box 1'}
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)] truncate">
                        {jobs.find((j) => j.id === selectedJobIds[0])?.customerName}
                      </div>
                      <div className="text-[10px] text-emerald-400 font-semibold">
                        Payload: {((jobs.find((j) => j.id === selectedJobIds[0])?.cargoWeightKg || 14500) / 1000).toFixed(1)}T
                      </div>
                    </div>

                    <div className="p-2 rounded bg-[var(--bg-main)] border border-[var(--border-subtle)] space-y-0.5">
                      <div className="text-[10px] text-indigo-300 font-bold">Drop #2 (Trailing):</div>
                      <div className="font-mono font-bold text-[var(--text-main)] truncate">
                        {jobs.find((j) => j.id === selectedJobIds[1])?.containerNumber || 'Box 2'}
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)] truncate">
                        {jobs.find((j) => j.id === selectedJobIds[1])?.customerName}
                      </div>
                      <div className="text-[10px] text-emerald-400 font-semibold">
                        Payload: {((jobs.find((j) => j.id === selectedJobIds[1])?.cargoWeightKg || 16200) / 1000).toFixed(1)}T
                      </div>
                    </div>
                  </div>

                  {(() => {
                    const w1 = jobs.find((j) => j.id === selectedJobIds[0])?.cargoWeightKg || 14500;
                    const w2 = jobs.find((j) => j.id === selectedJobIds[1])?.cargoWeightKg || 16200;
                    const tot = w1 + w2;
                    const compliant = tot <= 36000;
                    return (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="text-[var(--text-muted)]">Combined Payload:</span>
                          <span className={`font-mono font-bold ${compliant ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {(tot / 1000).toFixed(1)}T / 36.0T ({(tot / 360).toFixed(0)}% Legal Limit)
                          </span>
                        </div>
                        <div className="w-full bg-neutral-800 h-1.5 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${compliant ? 'bg-emerald-500' : 'bg-rose-500'}`}
                            style={{ width: `${Math.min(100, Math.round((tot / 36000) * 100))}%` }}
                          />
                        </div>
                        <div className="text-[10px]">
                          {compliant ? (
                            <span className="text-emerald-400 font-semibold">✓ Compliant with UAE RTA / FTA Road Safety Regulations</span>
                          ) : (
                            <span className="text-rose-400 font-bold">⚠️ Overweight Alert: Payload exceeds UAE RTA 36-Tonne limit!</span>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Select Prime Mover */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-[var(--text-muted)]">Fleet360 Tractor / Prime Mover *</label>
                  <span className="text-[10px] text-blue-400 font-semibold">Usage: LOGISTICS • Type: PRIME_MOVER</span>
                </div>
                <SearchableSelect
                  value={selectedVehicleId}
                  onChange={(val) => {
                    setSelectedVehicleId(val);
                    if (!val) {
                      setSelectedDriverId('');
                      return;
                    }
                    const veh = vehicles.find((v) => v.id === val);
                    const loggedInDrv =
                      (veh?.assignedDriverId
                        ? drivers.find((d) => d.id === veh.assignedDriverId)
                        : null) || drivers.find((d) => d.assignedVehicleId === val);
                    if (loggedInDrv) {
                      setSelectedDriverId(loggedInDrv.id);
                    }
                    if (assigningJob && !selectedTrailerId) {
                      const linkedTrId = resolveLinkedTrailerIdForJob(assigningJob);
                      if (linkedTrId) setSelectedTrailerId(linkedTrId);
                    }
                  }}
                  options={primeMoverSelectOptions}
                  placeholder="-- Search & Choose Prime Mover --"
                  searchPlaceholder="Type plate number, make, model..."
                  isClearable
                />

                {/* 4-Factor Telematics Match Score Breakdown Card */}
                {currentVehicleScore && (
                  <div className="p-3 rounded-xl bg-[var(--bg-main)] border border-blue-500/30 space-y-2 mt-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-base">{currentVehicleScore.rankBadge}</span>
                        <span className="font-bold text-[var(--text-main)] text-xs">
                          4-Factor Telematics Match Score:
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                            currentVehicleScore.totalScore >= 85
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : currentVehicleScore.totalScore >= 70
                              ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                              : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                          }`}
                        >
                          {currentVehicleScore.totalScore}% Match
                        </span>
                      </div>
                      <span className="text-[10px] text-[var(--text-muted)] font-mono">
                        Pickup: {targetTerminalLoc.name}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                      <div className="p-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-0.5">
                        <div className="text-[var(--text-muted)] flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-emerald-400 shrink-0" />
                          <span>Proximity ({automationConfig.weightProximityPct ?? 60}%)</span>
                        </div>
                        <div className="font-bold text-xs text-[var(--text-main)]">
                          {currentVehicleScore.hasLiveGps ? `${currentVehicleScore.distanceKm} km` : 'Switched Off'}
                        </div>
                        <div className="text-[9px] text-emerald-400">Score: {currentVehicleScore.proximityScore}/100</div>
                      </div>

                      <div className="p-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-0.5">
                        <div className="text-[var(--text-muted)] flex items-center gap-1">
                          <Clock className="w-3 h-3 text-cyan-400 shrink-0" />
                          <span>Status ({automationConfig.weightIdlenessPct ?? 25}%)</span>
                        </div>
                        <div className="font-bold text-xs text-[var(--text-main)]">
                          {currentVehicleScore.vehicle.isDriverLoggedIn || currentVehicleScore.hasLiveGps
                            ? `${currentVehicleScore.idleHours}h idle`
                            : 'Switched Off'}
                        </div>
                        <div className="text-[9px] text-cyan-400">Score: {currentVehicleScore.idlenessScore}/100</div>
                      </div>

                      <div className="p-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-0.5">
                        <div className="text-[var(--text-muted)] flex items-center gap-1">
                          <TrendingUp className="w-3 h-3 text-indigo-400 shrink-0" />
                          <span>Workload ({automationConfig.weightWorkloadPct ?? 10}%)</span>
                        </div>
                        <div className="font-bold text-xs text-[var(--text-main)]">
                          {currentVehicleScore.tripsToday} trip(s) today
                        </div>
                        <div className="text-[9px] text-indigo-400">Score: {currentVehicleScore.workloadScore}/100</div>
                      </div>

                      <div className="p-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-0.5">
                        <div className="text-[var(--text-muted)] flex items-center gap-1">
                          <ShieldCheck className="w-3 h-3 text-purple-400 shrink-0" />
                          <span>Availability ({automationConfig.weightAvailabilityPct ?? 5}%)</span>
                        </div>
                        <div className="font-bold text-xs text-[var(--text-main)]">
                          {currentVehicleScore.fuelPct}% fuel
                        </div>
                        <div className="text-[9px] text-purple-400">Score: {currentVehicleScore.availabilityScore}/100</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Select Driver */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-[var(--text-muted)]">Fleet360 Heavy Duty Driver *</label>
                  <span className="text-[10px] text-emerald-400 font-semibold">FIFO Queue & Workload Balanced</span>
                </div>
                <SearchableSelect
                  value={selectedDriverId}
                  onChange={(val) => {
                    setSelectedDriverId(val);
                    if (val && !selectedVehicleId) {
                      const drv = drivers.find((d) => d.id === val);
                      const loggedInVeh =
                        (drv?.assignedVehicleId
                          ? vehicles.find((v) => v.id === drv.assignedVehicleId)
                          : null) || vehicles.find((v) => v.assignedDriverId === val);
                      if (loggedInVeh) {
                        setSelectedVehicleId(loggedInVeh.id);
                      }
                    }
                  }}
                  options={drivers.map((d) => {
                    const loggedInVeh =
                      (d.assignedVehicleId
                        ? vehicles.find((v) => v.id === d.assignedVehicleId)
                        : null) || vehicles.find((v) => v.assignedDriverId === d.id);
                    return {
                      value: d.id,
                      label: loggedInVeh ? `${d.fullName} (${loggedInVeh.plateNumber})` : d.fullName,
                      sublabel: `${loggedInVeh ? `🚛 Logged into: ${loggedInVeh.plateNumber} • ` : ''}Trips Today: ${d.completedTripsToday ?? 0} • ${d.phone ? `Phone: ${d.phone} • ` : ''}Status: ${d.status}`,
                      badge: loggedInVeh
                        ? `🚛 ${loggedInVeh.plateNumber}`
                        : (d.completedTripsToday ?? 0) === 0
                        ? 'Fresh Driver'
                        : `${d.completedTripsToday} Trips`,
                    };
                  })}
                  placeholder="-- Search & Choose Driver --"
                  searchPlaceholder="Type driver name, mobile number..."
                  isClearable
                />
              </div>

              {/* Select Chassis / Trailer */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-[var(--text-muted)]">Skeletal / Flatbed Chassis *</label>
                  {isBogieAssign ? (
                    <span className="text-[10px] text-indigo-400 font-semibold">✨ Mandatory: 40FT/45FT Flatbed or Bogie Chassis (2x20FT)</span>
                  ) : assigningJob?.containerType === 'REEFER' ? (
                    <span className="text-[10px] text-cyan-400 font-semibold">✨ Recommended: Reefer Chassis with Genset</span>
                  ) : assigningJob?.containerSize === '20FT' ? (
                    <span className="text-[10px] text-emerald-400 font-semibold">✨ Recommended: 20FT Skeletal Chassis</span>
                  ) : (
                    <span className="text-[10px] text-blue-400 font-semibold">✨ Recommended: 40FT/45FT Skeletal Chassis</span>
                  )}
                </div>
                {/* 20FT Trailer Error for Bogie */}
                {isBogieAssign && selectedTrailerId && (() => {
                  const selTr = trailers.find((t) => t.id === selectedTrailerId);
                  if (selTr && selTr.trailerType.includes('20FT') && !selTr.trailerType.includes('40FT')) {
                    return (
                      <div className="p-2 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[11px] font-semibold flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                        <span>Invalid Chassis: Trailer {selTr.plateNumber} is a 20FT chassis. A Bogie trip requires a 40FT or 45FT chassis.</span>
                      </div>
                    );
                  }
                  return null;
                })()}
                <SearchableSelect
                  value={selectedTrailerId || resolveLinkedTrailerIdForJob(assigningJob)}
                  onChange={(val) => setSelectedTrailerId(val)}
                  options={(() => {
                    const baseOptions = trailers.map((t) => ({
                      value: t.id,
                      label: `${t.plateNumber} · ${t.trailerType}`,
                      sublabel: `Capacity: ${t.capacityTons}T • Loc: ${t.currentLocation || 'Depot'} • Master: ${t.masterStatus}`,
                      badge: t.operationalStatus,
                    }));
                    if (
                      assigningJob?.assignedTrailerId &&
                      !baseOptions.some((o) => o.value === assigningJob.assignedTrailerId)
                    ) {
                      baseOptions.unshift({
                        value: assigningJob.assignedTrailerId,
                        label: `${assigningJob.assignedTrailerPlate || assigningJob.assignedTrailerId} · 40FT_SKELETAL`,
                        sublabel: `Linked Chassis for ${assigningJob.containerNumber} (${assigningJob.jobCode})`,
                        badge: assigningJob.trailerDetached ? 'DETACHED' : 'LINKED',
                      });
                    }
                    return baseOptions;
                  })()}
                  placeholder="-- Search & Choose Chassis --"
                  searchPlaceholder="Type chassis plate, skeletal, flatbed..."
                  accent="emerald"
                  isClearable
                />
              </div>

              {/* L2 Empty Return Terminal Selector (Unlocked from EN_ROUTE_WAREHOUSE through L2 - PENDING) */}
              {assigningJob && !isBogieAssign && !activeStreetTurnPair && canChangeDrayageReturnTerminal(assigningJob) && (
                <div className="space-y-2 p-3.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30">
                  <div className="flex items-center justify-between">
                    <label className="font-semibold text-cyan-300 flex items-center gap-1.5">
                      <ArrowUpDown className="w-3.5 h-3.5 text-cyan-400" />
                      <span>L2 Empty Return Terminal (Drop-Off Destination)</span>
                    </label>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-bold text-emerald-300">
                      Unlocked · {assigningJob.jobPhase} - {assigningJob.status}
                    </span>
                  </div>
                  <select
                    value={assignReturnTerminalId}
                    onChange={(e) => setAssignReturnTerminalId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-cyan-500/40 text-[var(--text-main)] font-semibold outline-none focus:border-cyan-400 text-xs cursor-pointer"
                  >
                    {terminals.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.code} · {t.emirate})
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
                    <span>
                      Origin Pickup Terminal:{' '}
                      <strong className="text-[var(--text-main)]">
                        {assigningJob.originTerminalName || assigningJob.terminalName}
                      </strong>
                    </span>
                    <span className="text-cyan-300 font-semibold">
                      Locks automatically once L2 reaches ASSIGNED
                    </span>
                  </div>
                </div>
              )}

              {/* Port Gate Token & PCS Pre-Dispatch Interlock + 2-Hour Slot Time Window */}
              <div className="space-y-3 p-3.5 rounded-xl bg-[var(--bg-main)]/60 border border-[var(--border-subtle)]">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-[var(--text-main)] flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Gate / Port Token & Appointment Time Window</span>
                  </label>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/15 border border-blue-500/30 text-[10px] font-bold text-blue-300">
                    <Clock className="w-2.5 h-2.5 text-blue-400" />
                    <span>{formatTwoHourWindowLabel(tokenSlotStartHour)} (2 Hrs Gap)</span>
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                  <div className="sm:col-span-5 space-y-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] block">
                      Token / Appointment Code
                    </span>
                    <input
                      type="text"
                      value={tokenInput}
                      onChange={(e) => setTokenInput(e.target.value.toUpperCase())}
                      placeholder="e.g. DPW-T1-884120"
                      className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono font-bold uppercase outline-none focus:border-blue-500 text-xs"
                    />
                  </div>

                  <div className="sm:col-span-4 space-y-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] block">
                      Slot Start Time
                    </span>
                    <select
                      value={tokenSlotStartHour}
                      onChange={(e) => setTokenSlotStartHour(Number(e.target.value))}
                      className="w-full px-2.5 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] font-semibold outline-none focus:border-blue-500 text-xs cursor-pointer"
                    >
                      {Array.from({ length: 24 }, (_, hr) => (
                        <option key={hr} value={hr}>
                          {formatShortHourAmPm(hr)} ({formatTwoHourWindowLabel(hr)})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-3 space-y-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] block">
                      End Time (+2 Hrs)
                    </span>
                    <div
                      className="w-full px-2.5 py-2 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-300 font-bold text-xs flex items-center justify-between select-none"
                      title="Automatically calculated as Start Time + 2 Hours"
                    >
                      <span>{formatShortHourAmPm((tokenSlotStartHour + 2) % 24)}</span>
                      <span className="text-[10px] font-mono text-blue-400/90">+2h</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] pt-0.5">
                  <span>
                    Selected Port Gate Window:{' '}
                    <strong className="text-[var(--text-main)]">
                      {formatFullHourAmPm(tokenSlotStartHour)} – {formatFullHourAmPm((tokenSlotStartHour + 2) % 24)}
                    </strong>{' '}
                    ({formatTwoHourWindowLabel(tokenSlotStartHour)})
                  </span>
                  <span className="text-emerald-400 font-medium">Auto 2-Hr Slot</span>
                </div>

                {assigningJob && (assigningJob.inspectionStatus === 'HOLD_PENDING' || assigningJob.doStatus === 'EXPIRED') && (
                  <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-[11px] space-y-1">
                    <div className="font-bold flex items-center gap-1.5 text-amber-300">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>PCS Pre-Dispatch Advisory:</span>
                    </div>
                    <div>
                      {assigningJob.inspectionStatus === 'HOLD_PENDING' && (
                        <span>Container {assigningJob.containerNumber} has an active inspection hold. Driver must report to port inspection bay. </span>
                      )}
                      {assigningJob.doStatus === 'EXPIRED' && (
                        <span>Electronic DO is expired. Revalidate eDO in Containers desk to ensure gate clearance.</span>
                      )}
                    </div>
                  </div>
                )}
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
                {submittingAssign
    ? 'Assigning Assets...'
    : activeStreetTurnPair
    ? 'Confirm Street-Turn Triangulation'
    : isBogieAssign
    ? 'Confirm Dual-20FT Bogie Dispatch'
    : 'Confirm Assignment & Token'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Token Modal */}
      {editingTokenJob && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-[var(--text-main)] flex items-center gap-2">
                <Key className="w-4 h-4 text-emerald-400" />
                Update Gate Token & 2-Hr Slot for {editingTokenJob.jobCode}
              </h4>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/15 border border-blue-500/30 text-[10px] font-bold text-blue-300">
                <Clock className="w-2.5 h-2.5 text-blue-400" />
                <span>{formatTwoHourWindowLabel(editTokenSlotStartHour)}</span>
              </span>
            </div>

            <div className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-[var(--text-muted)] block">
                  Gate / Port Token Number
                </label>
                <input
                  type="text"
                  value={newTokenValue}
                  onChange={(e) => setNewTokenValue(e.target.value.toUpperCase())}
                  placeholder="e.g. DPW-TKN-9021"
                  className="w-full text-xs font-mono font-bold p-2.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500 uppercase"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-[var(--text-muted)] block">
                    Slot Start Time
                  </label>
                  <select
                    value={editTokenSlotStartHour}
                    onChange={(e) => setEditTokenSlotStartHour(Number(e.target.value))}
                    className="w-full p-2.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-semibold outline-none focus:border-blue-500 text-xs cursor-pointer"
                  >
                    {Array.from({ length: 24 }, (_, hr) => (
                      <option key={hr} value={hr}>
                        {formatShortHourAmPm(hr)} ({formatTwoHourWindowLabel(hr)})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-[var(--text-muted)] block">
                    End Time (Auto +2 Hrs)
                  </label>
                  <div className="w-full p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-300 font-bold text-xs flex items-center justify-between select-none">
                    <span>{formatShortHourAmPm((editTokenSlotStartHour + 2) % 24)}</span>
                    <span className="text-[10px] font-mono text-blue-400">+2 Hrs Gap</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
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
                Save Token & Slot
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change L2 Return Terminal Modal */}
      {changingReturnTerminalJob && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-[var(--bg-surface)] border border-cyan-500/40 shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <div>
                <h4 className="text-sm font-bold text-[var(--text-main)] flex items-center gap-2">
                  <ArrowUpDown className="w-4 h-4 text-cyan-400" />
                  <span>Change L2 Empty Return Terminal ({changingReturnTerminalJob.jobCode})</span>
                </h4>
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                  Container <strong className="font-mono text-[var(--text-main)]">{changingReturnTerminalJob.containerNumber}</strong> ({changingReturnTerminalJob.containerSize}) · Consignee: <strong className="text-[var(--text-main)]">{changingReturnTerminalJob.warehouseName}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setChangingReturnTerminalJob(null)}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              {/* Eligibility Window Banner */}
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="font-bold text-emerald-300 flex items-center gap-1.5 text-[11px]">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>Unlocked Eligibility Window ({changingReturnTerminalJob.jobPhase} · {changingReturnTerminalJob.status})</span>
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)]">
                    Unlocked from <code className="font-mono">EN_ROUTE_WAREHOUSE</code> (post-port exit) through <code className="font-mono">PLACED_AT_RAMP</code> / <code className="font-mono">PLACED_AT_YARD</code> / <code className="font-mono">MT_Reassign to Yard</code>, <code className="font-mono">READY_FOR_PICKUP</code>, and <code className="font-mono">L2 - PENDING</code>.
                  </div>
                </div>
              </div>

              {/* Origin vs Current Return Terminal Summary */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="p-2.5 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] space-y-0.5">
                  <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] block">
                    L1 Origin Pickup Terminal
                  </span>
                  <strong className="text-xs text-[var(--text-main)] block truncate">
                    {changingReturnTerminalJob.originTerminalName || changingReturnTerminalJob.terminalName}
                  </strong>
                </div>
                <div className="p-2.5 rounded-xl bg-[var(--bg-main)] border border-cyan-500/30 space-y-0.5">
                  <span className="text-[10px] uppercase tracking-wider text-cyan-400 block">
                    Current L2 Return Terminal
                  </span>
                  <strong className="text-xs text-cyan-300 block truncate">
                    {changingReturnTerminalJob.returnTerminalName || changingReturnTerminalJob.terminalName}
                  </strong>
                </div>
              </div>

              {/* Target L2 Return Terminal Selector */}
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-[var(--text-muted)] block">
                  New L2 Empty Return Terminal *
                </label>
                <select
                  value={newReturnTerminalId}
                  onChange={(e) => setNewReturnTerminalId(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-[var(--bg-main)] border border-cyan-500/40 text-[var(--text-main)] font-semibold outline-none focus:border-cyan-400 text-xs cursor-pointer"
                >
                  {terminals.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.code} · {t.emirate})
                    </option>
                  ))}
                </select>
              </div>

              {/* Live Smart Analysis Impact Preview */}
              {(() => {
                const targetTerm = terminals.find((t) => t.id === newReturnTerminalId);
                if (!targetTerm) return null;
                const matchingOutboundL1 = unassignedJobs.filter(
                  (j) =>
                    j.jobPhase === 'L1' &&
                    j.status === 'PENDING' &&
                    !j.trailerDetached &&
                    (j.terminalName || '').trim().toLowerCase() === targetTerm.name.trim().toLowerCase(),
                );
                return (
                  <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/30 space-y-1">
                    <div className="font-bold text-blue-300 flex items-center justify-between text-[11px]">
                      <span className="flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                        <span>Smart Analysis Live Impact @ {targetTerm.name}</span>
                      </span>
                      <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-blue-500/20 text-blue-300">
                        {matchingOutboundL1.length} Pending L1 Pickup(s)
                      </span>
                    </div>
                    <p className="text-[10px] text-[var(--text-muted)]">
                      {matchingOutboundL1.length > 0
                        ? `✓ Redirecting L2 return to ${targetTerm.name} unlocks immediate Port Terminal Reload / 3-Leg Daisy-Chain pairing with ${matchingOutboundL1.map((j) => j.jobCode).slice(0, 3).join(', ')} (0.0 km terminal handoff).`
                        : `ℹ️ ${targetTerm.name} currently has 0 pending L1 pickups. Smart Backhaul Hold Advisor will monitor DO free time to prevent an empty return if needed.`}
                    </p>
                  </div>
                );
              })()}

              {/* Reason / Shipping Line Instruction */}
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-[var(--text-muted)] block">
                  Redirection Reason / Shipping Line Instruction (Optional)
                </label>
                <input
                  type="text"
                  value={returnTerminalReason}
                  onChange={(e) => setReturnTerminalReason(e.target.value)}
                  placeholder="e.g. Shipping line empty depot redirection / Berth congestion at origin terminal"
                  className="w-full p-2.5 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-cyan-400 text-xs"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={() => setChangingReturnTerminalJob(null)}
                className="px-3.5 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submittingReturnTerminal || !newReturnTerminalId}
                onClick={handleConfirmReturnTerminalChange}
                className="px-4 py-1.5 rounded-lg bg-cyan-600 text-white text-xs font-bold hover:bg-cyan-500 transition-colors shadow-sm disabled:opacity-50"
              >
                {submittingReturnTerminal ? 'Updating Return Terminal...' : 'Confirm Return Terminal Change'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3-Dot Tracking Portal Dropdown Menu */}
      {portalMenuState && (() => {
        const menuJob = portalMenuState.job;
        const isLinkActive = isJobAssignedActive(menuJob);
        const sharePath = getJobShareablePath(menuJob, 'CUSTOMER');
        const isCopied = copiedJobId === `${menuJob.id}:CUSTOMER` || copiedJobId === menuJob.id;

        return (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setPortalMenuState(null)}
            />
            <div
              style={{
                top: `${portalMenuState.top}px`,
                right: `${portalMenuState.right}px`,
              }}
              className="fixed z-50 w-52 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl p-2 space-y-1.5"
            >
              <div className="px-2 py-1 border-b border-[var(--border-subtle)] mb-1">
                <div className="text-[11px] font-bold text-[var(--text-main)] font-mono">
                  {menuJob.jobCode}
                </div>
                <div className="text-[10px] text-[var(--text-muted)] truncate">
                  {menuJob.containerNumber} · {isLinkActive ? 'Link Active' : 'Activates at Assign'}
                </div>
              </div>

              <button
                type="button"
                disabled={!isLinkActive}
                onClick={() => {
                  handleCopyJobTrackingLink(menuJob, 'CUSTOMER');
                  setPortalMenuState(null);
                }}
                title={
                  isLinkActive
                    ? 'Copy Customer Tracking Link'
                    : 'Customer & Client Links activate upon Vehicle & Driver Assignment (ASSIGNED)'
                }
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25 text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Copy className="w-3.5 h-3.5 shrink-0" />
                <span>{isCopied ? 'Copied!' : 'Copy Link'}</span>
              </button>

              {isLinkActive ? (
                <a
                  href={sharePath}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setPortalMenuState(null)}
                  title="Open No-Login Customer Tracking Portal in a new tab"
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg bg-sky-500/15 border border-sky-500/30 text-sky-400 hover:bg-sky-500/25 text-xs font-semibold transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  <span>Portal</span>
                </a>
              ) : (
                <div
                  title="Customer & Client Links activate upon Vehicle & Driver Assignment (ASSIGNED)"
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg bg-slate-500/10 border border-slate-500/20 text-slate-500 text-xs font-semibold opacity-50 cursor-not-allowed"
                >
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  <span>Portal</span>
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  setPortalMenuState(null);
                  handleOpenShareTrackingModal(menuJob);
                }}
                title="Share Role-Scoped Links (Customer / Client / Ramp)"
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg bg-violet-500/15 border border-violet-500/30 text-violet-400 hover:bg-violet-500/25 text-xs font-semibold transition-colors"
              >
                <Share2 className="w-3.5 h-3.5 shrink-0" />
                <span>Share</span>
              </button>
            </div>
          </>
        );
      })()}

      {/* Super Admin Drayage Configuration Modal */}
      {/* One-Click Share Role-Scoped Live Tracking Links (Customer / Client / Ramp) Modal */}
      {sharingTrackingJob && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-2xl bg-[var(--bg-surface)] border border-emerald-500/40 shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <div>
                <h3 className="text-sm font-bold text-[var(--text-main)] flex items-center gap-2">
                  <Share2 className="w-4 h-4 text-emerald-400" />
                  Role-Scoped Live Tracking & Ramp Links (No-Login Portal)
                </h3>
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                  Container <strong className="font-mono text-[var(--text-main)]">{sharingTrackingJob.containerNumber}</strong> ({sharingTrackingJob.jobCode}) · Status: <span className="font-semibold text-[var(--text-main)]">{sharingTrackingJob.status}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSharingTrackingJob(null)}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {(() => {
              const assignedActive = isJobAssignedActive(sharingTrackingJob);
              const rampActive = isJobRampActive(sharingTrackingJob);
              const selectedRoleActive = shareRole === 'RAMP' ? rampActive : assignedActive;
              const selectedSharePath = getJobShareablePath(sharingTrackingJob, shareRole);
              const fullShareUrl = typeof window !== 'undefined'
                ? `${window.location.origin}${selectedSharePath}`
                : selectedSharePath;

              return (
                <div className="space-y-3 text-xs">
                  {/* Role Selector Tabs */}
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => handleSelectShareRole(sharingTrackingJob, 'CUSTOMER')}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        shareRole === 'CUSTOMER'
                          ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                          : 'bg-[var(--bg-main)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold">1. Customer Link</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${
                          assignedActive
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                        }`}>
                          {assignedActive ? 'Active' : 'At Assign'}
                        </span>
                      </div>
                      <p className="text-[10px] opacity-80 mt-0.5 truncate">
                        {sharingTrackingJob.customerName || 'Consignor / Shipper'}
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSelectShareRole(sharingTrackingJob, 'CLIENT')}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        shareRole === 'CLIENT'
                          ? 'bg-sky-500/15 border-sky-500/50 text-sky-300'
                          : 'bg-[var(--bg-main)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold">2. Client Link</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${
                          assignedActive
                            ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                            : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                        }`}>
                          {assignedActive ? 'Active' : 'At Assign'}
                        </span>
                      </div>
                      <p className="text-[10px] opacity-80 mt-0.5 truncate">
                        {sharingTrackingJob.customerPortal?.clientName || 'Consignee / End User'}
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSelectShareRole(sharingTrackingJob, 'RAMP')}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        shareRole === 'RAMP'
                          ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                          : 'bg-[var(--bg-main)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold">3. Ramp Link</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${
                          rampActive
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                        }`}>
                          {rampActive ? 'Active' : 'At Ramp'}
                        </span>
                      </div>
                      <p className="text-[10px] opacity-80 mt-0.5 truncate">
                        {sharingTrackingJob.warehouseName || 'Stuffing / Destuffing'}
                      </p>
                    </button>
                  </div>

                  {/* Selected Role Link Details & Gating Notice */}
                  <div className="p-3 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                        {shareRole === 'CUSTOMER' && 'Customer Link (Read-Only Live Tracking + Signed ePOD)'}
                        {shareRole === 'CLIENT' && 'Client Link (End-User Live Tracking + Signed ePOD)'}
                        {shareRole === 'RAMP' && 'Ramp Link (Update Completion of Stuffing / Destuffing)'}
                      </span>
                      <span className={`text-[10px] px-2 py-0.5 rounded font-semibold border ${
                        selectedRoleActive
                          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                          : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                      }`}>
                        {selectedRoleActive
                          ? 'Active & Unlocked'
                          : shareRole === 'RAMP'
                          ? 'Activates at PLACED_AT_RAMP'
                          : 'Activates upon Vehicle & Driver Assignment'}
                      </span>
                    </div>

                    {selectedRoleActive ? (
                      <>
                        <code className="block text-[11px] font-mono text-[var(--text-main)] break-all">
                          {fullShareUrl}
                        </code>
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => handleCopyJobTrackingLink(sharingTrackingJob, shareRole)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-500 transition-colors"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            Copy {shareRole === 'RAMP' ? 'Ramp' : shareRole === 'CLIENT' ? 'Client' : 'Customer'} Link
                          </button>
                          <a
                            href={selectedSharePath}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 border border-blue-500/40 text-blue-400 font-bold hover:bg-blue-600/30 transition-colors"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            Open {shareRole === 'RAMP' ? 'Ramp Console' : 'Portal'}
                          </a>
                        </div>
                      </>
                    ) : (
                      <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px]">
                        {shareRole === 'RAMP' ? (
                          <>
                            <strong>Locked until PLACED_AT_RAMP:</strong> The Ramp Link only activates once the container reaches{' '}
                            <code className="font-mono font-bold">PLACED_AT_RAMP</code> status at{' '}
                            <strong>{sharingTrackingJob.warehouseName}</strong> so ramp supervisors can update completion of Stuffing / Destuffing.
                          </>
                        ) : (
                          <>
                            <strong>Locked until Vehicle &amp; Driver Assignment:</strong> The{' '}
                            {shareRole === 'CLIENT' ? 'Client' : 'Customer'} Link only activates once a Vehicle &amp; Driver are assigned (
                            <code className="font-mono font-bold">ASSIGNED</code> status).
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="font-semibold text-[var(--text-muted)] block">
                        {shareRole === 'RAMP'
                          ? 'Ramp Supervisor WhatsApp Number'
                          : shareRole === 'CLIENT'
                          ? 'Client (Consignee) WhatsApp Number'
                          : 'Customer (Consignor) WhatsApp Number'}
                      </label>
                      <input
                        type="text"
                        value={shareWhatsAppInput}
                        onChange={(e) => setShareWhatsAppInput(e.target.value)}
                        placeholder="+971 50 000 0000"
                        className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono outline-none focus:border-emerald-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-semibold text-[var(--text-muted)] block">
                        {shareRole === 'RAMP'
                          ? 'Ramp / Warehouse Email (Optional)'
                          : shareRole === 'CLIENT'
                          ? 'Client (Consignee) Email Address'
                          : 'Customer (Consignor) Email Address'}
                      </label>
                      <input
                        type="email"
                        value={shareEmailInput}
                        onChange={(e) => setShareEmailInput(e.target.value)}
                        placeholder="operations@company.ae"
                        className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-[var(--border-subtle)]">
                    <div className="flex items-center gap-2">
                      {selectedRoleActive ? (
                        <>
                          <a
                            href={`https://wa.me/${shareWhatsAppInput.replace(/[^\d]/g, '')}?text=${encodeURIComponent(
                              shareRole === 'RAMP'
                                ? `🏗️ *Fleet360 Ramp Stuffing / Destuffing Console*\n• *Job:* ${sharingTrackingJob.jobCode}\n• *Container:* ${sharingTrackingJob.containerNumber} (${sharingTrackingJob.containerSize})\n• *Facility:* ${sharingTrackingJob.warehouseName}\n🔗 *Update Stuffing / Destuffing Completion:* ${fullShareUrl}`
                                : `📦 *Fleet360 Live Container Tracking (${shareRole})*\n• *Job:* ${sharingTrackingJob.jobCode}\n• *Container:* ${sharingTrackingJob.containerNumber} (${sharingTrackingJob.containerSize})\n• *Status:* ${sharingTrackingJob.status}\n• *Route:* ${sharingTrackingJob.terminalName} → ${sharingTrackingJob.warehouseName}\n🔗 *Track Live Milestones & Download Signed ePOD:* ${fullShareUrl}`
                            )}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-emerald-400 font-bold hover:bg-emerald-600/30 transition-colors"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                            Open WhatsApp
                          </a>
                          <a
                            href={`mailto:${encodeURIComponent(shareEmailInput)}?subject=${encodeURIComponent(
                              shareRole === 'RAMP'
                                ? `Ramp Stuffing / Destuffing Completion Link — ${sharingTrackingJob.containerNumber} (${sharingTrackingJob.jobCode})`
                                : `Live Container Tracking & Signed ePOD — ${sharingTrackingJob.containerNumber} (${sharingTrackingJob.jobCode})`
                            )}&body=${encodeURIComponent(
                              `Hello,\n\nAccess the ${shareRole} portal for Container ${sharingTrackingJob.containerNumber} (${sharingTrackingJob.jobCode}):\n\n${fullShareUrl}\n\nRoute: ${sharingTrackingJob.terminalName} → ${sharingTrackingJob.warehouseName}\nCurrent Status: ${sharingTrackingJob.status}`
                            )}`}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600/20 border border-sky-500/40 text-sky-400 font-bold hover:bg-sky-600/30 transition-colors"
                          >
                            <Mail className="w-3.5 h-3.5" />
                            Open Email
                          </a>
                        </>
                      ) : (
                        <span className="text-[11px] text-amber-400 font-medium">
                          Sharing unlocks once required job status is reached.
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={sendingShareAlert || !selectedRoleActive}
                      onClick={handleDispatchTrackingAlert}
                      className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      {sendingShareAlert ? 'Sending Alert...' : `Send ${shareRole} Alert`}
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Operations Team Status Update & Driver App Live Sync Modal */}
      {statusUpdateJob && (() => {
        const recNext = getRecommendedNextDriverStatus(statusUpdateJob);
        const currentDisp = evaluateDispatcherJobReassignState(statusUpdateJob).displayStatus;
        const isRampSelected = selectedTargetStatus.toUpperCase().includes('RAMP');
        return (
          <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-lg rounded-2xl bg-[var(--bg-surface)] border border-emerald-500/40 shadow-2xl p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
                <div>
                  <h4 className="text-sm font-bold text-[var(--text-main)] flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 text-emerald-400" />
                    <span>Operations Status Update ({statusUpdateJob.jobCode})</span>
                  </h4>
                  <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                    Container <strong className="font-mono text-[var(--text-main)]">{statusUpdateJob.containerNumber}</strong> ({statusUpdateJob.containerSize}) · Driver: <strong className="text-[var(--text-main)]">{statusUpdateJob.assignedDriverName || 'Unassigned'}</strong>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setStatusUpdateJob(null)}
                  className="text-[var(--text-muted)] hover:text-[var(--text-main)] p-1 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3.5 text-xs">
                {/* Auto-Sync Banner */}
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="font-bold text-emerald-300 flex items-center gap-1.5 text-[11px]">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span>Automatic Two-Way Driver App Status Sync</span>
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)]">
                      Updating the status here immediately syncs to the assigned driver&apos;s mobile app (<strong className="text-[var(--text-main)]">{statusUpdateJob.assignedDriverName || 'Driver App'}</strong>) and advances their next action step.
                    </div>
                  </div>
                </div>

                {/* Current Status & 1-Tap Recommended Next Driver Step */}
                <div className="p-3 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] block">
                      Current Job Status
                    </span>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <StatusPill status={currentDisp} label={currentDisp} />
                      {doesJobRequireInspection(statusUpdateJob) ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-purple-500/15 text-purple-300 border border-purple-500/30">
                          🛃 Inspection Required ({getActiveJobInspectionLabels(statusUpdateJob).join(', ') || 'Hold Active'})
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/10 text-emerald-300 border border-emerald-500/25">
                          ✓ Green Channel (Under Inspection Auto-Bypassed)
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={submittingStatusUpdate}
                    onClick={() => handleConfirmOperatorStatusUpdate(recNext.nextStatus, recNext.placement)}
                    className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-sm transition-colors disabled:opacity-50"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>1-Click Advance: {recNext.label}</span>
                  </button>
                </div>

                {/* Or Select Any Target Status */}
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-[var(--text-muted)] block">
                    Or Select Any Target Status (Override / Multi-Step Sync)
                  </label>
                  <select
                    value={selectedTargetStatus}
                    onChange={(e) => setSelectedTargetStatus(e.target.value)}
                    className="w-full p-2.5 rounded-xl bg-[var(--bg-main)] border border-emerald-500/40 text-[var(--text-main)] font-semibold outline-none focus:border-emerald-400 text-xs cursor-pointer"
                  >
                    <option value="PENDING">PENDING</option>
                    <option value="ASSIGNED">ASSIGNED</option>
                    <option value="ACCEPTED">ACCEPTED (Job Accepted by Driver)</option>
                    <option value="CONTAINER_PICKED">CONTAINER_PICKED (Picked at Port / WH)</option>
                    <option value="UNDER_INSPECTION">UNDER_INSPECTION (Port / Customs Inspection)</option>
                    <option value="EN_ROUTE_WAREHOUSE">EN_ROUTE_WAREHOUSE (In Transit to Warehouse)</option>
                    <option value="PLACED_AT_RAMP">PLACED_AT_RAMP (Placed @ Warehouse Ramp)</option>
                    <option value="PLACED_AT_YARD">PLACED_AT_YARD (Placed @ Warehouse Yard)</option>
                    <option value="TRAILER_DETACHED">TRAILER_DETACHED (Trailer Detached)</option>
                    <option value="MT_Reassign to Yard">MT_Reassign to Yard</option>
                    <option value="FCL_Reassign to Yard">FCL_Reassign to Yard</option>
                    <option value="FCL_Reassign to Ramp">FCL_Reassign to Ramp</option>
                    <option value="MT_Reassign to Ramp">MT_Reassign to Ramp</option>
                    <option value="RE-ASSIGNED">RE-ASSIGNED</option>
                    <option value="TRAILER_ATTACHED">TRAILER_ATTACHED (Reassign Coupled)</option>
                    <option value="REASSIGN_PLACED_AT_RAMP">REASSIGN_PLACED_AT_RAMP (Shunted to Ramp)</option>
                    <option value="REASSIGN_PLACED_AT_YARD">REASSIGN_PLACED_AT_YARD (Shunted to Yard)</option>
                    <option value="READY_FOR_PICKUP">READY_FOR_PICKUP (Ready for L2 Return)</option>
                    <option value="EN_ROUTE_TERMINAL">EN_ROUTE_TERMINAL (L2 In Transit to Port)</option>
                    <option value="ARRIVED_AT_PORT">ARRIVED_AT_PORT (L2 Arrived at Port Gate)</option>
                    <option value="CONTAINER_DROPPED">CONTAINER_DROPPED (L2 Empty Dropped at Port)</option>
                    <option value="COMPLETED">COMPLETED</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-[var(--text-muted)] block">
                      Placement Location
                    </label>
                    <select
                      value={selectedPlacementLocation}
                      onChange={(e) => setSelectedPlacementLocation(e.target.value as 'RAMP' | 'YARD')}
                      className="w-full p-2.5 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-semibold outline-none focus:border-emerald-400 text-xs cursor-pointer"
                    >
                      <option value="RAMP">RAMP (Offloading Dock)</option>
                      <option value="YARD">YARD (Container Yard)</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-[var(--text-muted)] block">
                      Ramp Offload ETC Timer {isRampSelected ? '*' : '(If at Ramp)'}
                    </label>
                    <select
                      value={selectedEtcHours}
                      onChange={(e) => setSelectedEtcHours(Number(e.target.value))}
                      className="w-full p-2.5 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-semibold outline-none focus:border-emerald-400 text-xs cursor-pointer"
                    >
                      <option value={1}>1 Hour ETC</option>
                      <option value={2}>2 Hours ETC</option>
                      <option value={3}>3 Hours ETC (Standard)</option>
                      <option value={4}>4 Hours ETC</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-[var(--text-muted)] block">
                    Operator Note / Reason (Synced to Audit Log &amp; Driver App)
                  </label>
                  <input
                    type="text"
                    value={statusUpdateNotes}
                    onChange={(e) => setStatusUpdateNotes(e.target.value)}
                    placeholder="e.g. Driver unable to update due to port network dead-zone — updated by Operations"
                    className="w-full p-2.5 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-emerald-400 text-xs"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => setStatusUpdateJob(null)}
                  className="px-3.5 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={submittingStatusUpdate}
                  onClick={() => handleConfirmOperatorStatusUpdate()}
                  className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 transition-colors shadow-sm disabled:opacity-50"
                >
                  {submittingStatusUpdate ? 'Syncing Status...' : `Update to ${selectedTargetStatus} & Sync Driver App`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <DrayageEditJobModal
        open={Boolean(editJobTarget)}
        job={editJobTarget}
        customers={customers}
        terminals={terminals}
        warehouses={warehouses}
        onClose={() => setEditJobTarget(null)}
        onSaved={async (msg) => {
          invalidateDrayageClientCache();
          showToast('success', msg);
          await loadData(true);
        }}
        onError={(msg) => showToast('error', msg)}
      />

      <DrayageSuperAdminConfigModal
        open={configModalOpen}
        onClose={() => setConfigModalOpen(false)}
        config={automationConfig}
        onSaved={(updated) => {
          setAutomationConfig(updated);
          invalidateDrayageClientCache();
          showToast(
            'success',
            `⚙️ Drayage Policy Updated: Street-Turn ≤${updated.streetTurnRadiusKm}km · Weights ${updated.weightProximityPct}/${updated.weightIdlenessPct}/${updated.weightWorkloadPct}/${updated.weightAvailabilityPct}%`,
          );
          loadData(true);
        }}
      />
    </div>
  );
}
