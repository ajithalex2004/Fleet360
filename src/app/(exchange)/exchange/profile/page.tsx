/**
 * src/app/(exchange)/exchange/profile/page.tsx
 *
 * Phase 10: Partner Company Profile, Multi-Emirate Service Area & Special Zone Matrix,
 * and 6-Category Compliance Qualification Overview for Fleet360 Exchange.
 */

'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  ShieldCheck,
  CheckCircle2,
  MapPin,
  Edit3,
  Globe,
  Save,
  X,
} from 'lucide-react';

const NOT_SET = '—';

const SERVICE_DOMAINS = [
  {
    domain: 'PASSENGER_TRANSPORT',
    label: '🚌 Passenger & Staff Transport',
    requiredPermits: 'RTA / ITC Passenger Transport Permit, 50-Seat / Coaster Mulkiya, Heavy Bus Driver Permit',
  },
  {
    domain: 'LIMOUSINE',
    label: '🚗 Limousine & VIP Chauffeur',
    requiredPermits: 'RTA Luxury Limousine & Chauffeur Franchise Permit, Airport VIP Apron Pass',
  },
  {
    domain: 'FREIGHT',
    label: '🚚 Freight & Heavy Logistics',
    requiredPermits: 'National Freight Transport Permit, GIT Cargo Insurance, Port/Freezone Passes (JAFZA/KIZAD)',
  },
  {
    domain: 'RECOVERY',
    label: '🚨 Breakdown & Roadside Recovery',
    requiredPermits: 'RTA Roadside Recovery & Towing Permit, Hydraulic Winch/Crane Inspection Certificate',
  },
  {
    domain: 'SCHOOL_TRANSPORT',
    label: '🚸 School Transport',
    requiredPermits: 'RTA / ADEK School Bus Operator Permit & Guardian Tracking Compliance',
  },
];

const UAE_EMIRATES_AND_ZONES: Array<{ emirate: string; zones: string[] }> = [
  {
    emirate: 'Dubai',
    zones: ['JAFZA Freezone', 'DXB VIP Terminal', 'DWC Cargo Village', 'DIP / Jebel Ali', 'Al Quoz Workshop District', 'DIFC / Downtown'],
  },
  {
    emirate: 'Abu Dhabi',
    zones: ['KIZAD Industrial', 'Mussafah ICAD', 'AUH Airport Terminal', 'Yas / Saadiyat', 'Ruwais Western Region'],
  },
  {
    emirate: 'Sharjah',
    zones: ['SAIF Zone', 'Hamriyah Freezone', 'Sharjah Industrial Area'],
  },
  {
    emirate: 'Northern Emirates (Ajman / RAK / Fujairah / UAQ)',
    zones: ['RAKEZ Industrial', 'Fujairah Port & Bunkering Zone', 'Ajman Freezone'],
  },
];

