'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';
import PlatformSessionSlot from './PlatformSessionSlot';
import { useLanguage } from '@/contexts/LanguageContext';
import { usePermissions } from '@/contexts/PermissionContext';
import { 
  Car, 
  Bot, 
  Network, 
  Wrench, 
  FileText, 
  Truck, 
  Bus, 
  GraduationCap, 
  ShieldAlert, 
  CarFront, 
  Users, 
  Building2, 
  Layers, 
  CircleDollarSign, 
  ShieldCheck, 
  Smartphone, 
  BarChart3, 
  Radio, 
  Leaf, 
  Boxes, 
  Sparkles, 
  ArrowUpRight, 
  Search, 
  Command, 
  CheckCircle2, 
  Activity,
  Plus
} from 'lucide-react';

interface ModuleDef {
  id: string;
  title: string;
  category: 'intelligence' | 'services' | 'operations' | 'assets' | 'governance' | 'enterprise';
  description: string;
  href: string;
  icon: React.ReactNode;
  gradient: string;
  borderAccent: string;
  tags: string[];
  status: string;
  stats?: Array<{ label: string; value: string | number }>;
  flagship?: boolean;
  quickActions?: Array<{ label: string; href: string }>;
}

const MODULES: ModuleDef[] = [
  // ── 1. AI & INTELLIGENCE ──────────────────────────────────────────
  {
    id: 'agents',
    title: 'AI Agent Ecosystem & Copilot',
    category: 'intelligence',
    description: '10 autonomous AI copilots — predictive maintenance, smart dispatch optimizer, accident triage, WhatsApp RAC booking assistant, and compliance ratchets.',
    href: '/agents',
    icon: <Sparkles className="w-5 h-5 text-violet-400" />,
    gradient: 'from-violet-500/20 to-purple-500/10',
    borderAccent: 'hover:border-violet-500/50',
    tags: ['10 AI Agents', 'Predictive Triage', 'Smart Dispatch', 'WhatsApp AI'],
    status: 'ACTIVE',
    flagship: true,
    stats: [
      { label: 'Autonomous Agents', value: '10 Online' },
      { label: 'AI Accuracy', value: '98.2%' },
      { label: 'Triage Speed', value: '0.4s' },
      { label: 'Cost Avoidance', value: 'AED 42k' },
    ],
    quickActions: [
      { label: 'Agent Command', href: '/agents' },
      { label: 'Threshold Tuning', href: '/agents' },
    ],
  },
  {
    id: 'ai-platform',
    title: 'AI Platform & Governance',
    category: 'intelligence',
    description: 'Autonomous policy guardrails (L0–L4), financial token spend budgets, multi-provider AI gateway, and ground-truth model benchmarks.',
    href: '/ai-platform',
    icon: <Sparkles className="w-5 h-5 text-cyan-400" />,
    gradient: 'from-cyan-500/20 to-blue-500/10',
    borderAccent: 'hover:border-cyan-500/50',
    tags: ['Governance', 'ROI Tracking', 'AI Gateway', 'Benchmarks'],
    status: 'LIVE',
    flagship: true,
    stats: [
      { label: 'Net ROI', value: '+AED 42.4k' },
      { label: 'Autonomy Level', value: 'L2 Guarded' },
      { label: 'Model Quality', value: '96.8%' },
    ],
    quickActions: [
      { label: 'ROI Dashboard', href: '/ai-platform' },
      { label: 'Set Policy', href: '/ai-platform' },
    ],
  },

  // ── 2. TRANSPORT SERVICES (LOB) ───────────────────────────────────
  {
    id: 'bus-ops',
    title: 'Staff Transportation (STS)',
    category: 'services',
    description: 'Fixed corporate bus route schedules, PCE constraint optimization, passenger manifests, shift roster synchronization, and live boarding tracking.',
    href: '/bus-ops',
    icon: <Bus className="w-5 h-5 text-indigo-400" />,
    gradient: 'from-indigo-500/15 to-blue-500/10',
    borderAccent: 'hover:border-indigo-500/50',
    tags: ['Staff Shuttles', 'PCE Optimizer', 'Shift Sync', 'Passenger Manifest'],
    status: 'LIVE',
    flagship: true,
    stats: [
      { label: 'Active Routes', value: '89' },
      { label: 'PCE Optimization', value: '94.2%' },
      { label: 'Monthly Pax', value: '28.4k' },
    ],
    quickActions: [
      { label: 'Route Planner', href: '/bus-ops/route-planner' },
      { label: 'Planning Engine', href: '/bus-ops/planning-engine' },
    ],
  },
  {
    id: 'school-bus',
    title: 'School Bus Transportation',
    category: 'services',
    description: 'Student safety registry, RFID badge attendance tracking, guardian WhatsApp SMS alerts, and DOT safety compliance.',
    href: '/school-bus',
    icon: <GraduationCap className="w-5 h-5 text-amber-400" />,
    gradient: 'from-amber-500/15 to-yellow-500/10',
    borderAccent: 'hover:border-amber-500/50',
    tags: ['Student RFID', 'Guardian Alerts', 'DOT Safety'],
    status: 'LIVE',
    stats: [
      { label: 'Active Students', value: '3,420' },
      { label: 'Live Buses', value: '62' },
    ],
  },
  {
    id: 'logistics',
    title: 'Logistics & Freight Ops',
    category: 'services',
    description: 'End-to-end heavy logistics dispatch, digital ePOD, bulk consignment merge optimizer, cold chain telematics, and route tracking.',
    href: '/logistics',
    icon: <Truck className="w-5 h-5 text-yellow-400" />,
    gradient: 'from-yellow-500/15 to-amber-500/10',
    borderAccent: 'hover:border-yellow-500/50',
    tags: ['Heavy Freight', 'Digital ePOD', 'Cold Chain', 'Multi-Drop'],
    status: 'LIVE',
    stats: [
      { label: 'In Transit', value: '35 Trips' },
      { label: 'On-Time Rate', value: '99.1%' },
    ],
  },
  {
    id: 'leasing',
    title: 'Vehicle Long-Term Leasing',
    category: 'services',
    description: 'Corporate long-term leases, automated monthly billing, lessee profiles, contract renewals, and return inspection scoring.',
    href: '/leasing',
    icon: <FileText className="w-5 h-5 text-purple-400" />,
    gradient: 'from-purple-500/15 to-pink-500/10',
    borderAccent: 'hover:border-purple-500/50',
    tags: ['Corporate Leases', 'Billing Schedules', 'Vehicle Returns'],
    status: 'LIVE',
    stats: [
      { label: 'Active Leases', value: '412' },
      { label: 'Renewals (30d)', value: '18' },
    ],
  },
  {
    id: 'rental',
    title: 'Rent-A-Car (RAC) Operations',
    category: 'services',
    description: 'Fleet RAC desk, dynamic tariffs, customer KYC, cross-border permits (Oman/KSA), damage claims, and automated traffic fine billing.',
    href: '/rental/bookings',
    icon: <Car className="w-5 h-5 text-emerald-400" />,
    gradient: 'from-emerald-500/20 to-teal-500/10',
    borderAccent: 'hover:border-emerald-500/50',
    tags: ['Daily/Weekly RAC', 'KYC Verification', 'Cross-Border Permits', 'Damage Claims'],
    status: 'LIVE',
    stats: [
      { label: 'RAC Fleet Size', value: '1,166' },
      { label: 'Active Bookings', value: '586' },
      { label: 'Fleet Utilization', value: '89.4%' },
      { label: 'Avg Daily Rate', value: 'AED 185' },
    ],
    quickActions: [
      { label: '+ New Booking', href: '/rental/bookings' },
      { label: 'Tariff Master', href: '/rental' },
    ],
  },

  // ── 3. LIVE OPERATIONS & DISPATCH ────────────────────────────────
  {
    id: 'dispatch',
    title: 'Dispatch Control Center',
    category: 'operations',
    description: 'Real-time multi-modal dispatch command center with auto-dispatch algorithm, trip merge optimizer, and live GIS map tracking.',
    href: '/dispatch',
    icon: <Radio className="w-5 h-5 text-sky-400" />,
    gradient: 'from-sky-500/15 to-cyan-500/10',
    borderAccent: 'hover:border-sky-500/50',
    tags: ['Auto-Dispatch', 'Live Map', 'Trip Merge', 'Driver Radar'],
    status: 'LIVE',
    stats: [
      { label: 'Active Trips', value: '84' },
      { label: 'Dispatch SLA', value: '< 2 min' },
    ],
  },
  {
    id: 'exchange',
    title: 'Fleet360 Exchange & Marketplace',
    category: 'operations',
    description: 'Private transport partner network & outsourced dispatch marketplace — Blind RFQ bidding, zone rate cards, zero-login driver tracking, and UAE FTA Tax Invoices.',
    href: '/exchange/dashboard',
    icon: <Network className="w-5 h-5 text-cyan-400" />,
    gradient: 'from-cyan-500/20 to-blue-500/10',
    borderAccent: 'hover:border-cyan-500/50',
    tags: ['Partner Network', 'Blind RFQ', 'FTA Tax Invoices', 'Scorecards'],
    status: 'LIVE',
    stats: [
      { label: 'Partner Network', value: '24 Verified' },
      { label: 'Active RFQs', value: '12 Live' },
      { label: 'Settlement', value: '3-Way Auto' },
    ],
    quickActions: [
      { label: 'Post RFQ', href: '/exchange/dashboard' },
      { label: 'Rate Cards', href: '/exchange/fleet' },
    ],
  },
  {
    id: 'incidents',
    title: 'Incident & Emergency Response',
    category: 'operations',
    description: 'Emergency response coordination, ambulance dispatch, on-scene collision intake, and police report documentation.',
    href: '/incidents',
    icon: <ShieldAlert className="w-5 h-5 text-rose-400" />,
    gradient: 'from-rose-500/15 to-red-500/10',
    borderAccent: 'hover:border-rose-500/50',
    tags: ['Emergency 999', 'Ambulance Unit', 'Police Reports'],
    status: 'LIVE',
  },
  {
    id: 'booking-portal',
    title: 'Unified Booking Portal',
    category: 'operations',
    description: 'Self-service enterprise portal for corporate bookings, chauffeur cars, freight requests, and approval routing.',
    href: '/booking-portal',
    icon: <Layers className="w-5 h-5 text-indigo-400" />,
    gradient: 'from-indigo-500/15 to-violet-500/10',
    borderAccent: 'hover:border-indigo-500/50',
    tags: ['Self-Service', 'Multi-Modal', 'Approval Workflow'],
    status: 'LIVE',
  },
  {
    id: 'mobile-apps',
    title: 'Mobile Apps & Driver PWA',
    category: 'operations',
    description: 'Native Android APK build, Driver App, Passenger App, and Counter RAC terminal PWAs.',
    href: '/mobile-apps',
    icon: <Smartphone className="w-5 h-5 text-pink-400" />,
    gradient: 'from-pink-500/15 to-rose-500/10',
    borderAccent: 'hover:border-pink-500/50',
    tags: ['Android APK', 'Driver PWA', 'Passenger App'],
    status: 'LIVE',
  },

  // ── 4. FLEET, ASSETS & WORKFORCE ──────────────────────────────────
  {
    id: 'fleet',
    title: 'Fleet & Vehicle Master',
    category: 'assets',
    description: 'Vehicle lifecycle inventory, Mulkiya & Insurance document vault, Salik tolls, fine reconciliation, and full TCO analysis.',
    href: '/fleet/vehicles',
    icon: <CarFront className="w-5 h-5 text-amber-400" />,
    gradient: 'from-amber-500/15 to-orange-500/10',
    borderAccent: 'hover:border-amber-500/50',
    tags: ['Inventory', 'Mulkiya Vault', 'Salik & Fines', 'TCO Engine'],
    status: 'LIVE',
    stats: [
      { label: 'Total Fleet', value: '1,420' },
      { label: 'Ready for Dispatch', value: '1,166' },
    ],
  },
  {
    id: 'maintenance',
    title: 'Maintenance & Work Orders',
    category: 'assets',
    description: 'Full garage workflow — service requests, workshop quotations, work orders, parts inventory, and predictive wear analytics.',
    href: '/maintenance',
    icon: <Wrench className="w-5 h-5 text-blue-400" />,
    gradient: 'from-blue-500/15 to-indigo-500/10',
    borderAccent: 'hover:border-blue-500/50',
    tags: ['Work Orders', 'Quotations', 'Parts Usage', 'QC Check'],
    status: 'LIVE',
    stats: [
      { label: 'In Workshop', value: '18' },
      { label: 'Avg Turnaround', value: '10 hrs' },
    ],
  },
  {
    id: 'driver-mgmt',
    title: 'Driver Operations & HOS',
    category: 'assets',
    description: 'Driver license & visa compliance, HOS shift logs, automated driver scoring, and performance telematics.',
    href: '/driver-mgmt',
    icon: <Users className="w-5 h-5 text-teal-400" />,
    gradient: 'from-teal-500/15 to-emerald-500/10',
    borderAccent: 'hover:border-teal-500/50',
    tags: ['Driver Scoring', 'HOS Logs', 'Document Vault'],
    status: 'LIVE',
  },
  {
    id: 'assets',
    title: 'Assets & Field Inventory',
    category: 'assets',
    description: 'High-Value Asset (HVA) calibration logs, BLE beacon tracking, medical supplies, and reverse logistics.',
    href: '/assets',
    icon: <Boxes className="w-5 h-5 text-teal-400" />,
    gradient: 'from-teal-500/15 to-cyan-500/10',
    borderAccent: 'hover:border-teal-500/50',
    tags: ['HVA Tracking', 'BLE Beacons', 'Inventory'],
    status: 'LIVE',
  },

  // ── 5. GOVERNANCE, ESG & COMPLIANCE ───────────────────────────────
  {
    id: 'compliance',
    title: 'RTA Compliance & Salik',
    category: 'governance',
    description: 'RTA commercial road permits, commercial vehicle inspections, insurance policies, and electronic document validation.',
    href: '/compliance',
    icon: <ShieldCheck className="w-5 h-5 text-blue-400" />,
    gradient: 'from-blue-500/15 to-cyan-500/10',
    borderAccent: 'hover:border-blue-500/50',
    tags: ['RTA Road Permits', 'Insurance Policies', 'Salik Tag Sync'],
    status: 'LIVE',
  },
  {
    id: 'sustainability',
    title: 'ESG & Carbon Intelligence',
    category: 'governance',
    description: 'GHG Protocol / ISO 14064 certified CO2 emission tracking, EV fleet transition roadmap, and UAE Net Zero 2050 metrics.',
    href: '/sustainability',
    icon: <Leaf className="w-5 h-5 text-emerald-400" />,
    gradient: 'from-emerald-500/15 to-teal-500/10',
    borderAccent: 'hover:border-emerald-500/50',
    tags: ['GHG Protocol', 'Scope 1/2/3', 'EV Transition'],
    status: 'LIVE',
  },
  {
    id: 'reports',
    title: 'Cross-Module BI Reports',
    category: 'governance',
    description: 'Fleet utilization heatmap, revenue analytics, maintenance cost breakdown, and automated PDF / Excel exports.',
    href: '/reports',
    icon: <BarChart3 className="w-5 h-5 text-fuchsia-400" />,
    gradient: 'from-fuchsia-500/15 to-purple-500/10',
    borderAccent: 'hover:border-fuchsia-500/50',
    tags: ['Fleet Analytics', 'Revenue BI', 'Scheduled Exports'],
    status: 'LIVE',
  },
  {
    id: 'customer-mgmt',
    title: 'Customer Master & CRM',
    category: 'governance',
    description: '3-tier hierarchy (Region, Department, Unit), credit limits, contract master, and communication history.',
    href: '/customer-mgmt',
    icon: <Building2 className="w-5 h-5 text-cyan-400" />,
    gradient: 'from-cyan-500/15 to-blue-500/10',
    borderAccent: 'hover:border-cyan-500/50',
    tags: ['3-Tier Hierarchy', 'Credit Master', 'Contracts'],
    status: 'LIVE',
  },

  // ── 6. ENTERPRISE & ADMIN ─────────────────────────────────────────
  {
    id: 'finance',
    title: 'Finance & VAT Billing',
    category: 'enterprise',
    description: 'Automated FTA-compliant Tax Invoices, Salik toll batch reconciliation, payment receipts, and revenue reports.',
    href: '/finance',
    icon: <CircleDollarSign className="w-5 h-5 text-emerald-400" />,
    gradient: 'from-emerald-500/15 to-green-500/10',
    borderAccent: 'hover:border-emerald-500/50',
    tags: ['FTA Tax Invoices', 'Salik Tolls', '5% VAT Engine'],
    status: 'LIVE',
  },
];

