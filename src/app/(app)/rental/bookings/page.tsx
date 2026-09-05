'use client';
import { addDays } from '@/lib/autoFill';
import React, { useState, useEffect, useCallback } from 'react';
import SlideOverDrawer, { DrawerTab, DrawerAction } from '@/components/ui/SlideOverDrawer';
import { 
  Calendar, 
  Car, 
  User, 
  MapPin, 
  Clock, 
  CreditCard, 
  FileText, 
  ShieldCheck, 
  ExternalLink,
  Code
} from 'lucide-react';

interface Customer { id: string; fullName: string; email?: string; phone?: string; nationality?: string; }
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
  createdAt?: string;
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
  const [sweeping, setSweeping] = useState(false);
  const [permitFor, setPermitFor] = useState<Booking | null>(null);
  const [permitDestination, setPermitDestination] = useState('OMAN');
  const [permitBorder, setPermitBorder] = useState('');
  const [permitPurpose, setPermitPurpose] = useState('Tourism');

  // Slide-over drawer inspection state
  const [inspectingBooking, setInspectingBooking] = useState<Booking | null>(null);
  const [drawerTab, setDrawerTab] = useState<string>('overview');

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.customerId || !formData.vehicleCategory || !formData.pickupDate || !formData.dropoffDate) {
      setError('Please fill all required fields');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/rental/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          dailyRate: formData.dailyRate ? parseFloat(formData.dailyRate) : undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? 'Failed to create booking');
      }
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
      loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create booking');
    } finally {
      setSaving(false);
    }
  };

  const handleAction = async (id: string, action: 'confirm' | 'activate' | 'complete' | 'cancel', extra?: Record<string, unknown>) => {
    setActionLoading(`${id}:${action}`);
    try {
      const res = await fetch(`/api/rental/bookings/${id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Failed to ${action} booking`);
      
      // Update local state if currently inspecting
      if (inspectingBooking && inspectingBooking.id === id) {
        setInspectingBooking(prev => prev ? { ...prev, status: data.booking?.status || action.toUpperCase() } : null);
      }
      loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : `Failed to ${action} booking`);
    } finally {
      setActionLoading(null);
    }
  };

  const filtered = statusFilter === 'All'
    ? bookings
    : bookings.filter(b => (b.status ?? 'PENDING').toUpperCase() === statusFilter);

  const runPenaltySweep = async () => {
    setSweeping(true);
    try {
      const res = await fetch('/api/rental/penalties/sweep', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Sweep failed');
      alert(
        `Sweep complete:\n` +
        `  ${data.counts.noShow} no-show flipped & charged\n` +
        `  ${data.counts.lateReturn} late-return charged\n` +
        `  ${data.counts.skipped} skipped (already today)\n` +
        `  ${data.errors.length} errors`
      );
      loadData();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Sweep failed');
    } finally {
      setSweeping(false);
    }
  };

  const DRAWER_TABS: DrawerTab[] = [
    { id: 'overview', label: 'Overview', icon: <FileText className="w-3.5 h-3.5" /> },
    { id: 'customer', label: 'Customer', icon: <User className="w-3.5 h-3.5" /> },
    { id: 'compliance', label: 'Cross-Border Permit', icon: <ShieldCheck className="w-3.5 h-3.5" /> },
    { id: 'json', label: 'Raw Payload', icon: <Code className="w-3.5 h-3.5" /> },
  ];

  const getDrawerActions = (b: Booking): DrawerAction[] => {
    const status = (b.status ?? 'PENDING').toUpperCase();
    const actions: DrawerAction[] = [];

    if (status === 'PENDING') {
      actions.push({
        label: 'Confirm Booking',
        variant: 'primary',
        onClick: () => handleAction(b.id, 'confirm'),
      });
    }
    if (status === 'CONFIRMED' || status === 'PENDING') {
      actions.push({
        label: 'Activate (Handover)',
        variant: 'primary',
        onClick: () => handleAction(b.id, 'activate'),
      });
    }
    if (status === 'CONFIRMED' || status === 'ACTIVE') {
      actions.push({
        label: 'Issue Permit',
        variant: 'secondary',
        onClick: () => { setPermitFor(b); },
      });
    }
    if (status === 'ACTIVE') {
      actions.push({
        label: 'Complete Return',
        variant: 'secondary',
        onClick: () => handleAction(b.id, 'complete'),
      });
    }
    if (!['COMPLETED', 'CANCELLED'].includes(status)) {
      actions.push({
        label: 'Cancel Booking',
        variant: 'danger',
        onClick: () => {
          if (confirm('Cancel this booking?')) {
            handleAction(b.id, 'cancel', { reason: 'User requested' });
          }
        },
      });
    }
    return actions;
  };

  if (loading) return (
    <div className="flex items-center justify-center h-full min-h-[300px]">
      <div className="text-[var(--text-muted)] animate-pulse font-medium">Loading bookings...</div>
    </div>
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)] mb-1">Rental Bookings</h1>
          <p className="text-[var(--text-muted)] text-xs">Manage all rental reservations & fleet allocation — {bookings.length} total</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={runPenaltySweep}
            disabled={sweeping}
            title="Detect no-show + late-return bookings and apply penalty fees"
            className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs font-medium text-amber-400 hover:bg-amber-500/20 transition-all disabled:opacity-50"
          >
            {sweeping ? 'Sweeping…' : '⚠ Run Penalty Sweep'}
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-2.5 text-xs font-semibold text-white hover:opacity-90 transition-all shadow-sm"
          >
            + New Booking
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm">
          {error}
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {['All','PENDING','CONFIRMED','ACTIVE','COMPLETED'].map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`p-4 rounded-xl border transition-all text-left ${statusFilter === s ? 'border-emerald-500 bg-emerald-500/10' : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-strong)]'}`}
          >
            <div className="text-2xl font-bold text-[var(--text-main)]">
              {s === 'All' ? bookings.length : bookings.filter(b => (b.status ?? 'PENDING') === s).length}
            </div>
            <div className="text-xs text-[var(--text-muted)] mt-1">{s === 'All' ? 'All Bookings' : s.charAt(0) + s.slice(1).toLowerCase()}</div>
          </button>
        ))}
      </div>

      {/* Bookings Table */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6 overflow-x-auto shadow-sm">
        {filtered.length === 0 ? (
          <div className="text-center text-[var(--text-muted)] py-12 text-sm">No bookings found</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border-subtle)]">
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Ref</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Customer</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Category</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Pickup</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Return</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Days</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(b => {
                const status = (b.status ?? 'PENDING').toUpperCase();
                const isActing = actionLoading?.startsWith(b.id);
                return (
                  <tr 
                    key={b.id} 
                    onClick={() => { setInspectingBooking(b); setDrawerTab('overview'); }}
                    className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] transition-colors cursor-pointer group"
                  >
                    <td className="px-4 py-4 text-sm font-semibold font-mono text-emerald-500">
                      {b.bookingRef ?? b.id.slice(0,8)}
                    </td>
                    <td className="px-4 py-4 text-sm font-medium text-[var(--text-main)]">
                      {b.customer?.fullName ?? b.customerId}
                    </td>
                    <td className="px-4 py-4 text-sm text-[var(--text-main)]">
                      <span className="px-2 py-0.5 rounded-md bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-xs font-medium">
                        {b.vehicleCategory ?? '-'}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm text-[var(--text-muted)]">{new Date(b.pickupDate).toLocaleDateString()}</td>
                    <td className="px-4 py-4 text-sm text-[var(--text-muted)]">{new Date(b.dropoffDate).toLocaleDateString()}</td>
                    <td className="px-4 py-4 text-sm text-[var(--text-main)] font-medium">{b.totalDays ?? '-'}</td>
                    <td className="px-4 py-4 text-sm font-semibold text-[var(--text-main)]">
                      {b.totalAmount ? `AED ${Number(b.totalAmount).toLocaleString()}` : '-'}
                    </td>
                    <td className="px-4 py-4">
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${STATUS_COLORS[status] ?? STATUS_COLORS.PENDING}`}>
                        {status}
                      </span>
                    </td>
                    <td className="px-4 py-4" onClick={e => e.stopPropagation()}>
                      <div className="flex gap-2 flex-wrap items-center">
                        <button
                          onClick={() => { setInspectingBooking(b); setDrawerTab('overview'); }}
                          className="text-xs px-2 py-1 rounded bg-[var(--bg-surface-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)] border border-[var(--border-subtle)]"
                          title="Inspect booking details"
                        >
                          Inspect ↗
                        </button>
                        {status === 'PENDING' && (
                          <button
                            onClick={() => handleAction(b.id, 'confirm')}
                            disabled={!!isActing}
                            className="text-xs px-2 py-1 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 disabled:opacity-50 font-medium"
                          >
                            Confirm
                          </button>
                        )}
                        {(status === 'CONFIRMED' || status === 'PENDING') && (
                          <button
                            onClick={() => handleAction(b.id, 'activate')}
                            disabled={!!isActing}
                            className="text-xs px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 disabled:opacity-50 font-medium"
                          >
                            Activate
                          </button>
                        )}
                        {(status === 'CONFIRMED' || status === 'ACTIVE') && (
                          <button
                            onClick={() => setPermitFor(b)}
                            className="text-xs px-2 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 font-medium"
                            title="Issue cross-border travel permit"
                          >
                            Permit
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

      {/* Slide-Over Inspector Drawer */}
      {inspectingBooking && (
        <SlideOverDrawer
          isOpen={!!inspectingBooking}
          onClose={() => setInspectingBooking(null)}
          title={`Booking ${inspectingBooking.bookingRef ?? inspectingBooking.id.slice(0, 8)}`}
          subtitle={`ID: ${inspectingBooking.id}`}
          badge={{
            text: (inspectingBooking.status ?? 'PENDING').toUpperCase(),
            variant: (inspectingBooking.status === 'ACTIVE' ? 'emerald' : inspectingBooking.status === 'CONFIRMED' ? 'blue' : inspectingBooking.status === 'COMPLETED' ? 'slate' : 'amber'),
          }}
          tabs={DRAWER_TABS}
          activeTab={drawerTab}
          onTabChange={setDrawerTab}
          actions={getDrawerActions(inspectingBooking)}
          width="xl"
        >
          {drawerTab === 'overview' && (
            <div className="space-y-6">
              {/* Top Highlights Banner */}
              <div className="grid grid-cols-3 gap-3 p-4 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)]">
                <div>
                  <div className="text-[11px] text-[var(--text-muted)] uppercase font-semibold">Total Amount</div>
                  <div className="text-lg font-bold text-emerald-500 mt-0.5">
                    {inspectingBooking.totalAmount ? `AED ${Number(inspectingBooking.totalAmount).toLocaleString()}` : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[var(--text-muted)] uppercase font-semibold">Duration</div>
                  <div className="text-lg font-bold text-[var(--text-main)] mt-0.5">
                    {inspectingBooking.totalDays ? `${inspectingBooking.totalDays} Days` : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[var(--text-muted)] uppercase font-semibold">Daily Rate</div>
                  <div className="text-lg font-bold text-[var(--text-main)] mt-0.5">
                    {inspectingBooking.dailyRate ? `AED ${inspectingBooking.dailyRate}/day` : '—'}
                  </div>
                </div>
              </div>

              {/* Booking Schedule */}
              <div>
                <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-3">Schedule & Locations</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-hover)]/40 space-y-1">
                    <div className="flex items-center gap-1.5 text-xs text-emerald-500 font-semibold">
                      <Calendar className="w-3.5 h-3.5" /> Pickup Schedule
                    </div>
                    <div className="text-sm font-bold text-[var(--text-main)]">
                      {new Date(inspectingBooking.pickupDate).toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
                    </div>
                    <div className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-[var(--text-muted)]" />
                      {inspectingBooking.pickupLocation || 'Main Hub / Desk'}
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-hover)]/40 space-y-1">
                    <div className="flex items-center gap-1.5 text-xs text-amber-500 font-semibold">
                      <Calendar className="w-3.5 h-3.5" /> Return Schedule
                    </div>
                    <div className="text-sm font-bold text-[var(--text-main)]">
                      {new Date(inspectingBooking.dropoffDate).toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
                    </div>
                    <div className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-[var(--text-muted)]" />
                      {inspectingBooking.dropoffLocation || 'Main Hub / Desk'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Vehicle & Channel details */}
              <div>
                <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-3">Category & Channel</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                    <div className="text-xs text-[var(--text-muted)]">Vehicle Category</div>
                    <div className="text-sm font-bold text-[var(--text-main)] mt-1 flex items-center gap-2">
                      <Car className="w-4 h-4 text-emerald-500" />
                      {inspectingBooking.vehicleCategory || 'Not specified'}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                    <div className="text-xs text-[var(--text-muted)]">Booking Channel</div>
                    <div className="text-sm font-bold text-[var(--text-main)] mt-1">
                      {inspectingBooking.channel || 'DIRECT'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Notes */}
              {inspectingBooking.notes && (
                <div>
                  <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Remarks & Notes</h3>
                  <div className="p-3.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-hover)]/50 text-xs text-[var(--text-main)] leading-relaxed">
                    {inspectingBooking.notes}
                  </div>
                </div>
              )}
            </div>
          )}

          {drawerTab === 'customer' && (
            <div className="space-y-6">
              <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-hover)]/40 flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-500 flex items-center justify-center font-bold text-lg flex-shrink-0">
                  {inspectingBooking.customer?.fullName?.charAt(0) || 'C'}
                </div>
                <div>
                  <div className="text-base font-bold text-[var(--text-main)]">
                    {inspectingBooking.customer?.fullName || inspectingBooking.customerId}
                  </div>
                  <div className="text-xs text-[var(--text-muted)] font-mono">
                    Customer ID: {inspectingBooking.customerId}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] flex justify-between">
                  <span className="text-xs text-[var(--text-muted)]">Full Name</span>
                  <span className="text-xs font-semibold text-[var(--text-main)]">{inspectingBooking.customer?.fullName ?? '—'}</span>
                </div>
                <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] flex justify-between">
                  <span className="text-xs text-[var(--text-muted)]">Email Address</span>
                  <span className="text-xs font-semibold text-[var(--text-main)]">{inspectingBooking.customer?.email ?? 'Not provided'}</span>
                </div>
                <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] flex justify-between">
                  <span className="text-xs text-[var(--text-muted)]">Phone Number</span>
                  <span className="text-xs font-semibold text-[var(--text-main)]">{inspectingBooking.customer?.phone ?? 'Not provided'}</span>
                </div>
              </div>
            </div>
          )}

          {drawerTab === 'compliance' && (
            <div className="space-y-5">
              <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-300 text-xs leading-relaxed">
                Issue official bilingual cross-border authorization permits for vehicles travelling from UAE into Oman, Saudi Arabia, Bahrain, Qatar or Kuwait.
              </div>
              <button
                onClick={() => setPermitFor(inspectingBooking)}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 text-white font-semibold text-xs hover:opacity-90 transition-opacity flex items-center justify-center gap-2 shadow-sm"
              >
                <ShieldCheck className="w-4 h-4" /> Open Permit Generator Modal
              </button>
            </div>
          )}

          {drawerTab === 'json' && (
            <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-hover)] font-mono text-[11px] text-[var(--text-muted)] overflow-x-auto">
              <pre>{JSON.stringify(inspectingBooking, null, 2)}</pre>
            </div>
          )}
        </SlideOverDrawer>
      )}

      {/* New Booking Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-8 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-[var(--text-main)]">New Booking</h2>
              <button onClick={() => setShowModal(false)} className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-sm">✕</button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Customer *</label>
                  <select name="customerId" value={formData.customerId} onChange={e => setFormData(p => ({...p, customerId: e.target.value}))} required
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] text-xs focus:border-emerald-500 focus:outline-none">
                    <option value="">Select customer</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.fullName}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Vehicle Category *</label>
                  <select name="vehicleCategory" value={formData.vehicleCategory} onChange={e => setFormData(p => ({...p, vehicleCategory: e.target.value}))} required
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] text-xs focus:border-emerald-500 focus:outline-none">
                    <option value="">Select category</option>
                    {VEHICLE_CATEGORIES.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Pickup Date *</label>
                  <input type="date" value={formData.pickupDate} onChange={e => setFormData(p => ({...p, pickupDate: e.target.value}))} required
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] text-xs focus:border-emerald-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Return Date *</label>
                  <input type="date" value={formData.dropoffDate} onChange={e => setFormData(p => ({...p, dropoffDate: e.target.value}))} required
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] text-xs focus:border-emerald-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Pickup Location</label>
                  <input type="text" value={formData.pickupLocation} onChange={e => setFormData(p => ({...p, pickupLocation: e.target.value}))} placeholder="e.g., Dubai Airport"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] text-xs placeholder-[var(--text-muted)] focus:border-emerald-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Return Location</label>
                  <input type="text" value={formData.dropoffLocation} onChange={e => setFormData(p => ({...p, dropoffLocation: e.target.value}))} placeholder="e.g., Downtown Dubai"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] text-xs placeholder-[var(--text-muted)] focus:border-emerald-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Daily Rate (AED)</label>
                  <input type="number" value={formData.dailyRate} onChange={e => setFormData(p => ({...p, dailyRate: e.target.value}))} placeholder="150" min="0" step="0.01"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] text-xs placeholder-[var(--text-muted)] focus:border-emerald-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Channel</label>
                  <select value={formData.channel} onChange={e => setFormData(p => ({...p, channel: e.target.value}))}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] text-xs focus:border-emerald-500 focus:outline-none">
                    {CHANNELS.map(ch => <option key={ch} value={ch}>{ch}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Notes</label>
                <textarea value={formData.notes} onChange={e => setFormData(p => ({...p, notes: e.target.value}))} rows={2} placeholder="Additional notes..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] text-xs placeholder-[var(--text-muted)] focus:border-emerald-500 focus:outline-none resize-none" />
              </div>
              <div className="flex gap-3 justify-end pt-4">
                <button type="button" onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-xl border border-[var(--border-subtle)] text-[var(--text-main)] text-xs hover:bg-[var(--bg-surface-hover)]">Cancel</button>
                <button type="submit" disabled={saving}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-semibold text-xs hover:opacity-90 disabled:opacity-50 shadow-sm">
                  {saving ? 'Creating...' : 'Create Booking'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cross-border permit modal */}
      {permitFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-8 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-[var(--text-main)]">Cross-Border Permit</h2>
              <button onClick={() => setPermitFor(null)} className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-lg">×</button>
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-6">
              For booking <span className="font-mono text-emerald-500 font-bold">{permitFor.bookingRef ?? permitFor.id.slice(0,8)}</span>
              {' · '}{permitFor.customer?.fullName ?? '—'}
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Destination *</label>
                <select value={permitDestination} onChange={e => setPermitDestination(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] text-xs focus:border-amber-500 focus:outline-none">
                  <option value="OMAN">Sultanate of Oman</option>
                  <option value="KSA">Kingdom of Saudi Arabia</option>
                  <option value="BAHRAIN">Kingdom of Bahrain</option>
                  <option value="QATAR">State of Qatar</option>
                  <option value="KUWAIT">State of Kuwait</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Border Crossing</label>
                <input type="text" value={permitBorder} onChange={e => setPermitBorder(e.target.value)}
                  placeholder="e.g., Hatta / Wajaja"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] text-xs placeholder-[var(--text-muted)] focus:border-amber-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Purpose</label>
                <input type="text" value={permitPurpose} onChange={e => setPermitPurpose(e.target.value)}
                  placeholder="Tourism / Business / Family Visit"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] text-xs placeholder-[var(--text-muted)] focus:border-amber-500 focus:outline-none" />
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                Validity defaults to the booking pickup → drop-off window. PDF opens in a new tab; bilingual EN + AR available.
              </p>
            </div>
            <div className="flex gap-3 justify-end pt-6 mt-4 border-t border-[var(--border-subtle)]">
              <button onClick={() => setPermitFor(null)} className="px-4 py-2 rounded-xl border border-[var(--border-subtle)] text-[var(--text-main)] text-xs hover:bg-[var(--bg-surface-hover)]">Close</button>
              {(['en','ar'] as const).map(lng => (
                <a key={lng}
                  href={`/api/rental/bookings/${permitFor.id}/cross-border-permit?lang=${lng}&destination=${permitDestination}` +
                        `${permitBorder ? `&border=${encodeURIComponent(permitBorder)}` : ''}` +
                        `${permitPurpose ? `&purpose=${encodeURIComponent(permitPurpose)}` : ''}`}
                  target="_blank" rel="noopener noreferrer"
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 text-white text-xs font-semibold hover:opacity-90 shadow-sm"
                >
                  Issue · {lng.toUpperCase()}
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
