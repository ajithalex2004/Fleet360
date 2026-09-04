'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';
import PlatformSessionSlot from './PlatformSessionSlot';
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
  category: 'commercial' | 'dispatch' | 'fleet' | 'intelligence' | 'governance';
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
  {
    id: 'rental',
    title: 'Rent-A-Car (RAC) Operations',
    category: 'commercial',
    description: 'Fleet RAC desk, dynamic tariffs, customer KYC, cross-border permits (Oman/KSA), damage claims, and automated traffic fine billing.',
    href: '/rental/bookings',
    icon: <Car className="w-5 h-5 text-emerald-400" />,
    gradient: 'from-emerald-500/20 to-teal-500/10',
    borderAccent: 'hover:border-emerald-500/50',
    tags: ['Daily/Weekly RAC', 'KYC Verification', 'Cross-Border Permits', 'Damage Claims'],
    status: 'LIVE',
    flagship: true,
    stats: [
      { label: 'RAC Fleet Size', value: '1,166' },
      { label: 'Active Bookings', value: '586' },
      { label: 'Fleet Utilization', value: '89.4%' },
      { label: 'Avg Daily Rate', value: 'AED 185' },
    ],
    quickActions: [
      { label: '+ New Booking', href: '/rental/bookings' },
      { label: 'Tariff Master', href: '/rental' },
      { label: 'Issue Permit', href: '/rental/bookings' },
    ],
  },
  {
    id: 'agents',
    title: 'AI Agent Ecosystem & Copilot',
    category: 'intelligence',
    description: '10 autonomous AI copilots — predictive maintenance, smart dispatch optimizer, accident triage, WhatsApp RAC booking assistant, and compliance ratchets.',
    href: '/agents',
    icon: <Bot className="w-5 h-5 text-violet-400" />,
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
    id: 'exchange',
    title: 'Fleet360 Exchange & Marketplace',
    category: 'commercial',
    description: 'Private transport partner network & outsourced dispatch marketplace — Blind RFQ bidding, zone rate cards, zero-login driver tracking, and UAE FTA Tax Invoices.',
    href: '/exchange/dashboard',
    icon: <Network className="w-5 h-5 text-cyan-400" />,
    gradient: 'from-cyan-500/20 to-blue-500/10',
    borderAccent: 'hover:border-cyan-500/50',
    tags: ['Partner Network', 'Blind RFQ', 'FTA Tax Invoices', 'Scorecards'],
    status: 'LIVE',
    flagship: true,
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
    id: 'fleet',
    title: 'Fleet & Vehicle Master',
    category: 'fleet',
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
    category: 'fleet',
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
    id: 'leasing',
    title: 'Vehicle Long-Term Leasing',
    category: 'commercial',
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
    id: 'logistics',
    title: 'Logistics & Freight Ops',
    category: 'dispatch',
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
    id: 'dispatch',
    title: 'Dispatch Control Center',
    category: 'dispatch',
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
    id: 'bus-ops',
    title: 'Staff Transportation',
    category: 'dispatch',
    description: 'Fixed corporate bus route schedules, passenger manifests, shift roster synchronization, and live boarding tracking.',
    href: '/bus-ops',
    icon: <Bus className="w-5 h-5 text-indigo-400" />,
    gradient: 'from-indigo-500/15 to-blue-500/10',
    borderAccent: 'hover:border-indigo-500/50',
    tags: ['Staff Shuttles', 'Shift Sync', 'Passenger Manifest'],
    status: 'LIVE',
  },
  {
    id: 'school-bus',
    title: 'School Bus Transportation',
    category: 'dispatch',
    description: 'Student safety registry, RFID badge attendance tracking, guardian WhatsApp SMS alerts, and DOT safety compliance.',
    href: '/school-bus',
    icon: <GraduationCap className="w-5 h-5 text-amber-400" />,
    gradient: 'from-amber-500/15 to-yellow-500/10',
    borderAccent: 'hover:border-amber-500/50',
    tags: ['Student RFID', 'Guardian Alerts', 'DOT Safety'],
    status: 'LIVE',
  },
  {
    id: 'driver-mgmt',
    title: 'Driver Operations & HOS',
    category: 'fleet',
    description: 'Driver license & visa compliance, HOS shift logs, automated driver scoring, and performance telematics.',
    href: '/driver-mgmt',
    icon: <Users className="w-5 h-5 text-teal-400" />,
    gradient: 'from-teal-500/15 to-emerald-500/10',
    borderAccent: 'hover:border-teal-500/50',
    tags: ['Driver Scoring', 'HOS Logs', 'Document Vault'],
    status: 'LIVE',
  },
  {
    id: 'incidents',
    title: 'Incident & Ambulance Ops',
    category: 'dispatch',
    description: 'Emergency response coordination, ambulance dispatch, on-scene collision intake, and police report documentation.',
    href: '/incidents',
    icon: <ShieldAlert className="w-5 h-5 text-rose-400" />,
    gradient: 'from-rose-500/15 to-red-500/10',
    borderAccent: 'hover:border-rose-500/50',
    tags: ['Emergency 999', 'Ambulance Unit', 'Police Reports'],
    status: 'LIVE',
  },
  {
    id: 'finance',
    title: 'Finance & VAT Billing',
    category: 'governance',
    description: 'Automated FTA-compliant Tax Invoices, Salik toll batch reconciliation, payment receipts, and revenue reports.',
    href: '/finance',
    icon: <CircleDollarSign className="w-5 h-5 text-emerald-400" />,
    gradient: 'from-emerald-500/15 to-green-500/10',
    borderAccent: 'hover:border-emerald-500/50',
    tags: ['FTA Tax Invoices', 'Salik Tolls', '5% VAT Engine'],
    status: 'LIVE',
  },
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
    category: 'intelligence',
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
    category: 'intelligence',
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
    category: 'commercial',
    description: '3-tier hierarchy (Region, Department, Unit), credit limits, contract master, and communication history.',
    href: '/customer-mgmt',
    icon: <Building2 className="w-5 h-5 text-cyan-400" />,
    gradient: 'from-cyan-500/15 to-blue-500/10',
    borderAccent: 'hover:border-cyan-500/50',
    tags: ['3-Tier Hierarchy', 'Credit Master', 'Contracts'],
    status: 'LIVE',
  },
  {
    id: 'booking-portal',
    title: 'Unified Booking Portal',
    category: 'commercial',
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
    category: 'commercial',
    description: 'Native Android APK build, Driver App, Passenger App, and Counter RAC terminal PWAs.',
    href: '/mobile-apps',
    icon: <Smartphone className="w-5 h-5 text-pink-400" />,
    gradient: 'from-pink-500/15 to-rose-500/10',
    borderAccent: 'hover:border-pink-500/50',
    tags: ['Android APK', 'Driver PWA', 'Passenger App'],
    status: 'LIVE',
  },
  {
    id: 'assets',
    title: 'Assets & Field Inventory',
    category: 'fleet',
    description: 'High-Value Asset (HVA) calibration logs, BLE beacon tracking, medical supplies, and reverse logistics.',
    href: '/assets',
    icon: <Boxes className="w-5 h-5 text-teal-400" />,
    gradient: 'from-teal-500/15 to-cyan-500/10',
    borderAccent: 'hover:border-teal-500/50',
    tags: ['HVA Tracking', 'BLE Beacons', 'Inventory'],
    status: 'LIVE',
  },
];

