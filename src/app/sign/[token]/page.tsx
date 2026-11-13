'use client';

import { use, useState, useEffect, useRef, useCallback, KeyboardEvent, ClipboardEvent } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────
interface ContractSummary {
  startDate: string;
  endDate: string;
  vehicleLabel: string;
  totalAmount: number;
  currency: string;
  securityDeposit: number | null;
}

interface SigningInfo {
  id: string;
  signingToken: string;
  contractId: string;
  contractType: string;
  contractRef: string;
  documentTitle: string;
  signerName: string;
  signerEmail: string | null;
  signerEmailMasked?: string | null;
  signerPhone: string;
  otpExpiresAt: string;
  status: 'PENDING' | 'SIGNED' | 'EXPIRED' | 'CANCELLED';
  signedAt: string | null;
  sentVia: string;
  resendCount: number;
  createdAt: string;
  contractSummary?: ContractSummary | null;
}

interface SignResult {
  success: boolean;
  contractRef: string;
  contractType: string;
  documentTitle: string;
  signerName: string;
  signedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatUAEDateTime(iso: string): string {
  try {
    return (
      new Date(iso).toLocaleString('en-AE', {
        timeZone: 'Asia/Dubai',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      }) + ' (GMT+4)'
    );
  } catch {
    return iso;
  }
}

function formatShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      timeZone: 'Asia/Dubai',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function maskPhone(phone: string): string {
  if (!phone || phone.length < 4) return '****';
  return '****' + phone.slice(-4);
}

function maskEmailFallback(email: string | null | undefined): string {
  if (!email) return 'your registered email';
  const trimmed = email.trim();
  const atIdx = trimmed.indexOf('@');
  if (atIdx <= 0 || atIdx === trimmed.length - 1) return 'your registered email';
  const local = trimmed.slice(0, atIdx);
  const domain = trimmed.slice(atIdx + 1);
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}***@${domain}`;
}

// ── OTP Input Component (Responsive down to 320px viewports) ─────────────────
interface OTPInputProps {
  value: string[];
  onChange: (val: string[]) => void;
  disabled?: boolean;
  hasError?: boolean;
}

function OTPInput({ value, onChange, disabled = false, hasError = false }: OTPInputProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleInput = (index: number, char: string) => {
    const digit = char.replace(/\D/g, '').slice(0, 1);
    if (!digit) return;
    const next = [...value];
    next[index] = digit;
    onChange(next);
    if (index < 5 && digit) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (value[index]) {
        const next = [...value];
        next[index] = '';
        onChange(next);
      } else if (index > 0) {
        inputRefs.current[index - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    const next = ['', '', '', '', '', ''];
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    onChange(next);
    const focusIdx = Math.min(pasted.length, 5);
    inputRefs.current[focusIdx]?.focus();
  };

  return (
    <div className="flex gap-1.5 sm:gap-3 justify-center my-6">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <input
          key={i}
          ref={(el) => {
            inputRefs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          value={value[i] ?? ''}
          disabled={disabled}
          onChange={(e) => handleInput(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          className={`
            w-10 h-12 sm:w-12 sm:h-14 text-center text-lg sm:text-2xl font-bold rounded-xl border-2 outline-none transition-all
            ${
              disabled
                ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                : hasError
                  ? 'border-red-400 bg-red-50 text-red-600 focus:border-red-500 focus:ring-2 focus:ring-red-200'
                  : value[i]
                    ? 'border-blue-500 bg-blue-50 text-blue-700 focus:border-blue-600 focus:ring-2 focus:ring-blue-200'
                    : 'border-gray-300 bg-white text-gray-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-200'
            }
          `}
          aria-label={`OTP digit ${i + 1}`}
        />
      ))}
    </div>
  );
}

// ── Spinner ────────────────────────────────────────────────────────────────────
function Spinner({
  size = 'md',
  color = 'blue',
}: {
  size?: 'sm' | 'md' | 'lg';
  color?: 'blue' | 'white';
}) {
  const sz = size === 'sm' ? 'w-4 h-4' : size === 'lg' ? 'w-12 h-12' : 'w-6 h-6';
  const border =
    color === 'white' ? 'border-white/30 border-t-white' : 'border-blue-200 border-t-blue-600';
  return <div className={`${sz} border-2 ${border} rounded-full animate-spin`} />;
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);

  // State
  const [loading, setLoading] = useState(true);
  const [signingInfo, setSigningInfo] = useState<SigningInfo | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [agreed, setAgreed] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);

  const [signResult, setSignResult] = useState<SignResult | null>(null);

  // Resend cooldown
  const [resendCooldown, setResendCooldown] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startCooldown = useCallback((seconds = 60) => {
    setResendCooldown(seconds);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(cooldownRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => () => {
    if (cooldownRef.current) clearInterval(cooldownRef.current);
  }, []);

  // Fetch signing info on mount
  useEffect(() => {
    if (!token) return;
    setLoading(true);
    fetch(`/api/esign/verify?signingToken=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          setFetchError(data.error ?? 'Signing link not found.');
        } else {
          setSigningInfo(data as SigningInfo);
        }
      })
      .catch(() => setFetchError('Failed to load document. Please try again.'))
      .finally(() => setLoading(false));
  }, [token]);

  const otpFilled = otpDigits.every((d) => d !== '');

  // Handle sign
  async function handleSign() {
    if (!otpFilled || !agreed || verifying) return;
    setVerifying(true);
    setOtpError(null);
    try {
      const res = await fetch('/api/esign/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signingToken: token,
          otpCode: otpDigits.join(''),
          signerUserAgent: navigator.userAgent,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSignResult(data as SignResult);
      } else if (data.code === 'EXPIRED') {
        setOtpError(data.error ?? 'Your OTP has expired. Please request a new one.');
        setOtpDigits(['', '', '', '', '', '']);
      } else if (data.code === 'INVALID') {
        const rem =
          typeof data.attemptsRemaining === 'number'
            ? ` (${data.attemptsRemaining} attempt${data.attemptsRemaining === 1 ? '' : 's'} remaining)`
            : '';
        setOtpError(`Incorrect OTP. Please check and try again.${rem}`);
        setOtpDigits(['', '', '', '', '', '']);
      } else {
        setOtpError(data.error ?? 'Verification failed. Please try again.');
      }
    } catch {
      setOtpError('Network error. Please check your connection and try again.');
    } finally {
      setVerifying(false);
    }
  }

  // Handle resend
  async function handleResend() {
    if (resendCooldown > 0) return;
    startCooldown(60);
    try {
      const res = await fetch('/api/esign/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signingToken: token, action: 'resend' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOtpError(data.error ?? 'Failed to resend OTP.');
      } else {
        setOtpError(null);
        setOtpDigits(['', '', '', '', '', '']);
        if (signingInfo && signingInfo.status === 'EXPIRED') {
          setSigningInfo({ ...signingInfo, status: 'PENDING' });
        }
      }
    } catch {
      setOtpError('Failed to resend OTP. Please try again.');
    }
  }

  const channelUpper = String(signingInfo?.sentVia ?? 'SMS').toUpperCase();

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100 flex flex-col">
      {/* Top brand bar */}
      <header className="w-full bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-md mx-auto px-4 py-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
            SM
          </div>
          <div>
            <p className="text-gray-900 font-bold text-sm leading-tight">Smart Mobility Platform</p>
            <p className="text-gray-400 text-xs">Secure Digital E-Signing</p>
          </div>
          <div className="ml-auto">
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-50 border border-green-200 rounded-full text-green-700 text-xs font-medium">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                  clipRule="evenodd"
                />
              </svg>
              Secured
            </span>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex items-start justify-center pt-8 pb-12 px-3 sm:px-4">
        <div className="w-full max-w-md">
          {/* ── Loading ─────────────────────────────────────────────────── */}
          {loading && (
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-10 flex flex-col items-center gap-4">
              <Spinner size="lg" />
              <p className="text-gray-500 text-sm">Loading document...</p>
            </div>
          )}

          {/* ── Fetch Error ──────────────────────────────────────────────── */}
          {!loading && fetchError && (
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 flex flex-col items-center gap-4 text-center">
              <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
                <svg
                  className="w-8 h-8 text-red-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900 mb-2">Signing Link Not Found</h2>
                <p className="text-gray-500 text-sm">{fetchError}</p>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Please contact your representative for a valid signing link.
              </p>
            </div>
          )}

          {/* ── EXPIRED / CANCELLED ─────────────────────────────────────── */}
          {!loading &&
            signingInfo &&
            (signingInfo.status === 'EXPIRED' || signingInfo.status === 'CANCELLED') && (
              <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 flex flex-col items-center gap-4 text-center">
                <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
                  <svg
                    className="w-8 h-8 text-red-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                    />
                  </svg>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900 mb-2">
                    {signingInfo.status === 'EXPIRED'
                      ? 'Signing Link Expired'
                      : 'Signing Link Cancelled'}
                  </h2>
                  <p className="text-gray-500 text-sm leading-relaxed">
                    {signingInfo.status === 'EXPIRED'
                      ? 'This signing OTP has expired.'
                      : 'This signing request has been cancelled.'}
                    <br />
                    {signingInfo.status === 'EXPIRED'
                      ? 'Request a fresh OTP below or contact your representative.'
                      : 'Please contact your representative for a new signing link.'}
                  </p>
                </div>
                <div className="w-full mt-2 p-3 bg-gray-50 rounded-xl text-left space-y-1">
                  <p className="text-xs text-gray-500">
                    <span className="font-medium text-gray-700">Document:</span>{' '}
                    {signingInfo.documentTitle}
                  </p>
                  <p className="text-xs text-gray-500">
                    <span className="font-medium text-gray-700">Reference:</span>{' '}
                    {signingInfo.contractRef}
                  </p>
                </div>
                {signingInfo.status === 'EXPIRED' && (
                  <button
                    type="button"
                    disabled={resendCooldown > 0}
                    onClick={() => void handleResend()}
                    className="mt-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50"
                  >
                    {resendCooldown > 0
                      ? `Request New OTP in ${resendCooldown}s`
                      : 'Request New OTP'}
                  </button>
                )}
              </div>
            )}

          {/* ── ALREADY SIGNED ──────────────────────────────────────────── */}
          {!loading && signingInfo && signingInfo.status === 'SIGNED' && !signResult && (
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 flex flex-col items-center gap-4 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
                <svg
                  className="w-9 h-9 text-emerald-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2.5}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900 mb-1">Document Already Signed</h2>
                <p className="text-gray-500 text-sm leading-relaxed">
                  This document was signed by{' '}
                  <span className="font-semibold text-gray-700">{signingInfo.signerName}</span>
                  {signingInfo.signedAt && <> on {formatUAEDateTime(signingInfo.signedAt)}</>}.
                </p>
              </div>
              <div className="w-full p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-left space-y-1">
                <p className="text-xs text-gray-600">
                  <span className="font-medium">Document:</span> {signingInfo.documentTitle}
                </p>
                <p className="text-xs text-gray-600">
                  <span className="font-medium">Reference:</span> {signingInfo.contractRef}
                </p>
              </div>
              <p className="text-xs text-gray-400">You may safely close this window.</p>
            </div>
          )}

          {/* ── SUCCESS (after signing in this session) ──────────────────── */}
          {signResult && (
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 flex flex-col items-center gap-5 text-center animate-fade-in">
              <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center animate-bounce-once">
                <svg
                  className="w-11 h-11 text-emerald-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2.5}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-1">
                  Document Signed Successfully!
                </h2>
                <p className="text-emerald-600 text-sm font-medium">
                  Your signature has been recorded securely.
                </p>
              </div>

              <div className="w-full bg-gray-50 rounded-xl border border-gray-200 divide-y divide-gray-100 text-left overflow-hidden">
                <div className="px-4 py-3">
                  <p className="text-xs text-gray-400 mb-0.5">Signed by</p>
                  <p className="text-sm font-semibold text-gray-800">{signResult.signerName}</p>
                </div>
                <div className="px-4 py-3">
                  <p className="text-xs text-gray-400 mb-0.5">Date &amp; Time</p>
                  <p className="text-sm font-semibold text-gray-800">
                    {formatUAEDateTime(signResult.signedAt)}
                  </p>
                </div>
                <div className="px-4 py-3">
                  <p className="text-xs text-gray-400 mb-0.5">Document</p>
                  <p className="text-sm font-semibold text-gray-800">{signResult.documentTitle}</p>
                </div>
                <div className="px-4 py-3">
                  <p className="text-xs text-gray-400 mb-0.5">Reference</p>
                  <p className="text-sm font-semibold text-gray-800">{signResult.contractRef}</p>
                </div>
              </div>

              <p className="text-xs text-gray-400 leading-relaxed">
                A confirmation has been recorded against your contract.
                <br />
                You may safely close this window.
              </p>
            </div>
          )}

          {/* ── PENDING — Signing Form ───────────────────────────────────── */}
          {!loading && signingInfo && signingInfo.status === 'PENDING' && !signResult && (
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
              {/* Document header */}
              <div className="bg-gradient-to-r from-blue-600 to-indigo-700 px-5 sm:px-6 py-5">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg
                      className="w-5 h-5 text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-blue-200 text-xs font-medium mb-0.5">
                      Document Ready for Signing
                    </p>
                    <h1 className="text-white font-bold text-base leading-snug line-clamp-2">
                      {signingInfo.documentTitle}
                    </h1>
                    <p className="text-blue-200 text-xs mt-1">Ref: {signingInfo.contractRef}</p>
                  </div>
                </div>
              </div>

              {/* Form body */}
              <div className="p-5 sm:p-6">
                {/* Contract Summary Card (so signers never sign blind) */}
                {signingInfo.contractSummary && (
                  <div className="mb-5 rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-2.5">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Key Agreement Terms Summary
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                      <div>
                        <span className="text-slate-400 block">Assigned Vehicle</span>
                        <span className="font-semibold text-slate-800">
                          {signingInfo.contractSummary.vehicleLabel}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">Rental Period</span>
                        <span className="font-semibold text-slate-800">
                          {formatShortDate(signingInfo.contractSummary.startDate)} →{' '}
                          {formatShortDate(signingInfo.contractSummary.endDate)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">Contract Total (incl. VAT)</span>
                        <span className="font-bold text-blue-700">
                          {signingInfo.contractSummary.currency}{' '}
                          {Number(signingInfo.contractSummary.totalAmount).toLocaleString('en-AE', {
                            minimumFractionDigits: 2,
                          })}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">Security Deposit</span>
                        <span className="font-semibold text-slate-800">
                          {signingInfo.contractSummary.securityDeposit != null
                            ? `${signingInfo.contractSummary.currency} ${Number(
                                signingInfo.contractSummary.securityDeposit,
                              ).toLocaleString('en-AE', { minimumFractionDigits: 2 })}`
                            : 'Waived / Corporate Account'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Signer greeting + channel-accurate OTP delivery prompt */}
                <div className="mb-5">
                  <p className="text-gray-500 text-sm">Hello,</p>
                  <p className="text-gray-900 font-bold text-lg">{signingInfo.signerName}</p>
                  <p className="text-gray-500 text-sm mt-2 leading-relaxed">
                    {channelUpper === 'EMAIL' ? (
                      <>
                        Please enter the 6-digit OTP sent to your email{' '}
                        <span className="font-semibold text-gray-700 break-all">
                          {signingInfo.signerEmailMasked ??
                            maskEmailFallback(signingInfo.signerEmail)}
                        </span>
                        .
                      </>
                    ) : channelUpper === 'WHATSAPP' ? (
                      <>
                        Please enter the 6-digit OTP sent via WhatsApp to your phone ending in{' '}
                        <span className="font-semibold text-gray-700">
                          {maskPhone(signingInfo.signerPhone)}
                        </span>
                        .
                      </>
                    ) : (
                      <>
                        Please enter the 6-digit OTP sent via SMS to your phone ending in{' '}
                        <span className="font-semibold text-gray-700">
                          {maskPhone(signingInfo.signerPhone)}
                        </span>
                        .
                      </>
                    )}
                  </p>
                </div>

                {/* OTP Input */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    One-Time Password (OTP)
                  </label>
                  <OTPInput
                    value={otpDigits}
                    onChange={(val) => {
                      setOtpDigits(val);
                      setOtpError(null);
                    }}
                    disabled={verifying}
                    hasError={!!otpError}
                  />

                  {/* OTP Error */}
                  {otpError && (
                    <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 mb-4">
                      <svg
                        className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <p className="text-red-600 text-sm">{otpError}</p>
                    </div>
                  )}

                  {/* Resend OTP */}
                  <div className="flex justify-center mb-5">
                    {resendCooldown > 0 ? (
                      <p className="text-gray-400 text-sm">
                        Resend OTP in{' '}
                        <span className="font-semibold text-gray-600">{resendCooldown}s</span>
                      </p>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleResend()}
                        className="text-blue-600 hover:text-blue-700 text-sm font-medium underline underline-offset-2 transition-colors"
                      >
                        Resend OTP
                      </button>
                    )}
                  </div>
                </div>

                {/* Terms checkbox */}
                <label className="flex items-start gap-3 cursor-pointer group mb-6">
                  <div className="relative flex-shrink-0 mt-0.5">
                    <input
                      type="checkbox"
                      checked={agreed}
                      onChange={(e) => setAgreed(e.target.checked)}
                      disabled={verifying}
                      className="sr-only"
                    />
                    <div
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                        agreed
                          ? 'bg-blue-600 border-blue-600'
                          : 'border-gray-300 bg-white group-hover:border-blue-400'
                      }`}
                    >
                      {agreed && (
                        <svg
                          className="w-3 h-3 text-white"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={3}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      )}
                    </div>
                  </div>
                  <p className="text-gray-600 text-sm leading-relaxed select-none">
                    By signing, I confirm that I have read and agree to the terms of this document.
                    I consent to sign this document electronically.
                  </p>
                </label>

                {/* Sign button */}
                <button
                  type="button"
                  onClick={() => void handleSign()}
                  disabled={!otpFilled || !agreed || verifying}
                  className={`
                    w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-semibold text-base transition-all
                    ${
                      !otpFilled || !agreed || verifying
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        : 'bg-gradient-to-r from-blue-600 to-indigo-700 text-white hover:from-blue-700 hover:to-indigo-800 shadow-md hover:shadow-lg active:scale-[0.98]'
                    }
                  `}
                >
                  {verifying ? (
                    <>
                      <Spinner size="sm" color="white" />
                      <span>Verifying...</span>
                    </>
                  ) : (
                    <>
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                        />
                      </svg>
                      Sign Document
                    </>
                  )}
                </button>
              </div>

              {/* Footer note */}
              <div className="px-6 pb-5">
                <p className="text-center text-xs text-gray-400 leading-relaxed">
                  This is a legally binding electronic signature. Your signature is secured and
                  timestamped.
                </p>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Bottom brand strip */}
      <footer className="py-4 text-center">
        <p className="text-xs text-gray-400">
          Powered by <span className="font-medium text-gray-500">Smart Mobility Platform</span> ·
          Secure E-Signing
        </p>
      </footer>

      <style jsx global>{`
        @keyframes bounce-once {
          0%,
          100% {
            transform: scale(1);
          }
          30% {
            transform: scale(1.15);
          }
          60% {
            transform: scale(0.95);
          }
        }
        .animate-bounce-once {
          animation: bounce-once 0.6s ease-out;
        }
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fade-in {
          animation: fade-in 0.4s ease-out;
        }
      `}</style>
    </div>
  );
}
