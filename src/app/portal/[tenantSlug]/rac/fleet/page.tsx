'use client';

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { BACK_BUTTON } from '@/lib/ui/toggle';
import { useTenantPortal } from '../../tenant-portal-shell';
import { useVerifiedPortalTenant } from '../_use-verified-portal-tenant';

interface VehicleRow {
  id: string;
  make?: string | null;
  model?: string | null;
  year?: number | string | null;
  licensePlate?: string | null;
  license_plate?: string | null;
  vin?: string | null;
  status?: string | null;
  vehicleType?: string | null;
  vehicle_type?: string | null;
  vehicleClass?: string | null;
  vehicle_class?: string | null;
  vehicleGroup?: string | null;
  vehicle_group?: string | null;
  type?: string | null;
  vehicleUsage?: string | null;
  vehicle_usage?: string | null;
  fuelType?: string | null;
  mileage?: number | string | null;
  currentMileage?: number | string | null;
  current_mileage?: number | string | null;
  odometerReading?: number | string | null;
  odometer_reading?: number | string | null;
}

function unwrapVehicles(payload: unknown): VehicleRow[] {
  if (Array.isArray(payload)) return payload as VehicleRow[];
  if (payload && typeof payload === 'object') {
    const rec = payload as Record<string, unknown>;
    for (const k of ['data', 'vehicles', 'items', 'rows']) {
      if (Array.isArray(rec[k])) return rec[k] as VehicleRow[];
    }
  }
  return [];
}

const STATUS_BADGE: Record<string, string> = {
  AVAILABLE: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  ACTIVE: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  RENTED: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  ALLOCATED: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  IN_MAINTENANCE: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  MAINTENANCE: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  RETIRED: 'bg-slate-500/20 text-slate-400 border-slate-600',
};

