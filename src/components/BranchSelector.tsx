'use client';
import React, { useState, useRef, useEffect } from 'react';
import { useBranch, EMIRATE_LABELS, EMIRATE_FLAGS, Branch } from '@/contexts/BranchContext';

interface Props {
  /** compact mode for use inside PlatformHomeBar */
  compact?: boolean;
}

export default function BranchSelector({ compact = false }: Props) {
  const { branches, activeBranch, setActiveBranch, loading } = useBranch();
  const [open, setOpen] = useState(false);
  const ref  = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (branches.length === 0 && !loading) return null;

  const emirateFlag  = activeBranch ? (EMIRATE_FLAGS[activeBranch.emirate] ?? '🏢') : '🌐';
  const displayLabel = activeBranch
    ? activeBranch.branch_name
    : 'All Branches';

  const expiryWarning = (branch: Branch): 'ok' | 'warn' | 'expired' => {
    if (!branch.trade_license_expiry) return 'ok';
    const today    = new Date();
    const expiry   = new Date(branch.trade_license_expiry);
    const diffDays = Math.floor((expiry.getTime() - today.getTime()) / 86_400_000);
    if (diffDays < 0)  return 'expired';
    if (diffDays < 60) return 'warn';
    return 'ok';
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-2 rounded-xl border transition-all ${
          compact
            ? 'px-3 py-1.5 text-xs bg-slate-800/60 border-white/10 hover:border-white/20'
            : 'px-4 py-2 text-sm bg-slate-800 border-white/10 hover:border-emerald-500/40'
        } ${activeBranch ? 'border-emerald-500/30 bg-emerald-500/5' : ''}`}
      >
        <span>{emirateFlag}</span>
        <span className={`font-medium truncate max-w-36 ${activeBranch ? 'text-emerald-300' : 'text-slate-300'}`}>
          {loading ? 'Loading…' : displayLabel}
        </span>
        {activeBranch && (
          <span className="text-xs text-slate-500 bg-slate-900/60 px-1.5 py-0.5 rounded font-mono hidden sm:inline">
            {activeBranch.cost_center_code || EMIRATE_LABELS[activeBranch.emirate]?.slice(0, 3).toUpperCase()}
          </span>
        )}
        <svg className={`w-3.5 h-3.5 text-slate-400 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-slate-900 border border-white/10 rounded-2xl shadow-2xl shadow-black/50 z-[200] overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
            <p className="text-white text-sm font-semibold">Select Branch</p>
            <p className="text-slate-500 text-xs">{branches.length} branch{branches.length !== 1 ? 'es' : ''}</p>
          </div>

          {/* All Branches option */}
          <button
            onClick={() => { setActiveBranch(null); setOpen(false); }}
            className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors border-b border-white/5 ${!activeBranch ? 'bg-emerald-500/10' : ''}`}
          >
            <span className="text-xl">🌐</span>
            <div className="text-left flex-1">
              <p className={`text-sm font-medium ${!activeBranch ? 'text-emerald-300' : 'text-white'}`}>All Branches</p>
              <p className="text-xs text-slate-500">Consolidated view across all regions</p>
            </div>
            {!activeBranch && <span className="text-emerald-400 text-xs">✓</span>}
          </button>

          {/* Branch list */}
          <div className="max-h-72 overflow-y-auto">
            {branches.map(branch => {
              const warn    = expiryWarning(branch);
              const isActive = activeBranch?.id === branch.id;
              return (
                <button
                  key={branch.id}
                  onClick={() => { setActiveBranch(branch); setOpen(false); }}
                  className={`w-full flex items-start gap-3 px-4 py-3 hover:bg-white/5 transition-colors border-b border-white/5 last:border-0 ${isActive ? 'bg-emerald-500/10' : ''}`}
                >
                  <span className="text-xl flex-shrink-0 mt-0.5">{EMIRATE_FLAGS[branch.emirate] ?? '🏢'}</span>
                  <div className="text-left flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={`text-sm font-medium truncate ${isActive ? 'text-emerald-300' : 'text-white'}`}>
                        {branch.branch_name}
                      </p>
                      {branch.is_default && (
                        <span className="text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-1.5 rounded-full">HQ</span>
                      )}
                      {warn === 'expired' && (
                        <span className="text-[10px] bg-red-500/10 text-red-400 border border-red-500/20 px-1.5 rounded-full">License Expired</span>
                      )}
                      {warn === 'warn' && (
                        <span className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 rounded-full">Expiring Soon</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {EMIRATE_LABELS[branch.emirate] ?? branch.emirate}
                      {branch.trade_license_no && <span className="ml-2 font-mono text-slate-600">{branch.trade_license_no}</span>}
                    </p>
                    <div className="flex items-center gap-3 mt-1">
                      {branch.cost_center_code && (
                        <span className="text-[10px] font-mono bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">{branch.cost_center_code}</span>
                      )}
                      <span className="text-[10px] text-slate-600">{branch.vehicle_count} vehicles</span>
                      <span className="text-[10px] text-slate-600">{branch.invoice_count} invoices</span>
                    </div>
                  </div>
                  {isActive && <span className="text-emerald-400 text-xs flex-shrink-0 mt-0.5">✓</span>}
                </button>
              );
            })}
          </div>

          {/* Footer hint */}
          <div className="px-4 py-2 border-t border-white/5 bg-slate-950/40">
            <p className="text-slate-600 text-xs">Branch selection filters invoices, vehicles &amp; reports</p>
          </div>
        </div>
      )}
    </div>
  );
}
