/**
 * src/app/(exchange)/exchange/fleet/page.tsx
 *
 * Phase 8: Multi-Vertical Partner Fleet Register & Mulkiya Pre-Dispatch Gate.
 * Supports Bus, Freight, Limousine, and Recovery vehicle classifications,
 * Mulkiya expiry tracking, and real-time Stage-3 Pre-Dispatch Gate readiness badges.
 */

'use client';

import React, { useEffect, useState, useMemo } from 'react';
import {
  Truck,
  Plus,
  CheckCircle2,
  ShieldCheck,
  AlertTriangle,
  XCircle,
  X,
} from 'lucide-react';

const VEHICLE_CLASSIFICATIONS = [
  {
    domain: 'PASSENGER_TRANSPORT',
    domainLabel: 'Bus & Passenger Transport',
    options: [
      { label: '50-Seat Luxury Coach', defaultCapacity: 50 },
      { label: '30-Seat Coaster Bus', defaultCapacity: 30 },
      { label: '14-Seat Mini Bus / Hiace', defaultCapacity: 14 },
      { label: 'Executive Passenger Van', defaultCapacity: 12 },
    ],
  },
  {
    domain: 'FREIGHT',
    domainLabel: 'Freight & Logistics',
    options: [
      { label: '40T Flatbed Trailer', defaultCapacity: 40000 },
      { label: '20T Refrigerated Box Truck (Reefer)', defaultCapacity: 20000 },
      { label: '10T Curtain-Side Truck', defaultCapacity: 10000 },
      { label: '3T Commercial Pickup', defaultCapacity: 3000 },
    ],
  },
  {
    domain: 'LIMOUSINE',
    domainLabel: 'Limousine & VIP Chauffeur',
    options: [
      { label: 'Luxury Sedan (Mercedes S-Class / BMW 7-Series)', defaultCapacity: 3 },
      { label: 'Executive Sedan (E-Class / Lexus ES)', defaultCapacity: 3 },
      { label: 'VIP Luxury SUV (Cadillac Escalade / GMC Yukon)', defaultCapacity: 6 },
      { label: 'Luxury VIP Van (Mercedes V-Class)', defaultCapacity: 7 },
    ],
  },
  {
    domain: 'RECOVERY',
    domainLabel: 'Recovery & Roadside Towing',
    options: [
      { label: '3.5T Hydraulic Recovery Flatbed', defaultCapacity: 1 },
      { label: 'Heavy Duty Under-Lift / Crane Tow', defaultCapacity: 1 },
      { label: '4x4 Desert Winch Recovery Unit', defaultCapacity: 1 },
      { label: 'Basement Low-Clearance Wheel-Lift', defaultCapacity: 1 },
    ],
  },
] as const;

function inferVehicleDomain(vehicleType: string): string {
  const lower = (vehicleType || '').toLowerCase();
  if (lower.includes('flatbed') && lower.includes('recovery')) return 'RECOVERY';
  if (lower.includes('tow') || lower.includes('winch') || lower.includes('wheel-lift') || lower.includes('recovery')) {
    return 'RECOVERY';
  }
  if (
    lower.includes('trailer') ||
    lower.includes('reefer') ||
    lower.includes('truck') ||
    lower.includes('curtain') ||
    lower.includes('pickup')
  ) {
    return 'FREIGHT';
  }
  if (
    lower.includes('sedan') ||
    lower.includes('s-class') ||
    lower.includes('escalade') ||
    lower.includes('v-class') ||
    lower.includes('vip') ||
    lower.includes('limo')
  ) {
    return 'LIMOUSINE';
  }
  return 'PASSENGER_TRANSPORT';
}

function evaluateExpiryGate(expiryIso?: string | null): {
  state: 'READY' | 'EXPIRING_SOON' | 'EXPIRED';
  daysLeft: number | null;
  label: string;
} {
  if (!expiryIso) {
    return { state: 'READY', daysLeft: null, label: 'STAGE-3 READY' };
  }
  const expMs = new Date(expiryIso).getTime();
  if (Number.isNaN(expMs)) {
    return { state: 'READY', daysLeft: null, label: 'STAGE-3 READY' };
  }
  const daysLeft = Math.ceil((expMs - Date.now()) / (24 * 60 * 60 * 1000));
  if (daysLeft < 0) {
    return { state: 'EXPIRED', daysLeft, label: `BLOCKED (Expired ${Math.abs(daysLeft)}d ago)` };
  }
  if (daysLeft <= 30) {
    return { state: 'EXPIRING_SOON', daysLeft, label: `EXPIRING IN ${daysLeft}D` };
  }
  return { state: 'READY', daysLeft, label: 'STAGE-3 READY' };
}

