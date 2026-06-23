'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const PLANS = ['TRIAL', 'STANDARD', 'PROFESSIONAL', 'ENTERPRISE'];
const PLAN_COLORS: Record<string, string> = {
  TRIAL:        'bg-slate-500/20 text-slate-400 border-slate-500/30',
  STANDARD:     'bg-blue-500/20 text-blue-400 border-blue-500/30',
  PROFESSIONAL: 'bg-violet-500/20 text-violet-400 border-violet-500/30',
  ENTERPRISE:   'bg-amber-500/20 text-amber-400 border-amber-500/30',
};

// ── Module groups (Tab 2) ─────────────────────────────────────────────────────
const MODULE_GROUPS = [
  {
    label: 'Booking & Transport', icon: '🚗', color: 'blue',
    modules: [
      { key: 'leasing',   label: 'Vehicle Leasing',     desc: 'Long-term lease contracts & billing' },
      { key: 'rac',       label: 'Rent-a-Car',          desc: 'Short-term rental bookings & KYC' },
      { key: 'bus_ops',   label: 'Staff Transport',     desc: 'Bus routes, trips & passenger management' },
    ],
  },
  {
    label: 'Fleet Management', icon: '🚌', color: 'emerald',
    modules: [
      { key: 'fleet',       label: 'Fleet Master',      desc: 'Vehicle register & document vault' },
      { key: 'maintenance', label: 'Maintenance',       desc: 'Service requests & work orders' },
      { key: 'drivers',     label: 'Driver Management', desc: 'Driver profiles, KPIs & compliance' },
    ],
  },
  {
    label: 'Finance & Compliance', icon: '💼', color: 'violet',
    modules: [
      { key: 'finance',    label: 'Finance & Billing', desc: 'Invoicing, payments & VAT' },
      { key: 'compliance', label: 'Compliance',        desc: 'RTA, regulatory & audit trail' },
    ],
  },
  {
    label: 'Analytics & Reports', icon: '📊', color: 'amber',
    modules: [
      { key: 'reports', label: 'Reports & BI', desc: 'Dashboards, exports & scheduled reports' },
    ],
  },
];
const ALL_MODULE_KEYS = MODULE_GROUPS.flatMap(g => g.modules.map(m => m.key));
const MODULE_LABELS: Record<string, string> = Object.fromEntries(
  MODULE_GROUPS.flatMap(g => g.modules.map(m => [m.key, m.label]))
);

