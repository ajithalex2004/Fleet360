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
  Leaf,
  Scale,
} from 'lucide-react';
import { PageHeader, KpiCard, StatusPill } from '@/components/ui/page-theme';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import FleetDataGrid, { type DataGridColumn } from '@/components/ui/FleetDataGrid';
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
  warehouseId?: string | null;
  terminalName: string;
  terminalId?: string | null;
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
}

interface DrayageTerminal {
  id: string;
  name: string;
  code: string;
  portName: string;
  emirate: string;
  lat?: number;
  lng?: number;
}

interface DrayageWarehouse {
  id: string;
  name: string;
  code: string | null;
  zone: string;
  address: string;
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
  shippingLine: string;
  carrierPrefix: string;
  containerNumber: string;
  containerSize: string;
  containerType: string;
  originWarehouse: string;
  destWarehouse: string;
  zone: string;
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

interface AutoPilotDispatchItem {
  id: string;
  type: 'BOGIE' | 'STREET_TURN' | 'SINGLE';
  jobIds: string[];
  jobCodes: string[];
  containers: string[];
  customerNames: string[];
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
  idleHours: number;
  tripsToday: number;
  fuelPct: number;
  maintenanceBufferKm: number;
  rankBadge: string;
}

export default function DrayageAssignmentPage() {
  const cached = getCachedDrayageData();
  const [loading, setLoading] = useState(!cached?.jobs);
  const [jobs, setJobs] = useState<DrayageJob[]>(cached?.jobs || []);
  const [vehicles, setVehicles] = useState<MappedVehicle[]>(cached?.vehicles || []);
  const [drivers, setDrivers] = useState<MappedDriver[]>(cached?.drivers || []);
  const [trailers, setTrailers] = useState<DrayageTrailer[]>(cached?.trailers || []);
  const [terminals, setTerminals] = useState<DrayageTerminal[]>(cached?.terminals || []);
  const [warehouses, setWarehouses] = useState<DrayageWarehouse[]>(cached?.warehouses || []);
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);

  // Smart Analysis UI state
  const [showSmartAnalysis, setShowSmartAnalysis] = useState(true);
  const [smartAnalysisFilter, setSmartAnalysisFilter] = useState<'ALL' | 'BOGIE' | 'STREET_TURN' | 'DEMURRAGE'>('ALL');

  // Auto-Pilot Batch Dispatch state
  const [showAutoPilotModal, setShowAutoPilotModal] = useState(false);
  const [autoPilotPlan, setAutoPilotPlan] = useState<AutoPilotDispatchItem[]>([]);
  const [submittingBatch, setSubmittingBatch] = useState(false);

  // Modals
  const [assigningJob, setAssigningJob] = useState<DrayageJob | null>(null);
  const [editingTokenJob, setEditingTokenJob] = useState<DrayageJob | null>(null);
  const [newTokenValue, setNewTokenValue] = useState('');
  const [isBogieAssign, setIsBogieAssign] = useState(false);
  const [activeStreetTurnPair, setActiveStreetTurnPair] = useState<StreetTurnRecommendation | null>(null);

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
      setTerminals(data?.terminals || []);
      setWarehouses(data?.warehouses || []);
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

