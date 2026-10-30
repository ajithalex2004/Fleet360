'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Sparkles,
  Upload,
  FileText,
  Lock,
  Eye,
  EyeOff,
  Search,
  Check,
  ArrowRight,
  ChevronDown,
  Truck,
  Car,
  Bus,
  Bike,
  AlertCircle,
  X,
  CreditCard,
  User,
  Plus,
  Trash2,
  FileCheck,
  Loader2,
  MoreVertical,
  Edit2,
  Phone,
} from 'lucide-react';
import PhoneInput from '@/components/ui/PhoneInput';
import PhoneCell from '@/components/ui/PhoneCell';
import { validatePasswordPolicy } from '@/lib/password-policy';
import { COUNTRIES } from '@/lib/phone-format';

// ── Types ───────────────────────────────────────────────────────────────────

export interface DriverAdditionalDocument {
  id: string;
  name: string;
  documentType: string; // 'PASSPORT' | 'VISA' | 'RTA_PERMIT' | 'CIVIL_DEFENSE' | 'OTHER'
  documentNumber: string;
  issuingAuthority: string;
  issueDate?: string;
  expiryDate: string;
  fileName?: string;
  fileData?: string;
  autofilled?: boolean;
  confidence?: number;
}

/** A staff record as /api/bus-ops/staff returns it (the fields read here). */
interface StaffApiRow {
  id: string;
  employeeId?: string | null;
  name?: string | null;
  department?: string | null;
  contactNumber?: string | null;
  email?: string | null;
}

export interface Driver {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  contactNumber: string | null;
  nationality: string | null;
  dob: string | null;
  employeeId?: string | null;
  driverCategory?: string | null;
  licenseNumber: string;
  licenseExpiry: string | null;
  licenseType: string | null;
  issuingAuthority?: string | null;
  emiratesId: string | null;
  emiratesIdExpiry: string | null;
  emiratesIdIssuingAuthority?: string | null;
  passportNumber: string | null;
  passportExpiry: string | null;
  visaExpiry: string | null;
  additionalDocuments?: DriverAdditionalDocument[];
  status: string;
  driverType: string | null;
  hierarchy: string | null;
  communicationLanguage: string | null;
  dateOfJoin: string | null;
  dallasId: string | null;
  garageId: string | null;
  linkedUser?: {
    id: string;
    username: string;
    email: string;
  } | null;
  compliance: {
    license: string;
    emiratesId: string;
    passport: string;
    visa: string;
    alertLevel: string;
    hasIssues: boolean;
  };
}

interface StaffOption {
  id: string;
  employeeId: string;
  name: string;
  department?: string | null;
  contactNumber?: string | null;
  email?: string | null;
}

// ── Constants & Lookups ─────────────────────────────────────────────────────

const STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'ON_LEAVE'];
const DRIVER_TYPES = ['RENTAL', 'STAFF', 'SCHOOL_BUS', 'LOGISTICS', 'AMBULANCE', 'POOL'];

