/**
 * src/app/(exchange)/exchange/profile/page.tsx
 *
 * Company Profile & Regulatory Info for Fleet360 Exchange.
 */

'use client';

import React, { useEffect, useState } from 'react';
import { Building2, ShieldCheck, CheckCircle2, Phone, Mail, MapPin } from 'lucide-react';

export default function ExchangeProfilePage() {
  const [partner, setPartner] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadProfile() {
      try {
        const res = await fetch('/api/exchange/partner/profile').then((r) => r.json());
        setPartner(res.partner);
      } catch {
        // Fallback
      } finally {
        setLoading(false);
      }
    }
    void loadProfile();
  }, []);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-xl font-black text-white">Company Profile</h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Your registered commercial entity details, tax credentials, and operational contacts across the Fleet360 platform.
        </p>
      </div>

      <div className="p-6 rounded-3xl bg-slate-900/60 border border-slate-800 space-y-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-cyan-600 text-white flex items-center justify-center font-bold text-xl shadow-lg shadow-cyan-600/30">
              ⚡
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">{partner?.legalName || 'ABC Transport LLC'}</h2>
              <p className="text-xs text-slate-400">Trade Name: {partner?.tradeName || 'ABC Express'}</p>
            </div>
          </div>
          <div className="text-right">
            <span className="text-[10px] px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400 font-bold border border-emerald-500/30">
              APPROVED PARTNER
            </span>
            <div className="text-xs font-mono text-cyan-400 mt-1">Code: {partner?.partnerCode || 'ABC-DXB'}</div>
          </div>
        </div>

        {/* Corporate & Regulatory Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-1">
            <span className="text-slate-400 text-[11px] block">UAE Trade License Number</span>
            <span className="font-bold text-white font-mono">{partner?.tradeLicenseNumber || 'CN-1029384 (Dubai DED)'}</span>
          </div>

          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-1">
            <span className="text-slate-400 text-[11px] block">Tax Registration Number (TRN)</span>
            <span className="font-bold text-white font-mono">{partner?.taxRegistrationNumber || '100-2938-4491-003'}</span>
          </div>

          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-1">
            <span className="text-slate-400 text-[11px] block">Headquarters Address</span>
            <span className="font-semibold text-slate-200">{partner?.address || 'Warehouse 14, Al Quoz Industrial Area 3, Dubai, UAE'}</span>
          </div>

          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-1">
            <span className="text-slate-400 text-[11px] block">Primary Operations Contact</span>
            <span className="font-semibold text-slate-200">
              {partner?.primaryContactName || 'Tariq Al-Mansoor'} ({partner?.primaryContactPhone || '+971 50 889 1234'})
            </span>
          </div>
        </div>

        {/* Service Domains */}
        <div className="space-y-2 pt-2 border-t border-slate-800">
          <span className="text-xs font-bold text-white block">Approved Transport Capabilities</span>
          <div className="flex flex-wrap gap-2">
            <span className="px-3 py-1.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-semibold">
              🚌 Staff & Crew Transportation (Passenger Transport)
            </span>
            <span className="px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-400 text-xs">
              🚗 Executive Limousine
            </span>
            <span className="px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-400 text-xs">
              🚚 Heavy Freight & Cargo
            </span>
            <span className="px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-400 text-xs">
              🚨 Breakdown & Flatbed Recovery
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
