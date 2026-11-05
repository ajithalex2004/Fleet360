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
  Bell,
  Camera,
  CheckCircle2,
  Clock,
  FileText,
  LogOut,
  MapPin,
  MessageSquare,
  Navigation,
  Send,
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

interface DrayageChatMessage {
  id: string;
  senderRole: string;
  senderName: string;
  message: string;
  isUrgent?: boolean;
  isBroadcast?: boolean;
  createdAt: string;
}

interface DrayageAssignment {
  id: string;
  jobCode: string;
  jobPhase: 'L1' | 'L2';
  shipmentType: 'IMPORT' | 'EXPORT';
  status: string;
  priority: string;
  customerName?: string | null;
  clientName?: string | null;
  clientDestination?: string | null;
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
  messages?: DrayageChatMessage[];
}

interface EpodSignatureInfo {
  receiverName: string;
  receiverRole: string;
  signatureDataUri: string;
  signedAt: string;
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
  'FCL_REASSIGN',
  'MT_REASSIGN',
  'MT_REASSIGN TO YARD',
  'FCL_REASSIGN TO YARD',
  'FCL_REASSIGN TO RAMP',
  'MT_REASSIGN TO RAMP',
  'MT_REASSIGN_TO_YARD',
  'FCL_REASSIGN_TO_YARD',
  'FCL_REASSIGN_TO_RAMP',
  'MT_REASSIGN_TO_RAMP',
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
    status === 'TRAILER_ATTACHED' ||
    status === 'REASSIGN_PLACED_AT_RAMP' ||
    status === 'REASSIGN_PLACED_AT_YARD';

  if (HISTORY_STATUSES.has(status)) {
    return null;
  }

