'use client';

import React, { useState, useRef } from 'react';
import {
  Truck,
  Camera,
  CheckCircle2,
  ShieldCheck,
  Building2,
  FileCheck,
  Signature,
  MapPin,
  Clock,
  Download,
  Printer,
  Sparkles,
  ThermometerSnowflake,
  AlertTriangle,
} from 'lucide-react';
import {
  DeliveryExecutionStatus,
  PalletDeliveryCondition,
  DigitalEPODRecord,
  createDigitalEPOD,
} from '@/lib/digital-epod-engine';

interface DriverHandoverEpodProps {
  bookingRef?: string;
  ebolNumber?: string;
  consigneeName?: string;
  onEpodCompleted?: (epod: DigitalEPODRecord) => void;
}

export function DriverHandoverEpod({
  bookingRef = 'EXL-FRT-9821',
  ebolNumber = 'EBOL-EXL-2026-8891',
  consigneeName = 'Dubai Mall Logistics Dock 3',
  onEpodCompleted,
}: DriverHandoverEpodProps) {
  // Driver state machine
  const [driverStatus, setDriverStatus] = useState<DeliveryExecutionStatus>('ARRIVED_AT_DESTINATION');
  const [recipientName, setRecipientName] = useState('Rashid Al-Mansoori');
  const [recipientDesignation, setRecipientDesignation] = useState('Warehouse Receiving Lead');
  const [recipientEmiratesId, setRecipientEmiratesId] = useState('784-1988-1234567-1');

  // Cargo condition checklist
  const [pallets, setPallets] = useState<PalletDeliveryCondition[]>([
    {
      palletId: 'PAL-EIN360-001',
      condition: 'INTACT_PERFECT',
      temperatureVerified: '-18.2°C (Frozen Pharma)',
      sealIntact: true,
    },
    {
      palletId: 'PAL-EIN360-002',
      condition: 'INTACT_PERFECT',
      temperatureVerified: '+3.8°C (Cold-Chain Dairy)',
      sealIntact: true,
    },
    {
      palletId: 'PAL-EIN360-003',
      condition: 'INTACT_PERFECT',
      temperatureVerified: 'Ambient (21.5°C)',
      sealIntact: true,
    },
  ]);

  // Signature state
  const [signed, setSigned] = useState(true);
  const [signatureSvg, setSignatureSvg] = useState(
    'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60"><path d="M 10 35 Q 50 10 90 35 T 180 30" stroke="%23f97316" stroke-width="3" fill="none"/></svg>'
  );

  // Generated EPOD
  const [generatedEpod, setGeneratedEpod] = useState<DigitalEPODRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Advance driver status
  const handleAdvanceStatus = async (nextStatus: DeliveryExecutionStatus) => {
    setDriverStatus(nextStatus);
    try {
      await fetch('/api/logistics/driver-handover/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tripReference: `TRIP-${bookingRef.slice(8)}`,
          status: nextStatus,
        }),
      });
    } catch {}
  };

  // Complete Handover & Seal e-POD
  const handleCompleteHandover = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    const epod = createDigitalEPOD({
      bookingRef,
      ebolNumber,
      consigneeName,
      consigneeRecipientName: recipientName,
      consigneeDesignation: recipientDesignation,
      consigneeEmiratesId: recipientEmiratesId,
      consigneeSignatureSvg: signatureSvg,
      palletsSummary: pallets,
    });

    setGeneratedEpod(epod);
    setDriverStatus('DELIVERED');
    setSubmitting(false);

    if (onEpodCompleted) onEpodCompleted(epod);
  };

  return (
    <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-3">
        <div className="flex items-center gap-2">
          <Truck className="w-4 h-4 text-orange-400" />
          <span className="text-xs font-bold text-white uppercase tracking-wider">
            Driver Mobile Handover & Electronic Proof of Delivery (e-POD)
          </span>
        </div>
        <span className="text-[10px] bg-emerald-500/10 text-emerald-300 font-mono font-bold px-2 py-0.5 rounded-full border border-emerald-500/20">
          Photo & e-Sign Verified
        </span>
      </div>

      {/* Driver Execution Milestones Tracker */}
      <div className="bg-slate-950/80 border border-white/10 rounded-xl p-3.5 space-y-2">
        <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">
          Driver Trip Execution Status:
        </span>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <button
            type="button"
            onClick={() => handleAdvanceStatus('EN_ROUTE_TO_PICKUP')}
            className={`p-2 rounded-lg border text-center transition-all ${
              driverStatus === 'EN_ROUTE_TO_PICKUP'
                ? 'bg-orange-600/20 border-orange-500 text-orange-300 font-bold'
                : 'bg-slate-900 border-white/5 text-slate-400'
            }`}
          >
            1. En Route to Base
          </button>
          <button
            type="button"
            onClick={() => handleAdvanceStatus('CARGO_LOADED')}
            className={`p-2 rounded-lg border text-center transition-all ${
              driverStatus === 'CARGO_LOADED'
                ? 'bg-orange-600/20 border-orange-500 text-orange-300 font-bold'
                : 'bg-slate-900 border-white/5 text-slate-400'
            }`}
          >
            2. Cargo Loaded
          </button>
          <button
            type="button"
            onClick={() => handleAdvanceStatus('ARRIVED_AT_DESTINATION')}
            className={`p-2 rounded-lg border text-center transition-all ${
              driverStatus === 'ARRIVED_AT_DESTINATION'
                ? 'bg-orange-600/20 border-orange-500 text-orange-300 font-bold'
                : 'bg-slate-900 border-white/5 text-slate-400'
            }`}
          >
            3. Arrived at Dock
          </button>
          <div
            className={`p-2 rounded-lg border text-center ${
              driverStatus === 'DELIVERED'
                ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 font-bold'
                : 'bg-slate-900 border-white/5 text-slate-500'
            }`}
          >
            4. e-POD Confirmed
          </div>
        </div>
      </div>

      {/* Main Handover Workspace */}
      {!generatedEpod ? (
        <form onSubmit={handleCompleteHandover} className="space-y-4">
          {/* Pallet Condition & Temperature Checklist */}
          <div className="bg-slate-950/60 border border-white/10 rounded-xl p-3.5 space-y-2.5">
            <span className="text-xs font-bold text-slate-200 block">
              1. Receiving Pallet Condition & Cold-Chain Probe Verification:
            </span>

            <div className="space-y-2">
              {pallets.map((item, idx) => (
                <div
                  key={item.palletId}
                  className="bg-slate-900 border border-white/5 rounded-lg p-2.5 flex items-center justify-between text-xs"
                >
                  <div className="space-y-0.5">
                    <span className="font-bold text-white block">
                      {idx + 1}. {item.palletId}
                    </span>
                    <span className="text-[10px] text-blue-300 flex items-center gap-1 font-mono">
                      <ThermometerSnowflake className="w-3 h-3 text-cyan-400" />
                      {item.temperatureVerified}
                    </span>
                  </div>
                  <span className="text-[10px] bg-emerald-500/10 text-emerald-300 px-2 py-0.5 rounded border border-emerald-500/20 font-bold">
                    ✓ Condition Intact & Sealed
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Proof of Delivery (POD) Dock Camera Photo */}
          <div className="bg-slate-950/60 border border-white/10 rounded-xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-200 flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5 text-orange-400" />
                2. Dock Unloading Proof Photo (GPS Watermarked)
              </span>
              <span className="text-[10px] text-emerald-400 font-mono">GPS Verified</span>
            </div>

            <div className="relative rounded-xl overflow-hidden border border-white/15 max-h-36 bg-slate-950 flex items-center justify-center">
              <img
                src="https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=800&auto=format&fit=crop&q=80"
                alt="Pallet at Loading Dock"
                className="w-full h-36 object-cover opacity-80"
              />
              <div className="absolute bottom-2 left-2 bg-black/80 backdrop-blur-md px-2.5 py-1 rounded-lg text-[10px] text-slate-300 font-mono border border-white/10">
                📍 Dubai Mall Service Dock 3 · 25.1972° N, 55.2744° E · {new Date().toLocaleTimeString()}
              </div>
            </div>
          </div>

          {/* Consignee Recipient Details & On-Glass Signature Pad */}
          <div className="bg-slate-950/60 border border-white/10 rounded-xl p-3.5 space-y-3">
            <span className="text-xs font-bold text-slate-200 block">
              3. Consignee Receiver Verification & On-Glass Signature:
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Receiver Name *</label>
                <input
                  type="text"
                  required
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  className="w-full bg-slate-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Designation</label>
                <input
                  type="text"
                  value={recipientDesignation}
                  onChange={(e) => setRecipientDesignation(e.target.value)}
                  className="w-full bg-slate-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Emirates ID *</label>
                <input
                  type="text"
                  required
                  value={recipientEmiratesId}
                  onChange={(e) => setRecipientEmiratesId(e.target.value)}
                  className="w-full bg-slate-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                />
              </div>
            </div>

            {/* On-Glass Signature Canvas */}
            <div className="border border-white/15 rounded-xl bg-slate-900 p-3 space-y-1.5">
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>Sign on glass (Consignee Receiving Signature):</span>
                <span className="text-emerald-400 font-mono">SHA-256 Captured</span>
              </div>
              <div className="h-16 bg-slate-950 rounded-lg border border-dashed border-white/20 flex items-center justify-center relative">
                <svg className="w-48 h-12">
                  <path
                    d="M 10 35 Q 50 10 90 35 T 180 30"
                    stroke="#f97316"
                    strokeWidth="3"
                    fill="none"
                  />
                </svg>
                <span className="absolute bottom-1 right-2 text-[9px] text-slate-500 font-mono">
                  Rashid Al-Mansoori (Signed)
                </span>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2 transition-all"
          >
            <FileCheck className="w-4 h-4" />
            {submitting ? 'Sealing e-POD…' : 'Seal e-POD Certificate & Release Final VAT Invoice →'}
          </button>
        </form>
      ) : (
        /* Confirmed e-POD Certificate Card */
        <div className="bg-slate-950 border border-emerald-500/30 rounded-2xl p-5 space-y-4 text-xs">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center text-lg">
                ✅
              </div>
              <div>
                <h4 className="font-bold text-white text-sm">Delivery Confirmed & e-POD Sealed</h4>
                <p className="text-[10px] text-emerald-400 font-mono">{generatedEpod.epodNumber}</p>
              </div>
            </div>
            <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full font-bold">
              VAT Invoice Released
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-slate-900/60 p-2.5 rounded-xl">
              <span className="text-[10px] text-slate-400 block">Received By:</span>
              <strong className="text-white block">{generatedEpod.consigneeRecipientName}</strong>
              <span className="text-[10px] text-slate-400 font-mono">
                EID: {generatedEpod.consigneeEmiratesId}
              </span>
            </div>
            <div className="bg-slate-900/60 p-2.5 rounded-xl">
              <span className="text-[10px] text-slate-400 block">Delivering Driver:</span>
              <strong className="text-white block">{generatedEpod.driverName}</strong>
              <span className="text-[10px] text-slate-400 font-mono">{generatedEpod.vehiclePlate}</span>
            </div>
          </div>

          <div className="bg-emerald-950/30 border border-emerald-500/30 rounded-lg p-2.5 space-y-1 text-[10px]">
            <div className="flex items-center justify-between text-emerald-400 font-bold">
              <span className="flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" /> SHA-256 e-POD Cryptographic Proof Seal
              </span>
              <span>100% Tamper-Proof</span>
            </div>
            <p className="font-mono text-slate-400 break-all">{generatedEpod.cryptographicPODSeal}</p>
          </div>

          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs border border-white/10"
            >
              <Printer className="w-3.5 h-3.5" /> Print Delivery Proof
            </button>
            <button
              type="button"
              onClick={() => setGeneratedEpod(null)}
              className="text-xs text-orange-400 hover:text-orange-300"
            >
              Reset Delivery Simulator ↺
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
