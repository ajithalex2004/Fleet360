'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Building2,
  ShieldCheck,
  FileSpreadsheet,
  Globe,
  MapPin,
  Save,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Upload,
  FileText,
  Loader2,
  Trash2,
  Download,
} from 'lucide-react';

interface EmirateOption {
  code: string;
  nameEn: string;
  nameAr: string;
}

interface StoredAttachment {
  id: string;
  attachmentTypeId: string;
  typeCode: string;
  typeName: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  documentNumber: string | null;
  expiryDate: string | null;
  createdAt: string;
}

interface CompanyProfileData {
  id: string;
  name: string;
  arabicName: string;
  code: string;
  domain: string;
  trn: string;
  corporateTaxTrn: string;
  tradeLicenseNo: string;
  tradeLicenseAuthority: string;
  peppolEndpointId: string;
  peppolSchemeId: string;
  streetName: string;
  additionalStreetName: string;
  postalZone: string;
  emirate: string;
  emirateCode: string;
  countryCode: string;
  taxSchemeId: string;
  address: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  emiratesCatalog?: EmirateOption[];
  attachments?: StoredAttachment[];
}

const DEFAULT_EMIRATES: EmirateOption[] = [
  { code: 'AE-AZ', nameEn: 'Abu Dhabi', nameAr: 'أبوظبي' },
  { code: 'AE-AJ', nameEn: 'Ajman', nameAr: 'عجمان' },
  { code: 'AE-DU', nameEn: 'Dubai', nameAr: 'دبي' },
  { code: 'AE-FU', nameEn: 'Fujairah', nameAr: 'الفجيرة' },
  { code: 'AE-RK', nameEn: 'Ras Al Khaimah', nameAr: 'رأس الخيمة' },
  { code: 'AE-SH', nameEn: 'Sharjah', nameAr: 'الشارقة' },
  { code: 'AE-UQ', nameEn: 'Umm Al Quwain', nameAr: 'أم القيوين' },
];

