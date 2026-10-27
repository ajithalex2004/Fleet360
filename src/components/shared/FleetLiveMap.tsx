'use client';
/**
 * src/components/shared/FleetLiveMap.tsx
 *
 * FleetLiveMap — High-Performance Live Telematics Fleet Map.
 *
 * Features:
 *   - Animated Vehicle Icons by Type (Bus, Van, Truck, Bike, Car/Sedan/SUV).
 *   - Operational Status Colors:
 *       * MOVING: Animated green radar pulse / ripple.
 *       * IDLE: Pulsing Dark Yellow (#CA8A04 / #EAB308).
 *       * STOP: Solid red marker (#EF4444).
 *       * INACTIVE / OFFLINE: Muted slate gray (#64748B).
 *   - Attached Plate Number pill label below the vehicle pin.
 *   - Flag badge (🚩 TRIP) if vehicle is on an active trip / assigned job.
 *   - Hover / Click InfoWindow with Speed, Location, Driver, Trip details,
 *     and direct WhatsApp and SMS location share links.
 *   - Proximity-based grouping / clustering toggle with auto group on zoom out
 *     and ungroup on zoom in.
 */

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  loadGoogleMaps,
  type GMapsMap,
  type GMapsMarker,
  type GMapsCircle,
} from '@/lib/google-maps-loader';

export interface VehiclePosition {
  id: string;
  vehicle_id: string;
  vehicle_plate: string | null;
  lat: number;
  lng: number;
  status: string;
  operationalStatus?: 'MOVING' | 'IDLE' | 'STOP' | string;
  is_online: boolean;
  seconds_since_ping: number;
  speed_kmh: number;
  type?: string | null;
  make?: string | null;
  model?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  jobTitle?: string | null;
  isOnTrip?: boolean;
  locationName?: string | null;
  district?: string | null;
}

