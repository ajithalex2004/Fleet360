'use client';

import React, { useState, useEffect } from 'react';

interface ShuttleTrip {
  id: string;
  route: string;
  departureTime: string;
  boardingStop: string;
  vehicle: string;
  status: 'scheduled' | 'in_progress' | 'completed';
}

interface ScheduleItem {
  id: string;
  day: string;
  route: string;
  departureTime: string;
  boardingStop: string;
}

export default function TransportPage() {
  const [todayTrips, setTodayTrips] = useState<ShuttleTrip[]>([]);
  const [weeklySchedule, setWeeklySchedule] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'today' | 'weekly'>('today');

  useEffect(() => {
    fetchSchedules();
  }, []);

  const fetchSchedules = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/bus-ops/schedules');
      if (res.ok) {
        const data = await res.json();
        setTodayTrips(data.todayTrips || []);
        setWeeklySchedule(data.weeklySchedule || []);
      }
    } catch (error) {
      console.error('Error fetching schedules:', error);
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
    if (status === 'in_progress') return 'bg-emerald-500/20 text-emerald-400';
    if (status === 'completed') return 'bg-blue-500/20 text-blue-400';
    return 'bg-amber-500/20 text-amber-400';
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-white">My Shuttle</h1>

      {/* View Mode Tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setViewMode('today')}
          className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
            viewMode === 'today'
              ? 'bg-blue-600 text-white'
              : 'bg-slate-800/50 text-slate-300 border border-white/10'
          }`}
        >
          Today's Trips
        </button>
        <button
          onClick={() => setViewMode('weekly')}
          className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
            viewMode === 'weekly'
              ? 'bg-blue-600 text-white'
              : 'bg-slate-800/50 text-slate-300 border border-white/10'
          }`}
        >
          Weekly Schedule
        </button>
      </div>

      {/* Today's Trips */}
      {viewMode === 'today' && (
        <div className="space-y-3">
          {todayTrips.length > 0 ? (
            todayTrips.map((trip) => (
              <div key={trip.id} className="bg-slate-800/50 border border-white/10 rounded-xl p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-white font-semibold text-sm">{trip.route}</p>
                    <p className="text-slate-400 text-xs mt-1">
                      Departure: <span className="text-white font-medium">{trip.departureTime}</span>
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${getStatusColor(trip.status)}`}>
                    {trip.status.replace('_', ' ')}
                  </span>
                </div>
                <div className="space-y-2 mb-4 text-xs text-slate-300">
                  <p>📍 Boarding Stop: {trip.boardingStop}</p>
                  <p>🚌 Vehicle: {trip.vehicle}</p>
                </div>
                {trip.status === 'scheduled' && (
                  <button className="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium py-2 rounded-lg transition-all">
                    Mark Attendance
                  </button>
                )}
              </div>
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <span className="text-4xl mb-2">🚌</span>
              <p className="text-slate-400 text-sm">No trips scheduled for today</p>
            </div>
          )}
        </div>
      )}

      {/* Weekly Schedule */}
      {viewMode === 'weekly' && (
        <div className="space-y-3">
          {weeklySchedule.length > 0 ? (
            weeklySchedule.map((item) => (
              <div key={item.id} className="bg-slate-800/50 border border-white/10 rounded-xl p-4">
                <p className="text-white font-semibold text-sm mb-2">{item.day}</p>
                <div className="space-y-2 text-xs text-slate-300">
                  <p>Route: <span className="text-white font-medium">{item.route}</span></p>
                  <p>Departure: <span className="text-white font-medium">{item.departureTime}</span></p>
                  <p>Stop: <span className="text-white font-medium">{item.boardingStop}</span></p>
                </div>
              </div>
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <span className="text-4xl mb-2">📅</span>
              <p className="text-slate-400 text-sm">No weekly schedule available</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
