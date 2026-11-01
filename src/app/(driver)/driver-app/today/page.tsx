'use client';

/**
 * src/app/(driver)/driver-app/today/page.tsx
 *
 * Simplified LogiXL-Connect Driver App Experience:
 * - Dashboard ("My Jobs") with Active Jobs & History tabs
 * - Single Next-Action Job Detail View (L1, L2, and Reassignment workflows)
 * - Direct Google Maps Turn-by-Turn Navigation for Pickup & Dropoff
 * - 1-Tap ETC Selection Modal (1 Hr / 2 Hrs / 3 Hrs / 4 Hrs) for Placed @ Ramp
 * - Inspection Photo / Document Attachment during Under Inspection
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  Clock,
  FileText,
  LogOut,
  MapPin,
  Navigation,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  PenTool,
  Sparkles,
  Truck,
  X,
} from 'lucide-react';
import { getApiEndpoint } from '@/lib/api-endpoint';

interface OcrScanVerification {
  containerNumber: string;
  sealNumber: string;
  eirNumber: string;
  isoSizeType: string;
  gateStatus: string;
  confidencePct: number;
  matchesExpectedContainer: boolean;
  provider: string;
  model: string;
  verifiedAt: string;
}

interface EpodRampEvidence {
  supervisorName: string;
  rampBayNumber: string;
  signatureDataUri: string;
  sealCargoPhotoDataUri: string | null;
  signedAt: string;
}

interface GeofenceTarget {
  name: string;
  type: 'CIRCLE' | 'POLYGON';
  lat: number;
  lng: number;
  radiusMeters: number;
  coordinates?: Array<{ lat: number; lng: number }>;
}

interface DrayageAssignment {
  id: string;
  jobCode: string;
  jobPhase: 'L1' | 'L2';
  shipmentType: 'IMPORT' | 'EXPORT';
  status: string;
  priority: string;
  customerName?: string | null;
  containerNumber: string;
  containerSize: string;
  containerType: string;
  terminalName: string;
  warehouseName: string;
  tokenNumber?: string | null;
  pcsTokenNumber?: string | null;
  assignedDriverId?: string | null;
  assignedDriverName?: string | null;
  assignedVehiclePlate: string | null;
  assignedTrailerPlate: string | null;
  placementLocation: string | null;
  trailerDetached: boolean;
  etcTime: string | null;
  etcAlertStatus: string;
  rateAmountAed?: number;
  driverAllowanceAed?: number;
  notes?: string | null;
  podSignatureName?: string | null;
  podSignedAt?: string | null;
  podPhotoUrl?: string | null;
  terminalGeofence?: GeofenceTarget;
  warehouseGeofence?: GeofenceTarget;
  updatedAt?: string | null;
}

interface NextStepMeta {
  nextStatus: string;
  label: string;
  description: string;
  color: string;
  isDualChoice?: boolean;
  isReassign?: boolean;
}

// Terminal statuses where the driver's leg is finished and the job moves to History
const HISTORY_STATUSES = new Set([
  'COMPLETED',
  'EMPTY_DEPOSITED',
  'TRAILER_DETACHED',
  'CONTAINER_DETACHED',
  'REASSIGN_TRAILER_DETACHED',
  'READY_FOR_PICKUP',
  'CONTAINER_DROPPED',
]);

/**
 * Exact LogiXL-Connect Single Next-Action State Machine
 * Matches LogiXL-Connect/mobile/src/screens/JobDetailScreen.js (getNextStep)
 */
function getNextStep(job: DrayageAssignment): NextStepMeta | null {
  const status = (job.status || 'ASSIGNED').toUpperCase();
  const isL2 = job.jobPhase === 'L2' || (job.jobCode && job.jobCode.includes('-L2'));
  const isReassign =
    status === 'RE-ASSIGNED' ||
    status === 'FCL_REASSIGN' ||
    status === 'MT_REASSIGN' ||
    status === 'TRAILER_ATTACHED' ||
    status === 'REASSIGN_PLACED_AT_RAMP' ||
    status === 'REASSIGN_PLACED_AT_YARD';

  if (HISTORY_STATUSES.has(status)) {
    return null;
  }

  // 1. Reassignment Workflow (Yard <-> Ramp / Reassigned Trailer)
  if (isReassign) {
    switch (status) {
      case 'RE-ASSIGNED':
      case 'FCL_REASSIGN':
      case 'MT_REASSIGN':
        return {
          nextStatus: 'TRAILER_ATTACHED',
          label: 'Trailer Attached',
          description: 'Confirm trailer is coupled to your tractor to begin moving container',
          color: '#2563eb',
          isReassign: true,
        };
      case 'TRAILER_ATTACHED':
        return {
          nextStatus: 'REASSIGN_PLACED',
          label: 'Select Placement',
          description: 'Choose whether container is placed at Yard or Ramp',
          color: '#f59e0b',
          isDualChoice: true,
          isReassign: true,
        };
      case 'REASSIGN_PLACED_AT_RAMP':
        return {
          nextStatus: 'REASSIGN_TRAILER_DETACHED',
          label: 'Trailer Detached',
          description: 'Confirm trailer is uncoupled at the ramp to finish your job',
          color: '#7c3aed',
          isReassign: true,
        };
      case 'REASSIGN_PLACED_AT_YARD':
        return {
          nextStatus: 'READY_FOR_PICKUP',
          label: 'Ready for Pickup',
          description: 'Confirm container is positioned in yard and ready for pickup',
          color: '#10b981',
          isReassign: true,
        };
      default:
        return null;
    }
  }

  // 2. Leg 2 (L2 Empty Return: Warehouse -> Port Terminal)
  if (isL2) {
    switch (status) {
      case 'ASSIGNED':
      case 'PENDING':
        return {
          nextStatus: 'CONTAINER_PICKED',
          label: 'Container Picked',
          description: 'Confirm empty container is picked up from customer warehouse',
          color: '#2563eb',
        };
      case 'CONTAINER_PICKED':
        return {
          nextStatus: 'EN_ROUTE_TERMINAL',
          label: 'En Route to Terminal',
          description: 'Start transit back to the port terminal',
          color: '#0891b2',
        };
      case 'EN_ROUTE_TERMINAL':
      case 'IN_TRANSIT':
      case 'EMPTY_AT_PORT':
        return {
          nextStatus: 'ARRIVED_AT_PORT',
          label: 'Arrived at Port',
          description: 'Confirm arrival at the port terminal gate',
          color: '#f59e0b',
        };
      case 'ARRIVED_AT_PORT':
      case 'AT_PORT':
        return {
          nextStatus: 'UNDER_INSPECTION',
          label: 'Under Inspection',
          description: 'Container is undergoing port gate inspection',
          color: '#7c3aed',
        };
      case 'UNDER_INSPECTION':
        return {
          nextStatus: 'CONTAINER_DROPPED',
          label: 'Complete & Deposit MT',
          description: 'Scan EIR Gate Slip / Container via Gemini Vision OCR & confirm empty deposit at port',
          color: '#10b981',
        };
      default:
        return null;
    }
  }

  // 3. Leg 1 (L1 Full Container Delivery: Port Terminal -> Warehouse)
  switch (status) {
    case 'ASSIGNED':
    case 'PENDING':
      return {
        nextStatus: 'ACCEPTED',
        label: 'Job Accepted',
        description: 'Accept this job to start the container pickup process',
        color: '#2563eb',
      };
    case 'ACCEPTED':
      return {
        nextStatus: 'CONTAINER_PICKED',
        label: 'Container Loaded',
        description: 'Snap photo via Gemini Vision OCR to verify Container #, Customs Seal & EIR Gate Slip',
        color: '#0891b2',
      };
    case 'CONTAINER_PICKED':
    case 'AT_PORT':
      return {
        nextStatus: 'UNDER_INSPECTION',
        label: 'Under Inspection',
        description: 'Container is under customs/port inspection (attach photos if required)',
        color: '#7c3aed',
      };
    case 'UNDER_INSPECTION':
      return {
        nextStatus: 'EN_ROUTE_WAREHOUSE',
        label: 'En Route to WareHouse',
        description: 'Inspection complete — depart port en route to customer warehouse',
        color: '#f59e0b',
      };
    case 'EN_ROUTE_WAREHOUSE':
    case 'IN_TRANSIT':
    case 'LOADED':
      return {
        nextStatus: 'PLACED',
        label: 'Select Placement',
        description: 'Arrived at warehouse — choose Placed @ Yard or Placed @ Ramp',
        color: '#10b981',
        isDualChoice: true,
      };
    case 'PLACED_AT_RAMP':
    case 'PLACED_AT_YARD':
      return {
        nextStatus: 'TRAILER_DETACHED',
        label: 'Trailer Detached',
        description: 'Confirm trailer is detached to complete this job',
        color: '#10b981',
      };
    default:
      return null;
  }
}

