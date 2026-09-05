'use client';
import React, { useState, useCallback } from 'react';

interface Vehicle {
  id: string;
  make: string;
  model: string;
  year?: number;
  plateNo?: string;
  category?: string;
  color?: string;
  status?: string;
}

interface AvailabilityResult {
  available: number;
  booked: number;
  vehicles: Vehicle[];
}

const VEHICLE_CATEGORIES = ['', 'Economy','Sedan','SUV','Luxury','Van','Minibus','Truck'];

export default function AvailabilityPage() {
  const [startDate, setStartDate]   = useState('');
  const [endDate, setEndDate]       = useState('');
  const [category, setCategory]     = useState('');
  const [result, setResult]         = useState<AvailabilityResult | null>(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');

  const handleSearch = useCallback(async () => {
    if (!startDate || !endDate) {
      setError('Please select both start and end dates');
      return;
    }
    if (new Date(endDate) <= new Date(startDate)) {
      setError('End date must be after start date');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ startDate, endDate });
      if (category) params.set('category', category);
      const res = await fetch(`/api/rental/availability?${params}`);
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setResult(data);
    } catch {
      setError('Failed to check availability');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, category]);

  const days = startDate && endDate
    ? Math.max(0, Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000))
    : 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-main)] mb-2">Vehicle Availability</h1>
        <p className="text-xs text-[var(--text-muted)]">Check which vehicles are available for a given rental period</p>
      </div>

      {/* Search Panel */}
      <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6 backdrop-blur-sm">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Pickup Date *</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-emerald-500 focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Return Date *</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
              className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-emerald-500 focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Category</label>
            <select value={category} onChange={e => setCategory(e.target.value)}
              className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-emerald-500 focus:outline-none">
              <option value="">All Categories</option>
              {VEHICLE_CATEGORIES.filter(Boolean).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <button onClick={handleSearch} disabled={loading}
            className="px-6 py-2 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-medium hover:opacity-90 disabled:opacity-50 transition-all">
            {loading ? 'Checking...' : 'Check Availability'}
          </button>
        </div>
        {days > 0 && (
          <p className="mt-3 text-sm text-[var(--text-muted)]">Rental period: <span className="text-emerald-400 font-medium">{days} day{days !== 1 ? 's' : ''}</span></p>
        )}
      </div>

      {error && <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm">{error}</div>}

      {/* Results */}
      {result !== null && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-6 text-center">
              <div className="text-5xl font-bold text-emerald-400">{result.available}</div>
              <div className="text-sm text-[var(--text-muted)] mt-2">Available Vehicles</div>
            </div>
            <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-6 text-center">
              <div className="text-5xl font-bold text-rose-400">{result.booked}</div>
              <div className="text-sm text-[var(--text-muted)] mt-2">Booked / Unavailable</div>
            </div>
          </div>

          {/* Vehicle List */}
          {result.vehicles.length === 0 ? (
            <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-12 text-center text-[var(--text-muted)]">
              No vehicles available for the selected period{category ? ` in the ${category} category` : ''}.
            </div>
          ) : (
            <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6 backdrop-blur-sm">
              <h2 className="text-lg font-semibold text-[var(--text-main)] mb-4">Available Vehicles</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {result.vehicles.map(v => (
                  <div key={v.id} className="bg-[var(--bg-surface-hover)]/50 border border-[var(--border-subtle)] rounded-xl p-4 hover:border-emerald-500/50 transition-all">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="font-semibold text-[var(--text-main)]">{v.make} {v.model}</div>
                        <div className="text-sm text-[var(--text-muted)]">{v.year ?? ''} {v.color ? `· ${v.color}` : ''}</div>
                      </div>
                      {v.category && (
                        <span className="px-2 py-0.5 rounded text-xs bg-blue-500/20 text-blue-400 border border-blue-500/30">
                          {v.category}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-[var(--text-muted)] font-mono">{v.plateNo ?? 'No plate'}</span>
                      <span className="px-2 py-0.5 rounded text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">Available</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {result === null && !loading && (
        <div className="bg-[var(--bg-surface)]/30 border border-[var(--border-subtle)] rounded-2xl p-12 text-center text-[var(--text-faint)]">
          Select a date range and click "Check Availability" to see available vehicles
        </div>
      )}
    </div>
  );
}
