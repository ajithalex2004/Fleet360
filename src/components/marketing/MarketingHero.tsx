'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import type { HomepageSnapshot } from '@/lib/public-homepage';

const Arrow = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h13M14 7l5 5-5 5" />
  </svg>
);

interface StageTabDef {
  id: number;
  shortLabel: string;
  badge: string;
  title: string;
  subtitle: string;
  metrics: Array<{ code: string; detail: string; status: string; tone: 'cyan' | 'emerald' | 'purple' | 'amber' }>;
}

const STAGE_TABS: StageTabDef[] = [
  {
    id: 0,
    shortLabel: '1. Drayage Radar',
    badge: 'TAB 1 · LIVE CORRIDOR RADAR (/logistics/drayage/tracking)',
    title: 'Real-Time Coupled Prime Movers & Detached Ramp Chassis',
    subtitle: 'Track moving tractors on E11/E311 alongside uncoupled skeletal trailers dropped at customer ramps with live offload ETC countdowns.',
    metrics: [
      {
        code: 'DXB-767-4011',
        detail: 'Coupled w/ DXB-TR-9901 · MSCU8492014 · 72 km/h on E11',
        status: 'IN_TRANSIT',
        tone: 'cyan',
      },
      {
        code: 'DXB-767-4012',
        detail: '2×20FT Bogie Tether · 36.8T Payload on E311 Spine',
        status: 'BOGIE_PAIRED',
        tone: 'emerald',
      },
      {
        code: 'DXB-TR-9902',
        detail: 'Detached at NIP Mega DC Ramp 07 · Live Offload ETC: 01h 42m',
        status: 'DETACHED_AT_RAMP',
        tone: 'purple',
      },
    ],
  },
  {
    id: 1,
    shortLabel: '2. PCS Gate Tokens',
    badge: 'TAB 2 · PCS & GATE AUTOMATION (/logistics/drayage/containers)',
    title: 'Dubai Trade & AD Ports ATLP e-Token & Customs Clearance',
    subtitle: 'Book automated terminal gate slots, clear multi-agency Customs/Municipality/CPIP inspections, and guard against Delivery Order (eDO) expiry.',
    metrics: [
      {
        code: 'DT-TKN-884120',
        detail: 'DP World Jebel Ali T1 · Automated Gate Slot 08:00–09:00 GST',
        status: 'SLOT_BOOKED',
        tone: 'cyan',
      },
      {
        code: 'CPIP Seal #DM-99812',
        detail: 'Multi-Agency Customs & Dubai Municipality Inspection Cleared',
        status: 'CLEARED',
        tone: 'emerald',
      },
      {
        code: 'eDO Validity Guard',
        detail: '72h Remaining · Automated Revalidation Workflow Ready',
        status: 'VALID_EDO',
        tone: 'amber',
      },
    ],
  },
  {
    id: 2,
    shortLabel: '3. AI Co-Pilot',
    badge: 'TAB 3 · GOVERNED AI ORCHESTRATOR (/agents)',
    title: '6 Specialized AI Agents Coordinating Dispatch & Maintenance',
    subtitle: 'Policy-controlled AI agents detect exceptions, triangulate empty containers to exports, and automate driver trip settlements.',
    metrics: [
      {
        code: 'Dispatch AI Agent',
        detail: 'Matched Import Empty HLXU9034118 to Export (-42 km Deadhead)',
        status: 'STREET_TURN',
        tone: 'emerald',
      },
      {
        code: 'Maintenance AI Agent',
        detail: 'Predictive DPF Service Scheduled at Jebel Ali Workshop',
        status: 'READY_99.7%',
        tone: 'cyan',
      },
      {
        code: 'Finance Settlement AI',
        detail: 'Auto-Verified AED 145 Driver Bogie + Port Gate Allowance',
        status: 'RECONCILED',
        tone: 'purple',
      },
    ],
  },
];