// ── Service types & request types (Tab 3) ─────────────────────────────────────
const SERVICE_TYPES = [
  {
    key: 'mobility', label: 'Mobility Services', icon: '🏥', color: 'amber',
    desc: 'Healthcare, passenger & emergency transport',
    requestTypes: [
      { key: 'blood_bank',           label: 'Blood Bank' },
      { key: 'on_call',              label: 'On Call' },
      { key: 'ambulance',            label: 'Ambulance' },
      { key: 'airport_pickup',       label: 'Airport Pickup' },
      { key: 'airport_dropoff',      label: 'Airport Drop Off' },
      { key: 'hospital_visit',       label: 'Hospital Visit' },
      { key: 'instrument_delivery',  label: 'Instrument & Equipment Collection/Delivery' },
      { key: 'blood_samples',        label: 'Blood Samples Collection/Delivery' },
      { key: 'mortuary',             label: 'Mortuary' },
      { key: 'medicine_collection',  label: 'Medicine/Drug Collection' },
      { key: 'document_delivery',    label: 'Document Collection/Delivery' },
      { key: 'vip_service',          label: 'VIP Service' },
      { key: 'sample_delivery',      label: 'Sample Collection/Delivery' },
      { key: 'staff_transportation', label: 'Staff Transportation' },
      { key: 'training',             label: 'Training' },
      { key: 'freight_items',        label: 'Freight – Store Items Collection/Delivery' },
      { key: 'patient_pickup',       label: 'Patient Pick Up/Drop Off' },
      { key: 'bank_visit',           label: 'Bank Visit' },
      { key: 'visa_medical',         label: 'Visa Medical' },
      { key: 'maintenance_mob',      label: 'Maintenance' },
      { key: 'vaccine_delivery',     label: 'Vaccine Collection/Delivery' },
      { key: 'meeting',              label: 'Meeting' },
      { key: 'events_seminar',       label: 'Events/Seminar' },
      { key: 'oncology_pickup',      label: 'Oncology Patient Pick Up/Drop Off' },
      { key: 'guest',                label: 'Guest' },
      { key: 'marketing',            label: 'Marketing' },
    ],
  },
  {
    key: 'logistics', label: 'Logistics Services', icon: '📦', color: 'blue',
    desc: 'Freight, cargo & last-mile delivery operations',
    requestTypes: [
      { key: 'express_delivery',    label: 'Express Delivery' },
      { key: 'standard_delivery',   label: 'Standard Delivery' },
      { key: 'last_mile_delivery',  label: 'Last Mile Delivery' },
      { key: 'cold_chain',          label: 'Cold Chain Delivery' },
      { key: 'bulk_cargo',          label: 'Bulk Cargo Transport' },
      { key: 'doc_courier',         label: 'Document Courier' },
      { key: 'package_collection',  label: 'Package Collection' },
      { key: 'warehouse_pickup',    label: 'Warehouse Pickup' },
      { key: 'cross_docking',       label: 'Cross-Docking' },
      { key: 'return_logistics',    label: 'Return Logistics' },
      { key: 'heavy_equipment',     label: 'Heavy Equipment Transport' },
      { key: 'hazardous_materials', label: 'Hazardous Materials' },
      { key: 'food_beverage',       label: 'Food & Beverage Delivery' },
      { key: 'ecommerce_delivery',  label: 'E-Commerce Delivery' },
    ],
  },
  {
    key: 'leasing_svc', label: 'Leasing Services', icon: '📋', color: 'emerald',
    desc: 'Long-term vehicle leasing & fleet contracts',
    requestTypes: [
      { key: 'short_term_lease',  label: 'Short-Term Lease (1–3 months)' },
      { key: 'medium_term_lease', label: 'Medium-Term Lease (3–12 months)' },
      { key: 'long_term_lease',   label: 'Long-Term Lease (1–3 years)' },
      { key: 'fleet_lease',       label: 'Fleet Lease' },
      { key: 'corporate_lease',   label: 'Corporate Lease' },
      { key: 'financial_lease',   label: 'Financial Lease' },
      { key: 'operating_lease',   label: 'Operating Lease' },
      { key: 'lease_renewal',     label: 'Lease Renewal' },
      { key: 'lease_extension',   label: 'Lease Extension' },
      { key: 'vehicle_swap',      label: 'Vehicle Swap' },
      { key: 'early_termination', label: 'Early Termination' },
      { key: 'fleet_expansion',   label: 'Fleet Expansion' },
    ],
  },
  {
    key: 'rac_svc', label: 'Rent-a-Car Services', icon: '🚗', color: 'violet',
    desc: 'Short-term vehicle rentals & self-drive',
    requestTypes: [
      { key: 'daily_rental',        label: 'Daily Rental' },
      { key: 'weekly_rental',       label: 'Weekly Rental' },
      { key: 'monthly_rental',      label: 'Monthly Rental' },
      { key: 'airport_rental',      label: 'Airport Pickup Rental' },
      { key: 'corporate_rental',    label: 'Corporate Rental' },
      { key: 'self_drive',          label: 'Self Drive' },
      { key: 'chauffeur_driven',    label: 'Chauffeur Driven' },
      { key: 'economy_car',         label: 'Economy Car' },
      { key: 'suv_rental',          label: 'SUV Rental' },
      { key: 'van_rental',          label: 'Van Rental' },
      { key: 'luxury_rental',       label: 'Luxury Car Rental' },
      { key: 'electric_vehicle',    label: 'Electric Vehicle' },
      { key: 'wedding_car_rental',  label: 'Wedding Car Rental' },
      { key: 'group_transport',     label: 'Group Transport Rental' },
    ],
  },
  {
    key: 'limousine', label: 'Limousine Services', icon: '🚘', color: 'rose',
    desc: 'Premium chauffeur & executive transfers',
    requestTypes: [
      { key: 'limo_airport',    label: 'Airport Transfer' },
      { key: 'limo_corporate',  label: 'Corporate Transfer' },
      { key: 'limo_wedding',    label: 'Wedding Transfer' },
      { key: 'limo_vip',        label: 'VIP Transfer' },
      { key: 'limo_city_tour',  label: 'City Tour' },
      { key: 'limo_hourly',     label: 'Hourly Hire' },
      { key: 'limo_full_day',   label: 'Full Day Hire' },
      { key: 'limo_half_day',   label: 'Half Day Hire' },
      { key: 'limo_night',      label: 'Night Service' },
      { key: 'limo_event',      label: 'Event Transfer' },
      { key: 'limo_hotel',      label: 'Hotel Transfer' },
      { key: 'limo_port',       label: 'Port / Cruise Transfer' },
      { key: 'limo_one_way',    label: 'One Way Trip' },
      { key: 'limo_round_trip', label: 'Round Trip' },
    ],
  },
  {
    key: 'bus_svc', label: 'Staff Transport Services', icon: '🚌', color: 'teal',
    desc: 'Corporate shuttle, bus & group transport',
    requestTypes: [
      { key: 'staff_shuttle',      label: 'Staff Shuttle' },
      { key: 'school_bus',         label: 'School Bus' },
      { key: 'charter_service',    label: 'Charter Service' },
      { key: 'corporate_shuttle',  label: 'Corporate Shuttle' },
      { key: 'event_bus',          label: 'Event Transport Bus' },
      { key: 'airport_bus',        label: 'Airport Bus' },
      { key: 'intercity_coach',    label: 'Intercity Coach' },
      { key: 'special_needs_bus',  label: 'Special Needs Transport' },
      { key: 'vip_shuttle',        label: 'VIP Shuttle' },
      { key: 'site_transport',     label: 'Site / Construction Transport' },
    ],
  },
  {
    key: 'maintenance_svc', label: 'Maintenance Services', icon: '🔧', color: 'orange',
    desc: 'Vehicle maintenance, repair & roadside assistance',
    requestTypes: [
      { key: 'scheduled_maint',   label: 'Scheduled Maintenance' },
      { key: 'emergency_repair',  label: 'Emergency Repair' },
      { key: 'tyre_change',       label: 'Tyre Change' },
      { key: 'battery_service',   label: 'Battery Service' },
      { key: 'towing_service',    label: 'Towing Service' },
      { key: 'roadside_assist',   label: 'Roadside Assistance' },
      { key: 'ac_service',        label: 'AC Service' },
      { key: 'body_work',         label: 'Body Work & Denting' },
      { key: 'electrical_repair', label: 'Electrical Repair' },
      { key: 'engine_service',    label: 'Engine Service' },
      { key: 'oil_change',        label: 'Oil Change & Lube' },
      { key: 'wheel_alignment',   label: 'Wheel Alignment & Balancing' },
    ],
  },
];

