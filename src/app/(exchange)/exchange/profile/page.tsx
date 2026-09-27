/**
 * src/app/(exchange)/exchange/profile/page.tsx
 *
 * Company Profile & Regulatory Info for Fleet360 Exchange.
 */

'use client';

import React, { useEffect, useState } from 'react';
import { Building2, ShieldCheck, CheckCircle2, Phone, Mail, MapPin } from 'lucide-react';

const NOT_SET = '—';

const SERVICE_AREAS = [
  { domain: 'PASSENGER_TRANSPORT', label: '🚌 Passenger transport' },
  { domain: 'LIMOUSINE',           label: '🚗 Limousine' },
  { domain: 'SCHOOL_TRANSPORT',    label: '🚸 School transport' },
  { domain: 'FREIGHT',             label: '🚚 Freight & cargo' },
  { domain: 'RECOVERY',            label: '🚨 Breakdown & recovery' },
];

export default function ExchangeProfilePage() {
  const [partner, setPartner] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    async function loadProfile() {
      try {
        const r = await fetch('/api/exchange/partner/profile');
        const res = await r.json().catch(() => ({}));
        if (!r.ok) {
          setLoadError(res.error ?? 'Could not load the company profile.');
          return;
        }
        setPartner(res.partner);
        if (!res.partner) setLoadError('Your account is not linked to a transport partner.');
      } catch {
        setLoadError('Could not load the company profile.');
      } finally {
        setLoading(false);
      }
    }
    void loadProfile();
  }, []);

  const approvedDomains = new Set<string>(
    (partner?.capabilities ?? [])
      .filter((c: { isApproved?: boolean }) => c.isApproved)
      .map((c: { domain: string }) => c.domain),
  );

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-xl font-black text-white">Company Profile</h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Your registered commercial entity details, tax credentials, and operational contacts across the Fleet360 platform.
        </p>
      </div>

      {loadError && (
        <div className="rounded-2xl border border-amber-700 bg-amber-950/40 px-4 py-3 text-xs text-amber-300">{loadError}</div>
      )}

      {loading && !partner && !loadError && (
        <div className="p-6 rounded-3xl bg-slate-900/60 border border-slate-800 text-xs text-slate-400">Loading company profile…</div>
      )}

      {partner && (
      <div className="p-6 rounded-3xl bg-slate-900/60 border border-slate-800 space-y-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-cyan-600 text-white flex items-center justify-center font-bold text-xl shadow-lg shadow-cyan-600/30">
              ⚡
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">{partner.legalName}</h2>
              <p className="text-xs text-slate-400">Trade Name: {partner.tradeName || NOT_SET}</p>
            </div>
          </div>
          <div className="text-right">
            <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold border ${
              partner.onboardingStatus === 'APPROVED'
                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
            }`}>
              {partner.onboardingStatus === 'APPROVED' ? 'APPROVED PARTNER' : `ONBOARDING: ${String(partner.onboardingStatus).replace(/_/g, ' ')}`}
            </span>
            <div className="text-xs font-mono text-cyan-400 mt-1">Code: {partner.partnerCode}</div>
          </div>
        </div>

        {/* Corporate & Regulatory Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-1">
            <span className="text-slate-400 text-[11px] block">UAE Trade License Number</span>
            <span className="font-bold text-white font-mono">{partner.tradeLicenseNumber || NOT_SET}</span>
          </div>

          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-1">
            <span className="text-slate-400 text-[11px] block">Tax Registration Number (TRN)</span>
            <span className="font-bold text-white font-mono">{partner.taxRegistrationNumber || NOT_SET}</span>
          </div>

          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-1">
            <span className="text-slate-400 text-[11px] block">Headquarters Address</span>
            <span className="font-semibold text-slate-200">{[partner.address, partner.city].filter(Boolean).join(', ') || NOT_SET}</span>
          </div>

          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-1">
            <span className="text-slate-400 text-[11px] block">Primary Operations Contact</span>
            <span className="font-semibold text-slate-200">
              {[partner.primaryContactName, partner.primaryContactPhone, partner.primaryContactEmail].filter(Boolean).join(' · ') || NOT_SET}
            </span>
          </div>
        </div>

        {/* Service Domains */}
        <div className="space-y-2 pt-2 border-t border-slate-800">
          <span className="text-xs font-bold text-white block">Approved Transport Capabilities</span>
          <div className="flex flex-wrap gap-2">
            {SERVICE_AREAS.map((area) => {
              const approved = approvedDomains.has(area.domain);
              return (
                <span
                  key={area.domain}
                  className={`px-3 py-1.5 rounded-xl text-xs ${
                    approved
                      ? 'bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 font-semibold'
                      : 'bg-slate-800 border border-slate-700 text-slate-500'
                  }`}
                >
                  {area.label}{approved ? '' : ' (not approved)'}
                </span>
              );
            })}
          </div>
          {approvedDomains.size === 0 && (
            <p className="text-[11px] text-amber-400">
              No approved services yet, so the marketplace only shows jobs a buyer invites you to directly. Contact the Fleet360 team to get approved.
            </p>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
