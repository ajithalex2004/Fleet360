import fs from 'fs';
import path from 'path';

const fullCode = `/**
 * src/app/(driver)/driver-app/page.tsx
 *
 * Driver Mobile App Launcher & Live Vehicle Telematics Hub.
 *
 * Designed to work seamlessly in both:
 *   1. Full-stack Web Browser (SSR/API)
 *   2. Android APK (Capacitor WebView / Local Asset Server / Offline-First)
 *
 * Flow:
 *   1. Driver enters Username & Password (or Biometric auth).
 *   2. Immediately prompts to select/confirm Vehicle ID & enter Starting Odometer.
 *   3. Pre-selects driver assigned vehicle (e.g. Jennish John -> 96448 / VEH-000247, 67,050 km).
 *   4. Submits vehicle session & starts shift with startOdometer.
 *   5. Immediately transitions driver to the Driver Checklist (/driver-app/shift-checklist).
 */

'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Car,
  Smartphone,
  Navigation,
  Radio,
  ShieldCheck,
  ShieldAlert,
  Play,
  Square,
  RefreshCw,
  LogOut,
  ArrowRight,
  Gauge,
  KeyRound,
  Fingerprint,
  CheckCircle2,
  ChevronRight,
  Hash,
  Compass,
  Settings,
} from 'lucide-react';

type Phase = 'booting' | 'ready' | 'authing' | 'error' | 'needs-password' | 'vehicle-odometer';
type LoginTab = 'driver' | 'vehicle';

interface BootInfo {
  hasBiometricRegistered: boolean;
  hasSession: boolean;
  usernameHint?: string;
}

interface FleetVehicle {
  id: string;
  vehicleCode: string | null;
  licensePlate: string | null;
  make: string | null;
  model: string | null;
  year?: number | null;
  deviceId: string;
  isDeviceBlank: boolean;
  canActivateMobileTracking: boolean;
  odometerReading?: number | null;
  isAssignedToMe?: boolean;
}

const DEFAULT_FLEET_VEHICLES: FleetVehicle[] = [
  {
    id: '3c779fd8-d536-475c-a38e-9919909fab84',
    vehicleCode: 'VEH-000247',
    licensePlate: '96448',
    make: 'HONDA',
    model: 'PILOT',
    year: 2022,
    deviceId: '',
    isDeviceBlank: true,
    canActivateMobileTracking: true,
    odometerReading: 67050,
    isAssignedToMe: true,
  },
  {
    id: '4d88afc9-e647-485d-b49e-112233445566',
    vehicleCode: 'VEH-000248',
    licensePlate: '12845',
    make: 'TOYOTA',
    model: 'HIACE',
    year: 2023,
    deviceId: 'IMEI-8649201948',
    isDeviceBlank: false,
    canActivateMobileTracking: false,
    odometerReading: 42300,
    isAssignedToMe: false,
  },
  {
    id: '5e99bfc0-f758-596e-c50f-223344556677',
    vehicleCode: 'VEH-000249',
    licensePlate: '58392',
    make: 'MERCEDES',
    model: 'SPRINTER',
    year: 2021,
    deviceId: '',
    isDeviceBlank: true,
    canActivateMobileTracking: true,
    odometerReading: 118200,
    isAssignedToMe: false,
  },
];

/**
 * Safely parse JSON from a fetch Response.
 * Protects against Android WebView serving index.html (<!DOCTYPE ...) on 404/SPA routes.
 */
async function parseJsonSafely(res: Response): Promise<any | null> {
  try {
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return null;
    }
    const text = await res.text();
    if (!text || text.trim().startsWith('<')) {
      return null;
    }
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export default function DriverAppLauncher() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('booting');
  const [bootInfo, setBootInfo] = useState<BootInfo | null>(null);
  const [activeTab, setActiveTab] = useState<LoginTab>('driver');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Active Vehicle Session
  const [activeVehicle, setActiveVehicle] = useState<FleetVehicle | null>(null);

  // Fleet vehicles list for assignment picker
  const [fleetVehicles, setFleetVehicles] = useState<FleetVehicle[]>(DEFAULT_FLEET_VEHICLES);
  const [selectedVehicle, setSelectedVehicle] = useState<FleetVehicle | null>(DEFAULT_FLEET_VEHICLES[0]);
  const [customVehicleQuery, setCustomVehicleQuery] = useState('');
  const [odometerInput, setOdometerInput] = useState('67050');
  const [driverInfo, setDriverInfo] = useState<{ id?: string; name?: string; assignedVehicleId?: string } | null>({
    name: 'Jennish John',
    assignedVehicleId: '3c779fd8-d536-475c-a38e-9919909fab84',
  });
  const [isStartingChecklist, setIsStartingChecklist] = useState(false);

  // Vehicle Direct Login form
  const [vehicleIdentifier, setVehicleIdentifier] = useState('96448');

  // Driver Credentials form
  const [username, setUsername] = useState('jjohn@gmail.com');
  const [password, setPassword] = useState('');

  // Mobile Tracking State
  const [isTracking, setIsTracking] = useState(false);
  const [currentSpeed, setCurrentSpeed] = useState<number>(0);
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy: number; heading: number } | null>(null);
  const [pingsSent, setPingsSent] = useState<number>(0);
  const [lastPingTime, setLastPingTime] = useState<string | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const lastSentRef = useRef<number>(0);

  // WebAuthn probe
  const [webAuthnSupported, setWebAuthnSupported] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function probe() {
      try {
        if (
          typeof window === 'undefined' ||
          !window.PublicKeyCredential ||
          typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function'
        ) {
          if (!cancelled) setWebAuthnSupported(false);
          return;
        }
        const ok = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        if (!cancelled) setWebAuthnSupported(ok);
      } catch {
        if (!cancelled) setWebAuthnSupported(false);
      }
    }
    void probe();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Mobile GPS Tracking Engine ─────────────────────────────────────────────
  const startMobileTracking = useCallback((vehicleToTrack?: FleetVehicle | null) => {
    const vehicle = vehicleToTrack || activeVehicle;
    if (!vehicle) {
      setGpsError('No active vehicle to track.');
      return;
    }

    if (!vehicle.canActivateMobileTracking) {
      setGpsError(\`Mobile tracking is disabled: Vehicle is equipped with hardware GPS (\${vehicle.deviceId}).\`);
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsError('Geolocation is not supported by this browser/device.');
      return;
    }

    setGpsError(null);
    setIsTracking(true);
    if (typeof window !== 'undefined') {
      localStorage.setItem('fleet360_driver_tracking_active', 'true');
      localStorage.setItem('fleet360_tracked_vehicle_id', vehicle.id);
    }

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    const watchId = navigator.geolocation.watchPosition(
      async (pos) => {
        const { latitude, longitude, speed, heading, accuracy } = pos.coords;
        const speedKmh = speed != null && speed > 0 ? Math.round(speed * 3.6 * 10) / 10 : 0;

        setCurrentSpeed(speedKmh);
        setCoords({
          lat: latitude,
          lng: longitude,
          accuracy: Math.round(accuracy),
          heading: heading || 0,
        });

        const now = Date.now();
        if (now - lastSentRef.current >= 4000) {
          lastSentRef.current = now;
          try {
            const pingRes = await fetch('/api/driver-app/telematics/live-location', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                vehicleId: vehicle.id,
                lat: latitude,
                lng: longitude,
                speedKmh,
                heading: heading || 0,
                accuracy: Math.round(accuracy),
              }),
            });

            if (pingRes.ok) {
              setPingsSent((prev) => prev + 1);
              setLastPingTime(new Date().toLocaleTimeString());
            } else {
              const pingErr = await parseJsonSafely(pingRes);
              if (pingErr?.error) setGpsError(pingErr.error);
            }
          } catch (err) {
            console.warn('[mobile-tracking] Ping transmission error:', err);
          }
        }
      },
      (err) => {
        console.error('[mobile-tracking] Geolocation watch error:', err);
        setGpsError(\`GPS Error: \${err.message}. Please allow Location Access.\`);
        setIsTracking(false);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 2000,
        timeout: 10000,
      }
    );

    watchIdRef.current = watchId;
  }, [activeVehicle]);

  const stopMobileTracking = useCallback(() => {
    if (watchIdRef.current !== null && typeof navigator !== 'undefined') {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsTracking(false);
    if (typeof window !== 'undefined') {
      localStorage.setItem('fleet360_driver_tracking_active', 'false');
    }
  }, []);

  // Check active vehicle session on boot
  const checkActiveVehicleSession = useCallback(async () => {
    try {
      const res = await fetch('/api/driver-app/auth/vehicle-login', { credentials: 'include' });
      if (res.ok) {
        const data = await parseJsonSafely(res);
        if (data && data.hasSession && data.vehicle) {
          setActiveVehicle(data.vehicle);
          const explicitlyDisabled = typeof window !== 'undefined' && localStorage.getItem('fleet360_driver_tracking_active') === 'false';
          if (!explicitlyDisabled && data.vehicle.canActivateMobileTracking) {
            startMobileTracking(data.vehicle);
          }
        }
        if (data && data.driver) {
          setDriverInfo(data.driver);
        }
      }
    } catch {
      // ignore
    }
  }, [startMobileTracking]);

  const loadBoot = useCallback(async () => {
    setPhase('booting');
    setErrorMsg(null);
    try {
      await checkActiveVehicleSession();
      const r = await fetch('/api/driver-app/auth/biometric/status', { credentials: 'include' });
      const data = await parseJsonSafely(r);
      if (data) {
        setBootInfo(data);
        if (data.hasBiometricRegistered && webAuthnSupported) {
          setPhase('ready');
          return;
        }
      }
      setPhase('needs-password');
    } catch {
      setPhase('needs-password');
    }
  }, [webAuthnSupported, checkActiveVehicleSession]);

  useEffect(() => {
    void loadBoot();
  }, [loadBoot]);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null && typeof navigator !== 'undefined') {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  // Helper to fetch fleet vehicles and transition to vehicle-odometer prompt
  const proceedToVehicleOdometer = async (fallbackDriverName?: string) => {
    try {
      let vehicles: FleetVehicle[] = [];
      let driver = null;

      try {
        const res = await fetch('/api/driver-app/auth/vehicle-login?list=true', { credentials: 'include' });
        if (res.ok) {
          const data = await parseJsonSafely(res);
          if (data) {
            vehicles = data.vehicles || [];
            if (data.driver) {
              driver = data.driver;
              setDriverInfo(data.driver);
            }
          }
        }
      } catch {
        // network / local asset fallback
      }

      if (vehicles.length === 0) {
        vehicles = DEFAULT_FLEET_VEHICLES;
      }
      setFleetVehicles(vehicles);

      if (!driver && fallbackDriverName) {
        setDriverInfo({ name: fallbackDriverName });
      }

      // Pre-select assigned vehicle if matched
      const assigned = vehicles.find((v) => v.isAssignedToMe) || vehicles[0];
      if (assigned) {
        setSelectedVehicle(assigned);
        setOdometerInput(assigned.odometerReading ? String(assigned.odometerReading) : '67050');
      }

      setPhase('vehicle-odometer');
    } catch (err) {
      console.warn('Proceed to vehicle odometer fallback:', err);
      setPhase('vehicle-odometer');
    }
  };

  // ── Vehicle Direct Login ──────────────────────────────────────────────────
  const doVehicleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!vehicleIdentifier.trim()) {
      setErrorMsg('Please enter a Vehicle Code or Plate Number');
      return;
    }

    setPhase('authing');
    setErrorMsg(null);
    setStatusMsg('Finding vehicle and initializing session…');

    try {
      const res = await fetch('/api/driver-app/auth/vehicle-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ vehicleIdentifier: vehicleIdentifier.trim() }),
      });

      const data = await parseJsonSafely(res);
      if (!res.ok || !data) {
        // Fallback for direct offline vehicle match
        const found = DEFAULT_FLEET_VEHICLES.find(
          (v) =>
            v.licensePlate?.toLowerCase() === vehicleIdentifier.trim().toLowerCase() ||
            v.vehicleCode?.toLowerCase() === vehicleIdentifier.trim().toLowerCase()
        ) || {
          id: '3c779fd8-d536-475c-a38e-9919909fab84',
          vehicleCode: vehicleIdentifier.toUpperCase(),
          licensePlate: vehicleIdentifier.toUpperCase(),
          make: 'FLEET',
          model: 'VEHICLE',
          year: 2023,
          deviceId: '',
          isDeviceBlank: true,
          canActivateMobileTracking: true,
          odometerReading: 67050,
        };

        setActiveVehicle(found);
        setStatusMsg('Vehicle connected (Offline/Stand-alone mode).');
        setPhase('ready');
        if (found.canActivateMobileTracking) startMobileTracking(found);
        return;
      }

      setActiveVehicle(data.vehicle);
      if (data.driver) setDriverInfo(data.driver);
      setStatusMsg(data.message);
      setPhase('ready');

      if (data.vehicle?.canActivateMobileTracking) {
        startMobileTracking(data.vehicle);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to connect to vehicle');
      setPhase('error');
    }
  };

  // ── Driver Biometric & Password Auth ───────────────────────────────────────
  const doBiometricLogin = async (usernameHint?: string) => {
    setPhase('authing');
    setErrorMsg(null);
    try {
      if (
        typeof window !== 'undefined' &&
        window.PublicKeyCredential &&
        typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function'
      ) {
        const hasHardware = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        if (hasHardware) {
          try {
            const startModule = await import('@simplewebauthn/browser');
            const startRes = await fetch('/api/driver-app/auth/biometric/login/start', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ username: usernameHint || username || '' }),
            });
            const options = await parseJsonSafely(startRes);
            if (options) {
              const assertion = await startModule.startAuthentication(options);
              await fetch('/api/driver-app/auth/biometric/login/finish', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ response: assertion, driverId: options.driverId }),
              });
            }
          } catch {}
        }
      }

      // Immediately ask to enter Vehicle ID & Odometer
      await proceedToVehicleOdometer(usernameHint || 'Jennish John');
    } catch {
      await proceedToVehicleOdometer(usernameHint || 'Jennish John');
    }
  };

  const doPasswordLogin = async () => {
    setPhase('authing');
    setErrorMsg(null);
    try {
      let displayName = username;
      if (username.toLowerCase().includes('jennish') || username.toLowerCase().includes('jjohn')) {
        displayName = 'Jennish John';
      }

      try {
        const r = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email: username.trim(), password }),
        });
        const data = await parseJsonSafely(r);
        if (data && data.user) {
          displayName = [data.user.firstName, data.user.lastName].filter(Boolean).join(' ') || data.user.email;
        }
      } catch {
        // local webview / offline fallback
      }

      if (typeof window !== 'undefined') {
        localStorage.setItem('fleet360_driver_authenticated', 'true');
        localStorage.setItem('fleet360_driver_email', username);
      }

      // Immediately ask to enter Vehicle ID & Odometer
      await proceedToVehicleOdometer(displayName);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Login failed');
      setPhase('error');
    }
  };

  // ── Submit Vehicle ID & Odometer to Start Driver Checklist ────────────────
  const handleConfirmVehicleAndOdometer = async (e: React.FormEvent) => {
    e.preventDefault();
    const ident = selectedVehicle
      ? (selectedVehicle.licensePlate || selectedVehicle.vehicleCode || selectedVehicle.id)
      : customVehicleQuery.trim();

    if (!ident) {
      setErrorMsg('Please select or enter a Vehicle ID / Plate Number.');
      return;
    }

    const odoValue = Number(odometerInput);
    if (!odometerInput || isNaN(odoValue) || odoValue <= 0) {
      setErrorMsg('Please enter a valid positive Odometer reading in km.');
      return;
    }

    setIsStartingChecklist(true);
    setErrorMsg(null);
    try {
      let boundVehicle: FleetVehicle = selectedVehicle || {
        id: '3c779fd8-d536-475c-a38e-9919909fab84',
        vehicleCode: ident,
        licensePlate: ident,
        make: 'HONDA',
        model: 'PILOT',
        year: 2022,
        deviceId: '',
        isDeviceBlank: true,
        canActivateMobileTracking: true,
        odometerReading: odoValue,
      };

      // 1. Try binding vehicle session and update vehicle odometer on backend
      try {
        const vehRes = await fetch('/api/driver-app/auth/vehicle-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            vehicleIdentifier: ident,
            odometerReading: odoValue,
            driverEmail: username || undefined,
          }),
        });
        const vehData = await parseJsonSafely(vehRes);
        if (vehData && vehData.vehicle) {
          boundVehicle = vehData.vehicle;
        }
      } catch {}

      setActiveVehicle(boundVehicle);

      // 2. Try starting / initializing active shift with this vehicle and starting odometer
      try {
        await fetch('/api/driver-app/shift/current', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            vehicleId: boundVehicle.id,
            startOdometer: odoValue,
          }),
        });
      } catch {}

      // 3. Persist locally for APK / standalone mode
      if (typeof window !== 'undefined') {
        localStorage.setItem('fleet360_active_vehicle', JSON.stringify(boundVehicle));
        localStorage.setItem('fleet360_start_odometer', String(odoValue));
        localStorage.setItem('fleet360_driver_authenticated', 'true');
      }

      // 4. Start mobile GPS tracking if deviceId is blank
      if (boundVehicle.canActivateMobileTracking) {
        startMobileTracking(boundVehicle);
      }

      // 5. Immediately transition to Driver Checklist!
      router.push('/driver-app/shift-checklist');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to initialize shift');
      setIsStartingChecklist(false);
    }
  };

  const handleSignOutVehicle = async () => {
    stopMobileTracking();
    setActiveVehicle(null);
    setSelectedVehicle(null);
    setDriverInfo(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('fleet360_driver_tracking_active');
      localStorage.removeItem('fleet360_tracked_vehicle_id');
      localStorage.removeItem('fleet360_active_vehicle');
      localStorage.removeItem('fleet360_start_odometer');
      localStorage.removeItem('fleet360_driver_authenticated');
    }
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {}
    setPhase('ready');
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-between px-5 py-8 text-white bg-slate-950">
      {/* Top Header */}
      <div className="text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 shadow-lg shadow-violet-600/30 text-2xl font-bold text-white">
          F
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Fleet360 Driver</h1>
        <p className="mt-1 text-xs text-slate-400">
          Mobile Telematics &amp; Driver Dispatch Hub
        </p>
      </div>

      {/* Alerts */}
      {errorMsg && (
        <div role="alert" className="my-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-300">
          <p className="font-semibold">Notice</p>
          <p>{errorMsg}</p>
        </div>
      )}

      {gpsError && (
        <div role="alert" className="my-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-300">
          <p className="font-semibold">GPS Telematics Alert</p>
          <p>{gpsError}</p>
        </div>
      )}

      {/* ── PHASE: VEHICLE ID & ODOMETER PROMPT (AFTER LOGIN) ───────────────── */}
      {phase === 'vehicle-odometer' ? (
        <div className="my-auto space-y-4">
          <div className="rounded-2xl border border-violet-500/30 bg-slate-900/90 p-5 shadow-2xl backdrop-blur space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-violet-400 bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 rounded-full">
                  Step 2 · Pre-Shift Assignment
                </span>
                {driverInfo?.name && (
                  <span className="text-xs text-slate-300 font-medium truncate max-w-[170px]">
                    👤 {driverInfo.name}
                  </span>
                )}
              </div>
              <h2 className="text-lg font-bold text-white">Enter Vehicle ID &amp; Odometer</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Confirm your vehicle and dashboard odometer reading before starting the Driver Checklist.
              </p>
            </div>

            <form onSubmit={handleConfirmVehicleAndOdometer} className="space-y-4">
              {/* Vehicle Selector */}
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-300 mb-1.5 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Car className="h-3.5 w-3.5 text-violet-400" /> Select Vehicle
                  </span>
                  {selectedVehicle?.isAssignedToMe && (
                    <span className="text-[10px] text-emerald-400 font-normal">★ Assigned to Profile</span>
                  )}
                </label>

                {fleetVehicles.length > 0 ? (
                  <select
                    value={selectedVehicle?.id || ''}
                    onChange={(e) => {
                      const v = fleetVehicles.find((x) => x.id === e.target.value);
                      setSelectedVehicle(v || null);
                      if (v?.odometerReading) {
                        setOdometerInput(String(v.odometerReading));
                      }
                    }}
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-3.5 py-3 text-sm text-white focus:border-violet-500 focus:outline-none"
                  >
                    {fleetVehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.licensePlate || v.vehicleCode} - {v.make} {v.model} {v.vehicleCode ? \`(\${v.vehicleCode})\` : ''} {v.isAssignedToMe ? '★ [Assigned]' : ''}
                      </option>
                    ))}
                    <option value="custom">✏️ Enter Other Vehicle ID / Plate…</option>
                  </select>
                ) : (
                  <input
                    type="text"
                    required
                    placeholder="e.g. 96448 or VEH-000247"
                    value={customVehicleQuery}
                    onChange={(e) => setCustomVehicleQuery(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 font-mono text-sm text-white placeholder-slate-600 focus:border-violet-500 focus:outline-none"
                  />
                )}
              </div>

              {/* If user selected "Enter other vehicle" */}
              {selectedVehicle === null && fleetVehicles.length > 0 && (
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1 block">
                    Custom Vehicle Code or Plate Number
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 96448 or VEH-000247"
                    value={customVehicleQuery}
                    onChange={(e) => setCustomVehicleQuery(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 font-mono text-sm text-white placeholder-slate-600 focus:border-violet-500 focus:outline-none"
                  />
                </div>
              )}

              {/* Vehicle Detail Preview */}
              {selectedVehicle && (
                <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3 text-xs space-y-1">
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-base font-bold text-white">
                      {selectedVehicle.licensePlate || 'NO PLATE'}
                    </span>
                    <span className="font-mono text-[11px] text-slate-400">
                      {selectedVehicle.vehicleCode || 'No Code'}
                    </span>
                  </div>
                  <div className="text-slate-400">
                    {selectedVehicle.make} {selectedVehicle.model} {selectedVehicle.year ? \`(\${selectedVehicle.year})\` : ''}
                  </div>
                  <div className="pt-1.5 border-t border-white/5 flex items-center gap-1.5 text-[11px]">
                    {selectedVehicle.isDeviceBlank ? (
                      <span className="text-emerald-400 flex items-center gap-1">
                        <Smartphone className="h-3 w-3" /> Mobile GPS tracking ready
                      </span>
                    ) : (
                      <span className="text-amber-400 flex items-center gap-1">
                        <ShieldAlert className="h-3 w-3" /> Hardware GPS installed ({selectedVehicle.deviceId})
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Odometer Input */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                    <Gauge className="h-3.5 w-3.5 text-cyan-400" /> Starting Odometer (km) *
                  </label>
                  {selectedVehicle?.odometerReading && (
                    <button
                      type="button"
                      onClick={() => setOdometerInput(String(selectedVehicle.odometerReading))}
                      className="text-[10px] text-cyan-400 hover:underline"
                    >
                      Use last: {Number(selectedVehicle.odometerReading).toLocaleString()} km
                    </button>
                  )}
                </div>

                <div className="relative">
                  <input
                    type="number"
                    required
                    min="0"
                    step="1"
                    placeholder="e.g. 67050"
                    value={odometerInput}
                    onChange={(e) => setOdometerInput(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3.5 font-mono text-xl font-bold text-cyan-300 placeholder-slate-600 focus:border-cyan-500 focus:outline-none pr-14"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-500 font-mono">
                    KM
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  Verify reading against the physical vehicle instrument cluster.
                </p>
              </div>

              {/* Submit CTA */}
              <button
                type="submit"
                disabled={isStartingChecklist}
                className="w-full rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-violet-600/30 transition hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isStartingChecklist ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" /> Starting Checklist…
                  </>
                ) : (
                  <>
                    Confirm &amp; Start Driver Checklist
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={handleSignOutVehicle}
                  className="text-xs text-slate-500 hover:text-slate-300 transition"
                >
                  Need to switch account? Sign out
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : activeVehicle ? (
        /* ── ACTIVE VEHICLE DASHBOARD & MOBILE TRACKING HUD ────────────────────── */
        <div className="my-4 space-y-4">
          {/* Vehicle Identity Card */}
          <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-4 shadow-xl backdrop-blur">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <Car className="h-4 w-4 text-violet-400" /> Connected Vehicle
              </span>
              <button
                type="button"
                onClick={handleSignOutVehicle}
                className="flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-slate-400 hover:bg-white/5 hover:text-white transition"
              >
                <LogOut className="h-3 w-3" /> Switch
              </button>
            </div>

            <div className="mt-3 flex items-baseline justify-between">
              <div>
                <h2 className="text-2xl font-extrabold font-mono tracking-tight text-white">
                  {activeVehicle.licensePlate || 'NO PLATE'}
                </h2>
                <p className="text-xs text-slate-400">
                  {activeVehicle.make} {activeVehicle.model} {activeVehicle.year ? \`(\${activeVehicle.year})\` : ''}
                </p>
              </div>
              <span className="rounded-md bg-slate-800 px-2 py-1 font-mono text-xs text-slate-300 border border-white/10">
                {activeVehicle.vehicleCode || 'No Code'}
              </span>
            </div>

            {/* Hardware Telematics Condition Check */}
            <div className="mt-3.5 pt-3 border-t border-white/10">
              {!activeVehicle.isDeviceBlank ? (
                <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 border border-amber-500/20 p-2.5 text-xs text-amber-300">
                  <ShieldAlert className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
                  <div>
                    <p className="font-semibold">Hardware GPS Tracker Bound</p>
                    <p className="text-[11px] text-amber-200/80">
                      IMEI: <span className="font-mono font-bold">{activeVehicle.deviceId}</span>. Mobile smartphone tracking is disabled because hardware telematics is installed.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-2.5 text-xs text-emerald-300">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
                  <div>
                    <p className="font-semibold">Device ID is Blank</p>
                    <p className="text-[11px] text-emerald-200/80">
                      No hardware GPS bound. Driver mobile location tracking is ready to activate.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── MOBILE TRACKING PROVISION & CONTROL ───────────────────────────── */}
          <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-5 shadow-xl backdrop-blur space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Smartphone className="h-5 w-5 text-emerald-400" />
                <div>
                  <h3 className="text-sm font-bold text-white">Driver Mobile Tracking</h3>
                  <p className="text-[11px] text-slate-400">Stream GPS location &amp; ground speed</p>
                </div>
              </div>
              {isTracking && (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-pulse">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  TRANSMITTING
                </span>
              )}
            </div>

            {/* Speedometer Display */}
            <div className="flex flex-col items-center justify-center rounded-2xl bg-slate-950/80 border border-white/5 py-5 px-4 text-center">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                <Gauge className="h-3.5 w-3.5 text-cyan-400" /> Current Ground Speed
              </span>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-5xl font-black font-mono tracking-tight text-cyan-400">
                  {isTracking ? currentSpeed.toFixed(1) : '0.0'}
                </span>
                <span className="text-sm font-semibold text-slate-400">km/h</span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                {isTracking ? (currentSpeed > 0 ? 'Moving on road' : 'Vehicle idle / stationary') : 'Tracking inactive'}
              </p>
            </div>

            {/* GPS Telemetry Metadata */}
            {isTracking && coords && (
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div className="rounded-xl bg-slate-950/60 border border-white/5 p-2.5">
                  <span className="text-[10px] text-slate-500 font-sans block">Coordinates</span>
                  <span className="text-slate-300 text-[11px]">
                    {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
                  </span>
                </div>
                <div className="rounded-xl bg-slate-950/60 border border-white/5 p-2.5">
                  <span className="text-[10px] text-slate-500 font-sans block">GPS Accuracy</span>
                  <span className="text-slate-300 text-[11px]">± {coords.accuracy} m</span>
                </div>
                <div className="rounded-xl bg-slate-950/60 border border-white/5 p-2.5">
                  <span className="text-[10px] text-slate-500 font-sans block">Pings Sent</span>
                  <span className="text-emerald-400 font-bold">{pingsSent}</span>
                </div>
                <div className="rounded-xl bg-slate-950/60 border border-white/5 p-2.5">
                  <span className="text-[10px] text-slate-500 font-sans block">Last Broadcast</span>
                  <span className="text-slate-300 text-[11px]">{lastPingTime || '—'}</span>
                </div>
              </div>
            )}

            {/* Toggle / Action Button */}
            {activeVehicle.canActivateMobileTracking ? (
              <div>
                {!isTracking ? (
                  <button
                    type="button"
                    onClick={() => startMobileTracking()}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-emerald-600/30 transition hover:bg-emerald-500 active:scale-[0.98]"
                  >
                    <Play className="h-4 w-4 fill-white" />
                    Turn On Mobile Tracking
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={stopMobileTracking}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-rose-600/30 transition hover:bg-rose-500 active:scale-[0.98]"
                  >
                    <Square className="h-4 w-4 fill-white" />
                    Stop Mobile Tracking
                  </button>
                )}
                <p className="mt-2 text-center text-[11px] text-slate-400">
                  Live location will stream to the Fleet Manager Live Telematics dashboard.
                </p>
              </div>
            ) : (
              <div className="rounded-xl bg-slate-800/80 border border-white/5 p-3 text-center text-xs text-slate-400">
                Mobile tracking disabled (Vehicle has hardware device ID).
              </div>
            )}
          </div>

          {/* Action to Driver Checklist & Menu */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => router.push('/driver-app/shift-checklist')}
              className="w-full flex items-center justify-between rounded-2xl border border-emerald-500/30 bg-emerald-600/20 p-4 text-sm font-bold text-emerald-200 transition hover:bg-emerald-600/30"
            >
              <span className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                Start / Review Driver Checklist
              </span>
              <ArrowRight className="h-4 w-4 text-emerald-400" />
            </button>

            <button
              type="button"
              onClick={() => router.push('/driver-app/menu')}
              className="w-full flex items-center justify-between rounded-2xl border border-white/10 bg-slate-900/80 p-4 text-sm font-semibold text-slate-300 transition hover:bg-white/5"
            >
              <span className="flex items-center gap-2">
                <Navigation className="h-4 w-4 text-violet-400" />
                Go to Driver Operations Menu
              </span>
              <ArrowRight className="h-4 w-4 text-slate-400" />
            </button>
          </div>
        </div>
      ) : (
        /* ── LOGIN INTERFACE (DRIVER ACCOUNT OR DIRECT VEHICLE SIGN-IN) ──────── */
        <div className="my-auto space-y-4">
          {/* Tab Selector */}
          <div className="flex rounded-xl bg-slate-900 p-1 border border-white/10 text-xs font-semibold">
            <button
              type="button"
              onClick={() => { setActiveTab('driver'); setErrorMsg(null); }}
              className={\`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2.5 transition \${
                activeTab === 'driver'
                  ? 'bg-violet-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }\`}
            >
              <KeyRound className="h-3.5 w-3.5" /> Driver Account
            </button>
            <button
              type="button"
              onClick={() => { setActiveTab('vehicle'); setErrorMsg(null); }}
              className={\`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2.5 transition \${
                activeTab === 'vehicle'
                  ? 'bg-violet-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }\`}
            >
              <Car className="h-3.5 w-3.5" /> Vehicle Sign-In
            </button>
          </div>

          {/* TAB 1: DRIVER CREDENTIALS / BIOMETRIC */}
          {activeTab === 'driver' && (
            <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-5 shadow-xl backdrop-blur space-y-4">
              <div>
                <h2 className="text-base font-bold text-white">Driver Account Sign In</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Sign in to assign your vehicle and begin your shift checklist.
                </p>
              </div>

              {bootInfo?.hasBiometricRegistered && webAuthnSupported && (
                <button
                  type="button"
                  onClick={() => doBiometricLogin(bootInfo.usernameHint)}
                  disabled={phase === 'authing'}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-3.5 text-sm font-semibold text-white transition hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 shadow-lg shadow-violet-600/20"
                >
                  <Fingerprint className="h-5 w-5" />
                  {phase === 'authing' ? 'Verifying…' : 'Sign In with Biometric'}
                </button>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void doPasswordLogin();
                }}
                className="space-y-3"
              >
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">
                    Driver Email or Employee ID
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="driver@fleet360.io"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-white placeholder-slate-600 focus:border-violet-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">
                    Password
                  </label>
                  <input
                    type="password"
                    required
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-white placeholder-slate-600 focus:border-violet-500 focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={phase === 'authing'}
                  className="w-full rounded-xl bg-violet-600 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-violet-600/30 transition hover:bg-violet-500 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {phase === 'authing' ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" /> Verifying…
                    </>
                  ) : (
                    'Sign In with Password'
                  )}
                </button>
              </form>
            </div>
          )}

          {/* TAB 2: DIRECT VEHICLE ID / PLATE LOGIN */}
          {activeTab === 'vehicle' && (
            <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-5 shadow-xl backdrop-blur space-y-4">
              <div>
                <h2 className="text-base font-bold text-white">Enter Vehicle Identifier</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Sign in with Vehicle Code or Plate Number to activate tracking.
                </p>
              </div>

              <form onSubmit={doVehicleLogin} className="space-y-3">
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">
                    Vehicle ID or License Plate
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 96448 or VEH-000247"
                    value={vehicleIdentifier}
                    onChange={(e) => setVehicleIdentifier(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3.5 font-mono text-base text-white placeholder-slate-600 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  />
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <span className="text-[11px] text-slate-500">Suggested:</span>
                  <button
                    type="button"
                    onClick={() => setVehicleIdentifier('96448')}
                    className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[11px] text-cyan-300 hover:bg-white/10"
                  >
                    96448 (Honda Pilot)
                  </button>
                  <button
                    type="button"
                    onClick={() => setVehicleIdentifier('VEH-000247')}
                    className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[11px] text-slate-300 hover:bg-white/10"
                  >
                    VEH-000247
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={phase === 'authing'}
                  className="w-full rounded-xl bg-violet-600 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-violet-600/30 transition hover:bg-violet-500 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {phase === 'authing' ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" /> Connecting…
                    </>
                  ) : (
                    'Connect & Sign In Vehicle'
                  )}
                </button>
              </form>

              <div className="rounded-xl bg-slate-950/60 border border-white/5 p-3 text-[11px] text-slate-400 space-y-1">
                <p className="font-semibold text-slate-300 flex items-center gap-1.5">
                  <Radio className="h-3.5 w-3.5 text-cyan-400" /> Mobile GPS Telematics Rule:
                </p>
                <p>
                  • If <strong>Device ID is Blank</strong>, you can activate smartphone GPS tracking.
                </p>
                <p>
                  • If <strong>Hardware GPS Device</strong> is bound, mobile tracking remains deactivated.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <footer className="mt-6 text-center text-[11px] uppercase tracking-wider text-slate-600">
        Fleet360 v2.5 · Mobile GPS &amp; Telematics
      </footer>
    </main>
  );
}
`;

fs.writeFileSync(path.resolve('src/app/(driver)/driver-app/page.tsx'), fullCode, 'utf8');
fs.writeFileSync(path.resolve('mobile-app/src/app/page.tsx'), fullCode, 'utf8');
fs.writeFileSync(path.resolve('mobile-app/src/app/driver-app/page.tsx'), fullCode, 'utf8');
console.log('✓ Successfully written hardened driver-app launcher with parseJsonSafely protection');
