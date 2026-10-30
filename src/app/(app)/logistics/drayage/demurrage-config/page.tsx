'use client';

import React, { useState, useEffect } from 'react';
import {
  Clock,
  Sliders,
  ShieldAlert,
  CheckCircle2,
  Save,
  RotateCcw,
  Calculator,
  DollarSign,
  Building2,
  Anchor,
} from 'lucide-react';
import { PageHeader, KpiCard, Panel } from '@/components/ui/page-theme';

export interface DemurrageTier {
  id: string;
  name: string;
  dayStart: number;
  dayEnd: number | null; // null for 11+
  dryDailyRateAed: number;
  reeferDailyRateAed: number;
  description: string;
}

export interface TerminalOverride {
  id: string;
  terminalName: string;
  portCode: string;
  freeDaysDry: number;
  freeDaysReefer: number;
}

const DEFAULT_TIERS: DemurrageTier[] = [
  {
    id: 't1',
    name: 'Tier 1 (Initial Overdue)',
    dayStart: 1,
    dayEnd: 5,
    dryDailyRateAed: 180,
    reeferDailyRateAed: 280,
    description: 'Applied immediately after port free-days expire (Days 1 to 5).',
  },
  {
    id: 't2',
    name: 'Tier 2 (Extended Dwell)',
    dayStart: 6,
    dayEnd: 10,
    dryDailyRateAed: 350,
    reeferDailyRateAed: 480,
    description: 'Secondary surcharge tier for prolonged terminal detention (Days 6 to 10).',
  },
  {
    id: 't3',
    name: 'Tier 3 (Chronic / Punitive)',
    dayStart: 11,
    dayEnd: null,
    dryDailyRateAed: 550,
    reeferDailyRateAed: 750,
    description: 'Escalated penalty rate for severe congestion & storage (Days 11 and above).',
  },
];

const DEFAULT_TERMINAL_OVERRIDES: TerminalOverride[] = [
  { id: 'dpw-t1', terminalName: 'DP World - Jebel Ali Terminal 1', portCode: 'AEJEA-T1', freeDaysDry: 5, freeDaysReefer: 3 },
  { id: 'dpw-t2', terminalName: 'DP World - Jebel Ali Terminal 2', portCode: 'AEJEA-T2', freeDaysDry: 5, freeDaysReefer: 3 },
  { id: 'dpw-t3', terminalName: 'DP World - Jebel Ali Terminal 3', portCode: 'AEJEA-T3', freeDaysDry: 5, freeDaysReefer: 3 },
  { id: 'kp-ad', terminalName: 'Khalifa Port Container Terminal', portCode: 'AEKHL-CT', freeDaysDry: 7, freeDaysReefer: 4 },
  { id: 'shj-pk', terminalName: 'Sharjah Container Terminal (Port Khalid)', portCode: 'AESHJ-PK', freeDaysDry: 5, freeDaysReefer: 3 },
];

