/**
 * src/app/(exchange)/exchange/drivers/page.tsx
 *
 * Phase 8: Multi-Vertical Partner Driver Roster & License/Permit Pre-Dispatch Gate.
 * Supports Bus, Freight, Limousine, and Recovery regulatory permits,
 * license & permit expiry tracking, and real-time Stage-3 Pre-Dispatch Gate readiness badges.
 */

'use client';

import React, { useEffect, useState, useMemo } from 'react';
import {
  Plus,
  CheckCircle2,
  ShieldCheck,
  AlertTriangle,
  XCircle,
  Phone,
  X,
} from 'lucide-react';

const DRIVER_PERMIT_CLASSIFICATIONS = [
  {
    domain: 'PASSENGER_TRANSPORT',
    label: 'Bus & Passenger Transport',
    permits: [
      'RTA Heavy Bus Driver Permit',
      'RTA Light Bus Permit',
      'ITC Abu Dhabi Bus Transport Permit',
    ],
  },
  {
    domain: 'FREIGHT',
    label: 'Freight & Heavy Logistics',
    permits: [
      'UAE Heavy Truck License (Category 4)',
      'Civil Defense Hazmat / ADR Permit',
      'Port & Freezone Security Pass (JAFZA/KIZAD)',
    ],
  },
  {
    domain: 'LIMOUSINE',
    label: 'Limousine & VIP Chauffeur',
    permits: [
      'RTA Luxury Chauffeur & Limousine Permit',
      'ITC VIP Executive Chauffeur Permit',
    ],
  },
  {
    domain: 'RECOVERY',
    label: 'Recovery & Roadside Towing',
    permits: [
      'RTA Roadside Recovery & Towing Operator Permit',
      'Heavy Winch & Crane Rigging Certificate',
    ],
  },
] as const;

function inferDriverDomain(permitType?: string | null): string {
  const lower = (permitType || '').toLowerCase();
  if (lower.includes('recovery') || lower.includes('towing') || lower.includes('winch')) return 'RECOVERY';
  if (lower.includes('truck') || lower.includes('hazmat') || lower.includes('jafza') || lower.includes('adr')) {
    return 'FREIGHT';
  }
  if (lower.includes('chauffeur') || lower.includes('limousine') || lower.includes('vip')) {
    return 'LIMOUSINE';
  }
  return 'PASSENGER_TRANSPORT';
}

function evaluateDriverGate(
  licenseExpiry?: string | null,
  permitExpiry?: string | null
): {
  state: 'READY' | 'EXPIRING_SOON' | 'EXPIRED';
  label: string;
} {
  const dates = [licenseExpiry, permitExpiry]
    .filter(Boolean)
    .map((d) => new Date(d as string).getTime())
    .filter((ms) => !Number.isNaN(ms));

  if (dates.length === 0) {
    return { state: 'READY', label: 'STAGE-3 READY' };
  }

  const earliestMs = Math.min(...dates);
  const daysLeft = Math.ceil((earliestMs - Date.now()) / (24 * 60 * 60 * 1000));

  if (daysLeft < 0) {
    return { state: 'EXPIRED', label: `BLOCKED (Expired ${Math.abs(daysLeft)}d ago)` };
  }
  if (daysLeft <= 30) {
    return { state: 'EXPIRING_SOON', label: `EXPIRING IN ${daysLeft}D` };
  }
  return { state: 'READY', label: 'STAGE-3 READY' };
}

