'use client';

import React, { useState, useEffect } from 'react';
import {
  Truck,
  Mail,
  Phone,
  Fingerprint,
  ShieldCheck,
  Building2,
  MapPin,
  Clock,
  ArrowRight,
  CheckCircle2,
  Sparkles,
  MessageSquare,
  FileText,
  DollarSign,
  Lock,
  Eye,
  EyeOff,
  KeyRound,
  RefreshCw,
  Smartphone,
  AlertCircle,
} from 'lucide-react';
import { TenantMobileConfig } from '@/app/api/tenant/mobile-config/route';
import { InteractiveRoutePicker } from '@/components/booking/InteractiveRoutePicker';
import { MultiStopRoutePicker } from '@/components/booking/MultiStopRoutePicker';
import { AssetAvailabilitySelector } from '@/components/booking/AssetAvailabilitySelector';
import { InstantPricingCostCenter } from '@/components/booking/InstantPricingCostCenter';
import { OmnichannelNotificationPreferences } from '@/components/booking/OmnichannelNotificationPreferences';
import { DigitalKycUaePass } from '@/components/booking/DigitalKycUaePass';
import { DigitalEbolScanner } from '@/components/booking/DigitalEbolScanner';
import { RecurringSchedulePicker } from '@/components/booking/RecurringSchedulePicker';
import { DriverHandoverEpod } from '@/components/booking/DriverHandoverEpod';
import { ColdChainTelemetryGraph } from '@/components/booking/ColdChainTelemetryGraph';
import { BulkConsignmentUploader } from '@/components/booking/BulkConsignmentUploader';

type AuthStep =
  | 'IDENTIFIER_INPUT' // Email or Mobile input
  | 'DUAL_CHANNEL_OTP' // 6-digit OTP verification
  | 'PASSWORD_CREATION_GATE' // Set password & Biometrics
  | 'RETURNING_USER_LOGIN' // 1-Touch Biometrics or Password Login
  | 'BOOKING_PORTAL'; // Authenticated in Freight Portal

