'use client';
import React, { useState, useEffect } from 'react';

interface DashData {
  certification?: {
    readiness_score: number;
    tier: string;
    criteria: {
      has_ghg_data: boolean;
      has_fuel_logs: boolean;
      has_trip_logs: boolean;
      has_ev_vehicles: boolean;
      has_modal_shift: boolean;
      paperless_above_60: boolean;
    };
  };
  overview?: {
    co2_avoided_tonnes: number;
    fuel_saved_litres: number;
    green_fleet_pct: number;
    paperless_score: number;
  };
}

const CERTIFICATIONS = [
  {
    id: 'iso14064',
    name: 'ISO 14064-1:2018',
    fullName: 'GHG Quantification & Reporting',
    body: 'International Organization for Standardization',
    description: 'The international standard for quantifying and reporting greenhouse gas emissions. Required for credible carbon reduction claims.',
    requirements: [
      'Complete Scope 1, 2 & 3 GHG inventory',
      'Documented emission factors with sources',
      'Conservative baseline methodology',
      'Third-party verification (audit)',
      'Annual GHG reports with uncertainty analysis',
    ],
    relevance: 'Core certification — enables credible carbon credit claims and ESG reporting',
    color: 'emerald',
    icon: '🌍',
    effort: 'Medium',
    timeline: '3–6 months',
  },
  {
    id: 'ghg_protocol',
    name: 'GHG Protocol',
    fullName: 'Project Standard',
    body: 'World Resources Institute & WBCSD',
    description: 'Gold standard methodology for calculating GHG project reductions. Used by 92% of Fortune 500 companies.',
    requirements: [
      'Define project boundary and crediting period',
      'Establish conservative baseline scenario',
      'Quantify leakage and uncertainty',
      'Additionality demonstration',
      'Monitoring & verification plan',
    ],
    relevance: 'Required for carbon credit trading and offset certification',
    color: 'blue',
    icon: '📊',
    effort: 'High',
    timeline: '6–12 months',
  },
  {
    id: 'uae_green',
    name: 'UAE Green Label',
    fullName: 'UAE Ministry of Climate Change',
    body: 'MOCCAE / Ministry of Energy & Infrastructure',
    description: 'UAE national green certification for transport operators demonstrating verified sustainability practices aligned with UAE Net Zero 2050.',
    requirements: [
      'Minimum 10% EV or hybrid fleet share',
      'Verified GHG reduction vs baseline',
      'Digital operations score ≥ 60%',
      'UAE-based third-party auditor sign-off',
      'Annual compliance report to MOCCAE',
    ],
    relevance: 'Eligibility for UAE government transport tenders and green procurement',
    color: 'amber',
    icon: '🇦🇪',
    effort: 'Medium',
    timeline: '4–8 months',
  },
  {
    id: 'carbon_neutral',
    name: 'Carbon Neutral Certified',
    fullName: 'PAS 2060 / Carbon Trust Standard',
    body: 'Carbon Trust / BSI Group',
    description: 'International carbon neutrality certification. Demonstrates commitment to measure, reduce, and offset remaining emissions.',
    requirements: [
      'Full carbon footprint measurement (all Scopes)',
      'Science-Based Targets reduction plan',
      'Verified carbon offset purchases',
      'Public carbon neutral declaration',
      'Annual independent verification',
    ],
    relevance: 'Premium ESG credential for international clients and tenders',
    color: 'violet',
    icon: '⚖️',
    effort: 'Very High',
    timeline: '12–18 months',
  },
];

const TIER_COLORS: Record<string, string> = {
  BASELINE: 'from-slate-600 to-slate-700',
  BRONZE:   'from-amber-700 to-orange-700',
  SILVER:   'from-slate-400 to-slate-500',
  GOLD:     'from-yellow-500 to-amber-500',
};

const TIER_TEXT: Record<string, string> = {
  BASELINE: 'text-slate-400',
  BRONZE:   'text-amber-600',
  SILVER:   'text-slate-300',
  GOLD:     'text-yellow-400',
};