const CATEGORIES = [
  { id: 'all', label: 'All Modules', count: MODULES.length },
  { id: 'commercial', label: 'Commercial & RAC', count: MODULES.filter(m => m.category === 'commercial').length },
  { id: 'dispatch', label: 'Dispatch & Logistics', count: MODULES.filter(m => m.category === 'dispatch').length },
  { id: 'fleet', label: 'Fleet & Tech', count: MODULES.filter(m => m.category === 'fleet').length },
  { id: 'intelligence', label: 'AI & Intelligence', count: MODULES.filter(m => m.category === 'intelligence').length },
  { id: 'governance', label: 'Finance & Compliance', count: MODULES.filter(m => m.category === 'governance').length },
];

export default function PlatformPage() {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const openPalette = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('fleet360:open-command-palette'));
    }
  };

  const filteredModules = MODULES.filter(mod => {
    const matchesCategory = selectedCategory === 'all' || mod.category === selectedCategory;
    const matchesSearch = !searchQuery.trim() || 
      mod.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      mod.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      mod.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-main)] transition-colors duration-150 flex flex-col">
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
                ENTERPRISE
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={openPalette}
              className="hidden md:flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] text-[var(--text-muted)] hover:text-[var(--text-main)] text-xs transition-all cursor-pointer group"
            >
              <Search className="w-3.5 h-3.5 text-[var(--text-muted)] group-hover:text-emerald-500 transition-colors" />
              <span>Omni Search</span>
              <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] font-mono text-[10px] text-[var(--text-muted)] group-hover:border-emerald-500/40">
                ⌘K
              </kbd>
            </button>

            <ThemeToggle />
            <Link 
              href="/approvals" 
              className="px-3 py-1.5 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] text-xs font-semibold text-[var(--text-main)] transition-all"
            >
              Approvals
            </Link>
            <Link 
              href="/admin" 
              className="px-3 py-1.5 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] text-xs font-semibold text-[var(--text-main)] transition-all"
            >
              Admin
            </Link>
            <PlatformSessionSlot />
          </div>
        </div>
      </nav>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-6 py-10 flex-1 w-full space-y-8">
        {/* Hero Section */}
        <div className="text-center max-w-3xl mx-auto space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-hover)]/60 px-3.5 py-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[var(--text-muted)] text-[11px] font-bold tracking-wide uppercase">
              Autonomous Transport & Fleet Operations
            </span>
          </div>

          <h1 className="text-3xl sm:text-4xl font-extrabold text-[var(--text-main)] tracking-tight">
            Fleet360 Platform Command
          </h1>
          <p className="text-[var(--text-muted)] text-sm leading-relaxed">
            Multi-modal transport operations, predictive maintenance, staff dispatch, and ESG fleet intelligence in one unified system.
          </p>

          {/* Search Bar Input */}
          <div className="pt-2 max-w-lg mx-auto">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search modules, features, tariffs, permits, telematics..."
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl pl-10 pr-12 py-2.5 text-[var(--text-main)] placeholder-[var(--text-muted)] text-xs focus:outline-none focus:border-emerald-500/60 shadow-sm transition-all"
              />
              <button
                onClick={openPalette}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)]"
                title="Open Universal Command Palette"
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
                <span>{cat.label}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${isActive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)]'}`}>
                  {cat.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Bento Grid Module Layout */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredModules.map(mod => {
            const isFlagship = mod.flagship;

            return (
              <div
                key={mod.id}
                className={`group relative bg-[var(--bg-surface)] border border-[var(--border-subtle)] ${mod.borderAccent} rounded-2xl p-5 hover:shadow-xl transition-all duration-200 flex flex-col justify-between ${
                  isFlagship ? 'lg:col-span-1 shadow-sm' : ''
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
                      <span className="text-emerald-500 text-[10px] font-bold font-mono tracking-wider">{mod.status}</span>
                    </div>
                  </div>

                  {/* Title & Description */}
                  <Link href={mod.href} className="block group-hover:text-emerald-500 transition-colors">
                    <div className="flex items-center justify-between">
                      <h3 className="text-[var(--text-main)] font-bold text-base tracking-tight group-hover:text-emerald-500 transition-colors">
                        {mod.title}
                      </h3>
                      <ArrowUpRight className="w-4 h-4 text-[var(--text-muted)] group-hover:text-emerald-500 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
                    </div>
                    <p className="text-[var(--text-muted)] text-xs mt-1.5 leading-relaxed line-clamp-2">
                      {mod.description}
                    </p>
                  </Link>

                  {/* Feature Tags */}
                  <div className="flex flex-wrap gap-1.5 mt-3.5 mb-4">
                    {mod.tags.map(tag => (
                      <span 
                        key={tag}
                        className="text-[10px] font-medium bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-muted)] rounded-md px-2 py-0.5"
                      >
                        {tag}
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
                          <p className="text-[9px] uppercase font-bold text-[var(--text-muted)] truncate">{stat.label}</p>
                          <p className="text-xs font-bold font-mono text-[var(--text-main)] mt-0.5 truncate">{stat.value}</p>
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
                            {action.label}
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