export default function PortalRacFleetPage() {
  const params = useParams() ?? {};
  const slug = (params?.tenantSlug as string) ?? '';
  const { tenant: contextTenant } = useTenantPortal();
  const guard = useVerifiedPortalTenant(slug);

  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/vehicles?limit=200', { cache: 'no-store' });
      const data = res.ok ? await res.json() : [];
      const racOnly = unwrapVehicles(data).filter((v) => {
        const usage = v.vehicleUsage ?? v.vehicle_usage;
        return !usage || String(usage).toUpperCase() === 'RENTAL';
      });
      setVehicles(racOnly);
    } catch {
      setVehicles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (guard.status !== 'verified') return;
    load();
  }, [guard.status, load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vehicles.filter((v) => {
      const st = (v.status ?? 'AVAILABLE').toUpperCase();
      if (statusFilter !== 'ALL' && st !== statusFilter) return false;
      if (!q) return true;
      const plate = v.licensePlate ?? v.license_plate ?? '';
      const hay = `${v.make ?? ''} ${v.model ?? ''} ${plate} ${v.vin ?? ''} ${v.vehicleType ?? v.vehicle_type ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [vehicles, search, statusFilter]);

  if (guard.status === 'checking') {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (guard.status === 'mismatch') {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div role="alert" className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6 space-y-3">
          <p className="text-rose-300 font-semibold text-base">Tenant Access Mismatch</p>
          <p className="text-slate-300 text-sm">
            Your signed-in session belongs to <span className="font-semibold text-white">{guard.tenant.name}</span>
            {guard.tenant.slug ? ` (${guard.tenant.slug})` : ''}, which does not match{' '}
            <span className="font-mono text-rose-200">/portal/{slug}/rac/fleet</span>. Cross-tenant fleet data display has been blocked.
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            {guard.expectedSlug && (
              <Link
                href={`/portal/${guard.expectedSlug}/rac/fleet`}
                className="px-4 py-2 rounded-xl bg-cyan-500 text-slate-950 text-xs font-bold hover:bg-cyan-400 transition-colors"
              >
                Switch to /portal/{guard.expectedSlug}/rac/fleet →
              </Link>
            )}
            <Link
              href="/platform"
              className="px-4 py-2 rounded-xl bg-slate-800 text-slate-200 border border-white/10 text-xs font-semibold hover:bg-slate-700 transition-colors"
            >
              Back to Platform
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (guard.status === 'unauthorized') {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div role="alert" className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-6 space-y-3">
          <p className="text-amber-300 font-semibold text-base">Authentication Required</p>
          <p className="text-slate-300 text-sm">
            Unable to verify your tenant session for <span className="font-mono text-amber-200">/portal/{slug}/rac/fleet</span>.
          </p>
          <Link
            href="/login"
            className="inline-flex items-center px-4 py-2 rounded-xl bg-amber-500 text-slate-950 text-xs font-bold hover:bg-amber-400 transition-colors"
          >
            Go to Staff Sign In →
          </Link>
        </div>
      </div>
    );
  }

  const displayTenantName = guard.tenant.name || contextTenant?.name || slug;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <Link href={`/portal/${slug}/rac`} className={BACK_BUTTON}>
            ← Back to RAC Overview
          </Link>
          <h1 className="text-2xl font-bold text-white mt-1">🚘 RAC Fleet Vehicles</h1>
          <p className="text-sm text-slate-400 mt-1">
            {displayTenantName} · {filtered.length} of {vehicles.length} vehicle{vehicles.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href="/rac-portal"
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-sm font-medium hover:bg-emerald-500/30 transition-colors"
          >
            🏢 Customer B2B Portal ↗
          </a>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search plate, make, model, VIN, or category…"
          className="flex-1 min-w-[240px] px-4 py-2 rounded-xl bg-slate-800/80 border border-slate-700 text-sm text-white placeholder:text-slate-500"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-xl bg-slate-800/80 border border-slate-700 text-sm text-slate-200"
        >
          <option value="ALL">All Statuses</option>
          <option value="AVAILABLE">Available</option>
          <option value="RENTED">Rented</option>
          <option value="ALLOCATED">Allocated</option>
          <option value="IN_MAINTENANCE">In Maintenance</option>
        </select>
      </div>

      <div className="rounded-2xl border border-white/8 bg-slate-800/20 overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-slate-400 text-sm">Loading fleet vehicles…</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-slate-400 text-sm">
            No vehicles match your current filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-800/60 border-b border-white/5 text-xs text-slate-400 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">Plate</th>
                  <th className="px-4 py-3 text-left">Vehicle</th>
                  <th className="px-4 py-3 text-left">Category</th>
                  <th className="px-4 py-3 text-left">Usage</th>
                  <th className="px-4 py-3 text-right">Mileage</th>
                  <th className="px-4 py-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((v) => {
                  const plate = v.licensePlate ?? v.license_plate ?? '—';
                  const cat = v.vehicleType ?? v.vehicle_type ?? v.vehicleClass ?? v.vehicle_class ?? v.vehicleGroup ?? v.vehicle_group ?? v.type ?? '—';
                  const usage = v.vehicleUsage ?? v.vehicle_usage ?? 'RENTAL';
                  const st = (v.status ?? 'AVAILABLE').toUpperCase();
                  const rawKm =
                    v.mileage ??
                    v.currentMileage ??
                    v.odometerReading ??
                    v.current_mileage ??
                    v.odometer_reading;
                  const kmNum = rawKm != null && rawKm !== '' ? Number(rawKm) : NaN;
                  return (
                    <tr key={v.id} className="border-b border-white/5 hover:bg-slate-800/40 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-cyan-400">{plate}</td>
                      <td className="px-4 py-3 text-white font-medium">
                        {[v.make, v.model, v.year].filter(Boolean).join(' ') || '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-300 text-xs">{cat}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{usage}</td>
                      <td className="px-4 py-3 text-right text-slate-300 text-xs">
                        {!Number.isNaN(kmNum) ? `${kmNum.toLocaleString()} km` : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${STATUS_BADGE[st] ?? 'bg-slate-700 text-slate-300 border-slate-600'}`}>
                          {st}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
