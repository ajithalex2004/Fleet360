'use client';
import { addDays } from '@/lib/autoFill';
import React, { useState, useEffect, useCallback } from 'react';

interface Customer { id: string; fullName: string; }
interface Booking {
  id: string;
  bookingRef?: string;
  customerId: string;
  customer?: Customer;
  vehicleCategory?: string;
  vehicleId?: string;
  pickupDate: string;
  dropoffDate: string;
  pickupLocation?: string;
  dropoffLocation?: string;
  totalDays?: number;
  dailyRate?: number;
  totalAmount?: number;
  status?: string;
  channel?: string;
  notes?: string;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING:   'bg-amber-500/20 text-amber-400 border-amber-500/30',
  CONFIRMED: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  ACTIVE:    'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  COMPLETED: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  CANCELLED: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
};

const VEHICLE_CATEGORIES = ['Economy', 'Sedan', 'SUV', 'Luxury', 'Van'];
const CHANNELS = ['DIRECT', 'CORPORATE', 'AGENCY', 'ONLINE'];

export default function BookingsPage() {
  const [bookings, setBookings]         = useState<Booking[]>([]);
  const [customers, setCustomers]       = useState<Customer[]>([]);
  const [statusFilter, setStatusFilter] = useState('All');
  const [showModal, setShowModal]       = useState(false);
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    customerId: '',
    vehicleCategory: '',
    pickupDate: '',
    dropoffDate: '',
    pickupLocation: '',
    dropoffLocation: '',
    dailyRate: '',
    channel: 'DIRECT',
    notes: '',
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [bRes, cRes] = await Promise.all([
        fetch('/api/rental/bookings'),
        fetch('/api/rental/customers'),
      ]);
      const [bData, cData] = await Promise.all([bRes.json(), cRes.json()]);
      setBookings(Array.isArray(bData) ? bData : []);
      setCustomers(Array.isArray(cData) ? cData : []);
    } catch {
      setError('Failed to load bookings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const filtered = statusFilter === 'All'
    ? bookings
    : bookings.filter(b => (b.status ?? 'PENDING').toUpperCase() === statusFilter);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const pickup  = new Date(formData.pickupDate);
      const dropoff = new Date(formData.dropoffDate);
      const totalDays   = Math.ceil((dropoff.getTime() - pickup.getTime()) / 86400000);
      const dailyRate   = parseFloat(formData.dailyRate) || 0;
      const totalAmount = totalDays * dailyRate;

      const res = await fetch('/api/rental/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId:      formData.customerId,
          vehicleCategory: formData.vehicleCategory,
          pickupDate:      pickup.toISOString(),
          dropoffDate:     dropoff.toISOString(),
          pickupLocation:  formData.pickupLocation || null,
          dropoffLocation: formData.dropoffLocation || null,
          totalDays,
          dailyRate,
          totalAmount,
          channel: formData.channel,
          notes:   formData.notes || null,
          status:  'PENDING',
        }),
      });
      if (!res.ok) throw new Error('Failed to create booking');
      setShowModal(false);
      setFormData({ customerId:'', vehicleCategory:'', pickupDate:'', dropoffDate:'', pickupLocation:'', dropoffLocation:'', dailyRate:'', channel:'DIRECT', notes:'' });
      loadData();
    } catch {
      setError('Failed to create booking');
    } finally {
      setSaving(false);
    }
  };

  const handleAction = async (bookingId: string, action: string, body?: object) => {
    setActionLoading(bookingId + action);
    try {
      const res = await fetch(`/api/rental/bookings/${bookingId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      if (!res.ok) {
        const d = await res.json();
        alert(d.error ?? 'Action failed');
        return;
      }
      loadData();
    } catch {
      alert('Action failed');
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-slate-400 animate-pulse">Loading bookings...</div>
    </div>
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">Bookings</h1>
          <p className="text-slate-400">Manage all rental bookings - {bookings.length} total</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-3 text-sm font-medium text-white hover:opacity-90 transition-all"
        >
          + New Booking
        </button>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm">
          {error}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {['All','PENDING','CONFIRMED','ACTIVE','COMPLETED'].map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`p-4 rounded-xl border transition-all text-left ${statusFilter === s ? 'border-emerald-500 bg-emerald-500/10' : 'border-white/10 bg-slate-800/50 hover:border-white/20'}`}
          >
            <div className="text-2xl font-bold text-white">
              {s === 'All' ? bookings.length : bookings.filter(b => (b.status ?? 'PENDING') === s).length}
            </div>
            <div className="text-xs text-slate-400 mt-1">{s === 'All' ? 'All Bookings' : s.charAt(0) + s.slice(1).toLowerCase()}</div>
          </button>
        ))}
      </div>

      {/* Bookings Table */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm overflow-x-auto">
        {filtered.length === 0 ? (
          <div className="text-center text-slate-400 py-12">No bookings found</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Ref</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Customer</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Category</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Pickup</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Return</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Days</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Amount</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Status</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(b => {
                const status = (b.status ?? 'PENDING').toUpperCase();
                const isActing = actionLoading?.startsWith(b.id);
                return (
                  <tr key={b.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="px-4 py-4 text-sm font-medium text-white">{b.bookingRef ?? b.id.slice(0,8)}</td>
                    <td className="px-4 py-4 text-sm text-white">{b.customer?.fullName ?? b.customerId}</td>
                    <td className="px-4 py-4 text-sm text-white">{b.vehicleCategory ?? '-'}</td>
                    <td className="px-4 py-4 text-sm text-slate-200">{new Date(b.pickupDate).toLocaleDateString()}</td>
                    <td className="px-4 py-4 text-sm text-slate-200">{new Date(b.dropoffDate).toLocaleDateString()}</td>
                    <td className="px-4 py-4 text-sm text-white font-medium">{b.totalDays ?? '-'}</td>
                    <td className="px-4 py-4 text-sm font-medium text-white">
                      {b.totalAmount ? `AED ${Number(b.totalAmount).toLocaleString()}` : '-'}
                    </td>
                    <td className="px-4 py-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium border ${STATUS_COLORS[status] ?? STATUS_COLORS.PENDING}`}>
                        {status}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex gap-2 flex-wrap">
                        {status === 'PENDING' && (
                          <button
                            onClick={() => handleAction(b.id, 'confirm')}
                            disabled={!!isActing}
                            className="text-xs px-2 py-1 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 disabled:opacity-50"
                          >
                            Confirm
                          </button>
                        )}
                        {(status === 'CONFIRMED' || status === 'PENDING') && (
                          <button
                            onClick={() => handleAction(b.id, 'activate')}
                            disabled={!!isActing}
                            className="text-xs px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 disabled:opacity-50"
                          >
                            Activate
                          </button>
                        )}
                        {status === 'ACTIVE' && (
                          <button
                            onClick={() => handleAction(b.id, 'complete')}
                            disabled={!!isActing}
                            className="text-xs px-2 py-1 rounded bg-slate-500/20 text-white border border-slate-500/30 hover:bg-slate-500/30 disabled:opacity-50"
                          >
                            Complete
                          </button>
                        )}
                        {!['COMPLETED', 'CANCELLED'].includes(status) && (
                          <button
                            onClick={() => { if (confirm('Cancel this booking?')) handleAction(b.id, 'cancel', { reason: 'User requested' }); }}
                            disabled={!!isActing}
                            className="text-xs px-2 py-1 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:bg-rose-500/30 disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* New Booking Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-800/95 border border-white/10 rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">New Booking</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white"></button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Customer *</label>
                  <select name="customerId" value={formData.customerId} onChange={e => setFormData(p => ({...p, customerId: e.target.value}))} required
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-emerald-500 focus:outline-none">
                    <option value="">Select customer</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.fullName}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Vehicle Category *</label>
                  <select name="vehicleCategory" value={formData.vehicleCategory} onChange={e => setFormData(p => ({...p, vehicleCategory: e.target.value}))} required
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-emerald-500 focus:outline-none">
                    <option value="">Select category</option>
                    {VEHICLE_CATEGORIES.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Pickup Date *</label>
                  <input type="date" value={formData.pickupDate} onChange={e => setFormData(p => ({...p, pickupDate: e.target.value}))} required
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-emerald-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Return Date *</label>
                  <input type="date" value={formData.dropoffDate} onChange={e => setFormData(p => ({...p, dropoffDate: e.target.value}))} required
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-emerald-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Pickup Location</label>
                  <input type="text" value={formData.pickupLocation} onChange={e => setFormData(p => ({...p, pickupLocation: e.target.value}))} placeholder="e.g., Dubai Airport"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Return Location</label>
                  <input type="text" value={formData.dropoffLocation} onChange={e => setFormData(p => ({...p, dropoffLocation: e.target.value}))} placeholder="e.g., Downtown Dubai"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Daily Rate (AED)</label>
                  <input type="number" value={formData.dailyRate} onChange={e => setFormData(p => ({...p, dailyRate: e.target.value}))} placeholder="150" min="0" step="0.01"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Channel</label>
                  <select value={formData.channel} onChange={e => setFormData(p => ({...p, channel: e.target.value}))}
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-emerald-500 focus:outline-none">
                    {CHANNELS.map(ch => <option key={ch} value={ch}>{ch}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Notes</label>
                <textarea value={formData.notes} onChange={e => setFormData(p => ({...p, notes: e.target.value}))} rows={2} placeholder="Additional notes..."
                  className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none" />
              </div>
              <div className="flex gap-4 justify-end pt-4">
                <button type="button" onClick={() => setShowModal(false)}
                  className="px-6 py-2 rounded-lg border border-white/10 text-white hover:bg-white/5">Cancel</button>
                <button type="submit" disabled={saving}
                  className="px-6 py-2 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:opacity-90 disabled:opacity-50">
                  {saving ? 'Creating...' : 'Create Booking'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
