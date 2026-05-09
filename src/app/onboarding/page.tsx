'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import PasswordInput from '@/components/ui/PasswordInput';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FormData {
  // Step 1 — Company
  companyName: string;
  domain: string;
  country: string;
  contactPhone: string;
  trn: string;
  plan: 'TRIAL' | 'STANDARD' | 'PROFESSIONAL' | 'ENTERPRISE';
  // Step 2 — Admin account
  adminFirstName: string;
  adminLastName: string;
  contactEmail: string;
  adminPassword: string;
  confirmPassword: string;
  // Step 3 — Modules
  selectedModules: string[];
}

// ── Module definitions ────────────────────────────────────────────────────────

const ALL_MODULES = [
  { id: 'fleet',          icon: '🚗', name: 'Fleet Management',          description: 'Core vehicle registry and maintenance' },
  { id: 'rac',            icon: '🔑', name: 'Rental & Leasing',          description: 'RAC agreements and leasing contracts' },
  { id: 'logistics',      icon: '📦', name: 'Logistics',                 description: 'Cargo bookings and freight management' },
  { id: 'staff-transport',icon: '👥', name: 'Staff Transport',           description: 'Employee shuttle and trip scheduling' },
  { id: 'school-bus',     icon: '🚌', name: 'School Bus',                description: 'Student transport and parent notifications' },
  { id: 'ambulance',      icon: '🚑', name: 'Ambulance',                 description: 'Emergency dispatch and incident management' },
  { id: 'finance',        icon: '💰', name: 'Finance',                   description: 'Invoicing, reconciliation, and reporting' },
  { id: 'dispatch',       icon: '📍', name: 'Dispatch',                  description: 'Smart dispatch and job queue management' },
];

// ── Plan cards ────────────────────────────────────────────────────────────────

const PLANS = [
  { id: 'TRIAL',        label: 'Trial',        price: 'Free',          desc: '60 req/min · 1 tenant',           highlight: false },
  { id: 'STANDARD',     label: 'Standard',     price: 'AED 299/mo',   desc: '200 req/min · Up to 5 branches',  highlight: false },
  { id: 'PROFESSIONAL', label: 'Professional', price: 'AED 799/mo',   desc: '500 req/min · Unlimited branches', highlight: true  },
  { id: 'ENTERPRISE',   label: 'Enterprise',   price: 'AED 1,999/mo', desc: '1000 req/min · SLA + support',    highlight: false },
] as const;

// ── Password strength ─────────────────────────────────────────────────────────

function getPasswordStrength(pw: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  if (score <= 1) return { score, label: 'Weak',   color: 'bg-red-500' };
  if (score <= 2) return { score, label: 'Fair',   color: 'bg-yellow-500' };
  if (score <= 3) return { score, label: 'Good',   color: 'bg-blue-500' };
  return                { score, label: 'Strong', color: 'bg-green-500' };
}