interface CategorySectionDef {
  id: 'intelligence' | 'services' | 'operations' | 'assets' | 'governance' | 'enterprise';
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  badgeText: string;
  description: string;
}

const PLATFORM_CATEGORIES: CategorySectionDef[] = [
  {
    id: 'intelligence',
    label: 'AI & Intelligence',
    shortLabel: 'Intelligence',
    icon: Bot,
    color: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
    badgeText: 'AUTONOMOUS COPILOTS',
    description: 'Autonomous AI copilots, platform governance, predictive maintenance triage & WhatsApp dispatch',
  },
  {
    id: 'services',
    label: 'Transport & Services',
    shortLabel: 'Services',
    icon: Bus,
    color: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    badgeText: 'LINES OF BUSINESS',
    description: 'Staff transport shuttles, student bus attendance, logistics freight & Rent-A-Car operations',
  },
  {
    id: 'operations',
    label: 'Core Fleet Operations',
    shortLabel: 'Operations',
    icon: Radio,
    color: 'text-sky-400 bg-sky-500/10 border-sky-500/20',
    badgeText: 'LIVE RADAR & DISPATCH',
    description: 'Live dispatch radar, carrier marketplace exchange, emergency response triage & driver PWAs',
  },
  {
    id: 'assets',
    label: 'Assets & People',
    shortLabel: 'Assets & People',
    icon: CarFront,
    color: 'text-teal-400 bg-teal-500/10 border-teal-500/20',
    badgeText: 'FLEET & WORKFORCE',
    description: 'Vehicle lifecycle master, workshop repair work orders, driver HOS shifts & BLE asset inventory',
  },
  {
    id: 'governance',
    label: 'Safety & Governance',
    shortLabel: 'Governance',
    icon: ShieldCheck,
    color: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    badgeText: 'COMPLIANCE & ESG',
    description: 'RTA commercial road permits, GHG carbon tracking, cross-module BI analytics & customer CRM',
  },
  {
    id: 'enterprise',
    label: 'Enterprise & Admin',
    shortLabel: 'Enterprise',
    icon: CircleDollarSign,
    color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    badgeText: 'FINANCE & BILLING',
    description: 'FTA tax invoices, Salik toll reconciliation, 5% VAT engine & platform enterprise settings',
  },
];

