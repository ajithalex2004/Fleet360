'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';

interface ContractClauseItem {
  id: string;
  documentId: string;
  clauseNumber: string;
  title: string;
  content: string;
  pageNumber: number;
  obligationType: string;
  penaltyAed?: number;
  createdAt: string;
}

interface Props {
  query?: string;
  obligationType?: string;
  title?: string;
}

const obligationBadgeConfig: Record<string, { label: string; color: string; bg: string }> = {
  PENALTY:     { label: 'SLA Penalty',     color: 'text-red-400',    bg: 'bg-red-500/15 border-red-500/40' },
  TERMINATION: { label: 'Termination',     color: 'text-amber-400',  bg: 'bg-amber-500/15 border-amber-500/30' },
  PAYMENT:     { label: 'Payment Terms',   color: 'text-blue-400',   bg: 'bg-blue-500/15 border-blue-500/30' },
  RENEWAL:     { label: 'Renewal',         color: 'text-purple-400', bg: 'bg-purple-500/15 border-purple-500/30' },
  INDEMNITY:   { label: 'Indemnity',       color: 'text-orange-400', bg: 'bg-orange-500/15 border-orange-500/30' },
  GENERAL:     { label: 'General Clause',  color: 'text-slate-400',  bg: 'bg-slate-500/15 border-slate-500/30' },
};

export default function ContractClausesCard({ query, obligationType, title }: Props) {
  const [clauses, setClauses] = useState<ContractClauseItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchClauses = async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (query) sp.set('query', query);
      const res = await fetch(`/api/documents/intelligence/contracts/clauses?${sp.toString()}`, {
        cache: 'no-store',
      });
      const data = await res.json();
      let list = data.clauses || [];
      if (obligationType) {
        list = list.filter((c: ContractClauseItem) => c.obligationType?.toUpperCase() === obligationType.toUpperCase());
      }
      setClauses(list);
    } catch {
      // silent fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClauses();
  }, [query, obligationType]);

  const penaltyClauses = clauses.filter((c) => c.obligationType === 'PENALTY' || c.penaltyAed);

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-800/50 backdrop-blur-sm p-5 w-full max-w-2xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">📜</span>
          <h3 className="text-sm font-semibold text-white">
            {title ?? (query ? `Contract Clauses: "${query}"` : 'Indexed Contract Clauses & Obligations')}
          </h3>
          {penaltyClauses.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30">
              {penaltyClauses.length} Penalty SLA{penaltyClauses.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/fleet/document-intelligence"
            className="text-xs text-orange-400 hover:text-orange-300 transition-colors"
          >
            Open Vault →
          </Link>
          <button
            onClick={fetchClauses}
            className="text-xs text-slate-400 hover:text-white bg-slate-700/60 px-2 py-1 rounded-lg transition-colors"
          >
            ↻
          </button>
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-6 text-slate-400 text-xs gap-2">
          <div className="w-4 h-4 rounded-full border-2 border-orange-400 border-t-transparent animate-spin" />
          <span>Searching indexed contract intelligence...</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && clauses.length === 0 && (
        <div className="py-6 text-center text-slate-400 text-xs">
          No contract clauses found matching {query ? `"${query}"` : 'criteria'}.
        </div>
      )}

      {/* Clauses list */}
      {!loading && clauses.length > 0 && (
        <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
          {clauses.map((c) => {
            const badge = obligationBadgeConfig[c.obligationType] || obligationBadgeConfig.GENERAL;
            return (
              <div
                key={c.id}
                className="rounded-xl border border-white/5 bg-slate-900/60 p-3 space-y-1.5 hover:border-white/20 transition-all"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-mono text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
                      Sec {c.clauseNumber}
                    </span>
                    <span className="text-xs font-semibold text-white truncate">{c.title}</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {c.penaltyAed !== undefined && c.penaltyAed > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-500/20 text-red-300 border border-red-500/40">
                        AED {c.penaltyAed.toLocaleString()}
                      </span>
                    )}
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${badge.bg} ${badge.color}`}>
                      {badge.label}
                    </span>
                  </div>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed line-clamp-2">
                  {c.content}
                </p>

                <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-white/5">
                  <span>Page {c.pageNumber}</span>
                  <span className="font-mono text-[10px] text-slate-400">ID: {c.documentId}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
