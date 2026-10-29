'use client';

/**
 * src/components/logistics/drayage/DrayageCorridorLiveMap.tsx
 *
 * DrayageCorridorLiveMap — High-Performance Real-Time Telematics & Corridor Tracking Map.
 *
 * Core Capabilities:
 *   1. Major UAE Freight Corridors (E11, E311, E611, D53 Yalayis, D57 Expo Rd) with neon corridor glows.
 *   2. Port Terminals (DP World T1, T2, T3, AD Ports Khalifa Port) with interactive circular/polygon geofences & TAS status.
 *   3. Inland Logistics Zones & Warehouses (JAFZA South, NIP, Dubai South DWC, Al Quoz, KEZAD) with ramp markers.
 *   4. Active Prime Mover GPS Tracking with operational layers:
 *      - Laden FCL (L1): Blue tractor with container badge & speed
 *      - Empty Return (L2): Amber tractor with MT return badge
 *      - Dual-20FT Bogie: Indigo double-container pin with 36T payload weight meter & pairing tether
 *      - Street-Turn Triangulation: Emerald pin with curved inland triangulation flightpath & deadhead saved badge
 *      - Detached Trailer at Ramp: Purple chassis icon at warehouse ramp with live ETC timer countdown
 *   5. Interactive InfoWindow & Telematics Drawer with vehicle telemetry, DO expiry, EDI check, and quick dispatch actions.
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  loadGoogleMaps,
  type GMapsMap,
  type GMapsMarker,
  type GMapsPolyline,
  type GMapsCircle,
  type GMapsPolygon,
  type GMapsInfoWindow,
  type GoogleCtors,
  type GMapsLatLng,
} from '@/lib/google-maps-loader';
import {
  Navigation,
  ShieldCheck,
  Clock,
  RefreshCw,
  Send,
  AlertTriangle,
  Search,
  X,
} from 'lucide-react';

export interface DrayageCorridorJob {
  id: string;
  jobCode: string;
  jobPhase: 'L1' | 'L2';
  parentJobId?: string | null;
  shipmentType: string;
  status: string;
  priority: string;
  customerName: string;
  warehouseName: string;
  terminalName: string;
  containerNumber: string;
  containerSize: string;
  containerType: string;
  tokenNumber?: string | null;
  assignedVehiclePlate?: string | null;
  assignedDriverName?: string | null;
  assignedTrailerPlate?: string | null;
  placementLocation?: 'RAMP' | 'YARD' | null;
  trailerDetached?: boolean;
  l2Activated?: boolean;
  etcTime?: string | null;
  currentLat?: number | null;
  currentLng?: number | null;
  rateAmountAed: number;
  driverAllowanceAed?: number;
  cargoWeightKg?: number;
  shippingLine?: string;
  bogieJobId?: string | null;
  streetTurnJobId?: string | null;
  doExpiryDate?: string | null;
}

export interface DrayageCorridorTerminal {
  id: string;
  name: string;
  code: string;
  portName: string;
  emirate: string;
  lat: number;
  lng: number;
  geofenceRadiusMeters: number;
}

export interface DrayageCorridorWarehouse {
  id: string;
  name: string;
  zone: string;
  lat?: number;
  lng?: number;
  customerName?: string;
  rampsCount?: number;
}

export interface DrayageCorridorGeofence {
  id: string;
  terminalId: string | null;
  terminalName: string;
  name: string;
  type: 'CIRCLE' | 'POLYGON';
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  coordinatesJson?: string;
}

export interface DrayageCorridorVehicle {
  id: string;
  plateNumber: string;
  make: string;
  model: string;
  status: string;
  assignedDriverName?: string | null;
  activeJobCode?: string | null;
  lat: number;
  lng: number;
  fuelLevelPct?: number | null;
}

interface DrayageCorridorLiveMapProps {
  jobs: DrayageCorridorJob[];
  terminals: DrayageCorridorTerminal[];
  warehouses: DrayageCorridorWarehouse[];
  geofences: DrayageCorridorGeofence[];
  vehicles: DrayageCorridorVehicle[];
  selectedJobId?: string | null;
  onSelectJob?: (jobId: string) => void;
  onAdvanceStage?: (status: string) => void;
  onVerifyEdi?: (provider: 'DUBAI_TRADE_DPWORLD' | 'AD_PORTS_MAQTA') => void;
  onOpenChat?: (jobId: string) => void;
  className?: string;
  fullHeight?: boolean;
}

// UAE Heavy Freight Corridors (Geographic Highway Polylines)
export interface FreightCorridorDef {
  id: string;
  name: string;
  code: string;
  color: string;
  weight: number;
  speedLimitKmh: number;
  description: string;
  path: Array<{ lat: number; lng: number }>;
}

export const UAE_FREIGHT_CORRIDORS: FreightCorridorDef[] = [
  {
    id: 'e11',
    code: 'E11',
    name: 'Sheikh Zayed Rd (E11 Maritime Spine)',
    color: '#3B82F6', // Blue
    weight: 5,
    speedLimitKmh: 80,
    description: 'Primary container artery connecting DP World Jebel Ali to JAFZA North & South, Ghantoot & AD Ports Khalifa Port.',
    path: [
      { lat: 25.0450, lng: 55.1100 },
      { lat: 25.0220, lng: 55.0820 },
      { lat: 25.0040, lng: 55.0620 },
      { lat: 24.9810, lng: 55.0380 },
      { lat: 24.9450, lng: 55.0020 },
      { lat: 24.8950, lng: 54.9350 },
      { lat: 24.8450, lng: 54.8250 },
      { lat: 24.8050, lng: 54.7350 },
      { lat: 24.7865, lng: 54.6950 },
    ],
  },
  {
    id: 'e311',
    code: 'E311',
    name: 'Sheikh Mohammed Bin Zayed Rd (E311 Central Spine)',
    color: '#10B981', // Emerald
    weight: 4.5,
    speedLimitKmh: 80,
    description: 'Inland heavy freight spine passing National Industries Park (NIP), DIP and linking to Al Quoz industrial yards.',
    path: [
      { lat: 24.8950, lng: 55.1250 },
      { lat: 24.9350, lng: 55.1500 },
      { lat: 24.9680, lng: 55.1720 },
      { lat: 25.0080, lng: 55.2050 },
      { lat: 25.0580, lng: 55.2480 },
      { lat: 25.1120, lng: 55.2950 },
      { lat: 25.1650, lng: 55.3520 },
    ],
  },
  {
    id: 'e611',
    code: 'E611',
    name: 'Emirates Road (E611 Heavy Truck Bypass)',
    color: '#F59E0B', // Amber
    weight: 4.5,
    speedLimitKmh: 80,
    description: 'Mandatory heavy vehicle and hazardous cargo bypass circumventing metropolitan Dubai, connecting DWC to Northern Emirates.',
    path: [
      { lat: 24.8550, lng: 55.1650 },
      { lat: 24.9120, lng: 55.2150 },
      { lat: 24.9650, lng: 55.2650 },
      { lat: 25.0250, lng: 55.3220 },
      { lat: 25.0850, lng: 55.3780 },
      { lat: 25.1520, lng: 55.4380 },
    ],
  },
  {
    id: 'd53',
    code: 'D53',
    name: 'Al Yalayis Street (D53 Port Connector)',
    color: '#818CF8', // Indigo
    weight: 4,
    speedLimitKmh: 80,
    description: 'Critical East-West heavy haul link connecting Jebel Ali Port Gate 3 directly across to NIP, E311 and E611.',
    path: [
      { lat: 25.0080, lng: 55.0620 },
      { lat: 25.0120, lng: 55.0800 },
      { lat: 25.0010, lng: 55.1280 },
      { lat: 24.9880, lng: 55.1820 },
      { lat: 24.9720, lng: 55.2700 },
    ],
  },
  {
    id: 'd57',
    code: 'D57 / E77',
    name: 'Expo Road (D57 Cargo Mega Link)',
    color: '#A855F7', // Purple
    weight: 4,
    speedLimitKmh: 80,
    description: 'Connecting JAFZA South Gate 5 to Dubai South (DWC) Logistics District & Cargo Mega Terminal.',
    path: [
      { lat: 24.9680, lng: 55.0480 },
      { lat: 24.9710, lng: 55.0720 },
      { lat: 24.9350, lng: 55.1150 },
      { lat: 24.9080, lng: 55.1500 },
      { lat: 24.9300, lng: 55.2200 },
    ],
  },
];

// Default center: Jebel Ali Port & JAFZA Corridor
const DEFAULT_MAP_CENTER = { lat: 24.9760, lng: 55.0550 };

/**
 * Builds SVG icon Data URL for drayage prime movers & containers.
 */