// Color maps for service type / module group cards
const BORDER_BG: Record<string, string> = {
  amber:   'border-amber-500/30   bg-amber-500/5',
  blue:    'border-blue-500/30    bg-blue-500/5',
  emerald: 'border-emerald-500/30 bg-emerald-500/5',
  violet:  'border-violet-500/30  bg-violet-500/5',
  rose:    'border-rose-500/30    bg-rose-500/5',
  teal:    'border-teal-500/30    bg-teal-500/5',
  orange:  'border-orange-500/30  bg-orange-500/5',
};
const ICON_BG: Record<string, string> = {
  amber:   'bg-amber-500/20   text-amber-300',
  blue:    'bg-blue-500/20    text-blue-300',
  emerald: 'bg-emerald-500/20 text-emerald-300',
  violet:  'bg-violet-500/20  text-violet-300',
  rose:    'bg-rose-500/20    text-rose-300',
  teal:    'bg-teal-500/20    text-teal-300',
  orange:  'bg-orange-500/20  text-orange-300',
};
const ACCENT: Record<string, string> = {
  amber:   'accent-amber-400',
  blue:    'accent-blue-400',
  emerald: 'accent-emerald-400',
  violet:  'accent-violet-400',
  rose:    'accent-rose-400',
  teal:    'accent-teal-400',
  orange:  'accent-orange-400',
};
const BADGE: Record<string, string> = {
  amber:   'bg-amber-500/20   text-amber-300   border-amber-500/30',
  blue:    'bg-blue-500/20    text-blue-300    border-blue-500/30',
  emerald: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  violet:  'bg-violet-500/20  text-violet-300  border-violet-500/30',
  rose:    'bg-rose-500/20    text-rose-300    border-rose-500/30',
  teal:    'bg-teal-500/20    text-teal-300    border-teal-500/30',
  orange:  'bg-orange-500/20  text-orange-300  border-orange-500/30',
};

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type Tab = 'basic' | 'modules' | 'booking' | 'attachments';

interface TenantRow {
  id: string; name: string; code?: string; plan?: string;
  domain?: string; contactEmail?: string; industry?: string;
  isActive?: boolean;
  modules?: { module: string; isEnabled: boolean }[];
  _count?: { userTenants: number; roles: number };
  health?: {
    score: number;
    status: 'HEALTHY' | 'ATTENTION' | 'BLOCKED';
    enabledModules: number;
    pendingApprovals: number;
    issues: Array<{ severity: 'error' | 'warning' | 'info'; message: string }>;
  };
  readiness?: {
    score: number;
    status: 'READY' | 'ATTENTION' | 'BLOCKED';
    blockers: Array<{ key: string; label: string; message: string; actionHref?: string }>;
    warnings: Array<{ key: string; label: string; message: string; actionHref?: string }>;
    metrics: {
      enabledModules: number;
      activeUsers: number;
      pendingApprovals: number;
      failedLogins24h: number;
      activeModuleSubscriptions: number;
    };
  } | null;
}

// bookingTypes stored as { serviceKey: string[] }
type BookingTypes = Record<string, string[]>;