export default function DemurrageConfigPage() {
  const [freeDaysDry, setFreeDaysDry] = useState(5);
  const [freeDaysReefer, setFreeDaysReefer] = useState(3);
  const [freeDaysSpecial, setFreeDaysSpecial] = useState(3);
  const [freeDaysHazmat, setFreeDaysHazmat] = useState(2);
  const [gracePeriodHours, setGracePeriodHours] = useState(4);
  const [tiers, setTiers] = useState<DemurrageTier[]>(DEFAULT_TIERS);
  const [terminalOverrides, setTerminalOverrides] = useState<TerminalOverride[]>(DEFAULT_TERMINAL_OVERRIDES);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Simulator State
  const [simType, setSimType] = useState<'DRY' | 'REEFER'>('DRY');
  const [simDays, setSimDays] = useState<number>(8);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('drayage_demurrage_config');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.freeDaysDry) setFreeDaysDry(parsed.freeDaysDry);
        if (parsed.freeDaysReefer) setFreeDaysReefer(parsed.freeDaysReefer);
        if (parsed.freeDaysSpecial) setFreeDaysSpecial(parsed.freeDaysSpecial);
        if (parsed.freeDaysHazmat) setFreeDaysHazmat(parsed.freeDaysHazmat);
        if (parsed.gracePeriodHours) setGracePeriodHours(parsed.gracePeriodHours);
        if (parsed.tiers) setTiers(parsed.tiers);
        if (parsed.terminalOverrides) setTerminalOverrides(parsed.terminalOverrides);
      }
    } catch {
      // Use defaults
    }
  }, []);

  const handleSave = () => {
    const config = {
      freeDaysDry,
      freeDaysReefer,
      freeDaysSpecial,
      freeDaysHazmat,
      gracePeriodHours,
      tiers,
      terminalOverrides,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem('drayage_demurrage_config', JSON.stringify(config));
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3500);
  };

  const handleReset = () => {
    if (confirm('Reset all demurrage free-days, rate tiers, and terminal overrides to standard UAE port defaults?')) {
      setFreeDaysDry(5);
      setFreeDaysReefer(3);
      setFreeDaysSpecial(3);
      setFreeDaysHazmat(2);
      setGracePeriodHours(4);
      setTiers(DEFAULT_TIERS);
      setTerminalOverrides(DEFAULT_TERMINAL_OVERRIDES);
      localStorage.removeItem('drayage_demurrage_config');
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2500);
    }
  };

  const updateTierRate = (id: string, field: 'dryDailyRateAed' | 'reeferDailyRateAed', val: number) => {
    setTiers((prev) => prev.map((t) => (t.id === id ? { ...t, [field]: val } : t)));
  };

  const updateTerminalDays = (id: string, field: 'freeDaysDry' | 'freeDaysReefer', val: number) => {
    setTerminalOverrides((prev) => prev.map((t) => (t.id === id ? { ...t, [field]: val } : t)));
  };

  // Simulator Calculation
  const simFreeAllowed = simType === 'REEFER' ? freeDaysReefer : freeDaysDry;
  const simOverdue = Math.max(0, simDays - simFreeAllowed);
  let simPenalty = 0;
  let simActiveTier = 'Free Period (No penalty)';
  let simCurrentDailyRate = 0;

  if (simOverdue > 0) {
    const isR = simType === 'REEFER';
    const t1 = tiers.find((t) => t.id === 't1') || DEFAULT_TIERS[0];
    const t2 = tiers.find((t) => t.id === 't2') || DEFAULT_TIERS[1];
    const t3 = tiers.find((t) => t.id === 't3') || DEFAULT_TIERS[2];

    const t1Days = Math.min(simOverdue, 5);
    const t2Days = Math.max(0, Math.min(simOverdue - 5, 5));
    const t3Days = Math.max(0, simOverdue - 10);

    const r1 = isR ? t1.reeferDailyRateAed : t1.dryDailyRateAed;
    const r2 = isR ? t2.reeferDailyRateAed : t2.dryDailyRateAed;
    const r3 = isR ? t3.reeferDailyRateAed : t3.dryDailyRateAed;

    simPenalty = t1Days * r1 + t2Days * r2 + t3Days * r3;

    if (simOverdue <= 5) {
      simActiveTier = 'Tier 1 (Days 1–5 Overdue)';
      simCurrentDailyRate = r1;
    } else if (simOverdue <= 10) {
      simActiveTier = 'Tier 2 (Days 6–10 Overdue)';
      simCurrentDailyRate = r2;
    } else {
      simActiveTier = 'Tier 3 (Days 11+ Overdue)';
      simCurrentDailyRate = r3;
    }
  }

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {savedSuccess && (
        <div className="fixed top-5 right-5 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl bg-emerald-950/90 border border-emerald-500/40 text-emerald-200 text-xs font-semibold shadow-2xl animate-in fade-in slide-in-from-top-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>Demurrage & Port Free-Days parameters saved successfully!</span>
        </div>
      )}

      {/* Header */}
      <PageHeader
        title="Demurrage & Port Free-Days Configuration"
        subtitle="Configure standard container free-day windows, progressive overdue penalty tiers, and terminal tariffs"
        icon={Sliders}
        accent="amber"
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Defaults
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              Save Configuration
            </button>
          </div>
        }
      />

      {/* Top Level KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Dry Free Allowance"
          value={`${freeDaysDry} Days`}
          icon={Clock}
          accent="blue"
          sub="Standard FCL Containers"
        />
        <KpiCard
          label="Reefer Free Allowance"
          value={`${freeDaysReefer} Days`}
          icon={Clock}
          accent="cyan"
          sub="Refrigerated Containers"
        />
        <KpiCard
          label="Active Penalty Tiers"
          value={`${tiers.length} Tiers`}
          icon={Sliders}
          accent="amber"
          sub="Progressive tariff rates"
        />
        <KpiCard
          label="Grace Period"
          value={`${gracePeriodHours} Hours`}
          icon={ShieldAlert}
          accent="emerald"
          sub="Discharge waiver buffer"
        />
      </div>

      {/* Section 1: Free Days Allowances */}
      <Panel title="Global Free-Day Windows by Equipment Type" icon={Clock} accent="blue">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          <div className="p-4 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] space-y-2">
            <label className="font-semibold text-[var(--text-main)] block">
              Standard Dry Containers (20FT / 40FT / 40HC)
            </label>
            <p className="text-[11px] text-[var(--text-muted)]">
              Default allowable free storage period from vessel discharge timestamp.
            </p>
            <div className="flex items-center gap-2 pt-1">
              <input
                type="number"
                min={1}
                max={30}
                value={freeDaysDry}
                onChange={(e) => setFreeDaysDry(Number(e.target.value))}
                className="w-24 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] font-mono font-bold text-[var(--text-main)]"
              />
              <span className="text-xs text-[var(--text-muted)]">Days</span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] space-y-2">
            <label className="font-semibold text-[var(--text-main)] block">
              Reefer Containers (Cold-Chain)
            </label>
            <p className="text-[11px] text-[var(--text-muted)]">
              Strict free window due to refrigerated container monitoring and terminal power draw.
            </p>
            <div className="flex items-center gap-2 pt-1">
              <input
                type="number"
                min={1}
                max={15}
                value={freeDaysReefer}
                onChange={(e) => setFreeDaysReefer(Number(e.target.value))}
                className="w-24 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] font-mono font-bold text-[var(--text-main)]"
              />
              <span className="text-xs text-[var(--text-muted)]">Days</span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] space-y-2">
            <label className="font-semibold text-[var(--text-main)] block">
              Special Equipment (Open Top / Flat Rack)
            </label>
            <p className="text-[11px] text-[var(--text-muted)]">
              Out-of-gauge (OOG) and heavy machinery flatbed units.
            </p>
            <div className="flex items-center gap-2 pt-1">
              <input
                type="number"
                min={1}
                max={15}
                value={freeDaysSpecial}
                onChange={(e) => setFreeDaysSpecial(Number(e.target.value))}
                className="w-24 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] font-mono font-bold text-[var(--text-main)]"
              />
              <span className="text-xs text-[var(--text-muted)]">Days</span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] space-y-2">
            <label className="font-semibold text-[var(--text-main)] block">
              Hazardous / Dangerous Goods (IMO)
            </label>
            <p className="text-[11px] text-[var(--text-muted)]">
              Port safety regulations enforce shortened dwell times for hazmat cargo.
            </p>
            <div className="flex items-center gap-2 pt-1">
              <input
                type="number"
                min={1}
                max={10}
                value={freeDaysHazmat}
                onChange={(e) => setFreeDaysHazmat(Number(e.target.value))}
                className="w-24 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] font-mono font-bold text-[var(--text-main)]"
              />
              <span className="text-xs text-[var(--text-muted)]">Days</span>
            </div>
          </div>
        </div>
      </Panel>

      {/* Section 2: Progressive Penalty Tiers Definition */}
      <Panel
        title="Progressive Overdue Penalty Tiers & Daily Tariffs"
        subtitle="Define escalating AED rates as dwell duration increases across port terminals"
        icon={DollarSign}
        accent="amber"
      >
        <div className="space-y-4 text-xs">
          {tiers.map((tier, idx) => (
            <div
              key={tier.id}
              className="p-4 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] flex flex-col lg:flex-row lg:items-center justify-between gap-4"
            >
              <div className="space-y-1 max-w-md">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-lg bg-amber-500/15 text-amber-400 font-bold text-xs flex items-center justify-center">
                    {idx + 1}
                  </span>
                  <h4 className="font-bold text-sm text-[var(--text-main)]">{tier.name}</h4>
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-muted)]">
                    {tier.dayEnd ? `Days ${tier.dayStart} – ${tier.dayEnd}` : `Day ${tier.dayStart}+ onwards`}
                  </span>
                </div>
                <p className="text-[11px] text-[var(--text-muted)]">{tier.description}</p>
              </div>

              <div className="grid grid-cols-2 gap-3 w-full lg:w-auto">
                <div className="p-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-1">
                  <span className="text-[10px] font-semibold text-[var(--text-muted)] uppercase block">
                    Dry Rate (AED / Day)
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-blue-400 font-bold">AED</span>
                    <input
                      type="number"
                      value={tier.dryDailyRateAed}
                      onChange={(e) => updateTierRate(tier.id, 'dryDailyRateAed', Number(e.target.value))}
                      className="w-24 px-2 py-1 rounded bg-[var(--bg-main)] border border-[var(--border-subtle)] font-mono font-bold text-[var(--text-main)] outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-1">
                  <span className="text-[10px] font-semibold text-[var(--text-muted)] uppercase block">
                    Reefer Rate (AED / Day)
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-cyan-400 font-bold">AED</span>
                    <input
                      type="number"
                      value={tier.reeferDailyRateAed}
                      onChange={(e) => updateTierRate(tier.id, 'reeferDailyRateAed', Number(e.target.value))}
                      className="w-24 px-2 py-1 rounded bg-[var(--bg-main)] border border-[var(--border-subtle)] font-mono font-bold text-[var(--text-main)] outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {/* Section 3: Port Terminal Free-Days Overrides */}
      <Panel
        title="Port Terminal Tariff Free-Day Overrides"
        subtitle="Individual terminal port policies overriding global defaults"
        icon={Building2}
        accent="blue"
      >
        <div className="overflow-x-auto text-xs">
          <table className="w-full text-left">
            <thead className="bg-[var(--bg-main)] text-[var(--text-muted)] uppercase tracking-wider text-[10px] border-b border-[var(--border-subtle)]">
              <tr>
                <th className="py-2.5 px-3 font-semibold">Port Terminal Facility</th>
                <th className="py-2.5 px-3 font-semibold">UN/LOCODE</th>
                <th className="py-2.5 px-3 font-semibold">Dry Free Allowance</th>
                <th className="py-2.5 px-3 font-semibold">Reefer Free Allowance</th>
                <th className="py-2.5 px-3 font-semibold text-right">Tariff Policy</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)] text-[var(--text-main)]">
              {terminalOverrides.map((t) => (
                <tr key={t.id} className="hover:bg-[var(--bg-surface-hover)] transition-colors">
                  <td className="py-3 px-3 font-medium flex items-center gap-2">
                    <Anchor className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                    <span>{t.terminalName}</span>
                  </td>
                  <td className="py-3 px-3 font-mono text-[var(--text-muted)]">{t.portCode}</td>
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={t.freeDaysDry}
                        onChange={(e) => updateTerminalDays(t.id, 'freeDaysDry', Number(e.target.value))}
                        className="w-16 px-2 py-1 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] font-mono font-semibold text-[var(--text-main)]"
                      />
                      <span className="text-[11px] text-[var(--text-muted)]">Days</span>
                    </div>
                  </td>
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={t.freeDaysReefer}
                        onChange={(e) => updateTerminalDays(t.id, 'freeDaysReefer', Number(e.target.value))}
                        className="w-16 px-2 py-1 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] font-mono font-semibold text-[var(--text-main)]"
                      />
                      <span className="text-[11px] text-[var(--text-muted)]">Days</span>
                    </div>
                  </td>
                  <td className="py-3 px-3 text-right">
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      Active DPW / Port Master
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Section 4: Live Demurrage Calculator Simulator */}
      <Panel
        title="Interactive Demurrage Penalty Simulator"
        subtitle="Test tariff calculations and penalty accrual for any container and dwell period"
        icon={Calculator}
        accent="emerald"
      >
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 text-xs">
          <div className="space-y-4 p-4 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)]">
            <h4 className="font-bold text-[var(--text-main)] flex items-center gap-2">
              <Calculator className="w-4 h-4 text-emerald-400" />
              Scenario Inputs
            </h4>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-[var(--text-muted)]">Container Equipment Type</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSimType('DRY')}
                  className={`py-2 px-3 rounded-lg border font-semibold text-xs transition-colors ${
                    simType === 'DRY'
                      ? 'bg-blue-600/20 border-blue-500/40 text-blue-300'
                      : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-muted)]'
                  }`}
                >
                  Dry Standard
                </button>
                <button
                  type="button"
                  onClick={() => setSimType('REEFER')}
                  className={`py-2 px-3 rounded-lg border font-semibold text-xs transition-colors ${
                    simType === 'REEFER'
                      ? 'bg-cyan-600/20 border-cyan-500/40 text-cyan-300'
                      : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-muted)]'
                  }`}
                >
                  Reefer Cold-Chain
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between">
                <label className="text-[11px] font-semibold text-[var(--text-muted)]">Days in Port Dwell</label>
                <span className="font-mono font-bold text-[var(--text-main)]">{simDays} Days</span>
              </div>
              <input
                type="range"
                min={1}
                max={25}
                value={simDays}
                onChange={(e) => setSimDays(Number(e.target.value))}
                className="w-full accent-blue-500"
              />
              <div className="flex justify-between text-[10px] text-[var(--text-faint)]">
                <span>1 Day</span>
                <span>10 Days</span>
                <span>25 Days</span>
              </div>
            </div>
          </div>

          <div className="lg:col-span-2 p-5 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] flex flex-col justify-between">
            <div className="space-y-3">
              <h4 className="font-bold text-[var(--text-main)] text-sm">Calculated Demurrage Assessment</h4>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                  <span className="text-[10px] uppercase text-[var(--text-muted)] block">Free Days Allowed</span>
                  <strong className="text-base font-bold text-[var(--text-main)]">{simFreeAllowed} Days</strong>
                </div>

                <div className="p-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                  <span className="text-[10px] uppercase text-[var(--text-muted)] block">Overdue Duration</span>
                  <strong className={`text-base font-bold ${simOverdue > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {simOverdue} Days
                  </strong>
                </div>

                <div className="p-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                  <span className="text-[10px] uppercase text-[var(--text-muted)] block">Active Tier</span>
                  <strong className="text-xs font-semibold text-amber-400 block truncate">{simActiveTier}</strong>
                </div>

                <div className="p-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                  <span className="text-[10px] uppercase text-[var(--text-muted)] block">Current Daily Rate</span>
                  <strong className="text-base font-bold text-[var(--text-main)]">AED {simCurrentDailyRate}</strong>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-[var(--border-subtle)] flex items-center justify-between">
              <div>
                <span className="text-xs text-[var(--text-muted)] block">Total Accrued Demurrage Liability:</span>
                <span className="text-xs text-[var(--text-faint)]">Calculated based on configured multi-tier progressive formulas</span>
              </div>
              <div className="text-right">
                <span className="text-2xl font-black font-mono text-emerald-400">
                  AED {simPenalty.toLocaleString()}
                </span>
                <span className="text-[10px] text-[var(--text-muted)] block">Excl. VAT</span>
              </div>
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}