const RADAR_UNITS = [
  {
    id: 'u0',
    plate: 'DXB-767-4011',
    label: 'DXB-767-4011 (72km/h)',
    summary: 'Prime Mover Coupled w/ DXB-TR-9901 · Container MSCU8492014 · E11 → D53 Corridor · Fuel 84%',
    cx: 175,
    cy: 96,
    color: '#3B82F6',
    textColor: '#f8fafc',
  },
  {
    id: 'u1',
    plate: 'DXB-767-4012',
    label: '2×20FT BOGIE',
    summary: 'Volvo FH16 Coupled w/ 45FT Chassis DXB-TR-9905 · CMAU2210941 + TGHU1904422 (36.8T) · E311 Spine',
    cx: 295,
    cy: 102,
    color: '#06B6D4',
    textColor: '#67e8f9',
  },
  {
    id: 'u2',
    plate: 'DXB-767-4013',
    label: 'STREET-TURN (-42km)',
    summary: 'Scania R500 · Import Empty HLXU9034118 Triangulated to Export Booking DRY-EXP-1001 · D57 Expo Rd',
    cx: 270,
    cy: 162,
    color: '#10B981',
    textColor: '#6ee7b7',
  },
  {
    id: 'u3',
    plate: 'DXB-TR-9902',
    label: 'DETACHED RAMP 07',
    summary: 'Standalone Skeletal Chassis Pinned at NIP Mega DC Bay Ramp 07 · Live Offload ETC: 01h 42m remaining',
    cx: 395,
    cy: 84,
    color: '#A855F7',
    textColor: '#e9d5ff',
  },
];

const BENTO_CARDS = [
  {
    index: '01 // PORT & DRAYAGE',
    accent: 'text-cyan-400',
    borderHover: 'hover:border-cyan-500/40',
    title: 'Coupled & Detached Telemetry',
    description:
      'Real-time tracking of Prime Movers on E11/E311 and uncoupled skeletal trailers at customer ramps with live ETC offload timers.',
    href: '/logistics/drayage/tracking',
  },
  {
    index: '02 // PCS GATE AUTOMATION',
    accent: 'text-emerald-400',
    borderHover: 'hover:border-emerald-500/40',
    title: 'Dubai Trade & Maqta ATLP',
    description:
      'Automated gate slot booking, Customs/Municipality/CPIP seal clearance, and proactive Delivery Order (eDO) expiry protection.',
    href: '/logistics/drayage/containers',
  },
  {
    index: '03 // BOGIE & STREET-TURN',
    accent: 'text-indigo-400',
    borderHover: 'hover:border-indigo-500/40',
    title: 'Zero Empty Port Deadhead',
    description:
      'Pair 2×20ft containers on 45ft heavy chassis (up to 42T) and triangulate import empty containers directly to export bookings.',
    href: '/logistics/drayage/assignment',
  },
  {
    index: '04 // MULTI-VERTICAL SAAS',
    accent: 'text-amber-400',
    borderHover: 'hover:border-amber-500/40',
    title: 'Modular Tenant Provisioning',
    description:
      'Onboard standalone Port Drayage tenants or full-suite Enterprise Fleets with strict PostgreSQL RLS multi-tenant isolation.',
    href: '/platform',
  },
];

