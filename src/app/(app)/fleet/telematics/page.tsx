'use client';

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

import React, { useState, useEffect, useCallback } from 'react';
import {
  Radio,
  Wifi,
  WifiOff,
  Activity,
  Gauge,
  Fuel,
  Cpu,
  RefreshCw,
  Search,
  Plus,
  Play,
  Copy,
  Check,
  Zap,
  Clock,
  Compass,
  AlertTriangle,
  Send,
  Terminal,
  Navigation,
  MapPin,
  CheckCircle2,
  Wrench,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';

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
  connectionStatus: 'ONLINE' | 'IDLE' | 'OFFLINE' | 'UNPAIRED';
  lastPing: {
    latitude: number;
    longitude: number;
    speedKmh: number;
    headingDeg: number;
    occurredAt: string;
  } | null;
}

export default function TelematicsPage() {
  const [loading, setLoading] = useState(true);
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [filter, setFilter] = useState<'ALL' | 'ONLINE' | 'IDLE' | 'OFFLINE' | 'UNPAIRED'>('ALL');
  const [search, setSearch] = useState('');

  // Device pairing modal
  const [pairModal, setPairModal] = useState<DeviceItem | null>(null);
  const [editImei, setEditImei] = useState('');
  const [editSim, setEditSim] = useState('');
  const [pairingSaving, setPairingSaving] = useState(false);

  // Active Tab state
  const [activeTab, setActiveTab] = useState<'devices' | 'automation' | 'simulator' | 'guide'>('devices');
  const [automationData, setAutomationData] = useState<any>(null);
  const [automationLoading, setAutomationLoading] = useState(false);

  const [simVendor, setSimVendor] = useState<'flespi' | 'teltonika' | 'traccar' | 'generic'>('flespi');
  const [simPayload, setSimPayload] = useState('');
  const [simSubmitting, setSimSubmitting] = useState(false);
  const [simResponse, setSimResponse] = useState<any>(null);
  const [copied, setCopied] = useState(false);

  const fetchDevices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/telematics/devices');
      if (res.ok) {
        const data = await res.json();
        setDevices(data.devices || []);
      }
    } catch (err) {
      console.error('Failed to fetch devices', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAutomation = useCallback(async () => {
    setAutomationLoading(true);
    try {
      const res = await fetch('/api/telematics/automation');
      if (res.ok) {
        const data = await res.json();
        setAutomationData(data);
      }
    } catch (err) {
      console.error('Failed to fetch automation data', err);
    } finally {
      setAutomationLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDevices();
    if (activeTab === 'automation') {
      fetchAutomation();
    }
  }, [fetchDevices, fetchAutomation, activeTab]);

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

  const handleSavePairing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pairModal) return;

    setPairingSaving(true);
    try {
      const res = await fetch('/api/telematics/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleId: pairModal.vehicleId,
          deviceId: editImei.trim() || null,
          simCardNo: editSim.trim() || null,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to update pairing');
      }

      setPairModal(null);
      fetchDevices();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error updating device');
    } finally {
      setPairingSaving(false);
    }
  };

  const handleSimulateWebhook = async () => {
    setSimSubmitting(true);
    setSimResponse(null);
    try {
      let parsedBody: any;
      try {
        parsedBody = JSON.parse(simPayload);
      } catch (err) {
        alert('Invalid JSON in payload editor');
        setSimSubmitting(false);
        return;
      }

      const res = await fetch('/api/telematics/webhook?secret=fleet360-telematics-live', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'fleet360-telematics-live',
        },
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
    if (filter !== 'ALL' && d.connectionStatus !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      const code = (d.vehicleCode || '').toLowerCase();
      const plate = (d.licensePlate || '').toLowerCase();
      const imei = (d.deviceId || '').toLowerCase();
      const make = (d.make || '').toLowerCase();
      return code.includes(q) || plate.includes(q) || imei.includes(q) || make.includes(q);
    }
    return true;
  });

  const onlineCount = devices.filter((d) => d.connectionStatus === 'ONLINE').length;
  const idleCount = devices.filter((d) => d.connectionStatus === 'IDLE').length;
  const offlineCount = devices.filter((d) => d.connectionStatus === 'OFFLINE').length;
  const unpairedCount = devices.filter((d) => d.connectionStatus === 'UNPAIRED').length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              <Radio className="w-6 h-6 text-cyan-400" />
              Live Telematics & IoT Gateways
            </h1>
            <span className="px-2 py-0.5 text-xs font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 rounded-full">
              Pattern A: HTTPS Webhook
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Real-time GPS tracking, CAN-bus telemetry, and multi-vendor gateway ingestion (Flespi, Teltonika, Geotab, Traccar).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchDevices}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium border border-slate-700 transition"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="p-4 rounded-2xl bg-slate-900/60 border border-white/10 space-y-1">
          <p className="text-xs text-slate-400 font-medium">Total Vehicles</p>
          <p className="text-2xl font-bold text-white">{devices.length}</p>
          <p className="text-[11px] text-slate-500">Fleet asset registry</p>
        </div>

        <div className="p-4 rounded-2xl bg-emerald-950/30 border border-emerald-500/30 space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-xs text-emerald-400 font-medium">Online & Moving</p>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
          </div>
          <p className="text-2xl font-bold text-emerald-300">{onlineCount}</p>
          <p className="text-[11px] text-emerald-500/80">Active GPS stream</p>
        </div>

        <div className="p-4 rounded-2xl bg-amber-950/30 border border-amber-500/30 space-y-1">
          <p className="text-xs text-amber-400 font-medium">Stationary / Idle</p>
          <p className="text-2xl font-bold text-amber-300">{idleCount}</p>
          <p className="text-[11px] text-amber-500/80">Ignition ON / Speed 0</p>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/60 border border-rose-500/20 space-y-1">
          <p className="text-xs text-rose-400 font-medium">Offline (&gt; 2 hrs)</p>
          <p className="text-2xl font-bold text-rose-300">{offlineCount}</p>
          <p className="text-[11px] text-rose-500/80">No recent ping</p>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/60 border border-white/10 space-y-1">
          <p className="text-xs text-slate-400 font-medium">Unpaired Hardware</p>
          <p className="text-2xl font-bold text-slate-300">{unpairedCount}</p>
          <p className="text-[11px] text-slate-500">No IMEI bound</p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('devices')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition shrink-0 ${
            activeTab === 'devices'
              ? 'bg-cyan-500 text-slate-950 shadow'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
          }`}
        >
          <Cpu className="w-4 h-4" />
          Live Device Fleet ({devices.length})
        </button>

        <button
          onClick={() => setActiveTab('automation')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition shrink-0 ${
            activeTab === 'automation'
              ? 'bg-emerald-500 text-slate-950 shadow'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
          }`}
        >
          <Navigation className="w-4 h-4" />
          Automation & Geofences (Phase 2)
        </button>

        <button
          onClick={() => setActiveTab('safety')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition shrink-0 ${
            activeTab === 'safety'
              ? 'bg-rose-500 text-slate-950 shadow'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
          }`}
        >
          <Shield className="w-4 h-4" />
          Safety & Diagnostics (Phase 3)
        </button>

        <button
          onClick={() => setActiveTab('simulator')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition shrink-0 ${
            activeTab === 'simulator'
              ? 'bg-amber-500 text-slate-950 shadow'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
          }`}
        >
          <Terminal className="w-4 h-4" />
          Webhook Simulator & Tester
        </button>

        <button
          onClick={() => setActiveTab('guide')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition shrink-0 ${
            activeTab === 'guide'
              ? 'bg-violet-500 text-slate-950 shadow'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
          }`}
        >
          <Zap className="w-4 h-4" />
          Gateway Setup Guide
        </button>
      </div>

      {/* TAB 1: Live Devices Grid */}
      {activeTab === 'devices' && (
        <div className="space-y-4">
          {/* Filter and Search Bar */}
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
            <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto">
              {(['ALL', 'ONLINE', 'IDLE', 'OFFLINE', 'UNPAIRED'] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setFilter(status)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition ${
                    filter === status
                      ? 'bg-slate-700 text-white border border-slate-500'
                      : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
              <input
                type="text"
                placeholder="Search code, plate, IMEI..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* Grid Table */}
          <div className="rounded-2xl border border-white/10 overflow-hidden bg-slate-900/60 shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950/80 text-slate-400 uppercase tracking-wider font-semibold border-b border-white/10">
                  <tr>
                    <th className="p-3.5">Vehicle</th>
                    <th className="p-3.5">Hardware IMEI / Device</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5">Speed</th>
                    <th className="p-3.5">Odometer</th>
                    <th className="p-3.5">Fuel %</th>
                    <th className="p-3.5">Last Communication</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-slate-500">
                        No devices found matching filter criteria.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((d) => {
                      const isOnline = d.connectionStatus === 'ONLINE';
                      const isIdle = d.connectionStatus === 'IDLE';
                      const isOffline = d.connectionStatus === 'OFFLINE';

                      return (
                        <tr key={d.vehicleId} className="hover:bg-white/[0.02] transition">
                          <td className="p-3.5 font-medium">
                            <div className="font-bold text-white text-sm">
                              {d.vehicleCode || d.licensePlate || 'Unnamed Asset'}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {d.licensePlate ? `Plate: ${d.licensePlate}` : ''}{' '}
                              {d.make ? `· ${d.make} ${d.model || ''}` : ''}
                            </div>
                          </td>

                          <td className="p-3.5 font-mono">
                            {d.deviceId ? (
                              <div>
                                <span className="font-bold text-cyan-300 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-500/30">
                                  {d.deviceId}
                                </span>
                                {d.simCardNo && (
                                  <div className="text-[10px] text-slate-500 mt-0.5">
                                    SIM: {d.simCardNo}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-600 italic">Unpaired</span>
                            )}
                          </td>

                          <td className="p-3.5">
                            {isOnline && (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                ONLINE
                              </span>
                            )}
                            {isIdle && (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                IDLE
                              </span>
                            )}
                            {isOffline && (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                                <WifiOff className="w-3 h-3" />
                                OFFLINE
                              </span>
                            )}
                            {d.connectionStatus === 'UNPAIRED' && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400">
                                NO DEVICE
                              </span>
                            )}
                          </td>

                          <td className="p-3.5 font-mono">
                            {d.lastPing ? (
                              <span className={`font-bold ${d.lastPing.speedKmh > 100 ? 'text-amber-400' : 'text-slate-200'}`}>
                                {d.lastPing.speedKmh.toFixed(0)} km/h
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>

                          <td className="p-3.5 font-mono text-slate-200">
                            {d.odometerKm > 0 ? `${d.odometerKm.toLocaleString()} km` : '—'}
                          </td>

                          <td className="p-3.5">
                            {d.fuelLevelPercent !== null ? (
                              <div className="flex items-center gap-2">
                                <div className="w-16 h-2 bg-slate-800 rounded-full overflow-hidden">
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
                                <span className="font-mono text-[11px] text-slate-300">
                                  {d.fuelLevelPercent.toFixed(0)}%
                                </span>
                              </div>
                            ) : (
                              '—'
                            )}
                          </td>

                          <td className="p-3.5 text-slate-400">
                            {d.lastPing ? (
                              <div>
                                <div>{new Date(d.lastPing.occurredAt).toLocaleTimeString()}</div>
                                <div className="text-[10px] text-slate-500">
                                  {new Date(d.lastPing.occurredAt).toLocaleDateString()}
                                </div>
                              </div>
                            ) : (
                              'Never'
                            )}
                          </td>

                          <td className="p-3.5 text-right">
                            <button
                              onClick={() => {
                                setPairModal(d);
                                setEditImei(d.deviceId || '');
                                setEditSim(d.simCardNo || '');
                              }}
                              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition"
                            >
                              {d.deviceId ? 'Edit Pairing' : 'Pair Device'}
                            </button>
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

      {/* TAB 2: Automation & Geofences (Phase 2) */}
      {activeTab === 'automation' && (
        <div className="space-y-6">
          {/* Header Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-2xl bg-slate-900/60 border border-white/10 space-y-1">
              <p className="text-xs text-slate-400 font-medium">Active Trips Under Geofence Tracking</p>
              <p className="text-2xl font-bold text-cyan-400">
                {automationData?.activeTripsCount ?? 0}
              </p>
              <p className="text-[11px] text-slate-500">Live approach & arrival detection</p>
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
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Navigation className="w-5 h-5 text-emerald-400" />
              Live Route Stop Visits & Telematics ETA
            </h3>

            {automationLoading ? (
              <div className="p-8 text-center text-slate-500 text-sm">Loading live trip progress...</div>
            ) : !automationData?.activeTripProgress?.length ? (
              <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-8 text-center text-slate-500 text-xs">
                No active trips currently in transit. Trips will show real-time geofence stop approach/entry once dispatched.
              </div>
            ) : (
              <div className="space-y-4">
                {automationData.activeTripProgress.map((trip: any) => (
                  <div
                    key={trip.tripId}
                    className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 space-y-4 shadow-lg"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/5 pb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-cyan-400 bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-500/30 text-xs">
                            {trip.tripNumber || 'TRIP'}
                          </span>
                          <span className="font-bold text-white text-sm">{trip.routeName}</span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300">
                            {trip.status}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1">
                          Vehicle: <span className="text-slate-200 font-medium">{trip.vehicle?.vehicleCode || trip.vehicle?.licensePlate || '—'}</span>
                          {trip.driver && ` · Driver: ${trip.driver.firstName} ${trip.driver.lastName}`}
                        </p>
                      </div>

                      {trip.estimatedArrival && (
                        <div className="text-right">
                          <div className="text-[10px] uppercase tracking-wider text-slate-500">
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
                        {trip.stops.map((stop: any, idx: number) => {
                          const isDeparted = stop.state === 'DEPARTED';
                          const isAtStop = stop.state === 'AT_STOP';
                          const isApproaching = stop.state === 'APPROACHING';

                          return (
                            <React.Fragment key={stop.stopId}>
                              <div
                                className={`p-2.5 rounded-xl border flex items-center gap-2 text-xs transition ${
                                  isDeparted
                                    ? 'bg-slate-950/80 border-slate-800 text-slate-400'
                                    : isAtStop
                                    ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-200 shadow-md shadow-emerald-500/20'
                                    : isApproaching
                                    ? 'bg-cyan-950/60 border-cyan-500/50 text-cyan-200 animate-pulse'
                                    : 'bg-slate-950 border-slate-900 text-slate-500'
                                }`}
                              >
                                <span className="font-mono text-[10px] font-bold">#{stop.sequence}</span>
                                <span className="font-semibold">{stop.stopName}</span>

                                {isDeparted && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                                {isAtStop && (
                                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-400 text-slate-950">
                                    AT STOP
                                  </span>
                                )}
                                {isApproaching && (
                                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-cyan-400 text-slate-950">
                                    APPROACHING
                                  </span>
                                )}
                              </div>

                              {idx < trip.stops.length - 1 && (
                                <ArrowRight className="w-3.5 h-3.5 text-slate-600 shrink-0" />
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
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Wrench className="w-5 h-5 text-amber-400" />
              Preventive Maintenance (PM) 10,000 km Countdown
            </h3>

            <div className="rounded-2xl border border-white/10 overflow-hidden bg-slate-900/60 shadow-xl">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950/80 text-slate-400 uppercase tracking-wider font-semibold border-b border-white/10">
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
                      <td colSpan={5} className="p-8 text-center text-slate-500">
                        No vehicle odometer telemetry records found yet.
                      </td>
                    </tr>
                  ) : (
                    automationData.pmStatusList.map((item: any) => {
                      const isOverdue = item.status === 'OVERDUE';
                      const isDueSoon = item.status === 'DUE_SOON';

                      return (
                        <tr key={item.vehicleId} className="hover:bg-white/[0.02] transition">
                          <td className="p-3.5 font-medium">
                            <div className="font-bold text-white">
                              {item.vehicleCode || item.licensePlate}
                            </div>
                            <div className="text-[10px] text-slate-500 font-mono">
                              {item.deviceId ? `IMEI: ${item.deviceId}` : item.licensePlate}
                            </div>
                          </td>

                          <td className="p-3.5 font-mono text-slate-200">
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
                              <span className={isDueSoon ? 'text-amber-300 font-bold' : 'text-slate-300'}>
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
            <div className="p-4 rounded-2xl bg-slate-900/60 border border-white/10 space-y-1">
              <p className="text-xs text-slate-400 font-medium">Fleet Driver Safety Index</p>
              <div className="flex items-center gap-2">
                <p className="text-2xl font-bold text-emerald-400">
                  {analyticsData?.averageSafetyScore ?? 100} / 100
                </p>
                <Award className="w-5 h-5 text-amber-400" />
              </div>
              <p className="text-[11px] text-slate-500">Based on harsh events & speeding</p>
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
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Award className="w-5 h-5 text-amber-400" />
              Driver Safety & Eco-Driving Leaderboard
            </h3>

            <div className="rounded-2xl border border-white/10 overflow-hidden bg-slate-900/60 shadow-xl">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950/80 text-slate-400 uppercase tracking-wider font-semibold border-b border-white/10">
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
                      <td colSpan={6} className="p-8 text-center text-slate-500">
                        Loading driver safety leaderboard...
                      </td>
                    </tr>
                  ) : !analyticsData?.driverLeaderboard?.length ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-500">
                        No driver telemetry safety scores available yet.
                      </td>
                    </tr>
                  ) : (
                    analyticsData.driverLeaderboard.map((d: any, index: number) => {
                      const isGreen = d.ragStatus === 'GREEN';
                      const isAmber = d.ragStatus === 'AMBER';

                      return (
                        <tr key={d.driverId} className="hover:bg-white/[0.02] transition">
                          <td className="p-3.5">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-bold text-slate-400 w-5">
                                #{index + 1}
                              </span>
                              <div>
                                <div className="font-bold text-white">{d.driverName}</div>
                                <div className="text-[10px] text-slate-500">{d.phone || 'No phone'}</div>
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
                              <div className="w-20 bg-slate-800 rounded-full h-1.5 overflow-hidden">
                                <div
                                  className={`h-full ${
                                    isGreen ? 'bg-emerald-400' : isAmber ? 'bg-amber-400' : 'bg-rose-400'
                                  }`}
                                  style={{ width: `${d.score}%` }}
                                />
                              </div>
                            </div>
                          </td>

                          <td className="p-3.5 font-mono text-slate-300">{d.harshBrakes}</td>
                          <td className="p-3.5 font-mono text-slate-300">{d.harshAccels}</td>
                          <td className="p-3.5 font-mono text-slate-300">{d.overspeedEvents}</td>

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
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Flame className="w-5 h-5 text-rose-400" />
                Fuel Theft & Siphoning Audit Log
              </h3>

              <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 space-y-3">
                {!analyticsData?.fuelAlerts?.length ? (
                  <div className="p-6 text-center text-slate-500 text-xs">
                    No fuel theft or siphoning anomalies detected.
                  </div>
                ) : (
                  analyticsData.fuelAlerts.map((a: any) => (
                    <div
                      key={a.id}
                      className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/30 space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-rose-300">{a.title}</span>
                        <span className="text-[10px] text-slate-400">
                          {new Date(a.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-300">{a.description}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Right: CAN-bus DTC Diagnostics */}
            <div className="space-y-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Wrench className="w-5 h-5 text-amber-400" />
                CAN-bus Engine Fault Diagnostics
              </h3>

              <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 space-y-3">
                {!analyticsData?.dtcServiceRequests?.length ? (
                  <div className="p-6 text-center text-slate-500 text-xs">
                    No active DTC engine fault tickets. Vehicle powertrains healthy.
                  </div>
                ) : (
                  analyticsData.dtcServiceRequests.map((sr: any) => (
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
                      <p className="text-[11px] text-slate-300">{sr.description}</p>
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
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Terminal className="w-5 h-5 text-amber-400" />
                  Inbound Webhook Payload Simulator
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Test and validate raw JSON packets from any telematics vendor.
                </p>
              </div>

              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                {(['flespi', 'teltonika', 'traccar', 'generic'] as const).map((vendor) => (
                  <button
                    key={vendor}
                    onClick={() => setSimVendor(vendor)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold uppercase transition ${
                      simVendor === vendor
                        ? 'bg-amber-500 text-slate-950'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {vendor}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Raw JSON Webhook Body:
              </label>
              <textarea
                value={simPayload}
                onChange={(e) => setSimPayload(e.target.value)}
                rows={12}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-xs text-amber-200 focus:outline-none focus:border-amber-500 shadow-inner"
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-[11px] text-slate-500 font-mono">
                Target: POST /api/telematics/webhook
              </span>
              <button
                onClick={handleSimulateWebhook}
                disabled={simSubmitting}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm shadow transition disabled:opacity-50"
              >
                <Play className="w-4 h-4 fill-current" />
                {simSubmitting ? 'Simulating...' : 'Simulate Ingestion'}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
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

                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-xs text-slate-300 max-h-96 overflow-y-auto">
                  <pre>{JSON.stringify(simResponse.data, null, 2)}</pre>
                </div>
              </div>
            ) : (
              <div className="p-12 text-center text-slate-500 text-xs">
                Click <strong>"Simulate Ingestion"</strong> on the left to test the webhook and see normalized state updates.
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: Gateway Setup Guide */}
      {activeTab === 'guide' && (
        <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-6 space-y-6">
          <div>
            <h3 className="text-lg font-bold text-white">Telematics Gateway Configuration Guide</h3>
            <p className="text-xs text-slate-400 mt-1">
              Configure your telematics platform (Flespi stream, Teltonika FOTA WEB, Traccar forwarder) to push telemetry to Fleet360.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
              <p className="font-bold text-cyan-400 uppercase tracking-wider">1. Webhook Endpoint URL</p>
              <div className="flex items-center justify-between p-2 rounded bg-slate-900 font-mono text-slate-200 border border-slate-800">
                <span className="truncate">https://your-domain.com/api/telematics/webhook</span>
                <button
                  onClick={() => handleCopyUrl('https://your-domain.com/api/telematics/webhook')}
                  className="text-slate-400 hover:text-white ml-2"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
              <p className="font-bold text-cyan-400 uppercase tracking-wider">2. Webhook Secret Header</p>
              <div className="p-2 rounded bg-slate-900 font-mono text-slate-200 border border-slate-800">
                <span>x-webhook-secret: fleet360-telematics-live</span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-bold text-slate-200 uppercase tracking-wider">
              Sample cURL Test Command:
            </p>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-xs text-emerald-400 overflow-x-auto">
              <code>{`curl -X POST https://your-domain.com/api/telematics/webhook \\
  -H "Content-Type: application/json" \\
  -H "x-webhook-secret: fleet360-telematics-live" \\
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

      {/* Device Pairing Modal */}
      {pairModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl text-xs">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider">
                  Hardware Pairing
                </span>
                <h3 className="text-base font-bold text-white mt-0.5">
                  {pairModal.vehicleCode || pairModal.licensePlate}
                </h3>
              </div>
              <button
                onClick={() => setPairModal(null)}
                className="text-slate-500 hover:text-slate-300 text-lg leading-none"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSavePairing} className="space-y-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Device Hardware IMEI / Tracker ID *
                </label>
                <input
                  type="text"
                  placeholder="e.g. 864201047281920"
                  value={editImei}
                  onChange={(e) => setEditImei(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100 focus:outline-none focus:border-cyan-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  SIM Card Phone Number / ICCID (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. +971501234567"
                  value={editSim}
                  onChange={(e) => setEditSim(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100 focus:outline-none focus:border-cyan-500 font-mono"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPairModal(null)}
                  disabled={pairingSaving}
                  className="px-3 py-1.5 text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pairingSaving}
                  className="px-4 py-2 font-bold text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded-xl shadow transition disabled:opacity-50"
                >
                  {pairingSaving ? 'Saving...' : 'Save Pairing'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
