/**
 * src/app/(exchange)/exchange/fleet/page.tsx
 *
 * Partner Fleet Register for Fleet360 Exchange.
 */

'use client';

import React, { useEffect, useState } from 'react';
import { Truck, Plus, CheckCircle2, ShieldCheck, AlertTriangle, X } from 'lucide-react';

export default function ExchangeFleetPage() {
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
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

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-white">Partner Fleet Register</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Register and manage your commercial fleet pool (buses, coaches, vans) for outsourcing deployments.
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-lg shadow-cyan-600/30 flex items-center gap-1.5 transition active:scale-95"
        >
          <Plus className="w-4 h-4" />
          <span>Add Vehicle</span>
        </button>
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
              <th className="p-4">License Plate</th>
              <th className="p-4">Emirate</th>
              <th className="p-4">Vehicle Type</th>
              <th className="p-4">Capacity</th>
              <th className="p-4">Mulkiya Expiry</th>
              <th className="p-4">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {vehicles.length > 0 ? (
              vehicles.map((v) => (
                <tr key={v.id} className="hover:bg-slate-800/30 transition">
                  <td className="p-4 font-mono font-bold text-cyan-300">{v.licensePlate}</td>
                  <td className="p-4 text-slate-300">{v.plateEmirate || 'Dubai'}</td>
                  <td className="p-4 text-white font-semibold">{v.vehicleType}</td>
                  <td className="p-4 text-slate-300">{v.seatingCapacity} seats</td>
                  <td className="p-4 text-slate-400">
                    {v.mulkiyaExpiry ? new Date(v.mulkiyaExpiry).toLocaleDateString() : 'Valid'}
                  </td>
                  <td className="p-4">
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold">
                      ACTIVE
                    </span>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-500">
                  No vehicles registered yet. Click &quot;Add Vehicle&quot; to register your fleet.
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
            showToast('✓ Vehicle registered successfully!');
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
  const [licensePlate, setLicensePlate] = useState('');
  const [plateEmirate, setPlateEmirate] = useState('Dubai');
  const [vehicleType, setVehicleType] = useState('50-Seat Luxury Coach');
  const [seatingCapacity, setSeatingCapacity] = useState('50');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/exchange/partner/fleet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partnerId: 'dummy-partner-id',
          licensePlate,
          plateEmirate,
          vehicleType,
          seatingCapacity: Number(seatingCapacity),
        }),
      });

      if (!res.ok) throw new Error('Failed to add vehicle');
      onAdded();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error adding vehicle');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-950 border border-slate-800 rounded-3xl p-6 max-w-md w-full space-y-4 shadow-2xl text-xs">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 className="text-sm font-bold text-white">Register Commercial Vehicle</h3>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
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

          <div className="grid grid-cols-2 gap-3">
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
              </select>
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Seating Capacity *</label>
              <input
                type="number"
                required
                value={seatingCapacity}
                onChange={(e) => setSeatingCapacity(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Vehicle Classification *</label>
            <select
              value={vehicleType}
              onChange={(e) => setVehicleType(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-cyan-500"
            >
              <option value="50-Seat Luxury Coach">50-Seat Luxury Coach</option>
              <option value="30-Seat Coaster Bus">30-Seat Coaster Bus</option>
              <option value="14-Seat Mini Bus / Hiace">14-Seat Mini Bus / Hiace</option>
              <option value="Executive Passenger Van">Executive Passenger Van</option>
            </select>
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
              {submitting ? 'Adding...' : 'Register Vehicle'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
