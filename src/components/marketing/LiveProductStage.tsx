'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { HomepageSnapshot } from '@/lib/public-homepage';
import styles from './LiveProductStage.module.css';

const Arrow = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12h13M14 7l5 5-5 5" />
  </svg>
);

type Tone = 'lime' | 'teal' | 'violet' | 'gold';

interface StageTabDef {
  id: number;
  shortLabel: string;
  badge: string;
  title: string;
  subtitle: string;
  metrics: Array<{ code: string; detail: string; status: string; tone: Tone }>;
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
        tone: 'lime',
      },
      {
        code: 'DXB-767-4012',
        detail: '2×20FT Bogie Tether · 36.8T Payload on E311 Spine',
        status: 'BOGIE_PAIRED',
        tone: 'teal',
      },
      {
        code: 'DXB-TR-9902',
        detail: 'Detached at NIP Mega DC Ramp 07 · Live Offload ETC: 01h 42m',
        status: 'DETACHED_AT_RAMP',
        tone: 'violet',
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
        tone: 'lime',
      },
      {
        code: 'CPIP Seal #DM-99812',
        detail: 'Multi-Agency Customs & Dubai Municipality Inspection Cleared',
        status: 'CLEARED',
        tone: 'teal',
      },
      {
        code: 'eDO Validity Guard',
        detail: '72h Remaining · Automated Revalidation Workflow Ready',
        status: 'VALID_EDO',
        tone: 'gold',
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
        tone: 'teal',
      },
      {
        code: 'Maintenance AI Agent',
        detail: 'Predictive DPF Service Scheduled at Jebel Ali Workshop',
        status: 'READY_99.7%',
        tone: 'lime',
      },
      {
        code: 'Finance Settlement AI',
        detail: 'Auto-Verified AED 145 Driver Bogie + Port Gate Allowance',
        status: 'RECONCILED',
        tone: 'violet',
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
    color: '#baff68',
    textColor: '#e9ffd0',
  },
  {
    id: 'u1',
    plate: 'DXB-767-4012',
    label: '2×20FT BOGIE',
    summary: 'Volvo FH16 Coupled w/ 45FT Chassis DXB-TR-9905 · CMAU2210941 + TGHU1904422 (36.8T) · E311 Spine',
    cx: 295,
    cy: 102,
    color: '#83d8d4',
    textColor: '#bdf1ee',
  },
  {
    id: 'u2',
    plate: 'DXB-767-4013',
    label: 'STREET-TURN (-42km)',
    summary: 'Scania R500 · Import Empty HLXU9034118 Triangulated to Export Booking DRY-EXP-1001 · D57 Expo Rd',
    cx: 270,
    cy: 162,
    color: '#e8c16e',
    textColor: '#f6d38a',
  },
  {
    id: 'u3',
    plate: 'DXB-TR-9902',
    label: 'DETACHED RAMP 07',
    summary: 'Standalone Skeletal Chassis Pinned at NIP Mega DC Bay Ramp 07 · Live Offload ETC: 01h 42m remaining',
    cx: 395,
    cy: 84,
    color: '#c2a5ff',
    textColor: '#e3d6ff',
  },
];

const BENTO_CARDS = [
  {
    index: '01 // PORT & DRAYAGE',
    title: 'Coupled & Detached Telemetry',
    description:
      'Real-time tracking of Prime Movers on E11/E311 and uncoupled skeletal trailers at customer ramps with live ETC offload timers.',
    href: '/logistics/drayage/tracking',
  },
  {
    index: '02 // PCS GATE AUTOMATION',
    title: 'Dubai Trade & Maqta ATLP',
    description:
      'Automated gate slot booking, Customs/Municipality/CPIP seal clearance, and proactive Delivery Order (eDO) expiry protection.',
    href: '/logistics/drayage/containers',
  },
  {
    index: '03 // BOGIE & STREET-TURN',
    title: 'Zero Empty Port Deadhead',
    description:
      'Pair 2×20ft containers on 45ft heavy chassis (up to 42T) and triangulate import empty containers directly to export bookings.',
    href: '/logistics/drayage/assignment',
  },
  {
    index: '04 // MULTI-VERTICAL SAAS',
    title: 'Modular Tenant Provisioning',
    description:
      'Onboard standalone Port Drayage tenants or full-suite Enterprise Fleets with strict PostgreSQL RLS multi-tenant isolation.',
    href: '/platform',
  },
];

