'use client';

import React, { useState, useEffect } from 'react';

interface Booking {
  id: string;
  reference: string;
  serviceType: string;
  startDate: string;
  endDate: string;
  status: 'active' | 'completed' | 'cancelled' | 'upcoming';
}

export default function MyBookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [filteredBookings, setFilteredBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTab, setFilterTab] = useState<'all' | 'active' | 'completed' | 'cancelled'>('all');

  useEffect(() => {
    fetchBookings();
  }, []);

  useEffect(() => {
    if (filterTab === 'all') {
      setFilteredBookings(bookings);
    } else {
      setFilteredBookings(bookings.filter((b) => b.status === filterTab));
    }
  }, [filterTab, bookings]);

  const fetchBookings = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/bookings');
      if (res.ok) {
        const data = await res.json();
        setBookings(data.bookings || []);
      }
    } catch (error) {
      console.error('Error fetching bookings:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    if (status === 'active') return 'bg-emerald-500/20 text-emerald-400';
    if (status === 'completed') return 'bg-blue-500/20 text-blue-400';
    if (status === 'cancelled') return 'bg-rose-500/20 text-rose-400';
    return 'bg-amber-500/20 text-amber-400';
  };

  const getServiceIcon = (type: string) => {
    if (type.includes('Rental')) return '🚗';
    if (type.includes('Lease')) return '🔑';
    if (type.includes('Shuttle')) return '🚌';
    return '📅';
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-white">My Bookings</h1>

      {/* Filter Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {(['all', 'active', 'completed', 'cancelled'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setFilterTab(tab)}
            className={`px-3 py-1 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
              filterTab === tab
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800/50 text-slate-300 border border-white/10'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Bookings List */}
      <div className="space-y-3">
        {filteredBookings.length > 0 ? (
          filteredBookings.map((booking) => (
            <div key={booking.id} className="bg-slate-800/50 border border-white/10 rounded-xl p-4">
              <div className="flex gap-3">
                <span className="text-3xl">{getServiceIcon(booking.serviceType)}</span>
                <div className="flex-1">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-white font-semibold text-sm">{booking.serviceType}</p>
                      <p className="text-slate-400 text-xs">{booking.reference}</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${getStatusColor(booking.status)}`}>
                      {booking.status}
                    </span>
                  </div>
                  <p className="text-slate-400 text-xs">
                    {new Date(booking.startDate).toLocaleDateString()} - {new Date(booking.endDate).toLocaleDateString()}
                  </p>
                  <button className="mt-2 text-blue-400 text-xs font-medium hover:text-blue-300">
                    View Details →
                  </button>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <span className="text-5xl mb-3">📭</span>
            <p className="text-slate-400 text-sm">No bookings found</p>
          </div>
        )}
      </div>
    </div>
  );
}