export default function MarketingHero({ snapshot }: { snapshot: HomepageSnapshot }) {
  const [activeTab, setActiveTab] = useState<number>(0);
  const [selectedRadarUnit, setSelectedRadarUnit] = useState<number>(0);

  const currentStage = STAGE_TABS[activeTab] ?? STAGE_TABS[0];
  const currentUnit = RADAR_UNITS[selectedRadarUnit] ?? RADAR_UNITS[0];

  const toneBadgeClass = (tone: 'cyan' | 'emerald' | 'purple' | 'amber') => {
    if (tone === 'emerald') return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
    if (tone === 'purple') return 'bg-purple-500/15 text-purple-300 border-purple-500/30';
    if (tone === 'amber') return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
    return 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30';
  };

  return (
    <main className="bg-slate-950 text-slate-100 selection:bg-cyan-500/30 selection:text-cyan-200">
      <section
        aria-labelledby="hero-title"
        className="relative overflow-hidden border-b border-slate-800/80 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-cyan-950/45 via-slate-950 to-slate-950"
      >
        {/* Ambient Spatial Light Beams */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-40 right-10 h-96 w-96 rounded-full bg-cyan-500/10 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-40 -left-20 h-96 w-96 rounded-full bg-blue-600/10 blur-3xl"
        />

        {/* Floating Spatial Glass Header */}
        <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/75 backdrop-blur-xl">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4 text-xs">
            <Link href="/" aria-label="Fleet360 home" className="flex items-center gap-3 group">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 font-mono text-sm font-black text-slate-950 shadow-md shadow-cyan-500/20 transition-transform group-hover:scale-105">
                F3
              </div>
              <span className="text-sm font-black tracking-widest text-white">
                FLEET<span className="text-cyan-400">360</span>
              </span>
              <span className="hidden sm:inline-block rounded-full border border-cyan-400/30 bg-cyan-500/15 px-2.5 py-0.5 font-mono text-xs font-semibold text-cyan-300">
                AI MOBILITY OS
              </span>
            </Link>

            <nav aria-label="Primary navigation" className="hidden md:flex items-center gap-7 font-medium text-slate-300">
              <Link href="/platform" className="transition-colors hover:text-cyan-400">
                Platform
              </Link>
              <Link href="/logistics/drayage" className="transition-colors hover:text-cyan-400">
                Port &amp; Container Drayage
              </Link>
              <Link href="/agents" className="transition-colors hover:text-cyan-400">
                6 Governed AI Agents
              </Link>
              <Link href="/ai-platform" className="transition-colors hover:text-cyan-400">
                Governed AI &amp; GCC
              </Link>
            </nav>

            <div className="flex items-center gap-2.5">
              <Link
                href="/login"
                data-analytics-cta="hero_signin"
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-2 font-semibold text-slate-200 transition-all hover:border-cyan-400/50 hover:bg-slate-800 hover:text-white"
              >
                Sign In
              </Link>
              <Link
                href="/operations-review"
                data-analytics-cta="hero_header_operations_review"
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 px-4 py-2 font-bold text-white shadow-lg shadow-cyan-500/20 transition-all hover:from-blue-500 hover:to-cyan-400"
              >
                <span>Book Operations Review</span>
                <Arrow />
              </Link>
            </div>
          </div>
        </header>

        {/* Main Hero Grid: Left Copy + Right Interactive 3-Tab Live Product Stage */}
        <div className="mx-auto max-w-7xl px-6 py-10 lg:py-16 space-y-12">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            {/* Left Column: Hero Messaging, CTAs & Live Telemetry Counters */}
            <div className="lg:col-span-6 space-y-6">
              <div className="inline-flex items-center gap-2.5 rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3.5 py-1.5 text-xs font-semibold text-cyan-300">
                <span className="h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
                <span>NEW: Standalone Port Drayage + Dubai Trade / ATLP e-Token Automation</span>
              </div>

              <div className="space-y-4">
                <p className="font-mono text-xs font-bold uppercase tracking-widest text-cyan-400">
                  Smart Mobility Hub · Multi-Tenant Command Layer
                </p>
                <h1
                  id="hero-title"
                  className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-white leading-[1.12]"
                >
                  One Autonomous Command Layer for{' '}
                  <span className="bg-gradient-to-r from-cyan-400 via-blue-400 to-indigo-400 bg-clip-text text-transparent">
                    Every Vehicle, Container &amp; Route.
                  </span>
                </h1>
                <p className="text-base lg:text-lg text-slate-300 font-medium leading-relaxed">
                  Unify Prime Movers, Skeletal Chassis &amp; Container Tracking powered by Governed AI agents
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3.5 pt-1 text-xs sm:text-sm">
                <Link
                  href="/operations-review"
                  data-analytics-cta="hero_operations_review"
                  className="inline-flex items-center gap-2 rounded-xl bg-cyan-400 px-5 py-3 font-black text-slate-950 shadow-lg shadow-cyan-400/20 transition-all hover:bg-cyan-300"
                >
                  <span>Book an operations review</span>
                  <Arrow />
                </Link>
                <Link
                  href="/platform"
                  data-analytics-cta="hero_platform"
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/90 px-5 py-3 font-semibold text-slate-200 transition-all hover:border-cyan-400 hover:text-white"
                >
                  <span>Explore the platform</span>
                  <Arrow />
                </Link>
              </div>

              {/* Live Operations Snapshot Ribbon */}
              <div
                aria-label={`${snapshot.source === 'configured' ? 'Live' : 'Illustrative'} operations snapshot`}
                className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-5 border-t border-slate-800/80 text-xs"
              >
                <div className="rounded-xl border border-slate-800/90 bg-slate-900/60 p-3">
                  <div className="font-mono text-xl font-black text-cyan-400">
                    {snapshot.vehiclesLive.toLocaleString()}+
                  </div>
                  <div className="text-slate-400 mt-0.5">Vehicles Live</div>
                </div>
                <div className="rounded-xl border border-slate-800/90 bg-slate-900/60 p-3">
                  <div className="font-mono text-xl font-black text-emerald-400">{snapshot.uptime}%</div>
                  <div className="text-slate-400 mt-0.5">Fleet Uptime SLA</div>
                </div>
                <div className="rounded-xl border border-slate-800/90 bg-slate-900/60 p-3">
                  <div className="font-mono text-xl font-black text-blue-400">-{snapshot.lowerOperatingCosts}%</div>
                  <div className="text-slate-400 mt-0.5">Operating Costs</div>
                </div>
                <div className="rounded-xl border border-slate-800/90 bg-slate-900/60 p-3">
                  <div className="font-mono text-xl font-black text-indigo-400">{snapshot.fleetUtilization}%</div>
                  <div className="text-slate-400 mt-0.5">Fleet Utilization</div>
                </div>
              </div>
            </div>

            {/* Right Column: Interactive 3-Tab Live Product Stage */}
            <div className="lg:col-span-6 rounded-2xl border border-slate-700/80 bg-slate-900/90 p-4 sm:p-5 shadow-2xl backdrop-blur-xl space-y-4">
              {/* Stage Header & 3 Interactive Mode Tabs */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3 text-xs">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="font-mono font-bold tracking-wider text-cyan-400">
                    LIVE INTERACTIVE PRODUCT STAGE
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Interactive product stage views">
                  {STAGE_TABS.map((tab) => {
                    const isActive = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        onClick={() => setActiveTab(tab.id)}
                        className={`rounded-lg px-2.5 py-1.5 font-bold transition-all text-xs ${
                          isActive
                            ? 'bg-cyan-400 text-slate-950 shadow-sm'
                            : 'bg-slate-800/90 text-slate-300 hover:bg-slate-700 hover:text-white'
                        }`}
                      >
                        {tab.shortLabel}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Interactive UAE Freight Corridor Radar Canvas */}
              <div className="rounded-xl overflow-hidden border border-slate-800 bg-slate-950 relative">
                <svg
                  viewBox="0 0 540 220"
                  className="w-full h-[205px] block select-none"
                  aria-label="UAE Drayage Corridor Live Radar Map"
                >
                  <defs>
                    <pattern id="heroRadarGrid" width="36" height="36" patternUnits="userSpaceOnUse">
                      <path d="M 36 0 L 0 0 0 36" fill="none" stroke="#1e293b" strokeWidth="0.8" />
                    </pattern>
                  </defs>
                  <rect width="540" height="220" fill="#060b14" />
                  <rect width="540" height="220" fill="url(#heroRadarGrid)" />

                  {/* Arabian Gulf Coast Contour */}
                  <path d="M 0,0 L 210,0 L 145,75 L 75,140 L 0,190 Z" fill="#0c192c" opacity="0.7" />
                  <text x="16" y="26" fill="#38bdf8" opacity="0.5" fontSize="11" fontFamily="monospace">
                    JEBEL ALI MARITIME APPROACH
                  </text>

                  {/* E11 Corridor */}
                  <polyline
                    points="25,180 165,105 335,60 510,22"
                    fill="none"
                    stroke="#3B82F6"
                    strokeWidth="4"
                    strokeLinecap="round"
                    opacity="0.8"
                  />
                  <text x="148" y="88" fill="#60A5FA" fontSize="11" fontWeight="bold">
                    E11 Corridor
                  </text>

                  {/* E311 Central Spine */}
                  <polyline
                    points="85,205 255,132 410,76 520,38"
                    fill="none"
                    stroke="#10B981"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    opacity="0.8"
                  />
                  <text x="258" y="122" fill="#34D399" fontSize="11" fontWeight="bold">
                    E311 Spine
                  </text>

                  {/* D53 Al Yalayis Connector */}
                  <polyline
                    points="115,82 175,96 295,102 395,84"
                    fill="none"
                    stroke="#818CF8"
                    strokeWidth="2.5"
                    strokeDasharray="5,4"
                    opacity="0.85"
                  />

                  {/* Cyan Dashed Tether for 2x20FT Bogie */}
                  <line
                    x1="295"
                    y1="102"
                    x2="395"
                    y2="84"
                    stroke="#22D3EE"
                    strokeWidth="2.5"
                    strokeDasharray="6,4"
                  />

                  {/* Emerald Flightpath for Street-Turn */}
                  <path
                    d="M 270,162 Q 345,130 435,172"
                    fill="none"
                    stroke="#10B981"
                    strokeWidth="2.5"
                    strokeDasharray="6,4"
                  />

                  {/* Port & Ramp Geofence Rings */}
                  <circle
                    cx="115"
                    cy="82"
                    r="24"
                    fill="#0284c7"
                    fillOpacity="0.15"
                    stroke="#38bdf8"
                    strokeWidth="1.2"
                    strokeDasharray="4,3"
                  />
                  <text x="72" y="52" fill="#7dd3fc" fontSize="11" fontWeight="bold">
                    DP World Jebel Ali
                  </text>

                  <circle
                    cx="395"
                    cy="84"
                    r="22"
                    fill="#9333ea"
                    fillOpacity="0.15"
                    stroke="#c084fc"
                    strokeWidth="1.2"
                    strokeDasharray="4,3"
                  />

                  {/* Interactive Asset Markers */}
                  {RADAR_UNITS.map((u, idx) => {
                    const isSel = selectedRadarUnit === idx;
                    return (
                      <g
                        key={u.id}
                        onClick={() => setSelectedRadarUnit(idx)}
                        style={{ cursor: 'pointer' }}
                        role="button"
                        tabIndex={0}
                        aria-label={`Inspect ${u.plate}`}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') setSelectedRadarUnit(idx);
                        }}
                      >
                        {isSel && (
                          <circle
                            cx={u.cx}
                            cy={u.cy}
                            r="16"
                            fill="none"
                            stroke="#ffffff"
                            strokeWidth="2"
                            strokeDasharray="4,2"
                          />
                        )}
                        <circle
                          cx={u.cx}
                          cy={u.cy}
                          r={isSel ? 9 : 7.5}
                          fill={u.color}
                          stroke="#ffffff"
                          strokeWidth="2"
                        />
                        <text
                          x={u.cx}
                          y={idx % 2 === 0 ? u.cy + 21 : u.cy - 13}
                          textAnchor="middle"
                          fill={u.textColor}
                          fontSize="11"
                          fontFamily="monospace"
                          fontWeight="bold"
                        >
                          {u.label}
                        </text>
                      </g>
                    );
                  })}
                </svg>

                {/* Selected Radar Pin Live Telemetry Bar */}
                <div className="border-t border-slate-800 bg-slate-900/95 px-3 py-2 text-xs flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 font-mono font-bold text-cyan-300">
                      {currentUnit.plate}
                    </span>
                    <span className="text-slate-300">{currentUnit.summary}</span>
                  </div>
                </div>
              </div>

              {/* Dynamic Stage Content Panel */}
              <div className="space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-cyan-400">{currentStage.badge}</span>
                  <Link
                    href="/logistics/drayage/tracking"
                    className="font-semibold text-blue-400 hover:text-cyan-300 transition-colors"
                  >
                    Open Full Radar Console →
                  </Link>
                </div>
                <div className="text-sm font-bold text-white">{currentStage.title}</div>
                <p className="text-slate-400 leading-relaxed">{currentStage.subtitle}</p>

                <div className="space-y-1.5 pt-1">
                  {currentStage.metrics.map((m) => (
                    <div
                      key={m.code}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/90 px-3 py-2.5"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-cyan-300">{m.code}</span>
                        <span className="text-slate-200">{m.detail}</span>
                      </div>
                      <span
                        className={`rounded border px-2 py-0.5 font-mono text-xs font-bold ${toneBadgeClass(m.tone)}`}
                      >
                        {m.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 4-Card Spatial Glass Bento Grid Below Hero */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            {BENTO_CARDS.map((card) => (
              <Link
                key={card.index}
                href={card.href}
                className={`group rounded-2xl border border-slate-800/90 bg-slate-900/75 p-5 backdrop-blur-md transition-all hover:-translate-y-0.5 ${card.borderHover} space-y-2`}
              >
                <div className={`font-mono text-xs font-bold ${card.accent}`}>{card.index}</div>
                <div className="text-sm font-bold text-white group-hover:text-cyan-300 transition-colors">
                  {card.title}
                </div>
                <p className="text-slate-400 leading-relaxed">{card.description}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