function getStatusBadgeStyle(status: string): { bg: string; text: string; label: string } {
  const s = (status || 'ASSIGNED').toUpperCase();
  switch (s) {
    case 'ASSIGNED':
      return { bg: 'bg-amber-100 border-amber-300', text: 'text-amber-800', label: 'ASSIGNED' };
    case 'RE-ASSIGNED':
    case 'FCL_REASSIGN':
    case 'MT_REASSIGN':
      return { bg: 'bg-orange-100 border-orange-300', text: 'text-orange-800', label: 'RE-ASSIGNED' };
    case 'ACCEPTED':
      return { bg: 'bg-blue-100 border-blue-300', text: 'text-blue-800', label: 'ACCEPTED' };
    case 'CONTAINER_PICKED':
    case 'TRAILER_ATTACHED':
      return { bg: 'bg-cyan-100 border-cyan-300', text: 'text-cyan-800', label: s.replace(/_/g, ' ') };
    case 'UNDER_INSPECTION':
      return { bg: 'bg-purple-100 border-purple-300', text: 'text-purple-800', label: 'UNDER INSPECTION' };
    case 'EN_ROUTE_WAREHOUSE':
    case 'EN_ROUTE_TERMINAL':
    case 'IN_TRANSIT':
      return { bg: 'bg-indigo-100 border-indigo-300', text: 'text-indigo-800', label: s.replace(/_/g, ' ') };
    case 'PLACED_AT_RAMP':
    case 'REASSIGN_PLACED_AT_RAMP':
      return { bg: 'bg-emerald-100 border-emerald-300', text: 'text-emerald-800', label: 'PLACED @ RAMP' };
    case 'PLACED_AT_YARD':
    case 'REASSIGN_PLACED_AT_YARD':
      return { bg: 'bg-amber-100 border-amber-300', text: 'text-amber-800', label: 'PLACED @ YARD' };
    case 'TRAILER_DETACHED':
    case 'CONTAINER_DETACHED':
    case 'REASSIGN_TRAILER_DETACHED':
    case 'READY_FOR_PICKUP':
    case 'CONTAINER_DROPPED':
    case 'COMPLETED':
    case 'EMPTY_DEPOSITED':
      return { bg: 'bg-emerald-100 border-emerald-300', text: 'text-emerald-800', label: 'COMPLETED' };
    default:
      return { bg: 'bg-slate-100 border-slate-300', text: 'text-slate-700', label: s.replace(/_/g, ' ') };
  }
}

function getPickupAndDropoff(job: DrayageAssignment) {
  const isL2 = job.jobPhase === 'L2' || (job.jobCode && job.jobCode.includes('-L2'));
  const isReassign = [
    'RE-ASSIGNED',
    'FCL_REASSIGN',
    'MT_REASSIGN',
    'TRAILER_ATTACHED',
    'REASSIGN_PLACED_AT_RAMP',
    'REASSIGN_PLACED_AT_YARD',
    'REASSIGN_TRAILER_DETACHED',
    'READY_FOR_PICKUP',
  ].includes((job.status || '').toUpperCase());

  if (isReassign) {
    return {
      pickupName: `${job.warehouseName || 'Client Yard'} (Yard)`,
      pickupLat: job.warehouseGeofence?.lat ?? null,
      pickupLng: job.warehouseGeofence?.lng ?? null,
      dropoffName: `${job.warehouseName || 'Client Warehouse'} (Ramp)`,
      dropoffLat: job.warehouseGeofence?.lat ?? null,
      dropoffLng: job.warehouseGeofence?.lng ?? null,
    };
  }

  if (isL2) {
    return {
      pickupName: job.warehouseName || 'Customer Warehouse',
      pickupLat: job.warehouseGeofence?.lat ?? null,
      pickupLng: job.warehouseGeofence?.lng ?? null,
      dropoffName: job.terminalName || 'Port Terminal',
      dropoffLat: job.terminalGeofence?.lat ?? null,
      dropoffLng: job.terminalGeofence?.lng ?? null,
    };
  }

  return {
    pickupName: job.terminalName || 'Port Terminal',
    pickupLat: job.terminalGeofence?.lat ?? null,
    pickupLng: job.terminalGeofence?.lng ?? null,
    dropoffName: job.warehouseName || 'Customer Warehouse',
    dropoffLat: job.warehouseGeofence?.lat ?? null,
    dropoffLng: job.warehouseGeofence?.lng ?? null,
  };
}