export default function CertificationsPage() {
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>('iso14064');

  useEffect(() => {
    fetch('/api/sustainability/dashboard')
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const cert   = data?.certification;
  const score  = cert?.readiness_score ?? 0;
  const tier   = cert?.tier ?? 'BASELINE';
  const crit   = cert?.criteria;

  const readinessChecks = crit ? [
    { label: 'GHG emissions data available', met: crit.has_ghg_data },
    { label: 'Fuel consumption logs recorded', met: crit.has_fuel_logs },
    { label: 'Trip logs for distance tracking', met: crit.has_trip_logs },
    { label: 'EV vehicles in fleet', met: crit.has_ev_vehicles },
    { label: 'Modal shift data tracked', met: crit.has_modal_shift },
    { label: 'Paperless score ≥ 60%', met: crit.paperless_above_60 },
  ] : [];

  const metCount = readinessChecks.filter(c => c.met).length;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-white">Certifications & Readiness</h1>
        <p className="text-slate-400 text-sm mt-1">ISO 14064 · GHG Protocol · UAE Green Label · Carbon Neutral assessment</p>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-4">
          {[...Array(3)].map((_, i) => <div key={i} className="h-32 bg-slate-800/60 rounded-2xl" />)}
        </div>
      ) : (
        <>
          {/* Current tier */}
          <div className={`bg-gradient-to-br ${TIER_COLORS[tier]} rounded-2xl p-6`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/70 text-sm">Current Certification Readiness Tier</p>
                <p className="text-4xl font-black text-white mt-1">{tier}</p>
                <p className="text-white/80 text-sm mt-2">Readiness score: <strong>{score}/100</strong></p>
              </div>
              <div className="text-6xl opacity-30">
                {tier === 'GOLD' ? '🥇' : tier === 'SILVER' ? '🥈' : tier === 'BRONZE' ? '🥉' : '📋'}
              </div>
            </div>
            <div className="mt-4 h-2 bg-black/20 rounded-full overflow-hidden">
              <div className="h-full bg-white/50 rounded-full" style={{ width: `${score}%` }} />
            </div>
            <div className="flex items-center justify-between text-xs text-white/50 mt-1.5">
              <span>BASELINE (0)</span>
              <span>BRONZE (40)</span>
              <span>SILVER (60)</span>
              <span>GOLD (80)</span>
            </div>
          </div>

          {/* Readiness checklist */}
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white font-semibold">Certification Readiness Checklist</h2>
              <span className={`font-bold ${metCount >= 5 ? 'text-emerald-400' : metCount >= 3 ? 'text-amber-400' : 'text-red-400'}`}>
                {metCount}/{readinessChecks.length} criteria met
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {readinessChecks.map(c => (
                <div key={c.label} className={`flex items-center gap-3 p-3 rounded-xl border ${
                  c.met ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-slate-800/60 border-white/5'
                }`}>
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${c.met ? 'bg-emerald-500' : 'bg-slate-700'}`}>
                    {c.met ? <span className="text-white text-xs">✓</span> : <span className="text-slate-500 text-xs">○</span>}
                  </div>
                  <span className={`text-sm ${c.met ? 'text-white' : 'text-slate-500'}`}>{c.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Certification cards */}
          <div className="space-y-3">
            <h2 className="text-white font-semibold">Available Certifications</h2>
            {CERTIFICATIONS.map(cert => (
              <div key={cert.id} className={`bg-slate-900 border rounded-2xl overflow-hidden transition-colors ${
                cert.color === 'emerald' ? 'border-emerald-500/20' :
                cert.color === 'blue'    ? 'border-blue-500/20' :
                cert.color === 'amber'   ? 'border-amber-500/20' :
                'border-violet-500/20'
              }`}>
                <button
                  className="w-full text-left px-6 py-4 flex items-center gap-4"
                  onClick={() => setExpanded(expanded === cert.id ? null : cert.id)}
                >
                  <span className="text-2xl">{cert.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-white font-semibold">{cert.name}</p>
                      <span className="text-slate-400 text-sm">— {cert.fullName}</span>
                    </div>
                    <p className="text-slate-500 text-xs">{cert.body}</p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${
                      cert.effort === 'Medium' ? 'border-amber-500/30 bg-amber-500/10 text-amber-400' :
                      cert.effort === 'High'   ? 'border-orange-500/30 bg-orange-500/10 text-orange-400' :
                      cert.effort === 'Very High' ? 'border-red-500/30 bg-red-500/10 text-red-400' :
                      'border-slate-500/30 bg-slate-500/10 text-slate-400'
                    }`}>{cert.effort}</span>
                    <span className="text-slate-400 text-lg">{expanded === cert.id ? '▲' : '▼'}</span>
                  </div>
                </button>

                {expanded === cert.id && (
                  <div className="px-6 pb-6 border-t border-white/5 pt-4 space-y-4">
                    <p className="text-slate-400 text-sm leading-relaxed">{cert.description}</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <p className="text-white text-xs font-semibold mb-2 uppercase tracking-wide">Requirements</p>
                        <ul className="space-y-1.5">
                          {cert.requirements.map(r => (
                            <li key={r} className="flex items-start gap-2 text-xs text-slate-400">
                              <span className="text-emerald-500 mt-0.5 flex-shrink-0">•</span>
                              {r}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="space-y-3">
                        <div className="bg-slate-800/60 rounded-xl p-3">
                          <p className="text-slate-500 text-xs mb-1">Why it matters</p>
                          <p className="text-slate-300 text-xs leading-relaxed">{cert.relevance}</p>
                        </div>
                        <div className="bg-slate-800/60 rounded-xl p-3 flex gap-4">
                          <div>
                            <p className="text-slate-500 text-xs">Timeline</p>
                            <p className="text-white text-sm font-semibold">{cert.timeline}</p>
                          </div>
                          <div>
                            <p className="text-slate-500 text-xs">Effort Level</p>
                            <p className="text-white text-sm font-semibold">{cert.effort}</p>
                          </div>
                        </div>
                        <button className={`w-full text-sm py-2.5 rounded-xl font-medium transition-colors ${
                          cert.color === 'emerald' ? 'bg-emerald-600 hover:bg-emerald-500 text-white' :
                          cert.color === 'blue'    ? 'bg-blue-600 hover:bg-blue-500 text-white' :
                          cert.color === 'amber'   ? 'bg-amber-600 hover:bg-amber-500 text-white' :
                          'bg-violet-600 hover:bg-violet-500 text-white'
                        }`}>
                          Start Certification Journey →
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