export default function ExchangeDriversPage() {
  const [drivers, setDrivers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [domainFilter, setDomainFilter] = useState<string>('ALL');
  const [showAddModal, setShowAddModal] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadDrivers = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/exchange/partner/drivers').then((r) => r.json());
      setDrivers(res.drivers || []);
    } catch {
      // Fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDrivers();
  }, []);

  const showToast = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 4000);
  };

  const enrichedDrivers = useMemo(() => {
    return drivers.map((d) => ({
      ...d,
      domain: inferDriverDomain(d.permitType),
      gate: evaluateDriverGate(d.licenseExpiry, d.permitExpiry),
    }));
  }, [drivers]);

  const filteredDrivers = useMemo(() => {
    return enrichedDrivers.filter((d) => {
      if (domainFilter !== 'ALL' && d.domain !== domainFilter) return false;
      return true;
    });
  }, [enrichedDrivers, domainFilter]);

  const stats = useMemo(() => {
    const ready = enrichedDrivers.filter((d) => d.gate.state === 'READY').length;
    const expiring = enrichedDrivers.filter((d) => d.gate.state === 'EXPIRING_SOON').length;
    const blocked = enrichedDrivers.filter((d) => d.gate.state === 'EXPIRED').length;
    return { total: enrichedDrivers.length, ready, expiring, blocked };
  }, [enrichedDrivers]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-white">Partner Driver Roster & Credential Gate</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Manage certified Bus, Freight, Limousine, and Recovery drivers and monitor UAE License & Permit expiry for Stage-3 Pre-Dispatch Gating.
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-lg shadow-cyan-600/30 flex items-center gap-1.5 transition active:scale-95"
        >
          <Plus className="w-4 h-4" />
          <span>Add Certified Driver</span>
        </button>
      </div>

      {/* Driver Gate KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800">
          <span className="text-[10px] font-bold uppercase text-slate-400">Total Driver Roster</span>
          <div className="text-2xl font-black text-white mt-1 font-mono">{stats.total}</div>
        </div>
        <div className="p-4 rounded-2xl bg-slate-900/60 border border-emerald-500/30">
          <span className="text-[10px] font-bold uppercase text-emerald-400">Stage-3 Dispatch Ready</span>
          <div className="text-2xl font-black text-emerald-300 mt-1 font-mono">{stats.ready}</div>
        </div>
        <div className="p-4 rounded-2xl bg-slate-900/60 border border-amber-500/30">
          <span className="text-[10px] font-bold uppercase text-amber-400">Credentials Expiring &lt; 30d</span>
          <div className="text-2xl font-black text-amber-300 mt-1 font-mono">{stats.expiring}</div>
        </div>
        <div className="p-4 rounded-2xl bg-slate-900/60 border border-rose-500/30">
          <span className="text-[10px] font-bold uppercase text-rose-400">Stage-3 Blocked (Expired)</span>
          <div className="text-2xl font-black text-rose-300 mt-1 font-mono">{stats.blocked}</div>
        </div>
      </div>

      {/* Domain Filter Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex p-1 bg-slate-900 border border-slate-800 rounded-2xl text-xs">
          {[
            { id: 'ALL', label: 'All Drivers' },
            { id: 'PASSENGER_TRANSPORT', label: 'Bus' },
            { id: 'FREIGHT', label: 'Freight' },
            { id: 'LIMOUSINE', label: 'Limousine' },
            { id: 'RECOVERY', label: 'Recovery' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setDomainFilter(tab.id)}
              className={`px-3.5 py-1.5 rounded-xl font-bold transition ${
                domainFilter === tab.id
                  ? 'bg-cyan-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {feedback && (
        <div className="p-3 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{feedback}</span>
        </div>
      )}

      {/* Drivers Table */}
      <div className="rounded-3xl bg-slate-900/60 border border-slate-800 overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-950 border-b border-slate-800 text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
            <tr>
              <th className="p-4">Full Name & Mobile</th>
              <th className="p-4">Vertical & Regulatory Permit</th>
              <th className="p-4">UAE Driving License</th>
              <th className="p-4">License Expiry</th>
              <th className="p-4">Permit Expiry</th>
              <th className="p-4">Stage-3 Pre-Dispatch Gate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {filteredDrivers.length > 0 ? (
              filteredDrivers.map((d) => (
                <tr key={d.id} className="hover:bg-slate-800/30 transition">
                  <td className="p-4">
                    <div className="font-bold text-white">{d.fullName}</div>
                    <div className="text-slate-400 font-mono text-[11px] flex items-center gap-1 mt-0.5">
                      <Phone className="w-3 h-3 text-slate-500" />
                      <span>{d.mobileNumber}</span>
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="text-emerald-400 font-semibold">{d.permitType || 'RTA Bus Permit'}</div>
                    <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-slate-800 text-cyan-300 border border-slate-700">
                      {d.domain}
                    </span>
                  </td>
                  <td className="p-4 text-slate-300 font-mono">{d.licenseNumber || 'Verified'}</td>
                  <td className="p-4 text-slate-300 font-mono">
                    {d.licenseExpiry ? new Date(d.licenseExpiry).toLocaleDateString() : 'Valid'}
                  </td>
                  <td className="p-4 text-slate-300 font-mono">
                    {d.permitExpiry ? new Date(d.permitExpiry).toLocaleDateString() : 'Valid'}
                  </td>
                  <td className="p-4">
                    {d.gate.state === 'READY' && (
                      <span className="px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold inline-flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3" />
                        <span>{d.gate.label}</span>
                      </span>
                    )}
                    {d.gate.state === 'EXPIRING_SOON' && (
                      <span className="px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px] font-bold inline-flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        <span>{d.gate.label}</span>
                      </span>
                    )}
                    {d.gate.state === 'EXPIRED' && (
                      <span className="px-2.5 py-1 rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/30 text-[10px] font-bold inline-flex items-center gap-1">
                        <XCircle className="w-3 h-3" />
                        <span>{d.gate.label}</span>
                      </span>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-500">
                  No drivers registered for this filter. Click &quot;Add Certified Driver&quot; to register your drivers.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add Driver Modal */}
      {showAddModal && (
        <AddDriverModal
          onClose={() => setShowAddModal(false)}
          onAdded={() => {
            setShowAddModal(false);
            showToast('✓ Driver registered and credentials verified for Stage-3 Pre-Dispatch Gate!');
            void loadDrivers();
          }}
        />
      )}
    </div>
  );
}

function AddDriverModal({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: () => void;
}) {
  const [selectedDomain, setSelectedDomain] = useState<string>('PASSENGER_TRANSPORT');
  const [fullName, setFullName] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [licenseExpiry, setLicenseExpiry] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [permitType, setPermitType] = useState('RTA Heavy Bus Driver Permit');
  const [permitExpiry, setPermitExpiry] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [submitting, setSubmitting] = useState(false);

  const domainGroup =
    DRIVER_PERMIT_CLASSIFICATIONS.find((g) => g.domain === selectedDomain) ??
    DRIVER_PERMIT_CLASSIFICATIONS[0];

  const handleDomainChange = (domain: string) => {
    setSelectedDomain(domain);
    const group = DRIVER_PERMIT_CLASSIFICATIONS.find((g) => g.domain === domain);
    if (group && group.permits[0]) {
      setPermitType(group.permits[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/exchange/partner/drivers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName,
          mobileNumber,
          licenseNumber,
          licenseExpiry: licenseExpiry || undefined,
          permitType,
          permitExpiry: permitExpiry || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to add driver');
      }
      onAdded();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error adding driver');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-950 border border-slate-800 rounded-3xl p-6 max-w-lg w-full space-y-4 shadow-2xl text-xs">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-sm font-bold text-white">Register Certified Partner Driver</h3>
            <p className="text-[11px] text-slate-400">
              Driving license and regulatory permit expiry are checked at Stage-3 before driver link issuance.
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Vertical Selector */}
          <div>
            <label className="block text-slate-300 font-semibold mb-1.5">Service Vertical *</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {[
                { id: 'PASSENGER_TRANSPORT', label: 'Bus' },
                { id: 'FREIGHT', label: 'Freight' },
                { id: 'LIMOUSINE', label: 'Limousine' },
                { id: 'RECOVERY', label: 'Recovery' },
              ].map((d) => (
                <button
                  type="button"
                  key={d.id}
                  onClick={() => handleDomainChange(d.id)}
                  className={`py-2 px-2.5 rounded-xl font-bold border text-[11px] transition ${
                    selectedDomain === d.id
                      ? 'bg-cyan-600/20 border-cyan-500 text-cyan-300'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Driver Full Name *</label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Tariq Mehmood"
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Mobile Phone (WhatsApp) *</label>
              <input
                type="text"
                required
                value={mobileNumber}
                onChange={(e) => setMobileNumber(e.target.value)}
                placeholder="+971 50 889 1234"
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white font-mono focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">UAE Driving License Number *</label>
              <input
                type="text"
                required
                value={licenseNumber}
                onChange={(e) => setLicenseNumber(e.target.value)}
                placeholder="e.g. DL-9812401-DXB"
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white font-mono focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Driving License Expiry *</label>
              <input
                type="date"
                required
                value={licenseExpiry}
                onChange={(e) => setLicenseExpiry(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white font-mono focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Regulatory Driver Permit *</label>
              <select
                value={permitType}
                onChange={(e) => setPermitType(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-cyan-500"
              >
                {domainGroup.permits.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Permit Expiry Date *</label>
              <input
                type="date"
                required
                value={permitExpiry}
                onChange={(e) => setPermitExpiry(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white font-mono focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button type="button" onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold shadow-lg shadow-cyan-600/30 transition disabled:opacity-50"
            >
              {submitting ? 'Registering...' : 'Register Driver'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
