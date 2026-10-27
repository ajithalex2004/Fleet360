'use client';
import Link from 'next/link';

/**
 * src/app/(app)/fleet/telematics/page.tsx
 *
 * Live Telematics & IoT Gateway Ingestion Console (Pattern A).
 *
 * Features:
 *   - Live Device Registry & Vehicle Pairing (IMEI, Model, SIM, Status)
 *   - Real-time Telemetry Grid (Speed, Odometer, Fuel %, Heading, Last Ping)
 *   - Webhook Ingestion Simulator & Tester (Flespi / Teltonika / Traccar / Generic)
 *   - Gateway Configuration Guide & cURL generator
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { ACTIVE_TOGGLE_BORDERED } from '@/lib/ui/toggle';
import {
  Radio,
  WifiOff,
  Activity,
  Cpu,
  RefreshCw,
  Search,
  Play,
  Copy,
  Check,
  Zap,
  Clock,
  AlertTriangle,
  Terminal,
  Navigation,
  History as HistoryIcon,
  CheckCircle2,
  Wrench,
  ArrowRight,
  ShieldCheck,
  Shield,
  Award,
  Flame,
  LayoutGrid,
  MapPin,
  Loader2,
  Gauge,
  Fuel,
  Smartphone,
  User,
  Phone,
  MoreVertical,
  Map,
  ExternalLink,
} from 'lucide-react';
import type { VehiclePosition } from '@/components/shared/FleetLiveMap';

const FleetLiveMap = dynamic(() => import('@/components/shared/FleetLiveMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[550px] w-full rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-muted)] text-sm">
      <Loader2 className="w-6 h-6 animate-spin text-cyan-400 mr-2" />
      Loading Google Maps & Live Telematics Fleet View…
    </div>
  ),
});

const VehicleTrackingHistoryModal = dynamic(
  () => import('@/components/telematics/VehicleTrackingHistoryModal'),
  { ssr: false }
);

interface DriverSafetyEntry {
  driverId: string;
  driverName: string;
  phone: string | null;
  status?: string | null;
  score: number;
  ragStatus: 'GREEN' | 'AMBER' | 'RED';
  harshBrakes: number;
  harshAccels: number;
  harshCornerings?: number;
  overspeedEvents: number;
  excessiveIdlingMins?: number;
  summary: string;
}

interface FuelAlertEntry {
  id: string;
  severity?: string | null;
  title: string;
  description: string | null;
  createdAt: string;
}

interface DtcServiceRequestEntry {
  id: string;
  priority: string | null;
  status: string | null;
  description?: string | null;
  vehicle: { id: string; vehicleCode: string | null; licensePlate: string | null; deviceId: string | null } | null;
  createdAt: string;
}

interface TelematicsAnalyticsData {
  driverLeaderboard: DriverSafetyEntry[];
  averageSafetyScore: number;
  fuelAlerts: FuelAlertEntry[];
  dtcServiceRequests: DtcServiceRequestEntry[];
  referenceDtcs?: unknown;
}

interface AutomationStopEntry {
  stopId: string;
  stopName: string;
  sequence: number;
  gpsLat: number | null;
  gpsLng: number | null;
  approachedAt: string | null;
  enteredAt: string | null;
  leftAt: string | null;
  state: 'PENDING' | 'APPROACHING' | 'AT_STOP' | 'DEPARTED';
}

interface AutomationTripProgress {
  tripId: string;
  tripNumber: string | null;
  shiftType: string | null;
  status: string | null;
  departureTime: string;
  estimatedArrival: string | null;
  vehicle: { id: string; vehicleCode: string | null; licensePlate: string | null; deviceId: string | null } | null;
  driver: { id: string; firstName: string; lastName: string } | null;
  routeName: string;
  totalStops: number;
  completedStops: number;
  currentStop: AutomationStopEntry | null;
  stops: AutomationStopEntry[];
}

interface PmStatusEntry {
  vehicleId: string;
  vehicleCode: string | null;
  licensePlate: string | null;
  make: string | null;
  model: string | null;
  deviceId: string | null;
  currentOdometerKm: number;
  nextDueKm: number;
  kmRemaining: number;
  status: 'OK' | 'DUE_SOON' | 'OVERDUE';
}

interface TelematicsAutomationData {
  activeTripsCount: number;
  activeTripProgress: AutomationTripProgress[];
  pmDueSoonCount: number;
  pmOverdueCount: number;
  pmStatusList: PmStatusEntry[];
}

// The webhook simulator posts arbitrary vendor-shaped payloads (Flespi/Teltonika/
// Traccar/generic) and echoes back whatever the normalizer parsed — `success`/
// `error` are the only fields every vendor path shares, the rest is dynamic.
interface SimWebhookResponse {
  status: number;
  data: { success?: boolean; error?: string } & Record<string, unknown>;
}

export interface TelematicsAlert {
  id: string;
  type: 'OVERSPEEDING' | 'HARSH_BRAKING' | 'HARSH_ACCELERATION' | 'EXCESS_IDLING' | 'GEOFENCE_ENTRY' | 'GEOFENCE_EXIT' | 'OTHER';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  title: string;
  description: string;
  timestamp: string;
}

export interface DeviceLocation {
  locationName: string;
  district: string;
  coordinatesFormatted: string;
  latitude: number;
  longitude: number;
  dateFormatted: string;
  timeFormatted: string;
  relativeFreshness: string;
  timestampIso: string;
  geofenceZone?: string | null;
  insideGeofence: boolean;
}

interface DeviceItem {
  vehicleId: string;
  vehicleCode: string | null;
  licensePlate: string | null;
  make: string | null;
  model: string | null;
  type: string | null;
  deviceId: string | null;
  simCardNo: string | null;
  odometerKm: number;
  fuelLevelPercent: number | null;
  operationalStatus: 'MOVING' | 'IDLE' | 'STOP';
  connectionStatus?: 'MOVING' | 'IDLE' | 'STOP' | string;
  isMobileTracking?: boolean;
  isDeviceBlank?: boolean;
  driver?: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
  } | null;
  location?: DeviceLocation | null;
  alerts?: TelematicsAlert[];
  hasActiveAlerts?: boolean;
  job?: {
    id: string;
    tripNumber: string;
    status: string;
    title: string;
    routeId: string | null;
  } | null;
  isOnTrip?: boolean;
  lastPing: {
    latitude: number;
    longitude: number;
    speedKmh: number;
    headingDeg: number;
    occurredAt: string;
    source?: string;
  } | null;
}

function getVehicleShareUrls(d: DeviceItem) {
  const statusStr = (d.operationalStatus || d.connectionStatus || 'STOP').toUpperCase();
  const statusLabel = statusStr === 'MOVING' ? '🟢 Moving' : statusStr === 'IDLE' ? '🟡 Idle' : '🔴 Stop';
  const speedText = d.lastPing ? `${d.lastPing.speedKmh.toFixed(0)} km/h` : '0 km/h';
  const locationText = d.location?.locationName || (d.lastPing ? `${d.lastPing.latitude.toFixed(5)}, ${d.lastPing.longitude.toFixed(5)}` : 'Location unknown');
  const driverText = d.driver ? `Driver: ${d.driver.name} (${d.driver.phone || 'No phone'})` : 'Driver: Unassigned';
  const jobText = d.job?.title ? `Trip: ${d.job.title}` : d.isOnTrip ? 'Active Trip' : '';
  const lat = d.lastPing?.latitude || d.location?.latitude || 24.4539;
  const lng = d.lastPing?.longitude || d.location?.longitude || 54.3773;
  const mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;
  const now = new Date().toLocaleTimeString();

  const msg = [
    `*Fleet360 Live Vehicle Location*`,
    `🚗 Vehicle: ${d.licensePlate || d.vehicleCode || 'Asset'}`,
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

export default function TelematicsPage() {
  const [loading, setLoading] = useState(true);
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [filter, setFilter] = useState<'ALL' | 'MOVING' | 'IDLE' | 'STOP' | 'ALERTS'>('ALL');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'map'>('grid');
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [historyModalVehicle, setHistoryModalVehicle] = useState<{ id: string; codeOrPlate?: string } | null>(null);
  const [activeActionMenuId, setActiveActionMenuId] = useState<string | null>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-telematics-actions]')) {
        setActiveActionMenuId(null);
      }
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, []);

  // Active Tab state
  const [activeTab, setActiveTab] = useState<'devices' | 'automation' | 'safety' | 'simulator' | 'guide'>('devices');
  const [automationData, setAutomationData] = useState<TelematicsAutomationData | null>(null);
  const [automationLoading, setAutomationLoading] = useState(false);
  const [analyticsData, setAnalyticsData] = useState<TelematicsAnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  const [simVendor, setSimVendor] = useState<'flespi' | 'teltonika' | 'traccar' | 'generic'>('flespi');
  const [simPayload, setSimPayload] = useState('');
  const [simSubmitting, setSimSubmitting] = useState(false);
  const [simResponse, setSimResponse] = useState<SimWebhookResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const isFetchingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchDevices = useCallback(async (showSpinner = false) => {
    // Avoid concurrent overlapping requests
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    if (showSpinner) setLoading(true);

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch('/api/telematics/devices', {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.devices)) {
          setDevices(data.devices);
        }
      }
    } catch (err: unknown) {
      // Ignore clean aborts
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (showSpinner) {
        console.warn('[telematics] Initial device fetch warning:', err instanceof Error ? err.message : err);
      }
    } finally {
      isFetchingRef.current = false;
      if (showSpinner) setLoading(false);
    }
  }, []);

  const fetchAutomation = useCallback(async () => {
    setAutomationLoading(true);
    try {
      const res = await fetch('/api/telematics/automation', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setAutomationData(data);
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.warn('[telematics] Automation fetch warning:', err instanceof Error ? err.message : err);
    } finally {
      setAutomationLoading(false);
    }
  }, []);

  const fetchAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const res = await fetch('/api/telematics/analytics', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setAnalyticsData(data);
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.warn('[telematics] Analytics fetch warning:', err instanceof Error ? err.message : err);
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    let pollTimer: NodeJS.Timeout | null = null;

    // Initial load
    void fetchDevices(true);
    if (activeTab === 'automation') {
      void fetchAutomation();
    } else if (activeTab === 'safety') {
      void fetchAnalytics();
    }

    // Realtime background sync: self-scheduling loop (polls 4s AFTER previous query finishes)
    // Prevents request overlap, browser connection exhaustion, and transient fetch errors
    const scheduleNextPoll = () => {
      if (!isMounted) return;
      pollTimer = setTimeout(async () => {
        if (!isMounted) return;

        // Only poll if document is visible (prevents timer throttle queue backlog when tab is hidden)
        if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
          await fetchDevices(false);

          if (activeTab === 'automation' && isMounted) {
            try {
              const r = await fetch('/api/telematics/automation', { cache: 'no-store' });
              if (r.ok && isMounted) {
                const d = await r.json();
                if (d && isMounted) setAutomationData(d);
              }
            } catch {
              // Ignore background errors
            }
          }
        }

        if (isMounted) {
          scheduleNextPoll();
        }
      }, 4000);
    };

    scheduleNextPoll();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isMounted) {
        void fetchDevices(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isMounted = false;
      if (pollTimer) clearTimeout(pollTimer);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchDevices, fetchAutomation, fetchAnalytics, activeTab]);

  // Check for ?history= query param on load
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      const hist = sp.get('history') || sp.get('historyVehicleId');
      if (hist) {
        setHistoryModalVehicle({ id: hist, codeOrPlate: hist });
      }
    }
  }, []);

  // Load sample payloads for simulator
  useEffect(() => {
    const defaultImei = devices.find((d) => d.deviceId)?.deviceId || '864201047281920';

    if (simVendor === 'flespi') {
      setSimPayload(
        JSON.stringify(
          [
            {
              ident: defaultImei,
              timestamp: Math.floor(Date.now() / 1000),
              'position.latitude': 25.0418,
              'position.longitude': 55.1402,
              'position.speed': 64.5,
              'position.direction': 142,
              'position.altitude': 15,
              'position.satellites': 14,
              'engine.ignition.status': true,
              'can.vehicle.mileage': 148200,
              'can.fuel.level': 78,
              'battery.voltage': 24.2,
            },
          ],
          null,
          2,
        ),
      );
    } else if (simVendor === 'teltonika') {
      setSimPayload(
        JSON.stringify(
          {
            imei: defaultImei,
            timestamp: new Date().toISOString(),
            lat: 25.1025,
            lng: 55.1984,
            speed: 82,
            angle: 270,
            altitude: 20,
            io: {
              ignition: 1,
              odometer: 89450,
              fuel: 65,
              battery_voltage: 12.8,
              sos: 0,
            },
          },
          null,
          2,
        ),
      );
    } else if (simVendor === 'traccar') {
      setSimPayload(
        JSON.stringify(
          {
            deviceId: defaultImei,
            fixTime: new Date().toISOString(),
            latitude: 24.9812,
            longitude: 55.0841,
            speed: 52.3,
            course: 90,
            attributes: {
              ignition: true,
              odometer: 112400,
              fuelLevel: 84,
            },
          },
          null,
          2,
        ),
      );
    } else {
      setSimPayload(
        JSON.stringify(
          {
            imei: defaultImei,
            occurredAt: new Date().toISOString(),
            latitude: 25.0657,
            longitude: 55.1712,
            speedKmh: 75.0,
            headingDeg: 180,
            odometerKm: 95400,
            fuelLevelPercent: 72,
            ignition: true,
          },
          null,
          2,
        ),
      );
    }
  }, [simVendor, devices]);

  const handleSimulateWebhook = async () => {
    setSimSubmitting(true);
    setSimResponse(null);
    try {
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(simPayload);
      } catch {
        alert('Invalid JSON in payload editor');
        setSimSubmitting(false);
        return;
      }

      // Signed in: the webhook records the ping for this session's tenant.
      const res = await fetch('/api/telematics/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsedBody),
      });

      const data = await res.json();
      setSimResponse({ status: res.status, data });
      if (res.ok) {
        fetchDevices();
      }
    } catch (err) {
      setSimResponse({
        status: 500,
        data: { error: err instanceof Error ? err.message : 'Simulation failed' },
      });
    } finally {
      setSimSubmitting(false);
    }
  };

  const handleCopyUrl = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const filtered = devices.filter((d) => {
    const status = d.operationalStatus || d.connectionStatus;
    if (filter === 'ALERTS') {
      if (!d.hasActiveAlerts && (!d.alerts || d.alerts.length === 0)) return false;
    } else if (filter !== 'ALL' && status !== filter) {
      return false;
    }

    if (search) {
      const q = search.toLowerCase();
      const code = (d.vehicleCode || '').toLowerCase();
      const plate = (d.licensePlate || '').toLowerCase();
      const imei = (d.deviceId || '').toLowerCase();
      const make = (d.make || '').toLowerCase();
      const driverName = (d.driver?.name || '').toLowerCase();
      const driverPhone = (d.driver?.phone || '').toLowerCase();
      const locName = (d.location?.locationName || '').toLowerCase();
      const district = (d.location?.district || '').toLowerCase();
      const alertsText = (d.alerts || []).map((a) => `${a.title} ${a.description}`).join(' ').toLowerCase();

      return (
        code.includes(q) ||
        plate.includes(q) ||
        imei.includes(q) ||
        make.includes(q) ||
        driverName.includes(q) ||
        driverPhone.includes(q) ||
        locName.includes(q) ||
        district.includes(q) ||
        alertsText.includes(q)
      );
    }
    return true;
  });

  const movingCount = devices.filter((d) => (d.operationalStatus || d.connectionStatus) === 'MOVING').length;
  const idleCount = devices.filter((d) => (d.operationalStatus || d.connectionStatus) === 'IDLE').length;
  const stopCount = devices.filter((d) => (d.operationalStatus || d.connectionStatus) === 'STOP').length;
  const alertVehiclesCount = devices.filter((d) => d.hasActiveAlerts || (d.alerts && d.alerts.length > 0)).length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-[var(--text-main)] flex items-center gap-2">
              <Radio className="w-6 h-6 text-cyan-400" />
              Live Telematics &amp; Fleet Map
            </h1>
            <span className="px-2 py-0.5 text-xs font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 rounded-full">
              Live Fleet Monitoring
            </span>
          </div>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Real-time GPS tracking and live operational status: Moving, Idle, and Stop.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/fleet/vehicles"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 text-xs font-semibold border border-cyan-500/30 transition shadow-sm"
          >
            <Cpu className="w-4 h-4 text-cyan-400" />
            Manage Hardware in Fleet Master ↗
          </Link>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 text-xs font-mono shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-semibold">Realtime Sync (3s)</span>
          </div>
          <button
            onClick={() => fetchDevices(true)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-main)] text-sm font-medium border border-[var(--border-subtle)] transition"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* KPI Cards: Operational Vehicle Status */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div 
          onClick={() => setFilter('ALL')}
          className={`p-4 rounded-2xl bg-[var(--bg-surface)]/60 border cursor-pointer transition ${
            filter === 'ALL' ? 'border-cyan-500 shadow-md ring-1 ring-cyan-500/30' : 'border-[var(--border-subtle)] hover:border-[var(--border-strong)]'
          } space-y-1`}
        >
          <p className="text-xs text-[var(--text-muted)] font-medium">Total Fleet</p>
          <p className="text-2xl font-bold text-[var(--text-main)]">{devices.length}</p>
          <p className="text-[11px] text-[var(--text-faint)]">All registered vehicles</p>
        </div>

        <div 
          onClick={() => setFilter('MOVING')}
          className={`p-4 rounded-2xl bg-emerald-950/30 border cursor-pointer transition ${
            filter === 'MOVING' ? 'border-emerald-500 shadow-md ring-1 ring-emerald-500/30' : 'border-emerald-500/30 hover:border-emerald-500/50'
          } space-y-1`}
        >
          <div className="flex items-center justify-between">
            <p className="text-xs text-emerald-400 font-bold uppercase tracking-wider">Moving (Green)</p>
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
          </div>
          <p className="text-2xl font-bold text-emerald-300">{movingCount}</p>
          <p className="text-[11px] text-emerald-500/80">Speed &gt; 0 km/h · On road</p>
        </div>

        <div 
          onClick={() => setFilter('IDLE')}
          className={`p-4 rounded-2xl bg-yellow-950/30 border cursor-pointer transition ${
            filter === 'IDLE' ? 'border-yellow-500 shadow-md ring-1 ring-yellow-500/30' : 'border-yellow-500/30 hover:border-yellow-500/50'
          } space-y-1`}
        >
          <div className="flex items-center justify-between">
            <p className="text-xs text-yellow-400 font-bold uppercase tracking-wider">Idle (Dark Yellow)</p>
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
          </div>
          <p className="text-2xl font-bold text-yellow-300">{idleCount}</p>
          <p className="text-[11px] text-yellow-500/80">Ignition ON · Speed 0 km/h</p>
        </div>

        <div 
          onClick={() => setFilter('STOP')}
          className={`p-4 rounded-2xl bg-rose-950/30 border cursor-pointer transition ${
            filter === 'STOP' ? 'border-rose-500 shadow-md ring-1 ring-rose-500/30' : 'border-rose-500/30 hover:border-rose-500/50'
          } space-y-1`}
        >
          <div className="flex items-center justify-between">
            <p className="text-xs text-rose-400 font-bold uppercase tracking-wider">Stop (Red)</p>
            <span className="w-2.5 h-2.5 rounded-full bg-rose-400" />
          </div>
          <p className="text-2xl font-bold text-rose-300">{stopCount}</p>
          <p className="text-[11px] text-rose-500/80">Parked / Ignition OFF</p>
        </div>

        <div 
          onClick={() => setFilter('ALERTS')}
          className={`p-4 rounded-2xl bg-rose-950/20 border cursor-pointer transition ${
            filter === 'ALERTS' ? 'border-rose-500 shadow-md ring-1 ring-rose-500/40' : 'border-rose-500/30 hover:border-rose-500/50'
          } space-y-1 col-span-2 sm:col-span-1`}
        >
          <div className="flex items-center justify-between">
            <p className="text-xs text-rose-400 font-bold uppercase tracking-wider">Alerts (Active)</p>
            {alertVehiclesCount > 0 ? (
              <span className="w-2.5 h-2.5 rounded-full bg-rose-400 animate-ping" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            )}
          </div>
          <p className="text-2xl font-bold text-rose-300">{alertVehiclesCount}</p>
          <p className="text-[11px] text-rose-400/80">Overspeed, Idle, Harsh, Geofence</p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('devices')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition shrink-0 ${
            activeTab === 'devices'
              ? 'bg-cyan-500 text-white shadow'
              : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-surface)]/50'
          }`}
        >
          <Cpu className="w-4 h-4" />
          Live Device Fleet ({devices.length})
        </button>

        <button
          onClick={() => setActiveTab('automation')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition shrink-0 ${
            activeTab === 'automation'
              ? 'bg-emerald-500 text-white shadow'
              : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-surface)]/50'
          }`}
        >
          <Navigation className="w-4 h-4" />
          Automation & Geofences (Phase 2)
        </button>

        <button
          onClick={() => setActiveTab('safety')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition shrink-0 ${
            activeTab === 'safety'
              ? 'bg-rose-500 text-white shadow'
              : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-surface)]/50'
          }`}
        >
          <Shield className="w-4 h-4" />
          Safety & Diagnostics (Phase 3)
        </button>

        <button
          onClick={() => setActiveTab('simulator')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition shrink-0 ${
            activeTab === 'simulator'
              ? 'bg-amber-500 text-white shadow'
              : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-surface)]/50'
          }`}
        >
          <Terminal className="w-4 h-4" />
          Webhook Simulator & Tester
        </button>

        <button
          onClick={() => setActiveTab('guide')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition shrink-0 ${
            activeTab === 'guide'
              ? 'bg-violet-500 text-white shadow'
              : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-surface)]/50'
          }`}
        >
          <Zap className="w-4 h-4" />
          Gateway Setup Guide
        </button>
      </div>

      {/* TAB 1: Live Devices Grid & Map */}
      {activeTab === 'devices' && (
        <div className="space-y-4">
          {/* Filter, View Toggle, and Search Bar */}
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
            <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto">
              {(['ALL', 'MOVING', 'IDLE', 'STOP', 'ALERTS'] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setFilter(status)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wider transition ${
                    filter === status
                      ? ACTIVE_TOGGLE_BORDERED
                      : 'bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-main)] border border-transparent'
                  }`}
                >
                  {status === 'ALL'
                    ? 'All Fleet'
                    : status === 'MOVING'
                    ? '🟢 Moving'
                    : status === 'IDLE'
                    ? '🟡 Idle'
                    : status === 'STOP'
                    ? '🔴 Stop'
                    : '🚨 With Alerts'}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2.5 w-full sm:w-auto">
              {/* Grid / Map View Toggle Button */}
              <div className="flex items-center bg-[var(--bg-surface)] p-1 rounded-xl border border-[var(--border-subtle)] shrink-0">
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    viewMode === 'grid'
                      ? 'bg-cyan-500 text-white shadow-sm'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                  }`}
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  Grid View
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('map')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    viewMode === 'map'
                      ? 'bg-cyan-500 text-white shadow-sm'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                  }`}
                >
                  <MapPin className="w-3.5 h-3.5" />
                  Map View
                </button>
              </div>

              <div className="relative flex-1 sm:w-64">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-[var(--text-faint)]" />
                <input
                  type="text"
                  placeholder="Search code, plate, IMEI..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl pl-9 pr-3 py-1.5 text-sm text-[var(--text-main)] focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>
          </div>

          {/* VIEW: Map View */}
          {viewMode === 'map' && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-[var(--border-subtle)] overflow-hidden bg-[var(--bg-surface)]/60 shadow-xl relative">
                <FleetLiveMap
                  positions={filtered.map((d, index) => {
                    const isMoving = (d.operationalStatus || d.connectionStatus) === 'MOVING';
                    const isIdle = (d.operationalStatus || d.connectionStatus) === 'IDLE';

                    // Use reported coordinates or default clustered in UAE corridor
                    const defaultBaseLat = 25.1972 + ((index * 7) % 20) * 0.015 - 0.1;
                    const defaultBaseLng = 55.2744 + ((index * 11) % 20) * 0.015 - 0.1;

                    const lat = d.lastPing?.latitude || defaultBaseLat;
                    const lng = d.lastPing?.longitude || defaultBaseLng;

                    const secondsSincePing = d.lastPing?.occurredAt 
                      ? Math.max(0, Math.floor((Date.now() - new Date(d.lastPing.occurredAt).getTime()) / 1000))
                      : isMoving ? 30 : 7200;

                    return {
                      id: d.vehicleId,
                      vehicle_id: d.vehicleId,
                      vehicle_plate: d.licensePlate || d.vehicleCode || 'Asset',
                      lat,
                      lng,
                      status: isMoving ? 'EN_ROUTE' : isIdle ? 'IDLE' : 'OFFLINE',
                      operationalStatus: isMoving ? 'MOVING' : isIdle ? 'IDLE' : 'STOP',
                      is_online: isMoving || isIdle,
                      seconds_since_ping: secondsSincePing,
                      speed_kmh: d.lastPing?.speedKmh ?? 0,
                      type: d.type,
                      make: d.make,
                      model: d.model,
                      driverName: d.driver?.name || null,
                      driverPhone: d.driver?.phone || null,
                      jobTitle: d.job?.title || null,
                      isOnTrip: Boolean(d.isOnTrip || d.job),
                      locationName: d.location?.locationName || null,
                      district: d.location?.district || null,
                    };
                  })}
                  selectedId={selectedVehicleId}
                  onSelect={(id) => setSelectedVehicleId(id)}
                  className="h-[620px] w-full"
                />
              </div>

              {/* Selected Vehicle Telemetry Card */}
              {(() => {
                const sel = devices.find(d => d.vehicleId === selectedVehicleId);
                if (!sel) return (
                  <div className="p-3 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl text-xs text-[var(--text-muted)] flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <MapPin className="w-4 h-4 text-cyan-400" /> Click any vehicle pin on the map to inspect live telematics, speed, and GPS metrics.
                    </span>
                    <span className="text-[11px] font-mono text-[var(--text-muted)]">Showing {filtered.length} vehicles on map</span>
                  </div>
                );

                const isMoving = (sel.operationalStatus || sel.connectionStatus) === 'MOVING';
                const isIdle = (sel.operationalStatus || sel.connectionStatus) === 'IDLE';

                return (
                  <div className="p-4 bg-[var(--bg-surface)] border border-cyan-500/40 rounded-2xl shadow-lg space-y-3">
                    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                          <Navigation className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-bold text-[var(--text-main)] font-mono">
                              {sel.licensePlate || sel.vehicleCode || 'Asset'}
                            </h4>
                            {isMoving ? (
                              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                Moving
                              </span>
                            ) : isIdle ? (
                              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-yellow-500/20 text-yellow-300 border border-yellow-500/40 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
                                Idle
                              </span>
                            ) : (
                              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                                Stop
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-[var(--text-muted)] mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span>{sel.make} {sel.model} • Code: {sel.vehicleCode || '—'}</span>
                            <span>•</span>
                            <span>{sel.isMobileTracking ? '📱 Driver Mobile GPS' : `IMEI: ${sel.deviceId || 'Unpaired'}`}</span>
                            {sel.driver && (
                              <>
                                <span>•</span>
                                <span className="font-semibold text-cyan-300">👤 {sel.driver.name}</span>
                                {sel.driver.phone && (
                                  <a
                                    href={`tel:${sel.driver.phone}`}
                                    className="inline-flex items-center gap-0.5 text-emerald-400 hover:text-emerald-300 hover:underline font-mono"
                                  >
                                    <Phone className="w-3 h-3 shrink-0" />
                                    <span>{sel.driver.phone}</span>
                                  </a>
                                )}
                              </>
                            )}
                            {(sel.job || sel.isOnTrip) && (
                              <>
                                <span>•</span>
                                <span className="font-bold text-rose-400 bg-rose-950/60 border border-rose-500/40 px-2 py-0.5 rounded text-[10px]">
                                  🚩 {sel.job?.title || 'On Trip'}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-4 gap-4 text-xs font-mono">
                        <div className="bg-[var(--bg-canvas)] px-3 py-2 rounded-xl border border-[var(--border-subtle)]">
                          <div className="text-[10px] text-[var(--text-muted)] font-sans uppercase">Speed</div>
                          <div className="font-bold text-cyan-400 text-sm">{sel.lastPing?.speedKmh?.toFixed(1) ?? '0.0'} km/h</div>
                        </div>
                        <div className="bg-[var(--bg-canvas)] px-3 py-2 rounded-xl border border-[var(--border-subtle)]">
                          <div className="text-[10px] text-[var(--text-muted)] font-sans uppercase">Odometer</div>
                          <div className="font-bold text-[var(--text-main)] text-sm">{sel.odometerKm?.toLocaleString() ?? 0} km</div>
                        </div>
                        <div className="bg-[var(--bg-canvas)] px-3 py-2 rounded-xl border border-[var(--border-subtle)]">
                          <div className="text-[10px] text-[var(--text-muted)] font-sans uppercase">Fuel Level</div>
                          <div className="font-bold text-emerald-400 text-sm">{sel.fuelLevelPercent != null ? `${sel.fuelLevelPercent.toFixed(0)}%` : '—'}</div>
                        </div>
                        <div className="bg-[var(--bg-canvas)] px-3 py-2 rounded-xl border border-[var(--border-subtle)]">
                          <div className="text-[10px] text-[var(--text-muted)] font-sans uppercase">Last Ping</div>
                          <div className="font-semibold text-[var(--text-main)] text-xs">
                            {sel.lastPing ? new Date(sel.lastPing.occurredAt).toLocaleTimeString() : 'Never'}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        <a
                          href={getVehicleShareUrls(sel).whatsappUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-md active:scale-95"
                          title="Share vehicle live location via WhatsApp"
                        >
                          💬 WhatsApp
                        </a>
                        <a
                          href={getVehicleShareUrls(sel).smsUrl}
                          className="px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-md active:scale-95"
                          title="Share vehicle live location via SMS"
                        >
                          📱 SMS
                        </a>
                        <button
                          onClick={() => setHistoryModalVehicle({ id: sel.vehicleId, codeOrPlate: sel.licensePlate || sel.vehicleCode || undefined })}
                          className="px-3.5 py-2 rounded-xl bg-cyan-500/25 hover:bg-cyan-500/35 text-cyan-200 text-xs font-bold border border-cyan-500/50 transition flex items-center gap-1.5 shadow-md active:scale-95"
                          title="View full historical GPS tracking & route breadcrumb log"
                        >
                          <HistoryIcon className="w-4 h-4 text-cyan-400" /> History Tracking
                        </button>
                        <Link
                          href={`/fleet/vehicles?search=${encodeURIComponent(sel.licensePlate || sel.vehicleCode || '')}`}
                          className="px-3.5 py-2 rounded-xl bg-[var(--bg-surface-hover)] hover:bg-[var(--border-subtle)] text-[var(--text-main)] text-xs font-semibold border border-[var(--border-subtle)] transition flex items-center gap-1 shadow-sm"
                          title="Open vehicle in Fleet Master to manage hardware pairing"
                        >
                          Fleet Master ↗
                        </Link>
                        <button
                          onClick={() => setSelectedVehicleId(null)}
                          className="px-3 py-2 rounded-xl bg-[var(--bg-surface-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)] text-xs transition"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>

                    {/* Live Location and Alerts Detail Bar */}
                    <div className="pt-2 border-t border-[var(--border-subtle)] flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-2 flex-wrap">
                        <MapPin className="w-4 h-4 text-cyan-400 shrink-0" />
                        <span className="text-[var(--text-muted)]">Location:</span>
                        <span className="font-semibold text-[var(--text-main)]">
                          {sel.location?.locationName || 'Location Unknown'}
                        </span>
                        {sel.location?.coordinatesFormatted && (
                          <span className="font-mono text-[10px] bg-cyan-950/60 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded">
                            {sel.location.coordinatesFormatted}
                          </span>
                        )}
                        {sel.location && (
                          <span className="text-[11px] text-[var(--text-faint)] flex items-center gap-1">
                            <Clock className="w-3 h-3 text-[var(--text-muted)]" />
                            {sel.location.dateFormatted} · {sel.location.timeFormatted} ({sel.location.relativeFreshness})
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] text-[var(--text-muted)] font-medium">Alerts:</span>
                        {sel.alerts && sel.alerts.length > 0 ? (
                          sel.alerts.map((alert) => (
                            <span
                              key={alert.id}
                              title={alert.description}
                              className={`px-2 py-0.5 rounded-md text-[10px] font-bold border flex items-center gap-1 ${
                                alert.type === 'OVERSPEEDING'
                                  ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse'
                                  : alert.type === 'HARSH_BRAKING'
                                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                  : alert.type === 'HARSH_ACCELERATION'
                                  ? 'bg-orange-500/20 text-orange-300 border-orange-500/40'
                                  : alert.type === 'EXCESS_IDLING'
                                  ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40'
                                  : alert.type === 'GEOFENCE_ENTRY' || alert.type === 'GEOFENCE_EXIT'
                                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                                  : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                              }`}
                            >
                              {alert.type === 'OVERSPEEDING' && '🚨 '}
                              {alert.type === 'HARSH_BRAKING' && '⚠️ '}
                              {alert.type === 'HARSH_ACCELERATION' && '⚡ '}
                              {alert.type === 'EXCESS_IDLING' && '⏳ '}
                              {(alert.type === 'GEOFENCE_ENTRY' || alert.type === 'GEOFENCE_EXIT') && '📍 '}
                              <span>{alert.title}</span>
                            </span>
                          ))
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            Normal (No Alerts)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* VIEW: Grid Table */}
          {viewMode === 'grid' && (
          <div className="rounded-2xl border border-[var(--border-subtle)] overflow-hidden bg-[var(--bg-surface)]/60 shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-[var(--text-muted)] min-w-[1720px]">
                <thead className="bg-[var(--bg-canvas)]/80 text-[var(--text-muted)] uppercase tracking-wider font-semibold border-b border-[var(--border-subtle)]">
                  <tr>
                    <th className="p-4 w-[210px] min-w-[210px]">Vehicle</th>
                    <th className="p-4 w-[230px] min-w-[230px]">Driver &amp; Contact</th>
                    <th className="p-4 w-[280px] min-w-[280px]">Current Location</th>
                    <th className="p-4 w-[190px] min-w-[190px]">Location Date &amp; Time</th>
                    <th className="p-4 w-[160px] min-w-[160px]">Status &amp; Speed</th>
                    <th className="p-4 w-[230px] min-w-[230px]">Active Alerts</th>
                    <th className="p-4 w-[170px] min-w-[170px]">Odometer &amp; Fuel</th>
                    <th className="p-4 w-[190px] min-w-[190px]">Hardware / Device</th>
                    <th className="p-4 w-[90px] min-w-[90px] text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-10 text-center text-[var(--text-faint)]">
                        No devices found matching filter criteria.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((d) => {
                      const isMoving = (d.operationalStatus || d.connectionStatus) === 'MOVING';
                      const isIdle = (d.operationalStatus || d.connectionStatus) === 'IDLE';

                      return (
                        <tr key={d.vehicleId} className="hover:bg-[var(--bg-surface-hover)] transition">
                          <td className="p-4 font-medium w-[210px] min-w-[210px]">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-[var(--text-main)] text-sm">
                                {d.vehicleCode || d.licensePlate || 'Unnamed Asset'}
                              </span>
                              {(d.job || d.isOnTrip) && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-rose-500/20 text-rose-300 border border-rose-500/40" title={d.job?.title || 'Active Trip'}>
                                  🚩 TRIP
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-[var(--text-faint)] mt-0.5">
                              {d.licensePlate ? `Plate: ${d.licensePlate}` : ''}{' '}
                              {d.make ? `· ${d.make} ${d.model || ''}` : ''}
                            </div>
                          </td>

                          <td className="p-4 w-[230px] min-w-[230px]">
                            {d.driver ? (
                              <div className="space-y-1">
                                <div className="flex items-center gap-2 font-bold text-[var(--text-main)] text-xs">
                                  <span className="w-6 h-6 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30 flex items-center justify-center text-[10px] font-black shrink-0">
                                    {d.driver.name.charAt(0).toUpperCase()}
                                  </span>
                                  <span className="truncate max-w-[170px] font-semibold">{d.driver.name}</span>
                                </div>
                                {d.driver.phone ? (
                                  <div className="pl-8">
                                    <a
                                      href={`tel:${d.driver.phone}`}
                                      className="inline-flex items-center gap-1.5 text-[11px] font-mono text-emerald-400 hover:text-emerald-300 hover:underline"
                                      onClick={(e) => e.stopPropagation()}
                                      title="Click to call driver"
                                    >
                                      <Phone className="w-3 h-3 text-emerald-400 shrink-0" />
                                      <span>{d.driver.phone}</span>
                                    </a>
                                  </div>
                                ) : (
                                  <div className="text-[10px] text-[var(--text-faint)] pl-8">No phone</div>
                                )}
                              </div>
                            ) : (
                              <span className="text-[var(--text-faint)] italic">Unassigned</span>
                            )}
                          </td>

                          <td className="p-4 w-[280px] min-w-[280px]">
                            {d.location ? (
                              <div className="space-y-1.5">
                                <div className="flex items-center gap-1.5 font-semibold text-[var(--text-main)] text-xs">
                                  <MapPin className="w-4 h-4 text-cyan-400 shrink-0" />
                                  <span className="truncate max-w-[220px]" title={d.location.locationName}>
                                    {d.location.district || d.location.locationName}
                                  </span>
                                </div>
                                <div className="font-mono text-[10px] text-cyan-300/80 bg-cyan-950/40 px-2 py-0.5 rounded border border-cyan-500/20 inline-block">
                                  {d.location.coordinatesFormatted}
                                </div>
                              </div>
                            ) : (
                              <span className="text-[var(--text-faint)] italic flex items-center gap-1">
                                <MapPin className="w-3.5 h-3.5 text-[var(--text-faint)]" /> No GPS fix yet
                              </span>
                            )}
                          </td>

                          <td className="p-4 w-[190px] min-w-[190px] text-[var(--text-muted)]">
                            {d.location || d.lastPing ? (
                              <div className="space-y-0.5">
                                <div className="font-mono text-xs font-medium text-[var(--text-main)]">
                                  {d.location?.timeFormatted || (d.lastPing ? new Date(d.lastPing.occurredAt).toLocaleTimeString() : '—')}
                                </div>
                                <div className="text-[10px] text-[var(--text-faint)] font-mono">
                                  {d.location?.dateFormatted || (d.lastPing ? new Date(d.lastPing.occurredAt).toLocaleDateString() : '')}
                                </div>
                                <div className="inline-flex items-center gap-1 text-[10px] text-cyan-400/90 font-medium">
                                  <Clock className="w-2.5 h-2.5" />
                                  <span>{d.location?.relativeFreshness || 'Recent'}</span>
                                </div>
                              </div>
                            ) : (
                              <span className="text-[var(--text-faint)] italic">Never</span>
                            )}
                          </td>

                          <td className="p-4 w-[160px] min-w-[160px]">
                            <div className="space-y-1">
                              <div>
                                {isMoving ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                    Moving
                                  </span>
                                ) : isIdle ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-yellow-500/20 text-yellow-300 border border-yellow-500/40">
                                    <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
                                    Idle
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                                    Stop
                                  </span>
                                )}
                              </div>
                              <div className="font-mono text-xs">
                                {d.lastPing ? (
                                  <span className={`font-bold ${d.lastPing.speedKmh > 100 ? 'text-rose-400 animate-pulse' : 'text-[var(--text-main)]'}`}>
                                    {d.lastPing.speedKmh.toFixed(0)} km/h
                                  </span>
                                ) : (
                                  <span className="text-[var(--text-faint)]">0 km/h</span>
                                )}
                              </div>
                            </div>
                          </td>

                          <td className="p-4 w-[230px] min-w-[230px]">
                            {d.alerts && d.alerts.length > 0 ? (
                              <div className="flex flex-col gap-1 max-w-[220px]">
                                {d.alerts.map((alert) => (
                                  <span
                                    key={alert.id}
                                    title={alert.description}
                                    className={`px-2 py-0.5 rounded text-[10px] font-bold border truncate flex items-center gap-1 ${
                                      alert.type === 'OVERSPEEDING'
                                        ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse'
                                        : alert.type === 'HARSH_BRAKING'
                                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                        : alert.type === 'HARSH_ACCELERATION'
                                        ? 'bg-orange-500/20 text-orange-300 border-orange-500/40'
                                        : alert.type === 'EXCESS_IDLING'
                                        ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40'
                                        : alert.type === 'GEOFENCE_ENTRY' || alert.type === 'GEOFENCE_EXIT'
                                        ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                                        : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                                    }`}
                                  >
                                    {alert.type === 'OVERSPEEDING' && '🚨 '}
                                    {alert.type === 'HARSH_BRAKING' && '⚠️ '}
                                    {alert.type === 'HARSH_ACCELERATION' && '⚡ '}
                                    {alert.type === 'EXCESS_IDLING' && '⏳ '}
                                    {(alert.type === 'GEOFENCE_ENTRY' || alert.type === 'GEOFENCE_EXIT') && '📍 '}
                                    <span className="truncate">{alert.title}</span>
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                Normal
                              </span>
                            )}
                          </td>

                          <td className="p-4 w-[170px] min-w-[170px] font-mono">
                            <div className="font-semibold text-[var(--text-main)] text-xs">
                              {d.odometerKm > 0 ? `${d.odometerKm.toLocaleString()} km` : '—'}
                            </div>
                            {d.fuelLevelPercent !== null ? (
                              <div className="flex items-center gap-1.5 mt-1.5">
                                <div className="w-14 h-1.5 bg-[var(--bg-canvas)] rounded-full overflow-hidden border border-[var(--border-subtle)]">
                                  <div
                                    className={`h-full ${
                                      d.fuelLevelPercent < 20
                                        ? 'bg-rose-500'
                                        : d.fuelLevelPercent < 50
                                        ? 'bg-amber-500'
                                        : 'bg-emerald-500'
                                    }`}
                                    style={{ width: `${d.fuelLevelPercent}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-[var(--text-muted)]">{d.fuelLevelPercent.toFixed(0)}%</span>
                              </div>
                            ) : null}
                          </td>

                          <td className="p-4 w-[190px] min-w-[190px] font-mono">
                            {d.deviceId ? (
                              <div>
                                <span className="font-bold text-cyan-300 bg-cyan-950/60 px-2.5 py-0.5 rounded border border-cyan-500/30 text-[11px]">
                                  {d.deviceId}
                                </span>
                                {d.simCardNo && (
                                  <div className="text-[10px] text-[var(--text-faint)] mt-1">
                                    SIM: {d.simCardNo}
                                  </div>
                                )}
                              </div>
                            ) : d.isMobileTracking ? (
                              <span className="inline-flex items-center gap-1.5 font-bold text-emerald-400 bg-emerald-950/60 px-2.5 py-1 rounded-lg border border-emerald-500/30 text-xs shadow-sm">
                                <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
                                Driver Mobile GPS
                              </span>
                            ) : (
                              <span className="text-[var(--text-faint)] italic text-[11px]">Unpaired</span>
                            )}
                          </td>

                          <td className="p-4 w-[90px] min-w-[90px] text-center whitespace-nowrap relative" data-telematics-actions>
                            <div className="inline-block text-left relative">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveActionMenuId(prev => prev === d.vehicleId ? null : d.vehicleId);
                                }}
                                className={`p-2 rounded-xl border transition flex items-center justify-center ${
                                  activeActionMenuId === d.vehicleId
                                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 shadow-md ring-2 ring-cyan-500/20'
                                    : 'bg-[var(--bg-canvas)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)] border-[var(--border-subtle)]'
                                }`}
                                title="Actions Menu"
                                aria-label="Asset Actions"
                              >
                                <MoreVertical className="w-4 h-4" />
                              </button>

                              {activeActionMenuId === d.vehicleId && (
                                <div
                                  className="absolute right-0 mt-2 w-64 rounded-2xl bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-700 shadow-2xl shadow-slate-900/25 z-50 py-1.5 text-left divide-y divide-slate-200 dark:divide-slate-800 animate-in fade-in zoom-in-95 duration-100"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <div className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800/80">
                                    <div className="text-[11px] uppercase font-black tracking-wider text-cyan-700 dark:text-cyan-400">
                                      {d.vehicleCode || d.licensePlate}
                                    </div>
                                    <div className="text-xs font-bold text-slate-950 dark:text-slate-200 truncate mt-0.5">
                                      {d.make} {d.model} {d.licensePlate ? `(${d.licensePlate})` : ''}
                                    </div>
                                  </div>

                                  <div className="py-1">
                                    <button
                                      onClick={() => {
                                        setSelectedVehicleId(d.vehicleId);
                                        setViewMode('map');
                                        setActiveActionMenuId(null);
                                      }}
                                      className="w-full px-4 py-2.5 text-xs font-bold text-slate-950 dark:text-white hover:bg-cyan-50 dark:hover:bg-slate-800 flex items-center gap-3 transition"
                                    >
                                      <span className="p-1.5 rounded-lg bg-cyan-100 dark:bg-cyan-950/80 text-cyan-700 dark:text-cyan-400">
                                        <Map className="w-4 h-4 shrink-0" />
                                      </span>
                                      <span>View on Live Map</span>
                                    </button>

                                    <button
                                      onClick={() => {
                                        setHistoryModalVehicle({ id: d.vehicleId, codeOrPlate: d.licensePlate || d.vehicleCode || undefined });
                                        setActiveActionMenuId(null);
                                      }}
                                      className="w-full px-4 py-2.5 text-xs font-bold text-slate-950 dark:text-white hover:bg-indigo-50 dark:hover:bg-slate-800 flex items-center gap-3 transition"
                                    >
                                      <span className="p-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-400">
                                        <HistoryIcon className="w-4 h-4 shrink-0" />
                                      </span>
                                      <span>GPS Tracking History</span>
                                    </button>
                                  </div>

                                  <div className="py-1">
                                    <a
                                      href={getVehicleShareUrls(d).whatsappUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="w-full px-4 py-2.5 text-xs font-bold text-emerald-800 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-slate-800 flex items-center gap-3 transition"
                                      onClick={() => setActiveActionMenuId(null)}
                                    >
                                      <span className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400">
                                        💬
                                      </span>
                                      <span>Share via WhatsApp</span>
                                    </a>

                                    <a
                                      href={getVehicleShareUrls(d).smsUrl}
                                      className="w-full px-4 py-2.5 text-xs font-bold text-sky-800 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-slate-800 flex items-center gap-3 transition"
                                      onClick={() => setActiveActionMenuId(null)}
                                    >
                                      <span className="p-1.5 rounded-lg bg-sky-100 dark:bg-sky-950/80 text-sky-700 dark:text-sky-400">
                                        📱
                                      </span>
                                      <span>Share via SMS</span>
                                    </a>
                                  </div>

                                  <div className="py-1">
                                    {d.driver?.phone && (
                                      <a
                                        href={`tel:${d.driver.phone}`}
                                        className="w-full px-4 py-2.5 text-xs font-bold text-emerald-800 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-slate-800 flex items-center gap-3 transition"
                                        onClick={() => setActiveActionMenuId(null)}
                                      >
                                        <span className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400">
                                          <Phone className="w-4 h-4 shrink-0" />
                                        </span>
                                        <span>Call Driver ({d.driver.name.split(' ')[0]})</span>
                                      </a>
                                    )}

                                    <Link
                                      href={`/fleet/vehicles?search=${encodeURIComponent(d.licensePlate || d.vehicleCode || '')}`}
                                      className="w-full px-4 py-2.5 text-xs font-bold text-slate-950 dark:text-white hover:bg-amber-50 dark:hover:bg-slate-800 flex items-center gap-3 transition"
                                      onClick={() => setActiveActionMenuId(null)}
                                    >
                                      <span className="p-1.5 rounded-lg bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-400">
                                        <ExternalLink className="w-4 h-4 shrink-0" />
                                      </span>
                                      <span>Open in Fleet Master</span>
                                    </Link>

                                    <Link
                                      href="/driver-mgmt/profiles"
                                      className="w-full px-4 py-2.5 text-xs font-bold text-slate-950 dark:text-white hover:bg-violet-50 dark:hover:bg-slate-800 flex items-center gap-3 transition"
                                      onClick={() => setActiveActionMenuId(null)}
                                    >
                                      <span className="p-1.5 rounded-lg bg-violet-100 dark:bg-violet-950/80 text-violet-700 dark:text-violet-400">
                                        <User className="w-4 h-4 shrink-0" />
                                      </span>
                                      <span>Driver Profiles</span>
                                    </Link>
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
          )}
        </div>
      )}

      {/* TAB 2: Automation & Geofences (Phase 2) */}
      {activeTab === 'automation' && (
        <div className="space-y-6">
          {/* Header Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-2xl bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] space-y-1">
              <p className="text-xs text-[var(--text-muted)] font-medium">Active Trips Under Geofence Tracking</p>
              <p className="text-2xl font-bold text-cyan-400">
                {automationData?.activeTripsCount ?? 0}
              </p>
              <p className="text-[11px] text-[var(--text-faint)]">Live approach & arrival detection</p>
            </div>

            <div className="p-4 rounded-2xl bg-amber-950/30 border border-amber-500/30 space-y-1">
              <p className="text-xs text-amber-400 font-medium">PM Service Due Soon (&le; 500 km)</p>
              <p className="text-2xl font-bold text-amber-300">
                {automationData?.pmDueSoonCount ?? 0}
              </p>
              <p className="text-[11px] text-amber-500/80">Proactive workshop alerts sent</p>
            </div>

            <div className="p-4 rounded-2xl bg-rose-950/30 border border-rose-500/30 space-y-1">
              <p className="text-xs text-rose-400 font-medium">PM Service Overdue</p>
              <p className="text-2xl font-bold text-rose-300">
                {automationData?.pmOverdueCount ?? 0}
              </p>
              <p className="text-[11px] text-rose-500/80">Requires immediate PM booking</p>
            </div>
          </div>

          {/* Section 1: Live Trip Stop Progress */}
          <div className="space-y-3">
            <h3 className="text-base font-bold text-[var(--text-main)] flex items-center gap-2">
              <Navigation className="w-5 h-5 text-emerald-400" />
              Live Route Stop Visits & Telematics ETA
            </h3>

            {automationLoading ? (
              <div className="p-8 text-center text-[var(--text-faint)] text-sm">Loading live trip progress...</div>
            ) : !automationData?.activeTripProgress?.length ? (
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/40 p-8 text-center text-[var(--text-faint)] text-xs">
                No active trips currently in transit. Trips will show real-time geofence stop approach/entry once dispatched.
              </div>
            ) : (
              <div className="space-y-4">
                {automationData.activeTripProgress.map((trip) => (
                  <div
                    key={trip.tripId}
                    className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/70 p-5 space-y-4 shadow-lg"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-cyan-400 bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-500/30 text-xs">
                            {trip.tripNumber || 'TRIP'}
                          </span>
                          <span className="font-bold text-[var(--text-main)] text-sm">{trip.routeName}</span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--bg-surface)] text-[var(--text-muted)]">
                            {trip.status}
                          </span>
                        </div>
                        <p className="text-xs text-[var(--text-muted)] mt-1">
                          Vehicle: <span className="text-[var(--text-main)] font-medium">{trip.vehicle?.vehicleCode || trip.vehicle?.licensePlate || '—'}</span>
                          {trip.driver && ` · Driver: ${trip.driver.firstName} ${trip.driver.lastName}`}
                        </p>
                      </div>

                      {trip.estimatedArrival && (
                        <div className="text-right">
                          <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
                            Telemetry Destination ETA
                          </div>
                          <div className="text-sm font-bold font-mono text-emerald-400 flex items-center justify-end gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            {new Date(trip.estimatedArrival).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Horizontal Stop Chain */}
                    <div className="overflow-x-auto pb-2">
                      <div className="flex items-center gap-2 min-w-max">
                        {trip.stops.map((stop, idx: number) => {
                          const isDeparted = stop.state === 'DEPARTED';
                          const isAtStop = stop.state === 'AT_STOP';
                          const isApproaching = stop.state === 'APPROACHING';

                          return (
                            <React.Fragment key={stop.stopId}>
                              <div
                                className={`p-2.5 rounded-xl border flex items-center gap-2 text-xs transition ${
                                  isDeparted
                                    ? 'bg-[var(--bg-canvas)]/80 border-[var(--border-subtle)] text-[var(--text-muted)]'
                                    : isAtStop
                                    ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-200 shadow-md shadow-emerald-500/20'
                                    : isApproaching
                                    ? 'bg-cyan-950/60 border-cyan-500/50 text-cyan-200 animate-pulse'
                                    : 'bg-[var(--bg-canvas)] border-[var(--border-subtle)] text-[var(--text-faint)]'
                                }`}
                              >
                                <span className="font-mono text-[10px] font-bold">#{stop.sequence}</span>
                                <span className="font-semibold">{stop.stopName}</span>

                                {isDeparted && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                                {isAtStop && (
                                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-400 text-white">
                                    AT STOP
                                  </span>
                                )}
                                {isApproaching && (
                                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-cyan-400 text-white">
                                    APPROACHING
                                  </span>
                                )}
                              </div>

                              {idx < trip.stops.length - 1 && (
                                <ArrowRight className="w-3.5 h-3.5 text-[var(--text-faint)] shrink-0" />
                              )}
                            </React.Fragment>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 2: Telematics PM Odometer Threshold Table */}
          <div className="space-y-3 pt-2">
            <h3 className="text-base font-bold text-[var(--text-main)] flex items-center gap-2">
              <Wrench className="w-5 h-5 text-amber-400" />
              Preventive Maintenance (PM) 10,000 km Countdown
            </h3>

            <div className="rounded-2xl border border-[var(--border-subtle)] overflow-hidden bg-[var(--bg-surface)]/60 shadow-xl">
              <table className="w-full text-left text-xs text-[var(--text-muted)]">
                <thead className="bg-[var(--bg-canvas)]/80 text-[var(--text-muted)] uppercase tracking-wider font-semibold border-b border-[var(--border-subtle)]">
                  <tr>
                    <th className="p-3.5">Vehicle</th>
                    <th className="p-3.5">Current Odometer</th>
                    <th className="p-3.5">Next Service Target</th>
                    <th className="p-3.5">Remaining Km</th>
                    <th className="p-3.5">PM Health Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {!automationData?.pmStatusList?.length ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-[var(--text-faint)]">
                        No vehicle odometer telemetry records found yet.
                      </td>
                    </tr>
                  ) : (
                    automationData.pmStatusList.map((item) => {
                      const isOverdue = item.status === 'OVERDUE';
                      const isDueSoon = item.status === 'DUE_SOON';

                      return (
                        <tr key={item.vehicleId} className="hover:bg-[var(--bg-surface-hover)] transition">
                          <td className="p-3.5 font-medium">
                            <div className="font-bold text-[var(--text-main)]">
                              {item.vehicleCode || item.licensePlate}
                            </div>
                            <div className="text-[10px] text-[var(--text-faint)] font-mono">
                              {item.deviceId ? `IMEI: ${item.deviceId}` : item.licensePlate}
                            </div>
                          </td>

                          <td className="p-3.5 font-mono text-[var(--text-main)]">
                            {item.currentOdometerKm.toLocaleString()} km
                          </td>

                          <td className="p-3.5 font-mono text-cyan-300 font-semibold">
                            {item.nextDueKm.toLocaleString()} km
                          </td>

                          <td className="p-3.5 font-mono">
                            {isOverdue ? (
                              <span className="text-rose-400 font-bold">
                                {Math.abs(item.kmRemaining).toLocaleString()} km OVERDUE
                              </span>
                            ) : (
                              <span className={isDueSoon ? 'text-amber-300 font-bold' : 'text-[var(--text-muted)]'}>
                                {item.kmRemaining.toLocaleString()} km
                              </span>
                            )}
                          </td>

                          <td className="p-3.5">
                            {isOverdue && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                                <AlertTriangle className="w-3 h-3" />
                                OVERDUE FOR PM
                              </span>
                            )}
                            {isDueSoon && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse">
                                <Clock className="w-3 h-3" />
                                SERVICE DUE SOON
                              </span>
                            )}
                            {item.status === 'OK' && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                <ShieldCheck className="w-3 h-3" />
                                ON SCHEDULE
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: Safety & Diagnostics (Phase 3) */}
      {activeTab === 'safety' && (
        <div className="space-y-6">
          {/* Header Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-2xl bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] space-y-1">
              <p className="text-xs text-[var(--text-muted)] font-medium">Fleet Driver Safety Index</p>
              <div className="flex items-center gap-2">
                <p className="text-2xl font-bold text-emerald-400">
                  {analyticsData?.averageSafetyScore ?? '—'} / 100
                </p>
                <Award className="w-5 h-5 text-amber-400" />
              </div>
              <p className="text-[11px] text-[var(--text-faint)]">Based on harsh events & speeding</p>
            </div>

            <div className="p-4 rounded-2xl bg-rose-950/30 border border-rose-500/30 space-y-1">
              <p className="text-xs text-rose-400 font-medium">Fuel Siphoning Alerts</p>
              <div className="flex items-center gap-2">
                <p className="text-2xl font-bold text-rose-300">
                  {analyticsData?.fuelAlerts?.length ?? 0}
                </p>
                <Flame className="w-5 h-5 text-rose-400" />
              </div>
              <p className="text-[11px] text-rose-500/80">Rapid tank level drops while off</p>
            </div>

            <div className="p-4 rounded-2xl bg-amber-950/30 border border-amber-500/30 space-y-1">
              <p className="text-xs text-amber-400 font-medium">CAN-bus Engine Faults</p>
              <div className="flex items-center gap-2">
                <p className="text-2xl font-bold text-amber-300">
                  {analyticsData?.dtcServiceRequests?.length ?? 0}
                </p>
                <AlertTriangle className="w-5 h-5 text-amber-400" />
              </div>
              <p className="text-[11px] text-amber-500/80">Auto-ticketed service requests</p>
            </div>
          </div>

          {/* Section 1: Driver Safety & Eco-Driving Leaderboard */}
          <div className="space-y-3">
            <h3 className="text-base font-bold text-[var(--text-main)] flex items-center gap-2">
              <Award className="w-5 h-5 text-amber-400" />
              Driver Safety & Eco-Driving Leaderboard
            </h3>

            <div className="rounded-2xl border border-[var(--border-subtle)] overflow-hidden bg-[var(--bg-surface)]/60 shadow-xl">
              <table className="w-full text-left text-xs text-[var(--text-muted)]">
                <thead className="bg-[var(--bg-canvas)]/80 text-[var(--text-muted)] uppercase tracking-wider font-semibold border-b border-[var(--border-subtle)]">
                  <tr>
                    <th className="p-3.5">Rank & Driver</th>
                    <th className="p-3.5">Safety Score (0–100)</th>
                    <th className="p-3.5">Harsh Brakes</th>
                    <th className="p-3.5">Harsh Accels</th>
                    <th className="p-3.5">Speeding</th>
                    <th className="p-3.5">Safety Assessment</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {analyticsLoading ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-[var(--text-faint)]">
                        Loading driver safety leaderboard...
                      </td>
                    </tr>
                  ) : !analyticsData?.driverLeaderboard?.length ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-[var(--text-faint)]">
                        No driver telemetry safety scores available yet.
                      </td>
                    </tr>
                  ) : (
                    analyticsData.driverLeaderboard.map((d, index: number) => {
                      const isGreen = d.ragStatus === 'GREEN';
                      const isAmber = d.ragStatus === 'AMBER';

                      return (
                        <tr key={d.driverId} className="hover:bg-[var(--bg-surface-hover)] transition">
                          <td className="p-3.5">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-bold text-[var(--text-muted)] w-5">
                                #{index + 1}
                              </span>
                              <div>
                                <div className="font-bold text-[var(--text-main)]">{d.driverName}</div>
                                <div className="text-[10px] text-[var(--text-faint)]">{d.phone || 'No phone'}</div>
                              </div>
                            </div>
                          </td>

                          <td className="p-3.5 font-mono">
                            <div className="flex items-center gap-2">
                              <span
                                className={`text-sm font-bold ${
                                  isGreen
                                    ? 'text-emerald-400'
                                    : isAmber
                                    ? 'text-amber-400'
                                    : 'text-rose-400'
                                }`}
                              >
                                {d.score}
                              </span>
                              <div className="w-20 bg-[var(--bg-surface)] rounded-full h-1.5 overflow-hidden">
                                <div
                                  className={`h-full ${
                                    isGreen ? 'bg-emerald-400' : isAmber ? 'bg-amber-400' : 'bg-rose-400'
                                  }`}
                                  style={{ width: `${d.score}%` }}
                                />
                              </div>
                            </div>
                          </td>

                          <td className="p-3.5 font-mono text-[var(--text-muted)]">{d.harshBrakes}</td>
                          <td className="p-3.5 font-mono text-[var(--text-muted)]">{d.harshAccels}</td>
                          <td className="p-3.5 font-mono text-[var(--text-muted)]">{d.overspeedEvents}</td>

                          <td className="p-3.5">
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                                isGreen
                                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                                  : isAmber
                                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                                  : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                              }`}
                            >
                              {d.ragStatus} · {d.summary}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 2: Two Columns: Fuel Theft Log & CAN-bus DTC Auto-Tickets */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2">
            {/* Left: Fuel Siphoning & Theft Log */}
            <div className="space-y-3">
              <h3 className="text-base font-bold text-[var(--text-main)] flex items-center gap-2">
                <Flame className="w-5 h-5 text-rose-400" />
                Fuel Theft & Siphoning Audit Log
              </h3>

              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/60 p-4 space-y-3">
                {!analyticsData?.fuelAlerts?.length ? (
                  <div className="p-6 text-center text-[var(--text-faint)] text-xs">
                    No fuel theft or siphoning anomalies detected.
                  </div>
                ) : (
                  analyticsData.fuelAlerts.map((a) => (
                    <div
                      key={a.id}
                      className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/30 space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-rose-300">{a.title}</span>
                        <span className="text-[10px] text-[var(--text-muted)]">
                          {new Date(a.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-[11px] text-[var(--text-muted)]">{a.description}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Right: CAN-bus DTC Diagnostics */}
            <div className="space-y-3">
              <h3 className="text-base font-bold text-[var(--text-main)] flex items-center gap-2">
                <Wrench className="w-5 h-5 text-amber-400" />
                CAN-bus Engine Fault Diagnostics
              </h3>

              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/60 p-4 space-y-3">
                {!analyticsData?.dtcServiceRequests?.length ? (
                  <div className="p-6 text-center text-[var(--text-faint)] text-xs">
                    No active DTC engine fault tickets. Vehicle powertrains healthy.
                  </div>
                ) : (
                  analyticsData.dtcServiceRequests.map((sr) => (
                    <div
                      key={sr.id}
                      className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/30 space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-amber-300">
                          {sr.vehicle?.vehicleCode || sr.vehicle?.licensePlate || 'Vehicle'} · {sr.priority}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300">
                          {sr.status}
                        </span>
                      </div>
                      <p className="text-[11px] text-[var(--text-muted)]">{sr.description}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: Webhook Simulator & Tester */}
      {activeTab === 'simulator' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/70 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-[var(--text-main)] flex items-center gap-2">
                  <Terminal className="w-5 h-5 text-amber-400" />
                  Inbound Webhook Payload Simulator
                </h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Test and validate raw JSON packets from any telematics vendor.
                </p>
              </div>

              <div className="flex items-center gap-1 bg-[var(--bg-canvas)] p-1 rounded-xl border border-[var(--border-subtle)]">
                {(['flespi', 'teltonika', 'traccar', 'generic'] as const).map((vendor) => (
                  <button
                    key={vendor}
                    onClick={() => setSimVendor(vendor)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold uppercase transition ${
                      simVendor === vendor
                        ? 'bg-amber-500 text-white'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                    }`}
                  >
                    {vendor}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">
                Raw JSON Webhook Body:
              </label>
              <textarea
                value={simPayload}
                onChange={(e) => setSimPayload(e.target.value)}
                rows={12}
                className="w-full bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-xl p-3 font-mono text-xs text-amber-200 focus:outline-none focus:border-amber-500 shadow-inner"
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-[11px] text-[var(--text-faint)] font-mono">
                Target: POST /api/telematics/webhook
              </span>
              <button
                onClick={handleSimulateWebhook}
                disabled={simSubmitting}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-white font-bold text-sm shadow transition disabled:opacity-50"
              >
                <Play className="w-4 h-4 fill-current" />
                {simSubmitting ? 'Simulating...' : 'Simulate Ingestion'}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/70 p-5 space-y-4">
            <h3 className="text-base font-bold text-[var(--text-main)] flex items-center gap-2">
              <Activity className="w-5 h-5 text-cyan-400" />
              Ingestion Execution & Parser Result
            </h3>

            {simResponse ? (
              <div className="space-y-3">
                <div
                  className={`p-3 rounded-xl border flex items-center justify-between text-xs font-mono font-bold ${
                    simResponse.status === 200
                      ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                      : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
                  }`}
                >
                  <span>HTTP Status: {simResponse.status}</span>
                  <span>{simResponse.data.success ? '✓ NORMALIZED & SAVED' : '✗ FAILED'}</span>
                </div>

                <div className="bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-xl p-4 font-mono text-xs text-[var(--text-muted)] max-h-96 overflow-y-auto">
                  <pre>{JSON.stringify(simResponse.data, null, 2)}</pre>
                </div>
              </div>
            ) : (
              <div className="p-12 text-center text-[var(--text-faint)] text-xs">
                Click <strong>&ldquo;Simulate Ingestion&rdquo;</strong> on the left to test the webhook and see normalized state updates.
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: Gateway Setup Guide */}
      {activeTab === 'guide' && (
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/70 p-6 space-y-6">
          <div>
            <h3 className="text-lg font-bold text-[var(--text-main)]">Telematics Gateway Configuration Guide</h3>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Configure your telematics platform (Flespi stream, Teltonika FOTA WEB, Traccar forwarder) to push telemetry to Fleet360.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="p-4 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] space-y-2">
              <p className="font-bold text-cyan-400 uppercase tracking-wider">1. Webhook Endpoint URL</p>
              <div className="flex items-center justify-between p-2 rounded bg-[var(--bg-surface)] font-mono text-[var(--text-main)] border border-[var(--border-subtle)]">
                <span className="truncate">https://your-domain.com/api/telematics/webhook</span>
                <button
                  onClick={() => handleCopyUrl('https://your-domain.com/api/telematics/webhook')}
                  className="text-[var(--text-muted)] hover:text-[var(--text-main)] ml-2"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] space-y-2">
              <p className="font-bold text-cyan-400 uppercase tracking-wider">2. Authentication</p>
              <div className="p-2 rounded bg-[var(--bg-surface)] text-[var(--text-main)] border border-[var(--border-subtle)]">
                <span>A signed-in Fleet360 session; pings are recorded for your own company. Direct gateway credentials are issued per tenant on request.</span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-bold text-[var(--text-main)] uppercase tracking-wider">
              Sample cURL Test Command:
            </p>
            <div className="bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-xl p-4 font-mono text-xs text-emerald-400 overflow-x-auto">
              <code>{`curl -X POST https://your-domain.com/api/telematics/webhook \\
  -H "Content-Type: application/json" \\
  -H "Cookie: xl-session=<your session>" \\
  -d '[
    {
      "ident": "864201047281920",
      "timestamp": ${Math.floor(Date.now() / 1000)},
      "position.latitude": 25.0418,
      "position.longitude": 55.1402,
      "position.speed": 64.5,
      "position.direction": 142,
      "can.vehicle.mileage": 148200,
      "can.fuel.level": 78
    }
  ]'`}</code>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Vehicle Tracking History Modal */}
      {historyModalVehicle && (
        <VehicleTrackingHistoryModal
          vehicleId={historyModalVehicle.id}
          vehicleCodeOrPlate={historyModalVehicle.codeOrPlate}
          onClose={() => setHistoryModalVehicle(null)}
        />
      )}
    </div>
  );
}
