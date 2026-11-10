/**
 * src/app/track/partner-trip/[token]/page.tsx
 *
 * Public Mobile Web Screen for External Partner Drivers (Zero-Login).
 * Purpose-bound cryptographic token enables drivers to report milestones
 * (Reached, Started, Completed) and submit domain-specific 3-Way Match POD
 * across Passenger Transport, Freight, Limousine, and Roadside Recovery.
 */

'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  Clock,
  Users,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { enqueueTelemetryPoint, flushBufferedTelemetryBatch } from '@/lib/tracking/offline-telemetry-queue';

const DOMAIN_BADGE: Record<string, { label: string; cls: string }> = {
  PASSENGER_TRANSPORT: { label: '🚌 Bus & Coach', cls: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' },
  FREIGHT: { label: '🚚 Freight Load', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  LIMOUSINE: { label: '🎩 Chauffeur Limo', cls: 'bg-purple-500/15 text-purple-300 border-purple-500/30' },
  RECOVERY: { label: '🚨 Roadside Recovery', cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
};

export default function PartnerDriverTripPage() {
  const params = useParams();
  const token = params?.token as string;

  const [tripData, setTripData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submittingAction, setSubmittingAction] = useState(false);
  const [podModalOpen, setPodModalOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [gpsActive, setGpsActive] = useState(false);
  const [lastPingTime, setLastPingTime] = useState<string | null>(null);
  const [waypointData, setWaypointData] = useState<any | null>(null);

  // POD Form state (Multi-Vertical 3-Way Match Proof)
  const [passengerCount, setPassengerCount] = useState('48');
  const [deliveredWeightKg, setDeliveredWeightKg] = useState('');
  const [sealIntact, setSealIntact] = useState(true);
  const [temperatureCelsius, setTemperatureCelsius] = useState('');
  const [vipGuestConfirmed, setVipGuestConfirmed] = useState(true);
  const [actualWaitingMinutes, setActualWaitingMinutes] = useState('0');
  const [tollGateCount, setTollGateCount] = useState('0');
  const [hookupPhotoVerified, setHookupPhotoVerified] = useState(true);
  const [towDestinationWorkshop, setTowDestinationWorkshop] = useState('');
  const [signedByName, setSignedByName] = useState('');
  const [completionNotes, setCompletionNotes] = useState('');

  const loadTrip = async () => {
    if (!token) return;
    try {
      const res = await fetch(`/api/public/partner-driver/${token}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to load trip');
      }
      const data = await res.json();
      setTripData(data.trip);
      if (data.trip?.requiredCapacity) {
        setPassengerCount(String(data.trip.requiredCapacity));
        setDeliveredWeightKg(String(data.trip.requiredCapacity));
      }
      if (data.trip?.dropoffLocation) {
        setTowDestinationWorkshop(data.trip.dropoffLocation);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid or expired link');
    } finally {
      setLoading(false);
    }
  };

  const loadWaypoints = async () => {
    if (!token) return;
    try {
      const res = await fetch(`/api/public/partner-driver/${token}/waypoint`);
      if (res.ok) {
        const data = await res.json();
        setWaypointData(data);
      }
    } catch {}
  };

  useEffect(() => {
    void loadTrip();
    void loadWaypoints();
  }, [token]);

  const handleWaypointCheckin = async (sequence: number, action: 'ARRIVED' | 'DEPARTED' | 'CHECKIN') => {
    try {
      const res = await fetch(`/api/public/partner-driver/${token}/waypoint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sequence, action }),
      });
      if (res.ok) {
        const data = await res.json();
        setWaypointData(data);
        setFeedback(`✓ Stop ${sequence} checked in successfully!`);
        setTimeout(() => setFeedback(null), 3000);
      }
    } catch {}
  };

  // Continuous HTML5 GPS Telemetry Stream with Offline-First Buffering
  useEffect(() => {
    if (!token || !navigator.geolocation || tripData?.completedAt) return;

    const handleOnline = () => {
      flushBufferedTelemetryBatch(token).catch(() => {});
    };
    window.addEventListener('online', handleOnline);

    const watchId = navigator.geolocation.watchPosition(
      async (pos) => {
        setGpsActive(true);
        setLastPingTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));

        const pingPayload = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          speed: pos.coords.speed ? pos.coords.speed * 3.6 : undefined,
          heading: pos.coords.heading || undefined,
          accuracy: pos.coords.accuracy,
          timestamp: new Date().toISOString(),
        };

        try {
          const res = await fetch(`/api/public/partner-driver/${token}/telemetry`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pingPayload),
          });

          if (res.ok) {
            flushBufferedTelemetryBatch(token).catch(() => {});
            const result = await res.json();
            if (result.geofenceTriggered === 'PICKUP_REACHED' && !tripData?.reachedAt) {
              setFeedback('📍 Pickup Geofence Entered! Status updated to Reached.');
              await loadTrip();
            }
          } else {
            await enqueueTelemetryPoint(token, pingPayload);
          }
        } catch {
          await enqueueTelemetryPoint(token, pingPayload);
        }
      },
      () => setGpsActive(false),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );

    return () => {
      window.removeEventListener('online', handleOnline);
      navigator.geolocation.clearWatch(watchId);
    };
  }, [token, tripData?.completedAt, tripData?.reachedAt]);

  const handleAction = async (action: 'REACHED' | 'STARTED' | 'COMPLETED', podPayload?: any) => {
    setSubmittingAction(true);
    try {
      const res = await fetch(`/api/public/partner-driver/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          ...podPayload,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Action failed');
      }

      setFeedback(`✓ Milestone ${action} recorded successfully!`);
      setTimeout(() => setFeedback(null), 4000);
      setPodModalOpen(false);
      await loadTrip();
      try {
        if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
          const bc = new BroadcastChannel('fleet360-exchange-live');
          bc.postMessage({ type: 'DRIVER_MILESTONE_UPDATED', action, source: 'driver-tracker', timestamp: Date.now() });
          bc.close();
        }
      } catch {}
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error submitting milestone');
    } finally {
      setSubmittingAction(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 text-slate-400 text-xs font-semibold">
        Loading outsourced trip details...
      </div>
    );
  }

  if (error || !tripData) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="max-w-sm w-full bg-slate-900 border border-slate-800 rounded-3xl p-6 text-center space-y-3">
          <AlertCircle className="w-12 h-12 text-rose-500 mx-auto" />
          <h1 className="text-base font-bold text-white">Trip Link Unavailable</h1>
          <p className="text-xs text-slate-400">{error || 'This driver trip link is expired or invalid.'}</p>
        </div>
      </div>
    );
  }

  const domain: string = tripData.domain || 'PASSENGER_TRANSPORT';
  const domainInfo = DOMAIN_BADGE[domain] || DOMAIN_BADGE.PASSENGER_TRANSPORT;
  const reached = !!tripData.reachedAt;
  const started = !!tripData.startedAt;
  const completed = !!tripData.completedAt;

  const submitDomainPod = () => {
    const podMetadata: Record<string, unknown> = { domain };
    if (domain === 'FREIGHT') {
      podMetadata.deliveredWeightKg = Number(deliveredWeightKg || 0);
      podMetadata.sealIntact = sealIntact;
      if (temperatureCelsius !== '') podMetadata.temperatureCelsius = Number(temperatureCelsius);
    } else if (domain === 'LIMOUSINE') {
      podMetadata.vipGuestConfirmed = vipGuestConfirmed;
      podMetadata.actualWaitingMinutes = Number(actualWaitingMinutes || 0);
      podMetadata.tollGateCount = Number(tollGateCount || 0);
    } else if (domain === 'RECOVERY') {
      podMetadata.hookupPhotoVerified = hookupPhotoVerified;
      podMetadata.towDestinationWorkshop = towDestinationWorkshop || tripData.dropoffLocation;
    }

    void handleAction('COMPLETED', {
      passengerCount:
        domain === 'FREIGHT'
          ? Number(deliveredWeightKg || 0)
          : Number(passengerCount || 1),
      signedByName,
      completionNotes,
      podMetadata,
    });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between max-w-md mx-auto shadow-2xl">
      {/* Top Header */}
      <header className="p-4 border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-20">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase font-bold text-cyan-400 tracking-wider">Outsourced Trip</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${domainInfo.cls}`}>
                {domainInfo.label}
              </span>
            </div>
            <div className="text-base font-black text-white mt-0.5">{tripData.requestNumber}</div>
          </div>
          <span
            className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${
              completed
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : started
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse'
                : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
            }`}
          >
            {completed ? 'COMPLETED' : started ? 'IN PROGRESS' : reached ? 'AT PICKUP' : 'ASSIGNED'}
          </span>
        </div>

        {/* Live GPS Telemetry Indicator */}
        {!completed && (
          <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px]">
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${gpsActive ? 'bg-emerald-400 animate-ping' : 'bg-slate-600'}`} />
              <span className={gpsActive ? 'text-emerald-400 font-bold' : 'text-slate-500'}>
                {gpsActive ? '📡 Live GPS Broadcasting Active' : 'Acquiring GPS Signal...'}
              </span>
            </div>
            {lastPingTime && <span className="text-slate-500 font-mono">Ping: {lastPingTime}</span>}
          </div>
        )}
      </header>

      {/* Main Body */}
      <main className="p-4 space-y-4 flex-1">
        {feedback && (
          <div className="p-3 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-semibold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{feedback}</span>
          </div>
        )}

        {/* Route Card */}
        <div className="p-5 rounded-3xl bg-slate-900/80 border border-slate-800 space-y-3">
          <span className="text-[10px] uppercase font-bold text-slate-400">Route & Location</span>

          <div className="space-y-2">
            <div className="flex items-start gap-2.5">
              <div className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                A
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block font-semibold">Pickup Origin</span>
                <span className="text-sm font-bold text-white">{tripData.pickupLocation}</span>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                B
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block font-semibold">Drop-off Destination</span>
                <span className="text-sm font-bold text-white">{tripData.dropoffLocation}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800 text-[11px] text-slate-300">
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-slate-500" />
              <span>{new Date(tripData.serviceDate).toLocaleDateString()} at {tripData.pickupTime}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-slate-500" />
              <span>
                {domain === 'FREIGHT'
                  ? `${tripData.requiredCapacity} kg Cargo`
                  : domain === 'RECOVERY'
                  ? tripData.vehicleTypeRequired || 'Flatbed Tow'
                  : domain === 'LIMOUSINE'
                  ? `${tripData.requiredCapacity} VIP Pax`
                  : `${tripData.requiredCapacity} Passengers`}
              </span>
            </div>
          </div>
        </div>

        {/* Multi-Stop Intermediate Waypoint Stepper */}
        {waypointData && waypointData.waypoints?.length > 1 && (
          <div className="p-4 rounded-3xl bg-slate-900/90 border border-slate-800 space-y-3 font-sans">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-bold text-cyan-400 tracking-wider">
                Multi-Stop Route Stepper ({waypointData.completedWaypoints}/{waypointData.totalWaypoints} Done)
              </span>
              <span className="text-[10px] font-mono font-bold text-slate-400">
                {waypointData.progressPercentage}%
              </span>
            </div>

            <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-cyan-500 h-full rounded-full transition-all duration-500"
                style={{ width: `${waypointData.progressPercentage}%` }}
              />
            </div>

            <div className="space-y-2 pt-1">
              {waypointData.waypoints.map((wp: any) => {
                const isTarget = wp.sequence === waypointData.currentActiveSequence && !wp.isCompleted;
                return (
                  <div
                    key={wp.sequence}
                    className={`p-3 rounded-2xl border transition ${
                      wp.isCompleted
                        ? 'bg-emerald-950/20 border-emerald-500/30 text-slate-300'
                        : isTarget
                        ? 'bg-cyan-950/30 border-cyan-500/50 text-white shadow-lg ring-1 ring-cyan-500/30'
                        : 'bg-slate-950/50 border-slate-800/80 text-slate-500'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        <span
                          className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5 ${
                            wp.isCompleted
                              ? 'bg-emerald-500 text-white'
                              : isTarget
                              ? 'bg-cyan-500 text-white animate-pulse'
                              : 'bg-slate-800 text-slate-500'
                          }`}
                        >
                          {wp.isCompleted ? '✓' : wp.sequence}
                        </span>
                        <div>
                          <span className="font-bold text-xs block">{wp.name}</span>
                          <span className="text-[10px] text-slate-400">
                            {wp.type} {wp.passengerCount ? `• ${wp.passengerCount} Pax` : ''}
                          </span>
                        </div>
                      </div>

                      {isTarget && (
                        <button
                          onClick={() => handleWaypointCheckin(wp.sequence, 'CHECKIN')}
                          className="px-2.5 py-1 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-[10px] shrink-0 transition"
                        >
                          ✓ Check-In
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Assigned Vehicle & Driver Card */}
        <div className="p-4 rounded-3xl bg-slate-900/40 border border-slate-800 text-xs space-y-1.5">
          <div className="flex justify-between text-slate-400">
            <span>Assigned Vehicle:</span>
            <span className="font-bold text-cyan-300 font-mono">{tripData.vehiclePlate}</span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>Driver:</span>
            <span className="font-semibold text-white">{tripData.driverName}</span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>Partner Operator:</span>
            <span className="font-semibold text-slate-200">{tripData.partnerName}</span>
          </div>
        </div>

        {/* Milestone Stepper Status */}
        <div className="p-4 rounded-3xl bg-slate-900/60 border border-slate-800 space-y-3">
          <span className="text-[10px] uppercase font-bold text-slate-400">Trip Milestones</span>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${reached ? 'bg-emerald-400' : 'bg-slate-700'}`} />
                <span>1. Reached Pickup</span>
              </span>
              <span className="font-mono text-[11px] text-slate-400">
                {tripData.reachedAt ? new Date(tripData.reachedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Pending'}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${started ? 'bg-emerald-400' : 'bg-slate-700'}`} />
                <span>2. Departed / Trip Started</span>
              </span>
              <span className="font-mono text-[11px] text-slate-400">
                {tripData.startedAt ? new Date(tripData.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Pending'}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${completed ? 'bg-emerald-400' : 'bg-slate-700'}`} />
                <span>3. Completed & 3-Way Match POD Uploaded</span>
              </span>
              <span className="font-mono text-[11px] text-slate-400">
                {tripData.completedAt ? new Date(tripData.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Pending'}
              </span>
            </div>
          </div>
        </div>

        {/* POD Details Card if Completed */}
        {tripData.pod && (
          <div className="p-4 rounded-3xl bg-emerald-950/30 border border-emerald-500/40 text-xs space-y-1.5 text-emerald-200">
            <div className="font-bold flex items-center gap-1.5 text-emerald-300">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>3-Way Match Proof of Delivery (POD) Verified</span>
            </div>
            <p className="text-[11px] text-emerald-300/80">
              {domain === 'FREIGHT' ? 'Cargo Weight (kg)' : 'Recorded Count'}:{' '}
              <span className="font-bold">{tripData.pod.passengerCount}</span> · Signed by:{' '}
              <span className="font-bold">{tripData.pod.signedByName || 'Authorized Receiver'}</span>
            </p>
          </div>
        )}
      </main>

      {/* Action Footer Button Bar */}
      <footer className="p-4 border-t border-slate-800 bg-slate-900/95 sticky bottom-0 z-20">
        {!reached && (
          <button
            onClick={() => handleAction('REACHED')}
            disabled={submittingAction}
            className="w-full py-3.5 rounded-2xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-sm shadow-xl shadow-cyan-600/30 transition disabled:opacity-50"
          >
            {submittingAction ? 'Updating...' : '📍 Reached Pickup Point'}
          </button>
        )}

        {reached && !started && (
          <button
            onClick={() => handleAction('STARTED')}
            disabled={submittingAction}
            className="w-full py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-xl shadow-emerald-600/30 transition disabled:opacity-50"
          >
            {submittingAction ? 'Updating...' : '▶️ Start Trip / Depart'}
          </button>
        )}

        {started && !completed && (
          <button
            onClick={() => setPodModalOpen(true)}
            disabled={submittingAction}
            className="w-full py-3.5 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm shadow-xl shadow-amber-500/30 transition disabled:opacity-50"
          >
            ⏹️ Complete Trip & Submit POD
          </button>
        )}

        {completed && (
          <div className="py-2.5 text-center text-xs font-bold text-emerald-400 flex items-center justify-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            <span>Trip Complete · 3-Way Match POD Recorded!</span>
          </div>
        )}
      </footer>

      {/* ── SUBMIT DOMAIN-SPECIFIC POD MODAL ── */}
      {podModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-950 border border-slate-800 rounded-3xl p-5 max-w-sm w-full space-y-4 shadow-2xl text-xs">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">3-Way Match Proof of Delivery</h3>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${domainInfo.cls}`}>
                {domainInfo.label}
              </span>
            </div>

            <div className="space-y-3">
              {domain === 'FREIGHT' && (
                <>
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">Delivered Cargo Weight (kg) *</label>
                    <input
                      type="number"
                      required
                      value={deliveredWeightKg}
                      onChange={(e) => setDeliveredWeightKg(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white font-bold text-sm focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={sealIntact}
                        onChange={(e) => setSealIntact(e.target.checked)}
                      />
                      <span>Seal Intact</span>
                    </label>
                    <div>
                      <input
                        type="number"
                        step="0.1"
                        placeholder="Reefer °C (opt)"
                        value={temperatureCelsius}
                        onChange={(e) => setTemperatureCelsius(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>
                </>
              )}

              {domain === 'LIMOUSINE' && (
                <>
                  <label className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={vipGuestConfirmed}
                      onChange={(e) => setVipGuestConfirmed(e.target.checked)}
                    />
                    <span className="font-semibold">VIP Guest Drop-Off Confirmed</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-slate-400 text-[10px] mb-1">Waiting Time (mins)</label>
                      <input
                        type="number"
                        min="0"
                        value={actualWaitingMinutes}
                        onChange={(e) => setActualWaitingMinutes(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2 text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 text-[10px] mb-1">Salik/Darb Tolls</label>
                      <input
                        type="number"
                        min="0"
                        value={tollGateCount}
                        onChange={(e) => setTollGateCount(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2 text-white"
                      />
                    </div>
                  </div>
                </>
              )}

              {domain === 'RECOVERY' && (
                <>
                  <label className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hookupPhotoVerified}
                      onChange={(e) => setHookupPhotoVerified(e.target.checked)}
                    />
                    <span className="font-semibold">4-Corner Pre-Tow & Hookup Photo Verified</span>
                  </label>
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">Receiving Workshop / Garage *</label>
                    <input
                      type="text"
                      value={towDestinationWorkshop}
                      onChange={(e) => setTowDestinationWorkshop(e.target.value)}
                      placeholder="e.g. Al Quoz Central Workshop"
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </>
              )}

              {domain === 'PASSENGER_TRANSPORT' && (
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Total Passengers Transported *</label>
                  <input
                    type="number"
                    required
                    value={passengerCount}
                    onChange={(e) => setPassengerCount(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white font-bold text-sm focus:outline-none focus:border-emerald-500"
                  />
                </div>
              )}

              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  {domain === 'FREIGHT'
                    ? 'Consignee / Warehouse Receiver Name'
                    : domain === 'RECOVERY'
                    ? 'Workshop Service Advisor Sign-Off'
                    : domain === 'LIMOUSINE'
                    ? 'VIP / Concierge Sign-Off Name'
                    : 'Client / Site Sign-Off Name'}
                </label>
                <input
                  type="text"
                  value={signedByName}
                  onChange={(e) => setSignedByName(e.target.value)}
                  placeholder="e.g. Supervisor Ahmed"
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Notes / Delay Observations</label>
                <textarea
                  rows={2}
                  value={completionNotes}
                  onChange={(e) => setCompletionNotes(e.target.value)}
                  placeholder="e.g. Safe delivery, arrived on time"
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setPodModalOpen(false)}
                className="px-4 py-2 text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitDomainPod}
                disabled={submittingAction}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-lg shadow-emerald-600/30 transition disabled:opacity-50"
              >
                {submittingAction ? 'Submitting...' : 'Confirm Completion'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
