'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface DamageClaim {
  id: string;
  bookingId: string;
  booking?: { bookingRef?: string; customer?: { fullName: string } };
  description?: string;
  estimatedCost?: number;
  actualCost?: number;
  status?: string;
  insuranceClaim?: boolean;
  billedToCustomer?: boolean;
  createdAt?: string;
}

const STATUS_COLORS: Record<string, string> = {
  OPEN:     'bg-amber-500/20 text-amber-400 border-amber-500/30',
  ASSESSED: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  BILLED:   'bg-purple-500/20 text-purple-400 border-purple-500/30',
  CLOSED:   'bg-slate-500/20 text-slate-400 border-slate-500/30',
};

export default function DamageClaimsPage() {
  const [claims, setClaims]         = useState<DamageClaim[]>([]);
  const [bookings, setBookings]     = useState<any[]>([]);
  const [statusFilter, setStatus]   = useState('All');
  const [showModal, setShowModal]   = useState(false);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');

  const [formData, setFormData] = useState({
    bookingId: '', description: '', estimatedCost: '',
    insuranceClaim: false, billedToCustomer: true,
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [cRes, bRes] = await Promise.all([
        fetch('/api/rental/damage-claims'),
        fetch('/api/rental/bookings'),
      ]);
      const [cData, bData] = await Promise.all([cRes.json(), bRes.json()]);
      setClaims(Array.isArray(cData) ? cData : []);
      setBookings(Array.isArray(bData) ? bData : []);
    } catch {
      setError('Failed to load damage claims');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/rental/damage-claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          estimatedCost: parseFloat(formData.estimatedCost) || null,
          status: 'OPEN',
        }),
      });
      if (!res.ok) throw new Error('Failed');
      setShowModal(false);
      setFormData({ bookingId:'', description:'', estimatedCost:'', insuranceClaim:false, billedToCustomer:true });
      loadData();
    } catch {
      setError('Failed to create claim');
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    try {
      await fetch(`/api/rental/damage-claims/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      loadData();
    } catch {
      setError('Failed to update status');
    }
  };

  const filtered = statusFilter === 'All' ? claims : claims.filter(c => c.status === statusFilter);
  const totalValue = claims.reduce((s, c) => s + Number(c.estimatedCost ?? 0), 0);
  const openCount  = claims.filter(c => c.status === 'OPEN').length;

  if (loading) return <div className="flex items-center justify-center h-full"><div className="text-slate-400 animate-pulse">Loading...</div></div>;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">Damage Claims</h1>
          <p className="text-slate-400">{openCount} open claims — AED {totalValue.toLocaleString()} estimated</p>
        </div>
        <button onClick={() => setShowModal(true)} className="rounded-xl bg-gradient-to-r from-rose-600 to-pink-600 px-6 py-3 text-sm font-medium text-white hover:opacity-90">
          + New Claim
        </button>
      </div>

      {error && <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm">{error}</div>}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {['All','OPEN','ASSESSED','BILLED','CLOSED'].slice(0,4).map(s => (
          <button key={s} onClick={() => setStatus(s)}
            className={`p-4 rounded-xl border text-left transition-all ${statusFilter === s ? 'border-rose-500 bg-rose-500/10' : 'border-white/10 bg-slate-800/50 hover:border-white/20'}`}>
            <div className="text-2xl font-bold text-white">{s === 'All' ? claims.length : claims.filter(c => c.status === s).length}</div>
            <div className="text-xs text-slate-400 mt-1">{s}</div>
          </button>
        ))}
      </div>

      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm overflow-x-auto">
        {filtered.length === 0 ? (
          <div className="text-center text-slate-400 py-12">No damage claims found</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Date</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Booking</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Customer</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Description</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Est. Cost</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Actual Cost</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Insurance</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Status</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                  <td className="px-4 py-4 text-sm text-slate-200">{c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '-'}</td>
                  <td className="px-4 py-4 text-sm font-medium text-white">{c.booking?.bookingRef ?? c.bookingId.slice(0,8)}</td>
                  <td className="px-4 py-4 text-sm text-white">{c.booking?.customer?.fullName ?? '-'}</td>
                  <td className="px-4 py-4 text-sm text-white max-w-xs truncate">{c.description ?? '-'}</td>
                  <td className="px-4 py-4 text-sm text-amber-400 font-medium">
                    {c.estimatedCost ? `AED ${Number(c.estimatedCost).toLocaleString()}` : '-'}
                  </td>
                  <td className="px-4 py-4 text-sm text-rose-400 font-medium">
                    {c.actualCost ? `AED ${Number(c.actualCost).toLocaleString()}` : '-'}
                  </td>
                  <td className="px-4 py-4 text-sm">
                    {c.insuranceClaim ? <span className="text-blue-400">Insurance</span> : <span className="text-slate-300">Self</span>}
                  </td>
                  <td className="px-4 py-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium border ${STATUS_COLORS[c.status ?? 'OPEN']}`}>
                      {c.status ?? 'OPEN'}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <select
                      value={c.status ?? 'OPEN'}
                      onChange={e => updateStatus(c.id, e.target.value)}
                      className="text-xs px-2 py-1 rounded bg-slate-700 border border-white/10 text-white focus:outline-none"
                    >
                      <option value="OPEN">OPEN</option>
                      <option value="ASSESSED">ASSESSED</option>
                      <option value="BILLED">BILLED</option>
                      <option value="CLOSED">CLOSED</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-slate-800/95 border border-white/10 rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">New Damage Claim</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Booking *</label>
                <select value={formData.bookingId} onChange={e => setFormData(p => ({...p, bookingId: e.target.value}))} required
                  className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-rose-500 focus:outline-none">
                  <option value="">Select booking</option>
                  {bookings.filter(b => b.status !== 'CANCELLED').map(b => (
                    <option key={b.id} value={b.id}>{b.bookingRef ?? b.id.slice(0,8)} — {b.customer?.fullName ?? b.customerId}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Damage Description *</label>
                <textarea value={formData.description} onChange={e => setFormData(p => ({...p, description: e.target.value}))} required rows={3}
                  placeholder="Describe the damage..."
                  className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-rose-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Estimated Cost (AED)</label>
                <input type="number" value={formData.estimatedCost} onChange={e => setFormData(p => ({...p, estimatedCost: e.target.value}))} placeholder="0.00" min="0" step="0.01"
                  className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-rose-500 focus:outline-none" />
              </div>
              <div className="flex gap-6">
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" checked={formData.insuranceClaim} onChange={e => setFormData(p => ({...p, insuranceClaim: e.target.checked}))} className="accent-blue-500 text-white" />
                  Insurance Claim
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" checked={formData.billedToCustomer} onChange={e => setFormData(p => ({...p, billedToCustomer: e.target.checked}))} className="accent-rose-500 text-white" />
                  Bill to Customer
                </label>
              </div>
              <div className="flex gap-4 justify-end pt-4">
                <button type="button" onClick={() => setShowModal(false)} className="px-6 py-2 rounded-lg border border-white/10 text-white hover:bg-white/5">Cancel</button>
                <button type="submit" disabled={saving} className="px-6 py-2 rounded-lg bg-gradient-to-r from-rose-600 to-pink-600 text-white hover:opacity-90 disabled:opacity-50">
                  {saving ? 'Creating...' : 'Create Claim'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
