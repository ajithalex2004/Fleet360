'use client';

import React, { useState, useEffect } from 'react';
import {
  ThermometerSnowflake,
  Activity,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Building2,
  FileCheck,
  Download,
  Printer,
  Sparkles,
  Wifi,
  Battery,
  Layers,
  Clock,
  DoorClosed,
  DoorOpen,
} from 'lucide-react';
import {
  ColdChainTelemetryProfile,
  ColdChainTelemetryReading,
  generateContinuousTelemetryStream,
  COLD_CHAIN_TARGET_BANDS,
} from '@/lib/cold-chain-telematics';

interface ColdChainTelemetryGraphProps {
  tripRef?: string;
  cargoTypeKey?: string;
  onAlertTriggered?: (msg: string) => void;
}

export function ColdChainTelemetryGraph({
  tripRef = 'TRIP-9821',
  cargoTypeKey = 'FROZEN_PHARMA',
  onAlertTriggered,
}: ColdChainTelemetryGraphProps) {
  const [profile, setProfile] = useState<ColdChainTelemetryProfile>(
    generateContinuousTelemetryStream(tripRef, cargoTypeKey)
  );
  const [selectedPoint, setSelectedPoint] = useState<ColdChainTelemetryReading | null>(null);
  const [showCertificateModal, setShowCertificateModal] = useState(false);
  const [alertDispatched, setAlertDispatched] = useState<string | null>(null);

  // Periodic live telemetry simulation pulse
  useEffect(() => {
    const timer = setInterval(() => {
      setProfile(generateContinuousTelemetryStream(tripRef, cargoTypeKey));
    }, 15000);
    return () => clearInterval(timer);
  }, [tripRef, cargoTypeKey]);

  // Simulate Door Opening
  const handleSimulateDoorOpen = () => {
    const updated = { ...profile };
    const latest = { ...updated.readings[updated.readings.length - 1] };
    latest.doorStatus = 'OPEN';
    latest.temperatureC = Math.round((latest.temperatureC + 2.2) * 10) / 10;
    latest.formattedTime = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    updated.readings = [...updated.readings.slice(1), latest];
    updated.currentTempC = latest.temperatureC;
    setProfile(updated);
  };

  // Simulate Breach Alarm
  const handleTriggerBreachAlarm = async () => {
    try {
      const res = await fetch('/api/logistics/telematics/trigger-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tripRef,
          vehiclePlate: profile.vehiclePlate,
          currentTempC: -13.8,
          thresholdTempC: profile.targetBand.alertThresholdC,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        setAlertDispatched(json.alertMessage);
        if (onAlertTriggered) onAlertTriggered(json.alertMessage);
        setTimeout(() => setAlertDispatched(null), 8000);
      }
    } catch {}
  };

  // SVG Chart Dimensions
  const width = 500;
  const height = 180;
  const padding = 30;

  const minPlotTemp = profile.targetBand.minTempC - 3;
  const maxPlotTemp = profile.targetBand.alertThresholdC + 3;

  const getY = (temp: number) => {
    const range = maxPlotTemp - minPlotTemp;
    const norm = (temp - minPlotTemp) / range;
    return height - padding - norm * (height - 2 * padding);
  };

  const getX = (idx: number, total: number) => {
    return padding + (idx / (total - 1)) * (width - 2 * padding);
  };

  // Build SVG Path
  const points = profile.readings;
  const pathD = points.reduce((acc, pt, idx) => {
    const x = getX(idx, points.length);
    const y = getY(pt.temperatureC);
    return idx === 0 ? `M ${x} ${y}` : `${acc} L ${x} ${y}`;
  }, '');

  const safeTopY = getY(profile.targetBand.maxTempC);
  const safeBottomY = getY(profile.targetBand.minTempC);
  const alertThresholdY = getY(profile.targetBand.alertThresholdC);

  return (
    <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5 space-y-5">
      {/* Top Header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-3">
        <div className="flex items-center gap-2">
          <ThermometerSnowflake className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-bold text-white uppercase tracking-wider">
            Live IoT Telematics & Continuous In-Transit Cold-Chain Graph
          </span>
        </div>
        <span className="text-[10px] bg-cyan-500/10 text-cyan-300 font-mono font-bold px-2 py-0.5 rounded-full border border-cyan-500/20">
          GDP Compliant · 10s BLE Stream
        </span>
      </div>

      {/* Real-Time Sensor Telemetry HUD */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Gauge 1: Current Temperature */}
        <div className="bg-slate-950/80 border border-cyan-500/30 rounded-xl p-3.5 space-y-1">
          <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">
            Cargo Box Temp
          </span>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-mono font-bold text-cyan-300">
              {profile.currentTempC}°C
            </span>
            <span className="text-[10px] text-emerald-400 font-bold">Stable</span>
          </div>
          <span className="text-[10px] text-slate-500 block font-mono">
            Target: {profile.targetBand.minTempC}°C to {profile.targetBand.maxTempC}°C
          </span>
        </div>

        {/* Gauge 2: Sensor Health */}
        <div className="bg-slate-950/80 border border-white/10 rounded-xl p-3.5 space-y-1">
          <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">
            Wireless BLE Probe
          </span>
          <div className="flex items-center gap-2 text-white text-xs font-bold pt-1">
            <Wifi className="w-3.5 h-3.5 text-emerald-400" />
            <span>Signal: -62 dBm</span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono">
            <Battery className="w-3.5 h-3.5 text-emerald-400" />
            <span>Battery: {profile.sensorBatteryPercent}%</span>
          </div>
        </div>

        {/* Gauge 3: Reefer Unit */}
        <div className="bg-slate-950/80 border border-white/10 rounded-xl p-3.5 space-y-1">
          <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">
            ThermoKing Reefer
          </span>
          <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5 pt-1">
            <Activity className="w-3.5 h-3.5 text-emerald-400" /> Compressor Cooling
          </span>
          <span className="text-[10px] text-slate-400 block font-mono">Diesel Standby (Active)</span>
        </div>

        {/* Gauge 4: Compliance Score */}
        <div className="bg-slate-950/80 border border-white/10 rounded-xl p-3.5 space-y-1">
          <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">
            GDP Quality Score
          </span>
          <span className="text-2xl font-mono font-bold text-emerald-400 block">
            {profile.complianceScorePercent}%
          </span>
          <span className="text-[10px] text-emerald-300 font-bold block">
            ✓ Dubai Foodwatch Approved
          </span>
        </div>
      </div>

      {/* SVG Interactive In-Transit Temperature Curve */}
      <div className="bg-slate-950/90 border border-white/10 rounded-xl p-4 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold text-slate-300 flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-cyan-400" />
            Continuous In-Transit Temperature Curve (Last 72 Minutes)
          </span>
          <div className="flex items-center gap-3 text-[10px]">
            <span className="flex items-center gap-1 text-emerald-400">
              <span className="w-2.5 h-2.5 bg-emerald-500/20 border border-emerald-500/50 rounded inline-block" />
              Safe Band ({profile.targetBand.minTempC}°C to {profile.targetBand.maxTempC}°C)
            </span>
            <span className="flex items-center gap-1 text-rose-400 font-mono">
              <span className="w-2.5 h-0.5 bg-rose-500 inline-block" />
              Alarm Limit ({profile.targetBand.alertThresholdC}°C)
            </span>
          </div>
        </div>

        {/* SVG Container */}
        <div className="w-full overflow-x-auto">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-44 overflow-visible">
            {/* Safe Zone Background Band */}
            <rect
              x={padding}
              y={safeTopY}
              width={width - 2 * padding}
              height={Math.max(2, safeBottomY - safeTopY)}
              fill="rgba(16, 185, 129, 0.12)"
              stroke="rgba(16, 185, 129, 0.3)"
              strokeDasharray="3 3"
            />

            {/* Alarm Threshold Red Line */}
            <line
              x1={padding}
              y1={alertThresholdY}
              x2={width - padding}
              y2={alertThresholdY}
              stroke="#f43f5e"
              strokeWidth="1.5"
              strokeDasharray="4 4"
            />

            {/* Continuous Temperature Curve Line */}
            <path
              d={pathD}
              fill="none"
              stroke="#06b6d4"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Individual Data Points */}
            {points.map((pt, idx) => {
              const cx = getX(idx, points.length);
              const cy = getY(pt.temperatureC);
              const isSelected = selectedPoint?.timestamp === pt.timestamp;

              return (
                <g key={pt.timestamp} onClick={() => setSelectedPoint(pt)} className="cursor-pointer">
                  <circle
                    cx={cx}
                    cy={cy}
                    r={isSelected ? 5 : pt.doorStatus === 'OPEN' ? 4.5 : 2.5}
                    fill={pt.doorStatus === 'OPEN' ? '#f97316' : '#06b6d4'}
                    stroke="#0f172a"
                    strokeWidth="1"
                  />
                  {pt.doorStatus === 'OPEN' && (
                    <text
                      x={cx}
                      y={cy - 8}
                      textAnchor="middle"
                      fill="#f97316"
                      fontSize="9"
                      fontFamily="monospace"
                    >
                      🚪 Open
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        {/* Hovered / Selected Data Point Details */}
        {selectedPoint ? (
          <div className="bg-slate-900 border border-cyan-500/30 rounded-lg p-2 flex items-center justify-between text-xs text-slate-300">
            <span>
              Time: <strong className="text-white font-mono">{selectedPoint.formattedTime}</strong>
            </span>
            <span>
              Temp: <strong className="text-cyan-300 font-mono">{selectedPoint.temperatureC}°C</strong>
            </span>
            <span>
              Door: <strong className="text-white">{selectedPoint.doorStatus}</strong>
            </span>
            <span>
              Humidity: <strong className="text-white font-mono">{selectedPoint.humidityPercent}%</strong>
            </span>
          </div>
        ) : (
          <p className="text-[10px] text-slate-500 text-center">
            Tip: Click any node along the curve to view exact minute-by-minute telemetry.
          </p>
        )}
      </div>

      {/* Simulated Incident Testing Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-white/10">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Live Simulator:</span>
          <button
            type="button"
            onClick={handleSimulateDoorOpen}
            className="text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-xl border border-white/10 flex items-center gap-1.5 transition-colors"
          >
            <DoorOpen className="w-3.5 h-3.5 text-orange-400" />
            Simulate Dock Door Open (+2.2°C)
          </button>
          <button
            type="button"
            onClick={handleTriggerBreachAlarm}
            className="text-[11px] bg-rose-950/60 hover:bg-rose-900/60 text-rose-300 px-3 py-1.5 rounded-xl border border-rose-500/30 flex items-center gap-1.5 transition-colors"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
            Trigger Breach Alert
          </button>
        </div>

        <button
          type="button"
          onClick={() => setShowCertificateModal(true)}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-bold shadow-md shadow-cyan-500/20 transition-all"
        >
          <FileCheck className="w-3.5 h-3.5" />
          View GDP Cold-Chain Certificate
        </button>
      </div>

      {alertDispatched && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 text-rose-300 text-xs flex items-center gap-2 animate-pulse">
          <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
          <span>{alertDispatched}</span>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
          OFFICIAL GDP / DUBAI MUNICIPALITY COLD-CHAIN CERTIFICATE MODAL
      ══════════════════════════════════════════════════════════════ */}
      {showCertificateModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/20 rounded-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5 shadow-2xl text-white">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-cyan-600 flex items-center justify-center text-white font-bold text-lg">
                  ❄️
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">
                    Good Distribution Practice (GDP) Cold-Chain Audit
                  </h3>
                  <p className="text-xs text-cyan-400 font-mono">Trip: {profile.tripReference}</p>
                </div>
              </div>
              <button
                onClick={() => setShowCertificateModal(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕ Close
              </button>
            </div>

            <div className="bg-slate-950 border border-white/15 rounded-xl p-5 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3 border-b border-white/10 pb-3">
                <div>
                  <span className="text-[10px] text-slate-500 uppercase block font-bold">Vehicle / Reefer</span>
                  <strong className="text-white block">{profile.vehiclePlate}</strong>
                  <span className="text-[10px] text-slate-400 font-mono">Sensor: {profile.sensorId}</span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-500 uppercase block font-bold">Compliance Status</span>
                  <span className="text-emerald-400 font-bold block text-sm">
                    {profile.gdpStatus} ({profile.complianceScorePercent}%)
                  </span>
                  <span className="text-[10px] text-slate-400">Dubai Foodwatch & MOHAP Certified</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-slate-900/60 p-2.5 rounded-lg">
                  <span className="text-[10px] text-slate-400 block">Average In-Transit</span>
                  <strong className="text-cyan-300 font-mono text-sm">{profile.averageTempC}°C</strong>
                </div>
                <div className="bg-slate-900/60 p-2.5 rounded-lg">
                  <span className="text-[10px] text-slate-400 block">Min Recorded</span>
                  <strong className="text-blue-300 font-mono text-sm">{profile.minTempC}°C</strong>
                </div>
                <div className="bg-slate-900/60 p-2.5 rounded-lg">
                  <span className="text-[10px] text-slate-400 block">Max Recorded</span>
                  <strong className="text-orange-300 font-mono text-sm">{profile.maxTempC}°C</strong>
                </div>
              </div>

              {/* SHA-256 Validation Seal */}
              <div className="bg-emerald-950/30 border border-emerald-500/30 rounded-lg p-3 space-y-1 text-[10px]">
                <div className="flex items-center justify-between text-emerald-400 font-bold">
                  <span className="flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5" /> SHA-256 Cryptographic Audit Seal
                  </span>
                  <span>Tamper-Proof Audit Record</span>
                </div>
                <p className="font-mono text-slate-400 break-all">{profile.certificateSeal}</p>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
              >
                <Printer className="w-4 h-4" /> Print Certificate PDF
              </button>
              <button
                type="button"
                onClick={() => setShowCertificateModal(false)}
                className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow-md"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
