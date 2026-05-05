'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import PasswordInput from '@/components/ui/PasswordInput';

/* ─────────────────────────────────────────────────────────
   Module config — IDs must match platform/page.tsx mod.id exactly
───────────────────────────────────────────────────────── */
const ALL_MODULES = [
  'fleet', 'driver-mgmt', 'maintenance',
  'leasing', 'rental', 'bus-ops',
  'school-bus', 'logistics', 'incidents',
  'dispatch', 'finance', 'compliance',
  'booking-portal', 'customer-mgmt', 'customer',
  'reports', 'agents', 'sustainability', 'assets',
];

const MODULE_LABELS: Record<string, string> = {
  'fleet':          '🚘 Fleet Management',
  'driver-mgmt':    '👤 Driver Management',
  'maintenance':    '🔧 Vehicle Maintenance',
  'leasing':        '📋 Vehicle Leasing',
  'rental':         '🚗 Rent-a-Car',
  'bus-ops':        '🚌 Staff Transportation',
  'school-bus':     '🏫 School Bus',
  'logistics':      '🚛 Logistics Management',
  'incidents':      '🚨 Incident & Ambulance',
  'dispatch':       '🚦 Dispatch Control',
  'finance':        '💰 Finance & Billing',
  'compliance':     '⚖️ Compliance & Regulatory',
  'booking-portal': '📲 Booking Portal',
  'customer-mgmt':  '🏢 Customer Management',
  'customer':       '📱 Customer App',
  'reports':        '📊 Reports & Analytics',
  'agents':         '🤖 AI Agent Ecosystem',
  'sustainability':  '🌱 Sustainability & ESG',
  'assets':         '🏗️ Assets & Inventory',
};

/* ─────────────────────────────────────────────────────────
   Tenant settings type
───────────────────────────────────────────────────────── */
interface TSettings {
  tripMergingEnabled:       boolean;
  pickupMatchType:          string;
  pickupDistanceKm:         number;
  pickupTimeWindowMin:      number;
  requireDropoffMatch:      boolean;
  dropoffMatchType:         string;
  dropoffDistanceKm:        number;
  dropoffTimeWindowMin:     number;
  maxPassengers:            number;
  travelSpeedKmh:           number;
  stopDurationMin:          number;
  maxPickupDelayMin:        number;
  autoMergeEnabled:         boolean;
  triggerBeforePickupMin:   number;
  lookAheadHours:           number;
  autoDispatchEnabled:      boolean;
  maxDriverAttempts:        number;
  driverResponseTimeoutMin: number;
  dispatchRadius:           number;
  preferNearestDriver:      boolean;
  routeOptimizationEnabled: boolean;
  routingEngine:            string;
  googleMapsApiKey:         string;
  maxApiCallsPerHour:       number;
  maxApiCallsPerDay:        number;
  roadDistanceMultiplier:   number;
  fallbackToStraightLine:   boolean;
}

const TSETTINGS_DEFAULT: TSettings = {
  tripMergingEnabled: false,   pickupMatchType: 'DISTANCE',
  pickupDistanceKm: 7,         pickupTimeWindowMin: 30,
  requireDropoffMatch: true,   dropoffMatchType: 'DISTANCE',
  dropoffDistanceKm: 25,       dropoffTimeWindowMin: 30,
  maxPassengers: 5,            travelSpeedKmh: 40,
  stopDurationMin: 10,         maxPickupDelayMin: 30,
  autoMergeEnabled: false,     triggerBeforePickupMin: 30, lookAheadHours: 24,
  autoDispatchEnabled: false,  maxDriverAttempts: 3,
  driverResponseTimeoutMin: 6, dispatchRadius: 10,        preferNearestDriver: true,
  routeOptimizationEnabled: false, routingEngine: 'GOOGLE_MAPS',
  googleMapsApiKey: '',        maxApiCallsPerHour: 500,   maxApiCallsPerDay: 5000,
  roadDistanceMultiplier: 1.5, fallbackToStraightLine: true,
};

/* ─────────────────────────────────────────────────────────
   Dispatch Weight types & defaults
───────────────────────────────────────────────────────── */
interface WeightProfile {
  distance:      number;
  eta:           number;
  rating:        number;
  cost:          number;
  load?:         number;
  skill?:        number;
  equipment?:    number;
  crewReadiness?: number;
  reliability?:  number;
}

// service_type → priority → weights (mirrors DEFAULT_WEIGHTS in schema.ts)
type DispatchWeightMap = Record<string, Record<string, WeightProfile>>;

const DEFAULT_DISPATCH_WEIGHTS: DispatchWeightMap = {
  PASSENGER: {
    NORMAL:    { distance: 0.30, eta: 0.25, rating: 0.20, cost: 0.15, load: 0.10 },
    URGENT:    { distance: 0.20, eta: 0.45, rating: 0.15, cost: 0.10, load: 0.10 },
  },
  FREIGHT: {
    NORMAL:    { distance: 0.25, eta: 0.25, rating: 0.15, cost: 0.25, load: 0.10 },
    URGENT:    { distance: 0.20, eta: 0.40, rating: 0.10, cost: 0.20, load: 0.10 },
  },
  DELIVERY: {
    NORMAL:    { distance: 0.30, eta: 0.30, rating: 0.20, cost: 0.20 },
    URGENT:    { distance: 0.15, eta: 0.55, rating: 0.15, cost: 0.15 },
  },
  AMBULANCE: {
    P1:        { distance: 0.00, eta: 0.70, rating: 0.00, cost: 0.00, equipment: 0.10, crewReadiness: 0.10, reliability: 0.10 },
    P2:        { distance: 0.05, eta: 0.60, rating: 0.00, cost: 0.00, equipment: 0.15, crewReadiness: 0.10, reliability: 0.10 },
    P3:        { distance: 0.15, eta: 0.40, rating: 0.05, cost: 0.00, equipment: 0.15, crewReadiness: 0.15, reliability: 0.10 },
  },
  TECHNICIAN: {
    NORMAL:    { distance: 0.25, eta: 0.25, rating: 0.20, cost: 0.15, skill: 0.15 },
    URGENT:    { distance: 0.15, eta: 0.45, rating: 0.15, cost: 0.10, skill: 0.15 },
  },
};

// Which factors apply per service type
const SERVICE_FACTORS: Record<string, (keyof WeightProfile)[]> = {
  PASSENGER:  ['distance', 'eta', 'rating', 'cost', 'load'],
  FREIGHT:    ['distance', 'eta', 'rating', 'cost', 'load'],
  DELIVERY:   ['distance', 'eta', 'rating', 'cost'],
  AMBULANCE:  ['distance', 'eta', 'equipment', 'crewReadiness', 'reliability'],
  TECHNICIAN: ['distance', 'eta', 'rating', 'cost', 'skill'],
};

// Priorities per service type
const SERVICE_PRIORITIES: Record<string, string[]> = {
  PASSENGER:  ['NORMAL', 'URGENT'],
  FREIGHT:    ['NORMAL', 'URGENT'],
  DELIVERY:   ['NORMAL', 'URGENT'],
  AMBULANCE:  ['P1', 'P2', 'P3'],
  TECHNICIAN: ['NORMAL', 'URGENT'],
};

const FACTOR_LABELS: Record<string, string> = {
  distance:     'Distance',
  eta:          'ETA',
  rating:       'Rating',
  cost:         'Cost',
  load:         'Load Factor',
  skill:        'Skill Match',
  equipment:    'Equipment',
  crewReadiness:'Crew Readiness',
  reliability:  'Reliability',
};

const FACTOR_HELP: Record<string, string> = {
  distance:     'Prefer closer drivers (lower = less important)',
  eta:          'Prefer faster arrival time (critical for emergencies)',
  rating:       'Prefer higher-rated drivers',
  cost:         'Prefer lower cost per km',
  load:         'Prefer less-utilised drivers (hours worked today)',
  skill:        'Prefer drivers with matching skill tags',
  equipment:    'Prefer ambulances with required equipment onboard',
  crewReadiness:'Prefer crews with paramedic/ALS certification',
  reliability:  'Prefer drivers with low cancellation history',
};

const PRIORITY_COLORS: Record<string, string> = {
  P1:        'from-red-600 to-rose-600',
  P2:        'from-orange-500 to-amber-500',
  P3:        'from-yellow-500 to-yellow-400',
  NORMAL:    'from-slate-600 to-slate-500',
  URGENT:    'from-orange-600 to-amber-600',
  SCHEDULED: 'from-slate-700 to-slate-600',
};

const SERVICE_ICONS: Record<string, string> = {
  PASSENGER: '🚗', FREIGHT: '🚚', DELIVERY: '📦', AMBULANCE: '🚑', TECHNICIAN: '🔧',
};

