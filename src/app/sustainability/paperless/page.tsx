'use client';
import React, { useState, useEffect } from 'react';

interface DashData {
  paperless?: {
    score: number;
    digital_trip_sheets: number;
    paper_trip_sheets: number;
    digital_invoices: number;
    paper_invoices_equivalent: number;
    co2_saved_kg: number;
    trees_equivalent: number;
  };
}

const PAPER_FACTS = [
  { icon: '🌳', label: 'kg CO₂ per ream of paper (500 sheets)', value: '2.5 kg' },
  { icon: '💧', label: 'Litres of water per A4 sheet produced', value: '10 L' },
  { icon: '♻️', label: 'Digital document CO₂ vs paper reduction', value: '~95%' },
  { icon: '📱', label: 'ePOD signature replaces 3 paper forms', value: '3 docs' },
];

const INITIATIVES = [
  { title: 'Digital Trip Sheets', desc: 'All trip manifests generated digitally — no paper runsheets', icon: '📋', implemented: true },
  { title: 'ePOD Signatures', desc: 'Electronic proof of delivery with GPS coordinates and photo upload', icon: '✍️', implemented: true },
  { title: 'Digital Invoicing', desc: 'PDF invoices emailed directly — no paper statements mailed', icon: '📄', implemented: true },
  { title: 'WhatsApp Notifications', desc: 'Driver and passenger notifications via WhatsApp — zero paper', icon: '💬', implemented: true },
  { title: 'Digital Inspection Reports', desc: 'Vehicle inspection checklists submitted via mobile app', icon: '🔍', implemented: true },
  { title: 'RFID Student Attendance', desc: 'School bus attendance tracked digitally — replaces sign-in sheets', icon: '🏫', implemented: true },
  { title: 'Blockchain Audit Trail', desc: 'Immutable digital audit records replacing physical log books', icon: '⛓️', implemented: false },
  { title: 'QR Code Compliance Docs', desc: 'Vehicle compliance certificates accessible via QR scan', icon: '📷', implemented: false },
];

export default function PaperlessPage() {
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/sustainability/dashboard')
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const p = data?.paperless;
  const score = p?.score ?? 0;
  const totalDocs = (p?.digital_trip_sheets ?? 0) + (p?.digital_invoices ?? 0);

  const scoreColor = score >= 80 ? 'text-emerald-400' : score >= 60 ? 'text-amber-400' : 'text-red-400';
  const scoreBg    = score >= 80 ? 'from-emerald-500 to-green-600' : score >= 60 ? 'from-amber-500 to-orange-600' : 'from-red-500 to-rose-600';
  const scoreLabel = score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Developing' : 'Getting Started';

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-white">Paperless Operations</h1>
        <p className="text-slate-400 text-sm mt-1">Digital transformation impact · Paper waste reduction · Carbon offset from digitisation</p>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-4">
          {[...Array(3)].map((_, i) => <div key={i} className="h-32 bg-slate-800/60 rounded-2xl" />)}
        </div>
      ) : (
        <>
          {/* Score hero */}
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-6 flex items-center gap-8">
            <div className="relative flex-shrink-0">
              <div className={`w-32 h-32 rounded-full bg-gradient-to-br ${scoreBg} flex items-center justify-center shadow-2xl`}>
                <div className="text-center">
                  <p className="text-3xl font-black text-white">{score}</p>
                  <p className="text-white/70 text-xs font-medium">/100</p>
                </div>
              </div>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h2 className="text-2xl font-bold text-white">Paperless Score</h2>
                <span className={`text-sm font-semibold px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 ${scoreColor}`}>{scoreLabel}</span>
              </div>
              <p className="text-slate-400 text-sm">
                Measures what percentage of operational documents (trip sheets, invoices, inspection reports, attendance) are processed digitally vs. paper-based equivalents.
              </p>
              <div className="mt-4 h-2 bg-slate-800 rounded-full overflow-hidden">
                <div className={`h-full bg-gradient-to-r ${scoreBg} rounded-full transition-all duration-1000`} style={{ width: `${score}%` }} />
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500 mt-1.5">
                <span>0 — Paper-only</span>
                <span>100 — Fully Digital</span>
              </div>
            </div>
          </div>

          {/* KPI tiles */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { icon: '📋', label: 'Digital Trip Sheets', value: (p?.digital_trip_sheets ?? 0).toLocaleString(), sub: 'paperless runsheets', color: 'text-emerald-400' },
              { icon: '📄', label: 'Digital Invoices', value: (p?.digital_invoices ?? 0).toLocaleString(), sub: 'emailed PDF', color: 'text-blue-400' },
              { icon: '🌿', label: 'CO₂ Offset', value: `${((p?.co2_saved_kg ?? 0) / 1000).toFixed(2)} t`, sub: 'paper production avoided', color: 'text-emerald-400' },
              { icon: '🌳', label: 'Trees Equivalent', value: Math.round(p?.trees_equivalent ?? 0).toLocaleString(), sub: 'paper trees saved', color: 'text-green-400' },
            ].map(k => (
              <div key={k.label} className="bg-slate-900 border border-white/10 rounded-2xl p-5">
                <p className="text-slate-400 text-xs">{k.icon} {k.label}</p>
                <p className={`text-3xl font-bold mt-1 ${k.color}`}>{k.value}</p>
                <p className="text-slate-600 text-xs mt-1">{k.sub}</p>
              </div>
            ))}
          </div>

          {/* Paper facts */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {PAPER_FACTS.map(f => (
              <div key={f.label} className="bg-slate-800/40 border border-white/5 rounded-xl p-4 text-center">
                <p className="text-2xl mb-2">{f.icon}</p>
                <p className="text-white font-bold text-lg">{f.value}</p>
                <p className="text-slate-500 text-xs mt-1 leading-relaxed">{f.label}</p>
              </div>
            ))}
          </div>

          {/* Initiatives grid */}
          <div>
            <h2 className="text-white font-semibold mb-4">Digital Initiatives Status</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {INITIATIVES.map(ini => (
                <div key={ini.title} className={`flex items-start gap-3 p-4 rounded-xl border transition-colors ${
                  ini.implemented
                    ? 'bg-emerald-500/5 border-emerald-500/20'
                    : 'bg-slate-900/50 border-white/5'
                }`}>
                  <span className="text-xl flex-shrink-0">{ini.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-white font-medium text-sm">{ini.title}</p>
                      {ini.implemented
                        ? <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full">Live</span>
                        : <span className="text-xs bg-slate-700/60 text-slate-400 border border-white/10 px-2 py-0.5 rounded-full">Planned</span>
                      }
                    </div>
                    <p className="text-slate-400 text-xs mt-1 leading-relaxed">{ini.desc}</p>
                  </div>
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${ini.implemented ? 'bg-emerald-500' : 'bg-slate-700'}`}>
                    {ini.implemented ? <span className="text-white text-xs">✓</span> : <span className="text-slate-500 text-xs">○</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Progress to full digital */}
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-white font-semibold">Progress to Fully Digital Operations</h2>
              <span className="text-emerald-400 font-bold">{INITIATIVES.filter(i => i.implemented).length}/{INITIATIVES.length} initiatives live</span>
            </div>
            <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-green-600 rounded-full"
                style={{ width: `${Math.round((INITIATIVES.filter(i => i.implemented).length / INITIATIVES.length) * 100)}%` }}
              />
            </div>
            <p className="text-slate-500 text-xs mt-3">
              {totalDocs.toLocaleString()} total digital documents processed · eliminating an estimated {Math.round((p?.trees_equivalent ?? 0))} trees worth of paper consumption.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