const DRIVER_CATEGORIES = [
  { key: 'LIGHT_DUTY',  label: 'Light Duty (Car / Light Vehicle)',       short: 'Light Duty',   icon: Car,   badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  { key: 'HEAVY_DUTY',  label: 'Heavy Duty (Heavy Truck / Trailer)',      short: 'Heavy Duty',   icon: Truck, badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  { key: 'HEAVY_BUS',   label: 'Heavy Bus (Coach / 50+ Seater)',         short: 'Heavy Bus',    icon: Bus,   badge: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30' },
  { key: 'LIGHT_BUS',   label: 'Light Bus (Minibus / 14-30 Seater)',     short: 'Light Bus',    icon: Bus,   badge: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30' },
  { key: 'MOTORCYCLE',  label: 'Motorcycle / Courier Delivery',           short: 'Motorcycle',   icon: Bike,  badge: 'bg-rose-500/15 text-rose-400 border-rose-500/30' },
  { key: 'FORKLIFT',    label: 'Special Equipment / Forklift Operator',   short: 'Forklift',     icon: Truck, badge: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' },
];

const PREDEFINED_DALLAS_IDS = [
  'DAL-00101', 'DAL-00102', 'DAL-00103', 'DAL-00104', 'DAL-00105',
  'DAL-00201', 'DAL-00202', 'DAL-00203', 'DAL-00204', 'DAL-00205',
  'RFID-9001', 'RFID-9002', 'RFID-9003', 'RFID-9004', 'RFID-9005',
  'IBTN-3011', 'IBTN-3012', 'IBTN-3013', 'IBTN-3014', 'IBTN-3015',
];

const DEFAULT_HIERARCHIES = [
  'Abu Dhabi / Transport Operations',
  'Abu Dhabi / Corporate Logistics',
  'Dubai / Central Fleet Division',
  'Dubai / School Bus Operations',
  'Sharjah / Commercial Logistics',
  'Northern Emirates / Field Fleet',
  'Muscat / Regional Fleet Services',
  'Salalah / Transit Operations',
];

const DEFAULT_DRIVER_ADDITIONAL_DOCS: DriverAdditionalDocument[] = [
  { id: 'doc-passport', name: 'Passport (Travel Document)', documentType: 'PASSPORT', documentNumber: '', issuingAuthority: 'Immigration / Embassy', expiryDate: '' },
  { id: 'doc-visa',     name: 'Residency Visa',              documentType: 'VISA',     documentNumber: '', issuingAuthority: 'GDRFA / ICP',           expiryDate: '' },
];

const statusColor: Record<string, string> = {
  ACTIVE:    'bg-green-500/20 text-green-400 border border-green-500/30',
  INACTIVE:  'bg-slate-500/20 text-[var(--text-muted)] border border-slate-500/30',
  SUSPENDED: 'bg-red-500/20 text-red-400 border border-red-500/30',
  ON_LEAVE:  'bg-amber-500/20 text-amber-400 border border-amber-500/30',
};

const docIcon: Record<string, string> = {
  valid:         '✓',
  expiring_soon: '⚠',
  expired:       '✗',
  missing:       '—',
};

const docCls: Record<string, string> = {
  valid:         'text-emerald-400',
  expiring_soon: 'text-amber-400',
  expired:       'text-rose-400',
  missing:       'text-[var(--text-faint)]',
};

const EMPTY_FORM: Partial<Driver> & { password?: string; confirmPassword?: string } = {
  name: '', firstName: '', lastName: '', email: '', contactNumber: '', nationality: '',
  licenseNumber: '', driverCategory: 'LIGHT_DUTY', licenseType: 'LIGHT_DUTY',
  issuingAuthority: 'RTA / Police Licensing',
  status: 'ACTIVE', driverType: 'STAFF', communicationLanguage: 'English',
  hierarchy: '', employeeId: '', dallasId: '', password: '', confirmPassword: '',
  additionalDocuments: DEFAULT_DRIVER_ADDITIONAL_DOCS,
};

export default function DriverProfilesPage() {
  const [drivers, setDrivers]           = useState<Driver[]>([]);
  const [activeActionMenuId, setActiveActionMenuId] = useState<string | null>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-driver-actions]')) {
        setActiveActionMenuId(null);
      }
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, []);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [hierarchyList, setHierarchyList] = useState<string[]>(DEFAULT_HIERARCHIES);
  const [loading, setLoading]           = useState(true);
  const [search, setSearch]             = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [typeFilter, setTypeFilter]     = useState('');
  const [expiringOnly, setExpiringOnly] = useState(false);

  // Modal State
  const [showModal, setShowModal]       = useState(false);
  const [editing, setEditing]           = useState<Driver | null>(null);
  const [form, setForm]                 = useState<Partial<Driver> & { password?: string; confirmPassword?: string }>(EMPTY_FORM);
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState('');
  const [formError, setFormError]       = useState('');
  const [tab, setTab]                   = useState<'identity' | 'compliance'>('identity');

  // Password visibility
  const [showPassword, setShowPassword] = useState(false);

  // Autofill states
  const [scanningLicense, setScanningLicense] = useState(false);
  const [scanningDocId, setScanningDocId]     = useState<string | null>(null);
  const [scanSuccess, setScanSuccess]         = useState<string | null>(null);
  const [scanError, setScanError]             = useState<string | null>(null);

  // Searchable Dropdown popovers
  const [natOpen, setNatOpen]               = useState(false);
  const [natSearch, setNatSearch]           = useState('');
  const [hierOpen, setHierOpen]             = useState(false);
  const [hierSearch, setHierSearch]         = useState('');
  const [dallasOpen, setDallasOpen]         = useState(false);
  const [dallasSearch, setDallasSearch]     = useState('');
  const [empMode, setEmpMode]               = useState<'select' | 'manual'>('select');

  // ── Data Fetching ─────────────────────────────────────────────────────────

  const fetchDrivers = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search)       params.set('search', search);
    if (statusFilter) params.set('status', statusFilter);
    if (typeFilter)   params.set('driverType', typeFilter);
    if (expiringOnly) params.set('expiring', 'true');
    try {
      const res = await fetch('/api/drivers?' + params);
      const data = await res.json();
      setDrivers(Array.isArray(data) ? data : (data.data ?? []));
      setError('');
    } catch {
      setError('Failed to load drivers');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, typeFilter, expiringOnly]);

  const loadReferenceData = useCallback(async () => {
    try {
      // 1. Staff registry for employee IDs
      const sRes = await fetch('/api/bus-ops/staff?active=true').catch(() => null);
      if (sRes && sRes.ok) {
        const staffData = await sRes.json();
        if (Array.isArray(staffData)) {
          const validStaff = staffData
            .filter((s: StaffApiRow) => s.employeeId)
            .map((s: StaffApiRow) => ({
              id: s.id,
              employeeId: s.employeeId ?? '',
              name: s.name ?? '',
              department: s.department,
              contactNumber: s.contactNumber,
              email: s.email,
            }));
          setStaffOptions(validStaff);
        }
      }

      // 2. Customer hierarchy
      const hRes = await fetch('/api/customer-hierarchy?all=true').catch(() => null);
      if (hRes && hRes.ok) {
        const hData = await hRes.json();
        if (Array.isArray(hData) && hData.length > 0) {
          const names = Array.from(new Set(hData.map((h: { name?: string | null }) => h.name).filter((n): n is string => Boolean(n))));
          setHierarchyList(prev => Array.from(new Set([...names, ...prev])));
        }
      }
    } catch (e) {
      console.warn('Failed loading references:', e);
    }
  }, []);

  useEffect(() => {
    fetchDrivers();
    loadReferenceData();
  }, [fetchDrivers, loadReferenceData]);

  // ── Modal Actions ─────────────────────────────────────────────────────────

  const openNew = () => {
    setEditing(null);
    setForm({
      ...EMPTY_FORM,
      additionalDocuments: DEFAULT_DRIVER_ADDITIONAL_DOCS.map(d => ({ ...d })),
    });
    setTab('identity');
    setFormError('');
    setScanSuccess(null);
    setScanError(null);
    setEmpMode('select');
    setShowModal(true);
  };

  const openEdit = (d: Driver) => {
    setEditing(d);

    // Populate existing additional documents or fallback to defaults
    let docs = d.additionalDocuments;
    if (!docs || !Array.isArray(docs) || docs.length === 0) {
      docs = [
        {
          id: 'doc-passport',
          name: 'Passport (Travel Document)',
          documentType: 'PASSPORT',
          documentNumber: d.passportNumber ?? '',
          issuingAuthority: 'Immigration / Embassy',
          expiryDate: d.passportExpiry ? d.passportExpiry.slice(0, 10) : '',
        },
        {
          id: 'doc-visa',
          name: 'Residency Visa',
          documentType: 'VISA',
          documentNumber: '',
          issuingAuthority: 'GDRFA / ICP',
          expiryDate: d.visaExpiry ? d.visaExpiry.slice(0, 10) : '',
        },
      ];
    }

    setForm({
      ...d,
      driverCategory: d.driverCategory || d.licenseType || 'LIGHT_DUTY',
      issuingAuthority: d.issuingAuthority || 'RTA / Police Licensing',
      additionalDocuments: docs,
      password: '',
      confirmPassword: '',
    });
    setTab('identity');
    setFormError('');
    setScanSuccess(null);
    setScanError(null);
    setEmpMode(d.employeeId ? 'manual' : 'select');
    setShowModal(true);
  };

  const f = (k: keyof Driver | 'password' | 'confirmPassword', v: unknown) => {
    setForm(p => ({ ...p, [k]: v }));
  };

  // Additional Document helpers
  const addAdditionalDocument = () => {
    const newDoc: DriverAdditionalDocument = {
      id: `doc-${Date.now()}`,
      name: '',
      documentType: 'OTHER',
      documentNumber: '',
      issuingAuthority: '',
      expiryDate: '',
    };
    setForm(p => ({
      ...p,
      additionalDocuments: [...(p.additionalDocuments || []), newDoc],
    }));
  };

  const updateAdditionalDoc = (id: string, field: keyof DriverAdditionalDocument, val: string) => {
    setForm(prev => {
      const docs = [...(prev.additionalDocuments || [])];
      const idx = docs.findIndex(d => d.id === id);
      if (idx >= 0) {
        docs[idx] = { ...docs[idx], [field]: val };

        // Sync passport & visa back to driver root fields
        const upd: typeof prev = { ...prev, additionalDocuments: docs };
        if (docs[idx].documentType === 'PASSPORT') {
          if (field === 'documentNumber') upd.passportNumber = val;
          if (field === 'expiryDate')     upd.passportExpiry = val;
        } else if (docs[idx].documentType === 'VISA') {
          if (field === 'expiryDate')     upd.visaExpiry = val;
        }
        return upd;
      }
      return prev;
    });
  };

  const removeAdditionalDoc = (id: string) => {
    setForm(p => ({
      ...p,
      additionalDocuments: (p.additionalDocuments || []).filter(d => d.id !== id),
    }));
  };

  const handleSave = async () => {
    if (!form.name?.trim() && !form.firstName?.trim()) {
      setTab('identity');
      setFormError('Driver name is required');
      return;
    }
    if (!form.licenseNumber?.trim()) {
      setTab('compliance');
      setFormError('License number is required. Please enter or scan driving license.');
      return;
    }

    if (form.password) {
      const pwCheck = validatePasswordPolicy(form.password);
      if (!pwCheck.ok) {
        setTab('identity');
        setFormError('Password policy requirement: ' + pwCheck.error);
        return;
      }
      if (form.confirmPassword && form.password !== form.confirmPassword) {
        setTab('identity');
        setFormError('Passwords do not match');
        return;
      }
    }

    setSaving(true);
    setFormError('');

    try {
      const url    = editing ? `/api/drivers/${editing.id}` : '/api/drivers';
      const method = editing ? 'PATCH' : 'POST';

      // Pull passport and visa from additional documents if present
      const pDoc = (form.additionalDocuments || []).find(d => d.documentType === 'PASSPORT');
      const vDoc = (form.additionalDocuments || []).find(d => d.documentType === 'VISA');

      const payload = {
        ...form,
        passportNumber: pDoc?.documentNumber || form.passportNumber || null,
        passportExpiry: pDoc?.expiryDate || form.passportExpiry || null,
        visaExpiry:     vDoc?.expiryDate || form.visaExpiry || null,
        driverCategory: form.driverCategory || 'LIGHT_DUTY',
        licenseType:    form.driverCategory || 'LIGHT_DUTY',
      };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setFormError(d.error ?? d.message ?? 'Save failed');
        return;
      }

      setShowModal(false);
      fetchDrivers();
    } catch {
      setFormError('Network error while saving driver');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (id: string) => {
    if (!confirm('Deactivate this driver? Status will be set to INACTIVE.')) return;
    await fetch(`/api/drivers/${id}`, { method: 'DELETE' });
    fetchDrivers();
  };

  // ── Driving License Autofill ──────────────────────────────────────────────

  const handleLicenseFileUpload = async (file: File) => {
    setScanningLicense(true);
    setScanError(null);
    setScanSuccess(null);

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const dataUrl = e.target?.result as string;
          const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;

          const res = await fetch('/api/drivers/autofill-license', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              base64,
              mimeType: file.type || 'image/jpeg',
              fileName: file.name,
            }),
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Failed to scan Driving License');
          }

          const data = await res.json();
          if (data.status === 'unavailable') {
            setScanError(data.message || 'AI document reader unavailable');
            return;
          }
          if (data.status === 'error') {
            setScanError(data.message || 'Failed to extract Driving License details');
            return;
          }

          const populated: string[] = [];
          if (data.licenseNumber)    populated.push(`License: ${data.licenseNumber}`);
          if (data.fullName)         populated.push(`Name: ${data.fullName}`);
          if (data.nationality)      populated.push(`Nationality: ${data.nationality}`);
          if (data.licenseExpiry)    populated.push(`Expiry: ${data.licenseExpiry}`);
          if (data.dob)              populated.push(`DOB: ${data.dob}`);
          if (data.driverCategory)   populated.push(`Category: ${data.driverCategory}`);
          if (data.issuingAuthority) populated.push(`Authority: ${data.issuingAuthority}`);

          setForm(prev => ({
            ...prev,
            licenseNumber: data.licenseNumber || prev.licenseNumber,
            name: data.fullName || prev.name,
            firstName: data.firstName || prev.firstName,
            lastName: data.lastName || prev.lastName,
            nationality: data.nationality || prev.nationality,
            dob: data.dob || prev.dob,
            licenseExpiry: data.licenseExpiry || prev.licenseExpiry,
            driverCategory: data.driverCategory || prev.driverCategory || 'LIGHT_DUTY',
            licenseType: data.licenseType || prev.licenseType || 'LIGHT_DUTY',
            issuingAuthority: data.issuingAuthority || prev.issuingAuthority || 'RTA / Police Licensing',
          }));

          const conf = Math.round((data.confidence || 0.95) * 100);
          setScanSuccess(`✓ Driving License scanned: ${populated.length} fields autofilled (${conf}% confidence).`);
        } catch (err) {
          setScanError(err instanceof Error ? err.message : 'Error processing license file');
        } finally {
          setScanningLicense(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Failed to read file');
      setScanningLicense(false);
    }
  };

  // ── Document & Permit Autofill ────────────────────────────────────────────

  const handleDocumentFileUpload = async (file: File, docId?: string, hint = 'PERMIT') => {
    setScanningDocId(docId || 'general');
    setScanError(null);
    setScanSuccess(null);

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const dataUrl = e.target?.result as string;
          const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;

          const res = await fetch('/api/drivers/autofill-document', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              base64,
              mimeType: file.type || 'image/jpeg',
              fileName: file.name,
              documentType: hint,
            }),
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Failed to scan document');
          }

          const data = await res.json();
          const docType = data.documentType || hint;

          if (docId) {
            // Update specific row in additionalDocuments
            setForm(prev => {
              const docs = [...(prev.additionalDocuments || [])];
              const idx = docs.findIndex(d => d.id === docId);
              if (idx >= 0) {
                docs[idx] = {
                  ...docs[idx],
                  documentNumber: data.documentNumber || docs[idx].documentNumber,
                  issuingAuthority: data.issuingAuthority || docs[idx].issuingAuthority || 'Issuing Authority',
                  expiryDate: data.expiryDate || docs[idx].expiryDate,
                  issueDate: data.issueDate || docs[idx].issueDate,
                  fileName: file.name,
                  fileData: dataUrl,
                  autofilled: Boolean(data.documentNumber || data.expiryDate),
                  confidence: data.confidence,
                };
              }
              return { ...prev, additionalDocuments: docs };
            });
          } else if (docType === 'EMIRATES_ID') {
            setForm(prev => ({
              ...prev,
              emiratesId: data.documentNumber || prev.emiratesId,
              emiratesIdExpiry: data.expiryDate || prev.emiratesIdExpiry,
            }));
          }

          const conf = Math.round((data.confidence || 0.95) * 100);
          setScanSuccess(`✓ Document scanned successfully (${conf}% confidence).`);
        } catch (err) {
          setScanError(err instanceof Error ? err.message : 'Error processing document');
        } finally {
          setScanningDocId(null);
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Failed to read file');
      setScanningDocId(null);
    }
  };

  // ── Filters & Computed ────────────────────────────────────────────────────

  const filteredDrivers = useMemo(() => {
    return drivers.filter(d => {
      if (categoryFilter) {
        const cat = d.driverCategory || d.licenseType || 'LIGHT_DUTY';
        if (cat !== categoryFilter) return false;
      }
      return true;
    });
  }, [drivers, categoryFilter]);

  const filteredNationalities = useMemo(() => {
    const q = natSearch.toLowerCase().trim();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(c => c.name.toLowerCase().includes(q) || c.iso.toLowerCase().includes(q));
  }, [natSearch]);

  const filteredHierarchies = useMemo(() => {
    const q = hierSearch.toLowerCase().trim();
    if (!q) return hierarchyList;
    return hierarchyList.filter(h => h.toLowerCase().includes(q));
  }, [hierarchyList, hierSearch]);

  const filteredDallasIds = useMemo(() => {
    const q = dallasSearch.toLowerCase().trim();
    if (!q) return PREDEFINED_DALLAS_IDS;
    return PREDEFINED_DALLAS_IDS.filter(d => d.toLowerCase().includes(q));
  }, [dallasSearch]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)] flex items-center gap-2.5">
            <User className="w-6 h-6 text-cyan-400" /> Driver Profiles
          </h1>
          <p className="text-[var(--text-muted)] text-xs mt-0.5">
            Central driver identity, compliance &amp; credentials registry — mapped directly to User Accounts
          </p>
        </div>
        <button
          onClick={openNew}
          className="px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-400 hover:to-teal-400 text-white rounded-xl font-semibold text-sm shadow-lg shadow-cyan-500/20 transition-all flex items-center gap-2 shrink-0"
        >
          <span>+</span> Add Driver
        </button>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search driver name, license, contact, employee ID…"
            className="w-full pl-9 pr-4 py-2.5 bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl text-[var(--text-main)] text-sm focus:outline-none focus:border-cyan-500"
          />
        </div>

        {/* Category Filter */}
        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          className="bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-[var(--text-main)] text-sm focus:outline-none"
        >
          <option value="">All Categories</option>
          {DRIVER_CATEGORIES.map(c => (
            <option key={c.key} value={c.key}>{c.short}</option>
          ))}
        </select>

        {/* Status Filter */}
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-[var(--text-main)] text-sm focus:outline-none"
        >
          <option value="">All Status</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Driver Type Filter */}
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-[var(--text-main)] text-sm focus:outline-none"
        >
          <option value="">All Types</option>
          {DRIVER_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </select>

        <button
          onClick={() => setExpiringOnly(p => !p)}
          className={`px-4 py-2.5 rounded-xl text-sm font-medium border transition-all ${
            expiringOnly
              ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
              : 'bg-[var(--input-bg)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)]'
          }`}
        >
          ⚠ Expiring Only
        </button>
      </div>

      {/* Main Table */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--bg-surface-hover)] border-b border-[var(--border-subtle)]">
              <tr>
                {['Driver & Nationality', 'Employee ID', 'Mobile / Contact', 'Category', 'License No.', 'Issuing Authority', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center text-[var(--text-faint)] animate-pulse">
                    Loading driver registry…
                  </td>
                </tr>
              ) : filteredDrivers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center text-[var(--text-faint)]">
                    No drivers found. Click &quot;+ Add Driver&quot; to register a driver.
                  </td>
                </tr>
              ) : (
                filteredDrivers.map(d => {
                  const catMeta = DRIVER_CATEGORIES.find(c => c.key === (d.driverCategory || d.licenseType)) || DRIVER_CATEGORIES[0];
                  const CatIcon = catMeta.icon;

                  return (
                    <tr
                      key={d.id}
                      className="hover:bg-[var(--bg-surface-hover)] transition-colors"
                    >
                      {/* Name & Nationality */}
                      <td className="px-4 py-3">
                        <div className="font-semibold text-[var(--text-main)]">
                          {d.name}
                        </div>
                        <div className="text-xs text-[var(--text-muted)] flex items-center gap-1 mt-0.5">
                          {d.nationality && <span>{d.nationality}</span>}
                          {d.hierarchy && <span className="text-[var(--text-faint)]">· {d.hierarchy}</span>}
                        </div>
                      </td>

                      {/* Employee ID */}
                      <td className="px-4 py-3 font-mono text-xs text-[var(--text-muted)]">
                        {d.employeeId ? (
                          <span className="px-2 py-0.5 rounded bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] font-semibold text-cyan-300">
                            {d.employeeId}
                          </span>
                        ) : (
                          <span className="text-[var(--text-faint)]">—</span>
                        )}
                      </td>

                      {/* Phone / Contact */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <PhoneCell value={d.contactNumber} />
                      </td>

                      {/* Driver Category */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border ${catMeta.badge}`}>
                          <CatIcon className="w-3.5 h-3.5" />
                          {catMeta.short}
                        </span>
                      </td>

                      {/* License Number */}
                      <td className="px-4 py-3 font-mono text-xs text-[var(--text-muted)] whitespace-nowrap">
                        {d.licenseNumber}
                      </td>

                      {/* Issuing Authority */}
                      <td className="px-4 py-3 text-xs text-[var(--text-muted)] whitespace-nowrap">
                        {d.issuingAuthority || '—'}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`px-2.5 py-0.5 rounded-lg text-xs font-semibold ${statusColor[d.status] ?? 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)]'}`}>
                          {d.status}
                        </span>
                      </td>



                      {/* Actions Column (3-Dot Menu) */}
                      <td className="px-4 py-3 whitespace-nowrap text-center relative" data-driver-actions>
                        <div className="inline-block text-left relative">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveActionMenuId(prev => prev === d.id ? null : d.id);
                            }}
                            className={`p-2 rounded-xl border transition flex items-center justify-center ${
                              activeActionMenuId === d.id
                                ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border-cyan-500/50 shadow-md ring-2 ring-cyan-500/20'
                                : 'bg-[var(--bg-canvas)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)] border-[var(--border-subtle)]'
                            }`}
                            title="Driver Actions"
                            aria-label="Driver Actions"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>

                          {activeActionMenuId === d.id && (
                            <div
                              className="absolute right-0 mt-2 w-64 rounded-2xl bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-700 shadow-2xl shadow-slate-900/25 z-50 py-1.5 text-left divide-y divide-slate-200 dark:divide-slate-800 animate-in fade-in zoom-in-95 duration-100"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800/80">
                                <div className="text-[11px] uppercase font-black tracking-wider text-cyan-700 dark:text-cyan-400">
                                  {d.employeeId || 'Driver'}
                                </div>
                                <div className="text-xs font-bold text-slate-950 dark:text-slate-200 truncate mt-0.5">
                                  {d.firstName} {d.lastName}
                                </div>
                              </div>

                              <div className="py-1">
                                <button
                                  onClick={() => {
                                    openEdit(d);
                                    setActiveActionMenuId(null);
                                  }}
                                  className="w-full px-4 py-2.5 text-xs font-bold text-slate-950 dark:text-white hover:bg-cyan-50 dark:hover:bg-slate-800 flex items-center gap-3 transition"
                                >
                                  <span className="p-1.5 rounded-lg bg-cyan-100 dark:bg-cyan-950/80 text-cyan-700 dark:text-cyan-400">
                                    <Edit2 className="w-4 h-4 shrink-0" />
                                  </span>
                                  <span>Edit Driver Profile</span>
                                </button>

                                {d.contactNumber && (
                                  <a
                                    href={`tel:${d.contactNumber}`}
                                    className="w-full px-4 py-2.5 text-xs font-bold text-emerald-800 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-slate-800 flex items-center gap-3 transition"
                                    onClick={() => setActiveActionMenuId(null)}
                                  >
                                    <span className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400">
                                      <Phone className="w-4 h-4 shrink-0" />
                                    </span>
                                    <span>Call Driver ({d.contactNumber})</span>
                                  </a>
                                )}

                                <a
                                  href={`/fleet/telematics?search=${encodeURIComponent(d.firstName || d.lastName || '')}`}
                                  className="w-full px-4 py-2.5 text-xs font-bold text-slate-950 dark:text-white hover:bg-cyan-50 dark:hover:bg-slate-800 flex items-center gap-3 transition"
                                  onClick={() => setActiveActionMenuId(null)}
                                >
                                  <span className="p-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-400">
                                    <Car className="w-4 h-4 shrink-0" />
                                  </span>
                                  <span>Live Vehicle &amp; GPS</span>
                                </a>
                              </div>

                              <div className="py-1">
                                <button
                                  onClick={() => {
                                    setActiveActionMenuId(null);
                                    handleDeactivate(d.id);
                                  }}
                                  className="w-full px-4 py-2.5 text-xs font-bold text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-slate-800 flex items-center gap-3 transition"
                                >
                                  <span className="p-1.5 rounded-lg bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-400">
                                    <X className="w-4 h-4 shrink-0" />
                                  </span>
                                  <span>{d.status === 'ACTIVE' ? 'Deactivate Driver' : 'Delete / Retire'}</span>
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-center justify-between text-xs text-[var(--text-muted)]">
          <span>{filteredDrivers.length} driver{filteredDrivers.length !== 1 ? 's' : ''} listed</span>
          <span className="text-[var(--text-faint)]">Vehicle allocations managed in Fleet Hub</span>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          Add / Edit Driver Modal
      ═══════════════════════════════════════════════════════════════════════ */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl my-6">

            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between shrink-0">
              <div>
                <h2 className="text-lg font-bold text-[var(--text-main)] flex items-center gap-2">
                  <User className="w-5 h-5 text-cyan-400" />
                  {editing ? `Edit Driver — ${editing.name}` : 'Register New Driver'}
                </h2>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Provisions driver profile and automatically syncs mobile app credentials to User Management
                </p>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] p-1 rounded-lg text-xl"
              >
                ×
              </button>
            </div>

            {/* Tabs Header */}
            <div className="flex border-b border-[var(--border-subtle)] shrink-0 px-6 bg-[var(--bg-surface)]">
              {[
                { key: 'identity',   label: '👤 Driver Identity & Credentials' },
                { key: 'compliance', label: '📋 Documents and Permits' },
              ].map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key as typeof tab)}
                  className={`px-5 py-3 text-sm font-semibold border-b-2 transition-colors ${
                    tab === t.key
                      ? 'border-cyan-500 text-cyan-400 bg-cyan-500/5'
                      : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {formError && (
                <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" /> {formError}
                </div>
              )}

              {scanSuccess && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 px-4 py-3 rounded-xl text-xs flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" /> {scanSuccess}
                </div>
              )}

              {scanError && (
                <div className="bg-amber-500/10 border border-amber-500/30 text-amber-300 px-4 py-3 rounded-xl text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" /> {scanError}
                </div>
              )}

              {/* ─────────────────────────────────────────────────────────────
                  TAB 1: IDENTITY & CREDENTIALS
              ───────────────────────────────────────────────────────────── */}
              {tab === 'identity' && (
                <div className="space-y-6">

                  {/* Section A: Driver Classification & Category */}
                  <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-5 space-y-4">
                    <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Truck className="w-4 h-4" /> Driver Category &amp; Classification *
                    </h3>

                    {/* Driver Category Selector */}
                    <div>
                      <label className="block text-xs font-semibold text-[var(--text-muted)] mb-2">
                        Driver Category (Weight &amp; Vehicle Class) *
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                        {DRIVER_CATEGORIES.map(cat => {
                          const Icon = cat.icon;
                          const isSelected = form.driverCategory === cat.key;
                          return (
                            <button
                              type="button"
                              key={cat.key}
                              onClick={() => {
                                f('driverCategory', cat.key);
                                f('licenseType', cat.key);
                              }}
                              className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all ${
                                isSelected
                                  ? 'bg-cyan-500/15 border-cyan-500 text-cyan-300 shadow-sm'
                                  : 'bg-[var(--bg-canvas)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-cyan-500/40 hover:text-[var(--text-main)]'
                              }`}
                            >
                              <Icon className={`w-4 h-4 shrink-0 ${isSelected ? 'text-cyan-400' : 'text-[var(--text-faint)]'}`} />
                              <div className="min-w-0">
                                <p className="text-xs font-bold truncate">{cat.short}</p>
                                <p className="text-[10px] text-[var(--text-faint)] truncate">{cat.label.split('(')[1]?.replace(')', '') || ''}</p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                      <div>
                        <label className="block text-xs text-[var(--text-muted)] mb-1.5 font-medium">Driver Status</label>
                        <select
                          value={form.status ?? 'ACTIVE'}
                          onChange={e => f('status', e.target.value)}
                          className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-sm focus:outline-none focus:border-cyan-500"
                        >
                          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs text-[var(--text-muted)] mb-1.5 font-medium">Driver Type</label>
                        <select
                          value={form.driverType ?? 'STAFF'}
                          onChange={e => f('driverType', e.target.value)}
                          className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-sm focus:outline-none focus:border-cyan-500"
                        >
                          {DRIVER_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                        </select>
                      </div>

                      {/* Employee ID Picker / Input */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-xs text-[var(--text-muted)] font-medium">Employee ID</label>
                          <button
                            type="button"
                            onClick={() => setEmpMode(m => m === 'select' ? 'manual' : 'select')}
                            className="text-[11px] text-cyan-400 hover:underline"
                          >
                            {empMode === 'select' ? 'Type Manually' : 'Select Employee'}
                          </button>
                        </div>

                        {empMode === 'select' ? (
                          <select
                            value={form.employeeId ?? ''}
                            onChange={e => {
                              const empId = e.target.value;
                              f('employeeId', empId);
                              const match = staffOptions.find(s => s.employeeId === empId);
                              if (match) {
                                if (!form.name) f('name', match.name);
                                if (!form.email && match.email) f('email', match.email);
                                if (!form.contactNumber && match.contactNumber) f('contactNumber', match.contactNumber);
                                if (!form.hierarchy && match.department) f('hierarchy', match.department);
                              }
                            }}
                            className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-sm focus:outline-none focus:border-cyan-500"
                          >
                            <option value="">— Select Employee ID —</option>
                            {staffOptions.map(s => (
                              <option key={s.id} value={s.employeeId}>
                                {s.employeeId} · {s.name} {s.department ? `(${s.department})` : ''}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={form.employeeId ?? ''}
                            onChange={e => f('employeeId', e.target.value)}
                            placeholder="e.g. EMP-1042"
                            className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-sm font-mono focus:outline-none focus:border-cyan-500"
                          />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Section B: Personal Details */}
                  <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-5 space-y-4">
                    <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                      <User className="w-4 h-4" /> Personal Information
                    </h3>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs text-[var(--text-muted)] mb-1.5 font-medium">Full Name *</label>
                        <input
                          type="text"
                          required
                          value={form.name ?? ''}
                          onChange={e => f('name', e.target.value)}
                          placeholder="e.g. Ahmed Al-Mansouri"
                          className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-sm focus:outline-none focus:border-cyan-500"
                        />
                      </div>

                      {/* Nationality Searchable Dropdown */}
                      <div className="relative">
                        <label className="block text-xs text-[var(--text-muted)] mb-1.5 font-medium">Nationality *</label>
                        <button
                          type="button"
                          onClick={() => setNatOpen(p => !p)}
                          className="w-full flex items-center justify-between bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-sm text-left focus:outline-none focus:border-cyan-500"
                        >
                          <span className="truncate">
                            {form.nationality ? form.nationality : <span className="text-[var(--text-faint)]">Search &amp; Select Nationality…</span>}
                          </span>
                          <ChevronDown className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
                        </button>

                        {natOpen && (
                          <div className="absolute left-0 right-0 top-full mt-1.5 z-30 bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)] rounded-xl shadow-2xl p-2 space-y-1.5">
                            <input
                              type="text"
                              value={natSearch}
                              onChange={e => setNatSearch(e.target.value)}
                              placeholder="Search country or nationality…"
                              className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-lg px-3 py-1.5 text-xs text-[var(--text-main)] focus:outline-none focus:border-cyan-500"
                              autoFocus
                            />
                            <div className="max-h-48 overflow-y-auto space-y-0.5">
                              {filteredNationalities.map(c => (
                                <button
                                  type="button"
                                  key={c.iso}
                                  onClick={() => {
                                    f('nationality', c.name);
                                    setNatOpen(false);
                                  }}
                                  className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] text-left"
                                >
                                  <span className="text-base">{c.flag}</span>
                                  <span className="font-medium flex-1 truncate">{c.name}</span>
                                  {form.nationality === c.name && <Check className="w-3.5 h-3.5 text-cyan-400" />}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Contact Number with Standard PhoneInput */}
                      <div>
                        <label className="block text-xs text-[var(--text-muted)] mb-1.5 font-medium">Mobile Number *</label>
                        <PhoneInput
                          value={form.contactNumber ?? ''}
                          onChange={(full) => f('contactNumber', full)}
                          placeholder="50 123 4567"
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-[var(--text-muted)] mb-1.5 font-medium">Work Email</label>
                        <input
                          type="email"
                          value={form.email ?? ''}
                          onChange={e => f('email', e.target.value)}
                          placeholder="driver@company.com"
                          className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-sm focus:outline-none focus:border-cyan-500"
                        />
                      </div>

                      {/* Hierarchy Dropdown (Search & Select) */}
                      <div className="relative">
                        <label className="block text-xs text-[var(--text-muted)] mb-1.5 font-medium">Hierarchy / Division *</label>
                        <button
                          type="button"
                          onClick={() => setHierOpen(p => !p)}
                          className="w-full flex items-center justify-between bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-sm text-left focus:outline-none focus:border-cyan-500"
                        >
                          <span className="truncate">
                            {form.hierarchy ? form.hierarchy : <span className="text-[var(--text-faint)]">Select Hierarchy…</span>}
                          </span>
                          <ChevronDown className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
                        </button>

                        {hierOpen && (
                          <div className="absolute left-0 right-0 top-full mt-1.5 z-30 bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)] rounded-xl shadow-2xl p-2 space-y-1.5">
                            <input
                              type="text"
                              value={hierSearch}
                              onChange={e => setHierSearch(e.target.value)}
                              placeholder="Search or enter division…"
                              className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-lg px-3 py-1.5 text-xs text-[var(--text-main)] focus:outline-none focus:border-cyan-500"
                              autoFocus
                            />
                            <div className="max-h-48 overflow-y-auto space-y-0.5">
                              {filteredHierarchies.map(h => (
                                <button
                                  type="button"
                                  key={h}
                                  onClick={() => {
                                    f('hierarchy', h);
                                    setHierOpen(false);
                                  }}
                                  className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] text-left"
                                >
                                  <span className="font-medium truncate">{h}</span>
                                  {form.hierarchy === h && <Check className="w-3.5 h-3.5 text-cyan-400" />}
                                </button>
                              ))}
                              {hierSearch.trim() && !filteredHierarchies.includes(hierSearch.trim()) && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const val = hierSearch.trim();
                                    f('hierarchy', val);
                                    setHierarchyList(p => [val, ...p]);
                                    setHierOpen(false);
                                  }}
                                  className="w-full text-left px-3 py-1.5 text-xs text-cyan-400 hover:bg-cyan-500/10 rounded-lg font-semibold"
                                >
                                  + Assign &quot;{hierSearch.trim()}&quot;
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Dallas ID / RFID Dropdown (Search & Select) */}
                      <div className="relative">
                        <label className="block text-xs text-[var(--text-muted)] mb-1.5 font-medium">Dallas ID / RFID Tag</label>
                        <button
                          type="button"
                          onClick={() => setDallasOpen(p => !p)}
                          className="w-full flex items-center justify-between bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-sm font-mono text-left focus:outline-none focus:border-cyan-500"
                        >
                          <span className="truncate">
                            {form.dallasId ? form.dallasId : <span className="text-[var(--text-faint)] font-sans">Select Dallas / RFID ID…</span>}
                          </span>
                          <ChevronDown className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
                        </button>

                        {dallasOpen && (
                          <div className="absolute left-0 right-0 top-full mt-1.5 z-30 bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)] rounded-xl shadow-2xl p-2 space-y-1.5">
                            <input
                              type="text"
                              value={dallasSearch}
                              onChange={e => setDallasSearch(e.target.value)}
                              placeholder="Search or enter Dallas Key…"
                              className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-lg px-3 py-1.5 text-xs text-[var(--text-main)] font-mono focus:outline-none focus:border-cyan-500"
                              autoFocus
                            />
                            <div className="max-h-48 overflow-y-auto space-y-0.5">
                              {filteredDallasIds.map(d => (
                                <button
                                  type="button"
                                  key={d}
                                  onClick={() => {
                                    f('dallasId', d);
                                    setDallasOpen(false);
                                  }}
                                  className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-mono text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] text-left"
                                >
                                  <span>{d}</span>
                                  {form.dallasId === d && <Check className="w-3.5 h-3.5 text-cyan-400" />}
                                </button>
                              ))}
                              {dallasSearch.trim() && !filteredDallasIds.includes(dallasSearch.trim()) && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    f('dallasId', dallasSearch.trim());
                                    setDallasOpen(false);
                                  }}
                                  className="w-full text-left px-3 py-1.5 text-xs text-cyan-400 hover:bg-cyan-500/10 rounded-lg font-semibold font-mono"
                                >
                                  + Assign &quot;{dallasSearch.trim()}&quot;
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      <div>
                        <label className="block text-xs text-[var(--text-muted)] mb-1.5 font-medium">Date of Birth</label>
                        <input
                          type="date"
                          value={form.dob ? form.dob.split('T')[0] : ''}
                          onChange={e => f('dob', e.target.value)}
                          className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-sm focus:outline-none focus:border-cyan-500"
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-[var(--text-muted)] mb-1.5 font-medium">Date of Joining</label>
                        <input
                          type="date"
                          value={form.dateOfJoin ? form.dateOfJoin.split('T')[0] : ''}
                          onChange={e => f('dateOfJoin', e.target.value)}
                          className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-sm focus:outline-none focus:border-cyan-500"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Section C: User Credentials & Mobile App Sign In */}
                  <div className="bg-gradient-to-br from-indigo-950/30 to-purple-950/20 border border-indigo-500/30 rounded-xl p-5 space-y-4">
                    <div>
                      <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Lock className="w-4 h-4" /> Driver App Password &amp; User Profile Mapping
                      </h3>
                      <p className="text-xs text-[var(--text-muted)] mt-1">
                        {editing
                          ? 'Set a new password here to reset this driver’s login credentials for the mobile driver app.'
                          : 'Creates an authorized entry in the User Management Module with role DRIVER and sets their sign-in password.'}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs text-[var(--text-muted)] mb-1.5 font-medium">
                          {editing ? 'Change / Reset Driver Password' : 'Set Initial Password *'}
                        </label>
                        <div className="relative">
                          <input
                            type={showPassword ? 'text' : 'password'}
                            value={form.password ?? ''}
                            onChange={e => f('password', e.target.value)}
                            placeholder={editing ? 'Leave blank to keep existing password' : 'Min. 8 chars, 1 letter, 1 number, 1 symbol'}
                            className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl pl-3.5 pr-10 py-2 text-[var(--text-main)] text-sm focus:outline-none focus:border-indigo-500"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(p => !p)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-main)]"
                          >
                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs text-[var(--text-muted)] mb-1.5 font-medium">Confirm Password</label>
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={form.confirmPassword ?? ''}
                          onChange={e => f('confirmPassword', e.target.value)}
                          placeholder="Re-type password"
                          className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-sm focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    </div>

                    {/* Live Password Policy Checklist */}
                    {Boolean(form.password) && (
                      <div className="p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-1.5 text-xs">
                        <div className="font-semibold text-[var(--text-muted)] flex items-center justify-between">
                          <span>Password Policy Checklist:</span>
                          <span className="text-[11px] text-[var(--text-faint)]">Min 8 chars, letter, digit, symbol</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px]">
                          <span className={(form.password ?? '').length >= 8 ? 'text-emerald-400 font-medium' : 'text-slate-400'}>
                            {(form.password ?? '').length >= 8 ? '✓' : '•'} At least 8 characters
                          </span>
                          <span className={/[a-zA-Z]/.test(form.password ?? '') ? 'text-emerald-400 font-medium' : 'text-slate-400'}>
                            {/[a-zA-Z]/.test(form.password ?? '') ? '✓' : '•'} One alphabet letter (A–Z or a–z)
                          </span>
                          <span className={/\d/.test(form.password ?? '') ? 'text-emerald-400 font-medium' : 'text-slate-400'}>
                            {/\d/.test(form.password ?? '') ? '✓' : '•'} One numeric digit (0–9)
                          </span>
                          <span className={/[^a-zA-Z0-9]/.test(form.password ?? '') ? 'text-emerald-400 font-medium' : 'text-slate-400'}>
                            {/[^a-zA-Z0-9]/.test(form.password ?? '') ? '✓' : '•'} One special character or symbol
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Quick navigation to Tab 2 */}
                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        onClick={() => setTab('compliance')}
                        className="px-4 py-2 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5"
                      >
                        Next: Documents &amp; Permits <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>

                  </div>

                </div>
              )}

              {/* ─────────────────────────────────────────────────────────────
                  TAB 2: DOCUMENTS AND PERMITS
              ───────────────────────────────────────────────────────────── */}
              {tab === 'compliance' && (
                <div className="space-y-6">

                  {/* License Upload & AI Auto-Populate Banner */}
                  <div className="bg-gradient-to-r from-cyan-950/40 via-teal-950/30 to-indigo-950/40 border border-cyan-500/30 rounded-2xl p-5 shadow-sm">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div>
                        <h3 className="text-sm font-bold text-cyan-300 flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-cyan-400" /> Upload Driving License (AI Auto-Populate)
                        </h3>
                        <p className="text-xs text-[var(--text-muted)] mt-1 max-w-xl">
                          Upload a digital PDF or photo of the Driving License (RTA, Abu Dhabi Police, or Oman ROP).
                          Details like License Number, Issuing Authority, Category, Name, DOB, and Expiry are extracted automatically.
                        </p>
                      </div>

                      <label className="relative inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 font-semibold text-xs cursor-pointer transition-all shadow-sm">
                        <Upload className="w-4 h-4" />
                        {scanningLicense ? 'Analyzing License…' : 'Scan & Auto-Populate'}
                        <input
                          type="file"
                          accept=".pdf,image/png,image/jpeg,image/webp"
                          disabled={scanningLicense}
                          onChange={e => {
                            const file = e.target.files?.[0];
                            if (file) handleLicenseFileUpload(file);
                          }}
                          className="sr-only"
                        />
                      </label>
                    </div>
                  </div>

                  {/* Driving License Details */}
                  <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                        <CreditCard className="w-4 h-4" /> Driving License Details *
                      </h4>
                      <span className="text-[11px] text-[var(--text-faint)]">Required for active compliance</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs text-[var(--text-muted)] mb-1.5 font-medium">Driving License Number *</label>
                        <input
                          type="text"
                          required
                          value={form.licenseNumber ?? ''}
                          onChange={e => f('licenseNumber', e.target.value)}
                          placeholder="e.g. 10084729"
                          className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-sm font-mono focus:outline-none focus:border-cyan-500"
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-[var(--text-muted)] mb-1.5 font-medium">Issuing Authority *</label>
                        <input
                          type="text"
                          value={form.issuingAuthority ?? ''}
                          onChange={e => f('issuingAuthority', e.target.value)}
                          placeholder="e.g. RTA Dubai, Abu Dhabi Police, Oman ROP"
                          className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-sm focus:outline-none focus:border-cyan-500"
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-[var(--text-muted)] mb-1.5 font-medium">License Expiry Date *</label>
                        <input
                          type="date"
                          value={form.licenseExpiry ? form.licenseExpiry.split('T')[0] : ''}
                          onChange={e => f('licenseExpiry', e.target.value)}
                          className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-sm focus:outline-none focus:border-cyan-500"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Emirates ID */}
                  <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                        <FileText className="w-4 h-4" /> Emirates ID
                      </h4>
                      <label className="inline-flex items-center gap-1 text-[11px] text-cyan-400 hover:underline cursor-pointer">
                        <Upload className="w-3 h-3" /> Auto-scan EID
                        <input
                          type="file"
                          accept=".pdf,image/png,image/jpeg"
                          onChange={e => {
                            const file = e.target.files?.[0];
                            if (file) handleDocumentFileUpload(file, undefined, 'EMIRATES_ID');
                          }}
                          className="sr-only"
                        />
                      </label>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs text-[var(--text-muted)] mb-1.5 font-medium">Emirates ID Number</label>
                        <input
                          type="text"
                          value={form.emiratesId ?? ''}
                          onChange={e => f('emiratesId', e.target.value)}
                          placeholder="784-1988-1234567-1"
                          className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-sm font-mono focus:outline-none focus:border-cyan-500"
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-[var(--text-muted)] mb-1.5 font-medium">Emirates ID Expiry</label>
                        <input
                          type="date"
                          value={form.emiratesIdExpiry ? form.emiratesIdExpiry.split('T')[0] : ''}
                          onChange={e => f('emiratesIdExpiry', e.target.value)}
                          className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-sm focus:outline-none focus:border-cyan-500"
                        />
                      </div>
                    </div>
                  </div>

                  {/* ── ADDITIONAL DOCUMENTS & PERMITS (WITH ADD BUTTON) ── */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                          <FileCheck className="w-4 h-4" /> Additional Documents &amp; Permits
                        </h4>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">
                          Attach and manage multiple driver documents (Passport, Visa, RTA Permits, Medical Fitness, etc.)
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={addAdditionalDocument}
                        className="px-3.5 py-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-sm"
                      >
                        <Plus className="w-3.5 h-3.5" /> Add Document
                      </button>
                    </div>

                    <div className="space-y-3">
                      {(form.additionalDocuments || []).length === 0 ? (
                        <div className="p-6 rounded-xl border border-dashed border-[var(--border-subtle)] text-center text-xs text-[var(--text-muted)]">
                          No additional documents added. Click &quot;+ Add Document&quot; above to attach supplemental permits or IDs.
                        </div>
                      ) : (
                        (form.additionalDocuments || []).map((doc) => {
                          const isScanning = scanningDocId === doc.id;
                          return (
                            <div
                              key={doc.id}
                              className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] space-y-3 shadow-sm"
                            >
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2.5">
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  <FileText className="w-4 h-4 text-cyan-400 shrink-0" />
                                  <input
                                    type="text"
                                    value={doc.name}
                                    onChange={e => updateAdditionalDoc(doc.id, 'name', e.target.value)}
                                    placeholder="Document / Permit Name (e.g. Passport, Visa, RTA Permit)"
                                    className="w-full max-w-md bg-[var(--bg-surface-elevated)] font-semibold text-xs sm:text-sm text-[var(--text-main)] px-2.5 py-1 rounded-lg border border-[var(--border-subtle)] focus:outline-none focus:border-cyan-500"
                                  />
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                  {doc.autofilled && (
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                                      <Sparkles className="w-3 h-3" /> AI Autofilled
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => removeAdditionalDoc(doc.id)}
                                    className="text-[11px] font-semibold text-rose-400 hover:text-rose-300 px-2 py-0.5 rounded hover:bg-rose-500/10 transition-colors flex items-center gap-1"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" /> Remove
                                  </button>
                                </div>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                                <div>
                                  <label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">Document / Permit No.</label>
                                  <input
                                    type="text"
                                    value={doc.documentNumber}
                                    onChange={e => updateAdditionalDoc(doc.id, 'documentNumber', e.target.value)}
                                    placeholder="e.g. AB1234567 or PERM-889"
                                    className="w-full bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-xl px-3 py-1.5 text-xs font-mono text-[var(--text-main)] focus:outline-none focus:border-cyan-500"
                                  />
                                </div>

                                <div>
                                  <label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">Issuing Authority</label>
                                  <input
                                    type="text"
                                    value={doc.issuingAuthority ?? ''}
                                    onChange={e => updateAdditionalDoc(doc.id, 'issuingAuthority', e.target.value)}
                                    placeholder="e.g. GDRFA, RTA, Civil Defense"
                                    className="w-full bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-xl px-3 py-1.5 text-xs text-[var(--text-main)] focus:outline-none focus:border-cyan-500"
                                  />
                                </div>

                                <div>
                                  <label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">Expiry Date</label>
                                  <input
                                    type="date"
                                    value={doc.expiryDate ? doc.expiryDate.slice(0, 10) : ''}
                                    onChange={e => updateAdditionalDoc(doc.id, 'expiryDate', e.target.value)}
                                    className="w-full bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-xl px-3 py-1.5 text-xs text-[var(--text-main)] focus:outline-none focus:border-cyan-500"
                                  />
                                </div>

                                <div>
                                  <label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">Attachment File</label>
                                  <label className="w-full cursor-pointer block">
                                    <input
                                      type="file"
                                      accept="image/*,application/pdf"
                                      className="hidden"
                                      onChange={e => {
                                        const file = e.target.files?.[0];
                                        if (file) handleDocumentFileUpload(file, doc.id, doc.documentType || 'PERMIT');
                                      }}
                                    />
                                    <div className="w-full px-3 py-1.5 bg-[var(--bg-canvas)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl text-xs flex items-center justify-between text-[var(--text-main)] transition-colors">
                                      <span className="truncate max-w-[130px] font-mono text-[11px]">
                                        {doc.fileName || 'Attach (AI Scan)'}
                                      </span>
                                      {isScanning ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400 shrink-0" />
                                      ) : (
                                        <Upload className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                                      )}
                                    </div>
                                  </label>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                </div>
              )}

            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-[var(--border-subtle)] flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0 bg-[var(--bg-surface-elevated)]">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {formError ? (
                  <div className="flex items-center gap-2 text-xs text-rose-400 font-semibold bg-rose-500/10 px-3 py-1.5 rounded-lg border border-rose-500/30 max-w-lg">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                    <span className="truncate">{formError}</span>
                  </div>
                ) : (
                  <span className="text-xs text-[var(--text-faint)] truncate">
                    {editing ? 'Updates driver & synchronizes user account' : 'Creates driver & provisions mobile login credentials'}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-5 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="px-6 py-2.5 bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-400 hover:to-teal-400 text-white rounded-xl font-bold text-sm shadow-md shadow-cyan-500/20 disabled:opacity-50 transition-all flex items-center gap-2"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {saving ? 'Saving…' : editing ? 'Update Driver' : 'Create Driver'}
                </button>
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
