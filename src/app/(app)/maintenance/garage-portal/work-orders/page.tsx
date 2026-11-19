'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { MaintenanceRequest, MaintenanceStatus } from '@/types/maintenance';

interface GarageOption {
  id: string;
  name: string;
  location?: string | null;
}

interface AuthMeInfo {
  tenantName?: string;
  role?: string;
  email?: string;
}

interface ExtendedMaintenanceRequest extends MaintenanceRequest {
  Garage?: { id: string; name: string; location?: string | null } | null;
  garage?: { id: string; name: string; location?: string | null } | null;
}

const WORK_ORDER_STATUSES = new Set<string>([
  MaintenanceStatus.UNDER_MAINTENANCE,
  MaintenanceStatus.REPAIR_COMPLETED,
  MaintenanceStatus.QUALITY_INSPECTION,
  MaintenanceStatus.INSPECTION_FAILED,
  MaintenanceStatus.READY_FOR_SERVICE,
  MaintenanceStatus.MAINTENANCE_COMPLETED,
  MaintenanceStatus.PENDING_INVOICE,
  MaintenanceStatus.INVOICE_SUBMITTED,
  MaintenanceStatus.CLOSED,
]);

export default function GarageWorkOrdersPage() {
  const router = useRouter();
  const [workOrders, setWorkOrders] = useState<ExtendedMaintenanceRequest[]>([]);
  const [garages, setGarages] = useState<GarageOption[]>([]);
  const [authInfo, setAuthInfo] = useState<AuthMeInfo | null>(null);
  const [selectedGarageId, setSelectedGarageId] = useState<string>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('All Status');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [reqRes, garRes, meRes] = await Promise.all([
        fetch('/api/maintenance-requests', { cache: 'no-store' }),
        fetch('/api/garages', { cache: 'no-store' }),
        fetch('/api/auth/me', { cache: 'no-store' }).catch(() => null),
      ]);

      if (!reqRes.ok) {
        const body = await reqRes.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load work orders (${reqRes.status})`);
      }

      const requestsPayload = await reqRes.json();
      const requestsList: ExtendedMaintenanceRequest[] = Array.isArray(requestsPayload)
        ? requestsPayload
        : Array.isArray(requestsPayload?.data)
          ? requestsPayload.data
          : [];

      const workOrderRequests = requestsList.filter(
        (r) => Boolean(r.garageId) && WORK_ORDER_STATUSES.has(String(r.status)),
      );
      setWorkOrders(workOrderRequests);

      if (garRes.ok) {
        const garagesPayload = await garRes.json();
        const garagesList: GarageOption[] = Array.isArray(garagesPayload)
          ? garagesPayload
          : Array.isArray(garagesPayload?.data)
            ? garagesPayload.data
            : [];
        setGarages(garagesList);
      }

      if (meRes && meRes.ok) {
        const mePayload = await meRes.json().catch(() => null);
        if (mePayload) setAuthInfo(mePayload);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load garage work orders';
      console.error('Error loading work orders:', err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const paramGarage = new URLSearchParams(window.location.search).get('garageId');
      if (paramGarage) {
        setSelectedGarageId(paramGarage);
      }
    }
    loadData();
  }, [loadData]);

  const garageMap = useMemo(() => {
    const map: Record<string, GarageOption> = {};
    for (const g of garages) {
      map[g.id] = g;
    }
    return map;
  }, [garages]);

  const activeGarageLabel =
    selectedGarageId === 'ALL'
      ? 'All Garages'
      : garageMap[selectedGarageId]?.name || selectedGarageId;

  const filteredWorkOrders = useMemo(() => {
    const q = searchFilter.trim().toLowerCase();
    return workOrders.filter((wo) => {
      const matchesGarage = selectedGarageId === 'ALL' || wo.garageId === selectedGarageId;
      const matchesSearch =
        q === '' ||
        wo.id.toLowerCase().includes(q) ||
        (wo.workOrderNo ?? '').toLowerCase().includes(q) ||
        (wo.description ?? '').toLowerCase().includes(q);
      const matchesDate = dateFilter === '' || String(wo.requestDate ?? '').startsWith(dateFilter);
      const matchesStatus = statusFilter === 'All Status' || wo.status === statusFilter;
      return matchesGarage && matchesSearch && matchesDate && matchesStatus;
    });
  }, [workOrders, selectedGarageId, searchFilter, dateFilter, statusFilter]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-surface)]/50 text-[var(--text-faint)]">
        Loading garage work orders...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-surface)]/50">
      <header className="flex items-center justify-between px-4 py-3 bg-[var(--bg-surface)] shadow-sm md:px-6 sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-[var(--bg-surface-hover)] flex items-center justify-center text-[var(--text-main)] text-xs font-bold">
            G
          </div>
          <div className="font-semibold text-[var(--text-main)] text-sm md:text-base">
            Garage Portal — {activeGarageLabel}
          </div>
        </div>
        <div className="text-xs text-[var(--text-faint)] md:text-sm">
          {authInfo?.tenantName ? (
            <>
              Tenant: <span className="font-medium text-[var(--text-main)]">{authInfo.tenantName}</span>
              {authInfo.role ? ` (${authInfo.role})` : ''}
            </>
          ) : (
            <span className="font-medium text-[var(--text-main)]">Live Work Orders</span>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        <div className="space-y-4">
          {error && (
            <div
              role="alert"
              className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 flex items-center justify-between gap-4"
            >
              <span>{error}</span>
              <button
                type="button"
                onClick={loadData}
                className="px-3 py-1 rounded-md bg-red-600 text-white text-xs font-medium hover:bg-red-700"
              >
                Retry
              </button>
            </div>
          )}

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <h2 className="text-2xl font-bold text-[var(--text-main)]">Work Orders</h2>
            <div className="flex flex-col sm:flex-row flex-wrap gap-2 text-sm">
              <select
                aria-label="Filter by garage"
                value={selectedGarageId}
                onChange={(e) => setSelectedGarageId(e.target.value)}
                className="px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] focus:outline-none focus:ring-2 focus:ring-slate-900 text-[var(--text-main)]"
              >
                <option value="ALL">All Garages</option>
                {garages.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Search WO or Description..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="px-3 py-2 rounded-lg border border-[var(--border-subtle)] focus:outline-none focus:ring-2 focus:ring-slate-900 w-full sm:w-56 text-[var(--text-main)]"
              />
              <input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="px-3 py-2 rounded-lg border border-[var(--border-subtle)] focus:outline-none focus:ring-2 focus:ring-slate-900 text-[var(--text-main)]"
              />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] focus:outline-none focus:ring-2 focus:ring-slate-900 text-[var(--text-main)]"
              >
                <option value="All Status">All Status</option>
                <option value={MaintenanceStatus.UNDER_MAINTENANCE}>{MaintenanceStatus.UNDER_MAINTENANCE}</option>
                <option value={MaintenanceStatus.REPAIR_COMPLETED}>{MaintenanceStatus.REPAIR_COMPLETED}</option>
                <option value={MaintenanceStatus.QUALITY_INSPECTION}>{MaintenanceStatus.QUALITY_INSPECTION}</option>
                <option value={MaintenanceStatus.INSPECTION_FAILED}>{MaintenanceStatus.INSPECTION_FAILED}</option>
                <option value={MaintenanceStatus.READY_FOR_SERVICE}>{MaintenanceStatus.READY_FOR_SERVICE}</option>
                <option value={MaintenanceStatus.MAINTENANCE_COMPLETED}>{MaintenanceStatus.MAINTENANCE_COMPLETED}</option>
                <option value={MaintenanceStatus.PENDING_INVOICE}>{MaintenanceStatus.PENDING_INVOICE}</option>
                <option value={MaintenanceStatus.INVOICE_SUBMITTED}>{MaintenanceStatus.INVOICE_SUBMITTED}</option>
                <option value={MaintenanceStatus.CLOSED}>Closed</option>
              </select>
            </div>
          </div>

          {!error && filteredWorkOrders.length === 0 ? (
            <div className="text-center py-12 bg-[var(--bg-surface)] rounded-2xl shadow-sm">
              <p className="text-[var(--text-faint)]">No work orders found.</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredWorkOrders.map((wo) => {
                const garageName =
                  wo.Garage?.name ||
                  wo.garage?.name ||
                  (wo.garageId ? garageMap[wo.garageId]?.name : undefined) ||
                  'Assigned Garage';
                return (
                  <div
                    key={wo.id}
                    onClick={() => router.push(`/maintenance/work-orders/${encodeURIComponent(wo.id)}`)}
                    className="bg-[var(--bg-surface)] rounded-xl shadow-sm p-5 cursor-pointer hover:shadow-md transition-shadow border border-transparent hover:border-blue-500/30 group"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <span className="font-mono text-xs font-medium text-[var(--text-faint)] bg-[var(--bg-surface-hover)]/40 px-2 py-1 rounded">
                        {wo.workOrderNo || `WO-${wo.id.toUpperCase()}`}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          wo.status === MaintenanceStatus.MAINTENANCE_COMPLETED ||
                          wo.status === MaintenanceStatus.READY_FOR_SERVICE
                            ? 'bg-emerald-500/10 text-green-700'
                            : wo.status === MaintenanceStatus.UNDER_MAINTENANCE
                              ? 'bg-blue-500/10 text-blue-700'
                              : 'bg-[var(--bg-surface-hover)]/40 text-[var(--text-muted)]'
                        }`}
                      >
                        {wo.status}
                      </span>
                    </div>
                    <h3 className="font-semibold text-[var(--text-main)] mb-1 group-hover:text-blue-600 transition-colors line-clamp-1">
                      {wo.description}
                    </h3>
                    <div className="text-xs text-[var(--text-faint)] mb-1">{garageName}</div>
                    <div className="text-xs text-[var(--text-faint)] mb-4">
                      Started: {wo.requestDate ? new Date(wo.requestDate).toLocaleDateString() : 'N/A'}
                    </div>
                    <div className="flex items-center justify-between pt-3 border-t border-[var(--border-subtle)]">
                      <span className="text-xs font-medium text-[var(--text-faint)]">Open Work Order</span>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1.5}
                        stroke="currentColor"
                        className="w-4 h-4 text-[var(--text-muted)] group-hover:text-blue-500"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                      </svg>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      <footer className="py-3 text-center text-[11px] text-[var(--text-muted)]">Powered by Fleet360</footer>
    </div>
  );
}