export default function CompanyProfilePage() {
  const [form, setForm] = useState<CompanyProfileData>({
    id: '',
    name: '',
    arabicName: '',
    code: '',
    domain: '',
    trn: '',
    corporateTaxTrn: '',
    tradeLicenseNo: '',
    tradeLicenseAuthority: 'DED Dubai',
    peppolEndpointId: '',
    peppolSchemeId: '0235',
    streetName: '',
    additionalStreetName: '',
    postalZone: '',
    emirate: 'Dubai',
    emirateCode: 'AE-DU',
    countryCode: 'AE',
    taxSchemeId: 'VAT',
    address: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
  });
  const [emirates, setEmirates] = useState<EmirateOption[]>(DEFAULT_EMIRATES);
  const [attachments, setAttachments] = useState<StoredAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  // AI Document Autofill state (Trade License & VAT Certificate)
  const tradeLicenseInputRef = useRef<HTMLInputElement | null>(null);
  const vatCertInputRef = useRef<HTMLInputElement | null>(null);

  const [scanningDoc, setScanningDoc] = useState<'TRADE_LICENSE' | 'VAT_CERTIFICATE' | null>(null);
  const [tradeScanSuccess, setTradeScanSuccess] = useState<string | null>(null);
  const [tradeScanError, setTradeScanError] = useState<string | null>(null);
  const [vatScanSuccess, setVatScanSuccess] = useState<string | null>(null);
  const [vatScanError, setVatScanError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/company-profile')
      .then((r) => r.json())
      .then((res) => {
        if (res.data) {
          setForm((prev) => ({ ...prev, ...res.data }));
          if (Array.isArray(res.data.emiratesCatalog) && res.data.emiratesCatalog.length > 0) {
            setEmirates(res.data.emiratesCatalog);
          }
          if (Array.isArray(res.data.attachments)) {
            setAttachments(res.data.attachments);
          }
        }
      })
      .catch(() => {
        setToast({ type: 'err', msg: 'Failed to load company tax & PEPPOL profile' });
      })
      .finally(() => setLoading(false));
  }, []);

  const handleEmirateChange = (emirateCode: string) => {
    const found = emirates.find((e) => e.code === emirateCode);
    setForm((prev) => ({
      ...prev,
      emirateCode,
      emirate: found?.nameEn ?? prev.emirate,
    }));
  };

  // Handle Trade License or VAT Certificate upload + AI Extraction + Autofill
  const handleDocumentUpload = async (
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
        reader.onerror = () => reject(new Error('Failed to read selected file'));
        reader.readAsDataURL(file);
      });

      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;

      const res = await fetch('/api/admin/company-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'autofill-document',
          base64,
          mimeType: file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'),
          fileName: file.name,
          docType,
          saveAttachment: true,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to analyze document');
      }

      if (Array.isArray(data.attachments)) {
        setAttachments(data.attachments);
      }

      if (data.status === 'unavailable' || data.status === 'error') {
        const msg = data.message || 'Document attached, but AI autofill could not extract fields automatically.';
        if (docType === 'TRADE_LICENSE') setTradeScanError(msg);
        else setVatScanError(msg);
        return;
      }

      // Collect autofilled fields summary
      const populated: string[] = [];
      if (data.companyName) populated.push(`Name: ${data.companyName}`);
      if (data.arabicName) populated.push(`Arabic Name: ${data.arabicName}`);
      if (data.tradeLicenseNo) populated.push(`License No: ${data.tradeLicenseNo}`);
      if (data.tradeLicenseAuthority) populated.push(`Authority: ${data.tradeLicenseAuthority}`);
      if (data.trn) populated.push(`VAT TRN: ${data.trn}`);
      if (data.corporateTaxTrn) populated.push(`CT TRN: ${data.corporateTaxTrn}`);
      if (data.emirate) populated.push(`Emirate: ${data.emirate}`);
      if (data.expiryDate) populated.push(`Expiry: ${data.expiryDate}`);
      if (data.postalZone) populated.push(`P.O. Box: ${data.postalZone}`);
      if (data.streetName || data.address) populated.push('Address');
      if (data.contactPhone) populated.push(`Phone: ${data.contactPhone}`);
      if (data.contactEmail) populated.push(`Email: ${data.contactEmail}`);

      // Apply extracted fields to Company Profile form
      setForm((prev) => {
        const next = { ...prev };
        if (data.companyName) next.name = data.companyName;
        if (data.arabicName) next.arabicName = data.arabicName;
        if (data.trn) {
          next.trn = data.trn;
          if (!next.peppolEndpointId || next.peppolEndpointId === prev.trn) {
            next.peppolEndpointId = data.trn;
          }
        }
        if (data.corporateTaxTrn) next.corporateTaxTrn = data.corporateTaxTrn;
        if (data.tradeLicenseNo) next.tradeLicenseNo = data.tradeLicenseNo;
        if (data.tradeLicenseAuthority) next.tradeLicenseAuthority = data.tradeLicenseAuthority;
        if (data.emirateCode) {
          next.emirateCode = data.emirateCode;
          const foundEm = emirates.find((e) => e.code === data.emirateCode);
          if (foundEm) next.emirate = foundEm.nameEn;
        } else if (data.emirate) {
          next.emirate = data.emirate;
          const foundEm = emirates.find((e) => e.nameEn.toLowerCase() === String(data.emirate).toLowerCase());
          if (foundEm) next.emirateCode = foundEm.code;
        }
        if (data.streetName) next.streetName = data.streetName;
        if (data.additionalStreetName) next.additionalStreetName = data.additionalStreetName;
        if (data.postalZone) next.postalZone = data.postalZone;
        if (data.address) next.address = data.address;
        if (data.contactPhone && !next.contactPhone) next.contactPhone = data.contactPhone;
        if (data.contactEmail && !next.contactEmail) next.contactEmail = data.contactEmail;
        return next;
      });

      const confPct = Math.round((data.confidence || 0.92) * 100);
      const label = docType === 'TRADE_LICENSE' ? 'Trade License' : 'VAT Certificate';
      const summary = `✓ ${label} scanned & attached: ${populated.length} fields autofilled (${confPct}% confidence) — ${populated.slice(0, 4).join(' · ')}`;
      if (docType === 'TRADE_LICENSE') {
        setTradeScanSuccess(summary);
      } else {
        setVatScanSuccess(summary);
      }
      setToast({
        type: 'ok',
        msg: `${label} extracted via AI (${populated.length} fields autofilled). Review & click "Save Profile" to persist changes.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to scan document';
      if (docType === 'TRADE_LICENSE') setTradeScanError(msg);
      else setVatScanError(msg);
    } finally {
      setScanningDoc(null);
    }
  };

  const handleDeleteAttachment = async (attachmentId: string) => {
    try {
      const res = await fetch('/api/admin/company-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete-attachment', attachmentId }),
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.attachments)) {
        setAttachments(data.attachments);
        setToast({ type: 'ok', msg: 'Attachment removed.' });
      }
    } catch {
      setToast({ type: 'err', msg: 'Could not remove attachment.' });
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setToast(null);
    try {
      const res = await fetch('/api/admin/company-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) {
        setToast({ type: 'err', msg: json.error || 'Validation failed' });
      } else {
        setForm((prev) => ({ ...prev, ...json.data }));
        setToast({
          type: 'ok',
          msg: 'Company UAE VAT, Corporate Tax & PEPPOL (PINT AE) profile saved.',
        });
      }
    } catch {
      setToast({ type: 'err', msg: 'Network error while saving profile' });
    } finally {
      setSaving(false);
    }
  };

  const trnDigits = form.trn.replace(/[\s-]/g, '');
  const trnValid = !trnDigits || (/^\d{15}$/.test(trnDigits) && trnDigits.startsWith('100'));

  const tradeLicenseAttachment = attachments.find(
    (a) => a.typeCode === 'TRADE_LICENSE' || a.typeCode === 'COMMERCIAL_LICENSE',
  );
  const vatCertAttachment = attachments.find((a) => a.typeCode === 'VAT_CERTIFICATE');

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)] flex items-center gap-2.5">
            <Building2 className="w-7 h-7 text-[var(--primary)]" />
            Company Tax &amp; UAE PEPPOL (PINT AE) Profile
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Configure your legal entity identity, 15-digit FTA VAT TRN, Corporate Tax TRN, and PEPPOL Endpoint ID for
            UAE e-Invoicing (<code className="text-xs">urn:peppol:pint:billing-1@ae-1</code>) and FTA FAF audit files.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 ${
              trnDigits.length === 15 && trnDigits.startsWith('100')
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            {trnDigits.length === 15 && trnDigits.startsWith('100')
              ? 'FTA TRN & PINT AE Ready'
              : 'FTA TRN Incomplete'}
          </span>
        </div>
      </div>

      {toast && (
        <div
          className={`p-4 rounded-xl border flex items-center gap-3 text-sm ${
            toast.type === 'ok'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
          }`}
        >
          {toast.type === 'ok' ? (
            <CheckCircle2 className="w-5 h-5 shrink-0" />
          ) : (
            <AlertTriangle className="w-5 h-5 shrink-0" />
          )}
          <span>{toast.msg}</span>
        </div>
      )}

      {loading ? (
        <div className="p-12 text-center text-[var(--text-muted)]">Loading company profile...</div>
      ) : (
        <form onSubmit={handleSave} className="space-y-6">
          {/* ── Smart AI Document Upload & Autofill (Trade License & VAT Certificate) ── */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border-main)] rounded-2xl p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[var(--border-main)]">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-orange-400" />
                <div>
                  <h2 className="text-base font-semibold text-[var(--text-main)]">
                    Attach Company Trade License &amp; VAT Certificate (AI Autofill)
                  </h2>
                  <p className="text-xs text-[var(--text-muted)]">
                    Upload your official UAE Trade License and FTA VAT Registration Certificate (PDF or image). AI
                    automatically extracts and autofills company names (EN/AR), TRN, License No, Authority, Emirate &amp;
                    address — just like Vehicle Mulkiya onboarding.
                  </p>
                </div>
              </div>
              <span className="text-[11px] font-semibold bg-orange-500/15 text-orange-300 px-3 py-1 rounded-full border border-orange-500/30 self-start sm:self-center">
                ✨ AI Vision + PDF Reader
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Card 1: UAE Trade License */}
              <div className="bg-gradient-to-br from-orange-500/10 via-amber-500/5 to-[var(--bg-base)] border-2 border-dashed border-orange-500/30 hover:border-orange-500/60 transition-all rounded-2xl p-4 flex flex-col justify-between">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-orange-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" /> 1. Attach Company Trade License
                    </span>
                    <span className="text-[10px] font-semibold bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded-full border border-orange-500/30">
                      AI Autofill
                    </span>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                    DED Dubai, ADDED Abu Dhabi, Sharjah SEDD, or Free Zone (DMCC, JAFZA, ADGM, DIFC) Commercial License.
                    Extracts Legal Name (EN/AR), License No, Authority, Emirate &amp; Address.
                  </p>
                </div>

                {tradeScanSuccess && (
                  <div className="my-2.5 p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
                    <span className="leading-snug">{tradeScanSuccess}</span>
                  </div>
                )}

                {tradeScanError && (
                  <div className="my-2.5 p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                    <span className="leading-snug">{tradeScanError}</span>
                  </div>
                )}

                <div className="mt-3 space-y-2">
                  <input
                    ref={tradeLicenseInputRef}
                    type="file"
                    accept="application/pdf,image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleDocumentUpload(file, 'TRADE_LICENSE');
                      e.target.value = '';
                    }}
                  />

                  {tradeLicenseAttachment && (
                    <div className="p-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-main)] flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="w-4 h-4 text-orange-400 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-[var(--text-main)] truncate">
                            {tradeLicenseAttachment.originalName}
                          </div>
                          <div className="text-[11px] text-[var(--text-muted)] truncate">
                            {tradeLicenseAttachment.documentNumber
                              ? `No: ${tradeLicenseAttachment.documentNumber}`
                              : 'Attached'}
                            {tradeLicenseAttachment.expiryDate
                              ? ` · Exp: ${tradeLicenseAttachment.expiryDate}`
                              : ''}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <a
                          href={`/api/admin/tenants/${form.id}/attachments/${tradeLicenseAttachment.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-base)]"
                          title="Download Trade License"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                        <button
                          type="button"
                          onClick={() => handleDeleteAttachment(tradeLicenseAttachment.id)}
                          className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10"
                          title="Remove attachment"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}

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
                        <span>
                          {tradeLicenseAttachment
                            ? 'Replace Trade License & Re-Scan with AI'
                            : 'Upload Trade License (PDF / Image)'}
                        </span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Card 2: UAE FTA VAT Registration Certificate */}
              <div className="bg-gradient-to-br from-blue-500/10 via-indigo-500/5 to-[var(--bg-base)] border-2 border-dashed border-blue-500/30 hover:border-blue-500/60 transition-all rounded-2xl p-4 flex flex-col justify-between">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" /> 2. Attach UAE VAT Certificate
                    </span>
                    <span className="text-[10px] font-semibold bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full border border-blue-500/30">
                      AI Autofill
                    </span>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                    Federal Tax Authority (FTA) VAT / Corporate Tax Registration Certificate. Automatically extracts your
                    15-digit VAT TRN (<code className="text-[11px]">100xxxxxxxxxxxx</code>), PEPPOL Endpoint ID &amp;
                    legal entity details.
                  </p>
                </div>

                {vatScanSuccess && (
                  <div className="my-2.5 p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
                    <span className="leading-snug">{vatScanSuccess}</span>
                  </div>
                )}

                {vatScanError && (
                  <div className="my-2.5 p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                    <span className="leading-snug">{vatScanError}</span>
                  </div>
                )}

                <div className="mt-3 space-y-2">
                  <input
                    ref={vatCertInputRef}
                    type="file"
                    accept="application/pdf,image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleDocumentUpload(file, 'VAT_CERTIFICATE');
                      e.target.value = '';
                    }}
                  />

                  {vatCertAttachment && (
                    <div className="p-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-main)] flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="w-4 h-4 text-blue-400 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-[var(--text-main)] truncate">
                            {vatCertAttachment.originalName}
                          </div>
                          <div className="text-[11px] text-[var(--text-muted)] truncate">
                            {vatCertAttachment.documentNumber
                              ? `TRN: ${vatCertAttachment.documentNumber}`
                              : 'Attached'}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <a
                          href={`/api/admin/tenants/${form.id}/attachments/${vatCertAttachment.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-base)]"
                          title="Download VAT Certificate"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                        <button
                          type="button"
                          onClick={() => handleDeleteAttachment(vatCertAttachment.id)}
                          className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10"
                          title="Remove attachment"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}

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
                        <span>
                          {vatCertAttachment
                            ? 'Replace VAT Certificate & Re-Scan with AI'
                            : 'Upload VAT Certificate (PDF / Image)'}
                        </span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 1. Legal Entity Identity */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border-main)] rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2 text-[var(--text-main)] font-semibold border-b border-[var(--border-main)] pb-3">
              <Building2 className="w-5 h-5 text-[var(--primary)]" />
              <h2>1. Legal Entity &amp; Commercial Registration</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  Legal Name (English) *
                </label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-base)] border border-[var(--border-main)] text-sm text-[var(--text-main)]"
                  placeholder="EXL Solutions Transport L.L.C"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  Legal Name (Arabic / الاسم القانوني بالعربية)
                </label>
                <input
                  type="text"
                  dir="rtl"
                  value={form.arabicName}
                  onChange={(e) => setForm({ ...form, arabicName: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-base)] border border-[var(--border-main)] text-sm text-[var(--text-main)]"
                  placeholder="إي إكس إل سوليوشنز للنقل ذ.م.م"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  Trade License Number (CRN)
                </label>
                <input
                  type="text"
                  value={form.tradeLicenseNo}
                  onChange={(e) => setForm({ ...form, tradeLicenseNo: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-base)] border border-[var(--border-main)] text-sm text-[var(--text-main)]"
                  placeholder="CN-1234567"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  Trade License Issuing Authority
                </label>
                <input
                  type="text"
                  value={form.tradeLicenseAuthority}
                  onChange={(e) => setForm({ ...form, tradeLicenseAuthority: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-base)] border border-[var(--border-main)] text-sm text-[var(--text-main)]"
                  placeholder="DED Dubai / ADDED Abu Dhabi / JAFZA / DMCC"
                />
              </div>
            </div>
          </div>

          {/* 2. UAE FTA VAT & Corporate Tax Registration */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border-main)] rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2 text-[var(--text-main)] font-semibold border-b border-[var(--border-main)] pb-3">
              <FileSpreadsheet className="w-5 h-5 text-[var(--primary)]" />
              <h2>2. UAE Federal Tax Authority (FTA) Registration</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  UAE VAT TRN (15 digits, starts with 100) *
                </label>
                <input
                  type="text"
                  maxLength={19}
                  value={form.trn}
                  onChange={(e) => {
                    const v = e.target.value;
                    setForm((prev) => ({
                      ...prev,
                      trn: v,
                      peppolEndpointId:
                        !prev.peppolEndpointId || prev.peppolEndpointId === prev.trn
                          ? v.replace(/[\s-]/g, '')
                          : prev.peppolEndpointId,
                    }));
                  }}
                  className={`w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-base)] border text-sm font-mono text-[var(--text-main)] ${
                    trnValid ? 'border-[var(--border-main)]' : 'border-rose-500'
                  }`}
                  placeholder="100123456700003"
                />
                {!trnValid && (
                  <p className="text-xs text-rose-400 mt-1">
                    Must be exactly 15 digits and begin with 100.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  UAE Corporate Tax TRN (9–15 digits)
                </label>
                <input
                  type="text"
                  maxLength={19}
                  value={form.corporateTaxTrn}
                  onChange={(e) => setForm({ ...form, corporateTaxTrn: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-base)] border border-[var(--border-main)] text-sm font-mono text-[var(--text-main)]"
                  placeholder="100987654300001"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  Tax Scheme ID
                </label>
                <select
                  value={form.taxSchemeId}
                  onChange={(e) => setForm({ ...form, taxSchemeId: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-base)] border border-[var(--border-main)] text-sm text-[var(--text-main)]"
                >
                  <option value="VAT">VAT — UAE Value Added Tax (5%)</option>
                  <option value="CT">CT — UAE Corporate Tax (9%)</option>
                </select>
              </div>
            </div>
          </div>

          {/* 3. PEPPOL PINT AE Network Endpoint */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border-main)] rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2 text-[var(--text-main)] font-semibold border-b border-[var(--border-main)] pb-3">
              <Globe className="w-5 h-5 text-[var(--primary)]" />
              <h2>3. PEPPOL PINT AE Electronic Invoicing Endpoint</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  PEPPOL Endpoint ID (<code className="text-xs">cbc:EndpointID</code>)
                </label>
                <input
                  type="text"
                  value={form.peppolEndpointId}
                  onChange={(e) => setForm({ ...form, peppolEndpointId: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-base)] border border-[var(--border-main)] text-sm font-mono text-[var(--text-main)]"
                  placeholder="100123456700003"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  PEPPOL EAS Scheme ID (<code className="text-xs">@schemeID</code>)
                </label>
                <select
                  value={form.peppolSchemeId}
                  onChange={(e) => setForm({ ...form, peppolSchemeId: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-base)] border border-[var(--border-main)] text-sm text-[var(--text-main)]"
                >
                  <option value="0235">0235 — UAE Tax Registration Number (FTA TRN)</option>
                  <option value="0088">0088 — EAN Location Code (GLN)</option>
                  <option value="0199">0199 — Legal Entity Identifier (LEI)</option>
                </select>
              </div>
            </div>
          </div>

          {/* 4. Structured Postal Address (Mandatory in UBL 2.1 cac:PostalAddress) */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border-main)] rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2 text-[var(--text-main)] font-semibold border-b border-[var(--border-main)] pb-3">
              <MapPin className="w-5 h-5 text-[var(--primary)]" />
              <h2>4. Structured UAE Postal Address (UBL 2.1 / PINT AE Mandatory)</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  Street Name &amp; Building (<code className="text-xs">cbc:StreetName</code>) *
                </label>
                <input
                  type="text"
                  value={form.streetName}
                  onChange={(e) => setForm({ ...form, streetName: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-base)] border border-[var(--border-main)] text-sm text-[var(--text-main)]"
                  placeholder="Sheikh Zayed Road, Business Bay Tower, Office 1402"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  Additional Street / Area (<code className="text-xs">cbc:AdditionalStreetName</code>)
                </label>
                <input
                  type="text"
                  value={form.additionalStreetName}
                  onChange={(e) => setForm({ ...form, additionalStreetName: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-base)] border border-[var(--border-main)] text-sm text-[var(--text-main)]"
                  placeholder="Business Bay"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  UAE Emirate (<code className="text-xs">cbc:CountrySubentityCode</code>) *
                </label>
                <select
                  value={form.emirateCode}
                  onChange={(e) => handleEmirateChange(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-base)] border border-[var(--border-main)] text-sm text-[var(--text-main)]"
                >
                  {emirates.map((em) => (
                    <option key={em.code} value={em.code}>
                      {em.code} — {em.nameEn} ({em.nameAr})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    P.O. Box / Postal Zone
                  </label>
                  <input
                    type="text"
                    value={form.postalZone}
                    onChange={(e) => setForm({ ...form, postalZone: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-base)] border border-[var(--border-main)] text-sm text-[var(--text-main)]"
                    placeholder="12345"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    ISO Country Code
                  </label>
                  <input
                    type="text"
                    maxLength={2}
                    value={form.countryCode}
                    onChange={(e) =>
                      setForm({ ...form, countryCode: e.target.value.toUpperCase() })
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-base)] border border-[var(--border-main)] text-sm font-mono text-[var(--text-main)]"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  Tax / Finance Contact Person
                </label>
                <input
                  type="text"
                  value={form.contactName}
                  onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-base)] border border-[var(--border-main)] text-sm text-[var(--text-main)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  Finance Contact Email
                </label>
                <input
                  type="email"
                  value={form.contactEmail}
                  onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-base)] border border-[var(--border-main)] text-sm text-[var(--text-main)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  Finance Contact Phone
                </label>
                <input
                  type="text"
                  value={form.contactPhone}
                  onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-base)] border border-[var(--border-main)] text-sm text-[var(--text-main)]"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving || !trnValid}
              className="px-6 py-2.5 rounded-xl bg-[var(--primary)] text-white text-sm font-semibold flex items-center gap-2 hover:opacity-90 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save UAE Tax & PEPPOL Profile'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