export function UniversalMobileBookingApp() {
  // Auth state machine
  const [authStep, setAuthStep] = useState<AuthStep>('IDENTIFIER_INPUT');
  const [identifier, setIdentifier] = useState('fatima@ein360.ae'); // email or mobile
  const [rosterUser, setRosterUser] = useState<any>(null);
  const [rosterClient, setRosterClient] = useState<any>(null);
  const [channelsDispatched, setChannelsDispatched] = useState<string[]>(['EMAIL', 'WHATSAPP', 'SMS']);
  const [enableSmsAuth, setEnableSmsAuth] = useState(true);

  // OTP state
  const [otpValue, setOtpValue] = useState(['8', '4', '9', '2', '0', '1']);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpTimer, setOtpTimer] = useState(60);
  const [verifyingOtp, setVerifyingOtp] = useState(false);

  // Password Setup state
  const [password, setPassword] = useState('FleetSecure2026!');
  const [confirmPassword, setConfirmPassword] = useState('FleetSecure2026!');
  const [showPassword, setShowPassword] = useState(false);
  const [enableBiometrics, setEnableBiometrics] = useState(true);

  // Returning user login state
  const [savedPasswordInput, setSavedPasswordInput] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);

  // Freight Booking state
  const [config, setConfig] = useState<TenantMobileConfig | null>(null);
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

  // Step 1: Send Dual-Channel OTP
  const handleSendOtp = async () => {
    try {
      setOtpError(null);
      const res = await fetch('/api/auth/roster-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'SEND_OTP', identifier }),
      });

      const json = await res.json();
      if (!res.ok) {
        setOtpError(json.error || 'Identifier not found in authorized user roster');
        return;
      }

      setRosterUser(json.user);
      setRosterClient(json.client);
      setChannelsDispatched(json.channelsDispatched || ['EMAIL', 'WHATSAPP', 'SMS']);
      setEnableSmsAuth(json.enableSmsAuth ?? true);
      setAuthStep('DUAL_CHANNEL_OTP');
      setOtpTimer(60);
    } catch (err) {
      setOtpError('Failed to dispatch OTP. Please check your connection.');
    }
  };

  // Step 2: Verify Dual-Channel OTP
  const handleVerifyOtp = async () => {
    try {
      setVerifyingOtp(true);
      setOtpError(null);
      const code = otpValue.join('');

      const res = await fetch('/api/auth/roster-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'VERIFY_OTP', identifier, otp: code }),
      });

      const json = await res.json();
      if (!res.ok) {
        setOtpError(json.error || 'Invalid OTP code');
        return;
      }

      // Proceed to Password Creation Gate
      setAuthStep('PASSWORD_CREATION_GATE');
    } catch (err) {
      setOtpError('Verification failed');
    } finally {
      setVerifyingOtp(false);
    }
  };

  // Step 3: Complete Password Creation & Biometrics
  const handleCompletePasswordSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setOtpError('Passwords do not match');
      return;
    }

    // Load Tenant Mobile Config
    try {
      const res = await fetch('/api/tenant/mobile-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: rosterUser?.email || identifier }),
      });

      if (res.ok) {
        const json = await res.json();
        setConfig(json.config);
      }
    } catch {}

    setAuthStep('BOOKING_PORTAL');
  };

  // Returning User 1-Touch Biometric Sign In
  const handleBiometricSignIn = async () => {
    try {
      const res = await fetch('/api/tenant/mobile-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'fatima@ein360.ae' }),
      });

      if (res.ok) {
        const json = await res.json();
        setConfig(json.config);
        setAuthStep('BOOKING_PORTAL');
      }
    } catch {}
  };

  // Returning User Password Sign In
  const handlePasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!savedPasswordInput) {
      setLoginError('Please enter your password');
      return;
    }
    handleBiometricSignIn();
  };

  // Freight Booking Submit
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
              {rosterClient ? `Client: ${rosterClient.name}` : 'Enterprise Client Portal'}
            </p>
          </div>
        </div>

        {authStep === 'BOOKING_PORTAL' && (
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
            PHASE 1: Unified Email or Mobile Identifier Input
        ══════════════════════════════════════════════════════════════ */}
        {authStep === 'IDENTIFIER_INPUT' && (
          <div className="py-6 space-y-5 text-center">
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-tr from-orange-600 to-amber-500 mx-auto flex items-center justify-center text-4xl shadow-xl shadow-orange-500/20">
              📱
            </div>

            <div className="space-y-1">
              <h1 className="text-2xl font-black text-white">Client Portal Sign In</h1>
              <p className="text-xs text-slate-400 max-w-xs mx-auto">
                Enter your work email or registered mobile number to verify your corporate roster access.
              </p>
            </div>

            {/* Identifier Box */}
            <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-4 text-left space-y-3">
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider">
                Work Email or Mobile Number <span className="text-orange-400">*</span>
              </label>

              <div className="relative">
                <input
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="fatima@ein360.ae or +971 50 887 6543"
                  className="w-full bg-slate-950 border border-white/15 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                />
              </div>

              {/* Quick Suggestion Chips */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setIdentifier('fatima@ein360.ae')}
                  className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1 rounded-lg border border-white/5"
                >
                  📧 fatima@ein360.ae
                </button>
                <button
                  type="button"
                  onClick={() => setIdentifier('+971 50 887 6543')}
                  className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1 rounded-lg border border-white/5"
                >
                  📱 +971 50 887 6543
                </button>
              </div>

              {otpError && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-[11px] text-red-400 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{otpError}</span>
                </div>
              )}

              <button
                type="button"
                onClick={handleSendOtp}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white text-xs font-bold shadow-lg shadow-orange-500/25 flex items-center justify-center gap-2 transition-all"
              >
                Verify & Dispatch OTP Code →
              </button>
            </div>

            {/* Quick Link to Returning User Screen */}
            <div className="pt-2 border-t border-white/5">
              <button
                type="button"
                onClick={() => setAuthStep('RETURNING_USER_LOGIN')}
                className="text-xs text-slate-400 hover:text-orange-400 flex items-center justify-center gap-1.5 mx-auto transition-colors"
              >
                <Fingerprint className="w-4 h-4 text-orange-400" /> Returning user? 1-Touch Sign In
              </button>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════
            PHASE 2: Dual-Channel Synchronized OTP Verification Gate
        ══════════════════════════════════════════════════════════════ */}
        {authStep === 'DUAL_CHANNEL_OTP' && rosterUser && (
          <div className="py-6 space-y-5 text-center">
            <div className="w-16 h-16 rounded-2xl bg-orange-600/20 border border-orange-500/30 text-orange-400 text-2xl mx-auto flex items-center justify-center">
              🔐
            </div>

            <div>
              <h2 className="text-xl font-bold text-white">Enter Verification OTP</h2>
              <p className="text-xs text-slate-400 mt-1">
                Unified code dispatched for <strong>{rosterUser.name}</strong> ({rosterClient?.name})
              </p>
            </div>

            {/* Dual Channel Indicator Badge */}
            <div className="bg-slate-900/90 border border-white/10 rounded-2xl p-4 text-left space-y-2.5">
              <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">
                Synchronized OTP Sent To:
              </span>
              <div className="space-y-1.5 text-xs text-slate-300">
                <div className="flex items-center gap-2">
                  <Mail className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Work Email: <strong className="text-white">{rosterUser.email}</strong></span>
                </div>
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
                  <span>WhatsApp Cloud: <strong className="text-white">{rosterUser.mobileNumber}</strong></span>
                </div>
                {enableSmsAuth && (
                  <div className="flex items-center gap-2">
                    <Smartphone className="w-3.5 h-3.5 text-amber-400" />
                    <span>Cellular SMS: <strong className="text-white">{rosterUser.mobileNumber}</strong></span>
                  </div>
                )}
              </div>
            </div>

            {/* 6-Digit OTP Boxes */}
            <div className="flex justify-center gap-2">
              {otpValue.map((digit, idx) => (
                <input
                  key={idx}
                  type="text"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => {
                    const val = e.target.value;
                    const next = [...otpValue];
                    next[idx] = val;
                    setOtpValue(next);
                  }}
                  className="w-11 h-12 text-center font-mono font-bold text-lg bg-slate-900 border border-white/20 rounded-xl focus:border-orange-500 focus:outline-none text-orange-400"
                />
              ))}
            </div>

            <p className="text-[11px] text-slate-500">
              Demo Code: <strong className="text-slate-300 font-mono">849201</strong>
            </p>

            {otpError && (
              <p className="text-xs text-rose-400 font-semibold">{otpError}</p>
            )}

            <button
              type="button"
              onClick={handleVerifyOtp}
              disabled={verifyingOtp}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white text-xs font-bold shadow-lg shadow-orange-500/25 flex items-center justify-center gap-2 transition-all"
            >
              {verifyingOtp ? 'Verifying OTP…' : 'Verify OTP & Open Password Gate →'}
            </button>

            <div className="flex justify-between text-xs text-slate-400 pt-1">
              <button
                type="button"
                onClick={() => setAuthStep('IDENTIFIER_INPUT')}
                className="hover:text-white"
              >
                ← Change email/mobile
              </button>
              <button
                type="button"
                onClick={handleSendOtp}
                className="text-orange-400 hover:text-orange-300"
              >
                Resend OTP ↺
              </button>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════
            PHASE 3: Password Creation Gate & Biometric Enrollment
        ══════════════════════════════════════════════════════════════ */}
        {authStep === 'PASSWORD_CREATION_GATE' && (
          <form onSubmit={handleCompletePasswordSetup} className="py-4 space-y-4">
            <div className="text-center space-y-1">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-2xl mx-auto flex items-center justify-center">
                🔑
              </div>
              <h2 className="text-xl font-bold text-white">Create Account Password</h2>
              <p className="text-xs text-slate-400">
                OTP verified for <strong>{rosterUser?.name}</strong>. Set your password for future logins.
              </p>
            </div>

            <div className="bg-slate-900 border border-white/10 rounded-2xl p-4 space-y-3 text-xs">
              <div>
                <label className="text-slate-300 block mb-1 font-semibold">New Password *</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-slate-950 border border-white/15 rounded-xl px-3.5 py-2.5 text-white pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-3 text-slate-400 hover:text-white"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-slate-300 block mb-1 font-semibold">Confirm Password *</label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full bg-slate-950 border border-white/15 rounded-xl px-3.5 py-2.5 text-white"
                />
              </div>

              {/* Biometric Enrollment Toggle */}
              <div className="pt-2 border-t border-white/10">
                <label className="flex items-center justify-between cursor-pointer">
                  <div className="flex items-center gap-2">
                    <Fingerprint className="w-5 h-5 text-orange-400" />
                    <div>
                      <span className="font-bold text-white block">Enable 1-Touch Biometrics</span>
                      <span className="text-[10px] text-slate-400">Use Touch ID / Face ID for instant login</span>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={enableBiometrics}
                    onChange={(e) => setEnableBiometrics(e.target.checked)}
                    className="w-4 h-4 text-orange-600 rounded bg-slate-800 border-white/20"
                  />
                </label>
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-orange-600 to-amber-600 text-white text-xs font-bold shadow-xl shadow-orange-600/30 flex items-center justify-center gap-2"
            >
              Save Password & Enter EXL Freight Portal →
            </button>
          </form>
        )}

        {/* ══════════════════════════════════════════════════════════════
            PHASE 4: Returning User Login (Biometrics & Password Fallback)
        ══════════════════════════════════════════════════════════════ */}
        {authStep === 'RETURNING_USER_LOGIN' && (
          <div className="py-6 space-y-5 text-center">
            <div className="w-20 h-20 rounded-3xl bg-slate-900 border border-white/15 mx-auto flex items-center justify-center text-4xl shadow-xl">
              👤
            </div>

            <div className="space-y-1">
              <h2 className="text-xl font-bold text-white">Welcome Back, Fatima</h2>
              <p className="text-xs text-slate-400">EIN360 · EXL Solutions Logistics</p>
            </div>

            {/* Primary Action: 1-Touch Biometrics */}
            <div className="bg-slate-900 border border-white/10 rounded-2xl p-5 space-y-3">
              <button
                type="button"
                onClick={handleBiometricSignIn}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white text-sm font-bold shadow-xl shadow-orange-600/30 flex items-center justify-center gap-3 transition-all"
              >
                <Fingerprint className="w-6 h-6" />
                <span>1-Touch Biometric Sign In</span>
              </button>
              <p className="text-[10px] text-slate-400">Touch sensor or look at camera</p>
            </div>

            {/* Fallback Action: Password Sign In */}
            <form onSubmit={handlePasswordSignIn} className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 text-left space-y-3">
              <label className="text-xs font-bold text-slate-300 block">Or Sign In with Password</label>
              <input
                type="password"
                value={savedPasswordInput}
                onChange={(e) => setSavedPasswordInput(e.target.value)}
                placeholder="Enter your saved password"
                className="w-full bg-slate-950 border border-white/15 rounded-xl px-3 py-2 text-xs text-white"
              />

              {loginError && <p className="text-xs text-rose-400">{loginError}</p>}

              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
              >
                Sign In with Password →
              </button>
            </form>

            <button
              type="button"
              onClick={() => setAuthStep('IDENTIFIER_INPUT')}
              className="text-xs text-slate-500 hover:text-slate-300"
            >
              Sign in with different account
            </button>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════
            PHASE 5: Direct Freight Booking Landing Page (Authenticated)
        ══════════════════════════════════════════════════════════════ */}
        {authStep === 'BOOKING_PORTAL' && (
          submittedBookingRef ? (
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
            <form onSubmit={handleBookingSubmit} className="space-y-4">
              {/* Client Context Banner */}
              <div className="bg-gradient-to-r from-orange-950/40 to-slate-900 border border-orange-500/30 rounded-2xl p-3.5 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Building2 className="w-4 h-4 text-orange-400" />
                  <div>
                    <p className="text-xs font-bold text-white">EIN360 Corporate Account</p>
                    <p className="text-[10px] text-orange-300/80 font-mono">
                      Code: {rosterClient?.costCenter || 'CC-EIN360-LOGISTICS'} · 15% Discount Applied
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setAuthStep('RETURNING_USER_LOGIN')}
                  className="text-[10px] text-slate-400 hover:text-white border border-white/10 rounded-lg px-2 py-1"
                >
                  Lock
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

              {/* B2B Bulk Consignment Excel / CSV Uploader & Auto-Clustering Engine */}
              <BulkConsignmentUploader
                onBatchDispatched={(analysis) =>
                  setForm((prev) => ({
                    ...prev,
                    bulkBatchManifestNo: analysis.masterManifestNumber,
                    bulkBatchTotalPallets: analysis.totalPallets,
                    bulkBatchTotalRoutes: analysis.clusters.length,
                    fareSubtotal: analysis.summaryPricingAed,
                  }))
                }
              />

              {/* Multi-Stop Warehouse Route & LTL Consolidation Optimizer */}
              <MultiStopRoutePicker
                initialOrigin={form.origin}
                initialDestination={form.destination}
                baseFareAed={form.fareSubtotal || 550}
                onRouteChange={(res) =>
                  setForm((prev) => ({
                    ...prev,
                    distanceKm: res.totalDistanceKm,
                    durationMins: res.totalDurationMins,
                    salikTollsAed: res.totalSalikTollsAed,
                    palletCount: String(res.totalPallets || prev.palletCount),
                    weightTons: String(res.totalWeightTons || prev.weightTons),
                  }))
                }
              />

              {/* Recurring Standing Schedule Engine */}
              <RecurringSchedulePicker
                serviceType="LOGISTICS"
                singleTripFareAed={form.fareSubtotal || 550}
                onScheduleChange={({ config, trips, pricing }) =>
                  setForm((prev) => ({
                    ...prev,
                    recurringScheduleType: config.scheduleType,
                    recurringFrequency: config.frequency,
                    recurringTotalTrips: trips.length,
                    recurringTotalContractAed: pricing.totalWithVatAed,
                  }))
                }
              />

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

              {/* Digital Bill of Lading (e-BOL) & Barcode Scanner */}
              <DigitalEbolScanner
                bookingRef="EXL-FRT-EIN360"
                shipperName={form.requestorName}
                shipperAddress={form.origin}
                consigneeName="Dubai Mall Retail Base"
                consigneeAddress={form.destination}
                onEbolGenerated={(ebol) =>
                  setForm((prev) => ({
                    ...prev,
                    ebolNumber: ebol.ebolNumber,
                    uaeCustomsDeclarationNo: ebol.uaeCustomsDeclarationNo,
                  }))
                }
              />

              {/* Driver Mobile Handover & Electronic Proof of Delivery (e-POD) */}
              <DriverHandoverEpod
                bookingRef="EXL-FRT-EIN360"
                ebolNumber={form.ebolNumber || 'EBOL-EXL-2026-8891'}
                consigneeName={form.destination || 'Dubai Mall Service Dock 3'}
                onEpodCompleted={(epod) =>
                  setForm((prev) => ({
                    ...prev,
                    epodNumber: epod.epodNumber,
                    epodConfirmed: true,
                  }))
                }
              />

              {/* Live IoT Telematics & Continuous Cold-Chain Temperature Graph */}
              <ColdChainTelemetryGraph
                tripRef="TRIP-EXL-9482"
                cargoTypeKey="FROZEN_PHARMA"
                onAlertTriggered={(msg) =>
                  setForm((prev) => ({ ...prev, coldChainAlert: msg }))
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
          )
        )}
      </div>

      {/* ── App Footer ── */}
      <div className="bg-slate-900/90 border-t border-white/10 p-3 text-center text-[10px] text-slate-500">
        Powered by Fleet360 Enterprise Mobility OS · Secured with Multi-Tenant RLS
      </div>
    </div>
  );
}