function buildDrayageMarkerSvg(
  job: DrayageCorridorJob,
  isSelected: boolean,
  isBogie: boolean,
  isStreetTurn: boolean,
  isDetached: boolean,
): string {
  let mainColor = '#3B82F6'; // Default Blue for L1 Laden
  let badgeText = 'L1';
  let badgeColor = '#1D4ED8';
  let iconContent = '';

  if (isStreetTurn) {
    mainColor = '#10B981'; // Emerald
    badgeText = 'ST-TURN';
    badgeColor = '#047857';
  } else if (isBogie) {
    mainColor = '#6366F1'; // Indigo
    badgeText = '2x20 BOGIE';
    badgeColor = '#4338CA';
  } else if (isDetached) {
    mainColor = '#A855F7'; // Purple
    badgeText = 'RAMP-DETACH';
    badgeColor = '#7E22CE';
  } else if (job.jobPhase === 'L2' || job.status === 'WAITING_MT_RETURN' || job.status === 'EMPTY_AT_PORT' || job.status === 'EMPTY_DEPOSITED') {
    mainColor = '#F59E0B'; // Amber for L2 MT Return
    badgeText = 'L2 MT';
    badgeColor = '#B45309';
  }

  const plate = job.assignedVehiclePlate || 'TRACTOR';
  const cntNum = job.containerNumber ? job.containerNumber.slice(0, 11) : job.jobCode;

  // Radar Pulse if Selected or Moving
  let radarPulse = '';
  if (isSelected || job.status === 'IN_TRANSIT') {
    radarPulse = `
      <circle cx="48" cy="28" r="22" fill="none" stroke="${mainColor}" stroke-width="2.5">
        <animate attributeName="r" values="22;42;50" dur="1.6s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.85;0.25;0" dur="1.6s" repeatCount="indefinite"/>
      </circle>
      <circle cx="48" cy="28" r="22" fill="${mainColor}" opacity="0.2">
        <animate attributeName="r" values="22;34;44" dur="1.6s" begin="0.8s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.4;0.1;0" dur="1.6s" begin="0.8s" repeatCount="indefinite"/>
      </circle>
    `;
  }

  // Tractor or Chassis Silhouette
  if (isDetached) {
    // Chassis / Container at Ramp
    iconContent = `
      <rect x="34" y="16" width="28" height="18" rx="2" fill="#FFFFFF"/>
      <line x1="39" y1="16" x2="39" y2="34" stroke="${mainColor}" stroke-width="1.5"/>
      <line x1="44" y1="16" x2="44" y2="34" stroke="${mainColor}" stroke-width="1.5"/>
      <line x1="49" y1="16" x2="49" y2="34" stroke="${mainColor}" stroke-width="1.5"/>
      <line x1="54" y1="16" x2="54" y2="34" stroke="${mainColor}" stroke-width="1.5"/>
      <circle cx="39" cy="36" r="3" fill="#1E293B"/>
      <circle cx="53" cy="36" r="3" fill="#1E293B"/>
    `;
  } else if (isBogie) {
    // Double 20FT container silhouette
    iconContent = `
      <!-- Tractor Cab -->
      <path d="M32 28 L32 20 C32 18 34 17 36 17 L40 17 L43 23 L47 23 L47 30 L32 30 Z" fill="#FFFFFF"/>
      <!-- Dual 20FT Boxes -->
      <rect x="49" y="17" width="10" height="12" rx="1.5" fill="#E0E7FF" stroke="#4338CA" stroke-width="1"/>
      <rect x="61" y="17" width="10" height="12" rx="1.5" fill="#E0E7FF" stroke="#4338CA" stroke-width="1"/>
      <circle cx="36" cy="31" r="2.5" fill="#1E293B"/>
      <circle cx="53" cy="31" r="2.5" fill="#1E293B"/>
      <circle cx="67" cy="31" r="2.5" fill="#1E293B"/>
    `;
  } else {
    // Standard Prime Mover + 40FT container
    iconContent = `
      <!-- Tractor Cab -->
      <path d="M34 29 L34 21 C34 19 36 18 38 18 L43 18 L46 23 L50 23 L50 30 L34 30 Z" fill="#FFFFFF"/>
      <!-- 40FT Box -->
      <rect x="52" y="18" width="18" height="11" rx="1.5" fill="#FFFFFF" stroke="${mainColor}" stroke-width="1"/>
      <line x1="57" y1="18" x2="57" y2="29" stroke="${mainColor}" stroke-width="1"/>
      <line x1="62" y1="18" x2="62" y2="29" stroke="${mainColor}" stroke-width="1"/>
      <circle cx="38" cy="31" r="2.5" fill="#1E293B"/>
      <circle cx="56" cy="31" r="2.5" fill="#1E293B"/>
      <circle cx="66" cy="31" r="2.5" fill="#1E293B"/>
    `;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="88" viewBox="0 0 96 88">
    ${radarPulse}

    <!-- Background Halo Center -->
    <circle cx="48" cy="28" r="22" fill="${mainColor}" stroke="#FFFFFF" stroke-width="${isSelected ? '3.5' : '2.5'}"/>

    <!-- Operational Silhouette -->
    ${iconContent}

    <!-- Upper Phase Badge Pill -->
    <g transform="translate(18, 2)">
      <rect x="0" y="0" width="60" height="14" rx="4" fill="${badgeColor}" stroke="#FFFFFF" stroke-width="1.2"/>
      <text x="30" y="10" font-size="7.5" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-weight="900" fill="#FFFFFF" text-anchor="middle" letter-spacing="0.5">${badgeText}</text>
    </g>

    <!-- Attached License Plate / Container Label Pill -->
    <g transform="translate(8, 54)">
      <rect x="0" y="0" width="80" height="20" rx="5" fill="#0F172A" stroke="${mainColor}" stroke-width="${isSelected ? '2.5' : '1.5'}"/>
      <text x="40" y="13.5" font-size="9" font-family="ui-monospace, monospace" font-weight="900" fill="#F8FAFC" text-anchor="middle" letter-spacing="0.5">${plate.slice(0, 10)}</text>
    </g>

    <!-- Container Number Micro Sub-Pill -->
    <g transform="translate(14, 73)">
      <rect x="0" y="0" width="68" height="12" rx="3" fill="#1E293B" stroke="#475569" stroke-width="1"/>
      <text x="34" y="9" font-size="7.5" font-family="ui-monospace, monospace" font-weight="700" fill="#94A3B8" text-anchor="middle">${cntNum}</text>
    </g>
  </svg>`;

  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

/**
 * Builds SVG icon for Port Terminals.
 */
function buildPortTerminalMarkerSvg(name: string, code: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <circle cx="32" cy="24" r="18" fill="#0284C7" stroke="#FFFFFF" stroke-width="2.5"/>
    <!-- Anchor Icon -->
    <path d="M32 14 L32 30 M26 22 L38 22 M24 24 C24 29 27 32 32 32 C37 32 40 29 40 24 M32 12 C30.9 12 30 12.9 30 14 C30 15.1 30.9 16 32 16 C33.1 16 34 15.1 34 14 C34 12.9 33.1 12 32 12 Z" stroke="#FFFFFF" stroke-width="2" fill="none" stroke-linecap="round"/>
    
    <g transform="translate(4, 46)">
      <rect x="0" y="0" width="56" height="16" rx="4" fill="#0F172A" stroke="#38BDF8" stroke-width="1.5"/>
      <text x="28" y="11.5" font-size="8.5" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-weight="900" fill="#38BDF8" text-anchor="middle">${code || 'PORT'}</text>
    </g>
  </svg>`;
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

/**
 * Builds SVG icon for Inland Warehouses & Hubs.
 */
function buildWarehouseMarkerSvg(zone: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <circle cx="32" cy="24" r="18" fill="#D97706" stroke="#FFFFFF" stroke-width="2.5"/>
    <!-- Warehouse building icon -->
    <path d="M22 22 L32 15 L42 22 L42 32 L22 32 Z M28 32 L28 26 L36 26 L36 32" stroke="#FFFFFF" stroke-width="1.8" fill="none" stroke-linejoin="round"/>
    
    <g transform="translate(4, 46)">
      <rect x="0" y="0" width="56" height="16" rx="4" fill="#0F172A" stroke="#FBBF24" stroke-width="1.5"/>
      <text x="28" y="11.5" font-size="8" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-weight="900" fill="#FBBF24" text-anchor="middle">${zone ? zone.slice(0, 10) : 'WH'}</text>
    </g>
  </svg>`;
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

export default function DrayageCorridorLiveMap({
  jobs,
  terminals,
  warehouses,
  geofences,
  selectedJobId,
  onSelectJob,
  onVerifyEdi,
  onOpenChat,
  className = '',
  fullHeight = false,
}: DrayageCorridorLiveMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GMapsMap | null>(null);
  const ctorsRef = useRef<GoogleCtors | null>(null);
  const infoWindowRef = useRef<GMapsInfoWindow | null>(null);

  // Layer Refs for clean updates
  const corridorPolylinesRef = useRef<GMapsPolyline[]>([]);
  const portMarkersRef = useRef<GMapsMarker[]>([]);
  const warehouseMarkersRef = useRef<GMapsMarker[]>([]);
  const geofenceOverlaysRef = useRef<Array<GMapsCircle | GMapsPolygon>>([]);
  const vehicleMarkersRef = useRef<GMapsMarker[]>([]);
  const flightpathPolylinesRef = useRef<GMapsPolyline[]>([]);

  // Map & Controls State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapTypeId, setMapTypeId] = useState<'roadmap' | 'satellite' | 'hybrid' | 'terrain'>('roadmap');

  // Layer Visibility Toggles
  const [showCorridors, setShowCorridors] = useState(true);
  const [showPorts] = useState(true);
  const [showWarehouses] = useState(true);
  const [showGeofences, setShowGeofences] = useState(true);
  const [showBogieLinks, setShowBogieLinks] = useState(true);
  const [showStreetTurnLinks, setShowStreetTurnLinks] = useState(true);

  // Filters
  const [filterPhase, setFilterPhase] = useState<'ALL' | 'L1' | 'L2' | 'BOGIE' | 'STREET_TURN' | 'RAMP'>('ALL');
  const [filterCorridor] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Selected Job Details Drawer state (for full height / radar mode)
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Active Job memo
  const activeJob = useMemo(() => {
    return jobs.find((j) => j.id === selectedJobId) || null;
  }, [jobs, selectedJobId]);

  // Filtered Jobs
  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      // Phase Filter
      if (filterPhase === 'L1' && (job.jobPhase !== 'L1' || job.bogieJobId || job.streetTurnJobId)) return false;
      if (filterPhase === 'L2' && job.jobPhase !== 'L2') return false;
      if (filterPhase === 'BOGIE' && !job.bogieJobId) return false;
      if (filterPhase === 'STREET_TURN' && !job.streetTurnJobId && job.status !== 'STREET_TURNED') return false;
      if (filterPhase === 'RAMP' && (!job.trailerDetached && job.status !== 'PLACED_AT_RAMP' && job.placementLocation !== 'RAMP')) return false;

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const match =
          job.jobCode.toLowerCase().includes(q) ||
          job.containerNumber.toLowerCase().includes(q) ||
          (job.assignedVehiclePlate && job.assignedVehiclePlate.toLowerCase().includes(q)) ||
          (job.assignedDriverName && job.assignedDriverName.toLowerCase().includes(q)) ||
          job.warehouseName.toLowerCase().includes(q) ||
          job.terminalName.toLowerCase().includes(q);
        if (!match) return false;
      }

      return true;
    });
  }, [jobs, filterPhase, searchQuery]);

  // Real-time Summary KPIs for the Corridor Map
  const mapStats = useMemo(() => {
    const totalOnCorridor = jobs.filter(j => j.status === 'IN_TRANSIT').length;
    const bogieCount = jobs.filter(j => Boolean(j.bogieJobId)).length;
    const streetTurnCount = jobs.filter(j => Boolean(j.streetTurnJobId) || j.status === 'STREET_TURNED').length;
    const atRampCount = jobs.filter(j => j.trailerDetached || j.status === 'PLACED_AT_RAMP' || j.placementLocation === 'RAMP').length;
    const atPortCount = jobs.filter(j => j.status === 'AT_PORT' || j.status === 'LOADED').length;

    return { totalOnCorridor, bogieCount, streetTurnCount, atRampCount, atPortCount };
  }, [jobs]);

  // 1. Initialize Google Maps
  useEffect(() => {
    let cancelled = false;

    loadGoogleMaps()
      .then((ctors) => {
        if (cancelled) return;
        ctorsRef.current = ctors;
        const container = containerRef.current;
        if (!container) return;

        if (!mapRef.current) {
          const map = new ctors.Map(container, {
            center: DEFAULT_MAP_CENTER,
            zoom: 11,
            zoomControl: true,
            gestureHandling: 'greedy',
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: true,
          });
          mapRef.current = map;
          infoWindowRef.current = new ctors.InfoWindow();
        }
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[DrayageCorridorLiveMap] Map load error:', err);
        setError(err.message || 'Google Maps failed to load');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // 2. Synchronize Map Type
  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.setMapTypeId?.(mapTypeId);
    }
  }, [mapTypeId]);

  // 3. Render Freight Corridors (E11, E311, E611, D53, D57)
  useEffect(() => {
    const map = mapRef.current;
    const ctors = ctorsRef.current;
    if (!map || !ctors) return;

    // Clear old polylines
    corridorPolylinesRef.current.forEach((p) => p.setMap(null));
    corridorPolylinesRef.current = [];

    if (!showCorridors) return;

    UAE_FREIGHT_CORRIDORS.forEach((corridor) => {
      if (filterCorridor !== 'ALL' && filterCorridor !== corridor.code) return;

      const poly = new ctors.Polyline({
        path: corridor.path,
        map,
        strokeColor: corridor.color,
        strokeOpacity: 0.85,
        strokeWeight: corridor.weight,
        zIndex: 5,
      });

      poly.addListener?.('click', (e?: unknown) => {
        const ev = e as { latLng?: GMapsLatLng } | undefined;
        if (!infoWindowRef.current || !ev?.latLng) return;
        const html = `
          <div style="font-family: -apple-system, sans-serif; font-size: 12px; color: #0F172A; max-width: 260px; padding: 4px;">
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
              <span style="background: ${corridor.color}; color: #FFFFFF; font-weight: 900; font-size: 10px; padding: 2px 6px; border-radius: 4px;">${corridor.code}</span>
              <strong style="font-size: 12px;">${corridor.name}</strong>
            </div>
            <p style="font-size: 11px; color: #475569; margin: 4px 0 6px 0; line-height: 1.4;">${corridor.description}</p>
            <div style="background: #F1F5F9; padding: 6px 8px; border-radius: 6px; font-size: 10px; color: #334155; display: flex; justify-content: space-between;">
              <span>Heavy Truck Speed Limit:</span>
              <strong style="color: #0F172A;">${corridor.speedLimitKmh} km/h</strong>
            </div>
          </div>
        `;
        infoWindowRef.current.setContent(html);
        infoWindowRef.current.setPosition(ev.latLng);
        infoWindowRef.current.open({ map });
      });

      corridorPolylinesRef.current.push(poly);
    });
  }, [showCorridors, filterCorridor]);

  // 4. Render Port Terminals and Warehouse Points
  useEffect(() => {
    const map = mapRef.current;
    const ctors = ctorsRef.current;
    if (!map || !ctors) return;

    // Clean old markers
    portMarkersRef.current.forEach((m) => m.setMap(null));
    portMarkersRef.current = [];
    warehouseMarkersRef.current.forEach((m) => m.setMap(null));
    warehouseMarkersRef.current = [];

    // Port Terminals
    if (showPorts) {
      terminals.forEach((term) => {
        const marker = new ctors.Marker({
          position: { lat: term.lat, lng: term.lng },
          map,
          title: term.name,
          icon: {
            url: buildPortTerminalMarkerSvg(term.name, term.code),
            scaledSize: { width: 48, height: 48 },
            anchor: { x: 24, y: 36 },
          },
          zIndex: 10,
        });

        marker.addListener('click', () => {
          if (!infoWindowRef.current) return;
          const html = `
            <div style="font-family: -apple-system, sans-serif; font-size: 12px; color: #0F172A; max-width: 280px; padding: 4px;">
              <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
                <span style="background: #0284C7; color: #FFFFFF; font-weight: 900; font-size: 10px; padding: 2px 6px; border-radius: 4px;">PORT TERMINAL</span>
                <strong style="font-size: 12px;">${term.name}</strong>
              </div>
              <p style="font-size: 11px; color: #475569; margin: 4px 0 6px 0;">
                ${term.portName} · ${term.emirate} · Geofence Radius: ${term.geofenceRadiusMeters}m
              </p>
              <div style="display: flex; gap: 4px; margin-top: 6px;">
                <span style="background: #E0F2FE; color: #0369A1; font-weight: 700; font-size: 9px; padding: 2px 6px; border-radius: 4px;">TAS Gates Active</span>
                <span style="background: #ECFDF5; color: #047857; font-weight: 700; font-size: 9px; padding: 2px 6px; border-radius: 4px;">OCR Auto-Clearance</span>
              </div>
            </div>
          `;
          infoWindowRef.current.setContent(html);
          infoWindowRef.current.setPosition({ lat: term.lat, lng: term.lng });
          infoWindowRef.current.open({ map, anchor: marker });
        });

        portMarkersRef.current.push(marker);
      });
    }

    // Inland Warehouses
    if (showWarehouses) {
      warehouses.forEach((wh) => {
        if (wh.lat == null || wh.lng == null) return;
        const whLat = wh.lat;
        const whLng = wh.lng;
        const marker = new ctors.Marker({
          position: { lat: whLat, lng: whLng },
          map,
          title: wh.name,
          icon: {
            url: buildWarehouseMarkerSvg(wh.zone),
            scaledSize: { width: 44, height: 44 },
            anchor: { x: 22, y: 34 },
          },
          zIndex: 9,
        });

        marker.addListener('click', () => {
          if (!infoWindowRef.current) return;
          const html = `
            <div style="font-family: -apple-system, sans-serif; font-size: 12px; color: #0F172A; max-width: 280px; padding: 4px;">
              <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
                <span style="background: #D97706; color: #FFFFFF; font-weight: 900; font-size: 10px; padding: 2px 6px; border-radius: 4px;">WAREHOUSE HUB</span>
                <strong style="font-size: 12px;">${wh.name}</strong>
              </div>
              <p style="font-size: 11px; color: #475569; margin: 4px 0 6px 0;">
                Zone: <strong>${wh.zone}</strong> · Ramps: ${wh.rampsCount || 8} Bays
              </p>
              <div style="background: #FEF3C7; color: #92400E; padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: 700;">
                Ramp Staging & Destuffing Buffer Active
              </div>
            </div>
          `;
          infoWindowRef.current.setContent(html);
          infoWindowRef.current.setPosition({ lat: whLat, lng: whLng });
          infoWindowRef.current.open({ map, anchor: marker });
        });

        warehouseMarkersRef.current.push(marker);
      });
    }
  }, [terminals, warehouses, showPorts, showWarehouses]);

  // 5. Render Geofence Boundary Overlays (Circles & Polygons)
  useEffect(() => {
    const map = mapRef.current;
    const ctors = ctorsRef.current;
    if (!map || !ctors) return;

    // Clear old geofences
    geofenceOverlaysRef.current.forEach((o) => o.setMap(null));
    geofenceOverlaysRef.current = [];

    if (!showGeofences) return;

    geofences.forEach((gf) => {
      const isPort = Boolean(gf.terminalId) || gf.terminalName.toLowerCase().includes('port') || gf.terminalName.toLowerCase().includes('terminal');
      const strokeColor = isPort ? '#0284C7' : '#D97706';
      const fillColor = isPort ? '#38BDF8' : '#FBBF24';

      if (gf.type === 'POLYGON' && gf.coordinatesJson) {
        try {
          const coords = JSON.parse(gf.coordinatesJson);
          if (Array.isArray(coords) && coords.length >= 3) {
            const poly = new ctors.Polygon({
              map,
              paths: coords,
              strokeColor,
              strokeOpacity: 0.8,
              strokeWeight: 2,
              fillColor,
              fillOpacity: 0.18,
              zIndex: 3,
            });
            geofenceOverlaysRef.current.push(poly);
            return;
          }
        } catch {}
      }

      // Default to Circle
      const circle = new ctors.Circle({
        map,
        center: { lat: gf.centerLat, lng: gf.centerLng },
        radius: gf.radiusMeters || 1000,
        strokeColor,
        strokeOpacity: 0.8,
        strokeWeight: 2,
        fillColor,
        fillOpacity: 0.15,
        zIndex: 3,
      });
      geofenceOverlaysRef.current.push(circle);
    });
  }, [geofences, showGeofences]);

  // 6. Render Active Prime Movers, Containers, Bogie Tethers & Street-Turn Links
  useEffect(() => {
    const map = mapRef.current;
    const ctors = ctorsRef.current;
    if (!map || !ctors) return;

    // Clean old vehicle markers and flightpaths
    vehicleMarkersRef.current.forEach((m) => m.setMap(null));
    vehicleMarkersRef.current = [];
    flightpathPolylinesRef.current.forEach((p) => p.setMap(null));
    flightpathPolylinesRef.current = [];

    // Track Bogie pairs to draw connecting tethers
    const bogieTetherMap = new Map<string, Array<{ lat: number; lng: number }>>();

    filteredJobs.forEach((job) => {
      // Determine position (fallback to warehouse or terminal if null)
      let lat = job.currentLat;
      let lng = job.currentLng;

      if (!lat || !lng) {
        if (job.status === 'AT_PORT' || job.status === 'LOADED') {
          lat = 25.0112;
          lng = 55.0611;
        } else if (job.placementLocation === 'RAMP' || job.status === 'PLACED_AT_RAMP' || job.trailerDetached) {
          lat = 24.9680;
          lng = 55.0450;
        } else {
          lat = 24.9850;
          lng = 55.0760;
        }
      }

      const isSelected = selectedJobId === job.id;
      const isBogie = Boolean(job.bogieJobId);
      const isStreetTurn = Boolean(job.streetTurnJobId) || job.status === 'STREET_TURNED';
      const isDetached = Boolean(job.trailerDetached) || job.status === 'PLACED_AT_RAMP' || job.placementLocation === 'RAMP';

      // Record coordinates for Bogie Tethers
      if (isBogie && job.bogieJobId) {
        const arr = bogieTetherMap.get(job.bogieJobId) || [];
        arr.push({ lat, lng });
        bogieTetherMap.set(job.bogieJobId, arr);
      }

      // Render Street-Turn Flightpath (Direct Warehouse-to-Warehouse inland route)
      if (isStreetTurn && showStreetTurnLinks) {
        const originWh = { lat: 24.9680, lng: 55.0450 }; // JAFZA South
        const destWh = { lat: 24.9580, lng: 55.0420 };   // Adjacent JAFZA Export Facility
        const flightpath = new ctors.Polyline({
          path: [originWh, { lat, lng }, destWh],
          map,
          strokeColor: '#10B981', // Emerald
          strokeOpacity: 0.9,
          strokeWeight: 3.5,
          zIndex: 8,
        });
        flightpathPolylinesRef.current.push(flightpath);
      }

      const marker = new ctors.Marker({
        position: { lat, lng },
        map,
        title: `${job.jobCode} - ${job.containerNumber}`,
        icon: {
          url: buildDrayageMarkerSvg(job, isSelected, isBogie, isStreetTurn, isDetached),
          scaledSize: { width: 56, height: 52 },
          anchor: { x: 28, y: 44 },
        },
        zIndex: isSelected ? 200 : 100,
      });

      marker.addListener('click', () => {
        onSelectJob?.(job.id);
        setDrawerOpen(true);

        if (!infoWindowRef.current) return;
        const html = `
          <div style="font-family: -apple-system, sans-serif; font-size: 12px; color: #0F172A; min-width: 250px; max-width: 300px; padding: 4px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; border-bottom: 1px solid #E2E8F0; padding-bottom: 4px;">
              <strong style="font-size: 13px; font-family: monospace;">${job.jobCode}</strong>
              <span style="background: ${isStreetTurn ? '#10B981' : isBogie ? '#6366F1' : job.jobPhase === 'L2' ? '#F59E0B' : '#3B82F6'}; color: #FFFFFF; font-weight: 900; font-size: 9px; padding: 2px 6px; border-radius: 4px;">
                ${isStreetTurn ? 'STREET-TURN' : isBogie ? '2x20 BOGIE' : job.jobPhase}
              </span>
            </div>
            <div style="margin-bottom: 4px; font-size: 11px;">
              Container: <strong style="font-family: monospace;">${job.containerNumber}</strong> (${job.containerSize})
            </div>
            <div style="margin-bottom: 4px; font-size: 11px;">
              Tractor: <strong>${job.assignedVehiclePlate || 'Unassigned'}</strong> · Driver: <strong>${job.assignedDriverName || 'None'}</strong>
            </div>
            <div style="margin-bottom: 6px; font-size: 11px; color: #475569;">
              Route: <strong>${job.terminalName}</strong> → <strong>${job.warehouseName}</strong>
            </div>
            <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px; padding: 6px; margin-bottom: 8px; font-size: 10px;">
              Status: <strong style="color: #0284C7;">${job.status}</strong>
              ${job.etcTime ? `<div style="color: #D97706; margin-top: 2px;">⏳ ETC: ${new Date(job.etcTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>` : ''}
            </div>
            <div style="display: flex; gap: 4px;">
              <button id="btn-focus-${job.id}" style="flex: 1; background: #2563EB; color: #FFFFFF; border: none; border-radius: 4px; padding: 5px 8px; font-size: 11px; font-weight: bold; cursor: pointer;">
                Open Console
              </button>
            </div>
          </div>
        `;
        infoWindowRef.current.setContent(html);
        infoWindowRef.current.setPosition({ lat, lng });
        infoWindowRef.current.open({ map, anchor: marker });

        setTimeout(() => {
          const btn = document.getElementById(`btn-focus-${job.id}`);
          if (btn) {
            btn.onclick = () => {
              onSelectJob?.(job.id);
              setDrawerOpen(true);
            };
          }
        }, 100);
      });

      vehicleMarkersRef.current.push(marker);
    });

    // Render Bogie Pairing Tethers
    if (showBogieLinks) {
      bogieTetherMap.forEach((points) => {
        if (points.length >= 2) {
          const tether = new ctors.Polyline({
            path: points,
            map,
            strokeColor: '#6366F1', // Indigo
            strokeOpacity: 0.9,
            strokeWeight: 4,
            zIndex: 7,
          });
          flightpathPolylinesRef.current.push(tether);
        }
      });
    }
  }, [filteredJobs, selectedJobId, showBogieLinks, showStreetTurnLinks, onSelectJob]);

  // 7. Pan and Zoom to Selected Job when selectedJobId changes
  useEffect(() => {
    if (!selectedJobId || !mapRef.current) return;
    const job = jobs.find((j) => j.id === selectedJobId);
    if (job && job.currentLat && job.currentLng) {
      mapRef.current.panTo({ lat: job.currentLat, lng: job.currentLng });
      mapRef.current.setZoom(13);
    }
  }, [selectedJobId, jobs]);

  return (
    <div className={`relative flex flex-col rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] overflow-hidden shadow-sm ${fullHeight ? 'h-[850px]' : 'h-[620px]'} ${className}`}>
      {/* Top Map Control Header */}
      <div className="p-3.5 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-3 z-10">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Navigation className="w-4 h-4 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-[var(--text-main)]">Corridor Telematics Radar</span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                  LIVE GPS
                </span>
              </div>
              <p className="text-[10px] text-[var(--text-muted)]">
                E11 / E311 / E611 Prime Mover Corridors & Port Geofences
              </p>
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div className="hidden xl:flex items-center gap-2 pl-4 border-l border-[var(--border-subtle)] text-[11px]">
            <div className="px-2 py-1 rounded-md bg-[var(--bg-main)] border border-[var(--border-subtle)]">
              <span className="text-[var(--text-muted)] mr-1">In Transit:</span>
              <strong className="text-blue-400 font-mono">{mapStats.totalOnCorridor}</strong>
            </div>
            <div className="px-2 py-1 rounded-md bg-[var(--bg-main)] border border-[var(--border-subtle)]">
              <span className="text-[var(--text-muted)] mr-1">2x20 Bogies:</span>
              <strong className="text-indigo-400 font-mono">{mapStats.bogieCount}</strong>
            </div>
            <div className="px-2 py-1 rounded-md bg-[var(--bg-main)] border border-[var(--border-subtle)]">
              <span className="text-[var(--text-muted)] mr-1">Street-Turns:</span>
              <strong className="text-emerald-400 font-mono">{mapStats.streetTurnCount}</strong>
            </div>
            <div className="px-2 py-1 rounded-md bg-[var(--bg-main)] border border-[var(--border-subtle)]">
              <span className="text-[var(--text-muted)] mr-1">At Ramps:</span>
              <strong className="text-purple-400 font-mono">{mapStats.atRampCount}</strong>
            </div>
          </div>
        </div>

        {/* Right Search & Controls */}
        <div className="flex items-center gap-2">
          {/* Search Box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter plate, driver, container..."
              className="text-xs pl-8 pr-2.5 py-1.5 w-48 lg:w-56 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-main)]"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Map Layer Switcher */}
          <div className="flex items-center rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] p-0.5 text-[11px]">
            <button
              onClick={() => setMapTypeId('roadmap')}
              className={`px-2 py-1 rounded-md transition-colors ${mapTypeId === 'roadmap' ? 'bg-blue-600 text-white font-bold' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}
            >
              Road
            </button>
            <button
              onClick={() => setMapTypeId('satellite')}
              className={`px-2 py-1 rounded-md transition-colors ${mapTypeId === 'satellite' ? 'bg-blue-600 text-white font-bold' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}
            >
              Satellite
            </button>
            <button
              onClick={() => setMapTypeId('hybrid')}
              className={`px-2 py-1 rounded-md transition-colors ${mapTypeId === 'hybrid' ? 'bg-blue-600 text-white font-bold' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}
            >
              Hybrid
            </button>
          </div>
        </div>
      </div>

      {/* Secondary Filter & Layer Toggles Ribbon */}
      <div className="px-3.5 py-2 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-2 text-xs">
        {/* Phase Filter Buttons */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] mr-1">Filter:</span>
          {(['ALL', 'L1', 'L2', 'BOGIE', 'STREET_TURN', 'RAMP'] as const).map((phase) => (
            <button
              key={phase}
              onClick={() => setFilterPhase(phase)}
              className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all ${
                filterPhase === phase
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-[var(--bg-main)] text-[var(--text-muted)] border border-[var(--border-subtle)] hover:text-[var(--text-main)]'
              }`}
            >
              {phase === 'ALL'
                ? 'All Equipment'
                : phase === 'L1'
                ? 'Laden FCL (L1)'
                : phase === 'L2'
                ? 'Empty Return (L2)'
                : phase === 'BOGIE'
                ? 'Dual-20FT Bogie'
                : phase === 'STREET_TURN'
                ? 'Street-Turn'
                : 'At Ramp'}
            </button>
          ))}
        </div>

        {/* Layer Visibility Checkboxes */}
        <div className="flex items-center gap-3 text-[11px] text-[var(--text-muted)]">
          <label className="inline-flex items-center gap-1 cursor-pointer hover:text-[var(--text-main)]">
            <input
              type="checkbox"
              checked={showCorridors}
              onChange={(e) => setShowCorridors(e.target.checked)}
              className="rounded text-blue-600 focus:ring-0"
            />
            <span>Corridors</span>
          </label>
          <label className="inline-flex items-center gap-1 cursor-pointer hover:text-[var(--text-main)]">
            <input
              type="checkbox"
              checked={showGeofences}
              onChange={(e) => setShowGeofences(e.target.checked)}
              className="rounded text-blue-600 focus:ring-0"
            />
            <span>Geofences</span>
          </label>
          <label className="inline-flex items-center gap-1 cursor-pointer hover:text-[var(--text-main)]">
            <input
              type="checkbox"
              checked={showBogieLinks}
              onChange={(e) => setShowBogieLinks(e.target.checked)}
              className="rounded text-indigo-600 focus:ring-0"
            />
            <span>Bogie Links</span>
          </label>
          <label className="inline-flex items-center gap-1 cursor-pointer hover:text-[var(--text-main)]">
            <input
              type="checkbox"
              checked={showStreetTurnLinks}
              onChange={(e) => setShowStreetTurnLinks(e.target.checked)}
              className="rounded text-emerald-600 focus:ring-0"
            />
            <span>Street-Turn Links</span>
          </label>
        </div>
      </div>

      {/* Main Map Container */}
      <div className="relative flex-1 w-full bg-slate-900">
        <div ref={containerRef} className="w-full h-full" />

        {/* Loading Spinner */}
        {loading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-sm text-xs font-semibold text-blue-400 gap-3">
            <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
            <span>Streaming Live Prime Mover Telematics & Freight Corridors...</span>
          </div>
        )}

        {/* Error Fallback */}
        {error && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/90 text-xs text-rose-300 p-6 text-center gap-3">
            <AlertTriangle className="w-8 h-8 text-rose-500" />
            <p className="max-w-md">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-500 transition-colors"
            >
              Retry Connection
            </button>
          </div>
        )}

        {/* Legend Overlay Card in bottom-left */}
        <div className="absolute bottom-4 left-4 z-10 p-3 rounded-xl bg-slate-950/85 backdrop-blur-md border border-slate-800 text-[11px] space-y-1.5 shadow-xl max-w-xs pointer-events-auto">
          <div className="font-bold text-slate-200 text-xs mb-1 flex items-center justify-between">
            <span>Freight Corridor Legend</span>
            <span className="text-[10px] text-slate-400">Max 80 km/h</span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-1 rounded-full bg-blue-500" />
              <span className="text-slate-300">E11 Sheikh Zayed</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-1 rounded-full bg-emerald-500" />
              <span className="text-slate-300">E311 SMBZ Rd</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-1 rounded-full bg-amber-500" />
              <span className="text-slate-300">E611 Emirates Rd</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-1 rounded-full bg-indigo-500" />
              <span className="text-slate-300">D53 Al Yalayis</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-600 border border-white" />
              <span className="text-slate-300">L1 Laden Import</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 border border-white" />
              <span className="text-slate-300">L2 MT Return</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 border border-white" />
              <span className="text-slate-300">Dual-20FT Bogie</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 border border-white" />
              <span className="text-slate-300">Street-Turn Match</span>
            </div>
          </div>
        </div>

        {/* Selected Unit Telematics Drawer (Slide-out in Full Height Mode) */}
        {drawerOpen && activeJob && (
          <div className="absolute top-4 right-4 z-20 w-80 md:w-96 rounded-2xl bg-slate-950/95 backdrop-blur-md border border-slate-800 p-4 shadow-2xl text-xs space-y-3 pointer-events-auto animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-sm text-white">{activeJob.jobCode}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      activeJob.bogieJobId
                        ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
                        : activeJob.streetTurnJobId || activeJob.status === 'STREET_TURNED'
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : activeJob.jobPhase === 'L2'
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                    }`}
                  >
                    {activeJob.bogieJobId
                      ? 'DUAL-20FT BOGIE'
                      : activeJob.streetTurnJobId || activeJob.status === 'STREET_TURNED'
                      ? 'STREET-TURN'
                      : `${activeJob.jobPhase} TRIP`}
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {activeJob.customerName} · {activeJob.shipmentType}
                </p>
              </div>
              <button
                onClick={() => setDrawerOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Container & Tractor Telematics */}
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="p-2 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-[9px] uppercase tracking-wider text-slate-500 block">Container</span>
                <strong className="font-mono text-white text-xs">{activeJob.containerNumber}</strong>
                <div className="text-[10px] text-slate-400">{activeJob.containerSize} · {activeJob.containerType}</div>
              </div>

              <div className="p-2 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-[9px] uppercase tracking-wider text-slate-500 block">Tractor & Chassis</span>
                <strong className="text-white text-xs">{activeJob.assignedVehiclePlate || 'Unassigned'}</strong>
                <div className="text-[10px] text-slate-400 truncate">{activeJob.assignedDriverName || 'No Driver'}</div>
              </div>
            </div>

            {/* Route & Zone */}
            <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1 text-[11px]">
              <div className="flex items-center justify-between text-slate-400">
                <span>Current Status:</span>
                <strong className="text-blue-400 font-mono">{activeJob.status}</strong>
              </div>
              <div className="flex items-center justify-between text-slate-400">
                <span>Terminal / Port:</span>
                <span className="text-slate-200 truncate">{activeJob.terminalName}</span>
              </div>
              <div className="flex items-center justify-between text-slate-400">
                <span>Warehouse / Ramp:</span>
                <span className="text-slate-200 truncate">{activeJob.warehouseName}</span>
              </div>
              {activeJob.tokenNumber && (
                <div className="flex items-center justify-between text-slate-400 pt-1 border-t border-slate-800">
                  <span>Port Gate Token:</span>
                  <strong className="text-emerald-400 font-mono">{activeJob.tokenNumber}</strong>
                </div>
              )}
            </div>

            {/* ETC Timer Countdown if Ramp Placement */}
            {activeJob.etcTime && (
              <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-bold text-amber-400 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    Destuffing ETC Timer
                  </span>
                  <strong className="font-mono text-white">
                    {new Date(activeJob.etcTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </strong>
                </div>
                <div className="text-[10px] text-slate-400">
                  {new Date(activeJob.etcTime).getTime() <= Date.now()
                    ? '⚠️ Timer Expired — Dynamic L2 Activation Triggered'
                    : `⏳ ~${Math.max(1, Math.round((new Date(activeJob.etcTime).getTime() - Date.now()) / 60000))} mins until empty release`}
                </div>
              </div>
            )}

            {/* Quick Actions Strip */}
            <div className="pt-2 border-t border-slate-800 flex items-center gap-2">
              <button
                onClick={() => onVerifyEdi?.('DUBAI_TRADE_DPWORLD')}
                className="flex-1 py-1.5 px-2 rounded-lg bg-cyan-600/20 border border-cyan-500/40 text-cyan-300 font-semibold text-[11px] hover:bg-cyan-600/30 transition-colors flex items-center justify-center gap-1"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Verify EDI
              </button>
              <button
                onClick={() => onOpenChat?.(activeJob.id)}
                className="flex-1 py-1.5 px-2 rounded-lg bg-blue-600/20 border border-blue-500/40 text-blue-300 font-semibold text-[11px] hover:bg-blue-600/30 transition-colors flex items-center justify-center gap-1"
              >
                <Send className="w-3.5 h-3.5" />
                Driver Chat
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
