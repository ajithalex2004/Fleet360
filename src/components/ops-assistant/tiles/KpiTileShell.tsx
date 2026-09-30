'use client';
/**
 * Shared layout for the Ops Assistant service cards.
 *
 * Every figure comes from the tenant's own records. A figure the records
 * can't support is passed as null and shown as "—"; a list with no rows
 * says so. Nothing is filled in with sample numbers or names.
 */
import React, { useEffect, useState } from 'react';
import Link from 'next/link';

export interface KpiMetric {
  label: string;
  value: string | null;
  tone: string;
}

export interface KpiListRow {
  key: string;
  title: string;
  detail?: string;
  value?: string;
}

/** Fetches JSON; null when the request fails or the endpoint refuses. */
export async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Runs `load` once on mount and returns its result; `undefined` while loading. */
export function useTileData<T>(load: () => Promise<T>): T | undefined {
  const [data, setData] = useState<T | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    load().then((d) => { if (!cancelled) setData(d); });
    return () => { cancelled = true; };
    // load is defined inline by each card and only needs to run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return data;
}

export const fmtInt = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? null : Math.round(n).toLocaleString('en-AE');
export const fmtPct = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? null : `${Math.round(n * 10) / 10}%`;
export const fmtAed = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? null : `AED ${Math.round(n).toLocaleString('en-AE')}`;

interface Props {
  icon: string;
  title: string;
  subtitle: string;
  accent: string;
  headerLink: { href: string; label: string };
  loading: boolean;
  unavailable?: boolean;
  metrics: KpiMetric[];
  listTitle: string;
  listRows: KpiListRow[];
  emptyText: string;
  footerLinks: Array<{ href: string; label: string }>;
}

export default function KpiTileShell(p: Props) {
  if (p.loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-slate-800/60 p-5 w-full max-w-2xl animate-pulse space-y-3">
        <div className="flex justify-between items-center">
          <div className="h-4 bg-slate-700 rounded w-1/3" />
          <div className="h-4 bg-slate-700 rounded w-1/6" />
        </div>
        <div className="grid grid-cols-4 gap-2 pt-2">
          {[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-slate-700/50 rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-800/70 p-5 w-full max-w-2xl shadow-xl space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">{p.icon}</span>
            <h3 className="text-base font-bold text-white tracking-tight">{p.title}</h3>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">{p.subtitle}</p>
        </div>
        <Link
          href={p.headerLink.href}
          className={`px-2.5 py-1 rounded-lg border text-xs font-semibold transition-all flex items-center gap-1 flex-shrink-0 ${p.accent}`}
        >
          <span>{p.headerLink.label}</span>
          <span>→</span>
        </Link>
      </div>

      {p.unavailable && (
        <p className="rounded-lg bg-slate-900/50 border border-white/8 px-3 py-2 text-xs text-slate-400">
          Figures could not be loaded right now.
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {p.metrics.map((m) => (
          <div key={m.label} className="rounded-xl border border-white/8 bg-slate-900/60 p-3 text-center">
            <p className={`text-xl font-bold ${m.value == null ? 'text-slate-500' : m.tone}`}>{m.value ?? '—'}</p>
            <p className="text-[10px] font-medium text-slate-400 mt-0.5">{m.label}</p>
          </div>
        ))}
      </div>

      <div className="space-y-2 border-t border-white/10 pt-3">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{p.listTitle}</p>
        {p.listRows.length === 0 ? (
          <p className="text-xs text-slate-500">{p.emptyText}</p>
        ) : (
          <div className="space-y-2">
            {p.listRows.map((r) => (
              <div key={r.key} className="bg-slate-900/40 rounded-xl p-2.5 text-xs flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-white truncate">{r.title}</p>
                  {r.detail && <p className="text-slate-400 truncate">{r.detail}</p>}
                </div>
                {r.value && <span className="text-slate-300 font-mono text-[11px] flex-shrink-0">{r.value}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/10 text-xs">
        <span className="text-[11px] text-slate-500">— means no data recorded yet</span>
        <div className="flex items-center gap-2">
          {p.footerLinks.map((l) => (
            <Link key={l.href} href={l.href} className="px-2.5 py-1 rounded-lg bg-slate-700/50 text-slate-300 hover:text-white font-medium">
              {l.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
