'use client';

import React, { useState, useEffect } from 'react';
import {
  Truck,
  Mail,
  Fingerprint,
  ShieldCheck,
  Building2,
  MapPin,
  Clock,
  ArrowRight,
  CheckCircle2,
  Sparkles,
  Phone,
  MessageSquare,
  FileText,
  DollarSign,
  Lock,
} from 'lucide-react';
import { TenantMobileConfig } from '@/app/api/tenant/mobile-config/route';
import { InteractiveRoutePicker } from '@/components/booking/InteractiveRoutePicker';
import { AssetAvailabilitySelector } from '@/components/booking/AssetAvailabilitySelector';
import { InstantPricingCostCenter } from '@/components/booking/InstantPricingCostCenter';
import { OmnichannelNotificationPreferences } from '@/components/booking/OmnichannelNotificationPreferences';
import { DigitalKycUaePass } from '@/components/booking/DigitalKycUaePass';

export function UniversalMobileBookingApp() {
  // Authentication & Domain Discovery state
  const [emailInput, setEmailInput] = useState('fatima@ein360.ae');
  const [isConfigLoaded, setIsConfigLoaded] = useState(false);
  const [config, setConfig] = useState<TenantMobileConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [biometricUnlocked, setBiometricUnlocked] = useState(false);

  // Freight Booking state
  const [form, setForm] = useState<Record<string, any>>({
    serviceType: 'LOGISTICS',
    requestorName: 'Fatima Al-Nuaimi',
    requestorEmail: 'fatima@ein360.ae',
    contactPhone: '+971 50 887 6543',
    cargoType: '3-Ton Reefer (Cold-Chain)',
    vehicleCategory: '3-Ton Reefer (Cold-Chain)',
    weightTons: '2.5',
    palletCount: '4',
    temperatureReq: '-18°C Frozen Pharma',
    origin: 'Jebel Ali (JAFZA) Logistics Base Gate 4',
    destination: 'Dubai Mall Service Dock 3, Downtown',
    distanceKm: 38,
    durationMins: 42,
    salikTollsAed: 8,
    fareSubtotal: 559,
    vatAmount: 27.95,
    totalFareAed: 586.95,
    costCenter: 'CC-EIN360-LOGISTICS',
    billingMethod: 'CORPORATE_ACCOUNT',
    budgetStatus: 'WITHIN_POLICY',
    uaePassVerified: true,
    emiratesId: '784-1992-7654321-3',
  });

  const [submittedBookingRef, setSubmittedBookingRef] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 1. Resolve Corporate Email Domain (@ein360.ae -> EXL Solutions)
  const handleResolveEmail = async (emailToResolve?: string) => {
    const email = emailToResolve || emailInput;
    try {
      setLoadingConfig(true);
      const res = await fetch('/api/tenant/mobile-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        const json = await res.json();
        setConfig(json.config);
        setIsConfigLoaded(true);

        if (json.config?.client) {
          setForm((prev) => ({
            ...prev,
            requestorEmail: email,
            costCenter: json.config.client.costCenter,
            billingMethod: json.config.client.billingMethod,
          }));
        }
      }
    } catch (err) {
      console.error('Failed to resolve email domain:', err);
    } finally {
      setLoadingConfig(false);
    }
  };

  // Quick Biometric TouchID Simulation
  const handleBiometricTouch = () => {
    setBiometricUnlocked(true);
    handleResolveEmail('fatima@ein360.ae');
  };

  const handleBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      const ref = `EXL-FRT-${Math.floor(1000 + Math.random() * 9000)}`;

      const payload = {
        bookingRef: ref,
        requestorName: form.requestorName,
        requestorEmail: form.requestorEmail,
        serviceType: 'LOGISTICS',
        vehicleCategory: form.vehicleCategory,
        startDate: new Date().toISOString(),
        status: 'PENDING',
        notes: JSON.stringify(form),
      };

      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setSubmittedBookingRef(ref);
      }
    } catch (err) {
      console.error('Booking submission failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-md mx-auto min-h-screen bg-slate-950 text-white shadow-2xl border-x border-white/10 flex flex-col justify-between">
      {/* ── App Top Header ── */}
      <div className="bg-slate-900 border-b border-white/10 p-4 sticky top-0 z-40 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-white text-base shadow-md"
            style={{ backgroundColor: config?.brandColor || '#f97316' }}
          >
            🚛
          </div>
          <div>
            <h2 className="text-sm font-bold text-white tracking-tight">
              {config ? `${config.tenantName} Logistics` : 'Fleet360 Mobile'}
            </h2>
            <p className="text-[10px] text-slate-400">
              {config?.client ? `Corporate Client: ${config.client.name}` : 'Universal Enterprise Edition'}
            </p>
          </div>
        </div>

        {isConfigLoaded && (
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded-full border text-white"
            style={{
              backgroundColor: `${config?.brandColor || '#f97316'}20`,
              borderColor: config?.brandColor || '#f97316',
            }}
          >
            FREIGHT ONLY
          </span>
        )}
      </div>

      {/* ── Main Mobile Content ── */}
      <div className="p-4 flex-1 space-y-4">
        {/* ══════════════════════════════════════════════════════════════
            1. First-Time Launch Screen (Corporate Email Discovery)
        ══════════════════════════════════════════════════════════════ */}
        {!isConfigLoaded ? (
          <div className="py-8 space-y-6 text-center">
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-tr from-orange-600 to-amber-500 mx-auto flex items-center justify-center text-4xl shadow-xl shadow-orange-500/20">
              📱
            </div>

            <div className="space-y-1">
              <h1 className="text-2xl font-black text-white">Fleet360 Mobile</h1>
              <p className="text-xs text-slate-400 max-w-xs mx-auto">
                Sign in with your corporate email to automatically configure your transport provider portal.
              </p>
            </div>

            {/* Corporate Email Input Box */}
            <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-4 text-left space-y-3">
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider">
                Corporate Email Address <span className="text-orange-400">*</span>
              </label>

              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                <input
                  type="email"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="name@ein360.ae"
                  className="w-full bg-slate-950 border border-white/15 rounded-xl pl-10 pr-3 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                />
              </div>

              {emailInput.toLowerCase().includes('ein360.ae') && (
                <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-2.5 flex items-center gap-2 text-[11px] text-orange-300">
                  <Sparkles className="w-4 h-4 text-orange-400 flex-shrink-0" />
                  <span>
                    Recognized: <strong>EIN360</strong> corporate client of <strong>EXL Solutions</strong>
                  </span>
                </div>
              )}

              <button
                type="button"
                onClick={() => handleResolveEmail()}
                disabled={loadingConfig || !emailInput}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white text-xs font-bold shadow-lg shadow-orange-500/25 flex items-center justify-center gap-2 transition-all disabled:opacity-40"
              >
                {loadingConfig ? 'Discovering Corporate Domain…' : 'Open EXL Solutions Freight App →'}
              </button>
            </div>

            {/* Quick Biometric Touch Option */}
            <div className="pt-2">
              <p className="text-[11px] text-slate-500 mb-2">Or Quick Sign In</p>
              <button
                type="button"
                onClick={handleBiometricTouch}
                className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-white/10 text-slate-300 text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                <Fingerprint className="w-4 h-4 text-orange-400" />
                <span>1-Touch Biometric Sign In (Fatima @ EIN360)</span>
              </button>
            </div>
          </div>
        ) : submittedBookingRef ? (
          /* ══════════════════════════════════════════════════════════════
              3. Booking Submitted Screen
          ══════════════════════════════════════════════════════════════ */
          <div className="py-8 space-y-5 text-center">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-3xl mx-auto flex items-center justify-center">
              ✅
            </div>

            <div>
              <h2 className="text-xl font-bold text-white">Freight Shipment Requested!</h2>
              <p className="text-xs text-slate-400 mt-1">
                Dispatched to <strong>EXL Solutions Logistics Operations</strong>
              </p>
            </div>

            <div className="bg-slate-900 border border-white/10 rounded-2xl p-4 text-left space-y-3">
              <div className="flex justify-between text-xs border-b border-white/5 pb-2">
                <span className="text-slate-400">Shipment Ref:</span>
                <span className="font-mono font-bold text-orange-400">{submittedBookingRef}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Shipper:</span>
                <span className="font-semibold text-white">EIN360 (Fatima Al-Nuaimi)</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Cargo Type:</span>
                <span className="text-slate-200">{form.cargoType}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Total Contracted Fare:</span>
                <span className="font-mono font-bold text-emerald-400">AED {form.totalFareAed}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Cost Center:</span>
                <span className="font-mono text-slate-300">{form.costCenter}</span>
              </div>
            </div>

            <button
              onClick={() => setSubmittedBookingRef(null)}
              className="w-full py-3 rounded-xl bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold shadow-lg shadow-orange-600/25 transition-all"
            >
              + Book Another Cargo Load
            </button>
          </div>
        ) : (
          /* ══════════════════════════════════════════════════════════════
              2. Dynamic Freight Booking Screen (EXL Solutions Logistics)
          ══════════════════════════════════════════════════════════════ */
          <form onSubmit={handleBookingSubmit} className="space-y-4">
            {/* Client Context Banner */}
            <div className="bg-gradient-to-r from-orange-950/40 to-slate-900 border border-orange-500/30 rounded-2xl p-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Building2 className="w-4 h-4 text-orange-400" />
                <div>
                  <p className="text-xs font-bold text-white">EIN360 Corporate Account</p>
                  <p className="text-[10px] text-orange-300/80 font-mono">
                    Code: {config?.client?.costCenter} · 15% Discount Applied
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsConfigLoaded(false)}
                className="text-[10px] text-slate-400 hover:text-white border border-white/10 rounded-lg px-2 py-1"
              >
                Switch
              </button>
            </div>

            {/* Cargo Classification & Temperature */}
            <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 space-y-3">
              <label className="block text-xs font-bold text-white uppercase tracking-wider">
                1. Freight & Cargo Classification
              </label>

              <select
                value={form.cargoType}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    cargoType: e.target.value,
                    vehicleCategory: e.target.value,
                  }))
                }
                className="w-full bg-slate-950 border border-white/15 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-orange-500"
              >
                <option value="3-Ton Reefer (Cold-Chain)">🧊 3-Ton Reefer Truck (-18°C Pharma/Food)</option>
                <option value="3-Ton Box Truck">📦 3-Ton Dry Cargo Box Truck</option>
                <option value="1-Ton Courier Van">🚐 1-Ton Express Courier Van</option>
                <option value="7-Ton Curtain Sider">🚛 7-Ton Heavy Curtain Sider</option>
                <option value="40ft Flatbed Trailer">🏗️ 40ft Heavy Flatbed Trailer</option>
              </select>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">Pallet Count</label>
                  <input
                    type="number"
                    value={form.palletCount}
                    onChange={(e) => setForm((prev) => ({ ...prev, palletCount: e.target.value }))}
                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">Cargo Weight (Tons)</label>
                  <input
                    type="text"
                    value={form.weightTons}
                    onChange={(e) => setForm((prev) => ({ ...prev, weightTons: e.target.value }))}
                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                  />
                </div>
              </div>
            </div>

            {/* Interactive Route & Toll Picker */}
            <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 space-y-3">
              <label className="block text-xs font-bold text-white uppercase tracking-wider">
                2. Warehouse Route & UAE Tolls
              </label>
              <InteractiveRoutePicker
                origin={form.origin}
                destination={form.destination}
                onOriginChange={(addr, coords) => setForm((prev) => ({ ...prev, origin: addr }))}
                onDestinationChange={(addr, coords) => setForm((prev) => ({ ...prev, destination: addr }))}
                onRouteChange={(stats) =>
                  setForm((prev) => ({
                    ...prev,
                    distanceKm: stats.distanceKm,
                    durationMins: stats.durationMins,
                    salikTollsAed: stats.salikTollsAed,
                  }))
                }
              />
            </div>

            {/* Live Pricing & Cost Center */}
            <InstantPricingCostCenter
              serviceType="LOGISTICS"
              vehicleCategory={form.vehicleCategory}
              distanceKm={form.distanceKm}
              salikTollsAed={form.salikTollsAed}
              costCenter={form.costCenter}
              billingMethod={form.billingMethod}
              onChange={(pricing) =>
                setForm((prev) => ({
                  ...prev,
                  fareSubtotal: pricing.fareSubtotal,
                  vatAmount: pricing.vatAmount,
                  totalFareAed: pricing.totalFareAed,
                  budgetStatus: pricing.budgetStatus,
                }))
              }
            />

            {/* Omnichannel Alerts */}
            <OmnichannelNotificationPreferences
              serviceType="LOGISTICS"
              vehicleCategory={form.vehicleCategory}
              pickupLocation={form.origin}
              destinationLocation={form.destination}
              totalFareAed={form.totalFareAed}
              requestorName={form.requestorName}
              phone={form.contactPhone}
              email={form.requestorEmail}
              onChange={(channels, phone) =>
                setForm((prev) => ({
                  ...prev,
                  notificationChannels: JSON.stringify(channels),
                  contactPhone: phone,
                }))
              }
            />

            {/* Digital KYC & e-Sign */}
            <DigitalKycUaePass
              requestorName={form.requestorName}
              requestorEmail={form.requestorEmail}
              onKycVerified={(kyc) =>
                setForm((prev) => ({
                  ...prev,
                  uaePassVerified: kyc.uaePassVerified,
                  emiratesId: kyc.emiratesId,
                  signatureHash: kyc.signatureHash,
                }))
              }
            />

            {/* Submit Action */}
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white text-sm font-bold shadow-xl shadow-orange-600/30 flex items-center justify-center gap-2 transition-all disabled:opacity-40"
            >
              {submitting ? 'Dispatched to EXL Solutions…' : 'Confirm & Dispatch Freight Load →'}
            </button>
          </form>
        )}
      </div>

      {/* ── App Footer ── */}
      <div className="bg-slate-900/90 border-t border-white/10 p-3 text-center text-[10px] text-slate-500">
        Powered by Fleet360 Enterprise Mobility OS · Secured with Multi-Tenant RLS
      </div>
    </div>
  );
}
