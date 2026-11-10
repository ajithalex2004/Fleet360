'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import PasswordInput from '@/components/ui/PasswordInput';
import { MODULE_BY_KEY, type ModuleKey } from '@/lib/modules';
import { Sparkles, Upload, FileText, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface OnboardingAttachmentPayload {
  docType: 'TRADE_LICENSE' | 'VAT_CERTIFICATE' | 'CORPORATE_TAX_CERTIFICATE' | 'OTHER';
  fileName: string;
  mimeType: string;
  base64: string;
  documentNumber?: string | null;
  expiryDate?: string | null;
}

interface FormData {
  // Step 1 — Company
  companyName: string;
  arabicName: string;
  domain: string;
  country: string;
  emirate: string;
  emirateCode: string;
  tradeLicenseNo: string;
  tradeLicenseAuthority: string;
  corporateTaxTrn: string;
  streetName: string;
  additionalStreetName: string;
  postalZone: string;
  address: string;
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

const ONBOARDING_MODULE_KEYS = [
  'fleet', 'rental', 'logistics', 'bus-ops', 'school-bus', 'incidents', 'finance', 'dispatch',
] as const satisfies readonly ModuleKey[];

const ONBOARDING_ICONS: Readonly<Record<(typeof ONBOARDING_MODULE_KEYS)[number], string>> = {
  'fleet':       '🚗',
  'rental':      '🔑',
  'logistics':   '📦',
  'bus-ops':     '👥',
  'school-bus':  '🚌',
  'incidents':   '🚑',
  'finance':     '💰',
  'dispatch':    '📍',
};

const ALL_MODULES = ONBOARDING_MODULE_KEYS.map(key => {
  const m = MODULE_BY_KEY[key];
  return {
    id:          m.key,
    icon:        ONBOARDING_ICONS[key],
    name:        m.name,
    description: m.description,
  };
});

// ── Plan cards ────────────────────────────────────────────────────────────────
interface UiPlan { id: string; label: string; price: string; desc: string; highlight: boolean }

const FALLBACK_PLANS: readonly UiPlan[] = [
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
    companyName:           '',
    arabicName:            '',
    domain:                '',
    country:               'UAE',
    emirate:               'Dubai',
    emirateCode:           'AE-DU',
    tradeLicenseNo:        '',
    tradeLicenseAuthority: '',
    corporateTaxTrn:       '',
    streetName:            '',
    additionalStreetName:  '',
    postalZone:            '',
    address:               '',
    contactPhone:          '',
    trn:                   '',
    plan:                  'TRIAL',
    adminFirstName:        '',
    adminLastName:         '',
    contactEmail:          '',
    adminPassword:         '',
    confirmPassword:       '',
    selectedModules:       ALL_MODULES.map(m => m.id),
  });

  // ── Step 1 — Trade License & VAT Certificate AI Autofill State ───────────
  const tradeLicenseInputRef = useRef<HTMLInputElement | null>(null);
  const vatCertInputRef = useRef<HTMLInputElement | null>(null);
  const [scanningDoc, setScanningDoc] = useState<'TRADE_LICENSE' | 'VAT_CERTIFICATE' | null>(null);
  const [tradeLicenseDoc, setTradeLicenseDoc] = useState<OnboardingAttachmentPayload | null>(null);
  const [vatCertDoc, setVatCertDoc] = useState<OnboardingAttachmentPayload | null>(null);
  const [tradeScanSuccess, setTradeScanSuccess] = useState<string | null>(null);
  const [tradeScanError, setTradeScanError] = useState<string | null>(null);
  const [vatScanSuccess, setVatScanSuccess] = useState<string | null>(null);
  const [vatScanError, setVatScanError] = useState<string | null>(null);

  const [emailError, setEmailError] = useState<string | null>(null);

  // ── Plan catalog (fetched from /api/platform/plans) ──────────────────────
  const [plans, setPlans] = useState<UiPlan[]>([...FALLBACK_PLANS]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/platform/plans')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled || !data?.plans) return;
        const apiPlans: UiPlan[] = (data.plans as Array<{
          code: string; name: string; priceLabel: string; description: string; highlight: boolean;
        }>).map(p => ({
          id:        p.code,
          label:     p.name,
          price:     p.priceLabel,
          desc:      p.description,
          highlight: p.highlight,
        }));
        if (apiPlans.length > 0) setPlans(apiPlans);
      })
      .catch(() => { /* keep fallback */ });
    return () => { cancelled = true; };
  }, []);

  const update = useCallback((field: keyof FormData, value: string | string[]) => {
    setForm(prev => ({ ...prev, [field]: value }));
  }, []);

  // ── Step 1 AI Document Upload & Autofill (Trade License & VAT Certificate) ──

  const handleOnboardingDocUpload = async (
    file: File,
    docType: 'TRADE_LICENSE' | 'VAT_CERTIFICATE',
  ) => {
    if (!file) return;
    setScanningDoc(docType);
    if (docType === 'TRADE_LICENSE') {
      setTradeScanSuccess(null);
      setTradeScanError(null);
    } else {
      setVatScanSuccess(null);
      setVatScanError(null);
    }

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(String(e.target?.result ?? ''));
        reader.onerror = () => reject(new Error('Could not read selected file'));
        reader.readAsDataURL(file);
      });
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      const mimeType = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');

      const res = await fetch('/api/tenants/pre-verify-domain?action=autofill-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base64,
          mimeType,
          fileName: file.name,
          docType,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to analyze document');
      }

      const attachmentPayload: OnboardingAttachmentPayload = {
        docType,
        fileName: file.name,
        mimeType,
        base64,
        documentNumber: data.documentNumber || (docType === 'VAT_CERTIFICATE' ? data.trn : data.tradeLicenseNo) || null,
        expiryDate: data.expiryDate || null,
      };
      if (docType === 'TRADE_LICENSE') setTradeLicenseDoc(attachmentPayload);
      else setVatCertDoc(attachmentPayload);

      if (data.status === 'unavailable' || data.status === 'error') {
        const msg = data.message || 'Document attached. Enter company details manually below.';
        if (docType === 'TRADE_LICENSE') setTradeScanError(msg);
        else setVatScanError(msg);
        return;
      }

      const populated: string[] = [];
      if (data.companyName) populated.push(`Name: ${data.companyName}`);
      if (data.arabicName) populated.push(`Arabic: ${data.arabicName}`);
      if (data.tradeLicenseNo) populated.push(`License: ${data.tradeLicenseNo}`);
      if (data.tradeLicenseAuthority) populated.push(`Authority: ${data.tradeLicenseAuthority}`);
      if (data.trn) populated.push(`TRN: ${data.trn}`);
      if (data.emirate) populated.push(`Emirate: ${data.emirate}`);
      if (data.address) populated.push('Address');
      if (data.contactPhone) populated.push(`Phone: ${data.contactPhone}`);

      setForm(prev => {
        const next = { ...prev };
        if (data.companyName) next.companyName = data.companyName;
        if (data.arabicName) next.arabicName = data.arabicName;
        if (data.tradeLicenseNo) next.tradeLicenseNo = data.tradeLicenseNo;
        if (data.tradeLicenseAuthority) next.tradeLicenseAuthority = data.tradeLicenseAuthority;
        if (data.trn) next.trn = data.trn;
        if (data.corporateTaxTrn) next.corporateTaxTrn = data.corporateTaxTrn;
        if (data.emirate) next.emirate = data.emirate;
        if (data.emirateCode) next.emirateCode = data.emirateCode;
        if (data.streetName) next.streetName = data.streetName;
        if (data.additionalStreetName) next.additionalStreetName = data.additionalStreetName;
        if (data.postalZone) next.postalZone = data.postalZone;
        if (data.address) next.address = data.address;
        if (data.contactPhone && !next.contactPhone) next.contactPhone = data.contactPhone;
        return next;
      });

      const confPct = Math.round((data.confidence || 0.92) * 100);
      const label = docType === 'TRADE_LICENSE' ? 'Trade License' : 'VAT Certificate';
      const msg = `✓ ${label} scanned: ${populated.length} fields autofilled (${confPct}% confidence) — ${populated.slice(0, 3).join(' · ')}`;
      if (docType === 'TRADE_LICENSE') setTradeScanSuccess(msg);
      else setVatScanSuccess(msg);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not scan document';
      if (docType === 'TRADE_LICENSE') setTradeScanError(msg);
      else setVatScanError(msg);
    } finally {
      setScanningDoc(null);
    }
  };

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
      const attachments = [tradeLicenseDoc, vatCertDoc].filter(
        (a): a is OnboardingAttachmentPayload => Boolean(a),
      );

      const res = await fetch('/api/tenants/provision', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName:           form.companyName,
          arabicName:            form.arabicName || undefined,
          domain:                form.domain,
          contactEmail:          form.contactEmail,
          contactName:           `${form.adminFirstName} ${form.adminLastName}`,
          contactPhone:          form.contactPhone || undefined,
          country:               form.country || undefined,
          emirate:               form.emirate || undefined,
          emirateCode:           form.emirateCode || undefined,
          tradeLicenseNo:        form.tradeLicenseNo || undefined,
          tradeLicenseAuthority: form.tradeLicenseAuthority || undefined,
          corporateTaxTrn:       form.corporateTaxTrn || undefined,
          streetName:            form.streetName || undefined,
          additionalStreetName:  form.additionalStreetName || undefined,
          postalZone:            form.postalZone || undefined,
          address:               form.address || undefined,
          plan:                  form.plan,
          selectedModules:       form.selectedModules,
          adminFirstName:        form.adminFirstName,
          adminLastName:         form.adminLastName,
          adminPassword:         form.adminPassword,
          trn:                   form.trn || undefined,
          attachments:           attachments.length > 0 ? attachments : undefined,
          preVerificationId:     preVerifyId || undefined,
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
      <div className="min-h-screen bg-[#0c1a3e] flex items-center justify-center p-4">
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
    <div className="min-h-screen bg-[#0c1a3e] text-white flex flex-col">
      {/* Header */}
      <div className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-sm font-bold">XL</div>
          <span className="font-semibold text-white">Fleet360</span>
        </div>
        <span className="text-slate-400 text-sm">Create your organisation</span>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-3xl">

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
                    {(domainInitError || otpError) && (
                      <div className="p-3 bg-red-950/60 border border-red-500/30 rounded-xl text-red-300 text-sm flex items-start gap-2">
                        <span className="shrink-0 mt-0.5">⚠️</span>
                        <span>{domainInitError || otpError}</span>
                      </div>
                    )}

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

            {/* ── Step 1: Company Details + AI Document Autofill ──────────── */}
            {step === 1 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-white">Company Details</h2>
                  <p className="text-slate-400 mt-1 text-sm">
                    Attach your UAE Trade License and VAT Certificate to autofill your company registration via AI, or enter details manually.
                  </p>
                </div>

                {/* ── AI Document Upload Cards (Trade License & VAT Certificate) ── */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Card 1: Trade License */}
                  <div className="bg-gradient-to-br from-orange-500/10 via-amber-500/5 to-slate-800/80 border-2 border-dashed border-orange-500/30 hover:border-orange-500/60 transition-all rounded-2xl p-4 flex flex-col justify-between">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-orange-400 uppercase tracking-wider flex items-center gap-1.5">
                          <Sparkles className="w-3.5 h-3.5" /> Attach Trade License
                        </span>
                        <span className="text-[10px] font-semibold bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded-full border border-orange-500/30">
                          AI Autofill
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        Upload UAE Trade License (PDF or image). AI extracts Company Name (EN/AR), License No, Authority, Emirate &amp; Address.
                      </p>
                    </div>

                    {tradeScanSuccess && (
                      <div className="my-2 p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
                        <span className="leading-snug">{tradeScanSuccess}</span>
                      </div>
                    )}

                    {tradeScanError && (
                      <div className="my-2 p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                        <span className="leading-snug">{tradeScanError}</span>
                      </div>
                    )}

                    <div className="mt-3">
                      <input
                        ref={tradeLicenseInputRef}
                        type="file"
                        accept="application/pdf,image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={e => {
                          const file = e.target.files?.[0];
                          if (file) handleOnboardingDocUpload(file, 'TRADE_LICENSE');
                          e.target.value = '';
                        }}
                      />

                      {tradeLicenseDoc ? (
                        <div className="p-2.5 rounded-xl bg-slate-900 border border-white/10 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 overflow-hidden">
                            <FileText className="w-4 h-4 text-orange-400 shrink-0" />
                            <span className="text-xs font-medium text-white truncate font-mono">
                              {tradeLicenseDoc.fileName}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => tradeLicenseInputRef.current?.click()}
                            disabled={scanningDoc !== null}
                            className="text-xs font-semibold text-orange-400 hover:text-orange-300 shrink-0"
                          >
                            Replace
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => tradeLicenseInputRef.current?.click()}
                          disabled={scanningDoc !== null}
                          className="w-full py-2.5 bg-orange-500/15 hover:bg-orange-500/25 border border-orange-500/30 text-orange-300 rounded-xl font-semibold text-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                          {scanningDoc === 'TRADE_LICENSE' ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin text-orange-400" />
                              <span>Reading Trade License with AI…</span>
                            </>
                          ) : (
                            <>
                              <Upload className="w-4 h-4" />
                              <span>Upload Trade License</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Card 2: VAT Certificate */}
                  <div className="bg-gradient-to-br from-blue-500/10 via-indigo-500/5 to-slate-800/80 border-2 border-dashed border-blue-500/30 hover:border-blue-500/60 transition-all rounded-2xl p-4 flex flex-col justify-between">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
                          <Sparkles className="w-3.5 h-3.5" /> Attach VAT Certificate
                        </span>
                        <span className="text-[10px] font-semibold bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full border border-blue-500/30">
                          AI Autofill
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        Upload UAE FTA VAT Registration Certificate. AI extracts your 15-digit Tax Registration Number (TRN) &amp; legal entity details.
                      </p>
                    </div>

                    {vatScanSuccess && (
                      <div className="my-2 p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
                        <span className="leading-snug">{vatScanSuccess}</span>
                      </div>
                    )}

                    {vatScanError && (
                      <div className="my-2 p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                        <span className="leading-snug">{vatScanError}</span>
                      </div>
                    )}

                    <div className="mt-3">
                      <input
                        ref={vatCertInputRef}
                        type="file"
                        accept="application/pdf,image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={e => {
                          const file = e.target.files?.[0];
                          if (file) handleOnboardingDocUpload(file, 'VAT_CERTIFICATE');
                          e.target.value = '';
                        }}
                      />

                      {vatCertDoc ? (
                        <div className="p-2.5 rounded-xl bg-slate-900 border border-white/10 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 overflow-hidden">
                            <FileText className="w-4 h-4 text-blue-400 shrink-0" />
                            <span className="text-xs font-medium text-white truncate font-mono">
                              {vatCertDoc.fileName}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => vatCertInputRef.current?.click()}
                            disabled={scanningDoc !== null}
                            className="text-xs font-semibold text-blue-400 hover:text-blue-300 shrink-0"
                          >
                            Replace
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => vatCertInputRef.current?.click()}
                          disabled={scanningDoc !== null}
                          className="w-full py-2.5 bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/30 text-blue-300 rounded-xl font-semibold text-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                          {scanningDoc === 'VAT_CERTIFICATE' ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                              <span>Reading VAT Certificate with AI…</span>
                            </>
                          ) : (
                            <>
                              <Upload className="w-4 h-4" />
                              <span>Upload VAT Certificate</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">
                      Company Name (English) <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.companyName}
                      onChange={e => update('companyName', e.target.value)}
                      placeholder="Acme Transport LLC"
                      className="w-full px-4 py-2.5 bg-slate-800 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">
                      Company Name (Arabic / الاسم التجاري)
                    </label>
                    <input
                      type="text"
                      dir="rtl"
                      value={form.arabicName}
                      onChange={e => update('arabicName', e.target.value)}
                      placeholder="شركة أكمي للنقل ذ.م.م"
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
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">
                      Trade License Number (CRN)
                    </label>
                    <input
                      type="text"
                      value={form.tradeLicenseNo}
                      onChange={e => update('tradeLicenseNo', e.target.value)}
                      placeholder="CN-1234567"
                      className="w-full px-4 py-2.5 bg-slate-800 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">
                      Issuing Authority
                    </label>
                    <input
                      type="text"
                      value={form.tradeLicenseAuthority}
                      onChange={e => update('tradeLicenseAuthority', e.target.value)}
                      placeholder="DED Dubai / ADDED Abu Dhabi / DMCC"
                      className="w-full px-4 py-2.5 bg-slate-800 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">
                      Tax Registration Number (TRN — 15 digits)
                    </label>
                    <input
                      type="text"
                      value={form.trn}
                      onChange={e => update('trn', e.target.value)}
                      placeholder="100123456700003"
                      className="w-full px-4 py-2.5 bg-slate-800 border border-white/10 rounded-xl text-white font-mono placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                    />
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
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">Emirate / City</label>
                    <input
                      type="text"
                      value={form.emirate}
                      onChange={e => update('emirate', e.target.value)}
                      placeholder="Dubai"
                      className="w-full px-4 py-2.5 bg-slate-800 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">
                      Registered Address
                    </label>
                    <input
                      type="text"
                      value={form.address}
                      onChange={e => update('address', e.target.value)}
                      placeholder="Sheikh Zayed Road, Business Bay, Dubai"
                      className="w-full px-4 py-2.5 bg-slate-800 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                    />
                  </div>
                </div>

                {/* Plan selection */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-3">Select Plan</label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {plans.map(plan => (
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