export default function ExchangeProfilePage() {
  const [partner, setPartner] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Edit Profile Modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [legalName, setLegalName] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [primaryContactName, setPrimaryContactName] = useState('');
  const [primaryContactEmail, setPrimaryContactEmail] = useState('');
  const [primaryContactPhone, setPrimaryContactPhone] = useState('');

  // Service Areas & Zones state
  const [selectedEmirates, setSelectedEmirates] = useState<Record<string, Set<string>>>({});
  const [savingAreas, setSavingAreas] = useState(false);

  // Consortium Sharing Consents state (FUNC-4)
  const [sharingConsents, setSharingConsents] = useState<Record<string, boolean>>({});
  const [savingConsentId, setSavingConsentId] = useState<string | null>(null);

  const syncFormFromPartner = (p: any) => {
    if (!p) return;
    setLegalName(p.legalName || '');
    setTradeName(p.tradeName || '');
    setAddress(p.address || '');
    setCity(p.city || '');
    setPrimaryContactName(p.primaryContactName || '');
    setPrimaryContactEmail(p.primaryContactEmail || '');
    setPrimaryContactPhone(p.primaryContactPhone || '');

    const areaMap: Record<string, Set<string>> = {};
    for (const sa of p.serviceAreas ?? []) {
      if (sa?.emirate) {
        areaMap[sa.emirate] = new Set(Array.isArray(sa.zones) ? sa.zones : []);
      }
    }
    setSelectedEmirates(areaMap);
  };

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/exchange/partner/profile?includeConsents=1');
      const res = await r.json().catch(() => ({}));
      if (!r.ok) {
        setLoadError(res.error ?? 'Could not load the company profile.');
        return;
      }
      setPartner(res.partner);
      syncFormFromPartner(res.partner);
      if (Array.isArray(res.sharingConsents)) {
        const consentMap: Record<string, boolean> = {};
        for (const c of res.sharingConsents) {
          if (c?.consortiumId) consentMap[c.consortiumId] = Boolean(c.allowQualificationDiscovery);
        }
        setSharingConsents(consentMap);
      }
      if (!res.partner) setLoadError('Your account is not linked to a transport partner.');
    } catch {
      setLoadError('Could not load the company profile.');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleToggleConsortiumConsent = async (consortiumId: string, nextValue: boolean) => {
    setSavingConsentId(consortiumId);
    try {
      const res = await fetch('/api/exchange/partner/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          consentOnly: true,
          consortiumSharingConsent: {
            consortiumId,
            allowQualificationDiscovery: nextValue,
          },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Failed to update consortium sharing consent');
      setSharingConsents((prev) => ({ ...prev, [consortiumId]: nextValue }));
      showToast(
        nextValue
          ? `✓ Opted in to ${consortiumId.replace(/_/g, ' ')} qualification discovery (rates & invoices remain strictly private).`
          : `✓ Revoked qualification discovery consent for ${consortiumId.replace(/_/g, ' ')}.`
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update consortium consent');
    } finally {
      setSavingConsentId(null);
    }
  };

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const showToast = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 4000);
  };

  const approvedDomains = new Set<string>(
    (partner?.capabilities ?? [])
      .filter((c: { isApproved?: boolean }) => c.isApproved)
      .map((c: { domain: string }) => c.domain),
  );

  const toggleEmirate = (emirate: string) => {
    setSelectedEmirates((prev) => {
      const next = { ...prev };
      if (next[emirate]) {
        delete next[emirate];
      } else {
        next[emirate] = new Set();
      }
      return next;
    });
  };

  const toggleZone = (emirate: string, zone: string) => {
    setSelectedEmirates((prev) => {
      const next = { ...prev };
      const set = new Set(next[emirate] ?? []);
      if (set.has(zone)) set.delete(zone);
      else set.add(zone);
      next[emirate] = set;
      return next;
    });
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partner) return;
    setSaving(true);
    try {
      const res = await fetch('/api/exchange/partner/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legalName: legalName.trim() || partner.legalName,
          tradeName: tradeName.trim() || null,
          address: address.trim() || null,
          city: city.trim() || null,
          primaryContactName: primaryContactName.trim() || null,
          primaryContactEmail: primaryContactEmail.trim() || null,
          primaryContactPhone: primaryContactPhone.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update profile');
      }
      setPartner(data.partner);
      syncFormFromPartner(data.partner);
      setShowEditModal(false);
      showToast('✓ Corporate profile and operational contacts updated!');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveServiceAreas = async () => {
    if (!partner) return;
    setSavingAreas(true);
    try {
      const serviceAreas = Object.entries(selectedEmirates).map(([emirate, zoneSet]) => ({
        emirate,
        zones: Array.from(zoneSet),
      }));
      const res = await fetch('/api/exchange/partner/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legalName: partner.legalName,
          tradeName: partner.tradeName,
          address: partner.address,
          city: partner.city,
          primaryContactName: partner.primaryContactName,
          primaryContactEmail: partner.primaryContactEmail,
          primaryContactPhone: partner.primaryContactPhone,
          serviceAreas,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update service areas');
      }
      setPartner(data.partner);
      syncFormFromPartner(data.partner);
      showToast('✓ Multi-Emirate service areas & zone authorizations saved!');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not save service areas');
    } finally {
      setSavingAreas(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-white">Company Profile & Service Area Coverage</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Manage your commercial entity details, 6-category vertical qualifications, and multi-Emirate / Freezone dispatch coverage.
          </p>
        </div>
        {partner && (
          <button
            onClick={() => setShowEditModal(true)}
            className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-lg shadow-cyan-600/30 flex items-center gap-1.5 transition"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>Edit Corporate Details</span>
          </button>
        )}
      </div>

      {feedback && (
        <div className="p-3 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{feedback}</span>
        </div>
      )}

      {loadError && (
        <div className="rounded-2xl border border-amber-700 bg-amber-950/40 px-4 py-3 text-xs text-amber-300">
          {loadError}
        </div>
      )}

      {loading && !partner && !loadError && (
        <div className="p-6 rounded-3xl bg-slate-900/60 border border-slate-800 text-xs text-slate-400">
          Loading company profile…
        </div>
      )}

      {partner && (
        <>
          {/* Corporate Identity & Regulatory Card */}
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
                <span
                  className={`text-[10px] px-2.5 py-1 rounded-full font-bold border ${
                    partner.onboardingStatus === 'APPROVED'
                      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                      : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                  }`}
                >
                  {partner.onboardingStatus === 'APPROVED'
                    ? 'APPROVED PARTNER'
                    : `ONBOARDING: ${String(partner.onboardingStatus).replace(/_/g, ' ')}`}
                </span>
                <div className="text-xs font-mono text-cyan-400 mt-1">Code: {partner.partnerCode}</div>
              </div>
            </div>

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
                <span className="font-semibold text-slate-200">
                  {[partner.address, partner.city].filter(Boolean).join(', ') || NOT_SET}
                </span>
              </div>

              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-1">
                <span className="text-slate-400 text-[11px] block">Primary Operations Contact</span>
                <span className="font-semibold text-slate-200">
                  {[partner.primaryContactName, partner.primaryContactPhone, partner.primaryContactEmail]
                    .filter(Boolean)
                    .join(' · ') || NOT_SET}
                </span>
              </div>
            </div>

            {/* 6-Category Vertical Qualification Matrix */}
            <div className="space-y-3 pt-2 border-t border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-cyan-400" />
                  <span>Approved Transport Verticals & 6-Category Qualification Matrix</span>
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {SERVICE_DOMAINS.map((area) => {
                  const approved = approvedDomains.has(area.domain);
                  return (
                    <div
                      key={area.domain}
                      className={`p-3.5 rounded-2xl border text-xs space-y-1 ${
                        approved
                          ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-200'
                          : 'bg-slate-950/60 border-slate-800 text-slate-500'
                      }`}
                    >
                      <div className="flex items-center justify-between font-bold">
                        <span>{area.label}</span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full ${
                            approved ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-500'
                          }`}
                        >
                          {approved ? 'QUALIFIED' : 'NOT ENABLED'}
                        </span>
                      </div>
                      <div className="text-[11px] opacity-80">{area.requiredPermits}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Multi-Emirate & Freezone Service Area Coverage Card */}
          <div className="p-6 rounded-3xl bg-slate-900/60 border border-slate-800 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                  <Globe className="w-4 h-4 text-cyan-400" />
                  <span>Multi-Emirate & Specialized Zone Coverage (Stage-1 Discovery Matching)</span>
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Select the UAE Emirates and specialized Port / Airport / Industrial zones your fleet services so matching RFQs appear in your Marketplace feed.
                </p>
              </div>
              <button
                type="button"
                disabled={savingAreas}
                onClick={() => void handleSaveServiceAreas()}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 transition disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{savingAreas ? 'Saving Coverage…' : 'Save Coverage Matrix'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              {UAE_EMIRATES_AND_ZONES.map((item) => {
                const emirateActive = Boolean(selectedEmirates[item.emirate]);
                const activeZones = selectedEmirates[item.emirate] ?? new Set<string>();
                return (
                  <div
                    key={item.emirate}
                    className={`p-4 rounded-2xl border space-y-3 transition ${
                      emirateActive
                        ? 'bg-slate-950 border-cyan-500/40'
                        : 'bg-slate-950/40 border-slate-800/80 opacity-75'
                    }`}
                  >
                    <label className="flex items-center justify-between cursor-pointer">
                      <span className="font-bold text-white flex items-center gap-1.5">
                        <MapPin className={`w-3.5 h-3.5 ${emirateActive ? 'text-cyan-400' : 'text-slate-500'}`} />
                        <span>{item.emirate}</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={emirateActive}
                        onChange={() => toggleEmirate(item.emirate)}
                        className="accent-cyan-500"
                      />
                    </label>

                    <div className="flex flex-wrap gap-1.5">
                      {item.zones.map((z) => {
                        const checked = activeZones.has(z);
                        return (
                          <button
                            key={z}
                            type="button"
                            disabled={!emirateActive}
                            onClick={() => toggleZone(item.emirate, z)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition ${
                              checked
                                ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-200'
                                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white disabled:opacity-40'
                            }`}
                          >
                            {checked ? `✓ ${z}` : z}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* FUNC-4: Consortium Qualification Discovery Consent (EXTENDED Network Opt-In) */}
          <div className="p-6 rounded-3xl bg-slate-900/60 border border-slate-800 space-y-4">
            <div className="border-b border-slate-800 pb-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Consortium Qualification Discovery Consent (EXTENDED Network Mode)</span>
                </h3>
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold">
                  Confidential Commercial Rates Never Shared
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                When opted in, enterprise buyers in the same consortium operating in <strong>EXTENDED</strong> network mode can discover your verified KYB qualification status, approved verticals, and Emirate coverage without ever seeing your private rate cards, historical quotes, or settlement invoices.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              {[
                {
                  id: 'UAE_ENTERPRISE_FLEET_CONSORTIUM',
                  name: 'UAE Enterprise Fleet Consortium',
                  desc: 'Cross-Emirate staff transport, VIP limousine, and roadside recovery alliance across Dubai, Abu Dhabi & Sharjah.',
                },
                {
                  id: 'GCC_LOGISTICS_CONSORTIUM',
                  name: 'GCC Heavy Freight & Port Logistics Consortium',
                  desc: 'Port & Freezone container haulage and cold-chain freight shippers (JAFZA, KIZAD, DWC & Hamriyah).',
                },
              ].map((consortium) => {
                const enabled = Boolean(sharingConsents[consortium.id]);
                const busy = savingConsentId === consortium.id;
                return (
                  <div
                    key={consortium.id}
                    className={`p-4 rounded-2xl border flex flex-col justify-between gap-3 transition ${
                      enabled
                        ? 'bg-emerald-950/20 border-emerald-500/40'
                        : 'bg-slate-950/60 border-slate-800'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-white">{consortium.name}</span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            enabled
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {enabled ? 'DISCOVERY ENABLED' : 'OPTED OUT'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400">{consortium.desc}</p>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                      <span className="text-[10px] text-slate-500 font-mono">
                        shareCommercialRates: false
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleToggleConsortiumConsent(consortium.id, !enabled)}
                        className={`px-3 py-1.5 rounded-xl font-bold text-[11px] transition disabled:opacity-50 ${
                          enabled
                            ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
                            : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/20'
                        }`}
                      >
                        {busy
                          ? 'Updating…'
                          : enabled
                          ? 'Revoke Discovery Consent'
                          : 'Grant Discovery Consent'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Edit Corporate Profile Modal */}
      {showEditModal && partner && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl text-xs">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">Edit Corporate & Operations Profile</h3>
              <button onClick={() => setShowEditModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveProfile} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Legal Entity Name *</label>
                  <input
                    type="text"
                    required
                    value={legalName}
                    onChange={(e) => setLegalName(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Commercial Trade Name</label>
                  <input
                    type="text"
                    value={tradeName}
                    onChange={(e) => setTradeName(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Headquarters Address</label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">City</label>
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Operations Contact Name</label>
                  <input
                    type="text"
                    value={primaryContactName}
                    onChange={(e) => setPrimaryContactName(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Operations Phone</label>
                  <input
                    type="text"
                    value={primaryContactPhone}
                    onChange={(e) => setPrimaryContactPhone(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Operations Email</label>
                  <input
                    type="email"
                    value={primaryContactEmail}
                    onChange={(e) => setPrimaryContactEmail(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