/* ─────────────────────────────────────────────────────────
   Shared UI primitives
───────────────────────────────────────────────────────── */
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${checked ? 'bg-blue-600' : 'bg-slate-600'}`}>
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

function NumInput({ value, onChange, placeholder, min = 0 }: { value: number; onChange: (v: number) => void; placeholder?: string; min?: number }) {
  return (
    <input type="number" value={value} min={min} placeholder={placeholder}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      className="w-full px-3 py-2 rounded-lg bg-slate-700/60 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none text-sm" />
  );
}

function SelectInput({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="w-full px-3 py-2 rounded-lg bg-slate-700/60 border border-white/10 text-white focus:border-blue-500 focus:outline-none text-sm">
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function ConfigField({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium text-slate-300 mb-1">{label}</div>
      {help && <div className="text-[10px] text-slate-500 mt-0.5 leading-tight mb-1">{help}</div>}
      {children}
    </div>
  );
}

function SectionBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">{title}</h4>
      {children}
    </div>
  );
}

function FeatureCard({ icon, gradient, title, desc, enabled, onToggle, children, locked, lockedModules, onUnlock }: {
  icon: string; gradient: string; title: string; desc: string;
  enabled: boolean; onToggle: (v: boolean) => void; children?: React.ReactNode;
  locked?: boolean; lockedModules?: string[]; onUnlock?: () => void;
}) {
  if (locked) {
    return (
      <div className="rounded-2xl border border-white/10 overflow-hidden opacity-60">
        {/* Header — greyed, toggle replaced with lock */}
        <div className="flex items-center gap-4 p-5 bg-slate-800/30">
          <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center text-xl flex-shrink-0 grayscale`}>{icon}</div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-400">{title}</p>
            <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-slate-700/60 text-slate-500 border-slate-600">
              LOCKED
            </span>
            <div className="w-10 h-6 rounded-full bg-slate-700 flex items-center justify-center" title="Enable the required module to unlock">
              <span className="text-slate-400 text-sm">🔒</span>
            </div>
          </div>
        </div>

        {/* Unlock banner */}
        <div className="px-5 py-4 bg-slate-900/60 border-t border-white/5 flex items-start gap-3">
          <span className="text-amber-400 mt-0.5 flex-shrink-0">⚠</span>
          <div>
            <p className="text-xs font-semibold text-slate-300">Module not assigned to this tenant</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Enable one of the following modules in the{' '}
              <button
                onClick={() => onUnlock?.()}
                className="text-blue-400 hover:underline"
              >
                Module Access
              </button>{' '}
              tab to unlock this feature:
            </p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {(lockedModules ?? []).map(m => (
                <span key={m} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  {MODULE_LABELS[m] ?? m}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border overflow-hidden transition-all ${enabled ? 'border-blue-500/30' : 'border-white/10'}`}>
      <div className={`flex items-center gap-4 p-5 ${enabled ? 'bg-slate-800/70' : 'bg-slate-800/40'}`}>
        <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center text-xl flex-shrink-0`}>{icon}</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">{title}</p>
          <p className="text-xs text-slate-400 mt-0.5">{desc}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${enabled ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-slate-700 text-slate-500 border-transparent'}`}>
            {enabled ? 'ENABLED' : 'DISABLED'}
          </span>
          <Toggle checked={enabled} onChange={onToggle} />
        </div>
      </div>
      {enabled && children && (
        <div className="px-5 pb-5 pt-1 bg-slate-900/40 border-t border-white/5">
          {children}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   Weight Slider — single factor row
───────────────────────────────────────────────────────── */
function WeightSlider({
  factor, value, onChange,
}: {
  factor: keyof WeightProfile;
  value: number;
  onChange: (v: number) => void;
}) {
  const pct   = Math.round(value * 100);
  const color = pct >= 50 ? 'text-red-400' : pct >= 30 ? 'text-amber-400' : pct >= 10 ? 'text-blue-400' : 'text-slate-400';

  return (
    <div className="flex items-center gap-3 group">
      {/* Factor label */}
      <div className="w-32 flex-shrink-0">
        <p className="text-xs font-medium text-slate-300 leading-tight">{FACTOR_LABELS[factor]}</p>
        <p className="text-[10px] text-slate-600 leading-tight mt-0.5 hidden group-hover:block">{FACTOR_HELP[factor]}</p>
      </div>

      {/* Slider */}
      <div className="flex-1 relative">
        <input
          type="range"
          min={0} max={1} step={0.05}
          value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          className="w-full h-2 rounded-full appearance-none cursor-pointer bg-slate-700 accent-blue-500"
          style={{
            background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${pct}%, #334155 ${pct}%, #334155 100%)`,
          }}
        />
      </div>

      {/* Numeric value badge */}
      <div className={`w-14 text-right font-mono text-sm font-bold flex-shrink-0 ${color}`}>
        {value.toFixed(2)}
      </div>

      {/* Fine-tune input */}
      <input
        type="number"
        min={0} max={1} step={0.05}
        value={value}
        onChange={e => {
          const v = Math.min(1, Math.max(0, parseFloat(e.target.value) || 0));
          onChange(parseFloat(v.toFixed(2)));
        }}
        className="w-16 px-2 py-1 rounded-lg bg-slate-700/60 border border-white/10 text-white text-xs focus:border-blue-500 focus:outline-none font-mono"
      />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   Weight Total Indicator
───────────────────────────────────────────────────────── */
function WeightTotal({ profile, factors }: { profile: WeightProfile; factors: (keyof WeightProfile)[] }) {
  const total = factors.reduce((s, f) => s + (profile[f] ?? 0), 0);
  const rounded = parseFloat(total.toFixed(2));
  const ok = rounded === 1.00;
  const diff = parseFloat((1.00 - rounded).toFixed(2));

  return (
    <div className={`flex items-center justify-between px-4 py-2.5 rounded-xl border text-sm ${
      ok
        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
        : 'bg-red-500/10 border-red-500/30 text-red-400'
    }`}>
      <span className="font-medium">
        {ok ? '✓ Weights sum to 1.00' : `⚠ Weights sum to ${rounded.toFixed(2)} — ${diff > 0 ? `+${diff.toFixed(2)} needed` : `${(-diff).toFixed(2)} too much`}`}
      </span>
      <span className="font-mono font-bold">{rounded.toFixed(2)} / 1.00</span>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   Operational config per (service_type × priority)
───────────────────────────────────────────────────────── */
interface OpConfig {
  driverResponseTimeoutMin: number;
  maxAttempts:              number;
  dispatchRadiusKm:         number;
  preferSameZone:           boolean;
  crossZoneAllowed:         boolean;
  allowPreemption:          boolean;
}

// Sensible defaults differ significantly by service type — especially ambulance
const DEFAULT_OP_CONFIGS: Record<string, Record<string, OpConfig>> = {
  AMBULANCE: {
    P1:        { driverResponseTimeoutMin: 1,  maxAttempts: 5, dispatchRadiusKm: 50, preferSameZone: false, crossZoneAllowed: true,  allowPreemption: true  },
    P2:        { driverResponseTimeoutMin: 2,  maxAttempts: 4, dispatchRadiusKm: 30, preferSameZone: false, crossZoneAllowed: true,  allowPreemption: true  },
    P3:        { driverResponseTimeoutMin: 5,  maxAttempts: 3, dispatchRadiusKm: 15, preferSameZone: true,  crossZoneAllowed: true,  allowPreemption: false },
  },
  PASSENGER: {
    NORMAL:    { driverResponseTimeoutMin: 6,  maxAttempts: 3, dispatchRadiusKm: 10, preferSameZone: true,  crossZoneAllowed: true,  allowPreemption: false },
    URGENT:    { driverResponseTimeoutMin: 3,  maxAttempts: 4, dispatchRadiusKm: 15, preferSameZone: false, crossZoneAllowed: true,  allowPreemption: false },
    SCHEDULED: { driverResponseTimeoutMin: 10, maxAttempts: 3, dispatchRadiusKm: 10, preferSameZone: true,  crossZoneAllowed: false, allowPreemption: false },
  },
  FREIGHT: {
    NORMAL:    { driverResponseTimeoutMin: 10, maxAttempts: 3, dispatchRadiusKm: 20, preferSameZone: true,  crossZoneAllowed: true,  allowPreemption: false },
    URGENT:    { driverResponseTimeoutMin: 5,  maxAttempts: 4, dispatchRadiusKm: 30, preferSameZone: false, crossZoneAllowed: true,  allowPreemption: false },
    SCHEDULED: { driverResponseTimeoutMin: 15, maxAttempts: 3, dispatchRadiusKm: 20, preferSameZone: true,  crossZoneAllowed: false, allowPreemption: false },
  },
  DELIVERY: {
    NORMAL:    { driverResponseTimeoutMin: 8,  maxAttempts: 3, dispatchRadiusKm: 10, preferSameZone: true,  crossZoneAllowed: true,  allowPreemption: false },
    URGENT:    { driverResponseTimeoutMin: 4,  maxAttempts: 4, dispatchRadiusKm: 15, preferSameZone: false, crossZoneAllowed: true,  allowPreemption: false },
    SCHEDULED: { driverResponseTimeoutMin: 12, maxAttempts: 3, dispatchRadiusKm: 10, preferSameZone: true,  crossZoneAllowed: false, allowPreemption: false },
  },
  TECHNICIAN: {
    NORMAL:    { driverResponseTimeoutMin: 10, maxAttempts: 3, dispatchRadiusKm: 15, preferSameZone: true,  crossZoneAllowed: true,  allowPreemption: false },
    URGENT:    { driverResponseTimeoutMin: 5,  maxAttempts: 4, dispatchRadiusKm: 25, preferSameZone: false, crossZoneAllowed: true,  allowPreemption: false },
    SCHEDULED: { driverResponseTimeoutMin: 15, maxAttempts: 3, dispatchRadiusKm: 15, preferSameZone: true,  crossZoneAllowed: false, allowPreemption: false },
  },
};

function getDefaultOp(svc: string, pri: string): OpConfig {
  return (
    DEFAULT_OP_CONFIGS[svc]?.[pri] ??
    { driverResponseTimeoutMin: 6, maxAttempts: 3, dispatchRadiusKm: 10, preferSameZone: true, crossZoneAllowed: true, allowPreemption: false }
  );
}

/* ─────────────────────────────────────────────────────────
   Dispatch Weight Panel — embedded in Auto Dispatch card
───────────────────────────────────────────────────────── */
function DispatchWeightPanel({
  tenantId,
  weights,
  setWeights,
  opConfigs,
  setOpConfigs,
}: {
  tenantId: string;
  weights: DispatchWeightMap;
  setWeights: React.Dispatch<React.SetStateAction<DispatchWeightMap>>;
  opConfigs: Record<string, Record<string, OpConfig>>;
  setOpConfigs: React.Dispatch<React.SetStateAction<Record<string, Record<string, OpConfig>>>>;
}) {
  const [activeSvc,  setActiveSvc]  = useState<string>('PASSENGER');
  const [activePri,  setActivePri]  = useState<string>('NORMAL');
  const [saving,     setSaving]     = useState(false);
  const [saved,      setSaved]      = useState(false);
  const [error,      setError]      = useState('');

  // opConfigs and setOpConfigs are received as props — lifted to parent for persistence across remounts

  const services   = Object.keys(DEFAULT_DISPATCH_WEIGHTS);
  const priorities = SERVICE_PRIORITIES[activeSvc] ?? [];
  const factors    = SERVICE_FACTORS[activeSvc]    ?? [];

  // Ensure activePri is valid when service changes
  const handleSvcChange = (svc: string) => {
    setActiveSvc(svc);
    const pris = SERVICE_PRIORITIES[svc] ?? [];
    if (!pris.includes(activePri)) setActivePri(pris[0] ?? '');
  };

  const profile: WeightProfile = weights[activeSvc]?.[activePri]
    ?? DEFAULT_DISPATCH_WEIGHTS[activeSvc]?.[activePri]
    ?? { distance: 0, eta: 0, rating: 0, cost: 0 };

  const updateFactor = (factor: keyof WeightProfile, value: number) => {
    setWeights(prev => ({
      ...prev,
      [activeSvc]: {
        ...(prev[activeSvc] ?? {}),
        [activePri]: {
          ...(prev[activeSvc]?.[activePri] ?? DEFAULT_DISPATCH_WEIGHTS[activeSvc]?.[activePri] ?? {}),
          [factor]: value,
        },
      },
    }));
  };

  const normaliseWeights = () => {
    const total = factors.reduce((s, f) => s + (profile[f] ?? 0), 0);
    if (total === 0 || Math.abs(total - 1.0) < 0.001) return;
    const normalized = Object.fromEntries(
      factors.map(f => [f, parseFloat(((profile[f] ?? 0) / total).toFixed(2))])
    ) as Partial<WeightProfile>;
    setWeights(prev => ({
      ...prev,
      [activeSvc]: {
        ...(prev[activeSvc] ?? {}),
        [activePri]: { ...profile, ...normalized },
      },
    }));
  };

  const resetToDefault = () => {
    const def = DEFAULT_DISPATCH_WEIGHTS[activeSvc]?.[activePri];
    if (!def) return;
    setWeights(prev => ({
      ...prev,
      [activeSvc]: { ...(prev[activeSvc] ?? {}), [activePri]: { ...def } },
    }));
    // Also reset op config for this service × priority
    setOpConfigs(prev => ({
      ...prev,
      [activeSvc]: { ...(prev[activeSvc] ?? {}), [activePri]: getDefaultOp(activeSvc, activePri) },
    }));
  };

  // Current op config — falls back to smart per-service defaults
  const currentOp: OpConfig =
    opConfigs[activeSvc]?.[activePri] ?? getDefaultOp(activeSvc, activePri);

  const updateOp = (field: keyof OpConfig, value: number | boolean) => {
    setOpConfigs(prev => ({
      ...prev,
      [activeSvc]: {
        ...(prev[activeSvc] ?? {}),
        [activePri]: { ...currentOp, [field]: value },
      },
    }));
  };

  const saveWeights = async () => {
    setSaving(true); setSaved(false); setError('');
    try {
      const res = await fetch('/api/dispatch/weights', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          serviceType:              activeSvc,
          priority:                 activePri,
          weights:                  profile,
          maxAttempts:              currentOp.maxAttempts,
          driverResponseTimeoutMin: currentOp.driverResponseTimeoutMin,
          dispatchRadiusKm:         currentOp.dispatchRadiusKm,
          preferSameZone:           currentOp.preferSameZone,
          crossZoneAllowed:         currentOp.crossZoneAllowed,
          allowPreemption:          currentOp.allowPreemption,
          preemptiblePriorities:    currentOp.allowPreemption
            ? (activePri === 'P1' ? ['P3', 'SCHEDULED', 'NORMAL']
              : activePri === 'P2' ? ['P3', 'SCHEDULED'] : [])
            : [],
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? 'Save failed');
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch {
      setError('Network error — please try again');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionBlock title="Scoring Weight Configuration">
      <div className="rounded-2xl border border-white/10 bg-slate-900/60 overflow-hidden">
        {/* Info bar */}
        <div className="px-4 py-3 bg-slate-800/60 border-b border-white/5 flex items-center gap-2">
          <span className="text-blue-400 text-sm">ℹ</span>
          <p className="text-xs text-slate-400">
            Weights control how the dispatch engine ranks candidate drivers. Higher weight = stronger influence on score.
            All weights for a priority profile <strong className="text-slate-300">must sum to 1.00</strong>.
          </p>
        </div>

        {/* Service type tabs */}
        <div className="flex border-b border-white/10 overflow-x-auto">
          {services.map(svc => (
            <button
              key={svc}
              onClick={() => handleSvcChange(svc)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-all ${
                activeSvc === svc
                  ? 'text-white border-blue-500 bg-blue-500/5'
                  : 'text-slate-400 border-transparent hover:text-slate-300 hover:bg-white/[0.02]'
              }`}
            >
              <span>{SERVICE_ICONS[svc]}</span>
              {svc.charAt(0) + svc.slice(1).toLowerCase().replace('_', ' ')}
            </button>
          ))}
        </div>

        {/* Priority sub-tabs */}
        <div className="flex gap-2 px-4 pt-4 pb-2">
          {priorities.map(pri => (
            <button
              key={pri}
              onClick={() => setActivePri(pri)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                activePri === pri
                  ? `bg-gradient-to-r ${PRIORITY_COLORS[pri] ?? 'from-slate-600 to-slate-500'} text-white shadow`
                  : 'bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-white'
              }`}
            >
              {pri === 'P1' && '🚨'} {pri === 'P2' && '⚡'} {pri}
            </button>
          ))}

          <div className="flex-1" />

          {/* Quick action buttons */}
          <button
            onClick={normaliseWeights}
            className="px-3 py-1.5 rounded-xl text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-300 transition-all"
            title="Scale all weights so they sum to exactly 1.00"
          >
            ⟳ Normalise
          </button>
          <button
            onClick={resetToDefault}
            className="px-3 py-1.5 rounded-xl text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-300 transition-all"
            title="Reset to platform default weights for this service × priority"
          >
            ↩ Reset Default
          </button>
        </div>

        {/* Weight sliders */}
        <div className="px-4 pb-4 space-y-3">
          {/* Priority context info for Ambulance */}
          {activeSvc === 'AMBULANCE' && (
            <div className={`px-3 py-2 rounded-xl text-xs border ${
              activePri === 'P1' ? 'bg-red-500/10 border-red-500/20 text-red-300'
              : activePri === 'P2' ? 'bg-orange-500/10 border-orange-500/20 text-orange-300'
              : 'bg-yellow-500/10 border-yellow-500/20 text-yellow-300'
            }`}>
              {activePri === 'P1' && '🚨 P1 — Life-critical. ETA is the dominant factor. Cross-zone dispatch enabled. Preemption allowed from P2/P3/NORMAL.'}
              {activePri === 'P2' && '⚡ P2 — Urgent. ETA dominant but equipment readiness matters. Limited preemption from P3/SCHEDULED only.'}
              {activePri === 'P3' && '🟡 P3 — Non-emergency. Balanced scoring. No preemption rights.'}
            </div>
          )}

          {factors.map(factor => (
            <WeightSlider
              key={factor}
              factor={factor}
              value={profile[factor] ?? 0}
              onChange={v => updateFactor(factor, v)}
            />
          ))}

          {/* Weight total indicator */}
          <div className="pt-2">
            <WeightTotal profile={profile} factors={factors} />
          </div>

          {/* Comparison with platform default */}
          <div className="rounded-xl bg-slate-800/60 border border-white/5 px-3 py-2">
            <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-2">Platform Defaults — {activeSvc} / {activePri}</p>
            <div className="flex flex-wrap gap-2">
              {factors.map(f => {
                const def = DEFAULT_DISPATCH_WEIGHTS[activeSvc]?.[activePri]?.[f] ?? 0;
                const cur = profile[f] ?? 0;
                const delta = parseFloat((cur - def).toFixed(2));
                return (
                  <span key={f} className="text-[10px] font-mono bg-slate-700 px-2 py-0.5 rounded">
                    <span className="text-slate-400">{FACTOR_LABELS[f]}: </span>
                    <span className="text-slate-200">{def.toFixed(2)}</span>
                    {delta !== 0 && (
                      <span className={delta > 0 ? 'text-blue-400' : 'text-orange-400'}>
                        {' '}({delta > 0 ? '+' : ''}{delta.toFixed(2)})
                      </span>
                    )}
                  </span>
                );
              })}
            </div>
          </div>

          {/* ── Dispatch Behaviour Controls ── */}
          <div className="rounded-xl border border-white/10 bg-slate-800/50 overflow-hidden">
            <div className="px-3 py-2 bg-slate-800/80 border-b border-white/5 flex items-center gap-2">
              <span className="text-amber-400 text-xs">⚙</span>
              <p className="text-xs font-semibold text-slate-300">Dispatch Behaviour — {activeSvc} / {activePri}</p>
              <span className="ml-auto text-[10px] text-slate-500">Saved independently per service × priority</span>
            </div>

            <div className="px-3 py-3 grid grid-cols-1 sm:grid-cols-3 gap-3">

              {/* Driver Response Timeout */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1">
                  ⏱ Response Timeout
                  <span className="font-normal normal-case text-slate-500">(minutes)</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={1} max={30} step={1}
                    value={currentOp.driverResponseTimeoutMin}
                    onChange={e => updateOp('driverResponseTimeoutMin', parseInt(e.target.value))}
                    className="flex-1 accent-amber-500"
                  />
                  <input
                    type="number"
                    min={1} max={30} step={1}
                    value={currentOp.driverResponseTimeoutMin}
                    onChange={e => updateOp('driverResponseTimeoutMin', Math.min(30, Math.max(1, parseInt(e.target.value) || 1)))}
                    className="w-14 px-2 py-1 rounded-lg bg-slate-700/60 border border-white/10 text-white text-xs text-center font-mono focus:border-amber-500 focus:outline-none"
                  />
                </div>
                <p className="text-[10px] text-slate-500">
                  {activeSvc === 'AMBULANCE' && activePri === 'P1' && '🚨 P1: recommend 1–2 min'}
                  {activeSvc === 'AMBULANCE' && activePri === 'P2' && '⚡ P2: recommend 2–3 min'}
                  {activeSvc === 'AMBULANCE' && activePri === 'P3' && '🟡 P3: recommend 5 min'}
                  {activeSvc !== 'AMBULANCE' && 'Platform default: 6 min'}
                </p>
              </div>

              {/* Max Attempts */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1">
                  🔄 Max Attempts
                  <span className="font-normal normal-case text-slate-500">(drivers tried)</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={1} max={10} step={1}
                    value={currentOp.maxAttempts}
                    onChange={e => updateOp('maxAttempts', parseInt(e.target.value))}
                    className="flex-1 accent-blue-500"
                  />
                  <input
                    type="number"
                    min={1} max={10} step={1}
                    value={currentOp.maxAttempts}
                    onChange={e => updateOp('maxAttempts', Math.min(10, Math.max(1, parseInt(e.target.value) || 1)))}
                    className="w-14 px-2 py-1 rounded-lg bg-slate-700/60 border border-white/10 text-white text-xs text-center font-mono focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <p className="text-[10px] text-slate-500">After this many rejections → job escalated</p>
              </div>

              {/* Dispatch Radius */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1">
                  📍 Dispatch Radius
                  <span className="font-normal normal-case text-slate-500">(km)</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={1} max={100} step={1}
                    value={currentOp.dispatchRadiusKm}
                    onChange={e => updateOp('dispatchRadiusKm', parseInt(e.target.value))}
                    className="flex-1 accent-emerald-500"
                  />
                  <input
                    type="number"
                    min={1} max={100} step={1}
                    value={currentOp.dispatchRadiusKm}
                    onChange={e => updateOp('dispatchRadiusKm', Math.min(100, Math.max(1, parseInt(e.target.value) || 1)))}
                    className="w-14 px-2 py-1 rounded-lg bg-slate-700/60 border border-white/10 text-white text-xs text-center font-mono focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <p className="text-[10px] text-slate-500">Drivers beyond this radius are excluded</p>
              </div>
            </div>

            {/* Toggle flags row */}
            <div className="px-3 pb-3 flex flex-wrap gap-3">
              {[
                { field: 'preferSameZone',  label: '📌 Prefer Same Zone',    desc: 'Prioritise drivers in the same zone as the job' },
                { field: 'crossZoneAllowed', label: '🌐 Allow Cross-Zone',   desc: 'Permit drivers from other zones if none available locally' },
                { field: 'allowPreemption',  label: '⚡ Allow Preemption',   desc: 'Allow reassigning a lower-priority driver mid-job (Ambulance only)' },
              ].map(({ field, label, desc }) => (
                <button
                  key={field}
                  onClick={() => updateOp(field as keyof OpConfig, !currentOp[field as keyof OpConfig])}
                  title={desc}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
                    currentOp[field as keyof OpConfig]
                      ? 'bg-blue-500/15 border-blue-500/40 text-blue-300'
                      : 'bg-slate-700/40 border-white/5 text-slate-500 hover:text-slate-400'
                  }`}
                >
                  <span className={`w-3 h-3 rounded-full border flex-shrink-0 ${
                    currentOp[field as keyof OpConfig]
                      ? 'bg-blue-500 border-blue-400'
                      : 'bg-slate-600 border-slate-500'
                  }`} />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Save row */}
          <div className="flex items-center gap-3 pt-1">
            {error  && <span className="text-rose-400 text-xs flex-1">{error}</span>}
            {saved  && <span className="text-emerald-400 text-xs flex-1">✓ Weights saved for {activeSvc} / {activePri}</span>}
            {!error && !saved && <span className="text-slate-600 text-xs flex-1">Save applies to {activeSvc} {activePri} for this tenant only.</span>}

            <button
              onClick={saveWeights}
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50 flex items-center gap-2 flex-shrink-0 transition-all"
            >
              {saving
                ? <><span className="animate-spin inline-block">⟳</span> Saving…</>
                : `💾 Save ${activeSvc} / ${activePri}`}
            </button>
          </div>
        </div>

        {/* Batch save tip */}
        <div className="px-4 py-3 bg-slate-800/40 border-t border-white/5">
          <p className="text-[10px] text-slate-500">
            💡 Each service × priority profile is saved independently. Switch tabs to configure other profiles. Unsaved profiles use platform defaults automatically.
          </p>
        </div>
      </div>
    </SectionBlock>
  );
}

/* ─────────────────────────────────────────────────────────
   Module-level client cache — survives React re-renders and
   route-back navigation. Keyed by tenantId, expires in 90s.
───────────────────────────────────────────────────────── */
const DETAIL_CACHE_TTL = 90_000; // 90 seconds
interface TenantDetailCache {
  tenant: any; roles: any[]; users: any[];
  allRoles: any[]; settings: any; weights: any;
  branches: any[]; navPerms: Record<string, boolean>;
  ts: number;
}
const _detailCache = new Map<string, TenantDetailCache>();

/* ─────────────────────────────────────────────────────────
   Main page
───────────────────────────────────────────────────────── */
export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [tenant, setTenant]         = useState<any>(null);
  const [roles, setRoles]           = useState<any[]>([]);
  const [allRoles, setAllRoles]     = useState<any[]>([]);
  const [users, setUsers]           = useState<any[]>([]);
  // allUsers is loaded lazily on demand (only when Add User modal opens)
  const [allUsers, setAllUsers]     = useState<any[]>([]);
  const [allUsersLoading, setAllUsersLoading] = useState(false);
  const [tab, setTab]               = useState<'modules'|'features'|'users'|'roles'|'branches'|'admin-access'>('modules');

  // Admin Access tab state
  const TOGGLEABLE_NAV = [
    { key: 'branches',   label: 'Branches & Regions',      desc: 'Manage branches and regional offices' },
    { key: 'billing',    label: 'Billing & Subscriptions',  desc: 'View and manage subscription plan' },
    { key: 'workflows',  label: 'Workflow Management',      desc: 'Configure automated workflows' },
    { key: 'esign',      label: 'E-Signing Console',        desc: 'Monitor e-signing activity' },
    { key: 'whatsapp',   label: 'WhatsApp Support',         desc: 'Manage WhatsApp bot and conversations' },
    { key: 'dispatch',   label: 'Dispatch Monitor',         desc: 'View real-time dispatch dashboard' },
    { key: 'audit-logs', label: 'Audit Log',                desc: 'View activity and change history' },
  ];
  const [navPerms, setNavPerms]         = useState<Record<string,boolean>>({});
  const [navPermsSaving, setNavPermsSaving] = useState(false);
  const [branches, setBranches]     = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [enabledModules, setEnabledModules] = useState<string[]>([]);

  // Feature settings
  const [ts, setTs]                 = useState<TSettings>(TSETTINGS_DEFAULT);
  const [tsSaving, setTsSaving]     = useState(false);
  const [tsSaved,  setTsSaved]      = useState(false);
  const [tsError,  setTsError]      = useState('');

  // Dispatch weights + operational config (both lifted so load() can populate them)
  const [dispatchWeights,   setDispatchWeights]   = useState<DispatchWeightMap>(() =>
    JSON.parse(JSON.stringify(DEFAULT_DISPATCH_WEIGHTS))
  );
  const [dispatchOpConfigs, setDispatchOpConfigs] = useState<Record<string, Record<string, OpConfig>>>({});

  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser]       = useState({ userId:'', roleId:'' });

  const set = <K extends keyof TSettings>(key: K, val: TSettings[K]) =>
    setTs(p => ({ ...p, [key]: val }));

  // Helper: apply fetched data to state
  const applyData = useCallback((tData: any, rData: any, uData: any, arData: any,
    sData: any, wData: any, bData: any, npData: any) => {
    setTenant(tData);
    setEnabledModules((tData.modules ?? []).filter((m: any) => m.isEnabled).map((m: any) => m.module));
    setRoles(Array.isArray(rData) ? rData : []);
    setUsers(Array.isArray(uData) ? uData : []);
    setAllRoles(Array.isArray(arData) ? arData : []);
    setBranches(bData ?? []);
    setNavPerms(npData ?? {});

    if (sData && !sData.error) {
      setTs({
        ...TSETTINGS_DEFAULT,
        ...Object.fromEntries(
          Object.keys(TSETTINGS_DEFAULT).map(k => {
            const v = sData[k];
            return v !== undefined && v !== null ? [k, v] : [k, (TSETTINGS_DEFAULT as any)[k]];
          })
        ),
      } as TSettings);
    }

    if (wData?.data && typeof wData.data === 'object') {
      const merged: DispatchWeightMap = JSON.parse(JSON.stringify(DEFAULT_DISPATCH_WEIGHTS));
      const loadedOp: Record<string, Record<string, OpConfig>> = {};
      for (const [svc, priorities] of Object.entries(wData.data as Record<string, Record<string, any>>)) {
        if (!merged[svc]) merged[svc] = {};
        for (const [pri, cfg] of Object.entries(priorities)) {
          if (cfg && typeof cfg === 'object' && !(cfg as any).is_default) {
            const w = (cfg as any).weights;
            if (w && typeof w === 'object') merged[svc][pri] = { ...((merged[svc][pri]) ?? {}), ...w };
            if (!loadedOp[svc]) loadedOp[svc] = {};
            loadedOp[svc][pri] = {
              driverResponseTimeoutMin: Number(cfg.driver_response_timeout_min ?? 6),
              maxAttempts:              Number(cfg.max_attempts ?? 3),
              dispatchRadiusKm:         Number(cfg.dispatch_radius_km ?? 10),
              preferSameZone:           Boolean(cfg.prefer_same_zone ?? true),
              crossZoneAllowed:         Boolean(cfg.cross_zone_allowed ?? true),
              allowPreemption:          Boolean(cfg.allow_preemption ?? false),
            };
          }
        }
      }
      setDispatchWeights(merged);
      setDispatchOpConfigs(loadedOp);
    }
  }, []);

  const load = useCallback(async (forceRefresh = false) => {
    // ── Serve from cache if fresh ──────────────────────────────────────────
    if (!forceRefresh) {
      const cached = _detailCache.get(id);
      if (cached && Date.now() - cached.ts < DETAIL_CACHE_TTL) {
        applyData(cached.tenant, cached.roles, cached.users, cached.allRoles,
          cached.settings, cached.weights, cached.branches, cached.navPerms);
        setLoading(false);
        return;
      }
    }

    setLoading(true);
    try {
      // ── All 9 fetches fire in parallel (branches + nav-perms no longer sequential) ──
      const [tRes, rRes, uRes, arRes, sRes, wRes, bRes, npRes] = await Promise.all([
        fetch(`/api/admin/tenants/${id}`),
        fetch(`/api/admin/roles?tenantId=${id}`),
        fetch(`/api/admin/tenants/${id}/users`),
        fetch('/api/admin/roles?lite=true'),              // lite — skips full permissions include
        fetch(`/api/admin/tenants/${id}/settings`),
        fetch(`/api/dispatch/weights?tenantId=${id}`),
        fetch(`/api/tenant-branches?tenantId=${id}&includeInactive=true`).catch(() => null),
        fetch(`/api/admin/nav-permissions?tenantId=${id}`).catch(() => null),
      ]);

      const [tData, rData, uData, arData, sData, wData] = await Promise.all([
        tRes.json(), rRes.json(), uRes.json(), arRes.json(), sRes.json(), wRes.json(),
      ]);
      const bData  = bRes?.ok  ? (await bRes.json()).data  ?? [] : [];
      const npData = npRes?.ok ? (await npRes.json()).permissions ?? {} : {};

      // ── Populate cache ─────────────────────────────────────────────────
      _detailCache.set(id, {
        tenant: tData, roles: rData, users: uData, allRoles: arData,
        settings: sData, weights: wData, branches: bData, navPerms: npData,
        ts: Date.now(),
      });

      applyData(tData, rData, uData, arData, sData, wData, bData, npData);
    } catch { } finally { setLoading(false); }
  }, [id, applyData]);

  // Lazy-load all platform users — only when "Add User" modal opens
  const openAddUser = useCallback(async () => {
    setShowAddUser(true);
    if (allUsers.length > 0) return; // already loaded
    setAllUsersLoading(true);
    try {
      const res = await fetch('/api/admin/users');
      if (res.ok) setAllUsers(await res.json());
    } finally { setAllUsersLoading(false); }
  }, [allUsers.length]);

  useEffect(() => { load(); }, [load]);

  const saveModules = async () => {
    setSaving(true);
    try {
      await fetch(`/api/admin/tenants/${id}/modules`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabledModules }),
      });
      _detailCache.delete(id); // modules changed — invalidate cache
      load(true);
    } finally { setSaving(false); }
  };

  const saveFeatures = async () => {
    setTsSaving(true); setTsSaved(false); setTsError('');
    try {
      const res = await fetch(`/api/admin/tenants/${id}/settings`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ts),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setTsError(d.error ?? 'Save failed');
      } else {
        setTsSaved(true); setTimeout(() => setTsSaved(false), 3000);
      }
    } catch { setTsError('Network error — please try again'); }
    finally { setTsSaving(false); }
  };

  const addUser = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      const res = await fetch(`/api/admin/tenants/${id}/users`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error ?? `Failed (${res.status})`); return;
      }
      setShowAddUser(false); setNewUser({ userId:'', roleId:'' });
      _detailCache.delete(id); // invalidate so next load re-fetches fresh
      load(true);
    } catch (e: any) { alert(e.message ?? 'Failed'); }
    finally { setSaving(false); }
  };

  const removeUser = async (userId: string) => {
    if (!confirm('Remove this user from the tenant?')) return;
    const ut = users.find(u => u.userId === userId || u.id === userId);
    if (ut?.userTenantId) {
      await fetch(`/api/admin/users/${ut.userTenantId}`, { method:'DELETE' });
      _detailCache.delete(id);
      load(true);
    }
  };

  if (loading) return <div className="flex items-center justify-center h-full"><div className="text-slate-400 animate-pulse">Loading...</div></div>;
  if (!tenant) return <div className="text-rose-400 p-8">Tenant not found</div>;

  return (
    <div className="space-y-8">
      {/* Tenant header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-4xl font-bold text-white">{tenant.name}</h1>
          {tenant.code && <span className="text-sm font-mono bg-slate-700 text-slate-300 px-2 py-1 rounded">{tenant.code}</span>}
          <span className={`px-2 py-1 rounded text-xs font-medium ${tenant.isActive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
            {tenant.isActive ? 'ACTIVE' : 'INACTIVE'}
          </span>
        </div>
        <p className="text-slate-400">{tenant.plan} plan {tenant.industry ? ` - ${tenant.industry}` : ''}</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-white/10 overflow-x-auto">
        {([
          ['modules',      'Module Access'],
          ['features',     '⚡ Feature Flags'],
          ['admin-access', '🔐 Admin Access'],
          ['users',        `Users (${users.length})`],
          ['roles',        `Roles (${roles.length})`],
          ['branches',     `Branches (${branches.length})`],
        ] as [typeof tab, string][]).map(([t, l]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px whitespace-nowrap ${tab === t ? 'text-white border-blue-500' : 'text-slate-400 border-transparent hover:text-slate-300'}`}>
            {l}
          </button>
        ))}
      </div>

      {/* ── MODULE ACCESS ── */}
      {tab === 'modules' && (
        <div className="space-y-6">
          <p className="text-slate-400 text-sm">Control which modules this tenant can access. Disabled modules will be hidden from their navigation.</p>
          <div className="grid grid-cols-3 gap-3">
            {ALL_MODULES.map(m => (
              <label key={m} className={`flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-all ${enabledModules.includes(m) ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-white/10 bg-slate-800/50 hover:border-white/20'}`}>
                <input type="checkbox" checked={enabledModules.includes(m)}
                  onChange={() => setEnabledModules(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m])}
                  className="w-4 h-4 accent-emerald-500"/>
                <div>
                  <div className="text-sm font-medium text-white">{MODULE_LABELS[m]}</div>
                  <div className={`text-xs mt-0.5 ${enabledModules.includes(m) ? 'text-emerald-400' : 'text-slate-500'}`}>{enabledModules.includes(m) ? 'Enabled' : 'Disabled'}</div>
                </div>
              </label>
            ))}
          </div>
          <button onClick={saveModules} disabled={saving}
            className="px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-medium hover:opacity-90 disabled:opacity-50">
            {saving ? 'Saving...' : 'Save Module Access'}
          </button>
        </div>
      )}

      {/* ── FEATURE FLAGS ── */}
      {tab === 'features' && (
        <div className="space-y-5">
          {/* Header row */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-white">Feature Flags</h2>
              <p className="text-slate-400 text-sm mt-1">
                Enable advanced operational features and configure their parameters for <strong className="text-white">{tenant.name}</strong>.
                All changes are tenant-specific and do not affect other clients.
              </p>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              {tsError  && <span className="text-rose-400 text-sm">{tsError}</span>}
              {tsSaved  && <span className="text-emerald-400 text-sm">✓ Saved!</span>}
              <button onClick={saveFeatures} disabled={tsSaving}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-2">
                {tsSaving ? <><span className="animate-spin inline-block text-base">⟳</span> Saving…</> : '💾 Save All Features'}
              </button>
            </div>
          </div>

          {/* ── 1. Trip Merging ── */}
          <FeatureCard
            icon="🔀" gradient="from-blue-600 to-cyan-600"
            title="Trip Merging"
            desc="Merge compatible trips to optimise fleet utilisation and reduce operational costs"
            enabled={ts.tripMergingEnabled}
            onToggle={v => set('tripMergingEnabled', v)}
            locked={!enabledModules.some(m => ['bus-ops','school-bus','logistics'].includes(m))}
            lockedModules={['bus-ops','school-bus','logistics']}
            onUnlock={() => setTab('modules')}
          >
            <SectionBlock title="Pickup Matching">
              <div className="grid grid-cols-3 gap-4">
                <ConfigField label="Pickup Match Type">
                  <SelectInput value={ts.pickupMatchType} onChange={v => set('pickupMatchType', v)}
                    options={[{ value:'DISTANCE', label:'Distance-based' }, { value:'TIME', label:'Time-based' }, { value:'HYBRID', label:'Hybrid' }]} />
                </ConfigField>
                <ConfigField label="Pickup Distance (km)" help="Max distance between pickup points to consider merging">
                  <NumInput value={ts.pickupDistanceKm} onChange={v => set('pickupDistanceKm', v)} placeholder="7" />
                </ConfigField>
                <ConfigField label="Pickup Time Window (min)" help="Max time difference between pickup times">
                  <NumInput value={ts.pickupTimeWindowMin} onChange={v => set('pickupTimeWindowMin', v)} placeholder="30" />
                </ConfigField>
              </div>
            </SectionBlock>

            <SectionBlock title="Dropoff Matching">
              <div className="flex items-center gap-3 mb-4 p-3 rounded-xl bg-slate-800/60 border border-white/5">
                <Toggle checked={ts.requireDropoffMatch} onChange={v => set('requireDropoffMatch', v)} />
                <div>
                  <p className="text-sm font-medium text-white">Require Dropoff Match</p>
                  <p className="text-xs text-slate-500">If enabled, trips must have matching dropoffs to merge</p>
                </div>
              </div>
              {ts.requireDropoffMatch && (
                <div className="grid grid-cols-3 gap-4">
                  <ConfigField label="Dropoff Match Type">
                    <SelectInput value={ts.dropoffMatchType} onChange={v => set('dropoffMatchType', v)}
                      options={[{ value:'DISTANCE', label:'Distance-based' }, { value:'TIME', label:'Time-based' }, { value:'HYBRID', label:'Hybrid' }]} />
                  </ConfigField>
                  <ConfigField label="Dropoff Distance (km)" help="Max distance between dropoff points to consider merging">
                    <NumInput value={ts.dropoffDistanceKm} onChange={v => set('dropoffDistanceKm', v)} placeholder="25" />
                  </ConfigField>
                  <ConfigField label="Dropoff Time Window (min)" help="Max time difference between dropoff times">
                    <NumInput value={ts.dropoffTimeWindowMin} onChange={v => set('dropoffTimeWindowMin', v)} placeholder="30" />
                  </ConfigField>
                </div>
              )}
            </SectionBlock>

            <SectionBlock title="Capacity &amp; Routing">
              <div className="grid grid-cols-4 gap-4">
                <ConfigField label="Max Passengers" help="Max passengers in a merged trip">
                  <NumInput value={ts.maxPassengers} onChange={v => set('maxPassengers', v)} placeholder="5" min={1} />
                </ConfigField>
                <ConfigField label="Travel Speed (km/h)" help="Average speed for route calculations">
                  <NumInput value={ts.travelSpeedKmh} onChange={v => set('travelSpeedKmh', v)} placeholder="40" min={1} />
                </ConfigField>
                <ConfigField label="Stop Duration (min)" help="Time added per pickup/dropoff stop">
                  <NumInput value={ts.stopDurationMin} onChange={v => set('stopDurationMin', v)} placeholder="10" />
                </ConfigField>
                <ConfigField label="Max Pickup Delay (min)" help="Maximum extra time allowed due to merging">
                  <NumInput value={ts.maxPickupDelayMin} onChange={v => set('maxPickupDelayMin', v)} placeholder="30" />
                </ConfigField>
              </div>
            </SectionBlock>
          </FeatureCard>

          {/* ── 2. Auto-Merge ── */}
          <FeatureCard
            icon="⚡" gradient="from-violet-600 to-purple-600"
            title="Auto-Merge"
            desc="System automatically merges eligible trips before departure without any manual intervention"
            enabled={ts.autoMergeEnabled}
            onToggle={v => set('autoMergeEnabled', v)}
            locked={!enabledModules.some(m => ['bus-ops','school-bus','logistics'].includes(m))}
            lockedModules={['bus-ops','school-bus','logistics']}
            onUnlock={() => setTab('modules')}
          >
            <SectionBlock title="Auto-Merge Timing">
              <div className="grid grid-cols-2 gap-4">
                <ConfigField label="Trigger Before Pickup (min)" help="How long before pickup to run the auto-merge job">
                  <NumInput value={ts.triggerBeforePickupMin} onChange={v => set('triggerBeforePickupMin', v)} placeholder="30" min={1} />
                </ConfigField>
                <ConfigField label="Look Ahead (hours)" help="How far ahead to scan for eligible bookings">
                  <NumInput value={ts.lookAheadHours} onChange={v => set('lookAheadHours', v)} placeholder="24" min={1} />
                </ConfigField>
              </div>
            </SectionBlock>
          </FeatureCard>

          {/* ── 3. Auto Dispatch ── */}
          <FeatureCard
            icon="📡" gradient="from-emerald-600 to-teal-600"
            title="Auto Dispatch"
            desc="Automatically assign the nearest best-scored driver to confirmed trips using weighted multi-factor scoring"
            enabled={ts.autoDispatchEnabled}
            onToggle={v => set('autoDispatchEnabled', v)}
            locked={!enabledModules.some(m => ['dispatch','bus-ops','school-bus','incidents'].includes(m))}
            lockedModules={['dispatch','bus-ops','school-bus','incidents']}
            onUnlock={() => setTab('modules')}
          >
            {/* Dispatch Parameters */}
            <SectionBlock title="Dispatch Parameters">
              <div className="grid grid-cols-3 gap-4 mb-4">
                <ConfigField label="Max Driver Attempts" help="Drivers to try before marking dispatch as failed">
                  <NumInput value={ts.maxDriverAttempts} onChange={v => set('maxDriverAttempts', v)} placeholder="3" min={1} />
                </ConfigField>
                <ConfigField label="Driver Response Timeout (min)" help="How long to wait before trying the next driver">
                  <NumInput value={ts.driverResponseTimeoutMin} onChange={v => set('driverResponseTimeoutMin', v)} placeholder="6" min={1} />
                </ConfigField>
                <ConfigField label="Dispatch Radius (km)" help="Search radius to find available drivers">
                  <NumInput value={ts.dispatchRadius} onChange={v => set('dispatchRadius', v)} placeholder="10" min={1} />
                </ConfigField>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-800/60 border border-white/5">
                <Toggle checked={ts.preferNearestDriver} onChange={v => set('preferNearestDriver', v)} />
                <div>
                  <p className="text-sm font-medium text-white">Prefer Nearest Driver</p>
                  <p className="text-xs text-slate-500">Boost the distance weight for same-zone drivers automatically</p>
                </div>
              </div>
            </SectionBlock>

            {/* ── Scoring Weight Configuration ── */}
            <DispatchWeightPanel
              tenantId={id}
              weights={dispatchWeights}
              setWeights={setDispatchWeights}
              opConfigs={dispatchOpConfigs}
              setOpConfigs={setDispatchOpConfigs}
            />
          </FeatureCard>

          {/* ── 4. Route Optimization ── */}
          <FeatureCard
            icon="🗺️" gradient="from-amber-600 to-orange-600"
            title="Route Optimization"
            desc="Use a routing engine for real road distances, accurate ETAs and optimal multi-stop routes"
            enabled={ts.routeOptimizationEnabled}
            onToggle={v => set('routeOptimizationEnabled', v)}
            locked={!enabledModules.some(m => ['logistics','school-bus','bus-ops','dispatch'].includes(m))}
            lockedModules={['logistics','school-bus','bus-ops','dispatch']}
            onUnlock={() => setTab('modules')}
          >
            <SectionBlock title="Routing Engine">
              <ConfigField label="Routing Engine">
                <SelectInput value={ts.routingEngine} onChange={v => set('routingEngine', v)}
                  options={[
                    { value:'GOOGLE_MAPS', label:'Google Maps' },
                    { value:'OSRM',        label:'OSRM (Open Source)' },
                    { value:'HERE',        label:'HERE Maps' },
                    { value:'MAPBOX',      label:'Mapbox' },
                  ]} />
              </ConfigField>
            </SectionBlock>

            {ts.routingEngine === 'GOOGLE_MAPS' && (
              <SectionBlock title="Google Maps Configuration">
                <ConfigField label="Google Maps API Key" help="Your Google Maps Platform key with Routes & Distance Matrix enabled">
                  <PasswordInput value={ts.googleMapsApiKey ?? ''} onChange={e => set('googleMapsApiKey', e.target.value)}
                    placeholder="AIza..."
                    className="w-full px-3 py-2 rounded-lg bg-slate-700/60 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none text-sm font-mono" />
                </ConfigField>
              </SectionBlock>
            )}

            <SectionBlock title="Rate Limiting">
              <div className="grid grid-cols-2 gap-4">
                <ConfigField label="Max API Calls Per Hour" help="Maximum routing API calls allowed per hour">
                  <NumInput value={ts.maxApiCallsPerHour} onChange={v => set('maxApiCallsPerHour', v)} placeholder="500" min={1} />
                </ConfigField>
                <ConfigField label="Max API Calls Per Day" help="Maximum routing API calls allowed per day">
                  <NumInput value={ts.maxApiCallsPerDay} onChange={v => set('maxApiCallsPerDay', v)} placeholder="5000" min={1} />
                </ConfigField>
              </div>
            </SectionBlock>

            <SectionBlock title="Distance &amp; Fallback Settings">
              <div className="grid grid-cols-2 gap-4">
                <ConfigField label="Road Distance Multiplier" help="Scaling factor applied to straight-line distance as fallback estimation">
                  <NumInput value={ts.roadDistanceMultiplier} onChange={v => set('roadDistanceMultiplier', v)} placeholder="1.5" min={1} />
                </ConfigField>
                <div className="flex items-start gap-3 pt-5">
                  <Toggle checked={ts.fallbackToStraightLine} onChange={v => set('fallbackToStraightLine', v)} />
                  <div>
                    <p className="text-sm font-medium text-white">Fallback to Straight Line</p>
                    <p className="text-xs text-slate-500">Use straight-line distance calculation if routing engine fails or API limit is reached</p>
                  </div>
                </div>
              </div>
            </SectionBlock>
          </FeatureCard>

          {/* Footer save */}
          <div className="flex items-center justify-between pt-2 border-t border-white/10">
            <p className="text-xs text-slate-600">
              Dispatch weight profiles are saved per service × priority and apply immediately to new dispatch jobs.
            </p>
            <div className="flex items-center gap-3">
              {tsError && <span className="text-rose-400 text-sm">{tsError}</span>}
              {tsSaved && <span className="text-emerald-400 text-sm">✓ Saved!</span>}
              <button onClick={saveFeatures} disabled={tsSaving}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-2">
                {tsSaving ? <><span className="animate-spin inline-block text-base">⟳</span> Saving…</> : '💾 Save All Features'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ADMIN ACCESS ── */}
      {tab === 'admin-access' && (
        <div className="space-y-6 max-w-2xl">
          <div>
            <h3 className="text-white font-semibold text-lg">Tenant Admin — Admin Panel Access</h3>
            <p className="text-slate-400 text-sm mt-1">
              Control which Admin Panel sections the Tenant Admin of this organisation can see.
              <br/>
              <span className="text-slate-500">Overview, Users, and Roles are always visible. Toggle optional sections below.</span>
            </p>
          </div>

          {/* Always-on items (read-only display) */}
          <div className="bg-slate-800/40 border border-white/10 rounded-xl p-4 space-y-3">
            <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide">Always Enabled</p>
            {['Overview', 'Users', 'Roles & Permissions'].map(label => (
              <div key={label} className="flex items-center gap-3">
                <div className="w-4 h-4 rounded bg-emerald-500/30 border border-emerald-500/50 flex items-center justify-center">
                  <svg className="w-2.5 h-2.5 text-emerald-400" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 00-1.414 0L8 12.586 4.707 9.293a1 1 0 00-1.414 1.414l4 4a1 1 0 001.414 0l8-8a1 1 0 000-1.414z" clipRule="evenodd"/></svg>
                </div>
                <span className="text-slate-300 text-sm">{label}</span>
                <span className="ml-auto text-xs text-emerald-500 font-medium">Always On</span>
              </div>
            ))}
          </div>

          {/* Toggleable items */}
          <div className="bg-slate-900 border border-white/10 rounded-xl divide-y divide-white/5">
            <div className="px-5 py-3">
              <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide">Optional — Enable for this tenant</p>
            </div>
            {TOGGLEABLE_NAV.map(item => (
              <div key={item.key} className="flex items-center gap-4 px-5 py-4">
                <button
                  onClick={() => setNavPerms(p => ({ ...p, [item.key]: !p[item.key] }))}
                  className={`relative inline-flex w-11 h-6 rounded-full transition-colors duration-200 flex-shrink-0 focus:outline-none ${navPerms[item.key] ? 'bg-blue-600' : 'bg-slate-700'}`}
                >
                  <span className={`absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${navPerms[item.key] ? 'translate-x-5' : 'translate-x-0'}`}/>
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium">{item.label}</p>
                  <p className="text-slate-500 text-xs">{item.desc}</p>
                </div>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${navPerms[item.key] ? 'bg-blue-500/20 text-blue-400' : 'bg-slate-800 text-slate-500'}`}>
                  {navPerms[item.key] ? 'Enabled' : 'Hidden'}
                </span>
              </div>
            ))}
          </div>

          {/* Super Admin only — informational */}
          <div className="bg-slate-800/40 border border-white/10 rounded-xl p-4 space-y-3">
            <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide">Super Admin Only — Never Visible to Tenant Admin</p>
            {['Tenants', 'Platform Info', 'Notifications', 'Integrations & ERP', 'Platform Settings'].map(label => (
              <div key={label} className="flex items-center gap-3">
                <div className="w-4 h-4 rounded bg-red-500/20 border border-red-500/30 flex items-center justify-center">
                  <svg className="w-2.5 h-2.5 text-red-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
                </div>
                <span className="text-slate-400 text-sm">{label}</span>
                <span className="ml-auto text-xs text-red-500 font-medium">Platform Only</span>
              </div>
            ))}
          </div>

          {/* Save button */}
          <div className="flex justify-end">
            <button
              disabled={navPermsSaving}
              onClick={async () => {
                setNavPermsSaving(true);
                try {
                  await fetch('/api/admin/nav-permissions', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tenantId: id, permissions: navPerms }),
                  });
                  alert('Admin access permissions saved.');
                } catch { alert('Failed to save permissions.'); }
                finally { setNavPermsSaving(false); }
              }}
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              {navPermsSaving ? 'Saving…' : '💾 Save Access Permissions'}
            </button>
          </div>
        </div>
      )}

      {/* ── USERS ── */}
      {tab === 'users' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-slate-400 text-sm">Users assigned to this tenant with their roles</p>
            <button onClick={openAddUser} className="px-4 py-2 rounded-lg bg-violet-500/20 text-violet-400 border border-violet-500/30 text-sm hover:bg-violet-500/30">+ Add User</button>
          </div>
          {users.length === 0 ? (
            <div className="text-center text-slate-400 py-12 bg-slate-800/30 border border-white/5 rounded-xl">No users assigned. Add users above.</div>
          ) : (
            <div className="bg-slate-800/50 border border-white/10 rounded-2xl overflow-hidden">
              <table className="w-full">
                <thead><tr className="border-b border-white/5">
                  {['Name','Username','Email','Role','Status','Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-400">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id ?? u.userId} className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-4 py-3 text-sm font-medium text-white">{u.firstName ?? ''} {u.lastName ?? ''}</td>
                      <td className="px-4 py-3 text-sm text-white font-mono">{u.username}</td>
                      <td className="px-4 py-3 text-sm text-white">{u.email}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-violet-500/20 text-violet-400 border border-violet-500/30">{u.roleCode ?? u.roleName}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs ${u.isActive !== false ? 'text-emerald-400' : 'text-slate-300'}`}>{u.isActive !== false ? 'Active' : 'Inactive'}</span>
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => removeUser(u.id ?? u.userId)} className="text-xs px-2 py-1 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:bg-rose-500/30">Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {showAddUser && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
              <div className="w-full max-w-md bg-slate-800/95 border border-white/10 rounded-2xl p-8">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xl font-bold text-white">Add User to Tenant</h3>
                  <button onClick={() => setShowAddUser(false)} className="text-slate-400 hover:text-white">✕</button>
                </div>
                <form onSubmit={addUser} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">User *</label>
                    <select value={newUser.userId} onChange={e => setNewUser(p => ({ ...p, userId: e.target.value }))} required
                      disabled={allUsersLoading}
                      className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:outline-none disabled:opacity-50">
                      <option value="">{allUsersLoading ? 'Loading users…' : 'Select user'}</option>
                      {allUsers.map(u => <option key={u.id} value={u.id}>{u.firstName ?? ''} {u.lastName ?? ''} ({u.username})</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">Role *</label>
                    <select value={newUser.roleId} onChange={e => setNewUser(p => ({ ...p, roleId: e.target.value }))} required
                      className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:outline-none">
                      <option value="">Select role</option>
                      {allRoles.map(r => <option key={r.id} value={r.id}>{r.name} {r.isSystem ? '(System)' : ''}</option>)}
                    </select>
                  </div>
                  <div className="flex gap-3 justify-end pt-2">
                    <button type="button" onClick={() => setShowAddUser(false)} className="px-5 py-2 rounded-lg border border-white/10 text-white hover:bg-white/5">Cancel</button>
                    <button type="submit" disabled={saving} className="px-5 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:opacity-90 disabled:opacity-50">{saving ? 'Adding...' : 'Add User'}</button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── BRANCHES ── */}
      {tab === 'branches' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-slate-400 text-sm">Multi-emirate branches for this tenant — each with its own Trade License, separate from the shared TRN.</p>
            <Link href="/admin/branches" className="text-sm text-emerald-400 hover:text-emerald-300 border border-emerald-500/30 px-4 py-2 rounded-xl transition-colors">
              Manage All Branches →
            </Link>
          </div>
          {branches.length === 0 ? (
            <div className="bg-slate-800/40 border border-white/10 rounded-2xl p-10 text-center">
              <p className="text-3xl mb-3">🏢</p>
              <p className="text-white font-medium">No branches configured</p>
              <p className="text-slate-500 text-sm mt-1">Add branches for each emirate this tenant operates in</p>
              <Link href="/admin/branches" className="mt-4 inline-block text-emerald-400 text-sm hover:text-emerald-300">+ Add Branch →</Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {branches.map((b: any) => {
                const FLAGS: Record<string,string>  = { ABU_DHABI:'🏛️', DUBAI:'🏙️', SHARJAH:'🕌', AJMAN:'⛵', UMM_AL_QUWAIN:'🌿', RAS_AL_KHAIMAH:'⛰️', FUJAIRAH:'🌊' };
                const LABELS: Record<string,string> = { ABU_DHABI:'Abu Dhabi', DUBAI:'Dubai', SHARJAH:'Sharjah', AJMAN:'Ajman', UMM_AL_QUWAIN:'Umm Al Quwain', RAS_AL_KHAIMAH:'Ras Al Khaimah', FUJAIRAH:'Fujairah' };
                const days = b.trade_license_expiry ? Math.floor((new Date(b.trade_license_expiry).getTime() - Date.now()) / 86400000) : null;
                return (
                  <div key={b.id} className={`bg-slate-800/50 border rounded-2xl p-5 ${b.is_default ? 'border-blue-500/30' : 'border-white/10'}`}>
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">{FLAGS[b.emirate] ?? '🏢'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-white font-semibold">{b.branch_name}</p>
                          {b.is_default && <span className="text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-1.5 py-0.5 rounded-full">HQ</span>}
                          {!b.is_active && <span className="text-[10px] bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded-full">Inactive</span>}
                        </div>
                        <p className="text-slate-400 text-xs mt-0.5">{LABELS[b.emirate] ?? b.emirate}</p>
                        <div className="mt-3 space-y-1.5 text-xs">
                          {b.trade_license_no && (
                            <div className="flex items-center gap-2">
                              <span className="text-slate-500 w-28">Trade License:</span>
                              <span className="text-slate-300 font-mono">{b.trade_license_no}</span>
                              {b.trade_license_authority && <span className="text-slate-600">({b.trade_license_authority})</span>}
                            </div>
                          )}
                          {days !== null && (
                            <div className="flex items-center gap-2">
                              <span className="text-slate-500 w-28">License Expiry:</span>
                              <span className={`font-medium ${days < 0 ? 'text-red-400' : days < 60 ? 'text-amber-400' : 'text-slate-300'}`}>
                                {b.trade_license_expiry} {days < 0 ? `(Expired ${Math.abs(days)}d ago)` : days < 60 ? `(Expires in ${days}d)` : ''}
                              </span>
                            </div>
                          )}
                          {b.cost_center_code && (
                            <div className="flex items-center gap-2">
                              <span className="text-slate-500 w-28">Cost Center:</span>
                              <span className="font-mono bg-slate-900 text-slate-300 px-2 py-0.5 rounded">{b.cost_center_code}</span>
                            </div>
                          )}
                          {b.billing_city && (
                            <div className="flex items-center gap-2">
                              <span className="text-slate-500 w-28">Address:</span>
                              <span className="text-slate-400">{b.billing_city}{b.billing_po_box ? `, P.O. Box ${b.billing_po_box}` : ''}</span>
                            </div>
                          )}
                          <div className="flex items-center gap-4 mt-2 pt-2 border-t border-white/5">
                            <span className="text-slate-600">{b.invoice_count ?? 0} invoices</span>
                            <span className="text-slate-600">{b.vehicle_count ?? 0} vehicles</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {tenant?.trn && (
            <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
              <span>🇦🇪</span>
              <p className="text-slate-400 text-xs">
                TRN <strong className="text-emerald-400 font-mono">{tenant.trn}</strong> is shared across all {branches.length} branch{branches.length !== 1 ? 'es' : ''} above.
                Each branch has its own trade license for emirate-level regulatory compliance.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── ROLES ── */}
      {tab === 'roles' && (
        <div className="space-y-4">
          <p className="text-slate-400 text-sm">Roles available for this tenant (includes system roles). Go to <a href="/admin/roles" className="text-blue-400 hover:underline">Roles page</a> to configure permission matrices.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {roles.map(r => (
              <div key={r.id} className="bg-slate-800/50 border border-white/10 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-white text-sm">{r.name}</span>
                  {r.isSystem && <span className="text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded">SYSTEM</span>}
                </div>
                <div className="text-xs text-slate-400 font-mono mb-2">{r.code}</div>
                <div className="text-xs text-slate-500">{r._count?.permissions ?? 0} permissions · {r._count?.userTenants ?? 0} users</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
