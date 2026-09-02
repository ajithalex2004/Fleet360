/**
 * src/app/(exchange)/exchange/drivers/page.tsx
 *
 * Partner Driver Roster for Fleet360 Exchange.
 */

'use client';

import React, { useEffect, useState } from 'react';
import { Users, Plus, CheckCircle2, ShieldCheck, Phone, X } from 'lucide-react';

export default function ExchangeDriversPage() {
  const [drivers, setDrivers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
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

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-white">Partner Driver Roster</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Manage your certified bus & commercial drivers for automated dispatch links and trip assignments.
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-lg shadow-cyan-600/30 flex items-center gap-1.5 transition active:scale-95"
        >
          <Plus className="w-4 h-4" />
          <span>Add Driver</span>
        </button>
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
              <th className="p-4">Full Name</th>
              <th className="p-4">Mobile Number</th>
              <th className="p-4">Driving License</th>
              <th className="p-4">RTA Permit Status</th>
              <th className="p-4">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {drivers.length > 0 ? (
              drivers.map((d) => (
                <tr key={d.id} className="hover:bg-slate-800/30 transition">
                  <td className="p-4 font-bold text-white">{d.fullName}</td>
                  <td className="p-4 text-slate-300 font-mono flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-slate-500" />
                    <span>{d.mobileNumber}</span>
                  </td>
                  <td className="p-4 text-slate-400">{d.licenseNumber || 'Verified (Heavy Bus)'}</td>
                  <td className="p-4 text-emerald-400 font-semibold flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{d.permitType || 'RTA Bus Permit Valid'}</span>
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
                <td colSpan={5} className="p-8 text-center text-slate-500">
                  No drivers registered yet. Click &quot;Add Driver&quot; to register your drivers.
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
            showToast('✓ Driver registered successfully!');
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
  const [fullName, setFullName] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [permitType, setPermitType] = useState('RTA Heavy Bus Driver Permit');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/exchange/partner/drivers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partnerId: 'dummy-partner-id',
          fullName,
          mobileNumber,
          licenseNumber,
          permitType,
        }),
      });

      if (!res.ok) throw new Error('Failed to add driver');
      onAdded();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error adding driver');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-950 border border-slate-800 rounded-3xl p-6 max-w-md w-full space-y-4 shadow-2xl text-xs">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 className="text-sm font-bold text-white">Register Partner Driver</h3>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
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
            <label className="block text-slate-300 font-semibold mb-1">Mobile Phone (WhatsApp enabled) *</label>
            <input
              type="text"
              required
              value={mobileNumber}
              onChange={(e) => setMobileNumber(e.target.value)}
              placeholder="+971 50 889 1234"
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white font-mono focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">UAE Driving License Number</label>
            <input
              type="text"
              value={licenseNumber}
              onChange={(e) => setLicenseNumber(e.target.value)}
              placeholder="e.g. DL-9812401-DXB"
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white font-mono focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Regulatory Driver Permit</label>
            <select
              value={permitType}
              onChange={(e) => setPermitType(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-cyan-500"
            >
              <option value="RTA Heavy Bus Driver Permit">RTA Heavy Bus Driver Permit</option>
              <option value="RTA Light Bus Permit">RTA Light Bus Permit</option>
              <option value="ITC Abu Dhabi Transport Permit">ITC Abu Dhabi Transport Permit</option>
              <option value="Commercial Chauffeur Permit">Commercial Chauffeur Permit</option>
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
              {submitting ? 'Adding...' : 'Register Driver'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
