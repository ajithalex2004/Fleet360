'use client';

import React, { Suspense, useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Building2,
  Copy,
  Check,
  ExternalLink,
  ShieldAlert,
  UserPlus,
  Trash2,
  Power,
  KeyRound,
  ScanLine,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';
import { RENTAL_CUSTOMER_TYPES } from '@/lib/rental/categories';

type CustomerTypeItem = string | { value?: string; code?: string; label?: string };
type KycDocTypeOption =
  | 'EMIRATES_ID'
  | 'PASSPORT'
  | 'DRIVING_LICENSE'
  | 'INTERNATIONAL_DRIVING_PERMIT';

const UAE_IDP_EXEMPT_COUNTRIES = new Set<string>([
  'ARE', 'UAE', 'UNITED ARAB EMIRATES',
  'SAU', 'SAUDI ARABIA', 'OMN', 'OMAN', 'KWT', 'KUWAIT', 'BHR', 'BAHRAIN', 'QAT', 'QATAR',
  'GBR', 'UK', 'UNITED KINGDOM', 'GREAT BRITAIN',
  'USA', 'US', 'UNITED STATES', 'UNITED STATES OF AMERICA',
  'CAN', 'CANADA', 'AUS', 'AUSTRALIA', 'NZL', 'NEW ZEALAND',
  'DEU', 'GERMANY', 'FRA', 'FRANCE', 'ITA', 'ITALY', 'ESP', 'SPAIN',
  'NLD', 'NETHERLANDS', 'BEL', 'BELGIUM', 'CHE', 'SWITZERLAND', 'AUT', 'AUSTRIA',
  'SWE', 'SWEDEN', 'NOR', 'NORWAY', 'DNK', 'DENMARK', 'FIN', 'FINLAND',
  'IRL', 'IRELAND', 'PRT', 'PORTUGAL', 'GRC', 'GREECE', 'POL', 'POLAND', 'LUX', 'LUXEMBOURG',
  'JPN', 'JAPAN', 'KOR', 'SOUTH KOREA', 'REPUBLIC OF KOREA', 'SGP', 'SINGAPORE', 'HKG', 'HONG KONG',
  'ZAF', 'SOUTH AFRICA', 'TUR', 'TURKEY', 'TURKIYE', 'CHN', 'CHINA',
  'HUN', 'HUNGARY', 'SVK', 'SLOVAKIA', 'SVN', 'SLOVENIA', 'ROU', 'ROMANIA', 'BGR', 'BULGARIA',
  'EST', 'ESTONIA', 'LVA', 'LATVIA', 'LTU', 'LITHUANIA', 'CYP', 'CYPRUS', 'MLT', 'MALTA',
  'ISL', 'ICELAND', 'SRB', 'SERBIA', 'ALB', 'ALBANIA', 'UKR', 'UKRAINE',
  'ISR', 'ISRAEL', 'AZE', 'AZERBAIJAN', 'UZB', 'UZBEKISTAN', 'BLR', 'BELARUS',
]);

function isTouristRequiringIdp(visaType: string, licenseIssuingCountry: string): boolean {
  if (visaType.toUpperCase() !== 'TOURIST') return false;
  const normalized = licenseIssuingCountry.trim().toUpperCase();
  if (!normalized) return false;
  return !UAE_IDP_EXEMPT_COUNTRIES.has(normalized);
}

function computeAgeYears(dobDateStr: string): number | null {
  if (!dobDateStr) return null;
  const dob = new Date(dobDateStr);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) {
    age -= 1;
  }
  return age >= 0 && age < 130 ? age : null;
}

function sliceDateInput(iso?: string | null): string {
  if (!iso) return '';
  return String(iso).slice(0, 10);
}