  // 1. Reassignment Workflow (Yard <-> Ramp / Reassigned Trailer)
  if (isReassign) {
    const originLocation = (job.placementLocation || '').toUpperCase();
    switch (status) {
      case 'RE-ASSIGNED':
        return {
          nextStatus: 'TRAILER_ATTACHED',
          label: 'Trailer Attached',
          description:
            originLocation === 'RAMP'
              ? 'Confirm trailer is coupled at the Ramp to move container to the Yard'
              : 'Confirm trailer is coupled at the Yard to move container to the Ramp',
          color: '#2563eb',
          isReassign: true,
        };
      case 'TRAILER_ATTACHED':
        if (originLocation === 'RAMP') {
          return {
            nextStatus: 'REASSIGN_PLACED_AT_YARD',
            label: 'Placed @ Yard',
            description: 'Confirm container has been shunted from the Ramp and placed at the Yard',
            color: '#f59e0b',
            isReassign: true,
          };
        }
        if (originLocation === 'YARD') {
          return {
            nextStatus: 'REASSIGN_PLACED_AT_RAMP',
            label: 'Placed @ Ramp',
            description: 'Confirm container has been shunted from the Yard and placed at the Ramp',
            color: '#10b981',
            isReassign: true,
          };
        }
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
    case 'FCL_REASSIGN':
    case 'MT_REASSIGN':
    case 'MT_REASSIGN TO YARD':
    case 'FCL_REASSIGN TO YARD':
    case 'FCL_REASSIGN TO RAMP':
    case 'MT_REASSIGN TO RAMP':
    case 'MT_REASSIGN_TO_YARD':
    case 'FCL_REASSIGN_TO_YARD':
    case 'FCL_REASSIGN_TO_RAMP':
    case 'MT_REASSIGN_TO_RAMP':
      return { bg: 'bg-emerald-100 border-emerald-300', text: 'text-emerald-800', label: 'COMPLETED' };
    default:
      return { bg: 'bg-slate-100 border-slate-300', text: 'text-slate-700', label: s.replace(/_/g, ' ') };
  }
}

function getPickupAndDropoff(job: DrayageAssignment) {
  const isL2 = job.jobPhase === 'L2' || (job.jobCode && job.jobCode.includes('-L2'));
  const statusUpper = (job.status || '').toUpperCase();
  const isReassign = [
    'RE-ASSIGNED',
    'TRAILER_ATTACHED',
    'REASSIGN_PLACED_AT_RAMP',
    'REASSIGN_PLACED_AT_YARD',
    'REASSIGN_TRAILER_DETACHED',
    'READY_FOR_PICKUP',
  ].includes(statusUpper);

  if (isReassign) {
    const originLoc = (job.placementLocation || '').toUpperCase();
    const isRampToYard =
      statusUpper === 'REASSIGN_PLACED_AT_YARD' ||
      statusUpper === 'READY_FOR_PICKUP' ||
      ((statusUpper === 'RE-ASSIGNED' || statusUpper === 'TRAILER_ATTACHED') && originLoc === 'RAMP');

    if (isRampToYard) {
      return {
        pickupName: `${job.warehouseName || 'Client Warehouse'} (Ramp)`,
        pickupLat: job.warehouseGeofence?.lat ?? null,
        pickupLng: job.warehouseGeofence?.lng ?? null,
        dropoffName: `${job.warehouseName || 'Client Yard'} (Yard)`,
        dropoffLat: job.warehouseGeofence?.lat ?? null,
        dropoffLng: job.warehouseGeofence?.lng ?? null,
      };
    }

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

function escapeXml(unsafe = '') {
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildSignatureSvgDataUri(args: {
  strokes: Array<Array<{ x: number; y: number }>>;
  canvasWidth?: number;
  canvasHeight?: number;
  receiverName: string;
  receiverRole?: string;
  jobNumber: string;
  containerNumber: string;
  statusLabel: string;
}): string {
  const canvasWidth = args.canvasWidth || 340;
  const canvasHeight = args.canvasHeight || 190;
  const pathElements = args.strokes
    .filter((pts) => pts.length > 0)
    .map((pts) => {
      if (pts.length === 1) {
        const p = pts[0];
        return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2" fill="#0f172a" />`;
      }
      const d = pts
        .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
        .join(' ');
      return `<path d="${d}" stroke="#0f172a" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round" />`;
    })
    .join('\n    ');

  const timestampStr = `${new Date().toLocaleString('en-US', { timeZone: 'Asia/Dubai' })} GST`;
  const headerTitle = `Fleet360 — Digital ePOD Signature (${escapeXml(args.statusLabel || 'FCL_DELIVERED')})`;
  const subMeta = `Job: ${escapeXml(args.jobNumber || 'N/A')}${args.containerNumber ? ` | Container: ${escapeXml(args.containerNumber)}` : ''}`;
  const signerLine = `Received By: ${escapeXml(args.receiverName)}${args.receiverRole ? ` (${escapeXml(args.receiverRole)})` : ''}`;

  const svgWidth = Math.max(canvasWidth, 320);
  const svgHeight = canvasHeight + 80;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">
  <rect width="100%" height="100%" rx="12" fill="#ffffff" stroke="#cbd5e1" stroke-width="2"/>
  <rect x="0" y="0" width="100%" height="36" rx="10" fill="#eff6ff"/>
  <text x="14" y="16" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="#1e3a8a">${headerTitle}</text>
  <text x="14" y="30" font-family="Arial, sans-serif" font-size="9" fill="#475569">${subMeta}</text>
  <g transform="translate(0, 38)">
    <line x1="16" y1="${canvasHeight - 22}" x2="${svgWidth - 16}" y2="${canvasHeight - 22}" stroke="#cbd5e1" stroke-dasharray="4,4" stroke-width="1"/>
    ${pathElements}
  </g>
  <text x="14" y="${svgHeight - 22}" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="#0f172a">${signerLine}</text>
  <text x="14" y="${svgHeight - 8}" font-family="Arial, sans-serif" font-size="9" fill="#64748b">Signed on Glass: ${escapeXml(timestampStr)}</text>
</svg>`;

  if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
    const utf8 = unescape(encodeURIComponent(svg));
    return `data:image/svg+xml;base64,${window.btoa(utf8)}`;
  }
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
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

  // Ramp ETC selection modal state (Quick Presets + Custom Date & Time picker)
  const [showEtcModal, setShowEtcModal] = useState(false);
  const [pendingRampStatus, setPendingRampStatus] = useState<string>('PLACED_AT_RAMP');
  const [customEtcDate, setCustomEtcDate] = useState<string>(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  });
  const [customEtcTime, setCustomEtcTime] = useState<string>(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${min}`;
  });

  // Sign-on-Glass ePOD Signature Pad Modal state (LogiXL-Connect SignaturePadModal parity)
  const [epodSignatures, setEpodSignatures] = useState<Record<string, EpodSignatureInfo>>({});
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const [sigModalKey, setSigModalKey] = useState(0);
  const [pendingActionAfterSign, setPendingActionAfterSign] = useState<{
    targetStatus: string;
    label: string;
    requireEtcModal?: boolean;
  } | null>(null);
  const [sigReceiverName, setSigReceiverName] = useState('');
  const [sigReceiverRole, setSigReceiverRole] = useState('');
  const [sigStrokes, setSigStrokes] = useState<Array<Array<{ x: number; y: number }>>>([]);
  const [sigCurrentStroke, setSigCurrentStroke] = useState<Array<{ x: number; y: number }>>([]);
  const isDrawingSigRef = useRef(false);
  const sigCurrentStrokeRef = useRef<Array<{ x: number; y: number }>>([]);
  const sigSvgRef = useRef<SVGSVGElement | null>(null);

  const openEtcModalWithDefaults = useCallback((rampStatus: string) => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    setCustomEtcDate(`${yyyy}-${mm}-${dd}`);
    setCustomEtcTime(`${hh}:${min}`);
    setPendingRampStatus(rampStatus);
    setShowEtcModal(true);
  }, []);

  const openSignatureModalFresh = useCallback(
    (
      pendingAction: {
        targetStatus: string;
        label: string;
        requireEtcModal?: boolean;
      } | null = null,
    ) => {
      isDrawingSigRef.current = false;
      sigCurrentStrokeRef.current = [];
      setSigCurrentStroke([]);
      setSigStrokes([]);
      setSigReceiverName('');
      setSigReceiverRole('');
      setSigModalKey((prev) => prev + 1);
      setPendingActionAfterSign(pendingAction);
      setShowSignatureModal(true);
    },
    [],
  );

  // Ensure Sign-on-Glass fields & pad are always cleared whenever the modal opens
  useEffect(() => {
    if (showSignatureModal) {
      isDrawingSigRef.current = false;
      sigCurrentStrokeRef.current = [];
      setSigCurrentStroke([]);
      setSigStrokes([]);
      setSigReceiverName('');
      setSigReceiverRole('');
    }
  }, [showSignatureModal]);

  // Dispatcher <-> Driver chat & broadcast + job assignment notification state
  const [chatInput, setChatInput] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  const [broadcastMessages, setBroadcastMessages] = useState<DrayageChatMessage[]>([]);
  const [dismissedBroadcastIds, setDismissedBroadcastIds] = useState<string[]>([]);
  const [showNotificationsPanel, setShowNotificationsPanel] = useState(false);
  const seenMsgIdsRef = useRef<Set<string>>(new Set());
  const seenJobKeysRef = useRef<Set<string>>(new Set());
  const initialLoadDoneRef = useRef(false);
  const initialJobLoadDoneRef = useRef(false);
  const driverCoordsRef = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('geolocation' in navigator)) return;
    let watchId: number | null = null;
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          driverCoordsRef.current = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          };
        },
        () => {},
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 30000 },
      );
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          driverCoordsRef.current = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          };
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 15000 },
      );
    } catch {}
    return () => {
      if (watchId !== null && 'geolocation' in navigator) {
        try {
          navigator.geolocation.clearWatch(watchId);
        } catch {}
      }
    };
  }, []);

  const triggerMobileNotification = useCallback((title: string, body: string, tagKey?: string) => {
    try {
      const keyStr = tagKey || `${title}:${body}:${Date.now()}`;
      let hash = 0;
      for (let i = 0; i < keyStr.length; i += 1) {
        hash = (hash * 31 + keyStr.charCodeAt(i)) | 0;
      }
      const notificationId = Math.abs(hash % 900000) + 10000;

      // 1. Native Android OS Heads-Up Notification (via MainActivity @JavascriptInterface)
      const w = typeof window !== 'undefined' ? (window as unknown as {
        Fleet360Android?: {
          postNotification?: (t: string, b: string, id: number) => void;
          requestPermission?: () => void;
        };
      }) : undefined;
      if (w?.Fleet360Android?.postNotification) {
        w.Fleet360Android.postNotification(title, body, notificationId);
      } else if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        // 2. Browser Notification API fallback
        new Notification(title, { body, tag: tagKey });
      }

      // 3. Vibration pattern (like WhatsApp / SMS alert)
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate([300, 120, 300, 120, 400]);
      }

      // 4. Audible two-tone dispatch chime
      if (typeof window !== 'undefined') {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          const playTone = (freq: number, startSec: number, durationSec: number) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, ctx.currentTime + startSec);
            gain.gain.setValueAtTime(0.22, ctx.currentTime + startSec);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startSec + durationSec);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(ctx.currentTime + startSec);
            osc.stop(ctx.currentTime + startSec + durationSec);
          };
          playTone(880, 0, 0.16);
          playTone(1174.66, 0.18, 0.24);
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const savedDismissed = localStorage.getItem('fleet360_dismissed_broadcast_ids');
      if (savedDismissed) {
        const parsed = JSON.parse(savedDismissed);
        if (Array.isArray(parsed)) setDismissedBroadcastIds(parsed);
      }
      const savedNotifiedJobs = localStorage.getItem('fleet360_notified_job_keys');
      if (savedNotifiedJobs) {
        const parsedKeys = JSON.parse(savedNotifiedJobs);
        if (Array.isArray(parsedKeys)) {
          for (const k of parsedKeys) {
            if (typeof k === 'string') seenJobKeysRef.current.add(k);
          }
        }
      }
      const savedNotifiedMsgs = localStorage.getItem('fleet360_notified_msg_ids');
      if (savedNotifiedMsgs) {
        const parsedMsgs = JSON.parse(savedNotifiedMsgs);
        if (Array.isArray(parsedMsgs)) {
          for (const mId of parsedMsgs) {
            if (typeof mId === 'string') seenMsgIdsRef.current.add(mId);
          }
        }
      }
      const w = window as unknown as {
        Fleet360Android?: {
          requestPermission?: () => void;
          syncAuthSession?: (token: string, apiHost: string, driverName: string) => void;
        };
      };
      const savedToken = localStorage.getItem('fleet360_session_token');
      if (savedToken && w?.Fleet360Android?.syncAuthSession) {
        w.Fleet360Android.syncAuthSession(
          savedToken,
          localStorage.getItem('fleet360_api_host') || 'https://fleet360-app-production.up.railway.app',
          localStorage.getItem('fleet360_driver_name') || 'Driver',
        );
      }
      if (w?.Fleet360Android?.requestPermission) {
        w.Fleet360Android.requestPermission();
      } else if ('Notification' in window && Notification.permission === 'default') {
        void Notification.requestPermission().catch(() => {});
      }
    } catch {}
  }, []);

  const handleDismissBroadcast = useCallback((msgId: string) => {
    setDismissedBroadcastIds((prev) => {
      const next = prev.includes(msgId) ? prev : [...prev, msgId];
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('fleet360_dismissed_broadcast_ids', JSON.stringify(next));
        } catch {}
      }
      return next;
    });
  }, []);

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
          const fetchedBroadcasts: DrayageChatMessage[] = Array.isArray(data.broadcastMessages)
            ? data.broadcastMessages
            : [];
          setJobs(fetched);
          setBroadcastMessages(fetchedBroadcasts);

          // 1. Detect newly assigned or reassigned jobs and trigger immediate mobile OS notification
          const androidBridge =
            typeof window !== 'undefined'
              ? (window as unknown as {
                  Fleet360Android?: {
                    isJobKeyNotified?: (k: string) => boolean;
                    markJobKeyNotified?: (k: string) => void;
                    isMsgIdNotified?: (id: string) => boolean;
                    markMsgIdNotified?: (id: string) => void;
                  };
                }).Fleet360Android
              : undefined;

          const ASSIGNMENT_STATUSES = new Set([
            'ASSIGNED',
            'PENDING',
            'RE-ASSIGNED',
            'FCL_REASSIGN',
            'MT_REASSIGN',
          ]);
          const newlyAssignedJobs: DrayageAssignment[] = [];
          let jobKeysUpdated = false;

          // Check if driver has any active, uncompleted L2 job.
          // While an L2 job is active, any queued L1 job remains INACTIVE (Waiting for L2 completion).
          const hasActiveUncompletedL2 = fetched.some((item) => {
            const itemSt = (item.status || 'ASSIGNED').toUpperCase();
            const itemIsL2 =
              item.jobPhase === 'L2' || Boolean(item.jobCode && item.jobCode.includes('-L2'));
            return itemIsL2 && !HISTORY_STATUSES.has(itemSt);
          });

          for (const j of fetched) {
            const st = (j.status || 'ASSIGNED').toUpperCase();
            if (HISTORY_STATUSES.has(st)) continue;

            const isL2 = j.jobPhase === 'L2' || Boolean(j.jobCode && j.jobCode.includes('-L2'));
            const isReassignJob =
              st === 'RE-ASSIGNED' ||
              st === 'FCL_REASSIGN' ||
              st === 'MT_REASSIGN' ||
              st === 'TRAILER_ATTACHED' ||
              st === 'REASSIGN_PLACED_AT_RAMP' ||
              st === 'REASSIGN_PLACED_AT_YARD';

            // If this is a queued L1 job while an L2 job is active, keep it INACTIVE and suppress notifications
            // until the L2 job is completed.
            if (!isL2 && !isReassignJob && hasActiveUncompletedL2) {
              continue;
            }

            const isReassignStatus =
              st === 'RE-ASSIGNED' || st === 'FCL_REASSIGN' || st === 'MT_REASSIGN';
            const assignPhase = isReassignStatus ? 'REASSIGN' : 'ASSIGN';
            const assignKey = `${j.id}:${assignPhase}:${j.assignedVehiclePlate || ''}:${j.assignedTrailerPlate || ''}`;
            const legacyAssignKey = `${j.id}:${st}:${j.assignedVehiclePlate || ''}:${j.assignedTrailerPlate || ''}`;

            const alreadyNotifiedByNative =
              Boolean(androidBridge?.isJobKeyNotified?.(assignKey)) ||
              Boolean(androidBridge?.isJobKeyNotified?.(legacyAssignKey));

            if (alreadyNotifiedByNative && !seenJobKeysRef.current.has(assignKey)) {
              seenJobKeysRef.current.add(assignKey);
              jobKeysUpdated = true;
              continue;
            }

            if (!seenJobKeysRef.current.has(assignKey)) {
              seenJobKeysRef.current.add(assignKey);
              androidBridge?.markJobKeyNotified?.(assignKey);
              jobKeysUpdated = true;
              // ONLY push a job notification when the job is in an initial assignment/reassignment status,
              // NEVER on intermediate status updates (ACCEPTED, CONTAINER_PICKED, EN_ROUTE_TERMINAL, etc.)
              if (ASSIGNMENT_STATUSES.has(st)) {
                newlyAssignedJobs.push(j);
              }
            }
          }

          if (!initialJobLoadDoneRef.current) {
            initialJobLoadDoneRef.current = true;
          }

          if (jobKeysUpdated && typeof window !== 'undefined') {
            try {
              const keysArr = Array.from(seenJobKeysRef.current).slice(-250);
              localStorage.setItem('fleet360_notified_job_keys', JSON.stringify(keysArr));
            } catch {}
          }

          for (const j of newlyAssignedJobs) {
            const st = (j.status || 'ASSIGNED').toUpperCase();
            const isReassigned = st === 'RE-ASSIGNED' || st === 'FCL_REASSIGN' || st === 'MT_REASSIGN';
            const assignPhase = isReassigned ? 'REASSIGN' : 'ASSIGN';
            const { pickupName, dropoffName } = getPickupAndDropoff(j);
            const notifTitle = isReassigned
              ? `🔄 Job Re-Assigned: ${j.jobCode}`
              : `🚛 New Job Assigned: ${j.jobCode}`;
            const notifBody = `Container ${j.containerNumber} (${j.containerSize}) · Trailer: ${
              j.assignedTrailerPlate || 'Assigned'
            } · ${pickupName} → ${dropoffName}`;
            showToast(`${notifTitle} — ${j.containerNumber} (${pickupName} → ${dropoffName})`);
            triggerMobileNotification(notifTitle, notifBody, `job-assign-${j.id}-${assignPhase}`);
          }

          // 2. Detect newly arrived Dispatcher messages (Broadcast or Individual)
          const allIncomingDispatcherMsgs: Array<DrayageChatMessage & { jobCodeLabel?: string }> = [];
          for (const b of fetchedBroadcasts) {
            if ((b.senderRole || '').toUpperCase() !== 'DRIVER') {
              allIncomingDispatcherMsgs.push({ ...b, isBroadcast: true, jobCodeLabel: 'ALL DRIVERS' });
            }
          }
          for (const j of fetched) {
            for (const m of j.messages || []) {
              if ((m.senderRole || '').toUpperCase() !== 'DRIVER' && !m.isBroadcast) {
                allIncomingDispatcherMsgs.push({ ...m, jobCodeLabel: j.jobCode });
              }
            }
          }

          if (!initialLoadDoneRef.current) {
            for (const m of allIncomingDispatcherMsgs) {
              seenMsgIdsRef.current.add(m.id);
              androidBridge?.markMsgIdNotified?.(m.id);
            }
            initialLoadDoneRef.current = true;
            if (typeof window !== 'undefined') {
              try {
                localStorage.setItem(
                  'fleet360_notified_msg_ids',
                  JSON.stringify(Array.from(seenMsgIdsRef.current).slice(-250)),
                );
              } catch {}
            }
          } else {
            const newlyArrived = allIncomingDispatcherMsgs.filter((m) => {
              if (seenMsgIdsRef.current.has(m.id)) return false;
              if (androidBridge?.isMsgIdNotified?.(m.id)) {
                seenMsgIdsRef.current.add(m.id);
                return false;
              }
              return true;
            });
            if (newlyArrived.length > 0) {
              for (const m of newlyArrived) {
                seenMsgIdsRef.current.add(m.id);
                androidBridge?.markMsgIdNotified?.(m.id);
              }
              if (typeof window !== 'undefined') {
                try {
                  localStorage.setItem(
                    'fleet360_notified_msg_ids',
                    JSON.stringify(Array.from(seenMsgIdsRef.current).slice(-250)),
                  );
                } catch {}
              }
              const latest = newlyArrived[newlyArrived.length - 1];
              const prefix = latest.isBroadcast
                ? '📢 Fleet Broadcast'
                : `💬 ${latest.jobCodeLabel || 'Dispatcher'}`;
              showToast(`${prefix}: "${latest.message}"`);
              triggerMobileNotification(
                latest.isBroadcast ? '📢 Port Operations Broadcast' : `💬 Dispatcher (${latest.jobCodeLabel})`,
                latest.message,
                `msg-${latest.id}`,
              );
            }
          }
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
    [getAuthHeaders, showToast, triggerMobileNotification],
  );

  useEffect(() => {
    void fetchDriverJobs(false);
    const interval = setInterval(() => {
      void fetchDriverJobs(true);
    }, 4000);
    const onVisibleOrFocus = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void fetchDriverJobs(true);
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onVisibleOrFocus);
      document.addEventListener('visibilitychange', onVisibleOrFocus);
    }
    return () => {
      clearInterval(interval);
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', onVisibleOrFocus);
        document.removeEventListener('visibilitychange', onVisibleOrFocus);
      }
    };
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

  const hasActiveL2Job = useMemo(
    () =>
      activeJobs.some(
        (j) =>
          (j.jobPhase === 'L2' || Boolean(j.jobCode && j.jobCode.includes('-L2'))) &&
          !HISTORY_STATUSES.has((j.status || '').toUpperCase()),
      ),
    [activeJobs],
  );

  const isJobInactiveWaitingForL2 = useCallback(
    (job: DrayageAssignment) => {
      const st = (job.status || 'ASSIGNED').toUpperCase();
      if (HISTORY_STATUSES.has(st)) return false;
      const isL2 = job.jobPhase === 'L2' || Boolean(job.jobCode && job.jobCode.includes('-L2'));
      const isReassign =
        st === 'RE-ASSIGNED' ||
        st === 'FCL_REASSIGN' ||
        st === 'MT_REASSIGN' ||
        st === 'TRAILER_ATTACHED' ||
        st === 'REASSIGN_PLACED_AT_RAMP' ||
        st === 'REASSIGN_PLACED_AT_YARD';
      return !isL2 && !isReassign && hasActiveL2Job;
    },
    [hasActiveL2Job],
  );

  const selectedJob = useMemo(
    () => jobs.find((j) => j.id === selectedJobId) || null,
    [jobs, selectedJobId],
  );

  const handleStatusUpdate = async (
    job: DrayageAssignment,
    newStatus: string,
    etcIsoString: string | null = null,
    overrideSig: EpodSignatureInfo | null = null,
  ) => {
    if (isJobInactiveWaitingForL2(job)) {
      showToast('Please complete your active L2 job first to activate this L1 job.');
      return;
    }
    setSubmitting(true);
    try {
      const upperTarget = newStatus.toUpperCase();
      const isFinishingDriverLeg = HISTORY_STATUSES.has(upperTarget);
      const effectiveTargetStatus = ['CONTAINER_DROPPED', 'EMPTY_DEPOSITED', 'CONTAINER_DELIVERED'].includes(
        upperTarget,
      )
        ? 'COMPLETED'
        : newStatus;
      const placementLocation = newStatus.includes('RAMP')
        ? 'RAMP'
        : newStatus.includes('YARD')
        ? 'YARD'
        : undefined;

      const activeSig = overrideSig || epodSignatures[job.id] || null;
      const receiverLabel = activeSig
        ? `${activeSig.receiverName}${activeSig.receiverRole ? ` (${activeSig.receiverRole})` : ''}`
        : undefined;

      const isL2Job = job.jobPhase === 'L2' || Boolean(job.jobCode && job.jobCode.includes('-L2'));
      const tLat = job.terminalGeofence?.lat ?? 25.0112;
      const tLng = job.terminalGeofence?.lng ?? 55.0612;
      const wLat = job.warehouseGeofence?.lat ?? 24.9642;
      const wLng = job.warehouseGeofence?.lng ?? 55.0915;
      const cLat = Number(((tLat + wLat) / 2).toFixed(4));
      const cLng = Number(((tLng + wLng) / 2).toFixed(4));

      let stageFacility = job.terminalName || 'DPW-Jebel Ali-T1';
      let fallbackLat = tLat;
      let fallbackLng = tLng;

      if (isL2Job) {
        if (['ACCEPTED', 'CONTAINER_PICKED', 'TRAILER_ATTACHED'].includes(upperTarget)) {
          stageFacility = job.warehouseName || 'Consignee Warehouse';
          fallbackLat = wLat;
          fallbackLng = wLng;
        } else if (['EN_ROUTE_TERMINAL', 'IN_TRANSIT'].includes(upperTarget)) {
          stageFacility = `E11 Corridor → ${job.terminalName || 'Port Terminal'}`;
          fallbackLat = cLat;
          fallbackLng = cLng;
        } else {
          stageFacility = job.terminalName || 'DPW-Jebel Ali-T1';
          fallbackLat = tLat;
          fallbackLng = tLng;
        }
      } else {
        if (
          [
            'ACCEPTED',
            'ARRIVED_AT_PORT',
            'AT_PORT',
            'CONTAINER_PICKED',
            'LOADED',
            'UNDER_INSPECTION',
          ].includes(upperTarget)
        ) {
          stageFacility = job.terminalName || 'DPW-Jebel Ali-T1';
          fallbackLat = tLat;
          fallbackLng = tLng;
        } else if (['EN_ROUTE_WAREHOUSE', 'IN_TRANSIT'].includes(upperTarget)) {
          stageFacility = `E11 Corridor → ${job.warehouseName || 'Consignee Warehouse'}`;
          fallbackLat = cLat;
          fallbackLng = cLng;
        } else {
          stageFacility = job.warehouseName || 'Consignee Warehouse';
          fallbackLat = wLat;
          fallbackLng = wLng;
        }
      }

      const liveCoords = driverCoordsRef.current;
      const finalLat = liveCoords?.lat ?? fallbackLat;
      const finalLng = liveCoords?.lng ?? fallbackLng;
      const capturedLocation = `${stageFacility} (${finalLat.toFixed(4)}, ${finalLng.toFixed(4)})`;

      // Optimistic local state update so UI responds immediately
      setJobs((prev) =>
        prev.map((j) =>
          j.id === job.id
            ? {
                ...j,
                status: effectiveTargetStatus,
                placementLocation: placementLocation || j.placementLocation,
                trailerDetached: isFinishingDriverLeg ? true : newStatus === 'TRAILER_ATTACHED' ? false : j.trailerDetached,
                etcTime: etcIsoString || j.etcTime,
                podSignatureName: receiverLabel || j.podSignatureName,
                podPhotoUrl: activeSig?.signatureDataUri || j.podPhotoUrl,
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
          receiverName: receiverLabel,
          signatureDataUri: activeSig?.signatureDataUri || undefined,
          latitude: finalLat,
          longitude: finalLng,
          location: capturedLocation,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        showToast(errData?.error || 'Could not update status on server — retrying sync.');
      } else {
        if (isFinishingDriverLeg) {
          showToast(`Job ${job.jobCode} COMPLETED & moved to History!`);
          setSelectedJobId(null);
        } else {
          showToast(`Status updated to ${effectiveTargetStatus.replace(/_/g, ' ')}`);
        }
      }

      await fetchDriverJobs(true);
    } catch {
      showToast('Network error while updating status.');
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Prompts for Receiver Sign-on-Glass ePOD Signature strictly at Container Delivery / Ramp Delivery
   * (PLACED_AT_RAMP or REASSIGN_PLACED_AT_RAMP) if not signed yet.
   */
  const handleActionWithEpodCheck = (
    job: DrayageAssignment,
    targetStatus: string,
    label: string,
  ) => {
    const upper = targetStatus.toUpperCase();
    const isL2Job = job.jobPhase === 'L2' || Boolean(job.jobCode && job.jobCode.includes('-L2'));
    const isRampTarget = upper === 'PLACED_AT_RAMP' || upper === 'REASSIGN_PLACED_AT_RAMP';
    const isEpodDeliveryMilestone = !isL2Job && isRampTarget;

    const hasSignedAlready = Boolean(epodSignatures[job.id] || job.podSignatureName);

    if (isEpodDeliveryMilestone && !hasSignedAlready) {
      openSignatureModalFresh({
        targetStatus,
        label,
        requireEtcModal: isRampTarget,
      });
      return;
    }

    if (isRampTarget) {
      openEtcModalWithDefaults(targetStatus);
      return;
    }

    void handleStatusUpdate(job, targetStatus);
  };

  const getPointerCoordsInSvg = (e: React.PointerEvent<SVGSVGElement>): { x: number; y: number } => {
    const svg = sigSvgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const scaleX = 340 / (rect.width || 340);
    const scaleY = 190 / (rect.height || 190);
    return {
      x: Math.max(0, Math.min(340, (e.clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.min(190, (e.clientY - rect.top) * scaleY)),
    };
  };

  const handleSigPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    isDrawingSigRef.current = true;
    const pt = getPointerCoordsInSvg(e);
    sigCurrentStrokeRef.current = [pt];
    setSigCurrentStroke([pt]);
  };

  const handleSigPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isDrawingSigRef.current) return;
    e.preventDefault();
    const pt = getPointerCoordsInSvg(e);
    sigCurrentStrokeRef.current = [...sigCurrentStrokeRef.current, pt];
    setSigCurrentStroke([...sigCurrentStrokeRef.current]);
  };

  const handleSigPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isDrawingSigRef.current) return;
    e.preventDefault();
    isDrawingSigRef.current = false;
    if (sigCurrentStrokeRef.current.length > 0) {
      const finished = sigCurrentStrokeRef.current;
      setSigStrokes((prev) => [...prev, finished]);
      sigCurrentStrokeRef.current = [];
      setSigCurrentStroke([]);
    }
  };

  const clearSignaturePad = () => {
    isDrawingSigRef.current = false;
    sigCurrentStrokeRef.current = [];
    setSigCurrentStroke([]);
    setSigStrokes([]);
  };

  const handleConfirmSignaturePad = async () => {
    if (!selectedJob) return;
    const trimmedName = sigReceiverName.trim();
    if (!trimmedName) {
      showToast('Please enter Receiver Full Name before confirming ePOD signature.');
      return;
    }
    const allStrokes = sigCurrentStroke.length > 0 ? [...sigStrokes, sigCurrentStroke] : sigStrokes;
    if (allStrokes.length === 0) {
      showToast('Please ask the receiver to sign inside the signature box using their finger.');
      return;
    }

    const isL2Job = selectedJob.jobPhase === 'L2' || Boolean(selectedJob.jobCode?.includes('-L2'));
    const epodCode = isL2Job || selectedJob.shipmentType === 'EXPORT' ? 'MT_DELIVERED' : 'FCL_DELIVERED';
    const statusLabel = pendingActionAfterSign?.label || epodCode;

    const signatureDataUri = buildSignatureSvgDataUri({
      strokes: allStrokes,
      receiverName: trimmedName,
      receiverRole: sigReceiverRole.trim(),
      jobNumber: selectedJob.jobCode,
      containerNumber: selectedJob.containerNumber,
      statusLabel,
    });

    const capturedSig: EpodSignatureInfo = {
      receiverName: trimmedName,
      receiverRole: sigReceiverRole.trim(),
      signatureDataUri,
      signedAt: new Date().toISOString(),
    };

    setEpodSignatures((prev) => ({
      ...prev,
      [selectedJob.id]: capturedSig,
    }));

    const receiverDisplay = `${trimmedName}${sigReceiverRole.trim() ? ` (${sigReceiverRole.trim()})` : ''}`;
    setJobs((prev) =>
      prev.map((j) =>
        j.id === selectedJob.id
          ? {
              ...j,
              podSignatureName: receiverDisplay,
              podPhotoUrl: signatureDataUri,
              podSignedAt: capturedSig.signedAt,
            }
          : j,
      ),
    );

    const pending = pendingActionAfterSign;
    setShowSignatureModal(false);
    setPendingActionAfterSign(null);
    setSigReceiverName('');
    setSigReceiverRole('');
    clearSignaturePad();

    // If triggered by a delivery/placement button, proceed to ETC modal (for Ramp) or status update
    if (pending) {
      if (pending.requireEtcModal) {
        // Also persist the ePOD signature immediately so it is saved while choosing ETC hours
        try {
          await fetch(getApiEndpoint(`/api/driver/jobs/${selectedJob.id}/status`), {
            method: 'POST',
            credentials: 'include',
            headers: getAuthHeaders(),
            body: JSON.stringify({
              action: 'EPOD_SIGN',
              receiverName: receiverDisplay,
              signatureDataUri,
              notes: `Sign-on-Glass ePOD (${epodCode}) captured for ${pending.label}`,
              driverName,
            }),
          });
        } catch {}
        openEtcModalWithDefaults(pending.targetStatus);
        return;
      }
      await handleStatusUpdate(selectedJob, pending.targetStatus, null, capturedSig);
      return;
    }

    // Standalone ePOD signature capture
    try {
      await fetch(getApiEndpoint(`/api/driver/jobs/${selectedJob.id}/status`), {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          action: 'EPOD_SIGN',
          receiverName: receiverDisplay,
          signatureDataUri,
          notes: `Sign-on-Glass ePOD (${epodCode}) signed by ${receiverDisplay}`,
          driverName,
        }),
      });
      showToast(`✅ Sign-on-Glass ePOD (${epodCode}) saved for ${selectedJob.jobCode}`);
    } catch {
      showToast(`Saved ePOD signature locally for ${selectedJob.jobCode}`);
    }
  };

  const handleSkipSignatureAndProceed = async () => {
    if (!selectedJob) return;
    const pending = pendingActionAfterSign;
    setShowSignatureModal(false);
    setPendingActionAfterSign(null);
    if (!pending) return;

    if (pending.requireEtcModal) {
      openEtcModalWithDefaults(pending.targetStatus);
      return;
    }
    await handleStatusUpdate(selectedJob, pending.targetStatus);
  };

  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedJob || !chatInput.trim()) return;
    const msgText = chatInput.trim();
    setSendingChat(true);
    try {
      const optimisticMsg: DrayageChatMessage = {
        id: 'temp-' + Date.now(),
        senderRole: 'DRIVER',
        senderName: driverName || 'Assigned Driver',
        message: msgText,
        isUrgent: false,
        createdAt: new Date().toISOString(),
      };
      setJobs((prev) =>
        prev.map((j) =>
          j.id === selectedJob.id
            ? { ...j, messages: [...(j.messages || []), optimisticMsg] }
            : j,
        ),
      );
      setChatInput('');

      const res = await fetch(getApiEndpoint(`/api/driver/jobs/${selectedJob.id}/status`), {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          action: 'CHAT',
          message: msgText,
          driverName: driverName || 'Assigned Driver',
          isUrgent: false,
        }),
      });
      if (res.ok) {
        showToast('Reply sent to Dispatcher');
        await fetchDriverJobs(true);
      } else {
        showToast('Could not send reply — will retry on sync');
      }
    } catch {
      showToast('Network error sending reply');
    } finally {
      setSendingChat(false);
    }
  };

  const handleSelectEtcHours = async (hours: number) => {
    if (!selectedJob) return;
    setShowEtcModal(false);
    const etcDate = new Date(Date.now() + hours * 60 * 60 * 1000);
    await handleStatusUpdate(selectedJob, pendingRampStatus, etcDate.toISOString());
  };

  const handleConfirmCustomEtc = async () => {
    if (!selectedJob) return;
    if (!customEtcDate || !customEtcTime) {
      showToast('Please select both Custom Date and Time for Offloading ETC.');
      return;
    }
    const parsed = new Date(`${customEtcDate}T${customEtcTime}:00`);
    if (isNaN(parsed.getTime())) {
      showToast('Invalid Custom Date or Time selected.');
      return;
    }
    setShowEtcModal(false);
    await handleStatusUpdate(selectedJob, pendingRampStatus, parsed.toISOString());
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
      const w = window as unknown as {
        Fleet360Android?: { stopBackgroundService?: () => void };
      };
      w.Fleet360Android?.stopBackgroundService?.();
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
    const isL2Selected =
      selectedJob.jobPhase === 'L2' || Boolean(selectedJob.jobCode && selectedJob.jobCode.includes('-L2'));
    const epodDeliveryStatusCode =
      isL2Selected || selectedJob.shipmentType === 'EXPORT' ? 'MT_DELIVERED' : 'FCL_DELIVERED';
    const localSignedEpod = epodSignatures[selectedJob.id] || null;
    const isEpodSigned = Boolean(localSignedEpod || selectedJob.podSignatureName);
    const signedReceiverDisplay =
      localSignedEpod
        ? `${localSignedEpod.receiverName}${localSignedEpod.receiverRole ? ` • ${localSignedEpod.receiverRole}` : ''}`
        : selectedJob.podSignatureName || '';
    const signedEpodImage = localSignedEpod?.signatureDataUri || selectedJob.podPhotoUrl || null;
    const allRenderSigStrokes =
      sigCurrentStroke.length > 0 ? [...sigStrokes, sigCurrentStroke] : sigStrokes;

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

                {/* Sign-on-Glass ePOD Receiver Signature Section — Shown strictly at Container / Ramp Delivery */}
                {!isL2Selected &&
                  ((['EN_ROUTE_WAREHOUSE', 'PLACED_AT_RAMP', 'REASSIGN_PLACED_AT_RAMP'].includes(
                    (selectedJob.status || '').toUpperCase(),
                  ) ||
                    ((selectedJob.status || '').toUpperCase() === 'TRAILER_ATTACHED' &&
                      (selectedJob.placementLocation || '').toUpperCase() !== 'RAMP')) ||
                    isEpodSigned) && (
                    <div className="pt-1 border-t border-slate-100">
                      {isEpodSigned ? (
                        <div className="bg-emerald-50 border border-emerald-300 rounded-xl p-3 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-xs font-extrabold text-emerald-800">
                              ✅ ePOD Signed ({epodDeliveryStatusCode})
                            </div>
                            <div className="text-[11px] font-semibold text-emerald-700 truncate mt-0.5">
                              Receiver: {signedReceiverDisplay}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => openSignatureModalFresh(null)}
                            className="shrink-0 px-2.5 py-1.5 rounded-lg bg-white border border-emerald-300 text-emerald-800 font-bold text-[11px] hover:bg-emerald-100 transition"
                          >
                            Re-Sign
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => openSignatureModalFresh(null)}
                          className="w-full py-3 px-3 rounded-xl bg-emerald-50 hover:bg-emerald-100 border-2 border-dashed border-emerald-600 text-emerald-800 font-extrabold text-xs text-center transition active:scale-95"
                        >
                          ✍️ Capture Receiver Sign-on-Glass ({epodDeliveryStatusCode})
                        </button>
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
                        handleActionWithEpodCheck(
                          selectedJob,
                          isReassignJob ? 'REASSIGN_PLACED_AT_YARD' : 'PLACED_AT_YARD',
                          'Placed @ Yard',
                        )
                      }
                      className="py-3.5 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-white font-extrabold text-sm shadow-md transition active:scale-95 disabled:opacity-50"
                    >
                      Placed @ Yard
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() =>
                        handleActionWithEpodCheck(
                          selectedJob,
                          isReassignJob ? 'REASSIGN_PLACED_AT_RAMP' : 'PLACED_AT_RAMP',
                          'Placed @ Ramp',
                        )
                      }
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
                    onClick={() =>
                      handleActionWithEpodCheck(selectedJob, nextStep.nextStatus, nextStep.label)
                    }
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

          {/* 2B. Dispatcher <-> Driver Communications Card */}
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-blue-200 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div className="text-xs font-extrabold uppercase tracking-wider text-blue-700 flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-blue-600" />
                <span>Dispatcher ↔ Driver Messages</span>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                {(selectedJob.messages || []).length}{' '}
                {(selectedJob.messages || []).length === 1 ? 'Message' : 'Messages'}
              </span>
            </div>

            <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
              {!selectedJob.messages || selectedJob.messages.length === 0 ? (
                <div className="py-4 text-center text-xs text-slate-400">
                  No dispatcher instructions yet for this job. You can send a message to Port Operations Desk below.
                </div>
              ) : (
                selectedJob.messages.map((msg) => {
                  const isDriver = (msg.senderRole || '').toUpperCase() === 'DRIVER';
                  return (
                    <div
                      key={msg.id}
                      className={`p-3 rounded-xl text-xs space-y-1 ${
                        isDriver
                          ? 'bg-slate-100 border border-slate-200 text-slate-900 ml-6'
                          : msg.isUrgent
                          ? 'bg-rose-50 border-2 border-rose-400 text-slate-900 mr-6'
                          : 'bg-blue-600 text-white mr-6 shadow-sm'
                      }`}
                    >
                      <div
                        className={`flex items-center justify-between gap-2 text-[10px] font-bold ${
                          isDriver ? 'text-slate-500' : msg.isUrgent ? 'text-rose-700' : 'text-blue-100'
                        }`}
                      >
                        <span>{msg.senderName || (isDriver ? driverName : 'Port Operations Desk')}</span>
                        <span>
                          {msg.createdAt
                            ? new Date(msg.createdAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : ''}
                        </span>
                      </div>
                      <p className="text-xs font-semibold leading-relaxed">{msg.message}</p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {msg.isBroadcast && (
                          <span className="inline-block px-2 py-0.5 rounded text-[9px] font-extrabold bg-amber-400 text-slate-950 uppercase">
                            📢 BROADCAST TO ALL DRIVERS
                          </span>
                        )}
                        {msg.isUrgent && (
                          <span className="inline-block px-2 py-0.5 rounded text-[9px] font-extrabold bg-rose-600 text-white uppercase">
                            URGENT INSTRUCTION
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <form onSubmit={handleSendChatMessage} className="flex items-center gap-2 pt-2 border-t border-slate-100">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Reply to Port Operations Desk..."
                className="flex-1 text-xs px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 font-medium focus:outline-none focus:border-blue-500"
              />
              <button
                type="submit"
                disabled={sendingChat || !chatInput.trim()}
                className="px-3.5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center gap-1 shadow-sm transition active:scale-95 disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send</span>
              </button>
            </form>
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
              <span className="text-slate-500 font-medium">Customer</span>
              <span className="font-bold text-slate-900 text-right">
                {selectedJob.customerName || 'N/A'}
              </span>
            </div>

            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500 font-medium">Client</span>
              <span className="font-bold text-slate-900 text-right">
                {selectedJob.clientName || selectedJob.warehouseName || 'N/A'}
              </span>
            </div>

            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500 font-medium">Client Destination</span>
              <span className="font-bold text-slate-900 text-right">
                {selectedJob.clientDestination || selectedJob.warehouseName || 'N/A'}
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

            {isEpodSigned && (
              <div className="py-2 border-b border-slate-100 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">ePOD Signature</span>
                  <span className="font-extrabold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded text-xs">
                    ✓ {signedReceiverDisplay}
                  </span>
                </div>
                {signedEpodImage && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-2 flex justify-center">
                    <img
                      src={signedEpodImage}
                      alt="Signed ePOD"
                      className="max-h-36 w-auto rounded-lg object-contain"
                    />
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

        {/* LogiXL-Connect ETC Modal (Quick Presets + Custom Date & Time Picker) */}
        {showEtcModal && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl p-5 max-w-sm w-full shadow-2xl space-y-4">
              <div className="text-center space-y-1">
                <div className="w-11 h-11 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto">
                  <Clock className="w-5 h-5" />
                </div>
                <h3 className="text-base font-extrabold text-slate-900">
                  Estimated Completion Time (ETC)
                </h3>
                <p className="text-xs text-slate-500">
                  When do you expect warehouse loading / unloading at the ramp to finish?
                </p>
              </div>

              {/* Custom Date & Time Inputs */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-3">
                <div className="text-[11px] font-extrabold uppercase tracking-wider text-blue-700">
                  Custom Date &amp; Time
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      Date
                    </label>
                    <input
                      type="date"
                      value={customEtcDate}
                      onChange={(e) => setCustomEtcDate(e.target.value)}
                      className="w-full px-2.5 py-2 rounded-xl bg-white border border-slate-300 text-xs font-bold text-slate-900 focus:outline-none focus:border-blue-600"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      Time (AM / PM)
                    </label>
                    <input
                      type="time"
                      value={customEtcTime}
                      onChange={(e) => setCustomEtcTime(e.target.value)}
                      className="w-full px-2.5 py-2 rounded-xl bg-white border border-slate-300 text-xs font-bold text-slate-900 focus:outline-none focus:border-blue-600"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleConfirmCustomEtc()}
                  className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs shadow transition active:scale-95"
                >
                  Confirm Custom Date &amp; Time
                </button>
              </div>

              {/* Quick Duration Presets */}
              <div className="space-y-1.5">
                <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 text-center">
                  Or Quick Select Duration
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[1, 2, 3, 4].map((hrs) => (
                    <button
                      key={hrs}
                      type="button"
                      onClick={() => void handleSelectEtcHours(hrs)}
                      className="py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-extrabold text-xs shadow transition active:scale-95"
                    >
                      +{hrs} {hrs === 1 ? 'Hr' : 'Hrs'}
                    </button>
                  ))}
                </div>
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

        {/* Sign-on-Glass ePOD Signature Pad Modal (LogiXL-Connect SignaturePadModal.js parity) */}
        {showSignatureModal && (
          <div key={sigModalKey} className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl p-5 max-w-md w-full shadow-2xl space-y-3.5">
              {/* Header */}
              <div className="flex items-start justify-between border-b border-slate-100 pb-2.5">
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">
                    ✍️ Sign-on-Glass ePOD ({epodDeliveryStatusCode})
                  </h3>
                  <p className="text-xs text-slate-500 font-semibold mt-0.5">
                    {pendingActionAfterSign?.label || epodDeliveryStatusCode} · {selectedJob.jobCode} ·{' '}
                    {selectedJob.containerNumber}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowSignatureModal(false);
                    setPendingActionAfterSign(null);
                  }}
                  className="p-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Receiver Full Name & Role/ID Inputs */}
              <div className="grid grid-cols-3 gap-2.5">
                <div className="col-span-2">
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    Receiver Full Name *
                  </label>
                  <input
                    type="text"
                    name={`receiver_name_${sigModalKey}`}
                    autoComplete="off"
                    value={sigReceiverName}
                    onChange={(e) => setSigReceiverName(e.target.value)}
                    placeholder="e.g. Ahmed Al-Mansoor"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-300 text-xs font-bold text-slate-900 focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    Role / ID (Opt)
                  </label>
                  <input
                    type="text"
                    name={`receiver_role_${sigModalKey}`}
                    autoComplete="off"
                    value={sigReceiverRole}
                    onChange={(e) => setSigReceiverRole(e.target.value)}
                    placeholder="e.g. Ramp Supv"
                    className="w-full px-2.5 py-2 rounded-xl bg-slate-50 border border-slate-300 text-xs font-bold text-slate-900 focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              {/* Touch Signature Box */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-600">
                    Touch Signature Box (Sign with Finger)
                  </span>
                  <button
                    type="button"
                    onClick={clearSignaturePad}
                    className="text-xs font-extrabold text-rose-600 hover:text-rose-700"
                  >
                    Clear Pad
                  </button>
                </div>

                <div className="relative rounded-xl border-2 border-blue-500 bg-slate-50 overflow-hidden select-none touch-none">
                  <svg
                    ref={sigSvgRef}
                    viewBox="0 0 340 190"
                    className="w-full h-44 touch-none cursor-crosshair block"
                    onPointerDown={handleSigPointerDown}
                    onPointerMove={handleSigPointerMove}
                    onPointerUp={handleSigPointerUp}
                    onPointerCancel={handleSigPointerUp}
                  >
                    {/* Baseline */}
                    <line
                      x1="18"
                      y1="158"
                      x2="322"
                      y2="158"
                      stroke="#cbd5e1"
                      strokeDasharray="4,4"
                      strokeWidth="1.5"
                    />
                    {allRenderSigStrokes.length === 0 && (
                      <text
                        x="170"
                        y="102"
                        textAnchor="middle"
                        fill="#cbd5e1"
                        fontSize="24"
                        fontWeight="800"
                      >
                        Sign Here
                      </text>
                    )}
                    {allRenderSigStrokes.map((pts, sIdx) => {
                      if (pts.length === 0) return null;
                      if (pts.length === 1) {
                        return (
                          <circle
                            key={`dot-${sIdx}`}
                            cx={pts[0].x}
                            cy={pts[0].y}
                            r="2.2"
                            fill="#0f172a"
                          />
                        );
                      }
                      const d = pts
                        .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
                        .join(' ');
                      return (
                        <path
                          key={`stroke-${sIdx}`}
                          d={d}
                          stroke="#0f172a"
                          strokeWidth="3"
                          fill="none"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      );
                    })}
                  </svg>
                </div>
                <p className="text-[10px] text-slate-400">
                  By signing above, receiver acknowledges container condition &amp; seal integrity at{' '}
                  {selectedJob.warehouseName || selectedJob.terminalName}.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  onClick={() => void handleConfirmSignaturePad()}
                  className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs shadow-md transition active:scale-95"
                >
                  ✍️ Confirm &amp; Save ePOD Signature
                </button>

                {pendingActionAfterSign && (
                  <button
                    type="button"
                    onClick={() => void handleSkipSignatureAndProceed()}
                    className="w-full py-2.5 rounded-xl bg-amber-100 hover:bg-amber-200 border border-amber-300 text-amber-900 font-bold text-xs transition"
                  >
                    Confirm {pendingActionAfterSign.label} Without Signature →
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setShowSignatureModal(false);
                    setPendingActionAfterSign(null);
                  }}
                  className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs"
                >
                  Cancel
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
  const activeBroadcasts = broadcastMessages.filter((b) => !dismissedBroadcastIds.includes(b.id));

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
              onClick={() => setShowNotificationsPanel((prev) => !prev)}
              title="Dispatcher Broadcasts & Notifications"
              className="relative p-2.5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white transition active:scale-95"
            >
              <Bell className="w-4 h-4" />
              {activeBroadcasts.length > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-400 text-slate-950 font-black text-[10px] flex items-center justify-center shadow">
                  {activeBroadcasts.length}
                </span>
              )}
            </button>
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
        {/* Fleet-Wide Broadcast Notifications Banner */}
        {(activeBroadcasts.length > 0 || showNotificationsPanel) && (
          <div className="bg-amber-50 border-2 border-amber-400 rounded-2xl p-4 shadow-md space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-amber-900">
                <Bell className="w-4 h-4 text-amber-600" />
                <span>📢 Fleet Broadcast Notifications ({broadcastMessages.length})</span>
              </div>
              {showNotificationsPanel && (
                <button
                  type="button"
                  onClick={() => setShowNotificationsPanel(false)}
                  className="text-xs font-bold text-amber-800 hover:text-amber-950"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {(showNotificationsPanel ? broadcastMessages : activeBroadcasts).length === 0 ? (
              <div className="text-xs text-amber-800 py-2">
                No fleet broadcast announcements from Port Operations Desk yet.
              </div>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {(showNotificationsPanel ? [...broadcastMessages].reverse() : [...activeBroadcasts].reverse()).map(
                  (b) => (
                    <div
                      key={b.id}
                      className={`rounded-xl p-3 border text-xs space-y-1 ${
                        b.isUrgent
                          ? 'bg-rose-50 border-rose-300 text-rose-950'
                          : 'bg-white border-amber-200 text-slate-900'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-[10px] font-bold text-slate-500">
                        <span className="text-amber-900 font-extrabold">
                          📢 {b.senderName || 'Port Operations Desk'} · ALL DRIVERS
                        </span>
                        <span>
                          {b.createdAt
                            ? new Date(b.createdAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : ''}
                        </span>
                      </div>
                      <p className="text-xs font-bold leading-relaxed">{b.message}</p>
                      <div className="flex items-center justify-between pt-1">
                        <div>
                          {b.isUrgent && (
                            <span className="inline-block px-2 py-0.5 rounded bg-rose-600 text-white text-[9px] font-black uppercase">
                              URGENT BROADCAST
                            </span>
                          )}
                        </div>
                        {!dismissedBroadcastIds.includes(b.id) && (
                          <button
                            type="button"
                            onClick={() => handleDismissBroadcast(b.id)}
                            className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-extrabold text-[10px] transition"
                          >
                            Acknowledge ✓
                          </button>
                        )}
                      </div>
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
        )}
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
            const isInactiveL1 = viewMode === 'active' && isJobInactiveWaitingForL2(job);
            const badge = isInactiveL1
              ? {
                  bg: 'bg-slate-200 border-slate-400',
                  text: 'text-slate-700',
                  label: '⏳ INACTIVE · WAITING FOR L2',
                }
              : getStatusBadgeStyle(job.status);
            const nextStep = getNextStep(job);
            const { pickupName, pickupLat, pickupLng, dropoffName, dropoffLat, dropoffLng } =
              getPickupAndDropoff(job);

            return (
              <div
                key={job.id}
                className={`rounded-2xl p-4 shadow-sm border space-y-3 transition ${
                  isInactiveL1
                    ? 'bg-slate-100/90 border-slate-300 opacity-75'
                    : 'bg-white border-slate-200'
                }`}
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

                {isInactiveL1 && (
                  <div className="bg-amber-50 border border-amber-300 rounded-xl px-3 py-2 text-[11px] font-bold text-amber-900">
                    🔒 Inactive until L2 Job is completed — Complete your assigned L2 Empty Return job first to activate this L1 job.
                  </div>
                )}

                {/* Highlighted Yellow Trailer Box (LogiXL-Connect DashboardScreen parity) */}
                <div className="bg-amber-100 border border-amber-300 rounded-xl px-3 py-2 flex items-center justify-between">
                  <span className="text-xs font-extrabold text-amber-900">
                    🚛 TRAILER: {job.assignedTrailerPlate || 'Not Assigned'}
                  </span>
                  <span className="text-[11px] font-bold text-amber-800">
                    {job.jobPhase} · {job.shipmentType}
                  </span>
                </div>

                {/* Dispatcher Message Preview Banner (if Dispatcher sent instructions) */}
                {job.messages && job.messages.length > 0 && (() => {
                  const latestMsg = job.messages[job.messages.length - 1];
                  const hasUrgent = job.messages.some((m) => m.isUrgent);
                  return (
                    <button
                      type="button"
                      onClick={() => {
                        if (isInactiveL1) {
                          showToast('Complete your active L2 job first to activate this L1 job.');
                          return;
                        }
                        setSelectedJobId(job.id);
                      }}
                      className={`w-full text-left rounded-xl px-3 py-2.5 border transition flex items-start justify-between gap-2 ${
                        hasUrgent
                          ? 'bg-rose-50 border-rose-300 text-rose-950'
                          : 'bg-blue-50 border-blue-200 text-blue-950'
                      }`}
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-blue-700">
                          <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                          <span>{latestMsg.senderName || 'Port Operations Desk'}</span>
                          {hasUrgent && (
                            <span className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[9px] font-black">
                              URGENT
                            </span>
                          )}
                        </div>
                        <p className="text-xs font-bold truncate">
                          &ldquo;{latestMsg.message}&rdquo;
                        </p>
                      </div>
                      <span className="shrink-0 px-2 py-1 rounded-lg bg-blue-600 text-white text-[10px] font-extrabold">
                        {job.messages.length} {job.messages.length === 1 ? 'Msg' : 'Msgs'} →
                      </span>
                    </button>
                  );
                })()}

                {/* Core Details */}
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-semibold">Customer:</span>
                    <span className="font-bold text-slate-900 text-right">
                      {job.customerName || 'N/A'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-semibold">Client:</span>
                    <span className="font-bold text-slate-900 text-right">
                      {job.clientName || job.warehouseName || 'N/A'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-semibold">Client Destination:</span>
                    <span className="font-bold text-slate-900 text-right">
                      {job.clientDestination || job.warehouseName || 'N/A'}
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
                  onClick={() => {
                    if (isInactiveL1) {
                      showToast('Complete your active L2 job first to activate this L1 job.');
                      return;
                    }
                    setSelectedJobId(job.id);
                  }}
                  className={`w-full py-3 rounded-xl font-extrabold text-sm shadow transition flex items-center justify-center gap-2 ${
                    isInactiveL1
                      ? 'bg-slate-300 text-slate-600 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-500 text-white active:scale-95'
                  }`}
                >
                  <span>
                    {isInactiveL1
                      ? '🔒 Inactive — Complete L2 Job First'
                      : nextStep
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