  // Filter unassigned jobs & all jobs
  const unassignedJobs = useMemo(
    () => jobs.filter((j) => j.status === 'PENDING' || !j.assignedVehicleId),
    [jobs],
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

    const isSameTerminal = job2
      ? job1.terminalName.trim().toLowerCase() === job2.terminalName.trim().toLowerCase()
      : true;

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
    const twentyFtJobs = unassignedJobs.filter((j) => j.containerSize === '20FT');
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

        // Condition 2: Destination Zones
        const zone1 = getWarehouseZone(j1.warehouseName, j1.warehouseId);
        const zone2 = getWarehouseZone(j2.warehouseName, j2.warehouseId);
        const sameZone = zone1.toLowerCase() === zone2.toLowerCase();

        // Weight safety check (UAE RTA / FTA max legal payload limit: 36,000 kg)
        const box1WeightKg = j1.cargoWeightKg || 14500;
        const box2WeightKg = j2.cargoWeightKg || 16200;
        const totalPayloadKg = box1WeightKg + box2WeightKg;
        const weightLimitKg = 36000;
        const isWeightCompliant = totalPayloadKg <= weightLimitKg;
        const weightUtilizationPct = Math.round((totalPayloadKg / weightLimitKg) * 100);

        // Calculate sequence: Drop #1 = More urgent DO expiry or alphabetical zone
        const r1 = getDemurrageRisk(j1);
        const r2 = getDemurrageRisk(j2);
        const drop1 = r1.hoursRemaining <= r2.hoursRemaining ? j1 : j2;
        const drop2 = drop1.id === j1.id ? j2 : j1;

        const combinedRevenueAed = (j1.rateAmountAed || 1450) + (j2.rateAmountAed || 1450);
        const combinedAllowanceAed = (j1.driverAllowanceAed || 150) + (j2.driverAllowanceAed || 150);
        const hasUrgentDemurrage = r1.level === 'CRITICAL' || r2.level === 'CRITICAL' || r1.level === 'EXPIRED' || r2.level === 'EXPIRED';

        const tas = getTasSlotWindow(j1, j2);

        // Scoring: Base 80, Same Zone +15, Demurrage Urgency +25, Weight Compliant +10
        let score = 80;
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
          dropSequence: [`Drop #1: ${drop1.warehouseName} (${drop1.customerName})`, `Drop #2: ${drop2.warehouseName} (${drop2.customerName})`],
          combinedRevenueAed,
          combinedAllowanceAed,
          fuelSavingPct: 40,
          hasUrgentDemurrage,
          tasSlot: tas.slotTime,
          score,
          box1WeightKg,
          box2WeightKg,
          totalPayloadKg,
          isWeightCompliant,
          weightLimitKg,
          weightUtilizationPct,
          chassisRequirement: '40FT Skeletal / Bogie Multi-Axle',
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
  }, [unassignedJobs, getDemurrageRisk, getTasSlotWindow, getWarehouseZone]);

  // =========================================================================
  // ZONE-BASED STREET-TURN MATCHING ENGINE (L2 Empty Warehouse -> Pending Export Booking)
  // =========================================================================
  const streetTurnPairs = useMemo(() => {
    // 1. Freshly activated L2 empty containers sitting in warehouse zones
    const l2Inbound = unassignedJobs.filter((j) => j.jobPhase === 'L2' || j.status === 'WAITING_MT_RETURN');
    // 2. Pending export bookings
    const exportBookings = unassignedJobs.filter(
      (j) => j.shipmentType === 'EXPORT' || j.jobCode.startsWith('EXP') || j.jobCode.includes('EXP')
    );
    // Fallback: If no explicit EXPORT jobs in queue, also evaluate unassigned L1 jobs
    const l1Outbound = exportBookings.length > 0 ? exportBookings : unassignedJobs.filter((j) => j.jobPhase === 'L1');

    if (l2Inbound.length === 0 || l1Outbound.length === 0) return [];

    const candidates: StreetTurnRecommendation[] = [];
    for (const j2 of l2Inbound) {
      for (const j1 of l1Outbound) {
        if (j2.id === j1.id) continue;

        const zoneL2 = getWarehouseZone(j2.warehouseName, j2.warehouseId);
        const zoneL1 = getWarehouseZone(j1.warehouseName, j1.warehouseId);
        const sameZone = zoneL2.toLowerCase() === zoneL1.toLowerCase();

        // Terminal Match
        const termMatch =
          j2.terminalName.trim().toLowerCase() === j1.terminalName.trim().toLowerCase();

        // Proximity Match: Same Zone or Corridor Cluster (JAFZA / NIP / Dubai South <= 15 km)
        const isClusterMatch =
          sameZone ||
          (zoneL2.includes('JAFZA') && zoneL1.includes('JAFZA')) ||
          (zoneL2.includes('JAFZA') && zoneL1.includes('NIP')) ||
          (zoneL2.includes('NIP') && zoneL1.includes('JAFZA'));

        if (!isClusterMatch && !termMatch) continue;

        // Container Size Compatibility: 20FT with 20FT, 40FT/40HC with 40FT/40HC
        const sizeMatch =
          j2.containerSize === j1.containerSize ||
          (j2.containerSize.startsWith('40') && j1.containerSize.startsWith('40'));
        if (!sizeMatch) continue;

        // Container Type: DRY with DRY, REEFER with REEFER
        const typeMatch = (j2.containerType || 'DRY').toUpperCase() === (j1.containerType || 'DRY').toUpperCase();
        if (!typeMatch) continue;

        // Carrier Line Matching (e.g. MSCU with MSC)
        const line2 = j2.shippingLine || (j2.containerNumber.startsWith('MSC') ? 'MSC' : j2.containerNumber.slice(0, 4));
        const line1 = j1.shippingLine || (j1.containerNumber.startsWith('MSC') ? 'MSC' : j1.containerNumber.slice(0, 4));
        const isLineMatch = line2 === line1 || j1.containerNumber.includes('TBD') || !j1.containerNumber;

        const interDist = sameZone ? 3.2 : 6.8;
        const deadheadSaved = Math.max(48, Math.round(56 - interDist));
        const co2Saved = Math.round(deadheadSaved * 0.95 * 10) / 10;
        const fuelSaved = Math.round(deadheadSaved * 4.5 + 400);

        const r2 = getDemurrageRisk(j2);
        const r1 = getDemurrageRisk(j1);
        const hasUrgent = r2.level === 'CRITICAL' || r1.level === 'CRITICAL' || r2.level === 'EXPIRED' || r1.level === 'EXPIRED';
        const tas = getTasSlotWindow(j2, j1);

        let score = 90;
        if (sameZone) score += 10;
        if (isLineMatch) score += 8;
        if (hasUrgent) score += 15;

        candidates.push({
          id: `STREET-${j2.id}-${j1.id}`,
          l2Job: j2,
          exportJob: j1,
          inboundJob: j2,
          outboundJob: j1,
          shippingLine: line2,
          carrierPrefix: j2.containerNumber.slice(0, 4),
          containerNumber: j2.containerNumber,
          containerSize: j2.containerSize,
          containerType: j2.containerType || 'DRY',
          originWarehouse: j2.warehouseName,
          destWarehouse: j1.warehouseName,
          zone: zoneL2,
          interWarehouseDistanceKm: interDist,
          terminalName: j1.terminalName || j2.terminalName,
          tasSlot: tas.slotTime,
          combinedRevenueAed: (j2.rateAmountAed || 1200) + (j1.rateAmountAed || 1450),
          combinedAllowanceAed: (j2.driverAllowanceAed || 120) + (j1.driverAllowanceAed || 150),
          deadheadKmSaved: deadheadSaved,
          co2SavedKg: co2Saved,
          fuelSavingsAed: fuelSaved,
          turnaroundHoursSaved: 4.0,
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
      finalStreetTurns.push(pair);
    }

    return finalStreetTurns;
  }, [unassignedJobs, getDemurrageRisk, getTasSlotWindow, getWarehouseZone]);

  // High Demurrage Risk Jobs
  const urgentDemurrageJobs = useMemo(() => {
    return unassignedJobs.filter((j) => {
      const r = getDemurrageRisk(j);
      return r.level === 'CRITICAL' || r.level === 'EXPIRED';
    });
  }, [unassignedJobs, getDemurrageRisk]);

  // =========================================================================
  // FLEET DATA GRID (SMART DATA TABLE) COLUMNS
  // =========================================================================
  const assignmentColumns: DataGridColumn<DrayageJob>[] = useMemo(() => [
    {
      key: 'jobCode',
      header: 'Job & Phase',
      accessor: (j) => `${j.jobCode} ${j.jobPhase} ${j.customerName}`,
      filter: 'text',
      render: (job) => (
        <div>
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
        </div>
      ),
    },
    {
      key: 'container',
      header: 'Container & Route',
      accessor: (j) => `${j.containerNumber} ${j.containerSize} ${j.terminalName} ${j.warehouseName}`,
      filter: 'text',
      render: (job) => (
        <div>
          <div className="font-mono font-semibold flex items-center gap-1.5">
            <span>{job.containerNumber}</span>
            <span className="text-[10px] font-normal text-[var(--text-muted)]">({job.containerSize})</span>
          </div>
          <div className="text-[10px] text-[var(--text-muted)] truncate max-w-[190px]">
            {job.terminalName} → {job.warehouseName}
          </div>
        </div>
      ),
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
      header: 'Port Gate Token',
      accessor: (j) => j.tokenNumber || 'No Token',
      filter: 'text',
      render: (job) => (
        job.tokenNumber ? (
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
        )
      ),
    },
    {
      key: 'assignedAssets',
      header: 'Assigned Assets',
      accessor: (j) =>
        j.assignedVehiclePlate
          ? `${j.assignedVehiclePlate} ${j.assignedDriverName || ''} ${j.assignedTrailerPlate || ''}`
          : 'Pending Assignment',
      filter: 'text',
      render: (job) => {
        const isAssigned = Boolean(job.assignedVehicleId);
        return isAssigned ? (
          <div className="space-y-0.5">
            <div className="font-semibold">{job.assignedVehiclePlate}</div>
            <div className="text-[10px] text-[var(--text-muted)]">
              {job.assignedDriverName} · {job.assignedTrailerPlate || 'Chassis'}
            </div>
          </div>
        ) : (
          <span className="text-amber-400 text-[11px] font-medium">Pending Assignment</span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (j) => j.status,
      filter: 'select',
      selectOptions: ['PENDING', 'ASSIGNED', 'IN_TRANSIT', 'PLACED_AT_RAMP', 'CONTAINER_DETACHED', 'COMPLETED'],
      render: (job) => <StatusPill status={job.status.toLowerCase()} label={job.status} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      sortable: false,
      filter: false,
      render: (job) => {
        const isAssigned = Boolean(job.assignedVehicleId);
        return (
          <div className="flex items-center justify-end gap-1.5">
            <button
              onClick={() => handleOpenAssign(job)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600/15 border border-blue-500/30 text-blue-400 hover:bg-blue-600/25 text-[11px] font-semibold transition-colors"
            >
              {isAssigned ? 'Reassign' : 'Assign Fleet'}
            </button>
          </div>
        );
      },
    },
  ], [getDemurrageRisk]);

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

  // Calculate 4-Factor Composite Telematics Score
  const calculate4FactorScore = useCallback(
    (
      vehicle: MappedVehicle,
      targetTerminalLoc: { lat: number; lng: number },
      candidateDriver?: MappedDriver
    ): Vehicle4FactorScore => {
      // 1. 📍 Proximity Score (60%) — GPS distance to pickup terminal / corridor
      const vLat = typeof vehicle.lat === 'number' && vehicle.lat !== 0 ? vehicle.lat : 25.0112;
      const vLng = typeof vehicle.lng === 'number' && vehicle.lng !== 0 ? vehicle.lng : 55.0617;
      const distanceKm = getHaversineDistanceKm(vLat, vLng, targetTerminalLoc.lat, targetTerminalLoc.lng);

      let proximityScore = 100;
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

      // Composite Weighted Calculation: 60% Prox + 25% Idle + 10% Workload + 5% Avail
      const totalScore = Math.round(
        0.60 * proximityScore +
        0.25 * idlenessScore +
        0.10 * workloadScore +
        0.05 * availabilityScore
      );

      return {
        vehicle,
        driver: candidateDriver,
        proximityScore,
        idlenessScore,
        workloadScore,
        availabilityScore,
        totalScore,
        distanceKm: Math.round(distanceKm * 10) / 10,
        idleHours,
        tripsToday,
        fuelPct,
        maintenanceBufferKm,
        rankBadge: '',
      };
    },
    []
  );

  // =========================================================================
  // SMART ASSET SHORTLISTING ENGINE (4-FACTOR WEIGHTAGE & COMPATIBILITY)
  // =========================================================================
  const getSmartRecommendedAssets = useCallback(
    (job: DrayageJob | null, isBogie = false) => {
      // 1. Resolve Target Pickup Terminal GPS Location
      const targetLoc = getTerminalCoordinates(job?.terminalId || job?.terminalName);

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

      // Sort descending by 4-factor composite score
      scoredList.sort((a, b) => b.totalScore - a.totalScore);
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
    [availableVehicles, primeMovers, availableTrailers, availableDrivers, drivers, getTerminalCoordinates, calculate4FactorScore],
  );

  // Target Terminal for active assignment modal
  const targetTerminalLoc = useMemo(() => {
    return getTerminalCoordinates(assigningJob?.terminalId || assigningJob?.terminalName);
  }, [assigningJob, getTerminalCoordinates]);

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
    scored.sort((a, b) => b.totalScore - a.totalScore);
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
      return scoredPrimeMovers.map((s) => ({
        value: s.vehicle.id,
        label: `${s.rankBadge} ${s.vehicle.plateNumber} · ${s.vehicle.make} ${s.vehicle.model} [${s.totalScore}% Match]`,
        sublabel: `📍 ${s.distanceKm}km (${s.proximityScore}pts) • ⏱️ Idle: ${s.idleHours}h (${s.idlenessScore}pts) • ⚖️ ${s.tripsToday} Trip(s) Today • 🛡️ Fuel: ${s.fuelPct}%`,
        badge: `${s.totalScore}% Match`,
      }));
    }
    return primeMovers.map((v) => ({
      value: v.id,
      label: `${v.plateNumber} · ${v.make} ${v.model}`,
      sublabel: `Type: ${v.type || 'PRIME_MOVER'} • Usage: ${v.vehicleUsage || 'LOGISTICS'} • Status: ${v.status}`,
      badge: v.status,
    }));
  }, [scoredPrimeMovers, primeMovers]);

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
    setTokenInput(`DPW-BG-${Math.floor(1000 + Math.random() * 9000)}`);
  };

  const handleSwapBogieSequence = () => {
    if (selectedJobIds.length === 2) {
      setSelectedJobIds([selectedJobIds[1], selectedJobIds[0]]);
      const job1 = jobs.find((j) => j.id === selectedJobIds[1]);
      if (job1) setAssigningJob(job1);
      showToast('success', 'Drop sequence swapped: Drop #1 ⇄ Drop #2');
    }
  };

  const handleUseStreetTurnPair = (pair: StreetTurnRecommendation) => {
    setActiveStreetTurnPair(pair);
    setSelectedJobIds([pair.inboundJob.id, pair.outboundJob.id]);
    setAssigningJob(pair.inboundJob);
    setIsBogieAssign(false);
    const rec = getSmartRecommendedAssets(pair.inboundJob, false);
    setSelectedVehicleId(rec.vehicleId);
    setSelectedDriverId(rec.driverId);
    setSelectedTrailerId(rec.trailerId);
    setTokenInput(`DPW-ST-${Math.floor(1000 + Math.random() * 9000)}`);
  };

  // Open modal for single job
  const handleOpenAssign = (job: DrayageJob) => {
    setAssigningJob(job);
    setIsBogieAssign(false);
    setSelectedJobIds([job.id]);
    const rec = getSmartRecommendedAssets(job, false);
    setSelectedVehicleId(job.assignedVehicleId || rec.vehicleId);
    setSelectedDriverId(job.assignedDriverId || rec.driverId);
    setSelectedTrailerId(job.assignedTrailerId || rec.trailerId);
    setTokenInput(job.tokenNumber || `DPW-TKN-${Math.floor(1000 + Math.random() * 9000)}`);
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
    setTokenInput(`DPW-BG-${Math.floor(1000 + Math.random() * 9000)}`);
  };

  // Confirm single / bogie assignment modal
  const handleConfirmAssignment = async () => {
    if (!selectedVehicleId || !selectedDriverId || !selectedTrailerId) {
      showToast('error', 'Please select a Prime Mover, Driver, and Chassis');
      return;
    }
    const veh = vehicles.find((v) => v.id === selectedVehicleId);
    const drv = drivers.find((d) => d.id === selectedDriverId);
    const tr = trailers.find((t) => t.id === selectedTrailerId);

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
        if (!res.ok) throw new Error(data.error || 'Failed to execute Street-Turn triangulation');
        showToast(
          'success',
          `⚡ Street-Turn ${data.streetTurnRef} executed! Reallocated ${data.containerNumber} to ${data.exportJobCode}. Saved ${data.deadheadKmSaved}km deadhead (${data.co2SavedKg}kg CO₂)! Saved AED ${data.fuelSavingsAed}!`
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
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to assign Bogie trip');
        showToast(
          'success',
          `⚡ Dual-20FT Bogie dispatch ${data.bogieRef} confirmed! Total Payload: ${(data.totalPayloadKg / 1000).toFixed(1)}T (${data.isWeightCompliant ? 'Road Compliant' : 'Overweight Risk'}).`
        );
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

      scored.sort((a, b) => b.totalScore - a.totalScore);
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

    // 1. First Pass: Street Turn Pairs
    for (const st of streetTurnPairs) {
      if (availV.length === 0 || availD.length === 0 || availT.length === 0) break;
      if (!candidateIdSet.has(st.inboundJob.id) || !candidateIdSet.has(st.outboundJob.id)) continue;
      if (assignedIds.has(st.inboundJob.id) || assignedIds.has(st.outboundJob.id)) continue;

      const termLoc = getTerminalCoordinates(st.terminalName);
      const best = pickBestTractorAndDriver(termLoc);
      if (!best) break;

      const { veh, drv, score: topScored } = best;
      const tr = availT.shift()!;
      const token = `DPW-ST-${Math.floor(1000 + Math.random() * 9000)}`;

      assignedIds.add(st.inboundJob.id);
      assignedIds.add(st.outboundJob.id);

      plan.push({
        id: `DISPATCH-ST-${st.id}`,
        type: 'STREET_TURN',
        jobIds: [st.inboundJob.id, st.outboundJob.id],
        jobCodes: [st.inboundJob.jobCode, st.outboundJob.jobCode],
        containers: [st.inboundJob.containerNumber, st.outboundJob.containerNumber],
        customerNames: [st.inboundJob.customerName, st.outboundJob.customerName],
        routeDescription: `L2 Drop (${st.inboundJob.containerNumber}) ➜ L1 Pick (${st.outboundJob.containerNumber}) @ ${st.terminalName}`,
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
      const token = `DPW-BG-${Math.floor(1000 + Math.random() * 9000)}`;

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

    // 3. Third Pass: Remaining Single Jobs
    const remainingJobs = candidateJobs.filter((j) => !assignedIds.has(j.id));
    for (const job of remainingJobs) {
      if (availV.length === 0 || availD.length === 0 || availT.length === 0) break;

      const termLoc = getTerminalCoordinates(job.terminalId || job.terminalName);
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
      const token = `DPW-TKN-${Math.floor(1000 + Math.random() * 9000)}`;
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
            <button
              onClick={() => setShowSmartAnalysis((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shadow-sm ${
                showSmartAnalysis
                  ? 'bg-blue-600 text-white shadow-blue-500/20'
                  : 'bg-[var(--bg-surface)] border border-blue-500/40 text-blue-400 hover:bg-blue-500/10'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Smart Analysis</span>
              {bogieCombos.length + streetTurnPairs.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-white text-blue-900 font-bold ml-0.5">
                  {bogieCombos.length + streetTurnPairs.length}
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
          label="Available Chassis"
          value={availableTrailers.length}
          icon={Layers}
          accent="cyan"
          sub={`of ${trailers.length} trailers`}
        />
      </div>

      {/* =========================================================================
          SMART ANALYSIS ENGINE PANEL (BOGIE + STREET TURN + DEMURRAGE RESCUE)
          ========================================================================= */}
      {showSmartAnalysis && (
        <div className="rounded-2xl bg-gradient-to-br from-blue-950/30 via-[var(--bg-surface)] to-[var(--bg-surface)] border border-blue-500/30 p-5 space-y-4 shadow-xl">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-blue-500/20 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center shrink-0 border border-blue-500/30">
                <Sparkles className="w-5 h-5 text-blue-300" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-[var(--text-main)] flex items-center gap-2">
                    Smart Drayage Analysis & Optimizer
                  </h3>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                    Dual-20FT & Street Turn Matcher
                  </span>
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  AI corridor pairing eliminates empty gate runs, bundles 2x20FT containers, and prioritizes expiring DOs.
                </p>
              </div>
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1.5 bg-[var(--bg-main)] p-1 rounded-xl border border-[var(--border-subtle)]">
              <button
                onClick={() => setSmartAnalysisFilter('ALL')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                  smartAnalysisFilter === 'ALL'
                    ? 'bg-blue-600 text-white'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                All Matches ({bogieCombos.length + streetTurnPairs.length})
              </button>
              <button
                onClick={() => setSmartAnalysisFilter('BOGIE')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                  smartAnalysisFilter === 'BOGIE'
                    ? 'bg-blue-600 text-white'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                Dual-20FT Bogie ({bogieCombos.length})
              </button>
              <button
                onClick={() => setSmartAnalysisFilter('STREET_TURN')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                  smartAnalysisFilter === 'STREET_TURN'
                    ? 'bg-blue-600 text-white'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                Street Turns ({streetTurnPairs.length})
              </button>
              <button
                onClick={() => setSmartAnalysisFilter('DEMURRAGE')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                  smartAnalysisFilter === 'DEMURRAGE'
                    ? 'bg-rose-600 text-white'
                    : 'text-rose-400 hover:text-rose-300'
                }`}
              >
                Urgent Demurrage ({urgentDemurrageJobs.length})
              </button>
            </div>
          </div>

          {/* Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* 1. Dual-20FT Bogie Combos */}
            {(smartAnalysisFilter === 'ALL' || smartAnalysisFilter === 'BOGIE') &&
              bogieCombos.map((combo) => (
                <div
                  key={combo.id}
                  className="rounded-xl bg-[var(--bg-surface)] border border-blue-500/30 p-4 space-y-3 hover:border-blue-500/60 transition-all flex flex-col justify-between shadow-sm"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center gap-1">
                        <Layers className="w-3 h-3" />
                        Dual-20FT Bogie Combo
                      </span>
                      <span className="text-[10px] font-mono font-bold text-blue-400">
                        Score: {combo.score}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 text-[11px] font-medium text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-2 py-1 rounded-lg">
                      <Clock className="w-3 h-3 shrink-0" />
                      <span>{combo.tasSlot} TAS Slot Match (Single Entry)</span>
                    </div>

                    {/* Weight & Road Legal Safety Gauge */}
                    <div className="p-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] space-y-1.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-[var(--text-muted)] flex items-center gap-1">
                          <Scale className="w-3 h-3 text-indigo-400" />
                          <span>Combined Payload:</span>
                        </span>
                        <span className={`font-mono font-bold ${combo.isWeightCompliant ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {(combo.totalPayloadKg / 1000).toFixed(1)}T / {(combo.weightLimitKg / 1000).toFixed(1)}T
                        </span>
                      </div>
                      <div className="w-full bg-neutral-800 h-1.5 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            combo.isWeightCompliant ? 'bg-emerald-500' : 'bg-rose-500'
                          }`}
                          style={{ width: `${Math.min(100, combo.weightUtilizationPct)}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[10px]">
                        <span className={`font-semibold ${combo.isWeightCompliant ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {combo.isWeightCompliant ? '✓ UAE RTA 36T Road Legal' : '⚠️ Overweight Road Violation'}
                        </span>
                        <span className="text-[var(--text-muted)]">{combo.weightUtilizationPct}% GCW</span>
                      </div>
                    </div>

                    {/* Chassis Requirement Pill */}
                    <div className="px-2 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20 text-[10px] text-blue-300 flex items-center gap-1.5">
                      <Truck className="w-3 h-3 text-blue-400 shrink-0" />
                      <span>Requires: 40FT/45FT Skeletal or Bogie Chassis</span>
                    </div>

                    {/* Drops Sequence */}
                    <div className="space-y-1.5 pt-1 text-xs">
                      <div className="p-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] space-y-1">
                        <div className="flex items-center justify-between font-mono font-bold text-[var(--text-main)]">
                          <span>1. {combo.job1.containerNumber} (20FT)</span>
                          <span className="text-[10px] text-emerald-400 font-normal">{(combo.box1WeightKg / 1000).toFixed(1)}T</span>
                        </div>
                        <div className="text-[11px] text-[var(--text-muted)] truncate">
                          {combo.job1.customerName} → {combo.job1.warehouseName} ({combo.zone1})
                        </div>
                      </div>

                      <div className="p-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] space-y-1">
                        <div className="flex items-center justify-between font-mono font-bold text-[var(--text-main)]">
                          <span>2. {combo.job2.containerNumber} (20FT)</span>
                          <span className="text-[10px] text-emerald-400 font-normal">{(combo.box2WeightKg / 1000).toFixed(1)}T</span>
                        </div>
                        <div className="text-[11px] text-[var(--text-muted)] truncate">
                          {combo.job2.customerName} → {combo.job2.warehouseName} ({combo.zone2})
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-[var(--border-subtle)] space-y-2.5">
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div>
                        <span className="text-[var(--text-muted)] block text-[10px]">Combined Revenue</span>
                        <span className="font-bold text-emerald-400">AED {combo.combinedRevenueAed.toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-[var(--text-muted)] block text-[10px]">Driver Allowance</span>
                        <span className="font-bold text-[var(--text-main)]">AED {combo.combinedAllowanceAed.toLocaleString()}</span>
                      </div>
                    </div>

                    <div className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" />
                      <span>+40% Fuel & Carbon Savings vs Single 20FT Runs</span>
                    </div>

                    <button
                      onClick={() => handleUseBogiePair(combo)}
                      className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-500 transition-colors shadow-sm"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      ⚡ Dispatch Dual-20FT Bogie Pair
                    </button>
                  </div>
                </div>
              ))}

            {/* 2. Zone-Based Street Turn Triangulation Matches */}
            {(smartAnalysisFilter === 'ALL' || smartAnalysisFilter === 'STREET_TURN') &&
              streetTurnPairs.map((pair) => (
                <div
                  key={pair.id}
                  className="rounded-xl bg-[var(--bg-surface)] border border-emerald-500/30 p-4 space-y-3 hover:border-emerald-500/60 transition-all flex flex-col justify-between shadow-sm"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                        <TrendingUp className="w-3 h-3" />
                        Inland Street-Turn Triangulation
                      </span>
                      <span className="text-[10px] font-mono font-bold text-emerald-400">
                        Score: {pair.score}
                      </span>
                    </div>

                    {/* Carrier Line Match Badge */}
                    <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded-lg text-[11px]">
                      <span className="text-emerald-400 font-bold flex items-center gap-1">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                        {pair.shippingLine} Line Verified ({pair.carrierPrefix})
                      </span>
                      <span className="font-mono text-[10px] text-[var(--text-muted)]">
                        {pair.containerSize} {pair.containerType || 'DRY'}
                      </span>
                    </div>

                    <div className="space-y-1.5 pt-1 text-xs">
                      {/* L2 Inbound Empty Box */}
                      <div className="p-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-bold text-amber-400">1. Inbound Empty (L2 Warehouse)</span>
                          <span className="font-mono font-bold text-[var(--text-main)]">{pair.inboundJob.containerNumber}</span>
                        </div>
                        <div className="text-[11px] text-[var(--text-muted)] truncate">
                          {pair.originWarehouse} ({pair.zone})
                        </div>
                      </div>

                      {/* Direct Inland Repositioning */}
                      <div className="px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-300 flex items-center justify-between">
                        <span className="flex items-center gap-1">
                          <ArrowRight className="w-3 h-3 text-emerald-400" />
                          <span>Direct Inland Interchange ({pair.interWarehouseDistanceKm} km)</span>
                        </span>
                        <span className="font-bold text-emerald-400">No Port Return</span>
                      </div>

                      {/* Outbound Export Booking */}
                      <div className="p-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-bold text-blue-400">2. Outbound Export Loading</span>
                          <span className="font-mono font-bold text-[var(--text-main)]">{pair.exportJob.jobCode}</span>
                        </div>
                        <div className="text-[11px] text-[var(--text-muted)] truncate">
                          {pair.destWarehouse} ➔ {pair.terminalName}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Economic & Environmental Savings Metrics */}
                  <div className="pt-2 border-t border-[var(--border-subtle)] space-y-2.5">
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="p-1.5 rounded bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                        <span className="text-[var(--text-muted)] block text-[9px]">Deadhead Saved</span>
                        <span className="font-bold text-blue-400 flex items-center gap-1">
                          <span>{pair.deadheadKmSaved} km zero-bobtail</span>
                        </span>
                      </div>
                      <div className="p-1.5 rounded bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                        <span className="text-[var(--text-muted)] block text-[9px]">Carbon Avoided</span>
                        <span className="font-bold text-emerald-400 flex items-center gap-1">
                          <Leaf className="w-3 h-3 text-emerald-400 shrink-0" />
                          <span>{pair.co2SavedKg} kg CO₂</span>
                        </span>
                      </div>
                      <div className="p-1.5 rounded bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                        <span className="text-[var(--text-muted)] block text-[9px]">Direct Cost Saved</span>
                        <span className="font-bold text-emerald-400">AED {pair.fuelSavingsAed.toLocaleString()}</span>
                      </div>
                      <div className="p-1.5 rounded bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                        <span className="text-[var(--text-muted)] block text-[9px]">Turnaround Saved</span>
                        <span className="font-bold text-cyan-400">{pair.turnaroundHoursSaved} hrs gate dwell</span>
                      </div>
                    </div>

                    <button
                      onClick={() => handleUseStreetTurnPair(pair)}
                      className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 transition-colors shadow-sm"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      ⚡ Execute Street-Turn Triangulation
                    </button>
                  </div>
                </div>
              ))}

            {/* 3. Urgent Demurrage Risk View */}
            {smartAnalysisFilter === 'DEMURRAGE' &&
              urgentDemurrageJobs.map((job) => {
                const risk = getDemurrageRisk(job);
                return (
                  <div
                    key={job.id}
                    className="rounded-xl bg-[var(--bg-surface)] border border-rose-500/40 p-4 space-y-3 flex flex-col justify-between shadow-sm"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                          {risk.badgeText}
                        </span>
                        <span className="font-mono text-xs font-bold text-rose-400">{job.jobCode}</span>
                      </div>

                      <div className="text-xs space-y-1">
                        <div className="font-bold font-mono text-[var(--text-main)] text-sm">
                          {job.containerNumber} ({job.containerSize})
                        </div>
                        <div className="text-[var(--text-muted)]">
                          {job.customerName} · {job.terminalName} ➔ {job.warehouseName}
                        </div>
                        <div className="text-[11px] text-amber-300 font-semibold">
                          Estimated Penalty Risk: AED 450/day if delayed
                        </div>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-[var(--border-subtle)]">
                      <button
                        onClick={() => handleOpenAssign(job)}
                        className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-500 transition-colors shadow-sm"
                      >
                        <AlertCircle className="w-3.5 h-3.5" />
                        Prioritize & Assign Now
                      </button>
                    </div>
                  </div>
                );
              })}

            {/* Empty state when no matches found */}
            {bogieCombos.length === 0 && streetTurnPairs.length === 0 && (
              <div className="col-span-full py-8 text-center text-[var(--text-muted)] space-y-1">
                <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto opacity-70" />
                <h4 className="text-xs font-bold text-[var(--text-main)]">Queue Optimized</h4>
                <p className="text-xs text-[var(--text-muted)]">No pending pairing conflicts found in current queue.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* FleetDataGrid (Smart Data Table) */}
      <FleetDataGrid<DrayageJob>
        rows={jobs}
        columns={assignmentColumns}
        getRowId={(j) => j.id}
        loading={loading}
        emptyMessage="No drayage jobs in queue"
        gridName="DrayageAssignmentGrid"
        numbered={true}
        selectable={true}
        selectedIds={new Set(selectedJobIds)}
        onSelectionChange={(ids) => setSelectedJobIds(Array.from(ids))}
        toolbar={{
          title: 'Drayage Jobs Queue',
          search: true,
          columns: true,
          density: true,
          filters: true,
          exportCsv: true,
          exportName: 'drayage_job_assignment',
          actions: (
            <div className="flex items-center gap-2">
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
                              : item.type === 'STREET_TURN'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                          }`}
                        >
                          {item.type === 'BOGIE'
                            ? 'Dual-20FT Bogie'
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
                    ? '⚡ Confirm Inland Street-Turn Triangulation'
                    : isBogieAssign
                    ? '⚡ Dual-20FT Bogie Dispatch (Single Prime Mover)'
                    : `Assign Assets: ${assigningJob.jobCode}`}
                </h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  {activeStreetTurnPair
                    ? `Direct interchange: Reallocating empty container ${activeStreetTurnPair.containerNumber} from ${activeStreetTurnPair.originWarehouse} to ${activeStreetTurnPair.exportJob.jobCode}`
                    : isBogieAssign
                    ? `Coupling two 20FT containers onto a 40FT/45FT skeletal/bogie trailer`
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
              {/* Special Triangulation Street-Turn Banner */}
              {activeStreetTurnPair && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-bold text-emerald-400 flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      Triangulation Match: {activeStreetTurnPair.shippingLine} Line Verified
                    </span>
                    <span className="font-mono text-[10px] text-emerald-300 bg-emerald-500/20 px-2 py-0.5 rounded">
                      {activeStreetTurnPair.containerSize} {activeStreetTurnPair.containerType}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                    <div className="p-1.5 rounded bg-[var(--bg-main)] border border-emerald-500/20">
                      <span className="text-[var(--text-muted)] block text-[9px]">Deadhead Saved</span>
                      <span className="font-bold text-blue-400">{activeStreetTurnPair.deadheadKmSaved} km zero-bobtail</span>
                    </div>
                    <div className="p-1.5 rounded bg-[var(--bg-main)] border border-emerald-500/20">
                      <span className="text-[var(--text-muted)] block text-[9px]">CO₂ Avoided</span>
                      <span className="font-bold text-emerald-400">{activeStreetTurnPair.co2SavedKg} kg</span>
                    </div>
                    <div className="p-1.5 rounded bg-[var(--bg-main)] border border-emerald-500/20">
                      <span className="text-[var(--text-muted)] block text-[9px]">Cost Saved</span>
                      <span className="font-bold text-emerald-400">AED {activeStreetTurnPair.fuelSavingsAed}</span>
                    </div>
                    <div className="p-1.5 rounded bg-[var(--bg-main)] border border-emerald-500/20">
                      <span className="text-[var(--text-muted)] block text-[9px]">Port Turnaround</span>
                      <span className="font-bold text-cyan-400">{activeStreetTurnPair.turnaroundHoursSaved}h dwell avoided</span>
                    </div>
                  </div>
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
                    const veh = primeMovers.find((v) => v.id === val);
                    if (veh?.assignedDriverId) {
                      const drv = drivers.find((d) => d.id === veh.assignedDriverId);
                      if (drv && drv.complianceOk) {
                        setSelectedDriverId(drv.id);
                      }
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
                          <span>Proximity (60%)</span>
                        </div>
                        <div className="font-bold text-xs text-[var(--text-main)]">
                          {currentVehicleScore.distanceKm} km
                        </div>
                        <div className="text-[9px] text-emerald-400">Score: {currentVehicleScore.proximityScore}/100</div>
                      </div>

                      <div className="p-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-0.5">
                        <div className="text-[var(--text-muted)] flex items-center gap-1">
                          <Clock className="w-3 h-3 text-cyan-400 shrink-0" />
                          <span>Idleness (25%)</span>
                        </div>
                        <div className="font-bold text-xs text-[var(--text-main)]">
                          {currentVehicleScore.idleHours}h dwell
                        </div>
                        <div className="text-[9px] text-cyan-400">Score: {currentVehicleScore.idlenessScore}/100</div>
                      </div>

                      <div className="p-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-0.5">
                        <div className="text-[var(--text-muted)] flex items-center gap-1">
                          <TrendingUp className="w-3 h-3 text-indigo-400 shrink-0" />
                          <span>Workload (10%)</span>
                        </div>
                        <div className="font-bold text-xs text-[var(--text-main)]">
                          {currentVehicleScore.tripsToday} trip(s) today
                        </div>
                        <div className="text-[9px] text-indigo-400">Score: {currentVehicleScore.workloadScore}/100</div>
                      </div>

                      <div className="p-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-0.5">
                        <div className="text-[var(--text-muted)] flex items-center gap-1">
                          <ShieldCheck className="w-3 h-3 text-purple-400 shrink-0" />
                          <span>Availability (5%)</span>
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
                  onChange={(val) => setSelectedDriverId(val)}
                  options={drivers.map((d) => ({
                    value: d.id,
                    label: d.fullName,
                    sublabel: `Trips Today: ${d.completedTripsToday ?? 0} • ${d.phone ? `Phone: ${d.phone} • ` : ''}Status: ${d.status}`,
                    badge: (d.completedTripsToday ?? 0) === 0 ? 'Fresh Driver' : `${d.completedTripsToday} Trips`,
                  }))}
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
                  value={selectedTrailerId}
                  onChange={(val) => setSelectedTrailerId(val)}
                  options={trailers.map((t) => ({
                    value: t.id,
                    label: `${t.plateNumber} · ${t.trailerType}`,
                    sublabel: `Capacity: ${t.capacityTons}T • Loc: ${t.currentLocation || 'Depot'} • Master: ${t.masterStatus}`,
                    badge: t.operationalStatus,
                  }))}
                  placeholder="-- Search & Choose Chassis --"
                  searchPlaceholder="Type chassis plate, skeletal, flatbed..."
                  accent="emerald"
                  isClearable
                />
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