const emptyForm = () => ({
  name: '', code: '', domain: '', contactEmail: '', contactPhone: '',
  address: '', plan: 'STANDARD', industry: '', contactName: '',
  supportedLanguages: ['en'] as string[],
  defaultLanguage: 'en',
  localizedName_en: '', localizedName_ar: '',
  localizedDesc_en: '', localizedDesc_ar: '',
  enabledModules: [...ALL_MODULE_KEYS],
  bookingTypes: {} as BookingTypes,
});

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'basic',       label: 'Basic Information',     icon: '🏢' },
  { key: 'modules',     label: 'Module Configuration',  icon: '⚙️' },
  { key: 'booking',     label: 'Booking Configuration', icon: '📋' },
  { key: 'attachments', label: 'Attachments',           icon: '📎' },
];

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function TenantsPage() {
  const [tenants,   setTenants]   = useState<TenantRow[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('basic');
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [busyTenantId, setBusyTenantId] = useState<string | null>(null);
  const [pendingImpersonation, setPendingImpersonation] = useState<TenantRow | null>(null);
  const [form,      setForm]      = useState(emptyForm);
  // which service-type panels are expanded
  const [expanded,  setExpanded]  = useState<Record<string, boolean>>({
    mobility: true,
  });

  // ── data ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/admin/tenants');
      const data = await res.json();
      setTenants(Array.isArray(data) ? data : []);
    } catch { setError('Failed to load tenants'); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // ── helpers ───────────────────────────────────────────────────────────────
  const set = (key: string, val: unknown) => setForm(p => ({ ...p, [key]: val }));

  const toggleLanguage = (lang: string) =>
    setForm(p => {
      const has     = p.supportedLanguages.includes(lang);
      const updated = has ? p.supportedLanguages.filter(l => l !== lang) : [...p.supportedLanguages, lang];
      return { ...p, supportedLanguages: updated,
        defaultLanguage: updated.includes(p.defaultLanguage) ? p.defaultLanguage : updated[0] ?? 'en' };
    });

  const toggleModule = (key: string) =>
    setForm(p => ({
      ...p,
      enabledModules: p.enabledModules.includes(key)
        ? p.enabledModules.filter(m => m !== key)
        : [...p.enabledModules, key],
    }));

  const toggleRequestType = (serviceKey: string, typeKey: string) =>
    setForm(p => {
      const current = p.bookingTypes[serviceKey] ?? [];
      const updated  = current.includes(typeKey)
        ? current.filter(k => k !== typeKey)
        : [...current, typeKey];
      return { ...p, bookingTypes: { ...p.bookingTypes, [serviceKey]: updated } };
    });

  const selectAllRequestTypes = (serviceKey: string, all: string[]) =>
    setForm(p => {
      const current = p.bookingTypes[serviceKey] ?? [];
      const allSel  = all.every(k => current.includes(k));
      return { ...p, bookingTypes: { ...p.bookingTypes, [serviceKey]: allSel ? [] : all } };
    });

  const toggleExpanded = (key: string) =>
    setExpanded(p => ({ ...p, [key]: !p[key] }));

  const openModal = () => {
    setForm(emptyForm()); setActiveTab('basic');
    setExpanded({ mobility: true }); setError(''); setShowModal(true);
  };
  const closeModal = () => setShowModal(false);

  // ── submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    const resolvedName = form.localizedName_en.trim() || form.name.trim();
    if (!resolvedName) { setError('Tenant Name (English) is required'); setActiveTab('basic'); return; }
    setSaving(true); setError('');
    try {
      const payload = {
        name:               resolvedName,
        code:               form.code.trim()    || undefined,
        domain:             form.domain.trim()  || undefined,
        plan:               form.plan,
        industry:           form.industry       || undefined,
        contactName:        form.contactName    || undefined,
        contactEmail:       form.contactEmail   || undefined,
        contactPhone:       form.contactPhone   || undefined,
        address:            form.address        || undefined,
        defaultLanguage:    form.defaultLanguage,
        supportedLanguages: form.supportedLanguages.join(','),
        localizedName: JSON.stringify({ en: form.localizedName_en, ar: form.localizedName_ar }),
        localizedDesc: JSON.stringify({ en: form.localizedDesc_en, ar: form.localizedDesc_ar }),
        bookingTypes:  JSON.stringify(form.bookingTypes),
        enabledModules: form.enabledModules,
      };
      const res = await fetch('/api/admin/tenants', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? 'Failed to create tenant');
      }
      await load();
      closeModal();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create tenant');
    } finally { setSaving(false); }
  };

  const toggleActive = async (t: TenantRow) => {
    setBusyTenantId(t.id);
    setActionMsg('');
    try {
      const res = await fetch(`/api/admin/tenants/${t.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !t.isActive }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 428) {
        setActionMsg(`Tenant status change queued for approval: ${data.approvalRequest?.id ?? 'pending request'}. Approve it, then retry.`);
        return;
      }
      if (!res.ok) {
        setActionMsg(data.error ?? 'Tenant status update failed.');
        return;
      }
      setActionMsg(`Tenant ${t.isActive ? 'deactivation' : 'activation'} applied.`);
      load();
    } finally {
      setBusyTenantId(null);
    }
  };

  const impersonate = async (t: TenantRow) => {
    setPendingImpersonation(t);
    return;
  };

  const confirmImpersonation = async () => {
    const t = pendingImpersonation;
    if (!t) return;
    setBusyTenantId(t.id);
    setActionMsg('');
    try {
      const res = await fetch('/api/admin/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: t.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionMsg(data?.error ?? 'Could not impersonate.');
        return;
      }
      window.location.href = '/platform';
    } catch {
      setActionMsg('Network error - could not impersonate.');
    } finally {
      setBusyTenantId(null);
      setPendingImpersonation(null);
    }
  };

  // ── tab nav ───────────────────────────────────────────────────────────────
  const tabIndex = TABS.findIndex(t => t.key === activeTab);

  // total selected booking types across all service types
  const totalBookingSelected = Object.values(form.bookingTypes).reduce((s, a) => s + a.length, 0);
  const readinessSummary = tenants.reduce((acc, tenant) => {
    const status = tenant.readiness?.status;
    if (status === 'READY') acc.ready += 1;
    if (status === 'ATTENTION') acc.attention += 1;
    if (status === 'BLOCKED') acc.blocked += 1;
    acc.score += tenant.readiness?.score ?? tenant.health?.score ?? 0;
    return acc;
  }, { ready: 0, attention: 0, blocked: 0, score: 0 });
  const readinessAverage = tenants.length ? Math.round(readinessSummary.score / tenants.length) : 0;

  // ── render ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-slate-400 animate-pulse">Loading tenants…</div>
    </div>
  );

  return (
    <div className="space-y-8">

      {/* ── Page header ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">Tenants</h1>
          <p className="text-slate-400">{tenants.filter(t => t.isActive).length} active organisations on the platform</p>
        </div>
        <button onClick={openModal}
          className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3 text-sm font-medium text-white hover:opacity-90">
          + New Tenant
        </button>
      </div>

      {error && !showModal && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm">{error}</div>
      )}
      {actionMsg && !showModal && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl px-4 py-3 text-blue-200 text-sm">{actionMsg}</div>
      )}

      {/* ── Tenant list ─────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-white/10 bg-slate-900/60 overflow-hidden">
        <div className="px-5 py-4 border-b border-white/10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-white">Tenant Readiness Dashboard</h2>
            <p className="text-sm text-slate-400">Unified operating view across identity, access, billing, security, configuration, and approvals.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm text-slate-300">
              Average readiness <span className="font-bold text-white">{readinessAverage}%</span>
            </div>
            <Link href="/admin/tenants/readiness" className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500">
              Open readiness
            </Link>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-white/10">
          {[
            ['Ready', readinessSummary.ready, 'text-emerald-300'],
            ['Needs Attention', readinessSummary.attention, 'text-amber-300'],
            ['Blocked', readinessSummary.blocked, 'text-rose-300'],
            ['Tenants', tenants.length, 'text-blue-300'],
          ].map(([label, value, color]) => (
            <div key={String(label)} className="p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
              <p className={`mt-2 text-3xl font-bold ${color}`}>{value}</p>
            </div>
          ))}
        </div>
        {tenants.some(t => (t.readiness?.blockers?.length ?? 0) > 0 || (t.readiness?.warnings?.length ?? 0) > 0) && (
          <div className="border-t border-white/10 p-5 grid grid-cols-1 lg:grid-cols-3 gap-3">
            {tenants
              .filter(t => (t.readiness?.blockers?.length ?? 0) > 0 || (t.readiness?.warnings?.length ?? 0) > 0)
              .slice(0, 3)
              .map(t => {
                const topIssue = t.readiness?.blockers?.[0] ?? t.readiness?.warnings?.[0];
                return (
                  <div key={t.id} className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-white truncate">{t.name}</p>
                      <span className="text-xs font-semibold text-amber-200">{t.readiness?.score ?? t.health?.score ?? 0}%</span>
                    </div>
                    <p className="mt-2 text-xs text-amber-100 line-clamp-2">{topIssue?.message}</p>
                    <Link href={topIssue?.actionHref || `/admin/tenants/${t.id}`} className="mt-3 inline-block text-xs text-blue-200 hover:text-blue-100">
                      Review action
                    </Link>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4">
        {tenants.length === 0 ? (
          <div className="text-center text-slate-400 py-16 bg-slate-800/30 border border-white/5 rounded-2xl">
            No tenants yet. Create your first tenant to get started.
          </div>
        ) : tenants.map(t => (
          <div key={t.id}
            data-testid="tenant-card"
            className={`bg-slate-800/50 border rounded-2xl p-6 transition-all ${t.isActive ? 'border-white/10' : 'border-white/5 opacity-60'}`}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="text-xl font-bold text-white">{t.name}</h3>
                  {t.code && <span className="text-xs font-mono bg-slate-700 text-slate-300 px-2 py-0.5 rounded">{t.code}</span>}
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${PLAN_COLORS[t.plan ?? 'STANDARD']}`}>{t.plan}</span>
                  {!t.isActive && <span className="px-2 py-0.5 rounded-full text-xs bg-rose-500/20 text-rose-400 border border-rose-500/30">INACTIVE</span>}
                </div>
                <p className="text-slate-400 text-sm">
                  {[t.domain, t.contactEmail].filter(Boolean).join('  ·  ') || t.industry || 'No contact details'}
                </p>
              </div>
              <div className="text-right text-sm">
                <div className="text-white font-medium">{t._count?.userTenants ?? 0} users</div>
                <div className="text-slate-400">{t._count?.roles ?? 0} roles</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mb-4">
              {t.health && (
                <span className={`px-2 py-1 rounded text-xs font-semibold border ${healthClass(t.health.status)}`}>
                  Health {t.health.score}% - {t.health.status}
                </span>
              )}
              {t.health?.pendingApprovals ? (
                <span className="px-2 py-1 rounded text-xs font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  {t.health.pendingApprovals} approval pending
                </span>
              ) : null}
              {ALL_MODULE_KEYS.map(m => {
                const enabled = t.modules?.find(tm => tm.module === m)?.isEnabled;
                return (
                  <span key={m} className={`px-2 py-1 rounded text-xs font-medium
                    ${enabled ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : 'bg-slate-700 text-slate-500 border border-white/5'}`}>
                    {MODULE_LABELS[m]}
                  </span>
                );
              })}
            </div>
            <div className="flex gap-3">
              <Link href={`/admin/tenants/${t.id}`}
                className="text-xs px-3 py-1.5 rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30">
                Manage
              </Link>
              <Link href={`/admin/tenants/${t.id}/invitations`}
                className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30">
                Invitations
              </Link>
              <Link href={`/admin/tenants/${t.id}/api-keys`}
                className="text-xs px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30">
                API Keys
              </Link>
              <Link href={`/admin/tenants/${t.id}/sso`}
                className="text-xs px-3 py-1.5 rounded-lg bg-violet-500/20 text-violet-300 border border-violet-500/30 hover:bg-violet-500/30">
                SSO
              </Link>
              <Link href={`/admin/tenants/${t.id}/branding`}
                className="text-xs px-3 py-1.5 rounded-lg bg-pink-500/20 text-pink-300 border border-pink-500/30 hover:bg-pink-500/30">
                Branding
              </Link>
              <Link href={`/admin/tenants/${t.id}/ticket-types`}
                className="text-xs px-3 py-1.5 rounded-lg bg-violet-500/20 text-violet-300 border border-violet-500/30 hover:bg-violet-500/30">
                Ticket Types
              </Link>
              <button onClick={() => impersonate(t)}
                disabled={!t.isActive || busyTenantId === t.id}
                className="text-xs px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed">
                Impersonate
              </button>
              <button onClick={() => toggleActive(t)}
                disabled={busyTenantId === t.id}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${t.isActive
                  ? 'bg-rose-500/20 text-rose-400 border-rose-500/30 hover:bg-rose-500/30'
                  : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/30'}`}>
                {busyTenantId === t.id ? 'Working...' : t.isActive ? 'Deactivate' : 'Activate'}
              </button>
            </div>
            {t.health?.issues?.length ? (
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                {t.health.issues.slice(0, 4).map((issue, idx) => (
                  <div key={`${issue.message}-${idx}`} className={`rounded-lg border px-3 py-2 text-xs ${issueClass(issue.severity)}`}>
                    {issue.message}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          CREATE TENANT MODAL
          Fixed height: header + tab-bar (flex-shrink-0) + scrollable body
          (flex-1 min-h-0 overflow-y-auto) + footer (flex-shrink-0)
          This ensures the modal never exceeds the viewport.
      ══════════════════════════════════════════════════════════════════════ */}
      {pendingImpersonation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-amber-500/30 bg-slate-900 shadow-2xl">
            <div className="px-6 py-5 border-b border-white/10">
              <h2 className="text-lg font-bold text-white">Review impersonation</h2>
              <p className="text-sm text-slate-400 mt-1">You are about to enter {pendingImpersonation.name} as a tenant admin for operational support.</p>
            </div>
            <div className="p-6 space-y-3 text-sm text-slate-300">
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-200">
                Every action remains audited against your admin account and this tenant context.
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-lg bg-slate-950/70 border border-white/10 p-3">
                  <div className="text-slate-500">Tenant</div>
                  <div className="text-white font-semibold mt-1">{pendingImpersonation.name}</div>
                </div>
                <div className="rounded-lg bg-slate-950/70 border border-white/10 p-3">
                  <div className="text-slate-500">Health</div>
                  <div className="text-white font-semibold mt-1">{pendingImpersonation.health?.score ?? '-'}%</div>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-white/10 flex justify-end gap-2">
              <button onClick={() => setPendingImpersonation(null)} className="px-4 py-2 rounded-xl text-sm text-slate-300 hover:text-white hover:bg-white/5">Cancel</button>
              <button onClick={confirmImpersonation} disabled={busyTenantId === pendingImpersonation.id}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-sm font-semibold text-white">
                {busyTenantId === pendingImpersonation.id ? 'Starting...' : 'Start impersonation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          {/*
            Key fix: use h-[90vh] (not max-h) so flex children get a defined
            height, enabling flex-1 + overflow-y-auto to scroll properly.
          */}
          <div className="w-full max-w-2xl h-[90vh] bg-slate-900 border border-white/10 rounded-2xl
                          flex flex-col shadow-2xl overflow-hidden">

            {/* ── Modal header (never scrolls) ─────────────────────────────── */}
            <div className="flex items-start justify-between px-7 pt-5 pb-4 border-b border-white/10 flex-shrink-0">
              <div>
                <h2 className="text-xl font-bold text-white">Create New Tenant</h2>
                <p className="text-slate-400 text-xs mt-0.5">Configure a new tenant with modules and settings</p>
              </div>
              <button onClick={closeModal} className="text-slate-400 hover:text-white text-lg leading-none mt-0.5">✕</button>
            </div>

            {/* ── Tab bar (never scrolls) ───────────────────────────────────── */}
            <div className="flex border-b border-white/10 flex-shrink-0 bg-slate-900 overflow-x-auto">
              {TABS.map((t, i) => (
                <button key={t.key} onClick={() => setActiveTab(t.key)}
                  className={`flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 -mb-px transition-all whitespace-nowrap flex-shrink-0
                    ${activeTab === t.key
                      ? 'text-white border-blue-500'
                      : i < tabIndex
                        ? 'text-emerald-400 border-transparent hover:text-emerald-300'
                        : 'text-slate-500 border-transparent hover:text-slate-300'}`}>
                  <span>{t.icon}</span>
                  <span>{t.label}</span>
                  {i < tabIndex && <span className="text-emerald-400 text-[10px]">✓</span>}
                </button>
              ))}
            </div>

            {/* ── Scrollable body (takes remaining height) ─────────────────── */}
            <div className="flex-1 min-h-0 overflow-y-auto px-7 py-5">

              {/* ── TAB 1: Basic Information ──────────────────────────────── */}
              {activeTab === 'basic' && (
                <div className="space-y-5">
                  <Section icon="🏢" iconBg="bg-blue-500/20" title="Company Information"
                    desc="Core tenant identification, domain, and contact details">
                    <div className="grid grid-cols-3 gap-3">
                      <Field label="Tenant Code" placeholder="e.g. BT001, CABMAN_01"
                        hint="Uppercase, numbers, underscores"
                        value={form.code} onChange={v => set('code', v)} />
                      <Field label="Domain" placeholder="e.g. bytetrackers.com"
                        value={form.domain} onChange={v => set('domain', v)} />
                      <Field label="Tenant Email" placeholder="info@company.com"
                        value={form.contactEmail} onChange={v => set('contactEmail', v)} />
                      <Field label="Phone Number" placeholder="+971-4-1234567"
                        value={form.contactPhone} onChange={v => set('contactPhone', v)} />
                      <Field label="Address" placeholder="Enter tenant address" className="col-span-2"
                        value={form.address} onChange={v => set('address', v)} />
                    </div>
                  </Section>

                  <Section icon="🌐" iconBg="bg-violet-500/20" title="Language Configuration"
                    desc="Supported languages and localisation settings">
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-400 mb-2">Supported Languages</label>
                        <div className="flex gap-5">
                          {[{ key: 'en', label: 'English' }, { key: 'ar', label: 'Arabic' }].map(lang => (
                            <label key={lang.key} className="flex items-center gap-2 cursor-pointer">
                              <input type="checkbox" checked={form.supportedLanguages.includes(lang.key)}
                                onChange={() => toggleLanguage(lang.key)}
                                className="accent-blue-500 w-4 h-4 text-white" />
                              <span className="text-sm text-slate-300">{lang.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-400 mb-1.5">Default Language</label>
                          <select value={form.defaultLanguage} onChange={e => set('defaultLanguage', e.target.value)}
                            className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-white/10 text-white text-sm focus:border-blue-500 focus:outline-none">
                            {form.supportedLanguages.map(l => (
                              <option key={l} value={l}>{l === 'en' ? 'English' : 'Arabic'}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-400 mb-1.5">Plan</label>
                          <select value={form.plan} onChange={e => set('plan', e.target.value)}
                            className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-white/10 text-white text-sm focus:border-blue-500 focus:outline-none">
                            {PLANS.map(p => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </div>
                      </div>
                    </div>
                  </Section>

                  <Section icon="✏️" iconBg="bg-slate-600/30"
                    title={<>Localised Tenant Information <span className="text-rose-400">*</span></>}
                    desc="Enter the tenant information in all supported languages">
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Tenant Name (English) *" placeholder="Enter tenant name (English)"
                        value={form.localizedName_en} onChange={v => set('localizedName_en', v)} required />
                      <Field label="Description (English)" placeholder="Short description (English)"
                        value={form.localizedDesc_en} onChange={v => set('localizedDesc_en', v)} />
                      {form.supportedLanguages.includes('ar') && <>
                        <Field label="Tenant Name (Arabic)" placeholder="أدخل اسم المستأجر"
                          value={form.localizedName_ar} onChange={v => set('localizedName_ar', v)} />
                        <Field label="Description (Arabic)" placeholder="أدخل وصف المستأجر"
                          value={form.localizedDesc_ar} onChange={v => set('localizedDesc_ar', v)} />
                      </>}
                      <Field label="Industry" placeholder="e.g. Transport & Logistics"
                        value={form.industry} onChange={v => set('industry', v)} />
                      <Field label="Contact Person" placeholder="Full contact name"
                        value={form.contactName} onChange={v => set('contactName', v)} />
                    </div>
                  </Section>
                </div>
              )}

              {/* ── TAB 2: Module Configuration ───────────────────────────── */}
              {activeTab === 'modules' && (
                <div className="space-y-4">
                  <Section icon="⚙️" iconBg="bg-emerald-500/20" title="Module Configuration"
                    desc="Enable and configure system modules and features for this tenant">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {MODULE_GROUPS.map(group => {
                        const allSel = group.modules.every(m => form.enabledModules.includes(m.key));
                        return (
                          <div key={group.label} className={`rounded-xl border p-4 ${BORDER_BG[group.color]}`}>
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-sm ${ICON_BG[group.color]}`}>
                                  {group.icon}
                                </span>
                                <span className="text-sm font-semibold text-white">{group.label}</span>
                              </div>
                              <button onClick={() => {
                                const keys = group.modules.map(m => m.key);
                                setForm(p => ({
                                  ...p,
                                  enabledModules: allSel
                                    ? p.enabledModules.filter(k => !keys.includes(k))
                                    : [...new Set([...p.enabledModules, ...keys])],
                                }));
                              }} className="text-xs text-blue-400 hover:text-blue-300">
                                {allSel ? 'Deselect All' : 'Select All'}
                              </button>
                            </div>
                            <div className="space-y-2">
                              {group.modules.map(m => (
                                <label key={m.key}
                                  className={`flex items-start gap-3 p-2.5 rounded-lg cursor-pointer transition-all
                                    ${form.enabledModules.includes(m.key) ? 'bg-white/10' : 'hover:bg-white/5'}`}>
                                  <input type="checkbox"
                                    checked={form.enabledModules.includes(m.key)}
                                    onChange={() => toggleModule(m.key)}
                                    className={`mt-0.5 w-4 h-4 flex-shrink-0 ${ACCENT[group.color]}`} />
                                  <div>
                                    <div className="text-sm font-medium text-white">{m.label}</div>
                                    <div className="text-xs text-slate-400 mt-0.5">{m.desc}</div>
                                  </div>
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {form.enabledModules.length} of {ALL_MODULE_KEYS.length} modules selected
                    </p>
                  </Section>
                </div>
              )}

              {/* ── TAB 3: Booking Configuration ──────────────────────────── */}
              {activeTab === 'booking' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between mb-1">
                    <div>
                      <p className="text-sm font-semibold text-white">Booking Type Configuration</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Define available request types for each service. Selected types will appear in the Booking page.
                      </p>
                    </div>
                    {totalBookingSelected > 0 && (
                      <span className="text-xs px-2 py-1 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30 flex-shrink-0">
                        {totalBookingSelected} selected
                      </span>
                    )}
                  </div>

                  {SERVICE_TYPES.map(svc => {
                    const selectedKeys = form.bookingTypes[svc.key] ?? [];
                    const allKeys      = svc.requestTypes.map(r => r.key);
                    const allSel       = allKeys.length > 0 && allKeys.every(k => selectedKeys.includes(k));
                    const isOpen       = !!expanded[svc.key];

                    return (
                      <div key={svc.key}
                        className={`rounded-xl border transition-all ${BORDER_BG[svc.color]}`}>

                        {/* Service type header — always visible */}
                        <div className="flex items-center justify-between px-4 py-3">
                          <button onClick={() => toggleExpanded(svc.key)}
                            className="flex items-center gap-3 flex-1 min-w-0 text-left">
                            <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-base flex-shrink-0 ${ICON_BG[svc.color]}`}>
                              {svc.icon}
                            </span>
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-white">{svc.label}</div>
                              <div className="text-xs text-slate-400 truncate">{svc.desc}</div>
                            </div>
                          </button>

                          <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                            {selectedKeys.length > 0 && (
                              <span className={`text-xs px-2 py-0.5 rounded-full border ${BADGE[svc.color]}`}>
                                {selectedKeys.length}/{allKeys.length}
                              </span>
                            )}
                            <button onClick={() => selectAllRequestTypes(svc.key, allKeys)}
                              className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded hover:bg-white/5">
                              {allSel ? 'None' : 'All'}
                            </button>
                            <button onClick={() => toggleExpanded(svc.key)}
                              className="text-slate-400 hover:text-white w-6 h-6 flex items-center justify-center">
                              {isOpen ? '▲' : '▼'}
                            </button>
                          </div>
                        </div>

                        {/* Request types grid — shown when expanded */}
                        {isOpen && (
                          <div className="px-4 pb-4 border-t border-white/5 pt-3">
                            <p className="text-xs text-slate-500 mb-3">
                              {allKeys.length} request types available — select which should be enabled for this tenant
                            </p>
                            <div className="grid grid-cols-3 gap-1.5">
                              {svc.requestTypes.map(rt => {
                                const checked = selectedKeys.includes(rt.key);
                                return (
                                  <label key={rt.key}
                                    className={`flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-all border text-xs
                                      ${checked
                                        ? `${BORDER_BG[svc.color]} text-white border-opacity-70`
                                        : 'border-white/8 bg-slate-800/40 text-slate-400 hover:border-white/20'}`}>
                                    <input type="checkbox" checked={checked}
                                      onChange={() => toggleRequestType(svc.key, rt.key)}
                                      className={`w-3.5 h-3.5 flex-shrink-0 ${ACCENT[svc.color]}`} />
                                    <span className="leading-tight">{rt.label}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ── TAB 4: Attachments ───────────────────────────────────── */}
              {activeTab === 'attachments' && (
                <div className="h-full flex flex-col gap-4">
                  <Section icon="📎" iconBg="bg-slate-600/30" title="Branding & Attachments"
                    desc="Upload logo, documents, and other files">
                    {/* Empty state — intentionally compact, no py-16 */}
                    <div className="rounded-xl border border-white/10 bg-slate-800/40
                                    flex flex-col items-center justify-center gap-3
                                    py-10 px-6 text-center">
                      <span className="text-5xl opacity-20">📎</span>
                      <p className="text-slate-300 text-sm font-medium">No attachments yet</p>
                      <p className="text-slate-500 text-xs max-w-xs">
                        Attachments can be added after saving. Once the tenant is created,
                        open the tenant detail page to upload logos and documents.
                      </p>
                    </div>
                  </Section>

                  <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
                    <p className="text-xs font-semibold text-blue-300 mb-1">📋 Summary</p>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-400 mt-2">
                      <span>Name</span>
                      <span className="text-white truncate">{form.localizedName_en || form.name || '—'}</span>
                      <span>Code</span>
                      <span className="text-white font-mono">{form.code || '—'}</span>
                      <span>Plan</span>
                      <span className="text-white">{form.plan}</span>
                      <span>Languages</span>
                      <span className="text-white">{form.supportedLanguages.map(l => l === 'en' ? 'English' : 'Arabic').join(', ')}</span>
                      <span>Modules</span>
                      <span className="text-white">{form.enabledModules.length} selected</span>
                      <span>Booking Types</span>
                      <span className="text-white">{totalBookingSelected} request types across {Object.keys(form.bookingTypes).filter(k => (form.bookingTypes[k]?.length ?? 0) > 0).length} services</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ── Footer — never scrolls ───────────────────────────────────── */}
            <div className="flex items-center justify-between px-7 py-3.5 border-t border-white/10
                            bg-slate-900 flex-shrink-0 rounded-b-2xl">
              <div className="min-w-0 mr-4">
                {error
                  ? <p className="text-rose-400 text-xs truncate">{error}</p>
                  : <p className="text-slate-500 text-xs">
                      Step {tabIndex + 1} of {TABS.length} — {TABS[tabIndex].label}
                    </p>
                }
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button onClick={closeModal}
                  className="px-4 py-2 rounded-lg border border-white/10 text-white text-xs hover:bg-white/5 transition-all">
                  Cancel
                </button>
                {tabIndex > 0 && (
                  <button onClick={() => setActiveTab(TABS[tabIndex - 1].key)}
                    className="px-4 py-2 rounded-lg border border-white/10 text-white text-xs hover:bg-white/5 transition-all">
                    ← Back
                  </button>
                )}
                {tabIndex < TABS.length - 1 ? (
                  <button onClick={() => setActiveTab(TABS[tabIndex + 1].key)}
                    className="px-5 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-medium hover:opacity-90">
                    Next →
                  </button>
                ) : (
                  <button onClick={handleSubmit} disabled={saving}
                    className="px-5 py-2 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-xs font-medium hover:opacity-90 disabled:opacity-50">
                    {saving ? 'Creating…' : 'Create Tenant'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function healthClass(status: NonNullable<TenantRow['health']>['status']) {
  if (status === 'HEALTHY') return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
  if (status === 'ATTENTION') return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
  return 'bg-rose-500/20 text-rose-300 border-rose-500/30';
}

function issueClass(severity: 'error' | 'warning' | 'info') {
  if (severity === 'error') return 'bg-rose-500/10 text-rose-200 border-rose-500/30';
  if (severity === 'warning') return 'bg-amber-500/10 text-amber-200 border-amber-500/30';
  return 'bg-blue-500/10 text-blue-200 border-blue-500/30';
}

function Section({
  icon, iconBg, title, desc, children,
}: {
  icon: string; iconBg: string;
  title: React.ReactNode; desc?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm flex-shrink-0 ${iconBg}`}>{icon}</span>
        <div>
          <div className="text-sm font-semibold text-white">{title}</div>
          {desc && <div className="text-xs text-slate-400">{desc}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}

function Field({
  label, placeholder, value, onChange, hint, required, className,
}: {
  label: string; placeholder?: string; value: string;
  onChange: (v: string) => void; hint?: string; required?: boolean; className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-slate-400 mb-1.5">{label}</label>
      <input type="text" value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} required={required}
        className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-white/10 text-white
                   placeholder-slate-600 text-sm focus:border-blue-500 focus:outline-none transition-colors" />
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