const CATEGORIES = [
  { id: 'all', label: 'All Modules', count: MODULES.length },
  ...PLATFORM_CATEGORIES.map(cat => ({
    id: cat.id,
    label: cat.label,
    count: MODULES.filter(m => m.category === cat.id).length,
  })),
];

export default function PlatformPage() {
  const { setLanguage, tLabel, isRTL } = useLanguage();
  const { tenant, isAuthenticated, isLoading } = usePermissions();
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Enforce English always unless tenant defaultLanguage is explicitly 'ar'
  useEffect(() => {
    if (isLoading) return;
    if (isAuthenticated && tenant?.defaultLanguage === 'ar') {
      setLanguage('ar');
    } else {
      setLanguage('en');
    }
  }, [isAuthenticated, tenant?.defaultLanguage, isLoading, setLanguage]);

  const openPalette = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('fleet360:open-command-palette'));
    }
  };

  const visibleCategories = PLATFORM_CATEGORIES.filter(
    cat => selectedCategory === 'all' || cat.id === selectedCategory
  );

  const getFilteredModulesForCategory = (categoryId: string) => {
    return MODULES.filter(mod => {
      if (mod.category !== categoryId) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        mod.title.toLowerCase().includes(q) ||
        mod.description.toLowerCase().includes(q) ||
        mod.tags.some(t => t.toLowerCase().includes(q))
      );
    });
  };

  const totalMatches = visibleCategories.reduce(
    (sum, cat) => sum + getFilteredModulesForCategory(cat.id).length,
    0
  );

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-main)] transition-colors duration-150 flex flex-col">
      {/* Top Enterprise Bar */}
      <nav className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center font-bold text-white text-xs shadow-md shadow-blue-500/20">
              F360
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[var(--text-main)] font-bold text-sm tracking-tight">Fleet360</span>
              <span className="text-[10px] font-mono font-bold bg-blue-500/10 text-blue-500 px-2 py-0.5 rounded-full border border-blue-500/20">
                {tLabel('ENTERPRISE')}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={openPalette}
              className="hidden md:flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] text-[var(--text-muted)] hover:text-[var(--text-main)] text-xs transition-all cursor-pointer group"
            >
              <Search className="w-3.5 h-3.5 text-[var(--text-muted)] group-hover:text-emerald-500 transition-colors" />
              <span>{tLabel('Omni Search')}</span>
              <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] font-mono text-[10px] text-[var(--text-muted)] group-hover:border-emerald-500/40">
                ⌘K
              </kbd>
            </button>

            <ThemeToggle />
            <Link 
              href="/approvals" 
              className="px-3 py-1.5 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] text-xs font-semibold text-[var(--text-main)] transition-all"
            >
              {tLabel('Approvals')}
            </Link>
            <Link 
              href="/admin" 
              className="px-3 py-1.5 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] text-xs font-semibold text-[var(--text-main)] transition-all"
            >
              {tLabel('Admin')}
            </Link>
            <PlatformSessionSlot />
          </div>
        </div>
      </nav>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-6 py-10 flex-1 w-full space-y-10">
        {/* Hero Section */}
        <div className="text-center max-w-3xl mx-auto space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-hover)]/60 px-3.5 py-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[var(--text-muted)] text-[11px] font-bold tracking-wide uppercase">
              {tLabel('Autonomous Transport & Fleet Operations')}
            </span>
          </div>

          <h1 className="text-3xl sm:text-4xl font-extrabold text-[var(--text-main)] tracking-tight">
            {tLabel('Fleet360 Platform Command')}
          </h1>
          <p className="text-[var(--text-muted)] text-sm leading-relaxed">
            {tLabel('Multi-modal transport operations, predictive maintenance, staff dispatch, and ESG fleet intelligence in one unified system.')}
          </p>

          {/* Search Bar Input */}
          <div className="pt-2 max-w-lg mx-auto">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={tLabel('Search modules, features, tariffs, permits, telematics...')}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl pl-10 pr-12 py-2.5 text-[var(--text-main)] placeholder-[var(--text-muted)] text-xs focus:outline-none focus:border-emerald-500/60 shadow-sm transition-all"
              />
              <button
                onClick={openPalette}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)]"
                title={tLabel('Open Universal Command Palette')}
              >
                ⌘K
              </button>
            </div>
          </div>
        </div>

        {/* Category Navigation Pills */}
        <div className="flex items-center justify-center gap-2 flex-wrap border-b border-[var(--border-subtle)] pb-4">
          {CATEGORIES.map(cat => {
            const isActive = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-500 shadow-sm'
                    : 'bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:border-[var(--border-strong)]'
                }`}
              >
                <span>{tLabel(cat.label)}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${isActive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)]'}`}>
                  {cat.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Empty State */}
        {totalMatches === 0 && (
          <div className="py-16 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] flex items-center justify-center mx-auto text-[var(--text-muted)]">
              <Search className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-[var(--text-main)]">{tLabel('No modules found')}</h3>
            <p className="text-xs text-[var(--text-muted)] max-w-sm mx-auto">
              {tLabel('No modules matched')} &quot;{searchQuery}&quot;.
            </p>
            <button
              onClick={() => { setSearchQuery(''); setSelectedCategory('all'); }}
              className="px-3.5 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold hover:bg-emerald-500/20 transition-all"
            >
              {tLabel('Reset Filters')}
            </button>
          </div>
        )}

        {/* Categorized Widget Sections */}
        {visibleCategories.map(cat => {
          const catModules = getFilteredModulesForCategory(cat.id);
          if (catModules.length === 0) return null;
          const CatIcon = cat.icon;

          return (
            <section key={cat.id} className="space-y-4">
              {/* Category Section Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-3.5">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-xl border ${cat.color} flex items-center justify-center flex-shrink-0 shadow-sm`}>
                    <CatIcon className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2.5">
                      <h2 className="text-base sm:text-lg font-extrabold text-[var(--text-main)] tracking-tight">
                        {tLabel(cat.label)}
                      </h2>
                      <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-muted)]">
                        {catModules.length} {tLabel(catModules.length === 1 ? 'Module' : 'Modules')}
                      </span>
                      <span className="hidden md:inline-block text-[9px] font-mono font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        {tLabel(cat.badgeText)}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      {tLabel(cat.description)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Bento Grid Module Cards for this Category */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {catModules.map(mod => {
                  const isFlagship = mod.flagship;

                  return (
                    <div
                      key={mod.id}
                      className={`group relative bg-[var(--bg-surface)] border border-[var(--border-subtle)] ${mod.borderAccent} rounded-2xl p-5 hover:shadow-xl transition-all duration-200 flex flex-col justify-between ${
                        isFlagship ? 'shadow-sm' : ''
                      }`}
                    >
                      <div>
                        {/* Card Header: Icon + Status Pill */}
                        <div className="flex items-start justify-between gap-3 mb-3.5">
                          <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${mod.gradient} border border-[var(--border-subtle)] flex items-center justify-center flex-shrink-0 shadow-sm`}>
                            {mod.icon}
                          </div>

                          <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            <span className="text-emerald-500 text-[10px] font-bold font-mono tracking-wider">{tLabel(mod.status)}</span>
                          </div>
                        </div>

                        {/* Title & Description */}
                        <Link href={mod.href} className="block group-hover:text-emerald-500 transition-colors">
                          <div className="flex items-center justify-between">
                            <h3 className="text-[var(--text-main)] font-bold text-base tracking-tight group-hover:text-emerald-500 transition-colors">
                              {tLabel(mod.title)}
                            </h3>
                            <ArrowUpRight className="w-4 h-4 text-[var(--text-muted)] group-hover:text-emerald-500 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
                          </div>
                          <p className="text-[var(--text-muted)] text-xs mt-1.5 leading-relaxed line-clamp-2">
                            {tLabel(mod.description)}
                          </p>
                        </Link>

                        {/* Feature Tags */}
                        <div className="flex flex-wrap gap-1.5 mt-3.5 mb-4">
                          {mod.tags.map(tag => (
                            <span 
                              key={tag}
                              className="text-[10px] font-medium bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-muted)] rounded-md px-2 py-0.5"
                            >
                              {tLabel(tag)}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Bottom Stats Grid (if available) */}
                      {mod.stats && mod.stats.length > 0 && (
                        <div className="border-t border-[var(--border-subtle)] pt-3 mt-auto">
                          <div className={`grid ${mod.stats.length >= 4 ? 'grid-cols-4' : mod.stats.length === 3 ? 'grid-cols-3' : 'grid-cols-2'} gap-2`}>
                            {mod.stats.map(stat => (
                              <div key={stat.label} className="min-w-0">
                                <p className="text-[9px] uppercase font-bold text-[var(--text-muted)] truncate">{tLabel(stat.label)}</p>
                                <p className="text-xs font-bold font-mono text-[var(--text-main)] mt-0.5 truncate">{tLabel(String(stat.value))}</p>
                              </div>
                            ))}
                          </div>

                          {/* Quick Action Buttons for Flagship Modules */}
                          {mod.quickActions && mod.quickActions.length > 0 && (
                            <div className="flex items-center gap-2 mt-3 pt-2.5 border-t border-[var(--border-subtle)]">
                              {mod.quickActions.map(action => (
                                <Link
                                  key={action.label}
                                  href={action.href}
                                  className="px-2.5 py-1 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] hover:border-emerald-500/40 text-[10px] font-semibold text-[var(--text-main)] hover:text-emerald-500 transition-all"
                                >
                                  {tLabel(action.label)}
                                </Link>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}

        {/* Footer */}
        <footer className="border-t border-[var(--border-subtle)] pt-6 mt-12 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[var(--text-muted)]">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>Fleet360 Enterprise Platform v2.0</span>
          </div>
          <div className="flex items-center gap-4">
            <span>Next.js 15 App Router</span>
            <span>·</span>
            <span>PostgreSQL & Prisma Multi-Tenant</span>
            <span>·</span>
            <span>Aura Dual-Mode Engine</span>
          </div>
        </footer>
      </main>
    </div>
  );
}
