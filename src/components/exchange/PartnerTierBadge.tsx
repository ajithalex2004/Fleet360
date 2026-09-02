/**
 * src/components/exchange/PartnerTierBadge.tsx
 *
 * Reusable visual badge for Partner Performance Tiers.
 */

'use client';

import React from 'react';
import { Award, Shield, Sparkles, Star } from 'lucide-react';
import { PartnerPerformanceTier } from '@prisma/client';

interface PartnerTierBadgeProps {
  tier?: PartnerPerformanceTier | string;
  showScore?: boolean;
  score?: number;
}

export function PartnerTierBadge({ tier = 'STANDARD', showScore = false, score }: PartnerTierBadgeProps) {
  switch (tier) {
    case 'PLATINUM':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-gradient-to-r from-slate-200 via-cyan-200 to-indigo-200 text-slate-900 shadow-sm border border-cyan-300/60 font-sans">
          <Sparkles className="w-3 h-3 text-indigo-700" />
          <span>Platinum Partner</span>
          {showScore && score != null && <span className="font-mono font-black ml-0.5">({score.toFixed(0)})</span>}
        </span>
      );

    case 'GOLD':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm font-sans">
          <Award className="w-3 h-3 text-amber-400" />
          <span>Gold Partner</span>
          {showScore && score != null && <span className="font-mono font-bold ml-0.5">({score.toFixed(0)})</span>}
        </span>
      );

    case 'SILVER':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-400/20 text-slate-300 border border-slate-400/40 font-sans">
          <Shield className="w-3 h-3 text-slate-300" />
          <span>Silver Partner</span>
          {showScore && score != null && <span className="font-mono font-bold ml-0.5">({score.toFixed(0)})</span>}
        </span>
      );

    case 'BRONZE':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-orange-700/20 text-orange-400 border border-orange-700/40 font-sans">
          <Star className="w-3 h-3 text-orange-400" />
          <span>Bronze Partner</span>
          {showScore && score != null && <span className="font-mono font-bold ml-0.5">({score.toFixed(0)})</span>}
        </span>
      );

    default: // STANDARD
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-400 border border-slate-700 font-sans">
          <span>Standard Partner</span>
        </span>
      );
  }
}