// ── Main component ────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();

  // step 0 = domain verification, steps 1-3 = company / admin / modules
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [provisionData, setProvisionData] = useState<{
    tenantId?: string;
    verificationToken?: string;
    emailSent?: boolean;
    domainVerified?: boolean;
  } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // ── Step 0 — domain verification state ───────────────────────────────────

  const [domainInput, setDomainInput]       = useState('');
  const [domainInitializing, setDomainInitializing] = useState(false);
  const [domainInitError, setDomainInitError] = useState<string | null>(null);
  const [preVerifyId, setPreVerifyId]       = useState<string | null>(null);
  const [preVerified, setPreVerified]       = useState(false);

  // Email OTP state
  const [otpEmail, setOtpEmail]         = useState('');
  const [otpSent, setOtpSent]           = useState(false);
  const [otpSending, setOtpSending]     = useState(false);
  const [otpCode, setOtpCode]           = useState('');
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpError, setOtpError]         = useState<string | null>(null);

  const [form, setForm] = useState<FormData>({
    companyName:    '',
    domain:         '',
    country:        'UAE',
    contactPhone:   '',
    trn:            '',
    plan:           'TRIAL',
    adminFirstName: '',
    adminLastName:  '',
    contactEmail:   '',
    adminPassword:  '',
    confirmPassword:'',
    selectedModules: ALL_MODULES.map(m => m.id),
  });

  const [emailError, setEmailError] = useState<string | null>(null);

  const update = useCallback((field: keyof FormData, value: string | string[]) => {
    setForm(prev => ({ ...prev, [field]: value }));
  }, []);

  // ── Step 0: Initiate — register domain and show OTP email entry ──────────

  const initDomainVerification = async () => {
    const domain = domainInput.trim().toLowerCase().replace(/^www\./, '');
    if (!domain) { setDomainInitError('Please enter your company domain'); return; }
    const domainPattern = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]?\.[a-zA-Z]{2,}$/;
    if (!domainPattern.test(domain)) {
      setDomainInitError('Please enter a valid domain (e.g. acmetransport.com)');
      return;
    }

    setDomainInitializing(true);
    setDomainInitError(null);
    try {
      const res = await fetch('/api/tenants/pre-verify-domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDomainInitError(data.error ?? 'Failed to start verification');
        return;
      }
      setPreVerifyId(data.id);
      if (data.verified) {
        setPreVerified(true);
        update('domain', domain);
      }
    } catch {
      setDomainInitError('Network error. Please try again.');
    } finally {
      setDomainInitializing(false);
    }
  };

  // Combined: init domain verification then immediately send OTP
  const sendOtpWithDomainInit = async () => {
    const domain = domainInput.trim().toLowerCase().replace(/^www\./, '');
    if (!domain) { setDomainInitError('Please enter your company domain'); return; }
    const domainPattern = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]?\.[a-zA-Z]{2,}$/;
    if (!domainPattern.test(domain)) {
      setDomainInitError('Please enter a valid domain (e.g. acmetransport.com)');
      return;
    }
    if (!otpEmail.trim()) { setOtpError('Please enter your work email'); return; }

    setDomainInitializing(true);
    setOtpSending(true);
    setDomainInitError(null);
    setOtpError(null);

    try {
      // Step 1: register domain (get pre-verify ID)
      let id = preVerifyId;
      if (!id) {
        const initRes = await fetch('/api/tenants/pre-verify-domain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain }),
        });
        const initData = await initRes.json();
        if (!initRes.ok) {
          setDomainInitError(initData.error ?? 'Failed to start verification');
          return;
        }
        id = initData.id as string;
        setPreVerifyId(id);
        if (initData.verified) {
          setPreVerified(true);
          update('domain', domain);
          return;
        }
      }

      // Step 2: send OTP to the email
      const otpRes = await fetch('/api/tenants/pre-verify-domain?action=send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, email: otpEmail }),
      });
      const otpData = await otpRes.json();
      if (!otpRes.ok) {
        setOtpError(otpData.error ?? 'Failed to send verification code');
        return;
      }
      setOtpSent(true);
    } catch {
      setOtpError('Network error. Please try again.');
    } finally {
      setDomainInitializing(false);
      setOtpSending(false);
    }
  };

  // Send OTP only (resend — domain already initialised)
  const sendOtp = async () => {
    if (!preVerifyId || !otpEmail) return;
    setOtpSending(true);
    setOtpError(null);
    try {
      const res = await fetch('/api/tenants/pre-verify-domain?action=send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: preVerifyId, email: otpEmail }),
      });
      const data = await res.json();
      if (!res.ok) { setOtpError(data.error ?? 'Failed to send OTP'); return; }
      setOtpSent(true);
    } catch {
      setOtpError('Network error sending OTP');
    } finally {
      setOtpSending(false);
    }
  };

  // Verify OTP
  const verifyOtp = async () => {
    if (!preVerifyId || !otpCode) return;
    setOtpVerifying(true);
    setOtpError(null);
    try {
      const res = await fetch('/api/tenants/pre-verify-domain?action=verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: preVerifyId, otp: otpCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOtpError(data.error ?? 'Incorrect code');
        return;
      }
      if (data.verified) {
        setPreVerified(true);
        update('domain', domainInput.trim().toLowerCase().replace(/^www\./, ''));
      }
    } catch {
      setOtpError('Network error verifying code');
    } finally {
      setOtpVerifying(false);
    }
  };

  // ── Validation ───────────────────────────────────────────────────────────

  const validateStep1 = (): string | null => {
    if (!form.companyName.trim()) return 'Company name is required';
    if (!form.domain.trim()) return 'Business domain is required';
    return null;
  };

  const validateStep2 = (): string | null => {
    if (!form.adminFirstName.trim()) return 'First name is required';
    if (!form.adminLastName.trim())  return 'Last name is required';
    if (!form.contactEmail.trim())   return 'Work email is required';

    const emailDomain = form.contactEmail.split('@')[1]?.toLowerCase();
    const companyDomain = form.domain.replace(/^www\./, '').toLowerCase().trim();
    if (emailDomain !== companyDomain) {
      return `Email domain (${emailDomain}) must match your company domain (${companyDomain})`;
    }

    if (form.adminPassword.length < 8) return 'Password must be at least 8 characters';
    if (form.adminPassword !== form.confirmPassword) return 'Passwords do not match';
    return null;
  };

  // ── Navigation ────────────────────────────────────────────────────────────

  const goNext = () => {
    setError(null);
    if (step === 1) {
      const err = validateStep1();
      if (err) { setError(err); return; }
    }
    if (step === 2) {
      const err = validateStep2();
      if (err) { setError(err); return; }
    }
    setStep(s => s + 1);
  };

  const goBack = () => {
    setError(null);
    setStep(s => s - 1);
  };

  // ── Module toggle ─────────────────────────────────────────────────────────

  const toggleModule = (id: string) => {
    setForm(prev => ({
      ...prev,
      selectedModules: prev.selectedModules.includes(id)
        ? prev.selectedModules.filter(m => m !== id)
        : [...prev.selectedModules, id],
    }));
  };

  const toggleAll = () => {
    setForm(prev => ({
      ...prev,
      selectedModules: prev.selectedModules.length === ALL_MODULES.length
        ? []
        : ALL_MODULES.map(m => m.id),
    }));
  };

  // ── Email blur validation ─────────────────────────────────────────────────

  const validateEmail = () => {
    if (!form.contactEmail) return;
    const emailDomain = form.contactEmail.split('@')[1]?.toLowerCase() ?? '';
    const companyDomain = form.domain.replace(/^www\./, '').toLowerCase().trim();
    if (companyDomain && emailDomain !== companyDomain) {
      setEmailError(`Must match your domain: @${companyDomain}`);
    } else {
      setEmailError(null);
    }
  };

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    setError(null);
    const err = validateStep2();
    if (err) { setError(err); return; }

    setLoading(true);
    try {
      const res = await fetch('/api/tenants/provision', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName:       form.companyName,
          domain:            form.domain,
          contactEmail:      form.contactEmail,
          contactName:       `${form.adminFirstName} ${form.adminLastName}`,
          contactPhone:      form.contactPhone || undefined,
          country:           form.country || undefined,
          plan:              form.plan,
          selectedModules:   form.selectedModules,
          adminFirstName:    form.adminFirstName,
          adminLastName:     form.adminLastName,
          adminPassword:     form.adminPassword,
          trn:               form.trn || undefined,
          preVerificationId: preVerifyId || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        const errMsg = data.detail ?? data.message ?? data.error ?? 'Registration failed. Please try again.';
        setError(errMsg);
        return;
      }

      setProvisionData({
        tenantId:          data.tenantId,
        verificationToken: data.verificationToken,
        emailSent:         !data.verificationToken,
        domainVerified:    data.domainVerified ?? false,
      });

      // If domain is already pre-verified, go straight to the platform with a hard
      // redirect so the browser uses the new xl-session cookie (not any cached session).
      if (data.domainVerified) {
        window.location.href = '/platform';
        return;
      }

      setSuccess(true);
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Inline token verify (fallback for dev with no SMTP) ──────────────────

  const verifyWithToken = async () => {
    if (!provisionData?.verificationToken || !provisionData?.tenantId) return;
    setVerifying(true);
    setVerifyError(null);
    try {
      const res = await fetch(
        `/api/tenants/verify-domain?token=${provisionData.verificationToken}&tenantId=${provisionData.tenantId}`,
      );
      const data = await res.json();
      if (res.ok) {
        setVerified(true);
      } else {
        setVerifyError(data.message ?? 'Verification failed');
      }
    } catch {
      setVerifyError('Network error during verification');
    } finally {
      setVerifying(false);
    }
  };

  // ── Render: success screen ────────────────────────────────────────────────

  if (success) {
    const domainAlreadyVerified = provisionData?.domainVerified || preVerified;
    const token = provisionData?.verificationToken;

    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="w-full max-w-lg space-y-5">
          <div className="text-center space-y-2">
            <div className="text-5xl">{domainAlreadyVerified || verified ? '✅' : '🎉'}</div>
            <h1 className="text-3xl font-bold text-white">
              {domainAlreadyVerified || verified ? 'All Done!' : 'Organisation Created!'}
            </h1>
            <p className="text-slate-400 text-sm">
              {domainAlreadyVerified || verified
                ? 'Your domain is verified and your organisation is active.'
                : <>Account registered for <span className="text-white font-medium">{form.contactEmail}</span></>
              }
            </p>
          </div>

          {/* Domain already verified — show green badge */}
          {domainAlreadyVerified && (
            <div className="bg-emerald-950/40 border border-emerald-500/30 rounded-xl p-4 flex items-center gap-3">
              <span className="text-2xl">🔒</span>
              <div>
                <p className="text-emerald-300 font-medium text-sm">Domain ownership verified</p>
                <p className="text-slate-400 text-xs mt-0.5">
                  <span className="text-white">{form.domain}</span> was verified before registration — no further action needed.
                </p>
              </div>
            </div>
          )}

          {/* Still needs verification */}
          {!domainAlreadyVerified && !verified && (
            <>
              {token && (
                <div className="bg-amber-950/40 border border-amber-500/30 rounded-xl p-4 space-y-3">
                  <p className="text-amber-300 font-medium text-sm flex items-center gap-2">
                    <span>⚠️</span> Email not configured — verify directly below
                  </p>
                  <p className="text-slate-400 text-xs">
                    SMTP is not yet configured on this server. Use the button below to verify instantly.
                  </p>
                  <div className="bg-slate-900 rounded-lg p-2 flex items-center gap-2">
                    <code className="text-xs text-green-400 flex-1 break-all select-all">{token}</code>
                    <button
                      onClick={() => navigator.clipboard.writeText(token)}
                      className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded border border-white/10 shrink-0"
                    >Copy</button>
                  </div>
                  {verifyError && <p className="text-red-400 text-xs">{verifyError}</p>}
                  <button
                    onClick={verifyWithToken}
                    disabled={verifying}
                    className="w-full py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
                  >
                    {verifying ? 'Verifying…' : 'Verify Domain Now'}
                  </button>
                </div>
              )}
              {!token && (
                <div className="bg-slate-900 border border-white/10 rounded-xl p-4 text-sm text-slate-400 space-y-2">
                  <p className="font-medium text-white">Verification email sent to {form.contactEmail}</p>
                  <p>Click the link in the email to verify your domain. Also check your spam folder.</p>
                </div>
              )}
            </>
          )}

          <button
            onClick={() => { window.location.href = '/platform'; }}
            className="w-full py-3 px-6 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl transition-colors"
          >
            Go to Platform →
          </button>
          {!domainAlreadyVerified && !verified && (
            <p className="text-center text-xs text-slate-500">
              You can also verify your domain later from Admin → Tenant Settings.
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Render: wizard ────────────────────────────────────────────────────────

  const pwStrength = getPasswordStrength(form.adminPassword);
  const STEP_LABELS = ['Verify Domain', 'Company Details', 'Admin Account', 'Select Modules'];

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      {/* Header */}
      <div className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-sm font-bold">XL</div>
          <span className="font-semibold text-white">Fleet360</span>
        </div>
        <span className="text-slate-400 text-sm">Create your organisation</span>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-2xl">

          {/* Progress indicator */}
          <div className="flex items-center justify-center gap-2 mb-6">
            {[0, 1, 2, 3].map(s => (
              <div key={s} className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-all ${
                  s === step
                    ? 'bg-blue-600 text-white ring-2 ring-blue-400/40'
                    : s < step
                    ? 'bg-green-600 text-white'
                    : 'bg-slate-800 text-slate-500'
                }`}>
                  {s < step ? '✓' : s === 0 ? '🔒' : s}
                </div>
                {s < 3 && (
                  <div className={`w-12 h-px transition-colors ${s < step ? 'bg-green-600' : 'bg-slate-700'}`} />
                )}
              </div>
            ))}
          </div>

          {/* Step labels */}
          <div className="grid grid-cols-4 text-center text-xs text-slate-500 mb-8 gap-1">
            {STEP_LABELS.map((label, i) => (
              <span key={i} className={i === step ? 'text-white font-medium' : ''}>{label}</span>
            ))}
          </div>

          {/* Card */}
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-8">
            {error && (
              <div className="mb-6 p-4 bg-red-950 border border-red-500/30 rounded-xl text-red-300 text-sm">
                {error}
              </div>
            )}

            {/* ── Step 0: Domain Verification (Email OTP) ──────────────── */}
            {step === 0 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-white">Verify Your Domain</h2>
                  <p className="text-slate-400 mt-1 text-sm">
                    Enter your company domain and a work email address. We&apos;ll send you a
                    6-digit code to confirm you own the domain.
                  </p>
                </div>

                {/* ── Phase A: Domain + email entry ─────────────────────────── */}
                {!preVerified && !otpSent && (
                  <div className="space-y-4">
                    {/* Single error banner for both domain + OTP init errors */}
                    {(domainInitError || otpError) && (
                      <div className="p-3 bg-red-950/60 border border-red-500/30 rounded-xl text-red-300 text-sm flex items-start gap-2">
                        <span className="shrink-0 mt-0.5">⚠️</span>
                        <span>{domainInitError || otpError}</span>
                      </div>
                    )}

                    {/* Domain */}
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1.5">
                        Company Domain <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={domainInput}
                        onChange={e => { setDomainInput(e.target.value.toLowerCase().trim()); setDomainInitError(null); setOtpError(null); }}
                        onKeyDown={e => e.key === 'Enter' && document.getElementById('otp-email-input')?.focus()}
                        placeholder="exlsolutions.ae"
                        className={`w-full px-4 py-2.5 bg-slate-800 border rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors ${domainInitError ? 'border-red-500/60' : 'border-white/10'}`}
                      />
                      <p className="mt-1.5 text-xs text-slate-500">
                        Your company domain — not gmail, yahoo, or other free providers.
                      </p>
                    </div>

                    {/* Work email */}
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1.5">
                        Your Work Email <span className="text-red-400">*</span>
                      </label>
                      <input
                        id="otp-email-input"
                        type="email"
                        value={otpEmail}
                        onChange={e => { setOtpEmail(e.target.value); setOtpError(null); setDomainInitError(null); }}
                        onKeyDown={e => e.key === 'Enter' && sendOtpWithDomainInit()}
                        placeholder={domainInput ? `admin@${domainInput.replace(/^www\./, '')}` : 'admin@yourcompany.com'}
                        className={`w-full px-4 py-2.5 bg-slate-800 border rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors ${otpError ? 'border-red-500/60' : 'border-white/10'}`}
                      />
                      <p className="mt-1.5 text-xs text-slate-500">
                        Must be an email at your company domain (e.g. you@{domainInput || 'yourcompany.com'}).
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={sendOtpWithDomainInit}
                      disabled={domainInitializing || otpSending || !domainInput.trim() || !otpEmail.trim()}
                      className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                    >
                      {(domainInitializing || otpSending) ? (
                        <>
                          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                          </svg>
                          Sending Code…
                        </>
                      ) : (
                        <>📧 Send Verification Code</>
                      )}
                    </button>
                  </div>
                )}

                {/* ── Phase B: OTP entry ─────────────────────────────────────── */}
                {!preVerified && otpSent && (
                  <div className="space-y-5">
                    <div className="bg-blue-950/40 border border-blue-500/30 rounded-xl p-4 flex items-start gap-3">
                      <span className="text-2xl">📧</span>
                      <div>
                        <p className="text-blue-200 font-medium text-sm">Code sent!</p>
                        <p className="text-slate-400 text-sm mt-0.5">
                          We sent a 6-digit code to <strong className="text-white">{otpEmail}</strong>.
                          Check your inbox and spam folder.
                        </p>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-3 text-center">
                        Enter the 6-digit code
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={otpCode}
                        onChange={e => { setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setOtpError(null); }}
                        onKeyDown={e => e.key === 'Enter' && otpCode.length === 6 && verifyOtp()}
                        placeholder="000000"
                        maxLength={6}
                        autoFocus
                        className="w-full px-4 py-4 bg-slate-800 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 transition-colors text-center text-3xl font-mono tracking-[0.5em]"
                      />
                      {otpError && <p className="mt-2 text-sm text-red-400 text-center">{otpError}</p>}
                    </div>

                    <button
                      type="button"
                      onClick={verifyOtp}
                      disabled={otpVerifying || otpCode.length !== 6}
                      className="w-full py-3 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                    >
                      {otpVerifying ? (
                        <>
                          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                          </svg>
                          Verifying…
                        </>
                      ) : '✓ Verify Code'}
                    </button>

                    <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
                      <button
                        onClick={() => { setOtpSent(false); setOtpCode(''); setOtpError(null); }}
                        className="hover:text-white transition-colors"
                      >
                        ← Change email or domain
                      </button>
                      <button
                        onClick={sendOtpWithDomainInit}
                        disabled={otpSending}
                        className="hover:text-white transition-colors disabled:opacity-50"
                      >
                        Resend code
                      </button>
                    </div>
                  </div>
                )}

                {/* ── Phase C: Verified ──────────────────────────────────────── */}
                {preVerified && (
                  <div className="space-y-4">
                    <div className="bg-emerald-950/40 border border-emerald-500/30 rounded-xl p-5 flex items-center gap-4">
                      <span className="text-4xl">✅</span>
                      <div>
                        <p className="text-emerald-300 font-semibold text-lg">Domain verified!</p>
                        <p className="text-slate-400 text-sm mt-0.5">
                          <span className="text-white font-medium">{domainInput.replace(/^www\./, '').toLowerCase()}</span>{' '}
                          ownership confirmed via <span className="text-white">{otpEmail}</span>.
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => { update('domain', domainInput.replace(/^www\./, '').toLowerCase()); setStep(1); }}
                      className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl transition-colors"
                    >
                      Continue to Company Details →
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ── Step 1: Company Details ─────────────────────────────────── */}
            {step === 1 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-white">Company Details</h2>
                  <p className="text-slate-400 mt-1 text-sm">Tell us about your organisation</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">
                      Company Name <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.companyName}
                      onChange={e => update('companyName', e.target.value)}
                      placeholder="Acme Transport LLC"
                      className="w-full px-4 py-2.5 bg-slate-800 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                    />
                  </div>

                  {/* Domain — locked if pre-verified */}
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">
                      Business Domain <span className="text-red-400">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={form.domain}
                        onChange={e => !preVerified && update('domain', e.target.value.toLowerCase().trim())}
                        readOnly={preVerified}
                        placeholder="acmetransport.com"
                        className={`w-full px-4 py-2.5 border rounded-xl text-white placeholder-slate-500 focus:outline-none transition-colors ${
                          preVerified
                            ? 'bg-emerald-950/30 border-emerald-500/40 cursor-default'
                            : 'bg-slate-800 border-white/10 focus:border-blue-500'
                        }`}
                      />
                      {preVerified && (
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs bg-emerald-600 text-white px-2 py-0.5 rounded-full font-medium">
                          ✓ Verified
                        </span>
                      )}
                    </div>
                    {!preVerified && (
                      <p className="mt-1.5 text-xs text-slate-500">Use your company&apos;s domain, not gmail/yahoo</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">Country</label>
                    <select
                      value={form.country}
                      onChange={e => update('country', e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-800 border border-white/10 rounded-xl text-white focus:outline-none focus:border-blue-500 transition-colors"
                    >
                      <option value="UAE">United Arab Emirates</option>
                      <option value="SAU">Saudi Arabia</option>
                      <option value="QAT">Qatar</option>
                      <option value="KWT">Kuwait</option>
                      <option value="BHR">Bahrain</option>
                      <option value="OMN">Oman</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">Contact Phone</label>
                    <input
                      type="tel"
                      value={form.contactPhone}
                      onChange={e => update('contactPhone', e.target.value)}
                      placeholder="+971 50 000 0000"
                      className="w-full px-4 py-2.5 bg-slate-800 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">
                      Tax Registration Number (TRN) <span className="text-slate-500 font-normal">— optional</span>
                    </label>
                    <input
                      type="text"
                      value={form.trn}
                      onChange={e => update('trn', e.target.value)}
                      placeholder="100123456700003"
                      className="w-full px-4 py-2.5 bg-slate-800 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                    />
                  </div>
                </div>

                {/* Plan selection */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-3">Select Plan</label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {PLANS.map(plan => (
                      <button
                        key={plan.id}
                        type="button"
                        onClick={() => update('plan', plan.id)}
                        className={`relative p-4 rounded-xl border text-left transition-all ${
                          form.plan === plan.id
                            ? 'border-blue-500 bg-blue-500/10'
                            : 'border-white/10 bg-slate-800 hover:border-white/20'
                        }`}
                      >
                        {plan.highlight && (
                          <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-xs bg-blue-600 px-2 py-0.5 rounded-full text-white">
                            Popular
                          </span>
                        )}
                        <div className="font-semibold text-white text-sm">{plan.label}</div>
                        <div className="text-blue-400 text-sm font-medium mt-0.5">{plan.price}</div>
                        <div className="text-slate-500 text-xs mt-1 leading-snug">{plan.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── Step 2: Admin Account ────────────────────────────────────── */}
            {step === 2 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-white">Admin Account</h2>
                  <p className="text-slate-400 mt-1 text-sm">This account will have full administrative access</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">
                      First Name <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.adminFirstName}
                      onChange={e => update('adminFirstName', e.target.value)}
                      placeholder="John"
                      className="w-full px-4 py-2.5 bg-slate-800 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">
                      Last Name <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.adminLastName}
                      onChange={e => update('adminLastName', e.target.value)}
                      placeholder="Smith"
                      className="w-full px-4 py-2.5 bg-slate-800 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">
                      Work Email <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="email"
                      value={form.contactEmail}
                      onChange={e => { update('contactEmail', e.target.value); setEmailError(null); }}
                      onBlur={validateEmail}
                      placeholder={form.domain ? `admin@${form.domain}` : 'admin@yourcompany.com'}
                      className={`w-full px-4 py-2.5 bg-slate-800 border rounded-xl text-white placeholder-slate-500 focus:outline-none transition-colors ${
                        emailError ? 'border-red-500' : 'border-white/10 focus:border-blue-500'
                      }`}
                    />
                    {emailError && <p className="mt-1.5 text-xs text-red-400">{emailError}</p>}
                    {form.domain && !emailError && (
                      <p className="mt-1.5 text-xs text-slate-500">Must use your domain: @{form.domain}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">
                      Password <span className="text-red-400">*</span>
                    </label>
                    <PasswordInput
                      value={form.adminPassword}
                      onChange={e => update('adminPassword', e.target.value)}
                      placeholder="Min. 8 characters"
                      className="w-full px-4 py-2.5 bg-slate-800 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                    />
                    {form.adminPassword && (
                      <div className="mt-2 flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${pwStrength.color}`}
                            style={{ width: `${(pwStrength.score / 5) * 100}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-400">{pwStrength.label}</span>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">
                      Confirm Password <span className="text-red-400">*</span>
                    </label>
                    <PasswordInput
                      value={form.confirmPassword}
                      onChange={e => update('confirmPassword', e.target.value)}
                      placeholder="Repeat password"
                      className={`w-full px-4 py-2.5 bg-slate-800 border rounded-xl text-white placeholder-slate-500 focus:outline-none transition-colors ${
                        form.confirmPassword && form.adminPassword !== form.confirmPassword
                          ? 'border-red-500'
                          : 'border-white/10 focus:border-blue-500'
                      }`}
                    />
                    {form.confirmPassword && form.adminPassword !== form.confirmPassword && (
                      <p className="mt-1.5 text-xs text-red-400">Passwords do not match</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── Step 3: Select Modules ───────────────────────────────────── */}
            {step === 3 && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-bold text-white">Select Modules</h2>
                    <p className="text-slate-400 mt-1 text-sm">Choose which modules to enable. You can change this later.</p>
                  </div>
                  <button type="button" onClick={toggleAll} className="text-sm text-blue-400 hover:text-blue-300 transition-colors">
                    {form.selectedModules.length === ALL_MODULES.length ? 'Deselect All' : 'Select All'}
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {ALL_MODULES.map(mod => {
                    const selected = form.selectedModules.includes(mod.id);
                    return (
                      <button
                        key={mod.id}
                        type="button"
                        onClick={() => toggleModule(mod.id)}
                        className={`flex items-start gap-4 p-4 rounded-xl border text-left transition-all ${
                          selected ? 'border-blue-500 bg-blue-500/10' : 'border-white/10 bg-slate-800 hover:border-white/20'
                        }`}
                      >
                        <span className="text-2xl flex-shrink-0">{mod.icon}</span>
                        <div className="min-w-0">
                          <div className="font-medium text-white text-sm">{mod.name}</div>
                          <div className="text-slate-400 text-xs mt-0.5">{mod.description}</div>
                        </div>
                        <div className={`ml-auto flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                          selected ? 'bg-blue-600 border-blue-600' : 'border-slate-600'
                        }`}>
                          {selected && (
                            <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                              <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Domain status on review */}
                {preVerified ? (
                  <div className="p-4 bg-emerald-950/30 border border-emerald-500/20 rounded-xl flex items-center gap-3 text-sm">
                    <span className="text-emerald-400">✅</span>
                    <span className="text-emerald-300">Domain <strong>{form.domain}</strong> is pre-verified — your organisation will be fully active immediately.</span>
                  </div>
                ) : (
                  <div className="p-4 bg-slate-800 border border-white/10 rounded-xl text-sm text-slate-400">
                    <p className="font-medium text-white mb-1">Domain Verification Pending</p>
                    <p>We&apos;ll send a verification link to <span className="text-white">{form.contactEmail || 'your email'}</span> after registration.</p>
                  </div>
                )}
              </div>
            )}

            {/* Navigation buttons */}
            {step > 0 && (
              <div className="flex items-center justify-between mt-8 pt-6 border-t border-white/10">
                <button
                  type="button"
                  onClick={goBack}
                  className="px-6 py-2.5 text-slate-400 hover:text-white transition-colors"
                >
                  Back
                </button>

                <div className="flex items-center gap-2">
                  {step < 3 ? (
                    <button
                      type="button"
                      onClick={goNext}
                      className="px-8 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl transition-colors"
                    >
                      Next
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={loading}
                      className="px-8 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors flex items-center gap-2"
                    >
                      {loading ? (
                        <>
                          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                          </svg>
                          Creating Organisation...
                        </>
                      ) : (
                        'Create Organisation'
                      )}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
