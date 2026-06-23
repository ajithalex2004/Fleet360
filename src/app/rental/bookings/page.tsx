'use client';

import ActionDialog from '@/components/ui/ActionDialog';
import { useRentalMasterData } from '@/hooks/useRentalMasterData';
import React, { useCallback, useEffect, useState } from 'react';

interface Customer {
  id: string;
  fullName: string;
}

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

interface BannerState {
  tone: 'error' | 'success' | 'info';
  message: string;
}

interface ConfirmState {
  title: string;
  description: string;
  details?: string[];
  tone?: 'danger' | 'warning' | 'info';
  confirmLabel?: string;
  busy?: boolean;
  action: () => Promise<void> | void;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  CONFIRMED: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  ACTIVE: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  COMPLETED: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  CANCELLED: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
};

export default function BookingsPage() {
  const { masterData } = useRentalMasterData();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [statusFilter, setStatusFilter] = useState('All');
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [permitFor, setPermitFor] = useState<Booking | null>(null);
  const [permitDestination, setPermitDestination] = useState('OMAN');
  const [permitBorder, setPermitBorder] = useState('');
  const [permitPurpose, setPermitPurpose] = useState('Tourism');

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

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filtered =
    statusFilter === 'All'
      ? bookings
      : bookings.filter((b) => (b.status ?? 'PENDING').toUpperCase() === statusFilter);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setBanner(null);
    try {
      const pickup = new Date(formData.pickupDate);
      const dropoff = new Date(formData.dropoffDate);
      const totalDays = Math.ceil((dropoff.getTime() - pickup.getTime()) / 86400000);
      const dailyRate = parseFloat(formData.dailyRate) || 0;
      const totalAmount = totalDays * dailyRate;

      const res = await fetch('/api/rental/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: formData.customerId,
          vehicleCategory: formData.vehicleCategory,
          pickupDate: pickup.toISOString(),
          dropoffDate: dropoff.toISOString(),
          pickupLocation: formData.pickupLocation || null,
          dropoffLocation: formData.dropoffLocation || null,
          totalDays,
          dailyRate,
          totalAmount,
          channel: formData.channel,
          notes: formData.notes || null,
          status: 'PENDING',
        }),
      });
      if (!res.ok) throw new Error('Failed to create booking');
      setShowModal(false);
      setFormData({
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
      setBanner({ tone: 'success', message: 'Booking created successfully.' });
      loadData();
    } catch {
      setError('Failed to create booking');
    } finally {
      setSaving(false);
    }
  };

  const handleAction = async (bookingId: string, action: string, body?: object) => {
    setActionLoading(bookingId + action);
    setError('');
    setBanner(null);
    try {
      const res = await fetch(`/api/rental/bookings/${bookingId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      if (!res.ok) {
        const d = await res.json();
        setBanner({ tone: 'error', message: d.error ?? 'Action failed' });
        return;
      }
      setBanner({ tone: 'success', message: `Booking ${action} completed successfully.` });
      loadData();
    } catch {
      setBanner({ tone: 'error', message: 'Action failed' });
    } finally {
      setActionLoading(null);
    }
  };

  const runPenaltySweep = async () => {
    setSweeping(true);
    setBanner(null);
    try {
      const dry = await fetch('/api/rental/bookings/sweep-penalties?dryRun=1', { method: 'POST' });
      if (!dry.ok) throw new Error('Dry run failed');
      const dryData = await dry.json();
      const noShow = dryData.assessments?.filter((a: { kind: string }) => a.kind === 'NO_SHOW').length ?? 0;
      const lateRet = dryData.assessments?.filter((a: { kind: string }) => a.kind === 'LATE_RETURN').length ?? 0;

      if (noShow + lateRet === 0) {
        setBanner({ tone: 'info', message: `Scanned ${dryData.scanned} bookings with no penalties to apply.` });
        return;
      }

      setConfirmState({
        title: 'Apply penalty sweep',
        description: 'Review the penalty preview before the sweep updates bookings and applies fees.',
        tone: 'warning',
        confirmLabel: 'Apply sweep',
        details: [
          `${dryData.scanned} bookings scanned`,
          `${noShow} no-show bookings will flip status and receive fees`,
          `${lateRet} late-return bookings will stay ACTIVE and receive fees`,
        ],
        action: async () => {
          setSweeping(true);
          try {
            const real = await fetch('/api/rental/bookings/sweep-penalties', { method: 'POST' });
            if (!real.ok) throw new Error('Sweep failed');
            const data = await real.json();
            setBanner({
              tone: 'success',
              message: `Penalty sweep complete: ${data.counts.noShow} no-show, ${data.counts.lateReturn} late-return, ${data.counts.skipped} skipped, ${data.errors.length} errors.`,
            });
            setConfirmState(null);
            loadData();
          } catch (e) {
            setBanner({ tone: 'error', message: e instanceof Error ? e.message : 'Sweep failed' });
          } finally {
            setSweeping(false);
          }
        },
      });
    } catch (e) {
      setBanner({ tone: 'error', message: e instanceof Error ? e.message : 'Sweep failed' });
    } finally {
      setSweeping(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="animate-pulse text-slate-400">Loading bookings...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="mb-2 text-4xl font-bold text-white">Bookings</h1>
          <p className="text-slate-400">Manage all rental bookings - {bookings.length} total</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={runPenaltySweep}
            disabled={sweeping}
            title="Detect no-show and late-return bookings and apply penalty fees"
            className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-300 transition-all hover:bg-amber-500/20 disabled:opacity-50"
          >
            {sweeping ? 'Sweeping...' : 'Run Penalty Sweep'}
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-3 text-sm font-medium text-white transition-all hover:opacity-90"
          >
            + New Booking
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
          {error}
        </div>
      )}

      {banner && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            banner.tone === 'error'
              ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
              : banner.tone === 'success'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200'
          }`}
        >
          {banner.message}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {['All', 'PENDING', 'CONFIRMED', 'ACTIVE', 'COMPLETED'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-xl border p-4 text-left transition-all ${
              statusFilter === s ? 'border-emerald-500 bg-emerald-500/10' : 'border-white/10 bg-slate-800/50 hover:border-white/20'
            }`}
          >
            <div className="text-2xl font-bold text-white">
              {s === 'All' ? bookings.length : bookings.filter((b) => (b.status ?? 'PENDING') === s).length}
            </div>
            <div className="mt-1 text-xs text-slate-400">
              {s === 'All' ? 'All Bookings' : s.charAt(0) + s.slice(1).toLowerCase()}
            </div>
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-slate-800/50 p-6 backdrop-blur-sm">
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-slate-400">No bookings found</div>
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
              {filtered.map((b) => {
                const status = (b.status ?? 'PENDING').toUpperCase();
                const isActing = actionLoading?.startsWith(b.id);
                return (
                  <tr key={b.id} className="border-b border-white/5 transition-colors hover:bg-white/5">
                    <td className="px-4 py-4 text-sm font-medium text-white">{b.bookingRef ?? b.id.slice(0, 8)}</td>
                    <td className="px-4 py-4 text-sm text-white">{b.customer?.fullName ?? b.customerId}</td>
                    <td className="px-4 py-4 text-sm text-white">{b.vehicleCategory ?? '-'}</td>
                    <td className="px-4 py-4 text-sm text-slate-200">{new Date(b.pickupDate).toLocaleDateString()}</td>
                    <td className="px-4 py-4 text-sm text-slate-200">{new Date(b.dropoffDate).toLocaleDateString()}</td>
                    <td className="px-4 py-4 text-sm font-medium text-white">{b.totalDays ?? '-'}</td>
                    <td className="px-4 py-4 text-sm font-medium text-white">
                      {b.totalAmount ? `AED ${Number(b.totalAmount).toLocaleString()}` : '-'}
                    </td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full border px-3 py-1 text-xs font-medium ${STATUS_COLORS[status] ?? STATUS_COLORS.PENDING}`}>
                        {status}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-2">
                        {status === 'PENDING' && (
                          <button
                            onClick={() => handleAction(b.id, 'confirm')}
                            disabled={!!isActing}
                            className="rounded border border-blue-500/30 bg-blue-500/20 px-2 py-1 text-xs text-blue-400 hover:bg-blue-500/30 disabled:opacity-50"
                          >
                            Confirm
                          </button>
                        )}
                        {(status === 'CONFIRMED' || status === 'PENDING') && (
                          <button
                            onClick={() => handleAction(b.id, 'activate')}
                            disabled={!!isActing}
                            className="rounded border border-emerald-500/30 bg-emerald-500/20 px-2 py-1 text-xs text-emerald-400 hover:bg-emerald-500/30 disabled:opacity-50"
                          >
                            Activate
                          </button>
                        )}
                        {(status === 'CONFIRMED' || status === 'ACTIVE') && (
                          <button
                            onClick={() => setPermitFor(b)}
                            className="rounded border border-amber-500/30 bg-amber-500/20 px-2 py-1 text-xs text-amber-300 hover:bg-amber-500/30"
                            title="Issue cross-border travel permit"
                          >
                            Permit
                          </button>
                        )}
                        {status === 'ACTIVE' && (
                          <button
                            onClick={() => handleAction(b.id, 'complete')}
                            disabled={!!isActing}
                            className="rounded border border-slate-500/30 bg-slate-500/20 px-2 py-1 text-xs text-white hover:bg-slate-500/30 disabled:opacity-50"
                          >
                            Complete
                          </button>
                        )}
                        {!['COMPLETED', 'CANCELLED'].includes(status) && (
                          <button
                            onClick={() =>
                              setConfirmState({
                                title: 'Cancel booking',
                                description: 'This booking will move to CANCELLED and stop further operational processing.',
                                tone: 'danger',
                                confirmLabel: 'Cancel booking',
                                details: [
                                  `Booking ${b.bookingRef ?? b.id.slice(0, 8)}`,
                                  `Customer: ${b.customer?.fullName ?? b.customerId}`,
                                ],
                                action: async () => {
                                  await handleAction(b.id, 'cancel', { reason: 'User requested' });
                                  setConfirmState(null);
                                },
                              })
                            }
                            disabled={!!isActing}
                            className="rounded border border-rose-500/30 bg-rose-500/20 px-2 py-1 text-xs text-rose-400 hover:bg-rose-500/30 disabled:opacity-50"
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

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-slate-800/95 p-8">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-white">New Booking</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white" aria-label="Close booking form">
                x
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">Customer *</label>
                  <select
                    name="customerId"
                    value={formData.customerId}
                    onChange={(e) => setFormData((p) => ({ ...p, customerId: e.target.value }))}
                    required
                    className="w-full rounded-lg border border-white/10 bg-slate-700 px-4 py-2 text-white focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="">Select customer</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.fullName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">Vehicle Category *</label>
                  <select
                    name="vehicleCategory"
                    value={formData.vehicleCategory}
                    onChange={(e) => setFormData((p) => ({ ...p, vehicleCategory: e.target.value }))}
                    required
                    className="w-full rounded-lg border border-white/10 bg-slate-700 px-4 py-2 text-white focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="">Select category</option>
                    {masterData.vehicleCategories.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">Pickup Date *</label>
                  <input
                    type="date"
                    value={formData.pickupDate}
                    onChange={(e) => setFormData((p) => ({ ...p, pickupDate: e.target.value }))}
                    required
                    className="w-full rounded-lg border border-white/10 bg-slate-700 px-4 py-2 text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">Return Date *</label>
                  <input
                    type="date"
                    value={formData.dropoffDate}
                    onChange={(e) => setFormData((p) => ({ ...p, dropoffDate: e.target.value }))}
                    required
                    className="w-full rounded-lg border border-white/10 bg-slate-700 px-4 py-2 text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">Pickup Location</label>
                  <input
                    type="text"
                    value={formData.pickupLocation}
                    onChange={(e) => setFormData((p) => ({ ...p, pickupLocation: e.target.value }))}
                    placeholder="e.g., Dubai Airport"
                    className="w-full rounded-lg border border-white/10 bg-slate-700 px-4 py-2 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">Return Location</label>
                  <input
                    type="text"
                    value={formData.dropoffLocation}
                    onChange={(e) => setFormData((p) => ({ ...p, dropoffLocation: e.target.value }))}
                    placeholder="e.g., Downtown Dubai"
                    className="w-full rounded-lg border border-white/10 bg-slate-700 px-4 py-2 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">Daily Rate (AED)</label>
                  <input
                    type="number"
                    value={formData.dailyRate}
                    onChange={(e) => setFormData((p) => ({ ...p, dailyRate: e.target.value }))}
                    placeholder="150"
                    min="0"
                    step="0.01"
                    className="w-full rounded-lg border border-white/10 bg-slate-700 px-4 py-2 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">Channel</label>
                  <select
                    value={formData.channel}
                    onChange={(e) => setFormData((p) => ({ ...p, channel: e.target.value }))}
                    className="w-full rounded-lg border border-white/10 bg-slate-700 px-4 py-2 text-white focus:border-emerald-500 focus:outline-none"
                  >
                    {masterData.bookingChannels.map((ch) => (
                      <option key={ch} value={ch}>
                        {ch}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData((p) => ({ ...p, notes: e.target.value }))}
                  rows={2}
                  placeholder="Additional notes..."
                  className="w-full rounded-lg border border-white/10 bg-slate-700 px-4 py-2 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-4 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-lg border border-white/10 px-6 py-2 text-white hover:bg-white/5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-2 text-white hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? 'Creating...' : 'Create Booking'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {permitFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-800/95 p-8">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-white">Cross-Border Permit</h2>
              <button onClick={() => setPermitFor(null)} className="text-xl text-slate-400 hover:text-white" aria-label="Close permit dialog">
                x
              </button>
            </div>
            <p className="mb-6 text-sm text-slate-400">
              For booking <span className="font-mono text-cyan-300">{permitFor.bookingRef ?? permitFor.id.slice(0, 8)}</span>
              {' - '}
              {permitFor.customer?.fullName ?? '-'}
            </p>
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">Destination *</label>
                <select
                  value={permitDestination}
                  onChange={(e) => setPermitDestination(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-slate-700 px-4 py-2 text-white focus:border-amber-500 focus:outline-none"
                >
                  <option value="OMAN">Sultanate of Oman</option>
                  <option value="KSA">Kingdom of Saudi Arabia</option>
                  <option value="BAHRAIN">Kingdom of Bahrain</option>
                  <option value="QATAR">State of Qatar</option>
                  <option value="KUWAIT">State of Kuwait</option>
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">Border Crossing</label>
                <input
                  type="text"
                  value={permitBorder}
                  onChange={(e) => setPermitBorder(e.target.value)}
                  placeholder="e.g., Hatta / Wajaja"
                  className="w-full rounded-lg border border-white/10 bg-slate-700 px-4 py-2 text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">Purpose</label>
                <input
                  type="text"
                  value={permitPurpose}
                  onChange={(e) => setPermitPurpose(e.target.value)}
                  placeholder="Tourism / Business / Family Visit"
                  className="w-full rounded-lg border border-white/10 bg-slate-700 px-4 py-2 text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                />
              </div>
              <p className="text-xs text-slate-500">
                Validity defaults to the booking pickup to drop-off window. The PDF opens in a new tab in both English and Arabic.
              </p>
            </div>
            <div className="mt-2 flex justify-end gap-3 border-t border-white/10 pt-6">
              <button onClick={() => setPermitFor(null)} className="rounded-lg border border-white/10 px-5 py-2 text-white hover:bg-white/5">
                Close
              </button>
              {(['en', 'ar'] as const).map((lng) => (
                <a
                  key={lng}
                  href={`/api/rental/bookings/${permitFor.id}/cross-border-permit?lang=${lng}&destination=${permitDestination}${
                    permitBorder ? `&border=${encodeURIComponent(permitBorder)}` : ''
                  }${permitPurpose ? `&purpose=${encodeURIComponent(permitPurpose)}` : ''}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg bg-gradient-to-r from-amber-600 to-orange-600 px-5 py-2 text-white hover:opacity-90"
                >
                  Issue - {lng.toUpperCase()}
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      <ActionDialog
        open={!!confirmState}
        title={confirmState?.title ?? ''}
        description={confirmState?.description ?? ''}
        details={confirmState?.details}
        tone={confirmState?.tone ?? 'info'}
        confirmLabel={confirmState?.confirmLabel ?? 'Confirm'}
        busy={confirmState?.busy || sweeping}
        onClose={() => !sweeping && setConfirmState(null)}
        onConfirm={confirmState ? async () => { await confirmState.action(); } : undefined}
      />
    </div>
  );
}