export default function LiveProductStage({ snapshot }: { snapshot: HomepageSnapshot }) {
  const [activeTab, setActiveTab] = useState<number>(0);
  const [selectedRadarUnit, setSelectedRadarUnit] = useState<number>(0);

  const currentStage = STAGE_TABS[activeTab] ?? STAGE_TABS[0];
  const currentUnit = RADAR_UNITS[selectedRadarUnit] ?? RADAR_UNITS[0];

  const stats = [
    { value: `${snapshot.vehiclesLive.toLocaleString()}+`, label: 'Vehicles live' },
    { value: `${snapshot.uptime}%`, label: 'Fleet uptime SLA' },
    { value: `-${snapshot.lowerOperatingCosts}%`, label: 'Operating costs' },
    { value: `${snapshot.fleetUtilization}%`, label: 'Fleet utilization' },
  ];

  return (
    <section className={styles.section} aria-labelledby="stage-title" data-analytics-section="live-product-stage">
      <div className={styles.ambient} aria-hidden="true" />
      <div className={styles.inner}>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>Port drayage · live product stage</p>
          <h2 id="stage-title">
            Every prime mover, chassis &amp; container.<br />
            <span>One live corridor.</span>
          </h2>
          <p className={styles.lede}>
            Track coupled prime movers and detached ramp chassis on E11/E311, book Dubai Trade and ATLP gate tokens,
            and let governed AI agents turn empties into exports before they ever deadhead.
          </p>
          <div className={styles.actions}>
            <Link className={styles.primary} href="/operations-review" data-analytics-cta="stage_operations_review">
              Book an operations review <Arrow />
            </Link>
            <Link className={styles.secondary} href="/logistics/drayage" data-analytics-cta="stage_drayage">
              Explore drayage <Arrow />
            </Link>
          </div>
          <div
            className={styles.stats}
            aria-label={`${snapshot.source === 'configured' ? 'Live' : 'Illustrative'} operations snapshot`}
          >
            {stats.map((s) => (
              <div key={s.label}><strong>{s.value}</strong><small>{s.label}</small></div>
            ))}
          </div>
        </div>

        <div className={styles.stage}>
          <div className={styles.stageHead}>
            <span className={styles.live}><i />Live interactive stage</span>
            <div className={styles.tabs} role="tablist" aria-label="Interactive product stage views">
              {STAGE_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  className={activeTab === tab.id ? styles.tabActive : styles.tab}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.shortLabel}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.radar}>
            <svg viewBox="0 0 540 220" aria-label="UAE drayage corridor live radar map">
              <defs>
                <pattern id="stageRadarGrid" width="36" height="36" patternUnits="userSpaceOnUse">
                  <path d="M 36 0 L 0 0 0 36" fill="none" stroke="rgba(186,255,104,.07)" strokeWidth="0.8" />
                </pattern>
              </defs>
              <rect width="540" height="220" fill="#030c09" />
              <rect width="540" height="220" fill="url(#stageRadarGrid)" />
              <path d="M 0,0 L 210,0 L 145,75 L 75,140 L 0,190 Z" fill="#0a1d16" opacity="0.8" />
              <text x="16" y="26" fill="#e7ba6c" opacity="0.6" fontSize="10" fontFamily="monospace" letterSpacing="2">
                JEBEL ALI MARITIME APPROACH
              </text>

              <polyline points="25,180 165,105 335,60 510,22" fill="none" stroke="#baff68" strokeWidth="3.5" strokeLinecap="round" opacity="0.7" />
              <text x="148" y="88" fill="#c7ff82" fontSize="10" fontFamily="monospace">E11 CORRIDOR</text>
              <polyline points="85,205 255,132 410,76 520,38" fill="none" stroke="#83d8d4" strokeWidth="3" strokeLinecap="round" opacity="0.65" />
              <text x="258" y="122" fill="#a9e9e5" fontSize="10" fontFamily="monospace">E311 SPINE</text>
              <polyline points="115,82 175,96 295,102 395,84" fill="none" stroke="#e8c16e" strokeWidth="2" strokeDasharray="5,4" opacity="0.75" />
              <line x1="295" y1="102" x2="395" y2="84" stroke="#83d8d4" strokeWidth="2" strokeDasharray="6,4" />
              <path d="M 270,162 Q 345,130 435,172" fill="none" stroke="#e8c16e" strokeWidth="2" strokeDasharray="6,4" />

              <circle cx="115" cy="82" r="24" fill="#baff68" fillOpacity="0.08" stroke="#baff68" strokeOpacity=".6" strokeWidth="1.2" strokeDasharray="4,3" />
              <text x="72" y="52" fill="#d9ffad" fontSize="10" fontFamily="monospace">DP WORLD JEBEL ALI</text>
              <circle cx="395" cy="84" r="22" fill="#c2a5ff" fillOpacity="0.1" stroke="#c2a5ff" strokeOpacity=".7" strokeWidth="1.2" strokeDasharray="4,3" />

              {RADAR_UNITS.map((u, idx) => {
                const isSel = selectedRadarUnit === idx;
                return (
                  <g
                    key={u.id}
                    className={styles.unit}
                    onClick={() => setSelectedRadarUnit(idx)}
                    role="button"
                    tabIndex={0}
                    aria-label={`Inspect ${u.plate}`}
                    aria-pressed={isSel}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedRadarUnit(idx);
                      }
                    }}
                  >
                    {isSel && <circle cx={u.cx} cy={u.cy} r="16" fill="none" stroke={u.color} strokeWidth="1.5" strokeDasharray="4,2" />}
                    <circle cx={u.cx} cy={u.cy} r={isSel ? 8 : 6.5} fill={u.color} stroke="#030c09" strokeWidth="2" style={{ filter: `drop-shadow(0 0 6px ${u.color})` }} />
                    <text x={u.cx} y={idx % 2 === 0 ? u.cy + 21 : u.cy - 13} textAnchor="middle" fill={u.textColor} fontSize="10" fontFamily="monospace">
                      {u.label}
                    </text>
                  </g>
                );
              })}
            </svg>
            <div className={styles.unitBar}>
              <b>{currentUnit.plate}</b>
              <span>{currentUnit.summary}</span>
            </div>
          </div>

          <div className={styles.stageBody}>
            <div className={styles.stageMeta}>
              <span>{currentStage.badge}</span>
              <Link href="/logistics/drayage/tracking">Open radar console →</Link>
            </div>
            <h3>{currentStage.title}</h3>
            <p>{currentStage.subtitle}</p>
            <div className={styles.rows}>
              {currentStage.metrics.map((m) => (
                <div key={m.code} className={styles.row}>
                  <div><b>{m.code}</b><small>{m.detail}</small></div>
                  <em className={styles[m.tone]}>{m.status}</em>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className={styles.cards}>
        {BENTO_CARDS.map((card) => (
          <Link key={card.index} href={card.href} className={styles.card}>
            <span>{card.index}</span>
            <b>{card.title}</b>
            <small>{card.description}</small>
          </Link>
        ))}
      </div>
    </section>
  );
}

