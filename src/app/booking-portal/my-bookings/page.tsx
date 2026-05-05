'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

interface UserBooking {
  id: string;
  bookingRef: string;
  serviceType: string;
  vehicleCategory: string;
  startDate: string;
  endDate: string;
  status: string;
  createdDate: string;
  notes: string;
}

export default function MyBookings() {
  const [bookings, setBookings] = useState<UserBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState('');

  useEffect(() => {
    const fetchMyBookings = async () => {
      try {
        setLoading(true);
        setError('');
        const res = await fetch('/api/bookings/my-bookings');
        if (!res.ok) throw new Error('Failed to fetch bookings');
        const data = await res.json();
        setBookings(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load bookings');
      } finally {
        setLoading(false);
      }
    };

    fetchMyBookings();
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Pending':
        return 'bg-amber-500/20 text-amber-400 border border-amber-500/30';
      case 'Approved':
        return 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
      case 'Rejected':
        return 'bg-red-500/20 text-red-400 border border-red-500/30';
      case 'Completed':
        return 'bg-slate-500/20 text-slate-400 border border-slate-500/30';
      default:
        return 'bg-slate-500/20 text-slate-400 border border-slate-500/30';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Pending':
        return '⏳';
      case 'Approved':
        return '✓';
      case 'Rejected':
        return '✕';
      case 'Completed':
        return '✓';
      default:
        return '○';
    }
  };

  const groupedBookings = {
    active: bookings.filter((b) => ['Pending', 'Approved'].includes(b.status)),
    completed: bookings.filter((b) => b.status === 'Completed'),
    rejected: bookings.filter((b) => b.status === 'Rejected'),
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin">
          <div className="w-12 h-12 border-4 border-slate-700 border-t-violet-500 rounded-full"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-6 text-red-400">
        <p className="font-medium">Error loading bookings</p>
        <p className="text-sm mt-1">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">My Bookings</h1>
          <p className="text-slate-400">View and manage your transport bookings</p>
        </div>
        <Link href="/booking-portal/new">
          <button className="rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-6 py-3 text-sm font-medium text-white hover:shadow-lg hover:shadow-violet-500/20 transition-all">
            + New Booking
          </button>
        </Link>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
          <p className="text-slate-400 text-sm font-medium mb-2">Total Bookings</p>
          <p className="text-3xl font-bold text-white">{bookings.length}</p>
        </div>
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
          <p className="text-slate-400 text-sm font-medium mb-2">Pending/Active</p>
          <p className="text-3xl font-bold text-amber-400">{groupedBookings.active.length}</p>
        </div>
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
          <p className="text-slate-400 text-sm font-medium mb-2">Completed</p>
          <p className="text-3xl font-bold text-emerald-400">{groupedBookings.completed.length}</p>
        </div>
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
          <p className="text-slate-400 text-sm font-medium mb-2">Rejected</p>
          <p className="text-3xl font-bold text-red-400">{groupedBookings.rejected.length}</p>
        </div>
      </div>

      {/* Active Bookings */}
      {groupedBookings.active.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-2xl font-bold text-white">Active Bookings</h2>
          <div className="space-y-4">
            {groupedBookings.active.map((booking) => (
              <div key={booking.id} className="bg-slate-800/50 border border-white/10 rounded-2xl overflow-hidden">
                <div
                  onClick={() => setExpandedId(expandedId === booking.id ? '' : booking.id)}
                  className="p-6 cursor-pointer hover:bg-slate-800/70 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4 flex-1">
                      <div className="text-3xl">{getStatusIcon(booking.status)}</div>
                      <div>
                        <p className="text-sm text-slate-400">Booking Reference</p>
                        <p className="text-xl font-mono font-bold text-white">{booking.bookingRef}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(booking.status)}`}>
                        {booking.status}
                      </span>
                    </div>
                  </div>
                </div>

                {expandedId === booking.id && (
                  <div className="border-t border-white/5 p-6 bg-slate-900/50">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div>
                        <p className="text-sm text-slate-400 mb-1">Service Type</p>
                        <p className="text-white font-medium">{booking.serviceType}</p>
                      </div>
                      <div>
                        <p className="text-sm text-slate-400 mb-1">Vehicle Category</p>
                        <p className="text-white font-medium">{booking.vehicleCategory}</p>
                      </div>
                      <div>
                        <p className="text-sm text-slate-400 mb-1">Created Date</p>
                        <p className="text-white font-medium">{new Date(booking.createdDate).toLocaleDateString()}</p>
                      </div>
                      <div>
                        <p className="text-sm text-slate-400 mb-1">Start Date</p>
                        <p className="text-white font-medium">{new Date(booking.startDate).toLocaleDateString()}</p>
                      </div>
                      <div>
                        <p className="text-sm text-slate-400 mb-1">End Date</p>
                        <p className="text-white font-medium">{new Date(booking.endDate).toLocaleDateString()}</p>
                      </div>
                      <div>
                        <p className="text-sm text-slate-400 mb-1">Duration</p>
                        <p className="text-white font-medium">
                          {Math.ceil((new Date(booking.endDate).getTime() - new Date(booking.startDate).getTime()) / (1000 * 60 * 60 * 24))} days
                        </p>
                      </div>
                    </div>
                    {booking.notes && (
                      <div className="mt-4 pt-4 border-t border-white/5">
                        <p className="text-sm text-slate-400 mb-2">Notes</p>
                        <p className="text-white">{booking.notes}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Completed Bookings */}
      {groupedBookings.completed.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-2xl font-bold text-white">Completed Bookings</h2>
          <div className="space-y-2">
            {groupedBookings.completed.map((booking) => (
              <div key={booking.id} className="bg-slate-800/30 border border-white/5 rounded-xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <span className="text-2xl">✓</span>
                  <div>
                    <p className="text-white font-mono font-medium">{booking.bookingRef}</p>
                    <p className="text-xs text-slate-400">{booking.serviceType}</p>
                  </div>
                </div>
                <span className="text-xs text-slate-400">{new Date(booking.startDate).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rejected Bookings */}
      {groupedBookings.rejected.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-2xl font-bold text-white">Rejected Bookings</h2>
          <div className="space-y-2">
            {groupedBookings.rejected.map((booking) => (
              <div key={booking.id} className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <span className="text-2xl">✕</span>
                  <div>
                    <p className="text-white font-mono font-medium">{booking.bookingRef}</p>
                    <p className="text-xs text-slate-400">{booking.serviceType}</p>
                  </div>
                </div>
                <span className="text-xs text-slate-400">{new Date(booking.createdDate).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {bookings.length === 0 && (
        <div className="text-center py-20">
          <div className="text-6xl mb-4">📭</div>
          <h2 className="text-2xl font-bold text-white mb-2">No Bookings Yet</h2>
          <p className="text-slate-400 mb-6">Start by creating your first transport booking</p>
          <Link href="/booking-portal/new">
            <button className="rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-8 py-3 text-sm font-medium text-white hover:shadow-lg hover:shadow-violet-500/20 transition-all">
              Create New Booking
            </button>
          </Link>
        </div>
      )}
    </div>
  );
}