function toIsoDateOrNull(dateStr: string): string | null {
  if (!dateStr || !dateStr.trim()) return null;
  const dt = new Date(dateStr);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

const CUSTOMER_TYPE_LABELS: Record<string, string> = {
  INDIVIDUAL: 'Individual (Retail)',
  CORPORATE: 'Corporate (B2B Account)',
  AIRLINE: 'Airline Partner',
  INSURANCE: 'Insurance Replacement',
  FREQUENT_FLYER: 'Frequent Flyer',
  GOVERNMENT: 'Government / Public Sector',
};

const CUSTOMER_TYPE_BADGE: Record<string, string> = {
  CORPORATE: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  AIRLINE: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
  INSURANCE: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  FREQUENT_FLYER: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  GOVERNMENT: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
};

const CUSTOMER_TYPE_OPTIONS = (RENTAL_CUSTOMER_TYPES as readonly CustomerTypeItem[]).map((item) => {
  const code = (typeof item === 'string' ? item : String(item.value ?? item.code ?? '')).toUpperCase();
  const label =
    typeof item === 'string'
      ? CUSTOMER_TYPE_LABELS[code] ?? code
      : item.label ?? CUSTOMER_TYPE_LABELS[code] ?? code;
  return { value: code, label };
});

interface Customer {
  id: string;
  fullName: string;
  customerType?: string;
  companyName?: string;
  nationality?: string;
  visaType?: 'RESIDENT' | 'TOURIST' | string | null;
  emiratesId?: string | null;
  emiratesIdExpiry?: string | null;
  passportNo?: string;
  passportExpiry?: string | null;
  drivingLicenseNo?: string;
  licenseIssuingCountry?: string | null;
  licenseIssueDate?: string | null;
  licenseExpiry?: string;
  internationalPermitNo?: string | null;
  internationalPermitExpiry?: string | null;
  dateOfBirth?: string | null;
  email?: string;
  phone?: string;
  blacklisted?: boolean;
  createdAt?: string;
}

interface RacPortalUser {
  id: string;
  email: string;
  fullName: string;
  phone?: string;
  role: 'RAC_B2B_ADMIN' | 'RAC_B2B_USER' | string;
  hasPassword: boolean;
  lastLoginAt: string | null;
  isActive: boolean;
}

interface CustomerFormState {
  fullName: string;
  customerType: string;
  companyName: string;
  nationality: string;
  visaType: 'RESIDENT' | 'TOURIST';
  dateOfBirth: string;
  emiratesId: string;
  emiratesIdExpiry: string;
  passportNo: string;
  passportExpiry: string;
  drivingLicenseNo: string;
  licenseIssuingCountry: string;
  licenseIssueDate: string;
  licenseExpiry: string;
  internationalPermitNo: string;
  internationalPermitExpiry: string;
  email: string;
  phone: string;
  blacklisted: boolean;
}

interface KycScanBanner {
  provider: string;
  confidence: number;
  documentNumber: string;
  isExpired: boolean;
  warnings: string[];
}

function normalizePortalUser(raw: Record<string, unknown>): RacPortalUser {
  return {
    id: String(raw.id ?? ''),
    email: String(raw.email ?? ''),
    fullName: String(raw.fullName ?? raw.full_name ?? ''),
    phone: raw.phone ? String(raw.phone) : undefined,
    role: String(raw.role ?? 'RAC_B2B_USER'),
    hasPassword: Boolean(raw.hasPassword ?? raw.has_password ?? raw.passwordSet),
    lastLoginAt: raw.lastLoginAt
      ? String(raw.lastLoginAt)
      : raw.last_login_at
        ? String(raw.last_login_at)
        : null,
    isActive:
      raw.isActive !== undefined
        ? Boolean(raw.isActive)
        : raw.is_active !== undefined
          ? Boolean(raw.is_active)
          : true,
  };
}

function fmtDateTime(iso?: string | null) {
  if (!iso) return 'Never';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return 'Never';
  return dt.toLocaleString('en-AE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function CustomersPageInner() {
  const searchParams = useSearchParams();
  const queryCustomerId = searchParams.get('id') ?? '';

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [focusedId, setFocusedId] = useState<string>(queryCustomerId);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [modalError, setModalError] = useState('');
  const [rbacError, setRbacError] = useState('');
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);

  const [formData, setFormData] = useState<CustomerFormState>({
    fullName: '',
    customerType: 'INDIVIDUAL',
    companyName: '',
    nationality: '',
    visaType: 'RESIDENT',
    dateOfBirth: '',
    emiratesId: '',
    emiratesIdExpiry: '',
    passportNo: '',
    passportExpiry: '',
    drivingLicenseNo: '',
    licenseIssuingCountry: '',
    licenseIssueDate: '',
    licenseExpiry: '',
    internationalPermitNo: '',
    internationalPermitExpiry: '',
    email: '',
    phone: '',
    blacklisted: false,
  });

  // Multimodal AI KYC Document Scanner state
  const kycFileInputRef = useRef<HTMLInputElement | null>(null);
  const [kycDocType, setKycDocType] = useState<KycDocTypeOption>('EMIRATES_ID');
  const [kycScanning, setKycScanning] = useState(false);
  const [kycBanner, setKycBanner] = useState<KycScanBanner | null>(null);

  // Corporate B2B Portal Access modal state
  const [portalCustomer, setPortalCustomer] = useState<Customer | null>(null);
  const [portalUsers, setPortalUsers] = useState<RacPortalUser[]>([]);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [userBusyId, setUserBusyId] = useState<string | null>(null);
  const [inviteForm, setInviteForm] = useState({
    email: '',
    fullName: '',
    phone: '',
    role: 'RAC_B2B_ADMIN' as 'RAC_B2B_ADMIN' | 'RAC_B2B_USER',
  });
  const [generatedSetupLink, setGeneratedSetupLink] = useState('');
  const [invitedEmail, setInvitedEmail] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    setFocusedId(queryCustomerId);
  }, [queryCustomerId]);

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/rental/customers?limit=200', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) {
        setRbacError(String(data?.error ?? 'Requires permission to view customers.'));
        setCustomers([]);
        return;
      }
      if (!res.ok) {
        setError(String(data?.error ?? 'Failed to load customers'));
        setCustomers([]);
        return;
      }
      const rows: Customer[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.data)
          ? data.data
          : Array.isArray(data?.customers)
            ? data.customers
            : [];
      setCustomers(rows);
    } catch {
      setError('Failed to load customers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  // Ensure focused customer via ?id= is loaded & scrolled into view
  useEffect(() => {
    if (!focusedId || loading) return;
    const exists = customers.some((c) => c.id === focusedId);
    if (exists) {
      const el = document.getElementById(`customer-row-${focusedId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/rental/customers/${encodeURIComponent(focusedId)}`, {
          cache: 'no-store',
        });
        if (!res.ok || cancelled) return;
        const single = await res.json().catch(() => null);
        if (single?.id && !cancelled) {
          setCustomers((prev) => (prev.some((p) => p.id === single.id) ? prev : [single, ...prev]));
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [focusedId, loading, customers]);

  const openNew = () => {
    setEditCustomer(null);
    setModalError('');
    setKycBanner(null);
    setFormData({
      fullName: '',
      customerType: 'INDIVIDUAL',
      companyName: '',
      nationality: '',
      visaType: 'RESIDENT',
      dateOfBirth: '',
      emiratesId: '',
      emiratesIdExpiry: '',
      passportNo: '',
      passportExpiry: '',
      drivingLicenseNo: '',
      licenseIssuingCountry: '',
      licenseIssueDate: '',
      licenseExpiry: '',
      internationalPermitNo: '',
      internationalPermitExpiry: '',
      email: '',
      phone: '',
      blacklisted: false,
    });
    setShowModal(true);
  };

  const openEdit = (c: Customer) => {
    setEditCustomer(c);
    setModalError('');
    setKycBanner(null);
    const resolvedVisa =
      String(c.visaType ?? '').toUpperCase() === 'TOURIST' ? 'TOURIST' : 'RESIDENT';
    setFormData({
      fullName: c.fullName,
      customerType: (c.customerType ?? (c.companyName ? 'CORPORATE' : 'INDIVIDUAL')).toUpperCase(),
      companyName: c.companyName ?? '',
      nationality: c.nationality ?? '',
      visaType: resolvedVisa,
      dateOfBirth: sliceDateInput(c.dateOfBirth),
      emiratesId: c.emiratesId ?? '',
      emiratesIdExpiry: sliceDateInput(c.emiratesIdExpiry),
      passportNo: c.passportNo ?? '',
      passportExpiry: sliceDateInput(c.passportExpiry),
      drivingLicenseNo: c.drivingLicenseNo ?? '',
      licenseIssuingCountry: c.licenseIssuingCountry ?? '',
      licenseIssueDate: sliceDateInput(c.licenseIssueDate),
      licenseExpiry: sliceDateInput(c.licenseExpiry),
      internationalPermitNo: c.internationalPermitNo ?? '',
      internationalPermitExpiry: sliceDateInput(c.internationalPermitExpiry),
      email: c.email ?? '',
      phone: c.phone ?? '',
      blacklisted: c.blacklisted ?? false,
    });
    setShowModal(true);
  };

  const handleKycFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (file.size > 4.5 * 1024 * 1024) {
      setModalError('Document image/PDF exceeds 4.5 MB limit. Please upload a smaller scan.');
      return;
    }

    setKycScanning(true);
    setModalError('');
    setKycBanner(null);

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(new Error('Failed to read selected document file'));
        reader.readAsDataURL(file);
      });

      const res = await fetch('/api/rental/documents/kyc-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentType: kycDocType,
          imageDataUrl: dataUrl,
          mimeType: file.type || undefined,
          hintName: formData.fullName || undefined,
          customerId: editCustomer?.id || undefined,
          applyToCustomer: false,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 403) {
        setModalError(
          `Requires RAC Customer Permission (403): ${String(
            json?.error ?? 'Unable to scan KYC document.',
          )}`,
        );
        return;
      }
      if (!res.ok) {
        setModalError(String(json?.error ?? 'Failed to scan KYC document'));
        return;
      }

      const scan = (json?.scan ?? {}) as Record<string, unknown>;
      const suggested = (json?.suggestedCustomerFields ?? {}) as Record<string, unknown>;

      setFormData((prev) => ({
        ...prev,
        fullName:
          typeof suggested.fullName === 'string' && suggested.fullName.trim()
            ? suggested.fullName.trim()
            : prev.fullName,
        nationality:
          typeof suggested.nationality === 'string' && suggested.nationality.trim()
            ? suggested.nationality.trim()
            : prev.nationality,
        visaType:
          String(suggested.visaType ?? '').toUpperCase() === 'TOURIST'
            ? 'TOURIST'
            : String(suggested.visaType ?? '').toUpperCase() === 'RESIDENT'
              ? 'RESIDENT'
              : prev.visaType,
        dateOfBirth:
          typeof suggested.dateOfBirth === 'string' && suggested.dateOfBirth
            ? sliceDateInput(suggested.dateOfBirth)
            : prev.dateOfBirth,
        emiratesId:
          typeof suggested.emiratesId === 'string' && suggested.emiratesId.trim()
            ? suggested.emiratesId.trim()
            : prev.emiratesId,
        emiratesIdExpiry:
          typeof suggested.emiratesIdExpiry === 'string' && suggested.emiratesIdExpiry
            ? sliceDateInput(suggested.emiratesIdExpiry)
            : prev.emiratesIdExpiry,
        passportNo:
          typeof suggested.passportNo === 'string' && suggested.passportNo.trim()
            ? suggested.passportNo.trim()
            : prev.passportNo,
        passportExpiry:
          typeof suggested.passportExpiry === 'string' && suggested.passportExpiry
            ? sliceDateInput(suggested.passportExpiry)
            : prev.passportExpiry,
        drivingLicenseNo:
          typeof suggested.drivingLicenseNo === 'string' && suggested.drivingLicenseNo.trim()
            ? suggested.drivingLicenseNo.trim()
            : prev.drivingLicenseNo,
        licenseIssuingCountry:
          typeof suggested.licenseIssuingCountry === 'string' &&
          suggested.licenseIssuingCountry.trim()
            ? suggested.licenseIssuingCountry.trim()
            : prev.licenseIssuingCountry,
        licenseIssueDate:
          typeof suggested.licenseIssueDate === 'string' && suggested.licenseIssueDate
            ? sliceDateInput(suggested.licenseIssueDate)
            : prev.licenseIssueDate,
        licenseExpiry:
          typeof suggested.licenseExpiry === 'string' && suggested.licenseExpiry
            ? sliceDateInput(suggested.licenseExpiry)
            : prev.licenseExpiry,
        internationalPermitNo:
          typeof suggested.internationalPermitNo === 'string' &&
          suggested.internationalPermitNo.trim()
            ? suggested.internationalPermitNo.trim()
            : prev.internationalPermitNo,
        internationalPermitExpiry:
          typeof suggested.internationalPermitExpiry === 'string' &&
          suggested.internationalPermitExpiry
            ? sliceDateInput(suggested.internationalPermitExpiry)
            : prev.internationalPermitExpiry,
      }));

      setKycBanner({
        provider: String(scan.provider ?? 'multimodal-ocr'),
        confidence: Number(scan.confidence ?? scan.confidenceScore ?? 0.9),
        documentNumber: String(scan.documentNumber ?? scan.docNumber ?? '—'),
        isExpired: Boolean(scan.isExpired),
        warnings: Array.isArray(scan.warnings)
          ? scan.warnings.map((w) => String(w))
          : [],
      });
    } catch {
      setModalError('Failed to process document image for AI OCR scan');
    } finally {
      setKycScanning(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setModalError('');
    setRbacError('');
    try {
      const payload = {
        fullName: formData.fullName,
        customerType: formData.customerType.toUpperCase(),
        companyName: formData.companyName || null,
        nationality: formData.nationality || null,
        visaType: formData.visaType,
        dateOfBirth: toIsoDateOrNull(formData.dateOfBirth),
        emiratesId: formData.emiratesId.trim() || null,
        emiratesIdExpiry: toIsoDateOrNull(formData.emiratesIdExpiry),
        passportNo: formData.passportNo.trim() || null,
        passportExpiry: toIsoDateOrNull(formData.passportExpiry),
        drivingLicenseNo: formData.drivingLicenseNo.trim() || null,
        licenseIssuingCountry: formData.licenseIssuingCountry.trim() || null,
        licenseIssueDate: toIsoDateOrNull(formData.licenseIssueDate),
        licenseExpiry: toIsoDateOrNull(formData.licenseExpiry),
        internationalPermitNo: formData.internationalPermitNo.trim() || null,
        internationalPermitExpiry: toIsoDateOrNull(formData.internationalPermitExpiry),
        email: formData.email || null,
        phone: formData.phone || null,
        blacklisted: formData.blacklisted,
      };
      const url = editCustomer
        ? `/api/rental/customers/${editCustomer.id}`
        : '/api/rental/customers';
      const method = editCustomer ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 403) {
        const msg = String(json?.error ?? 'Requires RAC Manager or Operator permission.');
        setRbacError(msg);
        setModalError(`Requires RAC Manager Permission (403): ${msg}`);
        return;
      }
      if (!res.ok) {
        const msg = String(json?.error ?? 'Failed to save customer');
        setModalError(msg);
        setError(msg);
        return;
      }
      setShowModal(false);
      loadCustomers();
    } catch {
      setModalError('Failed to save customer');
      setError('Failed to save customer');
    } finally {
      setSaving(false);
    }
  };

  const handleBlacklist = async (c: Customer) => {
    if (!confirm(`${c.blacklisted ? 'Remove from' : 'Add to'} blacklist?`)) return;
    setRbacError('');
    setError('');
    try {
      const res = await fetch(`/api/rental/customers/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blacklisted: !c.blacklisted }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 403) {
        setRbacError(String(json?.error ?? 'Requires RAC Manager permission to update blacklist.'));
        return;
      }
      if (!res.ok) {
        setError(String(json?.error ?? 'Failed to update customer blacklist status'));
        return;
      }
      loadCustomers();
    } catch {
      setError('Failed to update customer status');
    }
  };

  // ── B2B Portal Access Handlers ─────────────────────────────────────────────
  const fetchPortalUsers = useCallback(async (customerId: string) => {
    setPortalLoading(true);
    setPortalError('');
    try {
      const res = await fetch(`/api/rental/customers/${customerId}/portal-users`, {
        cache: 'no-store',
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 403) {
        setPortalError(
          String(json?.error ?? 'Requires RAC Manager permission to view B2B portal users.')
        );
        setPortalUsers([]);
        return;
      }
      if (!res.ok) {
        setPortalError(String(json?.error ?? 'Failed to load B2B portal users'));
        setPortalUsers([]);
        return;
      }
      const rawUsers = Array.isArray(json)
        ? json
        : Array.isArray(json?.users)
          ? json.users
          : Array.isArray(json?.portalUsers)
            ? json.portalUsers
            : Array.isArray(json?.data)
              ? json.data
              : [];
      setPortalUsers((rawUsers as Record<string, unknown>[]).map(normalizePortalUser));
    } catch {
      setPortalError('Unable to load B2B portal users');
    } finally {
      setPortalLoading(false);
    }
  }, []);

  const openPortalModal = (c: Customer) => {
    setPortalCustomer(c);
    setPortalUsers([]);
    setPortalError('');
    setGeneratedSetupLink('');
    setInvitedEmail('');
    setCopiedLink(false);
    setInviteForm({
      email: c.email ?? '',
      fullName: c.fullName ?? '',
      phone: c.phone ?? '',
      role: 'RAC_B2B_ADMIN',
    });
    fetchPortalUsers(c.id);
  };

  const handleInvitePortalUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!portalCustomer) return;
    setInviteBusy(true);
    setPortalError('');
    setGeneratedSetupLink('');
    setCopiedLink(false);

    try {
      const res = await fetch(`/api/rental/customers/${portalCustomer.id}/portal-users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteForm.email.trim(),
          fullName: inviteForm.fullName.trim(),
          phone: inviteForm.phone.trim() || undefined,
          role: inviteForm.role,
        }),
      });
      const json = await res.json().catch(() => ({}));

      if (res.status === 403) {
        setPortalError(
          `Requires RAC Manager permission (403): ${String(
            json?.error ?? 'Only RAC Managers can invite corporate portal users.'
          )}`
        );
        return;
      }
      if (!res.ok) {
        setPortalError(String(json?.error ?? 'Failed to create portal invitation'));
        return;
      }

      const invObj = (json?.invitation ?? json?.user ?? json?.data ?? json) as Record<
        string,
        unknown
      >;
      const tokenVal = invObj?.token ?? json?.token;
      const rawSetupUrl = String(
        json?.setupUrl ??
          json?.setup_url ??
          invObj?.setupUrl ??
          invObj?.setup_url ??
          json?.invitationUrl ??
          invObj?.invitationUrl ??
          json?.inviteUrl ??
          invObj?.inviteUrl ??
          (tokenVal ? `/rac-portal/setup?token=${String(tokenVal)}` : '')
      );
      if (rawSetupUrl) {
        const fullLink = rawSetupUrl.startsWith('http')
          ? rawSetupUrl
          : `${window.location.origin}${rawSetupUrl.startsWith('/') ? '' : '/'}${rawSetupUrl}`;
        setGeneratedSetupLink(fullLink);
      }
      setInvitedEmail(inviteForm.email.trim());
      setInviteForm({ email: '', fullName: '', phone: '', role: 'RAC_B2B_USER' });
      fetchPortalUsers(portalCustomer.id);
    } catch {
      setPortalError('Network error sending B2B portal invitation');
    } finally {
      setInviteBusy(false);
    }
  };

  const handleTogglePortalUser = async (u: RacPortalUser) => {
    if (!portalCustomer) return;
    setUserBusyId(u.id);
    setPortalError('');
    try {
      const nextActive = !u.isActive;
      let res = await fetch(
        `/api/rental/customers/${portalCustomer.id}/portal-users?userId=${encodeURIComponent(u.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: u.id, id: u.id, isActive: nextActive }),
        }
      );
      if (res.status === 404 || res.status === 405) {
        res = await fetch(
          `/api/rental/customers/${portalCustomer.id}/portal-users/${encodeURIComponent(u.id)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isActive: nextActive }),
          }
        );
      }
      const json = await res.json().catch(() => ({}));
      if (res.status === 403) {
        setPortalError(
          `Requires RAC Manager permission (403): ${String(
            json?.error ?? 'Cannot modify B2B portal access.'
          )}`
        );
        return;
      }
      if (!res.ok) {
        setPortalError(String(json?.error ?? 'Failed to update portal user status'));
        return;
      }
      fetchPortalUsers(portalCustomer.id);
    } catch {
      setPortalError('Failed to toggle portal user');
    } finally {
      setUserBusyId(null);
    }
  };

  const handleRemovePortalUser = async (u: RacPortalUser) => {
    if (!portalCustomer) return;
    if (!confirm(`Revoke B2B portal access for ${u.email}?`)) return;
    setUserBusyId(u.id);
    setPortalError('');
    try {
      let res = await fetch(
        `/api/rental/customers/${portalCustomer.id}/portal-users?userId=${encodeURIComponent(u.id)}`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: u.id, id: u.id }),
        }
      );
      if (res.status === 404 || res.status === 405) {
        res = await fetch(
          `/api/rental/customers/${portalCustomer.id}/portal-users/${encodeURIComponent(u.id)}`,
          { method: 'DELETE' }
        );
      }
      const json = await res.json().catch(() => ({}));
      if (res.status === 403) {
        setPortalError(
          `Requires RAC Manager permission (403): ${String(
            json?.error ?? 'Cannot remove B2B portal user.'
          )}`
        );
        return;
      }
      if (!res.ok) {
        setPortalError(String(json?.error ?? 'Failed to remove portal user'));
        return;
      }
      fetchPortalUsers(portalCustomer.id);
    } catch {
      setPortalError('Failed to remove portal user');
    } finally {
      setUserBusyId(null);
    }
  };

  const copySetupLink = async () => {
    if (!generatedSetupLink) return;
    try {
      await navigator.clipboard.writeText(generatedSetupLink);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      /* fallback ignored */
    }
  };

  const filtered = customers.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.fullName.toLowerCase().includes(q) ||
      (c.companyName ?? '').toLowerCase().includes(q) ||
      (c.customerType ?? '').toLowerCase().includes(q) ||
      (c.emiratesId ?? '').toLowerCase().includes(q) ||
      (c.passportNo ?? '').toLowerCase().includes(q) ||
      (c.drivingLicenseNo ?? '').toLowerCase().includes(q) ||
      (c.internationalPermitNo ?? '').toLowerCase().includes(q) ||
      (c.email ?? '').toLowerCase().includes(q) ||
      (c.phone ?? '').includes(search)
    );
  });

  const focusedCustomer = focusedId ? customers.find((c) => c.id === focusedId) ?? null : null;
  const idpRequiredForForm = isTouristRequiringIdp(
    formData.visaType,
    formData.licenseIssuingCountry,
  );
  const driverAgeYears = computeAgeYears(formData.dateOfBirth);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[var(--text-muted)] animate-pulse">Loading customers...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)] mb-1">
            Customers &amp; Corporate B2B
          </h1>
          <p className="text-xs text-[var(--text-muted)]">
            {customers.length} registered customers · manage retail renters &amp; corporate{' '}
            <code className="text-teal-400">/rac-portal</code> self-service accounts
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/rac-portal"
            target="_blank"
            className="inline-flex items-center gap-1.5 rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-2.5 text-xs font-semibold text-violet-300 hover:bg-violet-500/20 transition-colors"
          >
            <Building2 className="w-3.5 h-3.5" />
            Open /rac-portal
            <ExternalLink className="w-3 h-3" />
          </Link>
          <button
            onClick={openNew}
            className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-2.5 text-sm font-medium text-white hover:opacity-90"
          >
            + New Customer
          </button>
        </div>
      </div>

      {focusedCustomer && (
        <div className="bg-teal-500/10 border border-teal-500/30 rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs text-teal-200">
            Highlighted customer:{' '}
            <strong className="text-teal-300">{focusedCustomer.fullName}</strong>
            {focusedCustomer.companyName ? ` (${focusedCustomer.companyName})` : ''}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => openEdit(focusedCustomer)}
              className="text-xs px-2.5 py-1 rounded-lg bg-teal-500/20 text-teal-300 border border-teal-500/30 hover:bg-teal-500/30"
            >
              Edit Customer
            </button>
            <button
              type="button"
              onClick={() => setFocusedId('')}
              className="text-xs text-teal-300/80 hover:text-teal-200 px-2 py-1"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {rbacError && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3.5 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-300">
                Requires RAC Manager Permission (403)
              </p>
              <p className="text-xs text-amber-200/80 mt-0.5">{rbacError}</p>
            </div>
          </div>
          <button
            onClick={() => setRbacError('')}
            className="text-amber-300/70 hover:text-amber-200 text-sm"
          >
            ✕
          </button>
        </div>
      )}

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm flex items-center justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-rose-300 hover:text-rose-200 text-xs">
            ✕
          </button>
        </div>
      )}

      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search by customer name, Emirates ID, passport, license, email or phone..."
        className="w-full max-w-md px-4 py-2 rounded-lg bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-emerald-500 focus:outline-none text-sm"
      />

      <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6 backdrop-blur-sm overflow-x-auto">
        {filtered.length === 0 ? (
          <div className="text-center text-[var(--text-muted)] py-12">No customers found</div>
        ) : (
          <table className="w-full min-w-[960px]">
            <thead>
              <tr className="border-b border-[var(--border-subtle)]">
                <th className="px-4 py-3 text-left text-xs uppercase font-semibold text-[var(--text-muted)]">
                  Customer / Company
                </th>
                <th className="px-4 py-3 text-left text-xs uppercase font-semibold text-[var(--text-muted)]">
                  Nationality / Visa
                </th>
                <th className="px-4 py-3 text-left text-xs uppercase font-semibold text-[var(--text-muted)]">
                  Emirates ID / Passport
                </th>
                <th className="px-4 py-3 text-left text-xs uppercase font-semibold text-[var(--text-muted)]">
                  License / IDP
                </th>
                <th className="px-4 py-3 text-left text-xs uppercase font-semibold text-[var(--text-muted)]">
                  License Expiry
                </th>
                <th className="px-4 py-3 text-left text-xs uppercase font-semibold text-[var(--text-muted)]">
                  Contact
                </th>
                <th className="px-4 py-3 text-left text-xs uppercase font-semibold text-[var(--text-muted)]">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs uppercase font-semibold text-[var(--text-muted)]">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const resolvedType = (
                  c.customerType ||
                  (c.companyName && c.companyName.trim() ? 'CORPORATE' : 'INDIVIDUAL')
                ).toUpperCase();
                const isTourist = String(c.visaType ?? '').toUpperCase() === 'TOURIST';
                const isFocused = focusedId === c.id;
                return (
                  <tr
                    id={`customer-row-${c.id}`}
                    key={c.id}
                    className={`border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] transition-colors ${
                      isFocused ? 'bg-teal-500/10 ring-1 ring-inset ring-teal-500/40' : ''
                    }`}
                  >
                    <td className="px-4 py-4 text-sm font-medium text-[var(--text-main)]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span>{c.fullName}</span>
                        {resolvedType !== 'INDIVIDUAL' && (
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                              CUSTOMER_TYPE_BADGE[resolvedType] ??
                              'bg-violet-500/20 text-violet-300 border-violet-500/30'
                            }`}
                          >
                            {resolvedType.replace(/_/g, ' ')}
                          </span>
                        )}
                      </div>
                      {c.companyName && (
                        <div className="text-xs text-[var(--text-muted)] mt-0.5">
                          {c.companyName}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-4 text-sm text-[var(--text-main)]">
                      <div>{c.nationality || '—'}</div>
                      <span
                        className={`inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-semibold border ${
                          isTourist
                            ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                            : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                        }`}
                      >
                        {isTourist ? 'Tourist' : 'UAE Resident'}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm font-mono text-[var(--text-main)] space-y-0.5">
                      {c.emiratesId && (
                        <div className="text-xs text-emerald-300" title="UAE Emirates ID">
                          EID: {c.emiratesId}
                        </div>
                      )}
                      {c.passportNo && (
                        <div className="text-xs text-[var(--text-main)]" title="Passport Number">
                          PP: {c.passportNo}
                        </div>
                      )}
                      {!c.emiratesId && !c.passportNo && '—'}
                    </td>
                    <td className="px-4 py-4 text-sm font-mono text-[var(--text-main)] space-y-0.5">
                      <div>
                        {c.drivingLicenseNo || '—'}
                        {c.licenseIssuingCountry ? (
                          <span className="ml-1.5 text-[10px] font-sans px-1.5 py-0.5 rounded bg-[var(--bg-surface-hover)] text-[var(--text-muted)]">
                            {c.licenseIssuingCountry}
                          </span>
                        ) : null}
                      </div>
                      {c.internationalPermitNo && (
                        <div className="text-[11px] text-amber-300">
                          IDP: {c.internationalPermitNo}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-4 text-sm text-[var(--text-main)]">
                      {c.licenseExpiry ? new Date(c.licenseExpiry).toLocaleDateString('en-GB') : '—'}
                    </td>
                    <td className="px-4 py-4 text-sm text-[var(--text-main)]">
                      <div>{c.phone || '—'}</div>
                      <div className="text-[var(--text-muted)] text-xs">{c.email ?? ''}</div>
                    </td>
                    <td className="px-4 py-4">
                      {c.blacklisted ? (
                        <span className="px-3 py-1 rounded-full text-xs font-medium bg-rose-500/20 text-rose-400 border border-rose-500/30">
                          Blacklisted
                        </span>
                      ) : (
                        <span className="px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex gap-2 flex-wrap">
                        <button
                          onClick={() => openPortalModal(c)}
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-violet-500/20 text-violet-300 border border-violet-500/30 hover:bg-violet-500/30 font-medium transition-colors"
                        >
                          <KeyRound className="w-3 h-3" />
                          B2B Portal Access
                        </button>
                        <button
                          onClick={() => openEdit(c)}
                          className="text-xs px-2.5 py-1.5 rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleBlacklist(c)}
                          className={`text-xs px-2.5 py-1.5 rounded-lg border ${
                            c.blacklisted
                              ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                              : 'bg-rose-500/20 text-rose-400 border-rose-500/30'
                          } hover:opacity-80`}
                        >
                          {c.blacklisted ? 'Unblock' : 'Blacklist'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── CREATE / EDIT CUSTOMER MODAL ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-8 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-2xl font-bold text-[var(--text-main)]">
                  {editCustomer ? 'Edit Customer & UAE KYC' : 'New Customer & UAE KYC'}
                </h2>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  RTA / MoI Tarrashud compliant KYC profile · Emirates ID, Passport, License &amp; IDP
                </p>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)]"
              >
                ✕
              </button>
            </div>

            {modalError && (
              <div className="mb-4 rounded-xl bg-rose-500/10 border border-rose-500/30 px-4 py-3 text-xs text-rose-300">
                {modalError}
              </div>
            )}

            {/* 1-Click Multimodal AI OCR Scanner Panel */}
            <div className="mb-5 rounded-xl border border-teal-500/30 bg-teal-500/10 p-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-teal-300 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-teal-200">
                      Multimodal AI Document KYC Scanner
                    </p>
                    <p className="text-[11px] text-teal-200/75">
                      Upload PNG, JPEG, WEBP, or PDF to auto-extract Emirates ID, Passport, Driving License, or IDP fields
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    value={kycDocType}
                    onChange={(e) => setKycDocType(e.target.value as KycDocTypeOption)}
                    disabled={kycScanning}
                    className="px-3 py-1.5 rounded-lg bg-black/30 border border-teal-500/30 text-xs text-teal-100 focus:border-teal-400 focus:outline-none"
                  >
                    <option value="EMIRATES_ID">Emirates ID (784-...)</option>
                    <option value="PASSPORT">Passport (ICAO MRZ)</option>
                    <option value="DRIVING_LICENSE">Driving License</option>
                    <option value="INTERNATIONAL_DRIVING_PERMIT">International Permit (IDP)</option>
                  </select>
                  <input
                    ref={kycFileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,application/pdf"
                    onChange={handleKycFileSelected}
                    className="hidden"
                  />
                  <button
                    type="button"
                    disabled={kycScanning}
                    onClick={() => kycFileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    <ScanLine className="w-3.5 h-3.5" />
                    {kycScanning
                      ? 'Scanning Document…'
                      : 'Scan EID / Passport / License (AI OCR)'}
                  </button>
                </div>
              </div>

              {kycBanner && (
                <div
                  className={`rounded-lg border px-3 py-2 text-xs ${
                    kycBanner.isExpired || kycBanner.warnings.length > 0
                      ? 'bg-amber-500/15 border-amber-500/30 text-amber-200'
                      : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-200'
                  }`}
                >
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span>
                      Extracted <strong>{kycBanner.documentNumber}</strong> via{' '}
                      <code className="text-[11px]">{kycBanner.provider}</code> (
                      {Math.round(kycBanner.confidence * 100)}% confidence) — review fields below and click{' '}
                      {editCustomer ? 'Update' : 'Create'}.
                    </span>
                    {kycBanner.isExpired && (
                      <span className="px-2 py-0.5 rounded bg-rose-500/30 text-rose-200 font-semibold text-[11px]">
                        EXPIRED DOCUMENT
                      </span>
                    )}
                  </div>
                  {kycBanner.warnings.length > 0 && (
                    <ul className="mt-1.5 list-disc list-inside text-[11px] opacity-90 space-y-0.5">
                      {kycBanner.warnings.map((w, idx) => (
                        <li key={idx}>{w}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* UAE Residency / Visa Status Toggle */}
              <div className="flex items-center justify-between flex-wrap gap-3 rounded-xl bg-[var(--bg-surface-hover)]/50 border border-[var(--border-subtle)] px-4 py-3">
                <div>
                  <span className="text-xs font-semibold text-[var(--text-main)]">
                    UAE Residency / Visa Classification
                  </span>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Residents require UAE Emirates ID + UAE Driving License; Tourists require Passport + Home License (+ IDP if non-exempt)
                  </p>
                </div>
                <div className="inline-flex rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1">
                  <button
                    type="button"
                    onClick={() => setFormData((p) => ({ ...p, visaType: 'RESIDENT' }))}
                    className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                      formData.visaType === 'RESIDENT'
                        ? 'bg-emerald-600 text-white'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                    }`}
                  >
                    UAE Resident
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData((p) => ({ ...p, visaType: 'TOURIST' }))}
                    className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                      formData.visaType === 'TOURIST'
                        ? 'bg-sky-600 text-white'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                    }`}
                  >
                    Tourist / Visitor
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-1.5">
                    Customer Type
                  </label>
                  <select
                    value={formData.customerType}
                    onChange={e => setFormData(p => ({ ...p, customerType: e.target.value }))}
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-emerald-500 focus:outline-none text-sm"
                  >
                    {CUSTOMER_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-1.5">
                    Company Name {formData.customerType === 'CORPORATE' ? '*' : '(Optional)'}
                  </label>
                  <input
                    type="text"
                    value={formData.companyName}
                    onChange={e => setFormData(p => ({ ...p, companyName: e.target.value }))}
                    placeholder="e.g. Emirates Logistics LLC"
                    required={formData.customerType === 'CORPORATE'}
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-emerald-500 focus:outline-none text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-1.5">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.fullName}
                    onChange={e => setFormData(p => ({ ...p, fullName: e.target.value }))}
                    placeholder="Ahmed Al-Mansouri"
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-emerald-500 focus:outline-none text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-1.5">
                    Nationality
                  </label>
                  <input
                    type="text"
                    value={formData.nationality}
                    onChange={e => setFormData(p => ({ ...p, nationality: e.target.value }))}
                    placeholder="ARE / GBR / IND"
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-emerald-500 focus:outline-none text-sm"
                  />
                </div>

                <div>
                  <label className="flex items-center justify-between text-sm font-medium text-[var(--text-muted)] mb-1.5">
                    <span>Date of Birth</span>
                    {driverAgeYears !== null && (
                      <span
                        className={`text-[11px] font-semibold ${
                          driverAgeYears < 21
                            ? 'text-rose-400'
                            : driverAgeYears < 25
                              ? 'text-amber-300'
                              : 'text-emerald-400'
                        }`}
                      >
                        Age {driverAgeYears} yrs
                        {driverAgeYears < 21
                          ? ' (Under 21 min)'
                          : driverAgeYears < 25
                            ? ' (Standard OK · Luxury 25+)'
                            : ''}
                      </span>
                    )}
                  </label>
                  <input
                    type="date"
                    value={formData.dateOfBirth}
                    onChange={e => setFormData(p => ({ ...p, dateOfBirth: e.target.value }))}
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-emerald-500 focus:outline-none text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-1.5">
                    Phone
                  </label>
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))}
                    placeholder="+971 50 000 0000"
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-emerald-500 focus:outline-none text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-1.5">
                    Emirates ID {formData.visaType === 'RESIDENT' ? '(UAE Resident)' : '(Optional)'}
                  </label>
                  <input
                    type="text"
                    value={formData.emiratesId}
                    onChange={e => setFormData(p => ({ ...p, emiratesId: e.target.value }))}
                    placeholder="784-1990-1234567-1"
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono placeholder-[var(--text-faint)] focus:border-emerald-500 focus:outline-none text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-1.5">
                    Emirates ID Expiry
                  </label>
                  <input
                    type="date"
                    value={formData.emiratesIdExpiry}
                    onChange={e => setFormData(p => ({ ...p, emiratesIdExpiry: e.target.value }))}
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-emerald-500 focus:outline-none text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-1.5">
                    Passport Number {formData.visaType === 'TOURIST' ? '(Tourist)' : ''}
                  </label>
                  <input
                    type="text"
                    value={formData.passportNo}
                    onChange={e => setFormData(p => ({ ...p, passportNo: e.target.value }))}
                    placeholder="A12345678"
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono placeholder-[var(--text-faint)] focus:border-emerald-500 focus:outline-none text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-1.5">
                    Passport Expiry
                  </label>
                  <input
                    type="date"
                    value={formData.passportExpiry}
                    onChange={e => setFormData(p => ({ ...p, passportExpiry: e.target.value }))}
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-emerald-500 focus:outline-none text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-1.5">
                    Driving License No.
                  </label>
                  <input
                    type="text"
                    value={formData.drivingLicenseNo}
                    onChange={e => setFormData(p => ({ ...p, drivingLicenseNo: e.target.value }))}
                    placeholder="DL-00000"
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono placeholder-[var(--text-faint)] focus:border-emerald-500 focus:outline-none text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-1.5">
                    License Issuing Country
                  </label>
                  <input
                    type="text"
                    value={formData.licenseIssuingCountry}
                    onChange={e =>
                      setFormData(p => ({ ...p, licenseIssuingCountry: e.target.value }))
                    }
                    placeholder={formData.visaType === 'RESIDENT' ? 'UAE' : 'e.g. GBR, IND, EGY'}
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-emerald-500 focus:outline-none text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-1.5">
                    License Issue Date
                  </label>
                  <input
                    type="date"
                    value={formData.licenseIssueDate}
                    onChange={e => setFormData(p => ({ ...p, licenseIssueDate: e.target.value }))}
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-emerald-500 focus:outline-none text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-1.5">
                    License Expiry
                  </label>
                  <input
                    type="date"
                    value={formData.licenseExpiry}
                    onChange={e => setFormData(p => ({ ...p, licenseExpiry: e.target.value }))}
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-emerald-500 focus:outline-none text-sm"
                  />
                </div>

                {/* International Driving Permit (IDP) Section — auto-highlighted when Tourist from non-exempt country */}
                <div
                  className={`sm:col-span-2 rounded-xl p-4 transition-colors ${
                    idpRequiredForForm
                      ? 'bg-amber-500/10 border border-amber-500/40 ring-1 ring-amber-500/30'
                      : 'bg-[var(--bg-surface-hover)]/35 border border-[var(--border-subtle)]'
                  }`}
                >
                  {idpRequiredForForm && (
                    <div className="mb-3 flex items-start gap-2 text-xs text-amber-200">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <span>
                        <strong>UAE RTA Mandatory IDP Rule:</strong> Driving license issued in{' '}
                        <code className="font-semibold">{formData.licenseIssuingCountry}</code> is
                        not on the UAE bilateral exemption list for Tourists. A valid International
                        Driving Permit (IDP) is required before vehicle dispatch.
                      </span>
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-[var(--text-muted)] mb-1.5">
                        International Driving Permit (IDP) No.{' '}
                        {idpRequiredForForm ? '(Required for Dispatch)' : '(Optional)'}
                      </label>
                      <input
                        type="text"
                        value={formData.internationalPermitNo}
                        onChange={e =>
                          setFormData(p => ({ ...p, internationalPermitNo: e.target.value }))
                        }
                        placeholder="IDP-2026-000000"
                        className={`w-full px-4 py-2 rounded-lg bg-[var(--bg-surface)] border text-[var(--text-main)] font-mono placeholder-[var(--text-faint)] focus:outline-none text-sm ${
                          idpRequiredForForm && !formData.internationalPermitNo.trim()
                            ? 'border-amber-500/60 focus:border-amber-400'
                            : 'border-[var(--border-subtle)] focus:border-emerald-500'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[var(--text-muted)] mb-1.5">
                        IDP Expiry Date
                      </label>
                      <input
                        type="date"
                        value={formData.internationalPermitExpiry}
                        onChange={e =>
                          setFormData(p => ({ ...p, internationalPermitExpiry: e.target.value }))
                        }
                        className={`w-full px-4 py-2 rounded-lg bg-[var(--bg-surface)] border text-[var(--text-main)] focus:outline-none text-sm ${
                          idpRequiredForForm && !formData.internationalPermitExpiry
                            ? 'border-amber-500/60 focus:border-amber-400'
                            : 'border-[var(--border-subtle)] focus:border-emerald-500'
                        }`}
                      />
                    </div>
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-1.5">
                    Email
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={e => setFormData(p => ({ ...p, email: e.target.value }))}
                    placeholder="customer@company.ae"
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-emerald-500 focus:outline-none text-sm"
                  />
                </div>

                <div className="flex items-center gap-3 sm:col-span-2 pt-1">
                  <input
                    type="checkbox"
                    id="blacklisted"
                    checked={formData.blacklisted}
                    onChange={e => setFormData(p => ({ ...p, blacklisted: e.target.checked }))}
                    className="w-4 h-4 rounded accent-rose-500 text-[var(--text-main)]"
                  />
                  <label htmlFor="blacklisted" className="text-sm text-[var(--text-muted)]">
                    Mark as Blacklisted
                  </label>
                </div>
              </div>
              <div className="flex gap-4 justify-end pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-6 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:opacity-90 disabled:opacity-50 text-sm font-semibold"
                >
                  {saving ? 'Saving...' : editCustomer ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── CORPORATE B2B PORTAL ACCESS MODAL ── */}
      {portalCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl">
            {/* Header */}
            <div className="sticky top-0 z-10 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] px-7 py-5 flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-violet-400" />
                  <h2 className="text-xl font-bold text-[var(--text-main)]">
                    Corporate B2B Portal Access
                  </h2>
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Customer:{' '}
                  <span className="font-semibold text-[var(--text-main)]">
                    {portalCustomer.companyName || portalCustomer.fullName}
                  </span>{' '}
                  · Isolated corporate fleet &amp; invoice portal (
                  <code className="text-violet-300">/rac-portal</code>)
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Link
                  href="/rac-portal"
                  target="_blank"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-violet-500/15 border border-violet-500/30 px-3 py-1.5 text-xs font-semibold text-violet-300 hover:bg-violet-500/25 transition-colors"
                >
                  Open /rac-portal
                  <ExternalLink className="w-3 h-3" />
                </Link>
                <button
                  onClick={() => setPortalCustomer(null)}
                  className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-xl leading-none"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="p-7 space-y-6">
              {portalError && (
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-4 py-3 text-xs text-amber-300 flex items-start gap-2.5">
                  <ShieldAlert className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
                  <span>{portalError}</span>
                </div>
              )}

              {/* One-time Invitation Setup Link Banner */}
              {generatedSetupLink && (
                <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-4 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <p className="text-sm font-semibold text-emerald-300">
                        One-Time Portal Invitation Created
                      </p>
                      <p className="text-xs text-emerald-200/80 mt-0.5">
                        Share this setup link with{' '}
                        <span className="font-mono font-semibold">{invitedEmail}</span> to set their
                        password and sign in at <code>/rac-portal</code>.
                      </p>
                    </div>
                    <Link
                      href="/rac-portal"
                      target="_blank"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-300 hover:text-emerald-200 underline"
                    >
                      Open /rac-portal
                      <ExternalLink className="w-3 h-3" />
                    </Link>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      readOnly
                      value={generatedSetupLink}
                      className="flex-1 px-3 py-2 rounded-lg bg-black/30 border border-emerald-500/30 text-xs font-mono text-emerald-200 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={copySetupLink}
                      className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors shrink-0"
                    >
                      {copiedLink ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          Copy Setup Link
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Invite New Corporate Portal User Form */}
              <form
                onSubmit={handleInvitePortalUser}
                className="bg-[var(--bg-surface-hover)]/40 border border-[var(--border-subtle)] rounded-xl p-5 space-y-4"
              >
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-main)]">
                  <UserPlus className="w-4 h-4 text-violet-400" />
                  <span>Invite Corporate Portal User</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">
                      Work Email *
                    </label>
                    <input
                      type="email"
                      required
                      value={inviteForm.email}
                      onChange={e => setInviteForm(p => ({ ...p, email: e.target.value }))}
                      placeholder="fleet.manager@company.ae"
                      className="w-full px-3.5 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-sm focus:border-violet-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">
                      Full Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={inviteForm.fullName}
                      onChange={e => setInviteForm(p => ({ ...p, fullName: e.target.value }))}
                      placeholder="Authorized Fleet Coordinator"
                      className="w-full px-3.5 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-sm focus:border-violet-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">Phone</label>
                    <input
                      type="text"
                      value={inviteForm.phone}
                      onChange={e => setInviteForm(p => ({ ...p, phone: e.target.value }))}
                      placeholder="+971 50 000 0000"
                      className="w-full px-3.5 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-sm focus:border-violet-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">
                      Portal Role *
                    </label>
                    <select
                      value={inviteForm.role}
                      onChange={e =>
                        setInviteForm(p => ({
                          ...p,
                          role: e.target.value as 'RAC_B2B_ADMIN' | 'RAC_B2B_USER',
                        }))
                      }
                      className="w-full px-3.5 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-sm focus:border-violet-500 focus:outline-none"
                    >
                      <option value="RAC_B2B_ADMIN">
                        RAC_B2B_ADMIN — Corporate Fleet Admin (Bookings, Extensions &amp; Invoices)
                      </option>
                      <option value="RAC_B2B_USER">
                        RAC_B2B_USER — Standard Corporate Booker
                      </option>
                    </select>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={inviteBusy}
                    className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-2.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    {inviteBusy ? 'Generating Invite…' : 'Generate Invite Setup Link'}
                  </button>
                </div>
              </form>

              {/* Existing Portal Users List */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    Provisioned Portal Users ({portalUsers.length})
                  </h3>
                </div>

                {portalLoading ? (
                  <div className="text-center py-8 text-sm text-[var(--text-muted)] animate-pulse">
                    Loading portal users…
                  </div>
                ) : portalUsers.length === 0 ? (
                  <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-hover)]/20 p-8 text-center text-xs text-[var(--text-muted)]">
                    No B2B portal users provisioned for this customer yet. Use the form above to
                    generate an invitation link.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
                    <table className="w-full text-xs">
                      <thead className="bg-[var(--bg-surface-hover)]/40 border-b border-[var(--border-subtle)]">
                        <tr className="text-left text-[var(--text-muted)]">
                          <th className="px-4 py-2.5">User</th>
                          <th className="px-4 py-2.5">Role</th>
                          <th className="px-4 py-2.5">Auth Setup</th>
                          <th className="px-4 py-2.5">Last Login</th>
                          <th className="px-4 py-2.5">Status</th>
                          <th className="px-4 py-2.5 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {portalUsers.map(u => {
                          const busy = userBusyId === u.id;
                          return (
                            <tr
                              key={u.id}
                              className="border-b border-[var(--border-subtle)] last:border-b-0"
                            >
                              <td className="px-4 py-3">
                                <div className="font-semibold text-[var(--text-main)]">
                                  {u.fullName || '—'}
                                </div>
                                <div className="font-mono text-[var(--text-muted)]">{u.email}</div>
                              </td>
                              <td className="px-4 py-3">
                                <span className="px-2 py-0.5 rounded bg-violet-500/15 text-violet-300 border border-violet-500/30 font-mono text-[11px]">
                                  {u.role}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                {u.hasPassword ? (
                                  <span className="text-emerald-400 font-medium">Password Set</span>
                                ) : (
                                  <span className="text-amber-400">Invite Pending</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-[var(--text-muted)]">
                                {fmtDateTime(u.lastLoginAt)}
                              </td>
                              <td className="px-4 py-3">
                                {u.isActive ? (
                                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-medium">
                                    Active
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 font-medium">
                                    Suspended
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => handleTogglePortalUser(u)}
                                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border font-medium transition-colors disabled:opacity-40 ${
                                      u.isActive
                                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/30 hover:bg-amber-500/25'
                                        : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25'
                                    }`}
                                  >
                                    <Power className="w-3 h-3" />
                                    {u.isActive ? 'Suspend' : 'Activate'}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => handleRemovePortalUser(u)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500/25 font-medium transition-colors disabled:opacity-40"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                    Remove
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CustomersPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-64">
          <div className="text-[var(--text-muted)] animate-pulse">Loading customers...</div>
        </div>
      }
    >
      <CustomersPageInner />
    </Suspense>
  );
}
