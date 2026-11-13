'use client';
import React, { useState, useCallback } from 'react';
import Link from 'next/link';
import { KpiCard, StatGrid } from '@/components/ui/page-theme';
import {
  RENTAL_VEHICLE_CATEGORIES,
  formatRentalCategoryLabel,
} from '@/lib/rental/categories';

interface Vehicle {
  id: string;
  make: string;
  model: string;
  year?: number;
  plateNumber?: string;
  plateNo?: string;
  plate_no?: string;
  vehicleType?: string;
  category?: string;
  color?: string;
  status?: string;
}

interface AvailabilityResult {
  available: number;
  booked: number;
  vehicles: Vehicle[];
}

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
    if (endDate < startDate) {
      setError('Return date cannot be earlier than pickup date');
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
      const vehicles: Vehicle[] = Array.isArray(data?.vehicles)
        ? data.vehicles
        : Array.isArray(data?.data)
          ? data.data
          : Array.isArray(data)
            ? data
            : [];
      setResult({
        available: typeof data?.available === 'number' ? data.available : vehicles.length,
        booked: typeof data?.booked === 'number' ? data.booked : 0,
        vehicles,
      });
    } catch {
      setError('Failed to check availability');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, category]);

  const days =
    startDate && endDate && endDate >= startDate
      ? Math.max(
          1,
          Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000)
        )
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
              {RENTAL_VEHICLE_CATEGORIES.map((cat) => {
                const code =
                  typeof (cat as unknown) === 'string'
                    ? String(cat)
                    : String(
                        (cat as { value?: string; code?: string }).value ??
                          (cat as { code?: string }).code ??
                          ''
                      );
                return (
                  <option key={code} value={code}>
                    {formatRentalCategoryLabel(code)}
                  </option>
                );
              })}
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
          <StatGrid cols={2}>
            <KpiCard label="Available Vehicles" value={result.available} accent="emerald" />
            <KpiCard label="Booked / Unavailable" value={result.booked} accent="rose" />
          </StatGrid>

          {/* Vehicle List */}
          {result.vehicles.length === 0 ? (
            <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-12 text-center text-[var(--text-muted)]">
              No vehicles available for the selected period{category ? ` in the ${formatRentalCategoryLabel(category)} category` : ''}.
            </div>
          ) : (
            <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6 backdrop-blur-sm">
              <h2 className="text-lg font-semibold text-[var(--text-main)] mb-4">Available Vehicles</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {result.vehicles.map(v => {
                  const vehCat = v.vehicleType ?? v.category ?? '';
                  const plateLabel = v.plateNumber ?? v.plateNo ?? v.plate_no ?? 'No plate';
                  return (
                    <div key={v.id} className="bg-[var(--bg-surface-hover)]/50 border border-[var(--border-subtle)] rounded-xl p-4 hover:border-emerald-500/50 transition-all flex flex-col justify-between">
                      <div>
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <div className="font-semibold text-[var(--text-main)]">{v.make} {v.model}</div>
                            <div className="text-sm text-[var(--text-muted)]">{v.year ?? ''} {v.color ? `· ${v.color}` : ''}</div>
                          </div>
                          {vehCat && (
                            <span className="px-2 py-0.5 rounded text-xs bg-blue-500/20 text-blue-400 border border-blue-500/30">
                              {formatRentalCategoryLabel(vehCat)}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-[var(--text-muted)] font-mono">{plateLabel}</span>
                          <span className="px-2 py-0.5 rounded text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">Available</span>
                        </div>
                      </div>
                      <Link
                        href={`/rental/bookings?vehicleId=${encodeURIComponent(v.id)}&category=${encodeURIComponent(vehCat)}&pickupDate=${encodeURIComponent(startDate)}&dropoffDate=${encodeURIComponent(endDate)}`}
                        className="mt-4 w-full inline-flex items-center justify-center px-3 py-2 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 text-xs font-semibold transition-colors"
                      >
                        Book Vehicle →
                      </Link>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {result === null && !loading && (
        <div className="bg-[var(--bg-surface)]/30 border border-[var(--border-subtle)] rounded-2xl p-12 text-center text-[var(--text-faint)]">
          Select a date range and click &quot;Check Availability&quot; to see available vehicles
        </div>
      )}
    </div>
  );
}