interface Props {
  positions: VehiclePosition[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  className?: string;
}

const DEFAULT_CENTER = { lat: 24.4539, lng: 54.3773 }; // Abu Dhabi

// Operational colors
const COLOR_MOVING = '#10B981'; // Green
const COLOR_IDLE = '#CA8A04';   // Dark Yellow (User explicit requirement)
const COLOR_STOP = '#EF4444';   // Red
const COLOR_INACTIVE = '#64748B'; // Slate gray

function getOperationalColor(status: string | undefined): string {
  switch (status?.toUpperCase()) {
    case 'MOVING':
    case 'EN_ROUTE':
      return COLOR_MOVING;
    case 'IDLE':
      return COLOR_IDLE;
    case 'STOP':
    case 'BREAKDOWN':
      return COLOR_STOP;
    default:
      return COLOR_INACTIVE;
  }
}

// Vehicle SVG Paths (standardized inside a 36x36 viewbox)
function getVehiclePath(type: string | undefined | null): string {
  const t = (type || '').toLowerCase();
  if (t.includes('bus') || t.includes('coach') || t.includes('shuttle')) {
    // Bus silhouette
    return `<path d="M7 8 C7 6 9 5 12 5 L24 5 C27 5 29 6 29 8 L29 25 C29 27 27 28 25 28 L24 28 C24 30 22 31 20 31 C18 31 17 30 17 28 L15 28 C15 30 14 31 12 31 C10 31 9 30 9 28 L8 28 C6 28 7 27 7 25 Z M10 8 L26 8 C26 8 26 13 26 13 L10 13 Z M10 16 L16 16 L16 20 L10 20 Z M20 16 L26 16 L26 20 L20 20 Z" fill="#FFFFFF"/>`;
  }
  if (t.includes('truck') || t.includes('lorry') || t.includes('trailer') || t.includes('tanker')) {
    // Truck silhouette
    return `<path d="M4 8 C4 7 5 6 6 6 L20 6 C21 6 22 7 22 8 L22 22 L20 22 C20 24 18 26 16 26 C14 26 12 24 12 22 L9 22 C9 24 7 26 5 26 C3 26 2 24 2 22 L2 9 C2 8 3 8 4 8 Z M22 12 L28 12 C30 12 31 13 32 15 L34 19 C34 20 34 21 34 22 L32 22 C32 24 30 26 28 26 C26 26 25 24 25 22 L22 22 Z M24 14 L24 17 L30 17 L29 14 Z" fill="#FFFFFF"/>`;
  }
  if (t.includes('van') || t.includes('pickup') || t.includes('minivan')) {
    // Van silhouette
    return `<path d="M5 9 C5 7 7 6 9 6 L22 6 C24 6 26 7 28 10 L31 14 C32 15 33 16 33 18 L33 23 C33 24 32 25 31 25 L30 25 C30 27 28 29 26 29 C24 29 22 27 22 25 L12 25 C12 27 10 29 8 29 C6 29 5 27 5 25 L4 25 C3 25 2 24 2 23 L2 11 C2 10 3 9 5 9 Z M7 9 L21 9 L21 14 L7 14 Z M23 9 L26 9 L29 14 L23 14 Z" fill="#FFFFFF"/>`;
  }
  if (t.includes('bike') || t.includes('motorcycle') || t.includes('scooter')) {
    // Bike / Motorcycle silhouette
    return `<path d="M8 23 C6 23 4 21 4 19 C4 17 6 15 8 15 C10 15 12 17 12 19 C12 21 10 23 8 23 Z M28 23 C26 23 24 21 24 19 C24 17 26 15 28 15 C30 15 32 17 32 19 C32 21 30 23 28 23 Z M9 19 L14 11 L19 11 L23 17 L18 17 L14 14 L11 19 Z M21 9 L25 9 L26 12 L23 12 Z M18 8 C19 8 20 9 20 10 C20 11 19 12 18 12 C17 12 16 11 16 10 C16 9 17 8 18 8 Z" fill="#FFFFFF"/>`;
  }
  // Default: Car / Sedan / SUV silhouette
  return `<path d="M7 14 C7 14 10 9 13 9 L23 9 C26 9 29 14 29 14 L32 14 C33.5 14 34 15 34 17 L34 22 C34 23 33 24 32 24 L31 24 C31 26 29 28 27 28 C25 28 23 26 23 24 L13 24 C13 26 11 28 9 28 C7 28 5 26 5 24 L4 24 C3 24 2 23 2 22 L2 17 C2 15 3 14 5 14 Z M11 13 L25 13 C24 11 23 10.5 22 10.5 L14 10.5 C13 10.5 12 11 11 13 Z" fill="#FFFFFF"/>`;
}

/**
 * Builds high-contrast SVG Data URL for vehicle markers.
 * Includes:
 *   - Pulsing radar halo for MOVING (Green) and IDLE (Dark Yellow)
 *   - Vehicle silhouette inside marker center
 *   - High-contrast Plate Number label pill
 *   - 🚩 TRIP badge if on an active trip/job
 */
function buildVehicleMarkerSvg(pos: VehiclePosition): string {
  const status = pos.operationalStatus || pos.status || 'STOP';
  const color = getOperationalColor(status);
  const isMoving = status.toUpperCase() === 'MOVING' || status.toUpperCase() === 'EN_ROUTE';
  const isIdle = status.toUpperCase() === 'IDLE';
  const isOnTrip = Boolean(pos.isOnTrip || pos.jobTitle);

  const rawPlate = pos.vehicle_plate || pos.vehicle_id || 'VEHICLE';
  const plate = rawPlate.length > 10 ? rawPlate.slice(0, 10) : rawPlate;
  const escapedPlate = plate.replace(/[<>&'"]/g, '');

  const vehiclePath = getVehiclePath(pos.type);

  // SVG dimensions: 84 width, 72 height. Marker center at (42, 24).
  let animationElements = '';
  if (isMoving) {
    animationElements = `
      <circle cx="42" cy="24" r="18" fill="none" stroke="${color}" stroke-width="2.5">
        <animate attributeName="r" values="18;34;40" dur="1.5s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.85;0.25;0" dur="1.5s" repeatCount="indefinite"/>
      </circle>
      <circle cx="42" cy="24" r="18" fill="${color}" opacity="0.25">
        <animate attributeName="r" values="18;28;36" dur="1.5s" begin="0.75s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.4;0.1;0" dur="1.5s" begin="0.75s" repeatCount="indefinite"/>
      </circle>
    `;
  } else if (isIdle) {
    animationElements = `
      <circle cx="42" cy="24" r="18" fill="none" stroke="${color}" stroke-width="2.5">
        <animate attributeName="r" values="18;28;34" dur="2s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.8;0.2;0" dur="2s" repeatCount="indefinite"/>
      </circle>
    `;
  }

  const tripBadge = isOnTrip
    ? `<g transform="translate(46, 2)">
        <rect x="0" y="0" width="36" height="14" rx="3.5" fill="#DC2626" stroke="#FFFFFF" stroke-width="1.2"/>
        <text x="18" y="10" font-size="7.5" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-weight="900" fill="#FFFFFF" text-anchor="middle">🚩 TRIP</text>
      </g>`
    : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="84" height="72" viewBox="0 0 84 72">
    ${animationElements}
    <!-- Main Center Circle with Drop Shadow -->
    <circle cx="42" cy="24" r="18" fill="${color}" stroke="#FFFFFF" stroke-width="2.5"/>
    
    <!-- Vehicle Silhouette -->
    <g transform="translate(29, 11) scale(0.72)">
      ${vehiclePath}
    </g>

    <!-- Attached License Plate Pill -->
    <g>
      <rect x="6" y="48" width="72" height="18" rx="5" fill="#0F172A" stroke="${color}" stroke-width="2"/>
      <text x="42" y="60.5" font-size="9.5" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, monospace" font-weight="900" fill="#F8FAFC" text-anchor="middle" letter-spacing="0.5">${escapedPlate}</text>
    </g>

    ${tripBadge}
  </svg>`;

  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

/**
 * Builds cluster marker SVG for grouped vehicles.
 */
function buildClusterMarkerSvg(count: number, moving: number, idle: number, stop: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="68" height="68" viewBox="0 0 68 68">
    <circle cx="34" cy="34" r="30" fill="#0891B2" opacity="0.25">
      <animate attributeName="r" values="26;32;26" dur="2.5s" repeatCount="indefinite"/>
    </circle>
    <circle cx="34" cy="34" r="24" fill="#0F172A" stroke="#06B6D4" stroke-width="3"/>
    <text x="34" y="32" font-size="14" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-weight="900" fill="#38BDF8" text-anchor="middle" dominant-baseline="central">${count}</text>
    
    <!-- Mini Status Dot Bar -->
    <g transform="translate(20, 42)">
      <circle cx="4" cy="0" r="3.5" fill="#10B981"/>
      <circle cx="14" cy="0" r="3.5" fill="#CA8A04"/>
      <circle cx="24" cy="0" r="3.5" fill="#EF4444"/>
    </g>

    <rect x="12" y="49" width="44" height="15" rx="4" fill="#06B6D4" stroke="#FFFFFF" stroke-width="1"/>
    <text x="34" y="60" font-size="8" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-weight="900" fill="#0F172A" text-anchor="middle">FLEET</text>
  </svg>`;

  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

/**
 * Formats WhatsApp & SMS Location Share message.
 */
function generateShareUrls(p: VehiclePosition) {
  const statusStr = (p.operationalStatus || p.status || 'STOP').toUpperCase();
  const statusLabel = statusStr === 'MOVING' ? '🟢 Moving' : statusStr === 'IDLE' ? '🟡 Idle' : '🔴 Stop';
  const speedText = `${p.speed_kmh.toFixed(0)} km/h`;
  const locationText = p.locationName || `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
  const driverText = p.driverName ? `Driver: ${p.driverName} (${p.driverPhone || 'No phone'})` : 'Driver: Unassigned';
  const jobText = p.jobTitle ? `Trip: ${p.jobTitle}` : p.isOnTrip ? 'Active Trip' : '';
  const mapsUrl = `https://maps.google.com/?q=${p.lat},${p.lng}`;
  const now = new Date().toLocaleTimeString();

  const msg = [
    `*Fleet360 Live Vehicle Location*`,
    `🚗 Vehicle: ${p.vehicle_plate || p.vehicle_id}`,
    `📊 Status: ${statusLabel} (${speedText})`,
    `📍 Location: ${locationText}`,
    `👤 ${driverText}`,
    jobText ? `🚩 ${jobText}` : null,
    `⏱ Time: ${now}`,
    `🗺 Map: ${mapsUrl}`,
  ].filter(Boolean).join('\n');

  const encoded = encodeURIComponent(msg);
  return {
    whatsappUrl: `https://wa.me/?text=${encoded}`,
    smsUrl: `sms:?body=${encoded}`,
    mapsUrl,
    message: msg,
  };
}

/**
 * Generates InfoWindow HTML for hovering/clicking a vehicle pin.
 */
function buildInfoWindowHtml(p: VehiclePosition): string {
  const status = (p.operationalStatus || p.status || 'STOP').toUpperCase();
  const color = getOperationalColor(status);
  const statusBadge = status === 'MOVING'
    ? `<span style="background:rgba(16,185,129,0.15);color:#10b981;border:1px solid #10b981;padding:2px 8px;border-radius:12px;font-size:10px;font-weight:bold;">🟢 Moving (${p.speed_kmh.toFixed(0)} km/h)</span>`
    : status === 'IDLE'
    ? `<span style="background:rgba(202,138,4,0.15);color:#ca8a04;border:1px solid #ca8a04;padding:2px 8px;border-radius:12px;font-size:10px;font-weight:bold;">🟡 Idle (Ignition ON)</span>`
    : `<span style="background:rgba(239,68,68,0.15);color:#ef4444;border:1px solid #ef4444;padding:2px 8px;border-radius:12px;font-size:10px;font-weight:bold;">🔴 Stop (Parked)</span>`;

  const tripBadge = p.isOnTrip || p.jobTitle
    ? `<div style="margin-top:6px;background:rgba(220,38,38,0.12);color:#ef4444;border:1px solid rgba(220,38,38,0.3);padding:3px 8px;border-radius:6px;font-size:10.5px;font-weight:bold;">🚩 On Trip: ${p.jobTitle || 'Assigned Job'}</div>`
    : '';

  const { whatsappUrl, smsUrl, mapsUrl } = generateShareUrls(p);

  return `
    <div style="font-family:-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif; color:#0f172a; min-width:240px; max-width:280px; padding:4px;">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; border-bottom:1px solid #e2e8f0; padding-bottom:6px; margin-bottom:8px;">
        <div>
          <div style="font-size:13px; font-weight:900; font-family:monospace; color:#0f172a;">${p.vehicle_plate || p.vehicle_id}</div>
          <div style="font-size:10.5px; color:#64748b;">${p.make || ''} ${p.model || ''} ${p.type ? `(${p.type})` : ''}</div>
        </div>
        <div>${statusBadge}</div>
      </div>

      <div style="font-size:11px; color:#334155; line-height:1.5; margin-bottom:8px;">
        <div style="display:flex; align-items:flex-start; gap:4px; margin-bottom:4px;">
          <span style="color:#0891b2;">📍</span>
          <div>
            <strong>${p.locationName || 'Unknown Location'}</strong>
            <div style="font-size:9.5px; color:#64748b; font-family:monospace;">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</div>
          </div>
        </div>

        <div style="display:flex; align-items:center; gap:4px; margin-bottom:3px;">
          <span>👤</span>
          <span>${p.driverName || '<span style="color:#94a3b8;font-style:italic;">Unassigned</span>'}</span>
          ${p.driverPhone ? `<a href="tel:${p.driverPhone}" style="color:#059669; font-weight:bold; margin-left:4px; text-decoration:none;">📞 ${p.driverPhone}</a>` : ''}
        </div>

        ${tripBadge}
      </div>

      <div style="border-top:1px solid #e2e8f0; padding-top:8px;">
        <div style="font-size:10px; font-weight:bold; color:#64748b; text-transform:uppercase; margin-bottom:5px;">Share Live Location</div>
        <div style="display:flex; gap:6px;">
          <a href="${whatsappUrl}" target="_blank" rel="noopener noreferrer" style="flex:1; display:inline-flex; align-items:center; justify-content:center; gap:4px; background:#25D366; color:#ffffff; padding:6px 8px; border-radius:6px; font-size:11px; font-weight:bold; text-decoration:none; box-shadow:0 1px 2px rgba(0,0,0,0.15);">
            💬 WhatsApp
          </a>
          <a href="${smsUrl}" style="flex:1; display:inline-flex; align-items:center; justify-content:center; gap:4px; background:#0284C7; color:#ffffff; padding:6px 8px; border-radius:6px; font-size:11px; font-weight:bold; text-decoration:none; box-shadow:0 1px 2px rgba(0,0,0,0.15);">
            📱 SMS
          </a>
          <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-flex; align-items:center; justify-content:center; background:#f1f5f9; color:#0f172a; padding:6px 8px; border-radius:6px; font-size:11px; font-weight:bold; text-decoration:none; border:1px solid #cbd5e1;" title="Open in Google Maps">
            🗺
          </a>
        </div>
      </div>
    </div>
  `;
}

interface ClusterGroup {
  id: string;
  lat: number;
  lng: number;
  positions: VehiclePosition[];
}

export default function FleetLiveMap({ positions, selectedId, onSelect, className = '' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GMapsMap | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const infoWindowRef = useRef<any>(null);
  const markersRef = useRef<Map<string, GMapsMarker>>(new Map());
  const clusterMarkersRef = useRef<Map<string, GMapsMarker>>(new Map());
  const ringRef = useRef<GMapsCircle | null>(null);
  const ctorsRef = useRef<Awaited<ReturnType<typeof loadGoogleMaps>> | null>(null);
  const lastFitCountRef = useRef<number>(0);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentZoom, setCurrentZoom] = useState<number>(11);
  const [groupingEnabled, setGroupingEnabled] = useState<boolean>(true);

  // Bootstrap Google Map once
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps().then(ctors => {
      if (cancelled) return;
      ctorsRef.current = ctors;
      const el = containerRef.current;
      if (!el) return;

      if (!mapRef.current) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const gmaps = (window as any).google?.maps;
        const map = new ctors.Map(el, {
          center: DEFAULT_CENTER,
          zoom: 11,
          zoomControl: true,
          gestureHandling: 'greedy',
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
        });
        mapRef.current = map;

        if (gmaps?.InfoWindow) {
          infoWindowRef.current = new gmaps.InfoWindow({
            disableAutoPan: false,
          });
        }

        // Zoom change listener for auto grouping / ungrouping
        map.addListener('zoom_changed', () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const z = (map as any).getZoom?.() ?? 11;
          setCurrentZoom(z);
        });

        // Close InfoWindow when clicking blank map
        map.addListener('click', () => {
          infoWindowRef.current?.close();
        });
      }
      setLoading(false);
    }).catch(err => {
      if (cancelled) return;
      setError(err instanceof Error ? err.message : 'Failed to load Google Maps');
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, []);

  // Compute clusters when grouping is active and zoom is regional (<= 11)
  const { clusters, unclustered } = useMemo(() => {
    if (!groupingEnabled || currentZoom >= 12) {
      return { clusters: [] as ClusterGroup[], unclustered: positions };
    }

    const clusterRadiusDeg = 0.09; // Approx 9-10 km proximity threshold
    const groups: ClusterGroup[] = [];
    const assigned = new Set<string>();

    for (let i = 0; i < positions.length; i++) {
      const p1 = positions[i];
      if (assigned.has(p1.id)) continue;

      const groupPositions: VehiclePosition[] = [p1];
      for (let j = i + 1; j < positions.length; j++) {
        const p2 = positions[j];
        if (assigned.has(p2.id)) continue;

        const dLat = Math.abs(p1.lat - p2.lat);
        const dLng = Math.abs(p1.lng - p2.lng);
        if (dLat < clusterRadiusDeg && dLng < clusterRadiusDeg) {
          groupPositions.push(p2);
          assigned.add(p2.id);
        }
      }

      if (groupPositions.length > 1) {
        assigned.add(p1.id);
        const avgLat = groupPositions.reduce((s, p) => s + p.lat, 0) / groupPositions.length;
        const avgLng = groupPositions.reduce((s, p) => s + p.lng, 0) / groupPositions.length;
        groups.push({
          id: `cluster-${groups.length}`,
          lat: avgLat,
          lng: avgLng,
          positions: groupPositions,
        });
      }
    }

    const singles = positions.filter(p => !assigned.has(p.id));
    return { clusters: groups, unclustered: singles };
  }, [positions, groupingEnabled, currentZoom]);

  // Sync markers whenever positions, clusters, or grouping change
  useEffect(() => {
    const ctors = ctorsRef.current;
    const map = mapRef.current;
    if (!ctors || !map) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gmaps = (window as any).google?.maps;
    if (!gmaps) return;

    // 1. Render Clusters (if grouping is active)
    const nextClusterIds = new Set(clusters.map(c => c.id));
    clusterMarkersRef.current.forEach((m, id) => {
      if (!nextClusterIds.has(id)) {
        m.setMap(null);
        clusterMarkersRef.current.delete(id);
      }
    });

    for (const c of clusters) {
      const moving = c.positions.filter(p => (p.operationalStatus || p.status) === 'MOVING').length;
      const idle = c.positions.filter(p => (p.operationalStatus || p.status) === 'IDLE').length;
      const stop = c.positions.filter(p => (p.operationalStatus || p.status) === 'STOP').length;

      const iconUrl = buildClusterMarkerSvg(c.positions.length, moving, idle, stop);
      const existing = clusterMarkersRef.current.get(c.id);

      if (existing) {
        existing.setPosition({ lat: c.lat, lng: c.lng });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (existing as any).setIcon?.({
          url: iconUrl,
          scaledSize: new gmaps.Size(68, 68),
          anchor: new gmaps.Point(34, 34),
        });
      } else {
        const marker = new ctors.Marker({
          map,
          position: { lat: c.lat, lng: c.lng },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          icon: {
            url: iconUrl,
            scaledSize: new gmaps.Size(68, 68),
            anchor: new gmaps.Point(34, 34),
          },
          title: `Cluster: ${c.positions.length} Vehicles (Click to Zoom & Ungroup)`,
          zIndex: 100,
        });

        // Click to zoom in and expand cluster
        marker.addListener('click', () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (map as any).setZoom?.(13);
          map.panTo({ lat: c.lat, lng: c.lng });
        });

        clusterMarkersRef.current.set(c.id, marker);
      }
    }

    // 2. Render Unclustered / Individual Vehicle Markers
    const nextVehicleIds = new Set(unclustered.map(p => p.id));
    markersRef.current.forEach((m, id) => {
      if (!nextVehicleIds.has(id)) {
        m.setMap(null);
        markersRef.current.delete(id);
      }
    });

    for (const p of unclustered) {
      const iconUrl = buildVehicleMarkerSvg(p);
      const existing = markersRef.current.get(p.id);

      if (existing) {
        existing.setPosition({ lat: p.lat, lng: p.lng });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (existing as any).setIcon?.({
          url: iconUrl,
          scaledSize: new gmaps.Size(84, 72),
          anchor: new gmaps.Point(42, 24),
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (existing as any).setTitle?.(p.vehicle_plate || p.vehicle_id);
      } else {
        const marker = new ctors.Marker({
          map,
          position: { lat: p.lat, lng: p.lng },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          icon: {
            url: iconUrl,
            scaledSize: new gmaps.Size(84, 72),
            anchor: new gmaps.Point(42, 24),
          },
          title: `${p.vehicle_plate || p.vehicle_id} · ${p.speed_kmh.toFixed(0)} km/h`,
          zIndex: 10,
        });

        // Hover: Open Rich InfoWindow with Speed, Location, Driver, Trip, WhatsApp/SMS share
        marker.addListener('mouseover', () => {
          if (infoWindowRef.current) {
            infoWindowRef.current.setContent(buildInfoWindowHtml(p));
            infoWindowRef.current.open(map, marker);
          }
        });

        // Click: Select vehicle and keep InfoWindow open
        marker.addListener('click', () => {
          onSelect(p.id);
          if (infoWindowRef.current) {
            infoWindowRef.current.setContent(buildInfoWindowHtml(p));
            infoWindowRef.current.open(map, marker);
          }
        });

        markersRef.current.set(p.id, marker);
      }
    }

    // Auto fit bounds on initial load or vehicle count change
    if (positions.length > 0 && positions.length !== lastFitCountRef.current) {
      const bounds = new ctors.LatLngBounds();
      positions.forEach(p => bounds.extend({ lat: p.lat, lng: p.lng }));
      map.fitBounds(bounds, 60);
      lastFitCountRef.current = positions.length;
    }
  }, [clusters, unclustered, positions, onSelect]);

  // Selection Ring — Pulses around the selected vehicle
  useEffect(() => {
    const ctors = ctorsRef.current;
    const map = mapRef.current;
    if (!ctors || !map) return;

    ringRef.current?.setMap(null);
    ringRef.current = null;

    if (!selectedId) return;
    const sel = positions.find(p => p.id === selectedId);
    if (!sel) return;

    const color = getOperationalColor(sel.operationalStatus || sel.status);

    ringRef.current = new ctors.Circle({
      map,
      center: { lat: sel.lat, lng: sel.lng },
      radius: 160,
      strokeColor: color,
      strokeOpacity: 0.8,
      strokeWeight: 3,
      fillColor: color,
      fillOpacity: 0.15,
      clickable: false,
    });

    map.panTo({ lat: sel.lat, lng: sel.lng });
  }, [selectedId, positions]);

  // Reset / Recenter View
  const handleRecenter = useCallback(() => {
    const ctors = ctorsRef.current;
    const map = mapRef.current;
    if (!ctors || !map || positions.length === 0) return;
    const bounds = new ctors.LatLngBounds();
    positions.forEach(p => bounds.extend({ lat: p.lat, lng: p.lng }));
    map.fitBounds(bounds, 60);
  }, [positions]);

  return (
    <div className={`relative rounded-2xl border border-[var(--border-subtle)] overflow-hidden bg-[var(--bg-surface)] ${className}`}>
      <div ref={containerRef} className="absolute inset-0" />

      {/* Floating Interactive Controls: Grouping Toggle & Recenter */}
      <div className="absolute top-3 left-3 z-20 flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setGroupingEnabled(prev => !prev)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition shadow-lg backdrop-blur-md border ${
            groupingEnabled
              ? 'bg-cyan-500/90 hover:bg-cyan-600 text-white border-cyan-400'
              : 'bg-slate-900/80 hover:bg-slate-800 text-slate-300 border-slate-700'
          }`}
          title="Toggle location grouping / clustering when zooming out"
        >
          <span>❖ Group by Location:</span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-black ${groupingEnabled ? 'bg-white/20 text-white' : 'bg-slate-700 text-slate-400'}`}>
            {groupingEnabled ? 'ON' : 'OFF'}
          </span>
        </button>

        <button
          type="button"
          onClick={handleRecenter}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold bg-slate-900/80 hover:bg-slate-800 text-slate-200 border border-slate-700 shadow-lg backdrop-blur-md transition"
          title="Fit all fleet vehicles into map view"
        >
          <span>🎯 Fit Fleet</span>
        </button>

        <div className="hidden sm:flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-slate-900/70 text-slate-300 border border-slate-700/80 shadow backdrop-blur-md">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span>Moving</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-yellow-500" />
            <span>Dark Yellow (Idle)</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-rose-500" />
            <span>Stop</span>
          </span>
        </div>
      </div>

      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-[var(--text-muted)] bg-[var(--bg-surface)]/60 backdrop-blur-sm">
          Loading live fleet map…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-rose-300 bg-rose-500/10 p-4 text-center">
          {error}
        </div>
      )}
    </div>
  );
}