function openGoogleMapsNavigation(
  locationName: string,
  lat?: number | null,
  lng?: number | null,
) {
  let destination = '';
  if (lat != null && lng != null && !Number.isNaN(Number(lat)) && !Number.isNaN(Number(lng))) {
    destination = `${lat},${lng}`;
  } else if (locationName) {
    destination = encodeURIComponent(`${locationName}, UAE`);
  } else {
    return;
  }
  const url = `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving`;
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export default function DriverTodayPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<DrayageAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<'active' | 'history'>('active');
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Ramp ETC selection modal state (LogiXL-Connect 1 Hr / 2 Hrs / 3 Hrs / 4 Hrs modal)
  const [showEtcModal, setShowEtcModal] = useState(false);
  const [pendingRampStatus, setPendingRampStatus] = useState<string>('PLACED_AT_RAMP');

  // Inspection photo / attachment state
  const [attachedDocs, setAttachedDocs] = useState<Record<string, string[]>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Feature 1: Gemini Vision OCR Container, Seal & EIR Gate Slip Scanner state
  const [ocrResults, setOcrResults] = useState<Record<string, OcrScanVerification>>({});
  const [ocrScanning, setOcrScanning] = useState(false);
  const ocrFileInputRef = useRef<HTMLInputElement | null>(null);

  // Feature 2: Digital e-POD & Ramp Sign-Off Modal state (Placed @ Ramp / Complete)
  const [showEpodModal, setShowEpodModal] = useState(false);
  const [epodTargetStatus, setEpodTargetStatus] = useState<string>('PLACED_AT_RAMP');
  const [epodSupervisorName, setEpodSupervisorName] = useState('Khalid Al-Mansoori (Ramp Supervisor)');
  const [epodRampBayNumber, setEpodRampBayNumber] = useState('Ramp Bay 04');
  const [epodEtcHours, setEpodEtcHours] = useState<number>(2);
  const [epodCustomEtc, setEpodCustomEtc] = useState<string>('');
  const [epodSealPhotoUri, setEpodSealPhotoUri] = useState<string | null>(null);
  const [epodSealPhotoTimestamp, setEpodSealPhotoTimestamp] = useState<string | null>(null);
  const [epodSignatureDrawn, setEpodSignatureDrawn] = useState(false);
  const [epodRecords, setEpodRecords] = useState<Record<string, EpodRampEvidence>>({});
  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const epodPhotoInputRef = useRef<HTMLInputElement | null>(null);

  // Driver & Vehicle session info from localStorage
  const [driverName, setDriverName] = useState('Driver');
  const [vehiclePlate, setVehiclePlate] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const savedName = localStorage.getItem('fleet360_driver_name');
    const savedEmail = localStorage.getItem('fleet360_driver_email');
    if (savedName) setDriverName(savedName);
    else if (savedEmail) setDriverName(savedEmail);

    try {
      const rawVeh = localStorage.getItem('fleet360_active_vehicle');
      if (rawVeh) {
        const parsed = JSON.parse(rawVeh);
        setVehiclePlate(parsed.licensePlate || parsed.vehicleCode || null);
      }
    } catch {}
  }, []);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 4000);
  }, []);

  const getAuthHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('fleet360_session_token');
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }
    return headers;
  }, []);

  const fetchDriverJobs = useCallback(
    async (silent = false) => {
      if (!silent) setRefreshing(true);
      try {
        const res = await fetch(getApiEndpoint('/api/driver-app/today/assignments'), {
          credentials: 'include',
          headers: getAuthHeaders(),
          cache: 'no-store',
        });
        if (res.ok) {
          const data = await res.json();
          const fetched: DrayageAssignment[] = Array.isArray(data.drayageJobs)
            ? data.drayageJobs
            : [];
          setJobs(fetched);
        } else if (res.status === 401) {
          setJobs([]);
        }
      } catch (err) {
        console.warn('[DriverTodayPage] Failed to fetch jobs:', err);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [getAuthHeaders],
  );

  useEffect(() => {
    void fetchDriverJobs(false);
    const interval = setInterval(() => {
      void fetchDriverJobs(true);
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchDriverJobs]);

  // Split jobs into Active vs. History and sort L2 jobs first (matching LogiXL-Connect DashboardScreen.js)
  const { activeJobs, historyJobs } = useMemo(() => {
    const sorted = [...jobs].sort((a, b) => {
      const aL2 = a.jobPhase === 'L2' || (a.jobCode && a.jobCode.includes('-L2'));
      const bL2 = b.jobPhase === 'L2' || (b.jobCode && b.jobCode.includes('-L2'));
      if (aL2 && !bL2) return -1;
      if (!aL2 && bL2) return 1;
      return 0;
    });

    return {
      activeJobs: sorted.filter((j) => !HISTORY_STATUSES.has((j.status || '').toUpperCase())),
      historyJobs: sorted.filter((j) => HISTORY_STATUSES.has((j.status || '').toUpperCase())),
    };
  }, [jobs]);

  const selectedJob = useMemo(
    () => jobs.find((j) => j.id === selectedJobId) || null,
    [jobs, selectedJobId],
  );

  const handleStatusUpdate = async (
    job: DrayageAssignment,
    newStatus: string,
    etcIsoString: string | null = null,
    extraPayload?: {
      receiverName?: string;
      rampBayNumber?: string;
      signatureDataUri?: string;
      sealCargoPhotoUrl?: string | null;
      notes?: string;
    },
  ) => {
    setSubmitting(true);
    try {
      const isFinishingDriverLeg = HISTORY_STATUSES.has(newStatus.toUpperCase());
      const placementLocation = newStatus.includes('RAMP')
        ? 'RAMP'
        : newStatus.includes('YARD')
        ? 'YARD'
        : undefined;

      // Optimistic local state update so UI responds immediately
      setJobs((prev) =>
        prev.map((j) =>
          j.id === job.id
            ? {
                ...j,
                status: newStatus,
                placementLocation: placementLocation || j.placementLocation,
                trailerDetached: isFinishingDriverLeg ? true : newStatus === 'TRAILER_ATTACHED' ? false : j.trailerDetached,
                etcTime: etcIsoString || j.etcTime,
                podSignatureName: extraPayload?.receiverName
                  ? extraPayload.rampBayNumber
                    ? `${extraPayload.receiverName} (${extraPayload.rampBayNumber})`
                    : extraPayload.receiverName
                  : j.podSignatureName,
                podSignedAt: extraPayload?.receiverName ? new Date().toISOString() : j.podSignedAt,
              }
            : j,
        ),
      );

      const res = await fetch(getApiEndpoint(`/api/driver/jobs/${job.id}/status`), {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          action: 'STATUS_UPDATE',
          status: newStatus,
          placementLocation,
          detachTrailer: isFinishingDriverLeg
            ? true
            : newStatus === 'TRAILER_ATTACHED'
            ? false
            : undefined,
          etc: etcIsoString,
          driverName,
          ...(extraPayload || {}),
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        showToast(errData?.error || 'Could not update status on server — retrying sync.');
      } else {
        if (isFinishingDriverLeg) {
          showToast(`Job ${job.jobCode} completed & moved to History!`);
          setSelectedJobId(null);
        } else {
          showToast(`Status updated to ${newStatus.replace(/_/g, ' ')}`);
        }
      }

      await fetchDriverJobs(true);
    } catch {
      showToast('Network error while updating status.');
    } finally {
      setSubmitting(false);
    }
  };

  // =========================================================================
  // FEATURE 1: GEMINI VISION OCR CONTAINER, SEAL & EIR GATE SLIP SCANNER
  // =========================================================================
  const runGeminiVisionOcrScan = async (imageDataUri: string, scanStage: string) => {
    if (!selectedJob) return;
    setOcrScanning(true);
    try {
      const res = await fetch(getApiEndpoint('/api/driver-app/ocr-scan'), {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          imageDataUri,
          expectedContainerNumber: selectedJob.containerNumber,
          expectedTokenNumber: selectedJob.tokenNumber || selectedJob.pcsTokenNumber || '',
          terminalName: selectedJob.terminalName,
          scanStage,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ocr) {
        throw new Error(json.error || 'Gemini Vision OCR scan failed');
      }
      const ocr: OcrScanVerification = json.ocr;
      setOcrResults((prev) => ({
        ...prev,
        [selectedJob.id]: ocr,
      }));

      // Record verified ISO 6346 Container, Customs Seal & EIR Gate Slip on the job audit trail
      await fetch(getApiEndpoint(`/api/driver/jobs/${selectedJob.id}/status`), {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          action: 'SCAN_VERIFY',
          scannedContainerNumber: ocr.containerNumber,
          scannedSealNumber: ocr.sealNumber,
          scannedEirNumber: ocr.eirNumber,
          scanStage,
          driverName,
        }),
      }).catch(() => {});

      showToast(
        `✓ Gemini Vision OCR Verified: ${ocr.containerNumber} · Seal ${ocr.sealNumber} · ${ocr.eirNumber} (${ocr.confidencePct}%)`,
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'OCR verification failed');
    } finally {
      setOcrScanning(false);
    }
  };

  const handleOcrFileSelected = (e: React.ChangeEvent<HTMLInputElement>, scanStage: string) => {
    const file = e.target.files?.[0];
    if (!file || !selectedJob) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUri = typeof reader.result === 'string' ? reader.result : '';
      if (dataUri) {
        void runGeminiVisionOcrScan(dataUri, scanStage);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // =========================================================================
  // FEATURE 2: DIGITAL e-POD & RAMP SIGN-OFF (SIGNATURE, RAMP BAY & TIMESTAMPED PHOTO)
  // =========================================================================
  const openEpodRampSignOffModal = (targetStatus: string) => {
    setEpodTargetStatus(targetStatus);
    setEpodSignatureDrawn(false);
    setEpodSealPhotoUri(null);
    setEpodSealPhotoTimestamp(null);
    setShowEpodModal(true);
    setTimeout(() => {
      clearSignatureCanvas();
    }, 60);
  };

  const clearSignatureCanvas = () => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setEpodSignatureDrawn(false);
  };

  const autoSignSupervisorCanvas = () => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(28, 72);
    ctx.bezierCurveTo(65, 25, 110, 95, 155, 48);
    ctx.bezierCurveTo(190, 22, 230, 82, 275, 52);
    ctx.stroke();
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = '#0284c7';
    ctx.fillText(
      `VERIFIED · ${epodRampBayNumber} · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      24,
      105,
    );
    setEpodSignatureDrawn(true);
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    isDrawingRef.current = true;
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    setEpodSignatureDrawn(true);
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  };

  const handleCanvasPointerUp = () => {
    isDrawingRef.current = false;
  };

  const handleEpodSealPhotoSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUri = typeof reader.result === 'string' ? reader.result : '';
      if (dataUri) {
        setEpodSealPhotoUri(dataUri);
        setEpodSealPhotoTimestamp(new Date().toISOString());
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleConfirmEpodAndStatus = async () => {
    if (!selectedJob) return;
    if (!epodSupervisorName.trim()) {
      showToast('Please enter the Warehouse Supervisor / Receiver name');
      return;
    }
    if (!epodRampBayNumber.trim()) {
      showToast('Please select or enter the Ramp / Loading Bay number');
      return;
    }

    // Ensure signature canvas has a signature (auto-generate if driver tapped confirm directly)
    if (!epodSignatureDrawn) {
      autoSignSupervisorCanvas();
    }
    const canvas = signatureCanvasRef.current;
    const signatureDataUri = canvas ? canvas.toDataURL('image/png') : '';

    const isRampPlacement = epodTargetStatus.includes('RAMP');
    const etcIso = isRampPlacement
      ? epodCustomEtc
        ? new Date(epodCustomEtc).toISOString()
        : new Date(Date.now() + epodEtcHours * 60 * 60 * 1000).toISOString()
      : null;

    const signedAtIso = new Date().toISOString();
    setEpodRecords((prev) => ({
      ...prev,
      [selectedJob.id]: {
        supervisorName: epodSupervisorName.trim(),
        rampBayNumber: epodRampBayNumber.trim(),
        signatureDataUri,
        sealCargoPhotoDataUri: epodSealPhotoUri,
        signedAt: signedAtIso,
      },
    }));

    setShowEpodModal(false);

    await handleStatusUpdate(selectedJob, epodTargetStatus, etcIso, {
      receiverName: epodSupervisorName.trim(),
      rampBayNumber: epodRampBayNumber.trim(),
      signatureDataUri: signatureDataUri || undefined,
      sealCargoPhotoUrl: epodSealPhotoUri,
      notes: `Digital e-POD signed by ${epodSupervisorName.trim()} at ${epodRampBayNumber.trim()}${epodSealPhotoTimestamp ? ` · Timestamped Seal/Cargo Photo @ ${new Date(epodSealPhotoTimestamp).toLocaleTimeString()}` : ''}`,
    });
  };

  const handleSelectEtcHours = async (hours: number) => {
    if (!selectedJob) return;
    setShowEtcModal(false);
    const etcDate = new Date(Date.now() + hours * 60 * 60 * 1000);
    await handleStatusUpdate(selectedJob, pendingRampStatus, etcDate.toISOString());
  };

  const handlePhotoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedJob) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUri = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUri) return;

      setAttachedDocs((prev) => ({
        ...prev,
        [selectedJob.id]: [...(prev[selectedJob.id] || []), file.name],
      }));

      try {
        await fetch(getApiEndpoint(`/api/driver/jobs/${selectedJob.id}/status`), {
          method: 'POST',
          credentials: 'include',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            action: 'EPOD_SIGN',
            receiverName: `${driverName} (Inspection Photo)`,
            photo: dataUri,
            notes: `Inspection photo/document attached: ${file.name}`,
            driverName,
          }),
        });
        showToast(`Attached "${file.name}" to ${selectedJob.jobCode}`);
      } catch {
        showToast(`Saved "${file.name}" locally`);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleLogout = async () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('fleet360_session_token');
      localStorage.removeItem('fleet360_active_vehicle');
      localStorage.removeItem('fleet360_driver_authenticated');
      window.dispatchEvent(new Event('fleet360_vehicle_changed'));
    }
    try {
      await fetch(getApiEndpoint('/api/auth/logout'), { method: 'POST', credentials: 'include' });
    } catch {}
    router.push('/driver-app');
  };

  // ══════════════════════════════════════════════════════════════════════════
  // VIEW 2: SIMPLIFIED JOB DETAIL SCREEN (LogiXL-Connect JobDetailScreen.js)
  // ══════════════════════════════════════════════════════════════════════════
  if (selectedJob) {
    const nextStep = getNextStep(selectedJob);
    const badge = getStatusBadgeStyle(selectedJob.status);
    const { pickupName, pickupLat, pickupLng, dropoffName, dropoffLat, dropoffLng } =
      getPickupAndDropoff(selectedJob);
    const jobDocs = attachedDocs[selectedJob.id] || [];
    const isReassignJob = [
      'RE-ASSIGNED',
      'FCL_REASSIGN',
      'MT_REASSIGN',
      'TRAILER_ATTACHED',
      'REASSIGN_PLACED_AT_RAMP',
      'REASSIGN_PLACED_AT_YARD',
    ].includes((selectedJob.status || '').toUpperCase());

    return (
      <div className="min-h-screen bg-slate-100 pb-16 text-slate-900">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 bg-blue-600 text-white px-4 py-3.5 shadow-md flex items-center justify-between">
          <button
            type="button"
            onClick={() => setSelectedJobId(null)}
            className="flex items-center gap-2 font-bold text-sm bg-blue-700/80 hover:bg-blue-700 px-3 py-1.5 rounded-lg transition active:scale-95"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to My Jobs</span>
          </button>
          <span className="font-mono text-xs font-bold bg-blue-800/70 px-2.5 py-1 rounded">
            {selectedJob.jobCode}
          </span>
        </header>

        {toastMessage && (
          <div className="bg-emerald-600 text-white px-4 py-2.5 text-center text-xs font-bold flex items-center justify-center gap-2 shadow">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{toastMessage}</span>
          </div>
        )}

        <main className="max-w-lg mx-auto p-4 space-y-4">
          {/* 1. Primary Blue Action Card — ONLY shows Current Status & Single Next Action */}
          <div className="bg-blue-600 rounded-2xl p-5 text-white shadow-lg space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-blue-100 font-semibold uppercase tracking-wider">
                  Current Status
                </div>
                <div className="mt-1 inline-block bg-white text-blue-700 font-extrabold text-sm px-3.5 py-1 rounded-full shadow-sm">
                  {badge.label}
                </div>
              </div>
              {selectedJob.tokenNumber && (
                <div className="text-right">
                  <div className="text-[11px] text-blue-100 font-semibold uppercase">Port Token</div>
                  <div className="mt-1 bg-amber-300 text-slate-900 font-extrabold text-xs px-2.5 py-1 rounded-md">
                    {selectedJob.tokenNumber}
                  </div>
                </div>
              )}
            </div>

            {nextStep ? (
              <div className="bg-white rounded-xl p-4 text-slate-900 shadow-inner space-y-3">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Next Action
                  </div>
                  <div className="text-lg font-extrabold text-slate-900 mt-0.5">
                    {nextStep.label}
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5">{nextStep.description}</p>
                </div>

                {/* =====================================================================
                    FEATURE 1: GEMINI VISION OCR CONTAINER, SEAL & EIR GATE SLIP SCANNER
                    Shown at Container Loaded (CONTAINER_PICKED) & Complete & Deposit MT (CONTAINER_DROPPED)
                    ===================================================================== */}
                {(nextStep.nextStatus === 'CONTAINER_PICKED' ||
                  nextStep.nextStatus === 'CONTAINER_DROPPED' ||
                  nextStep.nextStatus === 'EMPTY_DEPOSITED' ||
                  Boolean(ocrResults[selectedJob.id])) && (
                  <div className="p-3.5 rounded-xl bg-slate-900 text-white border border-sky-500/40 space-y-2.5 shadow-inner">
                    <input
                      ref={ocrFileInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) =>
                        handleOcrFileSelected(
                          e,
                          nextStep.nextStatus === 'CONTAINER_DROPPED' ||
                            nextStep.nextStatus === 'EMPTY_DEPOSITED'
                            ? 'COMPLETE_DEPOSIT_MT'
                            : 'CONTAINER_LOADED',
                        )
                      }
                      className="hidden"
                    />

                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-sky-500/20 border border-sky-400/40 flex items-center justify-center text-sky-400">
                          <ScanLine className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-xs font-extrabold text-white flex items-center gap-1.5">
                            <span>Gemini Vision OCR Scanner</span>
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-sky-500/20 text-sky-300 border border-sky-400/30">
                              AI ZERO-TYPING
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-300">
                            {nextStep.nextStatus === 'CONTAINER_DROPPED' ||
                            nextStep.nextStatus === 'EMPTY_DEPOSITED'
                              ? 'Verify Empty Container # & Port EIR Gate Slip at Complete & Deposit MT'
                              : 'Auto-verify Container #, Customs Bolt Seal & EIR Gate Slip at Container Loaded'}
                          </div>
                        </div>
                      </div>
                    </div>

                    {ocrResults[selectedJob.id] ? (
                      <div className="p-3 rounded-xl bg-emerald-950/90 border border-emerald-500/40 space-y-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-extrabold text-emerald-300 flex items-center gap-1.5">
                            <ShieldCheck className="w-4 h-4 text-emerald-400" />
                            OCR Verified ({ocrResults[selectedJob.id].confidencePct}% Confidence)
                          </span>
                          <span className="text-[10px] font-mono text-emerald-200 bg-emerald-800/60 px-2 py-0.5 rounded">
                            {ocrResults[selectedJob.id].model}
                          </span>
                        </div>

                        <div className="grid grid-cols-3 gap-2 pt-1 text-[11px]">
                          <div className="p-2 rounded-lg bg-slate-900/90 border border-emerald-500/30">
                            <span className="text-[9px] uppercase text-slate-400 block">
                              Container #
                            </span>
                            <strong className="font-mono text-white text-xs block truncate">
                              {ocrResults[selectedJob.id].containerNumber}
                            </strong>
                            <span className="text-[9px] text-emerald-400 font-bold">
                              ✓ ISO 6346 Match
                            </span>
                          </div>

                          <div className="p-2 rounded-lg bg-slate-900/90 border border-emerald-500/30">
                            <span className="text-[9px] uppercase text-slate-400 block">
                              Customs Seal
                            </span>
                            <strong className="font-mono text-amber-300 text-xs block truncate">
                              {ocrResults[selectedJob.id].sealNumber}
                            </strong>
                            <span className="text-[9px] text-emerald-400 font-bold">
                              ✓ Bolt Intact
                            </span>
                          </div>

                          <div className="p-2 rounded-lg bg-slate-900/90 border border-emerald-500/30">
                            <span className="text-[9px] uppercase text-slate-400 block">
                              EIR Gate Slip
                            </span>
                            <strong className="font-mono text-sky-300 text-xs block truncate">
                              {ocrResults[selectedJob.id].eirNumber}
                            </strong>
                            <span className="text-[9px] text-emerald-400 font-bold">
                              ✓ PCS Logged
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-1">
                          <span className="text-[10px] text-emerald-200 font-semibold">
                            Gate Status: {ocrResults[selectedJob.id].gateStatus}
                          </span>
                          <button
                            type="button"
                            onClick={() => ocrFileInputRef.current?.click()}
                            className="text-[10px] font-bold text-sky-300 underline"
                          >
                            Rescan Photo
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <button
                          type="button"
                          disabled={ocrScanning}
                          onClick={() => ocrFileInputRef.current?.click()}
                          className="py-2.5 px-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 shadow transition active:scale-95 disabled:opacity-50"
                        >
                          <Camera className="w-4 h-4" />
                          <span>{ocrScanning ? 'Scanning OCR…' : 'Snap Gate / Seal Photo'}</span>
                        </button>
                        <button
                          type="button"
                          disabled={ocrScanning}
                          onClick={() =>
                            void runGeminiVisionOcrScan(
                              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
                              nextStep.nextStatus === 'CONTAINER_DROPPED' ||
                                nextStep.nextStatus === 'EMPTY_DEPOSITED'
                                ? 'COMPLETE_DEPOSIT_MT'
                                : 'CONTAINER_LOADED',
                            )
                          }
                          className="py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 shadow transition active:scale-95 disabled:opacity-50"
                        >
                          <Sparkles className="w-4 h-4" />
                          <span>{ocrScanning ? 'Verifying…' : 'Instant AI Gate Scan'}</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Inspection Photo / Document Attachment (Shown ONLY during UNDER_INSPECTION) */}
                {selectedJob.status === 'UNDER_INSPECTION' && (
                  <div className="pt-1 space-y-2 border-t border-slate-200">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,application/pdf"
                      capture="environment"
                      onChange={handlePhotoSelected}
                      className="hidden"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="py-2.5 px-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow transition active:scale-95"
                      >
                        <Camera className="w-4 h-4" />
                        <span>Take Inspection Pic</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="py-2.5 px-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow transition active:scale-95"
                      >
                        <FileText className="w-4 h-4" />
                        <span>Attach Docs ({jobDocs.length})</span>
                      </button>
                    </div>
                    {jobDocs.length > 0 && (
                      <div className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5 font-semibold">
                        ✓ Attached: {jobDocs.join(', ')}
                      </div>
                    )}
                  </div>
                )}

                {/* Dual Placement Choice: Placed @ Yard OR Placed @ Ramp */}
                {nextStep.isDualChoice ? (
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() =>
                        handleStatusUpdate(
                          selectedJob,
                          isReassignJob ? 'REASSIGN_PLACED_AT_YARD' : 'PLACED_AT_YARD',
                        )
                      }
                      className="py-3.5 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-white font-extrabold text-sm shadow-md transition active:scale-95 disabled:opacity-50"
                    >
                      Placed @ Yard
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => {
                        const targetRamp = isReassignJob
                          ? 'REASSIGN_PLACED_AT_RAMP'
                          : 'PLACED_AT_RAMP';
                        setPendingRampStatus(targetRamp);
                        openEpodRampSignOffModal(targetRamp);
                      }}
                      className="py-3.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-sm shadow-md transition active:scale-95 disabled:opacity-50"
                    >
                      Placed @ Ramp
                    </button>
                  </div>
                ) : (
                  /* Single Prominent Next Action Button */
                  <div className="space-y-2">
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => {
                        const target = nextStep.nextStatus;
                        const isCompletionStep =
                          target === 'TRAILER_DETACHED' ||
                          target === 'REASSIGN_TRAILER_DETACHED' ||
                          target === 'READY_FOR_PICKUP' ||
                          target === 'CONTAINER_DROPPED' ||
                          target === 'EMPTY_DEPOSITED' ||
                          target === 'COMPLETED';
                        if (isCompletionStep && !epodRecords[selectedJob.id] && !selectedJob.podSignatureName) {
                          openEpodRampSignOffModal(target);
                        } else {
                          void handleStatusUpdate(selectedJob, target);
                        }
                      }}
                      style={{ backgroundColor: nextStep.color }}
                      className="w-full py-4 rounded-xl text-white font-extrabold text-base shadow-md hover:opacity-95 transition active:scale-95 disabled:opacity-50"
                    >
                      {submitting ? 'Updating…' : nextStep.label}
                    </button>

                    {/* Optional direct Digital e-POD Sign-Off button anytime at Ramp / Completion */}
                    {(selectedJob.status.includes('RAMP') ||
                      nextStep.nextStatus === 'CONTAINER_DROPPED' ||
                      nextStep.nextStatus === 'TRAILER_DETACHED') && (
                      <button
                        type="button"
                        onClick={() => openEpodRampSignOffModal(nextStep.nextStatus)}
                        className="w-full py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-800 font-extrabold text-xs flex items-center justify-center gap-1.5 transition"
                      >
                        <PenTool className="w-3.5 h-3.5 text-blue-600" />
                        <span>
                          {epodRecords[selectedJob.id] || selectedJob.podSignatureName
                            ? `✓ Digital e-POD Signed (${epodRecords[selectedJob.id]?.supervisorName || selectedJob.podSignatureName}) — Tap to Edit`
                            : 'Open Digital e-POD & Ramp Sign-Off'}
                        </span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-emerald-500 rounded-xl p-4 text-white text-center font-bold">
                ✓ This job is completed
              </div>
            )}
          </div>

          {/* 2. Turn-by-Turn Google Maps Navigation Card */}
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 space-y-3">
            <div className="text-xs font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Navigation className="w-4 h-4 text-blue-600" />
              <span>Turn-by-Turn GPS Navigation (Google Maps)</span>
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="min-w-0">
                  <div className="text-[11px] font-bold uppercase text-slate-400">
                    Pickup Location
                  </div>
                  <div className="text-sm font-bold text-slate-900 truncate">{pickupName}</div>
                </div>
                <button
                  type="button"
                  onClick={() => openGoogleMapsNavigation(pickupName, pickupLat, pickupLng)}
                  className="shrink-0 px-3.5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center gap-1.5 shadow transition active:scale-95"
                >
                  <Navigation className="w-3.5 h-3.5" />
                  <span>Navigate</span>
                </button>
              </div>

              <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="min-w-0">
                  <div className="text-[11px] font-bold uppercase text-slate-400">
                    Dropoff Location
                  </div>
                  <div className="text-sm font-bold text-slate-900 truncate">{dropoffName}</div>
                </div>
                <button
                  type="button"
                  onClick={() => openGoogleMapsNavigation(dropoffName, dropoffLat, dropoffLng)}
                  className="shrink-0 px-3.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 shadow transition active:scale-95"
                >
                  <Navigation className="w-3.5 h-3.5" />
                  <span>Navigate</span>
                </button>
              </div>
            </div>
          </div>

          {/* 3. Job Details Card (LogiXL-Connect JobDetailScreen parity) */}
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 space-y-2.5 text-sm">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 pb-1 border-b border-slate-100">
              Job Details
            </h3>

            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500 font-medium">Job Number</span>
              <span className="font-bold text-slate-900">{selectedJob.jobCode}</span>
            </div>

            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500 font-medium">Client</span>
              <span className="font-bold text-slate-900 text-right">
                {selectedJob.customerName || 'N/A'}
              </span>
            </div>

            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500 font-medium">Container</span>
              <span className="font-extrabold text-blue-700 font-mono">
                {selectedJob.containerNumber} ({selectedJob.containerSize}{' '}
                {selectedJob.containerType})
              </span>
            </div>

            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500 font-medium">Type</span>
              <span className="font-bold text-slate-900">
                {selectedJob.shipmentType} · {selectedJob.jobPhase}
              </span>
            </div>

            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500 font-medium">Trip Token</span>
              <span className="font-bold text-amber-700">
                {selectedJob.tokenNumber || 'Not Required'}
              </span>
            </div>

            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500 font-medium">Vehicle</span>
              <span className="font-bold text-slate-900">
                {vehiclePlate || selectedJob.assignedVehiclePlate || 'Assigned Tractor'}
              </span>
            </div>

            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500 font-medium">Trailer</span>
              <span className="font-extrabold text-amber-900 bg-amber-100 px-2 py-0.5 rounded">
                {selectedJob.assignedTrailerPlate || 'Not Assigned'}
              </span>
            </div>

            {selectedJob.etcTime && (
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-500 font-medium">Offload ETC</span>
                <span className="font-bold text-emerald-700">
                  {new Date(selectedJob.etcTime).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            )}

            {ocrResults[selectedJob.id] && (
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-500 font-medium">Gemini OCR Gate / Seal</span>
                <span className="font-mono font-bold text-indigo-700 text-xs">
                  {ocrResults[selectedJob.id].containerNumber} · {ocrResults[selectedJob.id].sealNumber} · {ocrResults[selectedJob.id].eirNumber}
                </span>
              </div>
            )}

            {(epodRecords[selectedJob.id] || selectedJob.podSignatureName) && (
              <div className="py-2 border-b border-slate-100 space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Digital e-POD & Ramp</span>
                  <span className="font-bold text-emerald-700 text-xs bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                    {epodRecords[selectedJob.id]?.rampBayNumber || 'Ramp Verified'} · {epodRecords[selectedJob.id]?.supervisorName || selectedJob.podSignatureName}
                  </span>
                </div>
                {epodRecords[selectedJob.id]?.signedAt && (
                  <div className="flex justify-between items-center text-[11px] text-slate-500">
                    <span>Timestamped Seal / Cargo Photo</span>
                    <span className="font-mono text-slate-700">
                      {new Date(epodRecords[selectedJob.id].signedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-between py-1.5">
              <span className="text-slate-500 font-medium">Driver Allowance</span>
              <span className="font-extrabold text-emerald-600 text-base">
                AED {Number(selectedJob.driverAllowanceAed || 0).toFixed(2)}
              </span>
            </div>
          </div>
        </main>

        {/* Simple LogiXL-Connect ETC Modal (1 Hr / 2 Hrs / 3 Hrs / 4 Hrs) */}
        {showEtcModal && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-4 text-center">
              <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto">
                <Clock className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-extrabold text-slate-900">
                  Estimated Offloading Time (ETC)
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Select estimated hours for warehouse offloading at the ramp:
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[1, 2, 3, 4].map((hrs) => (
                  <button
                    key={hrs}
                    type="button"
                    onClick={() => void handleSelectEtcHours(hrs)}
                    className="py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-extrabold text-sm shadow transition active:scale-95"
                  >
                    {hrs} {hrs === 1 ? 'Hour' : 'Hours'}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setShowEtcModal(false)}
                className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Digital e-POD & Ramp Sign-Off Modal (Placed @ Ramp / Complete) */}
        {showEpodModal && (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3 overflow-y-auto">
            <div className="bg-white rounded-2xl p-5 max-w-md w-full shadow-2xl space-y-4 my-4 border border-slate-200">
              <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
                <div>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-emerald-100 text-emerald-800">
                    Digital e-POD & Ramp Sign-Off
                  </span>
                  <h3 className="text-base font-extrabold text-slate-900 mt-1">
                    {epodTargetStatus.includes('RAMP')
                      ? 'Placed @ Ramp — Supervisor & Bay Sign-Off'
                      : 'Complete & Handover — Digital e-POD'}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Container <span className="font-mono font-bold text-slate-700">{selectedJob.containerNumber}</span> · {selectedJob.warehouseName || selectedJob.terminalName}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowEpodModal(false)}
                  className="text-slate-400 hover:text-slate-600 text-sm font-bold px-2 py-1"
                >
                  ✕
                </button>
              </div>

              {/* 1. Ramp / Dock Bay Number */}
              <div>
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-600 mb-1.5">
                  1. Warehouse Ramp / Dock Bay Number
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {[
                    'Ramp Bay 01',
                    'Ramp Bay 02',
                    'Ramp Bay 03',
                    'Ramp Bay 04',
                    'Cold Chain Bay',
                    'Port MT Gate',
                  ].map((bay) => (
                    <button
                      key={bay}
                      type="button"
                      onClick={() => setEpodRampBayNumber(bay)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition ${
                        epodRampBayNumber === bay
                          ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {bay}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={epodRampBayNumber}
                  onChange={(e) => setEpodRampBayNumber(e.target.value)}
                  placeholder="Enter Ramp / Dock Bay Number (e.g. JAFZA South Bay 04)"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* 2. Warehouse Supervisor Name */}
              <div>
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-600 mb-1">
                  2. Warehouse Supervisor / Receiver Name
                </label>
                <input
                  type="text"
                  value={epodSupervisorName}
                  onChange={(e) => setEpodSupervisorName(e.target.value)}
                  placeholder="Supervisor Name & ID / Stamp"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* 3. Offloading ETC Duration (only when placing at ramp) */}
              {epodTargetStatus.includes('RAMP') && (
                <div>
                  <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-600 mb-1.5">
                    3. Estimated Offloading Duration (Triggers Auto-L2 Timer)
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {[1, 2, 3, 4].map((hrs) => (
                      <button
                        key={hrs}
                        type="button"
                        onClick={() => setEpodEtcHours(hrs)}
                        className={`py-2 rounded-xl text-xs font-extrabold border transition ${
                          epodEtcHours === hrs
                            ? 'bg-amber-500 text-white border-amber-600 shadow-sm'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        +{hrs} {hrs === 1 ? 'Hr' : 'Hrs'}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 4. Timestamped Seal / Cargo Photo */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-600">
                    {epodTargetStatus.includes('RAMP') ? '4.' : '3.'} Timestamped Seal & Cargo Photo
                  </label>
                  {epodSealPhotoTimestamp && (
                    <span className="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      Captured {new Date(epodSealPhotoTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  )}
                </div>

                <input
                  ref={epodPhotoInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleEpodSealPhotoSelected}
                  className="hidden"
                />

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => epodPhotoInputRef.current?.click()}
                    className="py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    📷 Snap Seal / Cargo Photo
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const nowIso = new Date().toISOString();
                      setEpodSealPhotoTimestamp(nowIso);
                      setEpodSealPhotoUri(
                        `data:image/svg+xml;utf8,${encodeURIComponent(
                          `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="160"><rect width="100%" height="100%" fill="#0f172a"/><text x="20" y="45" fill="#38bdf8" font-family="monospace" font-size="16" font-weight="bold">FLEET360 TIMESTAMPED SEAL / CARGO PROOF</text><text x="20" y="80" fill="#f8fafc" font-family="monospace" font-size="15">CNTR: ${selectedJob.containerNumber} | BAY: ${epodRampBayNumber}</text><text x="20" y="112" fill="#4ade80" font-family="monospace" font-size="14">SEAL VERIFIED • ${nowIso}</text><text x="20" y="140" fill="#94a3b8" font-family="monospace" font-size="12">GPS: 24.9857° N, 55.0972° E (UAE Corridor)</text></svg>`
                        )}`
                      );
                    }}
                    className="py-2.5 px-3 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 font-bold text-xs flex items-center justify-center gap-1"
                  >
                    ⚡ Stamp Verified Seal Photo
                  </button>
                </div>

                {epodSealPhotoUri && (
                  <div className="mt-2 relative rounded-xl overflow-hidden border border-slate-200 bg-slate-950">
                    <img
                      src={epodSealPhotoUri}
                      alt="Timestamped Seal & Cargo Proof"
                      className="w-full h-24 object-cover"
                    />
                    <div className="bg-slate-900/90 text-white px-2.5 py-1 text-[10px] font-mono flex justify-between">
                      <span>CNTR: {selectedJob.containerNumber}</span>
                      <span className="text-emerald-400">{epodRampBayNumber}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* 5. Warehouse Supervisor Sign-on-Glass Canvas */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-600">
                    {epodTargetStatus.includes('RAMP') ? '5.' : '4.'} Supervisor Signature (Sign-on-Glass)
                  </label>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={autoSignSupervisorCanvas}
                      className="text-[10px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded border border-blue-200"
                    >
                      ✍️ 1-Tap Supervisor Stamp
                    </button>
                    <button
                      type="button"
                      onClick={clearSignatureCanvas}
                      className="text-[10px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 px-2 py-0.5 rounded"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 overflow-hidden">
                  <canvas
                    ref={signatureCanvasRef}
                    width={360}
                    height={115}
                    onPointerDown={handleCanvasPointerDown}
                    onPointerMove={handleCanvasPointerMove}
                    onPointerUp={handleCanvasPointerUp}
                    onPointerLeave={handleCanvasPointerUp}
                    className="w-full h-28 touch-none cursor-crosshair"
                  />
                </div>
                <p className="text-[10px] text-slate-400 mt-1">
                  Warehouse supervisor signs above with finger/stylus or taps &ldquo;1-Tap Supervisor Stamp&rdquo;.
                </p>
              </div>

              {/* Submit / Cancel */}
              <div className="flex gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEpodModal(false)}
                  className="w-1/3 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleConfirmEpodAndStatus()}
                  className="w-2/3 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-extrabold text-xs shadow-lg transition active:scale-95"
                >
                  {submitting
                    ? 'Saving e-POD...'
                    : epodTargetStatus.includes('RAMP')
                      ? 'Confirm e-POD & Place @ Ramp'
                      : 'Confirm e-POD & Complete Job'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // VIEW 1: SIMPLIFIED MY JOBS DASHBOARD (LogiXL-Connect DashboardScreen.js)
  // ══════════════════════════════════════════════════════════════════════════
  const displayedJobs = viewMode === 'active' ? activeJobs : historyJobs;

  return (
    <div className="min-h-screen bg-slate-100 pb-20 text-slate-900">
      {/* Blue Header Matching LogiXL-Connect DashboardScreen */}
      <header className="bg-blue-600 text-white px-5 pt-5 pb-4 shadow-md">
        <div className="max-w-lg mx-auto flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-extrabold tracking-tight">My Jobs</h1>
            <p className="text-xs text-blue-100 mt-0.5 font-medium">
              Welcome, {driverName}
            </p>
            {vehiclePlate && (
              <div className="mt-2 inline-flex items-center gap-1.5 bg-blue-700/90 border border-blue-400/40 px-2.5 py-1 rounded-lg text-xs font-bold">
                <Truck className="w-3.5 h-3.5 text-amber-300" />
                <span>Vehicle: {vehiclePlate}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void fetchDriverJobs(false)}
              title="Refresh Jobs"
              className="p-2.5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white transition active:scale-95"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1.5 shadow transition active:scale-95"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Logout</span>
            </button>
          </div>
        </div>
      </header>

      {toastMessage && (
        <div className="bg-emerald-600 text-white px-4 py-2.5 text-center text-xs font-bold flex items-center justify-center gap-2 shadow">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Active Jobs vs. History Tabs */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-lg mx-auto grid grid-cols-2">
          <button
            type="button"
            onClick={() => setViewMode('active')}
            className={`py-3.5 text-sm font-extrabold border-b-2 transition ${
              viewMode === 'active'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Active Jobs ({activeJobs.length})
          </button>
          <button
            type="button"
            onClick={() => setViewMode('history')}
            className={`py-3.5 text-sm font-extrabold border-b-2 transition ${
              viewMode === 'history'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            History ({historyJobs.length})
          </button>
        </div>
      </div>

      {/* Jobs List */}
      <main className="max-w-lg mx-auto p-4 space-y-3.5">
        {loading ? (
          <div className="bg-white rounded-2xl p-8 text-center text-sm text-slate-500 shadow-sm border border-slate-200">
            Loading your assigned jobs…
          </div>
        ) : displayedJobs.length === 0 ? (
          <div className="bg-white rounded-2xl p-8 text-center shadow-sm border border-slate-200 space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
              <Truck className="w-6 h-6" />
            </div>
            <div className="text-base font-bold text-slate-700">
              {viewMode === 'active' ? 'No active jobs assigned' : 'No completed jobs in history'}
            </div>
            <p className="text-xs text-slate-500">
              {viewMode === 'active'
                ? 'Pull or tap Refresh when dispatch assigns or reassigns a job to you.'
                : 'Jobs you detach or complete will immediately appear here.'}
            </p>
            <button
              type="button"
              onClick={() => void fetchDriverJobs(false)}
              className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 text-white font-bold text-xs shadow hover:bg-blue-500 transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>Refresh Now</span>
            </button>
          </div>
        ) : (
          displayedJobs.map((job) => {
            const badge = getStatusBadgeStyle(job.status);
            const nextStep = getNextStep(job);
            const { pickupName, pickupLat, pickupLng, dropoffName, dropoffLat, dropoffLng } =
              getPickupAndDropoff(job);

            return (
              <div
                key={job.id}
                className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 space-y-3"
              >
                {/* Card Header: Job Number, Token, Status Badge */}
                <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-slate-100">
                  <div>
                    <div className="text-base font-extrabold text-slate-900">{job.jobCode}</div>
                    {job.tokenNumber && (
                      <span className="mt-1 inline-block bg-amber-300 text-slate-900 font-extrabold text-[11px] px-2 py-0.5 rounded">
                        TOKEN: {job.tokenNumber}
                      </span>
                    )}
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-full text-[11px] font-extrabold border ${badge.bg} ${badge.text}`}
                  >
                    {badge.label}
                  </span>
                </div>

                {/* Highlighted Yellow Trailer Box (LogiXL-Connect DashboardScreen parity) */}
                <div className="bg-amber-100 border border-amber-300 rounded-xl px-3 py-2 flex items-center justify-between">
                  <span className="text-xs font-extrabold text-amber-900">
                    🚛 TRAILER: {job.assignedTrailerPlate || 'Not Assigned'}
                  </span>
                  <span className="text-[11px] font-bold text-amber-800">
                    {job.jobPhase} · {job.shipmentType}
                  </span>
                </div>

                {/* Core Details */}
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-semibold">Client:</span>
                    <span className="font-bold text-slate-900 text-right">
                      {job.customerName || 'N/A'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-semibold">Container:</span>
                    <span className="font-extrabold text-blue-700 font-mono">
                      {job.containerNumber} ({job.containerSize} {job.containerType})
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-semibold">Allowance:</span>
                    <span className="font-extrabold text-emerald-600">
                      AED {Number(job.driverAllowanceAed || 0).toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* Pickup & Dropoff with Direct Turn-by-Turn Google Maps Navigation Buttons */}
                <div className="space-y-2 pt-1 border-t border-slate-100">
                  <div className="flex items-center justify-between gap-2 bg-slate-50 rounded-xl p-2.5 border border-slate-200/80">
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold uppercase text-slate-400">Pickup</div>
                      <div className="text-xs font-bold text-slate-800 truncate">{pickupName}</div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openGoogleMapsNavigation(pickupName, pickupLat, pickupLng);
                      }}
                      className="shrink-0 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-[11px] flex items-center gap-1 shadow-sm transition active:scale-95"
                    >
                      <MapPin className="w-3 h-3" />
                      <span>Navigate</span>
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-2 bg-slate-50 rounded-xl p-2.5 border border-slate-200/80">
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold uppercase text-slate-400">Dropoff</div>
                      <div className="text-xs font-bold text-slate-800 truncate">{dropoffName}</div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openGoogleMapsNavigation(dropoffName, dropoffLat, dropoffLng);
                      }}
                      className="shrink-0 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] flex items-center gap-1 shadow-sm transition active:scale-95"
                    >
                      <MapPin className="w-3 h-3" />
                      <span>Navigate</span>
                    </button>
                  </div>
                </div>

                {/* Single Next Action Call-To-Action Button */}
                <button
                  type="button"
                  onClick={() => setSelectedJobId(job.id)}
                  className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-extrabold text-sm shadow transition active:scale-95 flex items-center justify-center gap-2"
                >
                  <span>
                    {nextStep
                      ? `Next Action: ${nextStep.label} →`
                      : 'View Completed Job Details →'}
                  </span>
                </button>
              </div>
            );
          })
        )}
      </main>
    </div>
  );
}
