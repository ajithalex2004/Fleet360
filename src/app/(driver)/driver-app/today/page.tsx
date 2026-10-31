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
  Truck,
  X,
} from 'lucide-react';
import { getApiEndpoint } from '@/lib/api-endpoint';

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
          label: 'Container Dropped',
          description: 'Confirm empty container is dropped off at port terminal',
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
        label: 'Container Picked',
        description: 'Confirm container has been picked up at the port terminal',
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
                        if (isReassignJob) {
                          void handleStatusUpdate(selectedJob, 'REASSIGN_PLACED_AT_RAMP');
                        } else {
                          setPendingRampStatus('PLACED_AT_RAMP');
                          setShowEtcModal(true);
                        }
                      }}
                      className="py-3.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-sm shadow-md transition active:scale-95 disabled:opacity-50"
                    >
                      Placed @ Ramp
                    </button>
                  </div>
                ) : (
                  /* Single Prominent Next Action Button */
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => handleStatusUpdate(selectedJob, nextStep.nextStatus)}
                    style={{ backgroundColor: nextStep.color }}
                    className="w-full py-4 rounded-xl text-white font-extrabold text-base shadow-md hover:opacity-95 transition active:scale-95 disabled:opacity-50"
                  >
                    {submitting ? 'Updating…' : nextStep.label}
                  </button>
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