export default function ExchangeFleetPage() {
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [domainFilter, setDomainFilter] = useState<string>('ALL');
  const [showAddModal, setShowAddModal] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadFleet = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/exchange/partner/fleet').then((r) => r.json());
      setVehicles(res.vehicles || []);
    } catch {
      // Fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadFleet();
  }, []);

  const showToast = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 4000);
  };

  const enrichedVehicles = useMemo(() => {
    return vehicles.map((v) => ({
      ...v,
      domain: inferVehicleDomain(v.vehicleType),
      gate: evaluateExpiryGate(v.mulkiyaExpiry),
    }));
  }, [vehicles]);

  const filteredVehicles = useMemo(() => {
    return enrichedVehicles.filter((v) => {
      if (domainFilter !== 'ALL' && v.domain !== domainFilter) return false;
      return true;
    });
  }, [enrichedVehicles, domainFilter]);

  const stats = useMemo(() => {
    const ready = enrichedVehicles.filter((v) => v.gate.state === 'READY').length;
    const expiring = enrichedVehicles.filter((v) => v.gate.state === 'EXPIRING_SOON').length;
    const blocked = enrichedVehicles.filter((v) => v.gate.state === 'EXPIRED').length;
    return { total: enrichedVehicles.length, ready, expiring, blocked };
  }, [enrichedVehicles]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-white">Partner Fleet Register & Pre-Dispatch Gate</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Register Bus, Freight, Limousine, and Recovery vehicles and monitor Mulkiya expiry for Stage-3 Pre-Dispatch Compliance Gating.
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-lg shadow-cyan-600/30 flex items-center gap-1.5 transition active:scale-95"
        >
          <Plus className="w-4 h-4" />
          <span>Add Commercial Vehicle</span>
        </button>
      </div>

      {/* Pre-Dispatch Gate KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800">
          <span className="text-[10px] font-bold uppercase text-slate-400">Total Fleet Pool</span>
          <div className="text-2xl font-black text-white mt-1 font-mono">{stats.total}</div>
        </div>
        <div className="p-4 rounded-2xl bg-slate-900/60 border border-emerald-500/30">
          <span className="text-[10px] font-bold uppercase text-emerald-400">Stage-3 Dispatch Ready</span>
          <div className="text-2xl font-black text-emerald-300 mt-1 font-mono">{stats.ready}</div>
        </div>
        <div className="p-4 rounded-2xl bg-slate-900/60 border border-amber-500/30">
          <span className="text-[10px] font-bold uppercase text-amber-400">Mulkiya Expiring &lt; 30d</span>
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
            { id: 'ALL', label: 'All Fleet' },
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

      {/* Fleet Table */}
      <div className="rounded-3xl bg-slate-900/60 border border-slate-800 overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-950 border-b border-slate-800 text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
            <tr>
              <th className="p-4">License Plate & Emirate</th>
              <th className="p-4">Vertical & Classification</th>
              <th className="p-4">Make / Model / Year</th>
              <th className="p-4">Capacity / Payload</th>
              <th className="p-4">Mulkiya Expiry</th>
              <th className="p-4">Stage-3 Pre-Dispatch Gate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {filteredVehicles.length > 0 ? (
              filteredVehicles.map((v) => (
                <tr key={v.id} className="hover:bg-slate-800/30 transition">
                  <td className="p-4">
                    <div className="font-mono font-bold text-cyan-300 flex items-center gap-1.5">
                      <Truck className="w-3.5 h-3.5 text-slate-500" />
                      <span>{v.licensePlate}</span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{v.plateEmirate || 'Dubai'}</div>
                  </td>
                  <td className="p-4">
                    <div className="text-white font-semibold">{v.vehicleType}</div>
                    <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-slate-800 text-cyan-300 border border-slate-700">
                      {v.domain}
                    </span>
                  </td>
                  <td className="p-4 text-slate-300">
                    {v.make || v.model ? `${v.make || ''} ${v.model || ''} ${v.year ? `(${v.year})` : ''}`.trim() : 'Standard Spec'}
                  </td>
                  <td className="p-4 text-slate-300 font-mono">
                    {v.domain === 'FREIGHT' && v.seatingCapacity >= 1000
                      ? `${v.seatingCapacity.toLocaleString()} kg`
                      : `${v.seatingCapacity} ${v.domain === 'RECOVERY' ? 'unit' : 'seats'}`}
                  </td>
                  <td className="p-4 text-slate-300 font-mono">
                    {v.mulkiyaExpiry ? new Date(v.mulkiyaExpiry).toLocaleDateString() : 'Verified'}
                  </td>
                  <td className="p-4">
                    {v.gate.state === 'READY' && (
                      <span className="px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold inline-flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3" />
                        <span>{v.gate.label}</span>
                      </span>
                    )}
                    {v.gate.state === 'EXPIRING_SOON' && (
                      <span className="px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px] font-bold inline-flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        <span>{v.gate.label}</span>
                      </span>
                    )}
                    {v.gate.state === 'EXPIRED' && (
                      <span className="px-2.5 py-1 rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/30 text-[10px] font-bold inline-flex items-center gap-1">
                        <XCircle className="w-3 h-3" />
                        <span>{v.gate.label}</span>
                      </span>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-500">
                  No vehicles registered for this filter. Click &quot;Add Commercial Vehicle&quot; to register your fleet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add Vehicle Modal */}
      {showAddModal && (
        <AddVehicleModal
          onClose={() => setShowAddModal(false)}
          onAdded={() => {
            setShowAddModal(false);
            showToast('✓ Commercial vehicle registered and validated for Pre-Dispatch Gate!');
            void loadFleet();
          }}
        />
      )}
    </div>
  );
}

function AddVehicleModal({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: () => void;
}) {
  const [selectedDomain, setSelectedDomain] = useState<string>('PASSENGER_TRANSPORT');
  const [licensePlate, setLicensePlate] = useState('');
  const [plateEmirate, setPlateEmirate] = useState('Dubai');
  const [vehicleType, setVehicleType] = useState('50-Seat Luxury Coach');
  const [seatingCapacity, setSeatingCapacity] = useState('50');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('2025');
  const [mulkiyaExpiry, setMulkiyaExpiry] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [submitting, setSubmitting] = useState(false);

  const domainGroup =
    VEHICLE_CLASSIFICATIONS.find((g) => g.domain === selectedDomain) ?? VEHICLE_CLASSIFICATIONS[0];

  const handleDomainChange = (domain: string) => {
    setSelectedDomain(domain);
    const group = VEHICLE_CLASSIFICATIONS.find((g) => g.domain === domain);
    if (group && group.options[0]) {
      setVehicleType(group.options[0].label);
      setSeatingCapacity(String(group.options[0].defaultCapacity));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/exchange/partner/fleet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licensePlate,
          plateEmirate,
          vehicleType,
          seatingCapacity: Number(seatingCapacity),
          make: make.trim() || undefined,
          model: model.trim() || undefined,
          year: year ? Number(year) : undefined,
          mulkiyaExpiry: mulkiyaExpiry || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to add vehicle');
      }
      onAdded();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error adding vehicle');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-950 border border-slate-800 rounded-3xl p-6 max-w-lg w-full space-y-4 shadow-2xl text-xs">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-sm font-bold text-white">Register Commercial Vehicle</h3>
            <p className="text-[11px] text-slate-400">
              Mulkiya expiry is verified synchronously before every trip dispatch.
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
              <label className="block text-slate-300 font-semibold mb-1">License Plate Number *</label>
              <input
                type="text"
                required
                value={licensePlate}
                onChange={(e) => setLicensePlate(e.target.value)}
                placeholder="e.g. Dubai K 45201"
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white uppercase font-mono focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Plate Emirate</label>
              <select
                value={plateEmirate}
                onChange={(e) => setPlateEmirate(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-cyan-500"
              >
                <option value="Dubai">Dubai</option>
                <option value="Abu Dhabi">Abu Dhabi</option>
                <option value="Sharjah">Sharjah</option>
                <option value="Ajman">Ajman</option>
                <option value="RAK">RAK</option>
                <option value="Fujairah">Fujairah</option>
                <option value="UAQ">UAQ</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Vehicle Classification *</label>
            <select
              value={vehicleType}
              onChange={(e) => {
                setVehicleType(e.target.value);
                const opt = domainGroup.options.find((o) => o.label === e.target.value);
                if (opt) setSeatingCapacity(String(opt.defaultCapacity));
              }}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-cyan-500"
            >
              {domainGroup.options.map((opt) => (
                <option key={opt.label} value={opt.label}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                {selectedDomain === 'FREIGHT' ? 'Max Payload (kg) *' : 'Seating / Unit Capacity *'}
              </label>
              <input
                type="number"
                required
                value={seatingCapacity}
                onChange={(e) => setSeatingCapacity(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white font-mono focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Mulkiya Expiry Date (Stage-3 Gate) *
              </label>
              <input
                type="date"
                required
                value={mulkiyaExpiry}
                onChange={(e) => setMulkiyaExpiry(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white font-mono focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Make</label>
              <input
                type="text"
                value={make}
                onChange={(e) => setMake(e.target.value)}
                placeholder="e.g. Mercedes / Volvo"
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Model</label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="e.g. Tourismo / FH16"
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Model Year</label>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="2025"
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
              {submitting ? 'Registering...' : 'Register Vehicle'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
