import { NextRequest, NextResponse } from 'next/server';
import { requireAdminPermission } from '@/lib/admin-policy';
import { STATUS_TRANSITIONS, canonicalModuleKey } from '@/lib/cross-module-governance';

const MODULES = [
  { key: 'fleet', label: 'Fleet Management', guardedRoutes: ['/api/fleet/vehicles'], tenantBoundary: true, audit: true, statusLifecycle: true },
  { key: 'rac', label: 'RAC / Rental', guardedRoutes: ['/api/rental/bookings'], tenantBoundary: true, audit: true, statusLifecycle: true },
  { key: 'finance', label: 'Finance', guardedRoutes: ['/api/finance/invoices'], tenantBoundary: true, audit: true, statusLifecycle: true },
  { key: 'service_tickets', label: 'Service Tickets', guardedRoutes: ['/api/service-tickets'], tenantBoundary: true, audit: true, statusLifecycle: true },
  { key: 'leasing', label: 'Leasing', guardedRoutes: [], tenantBoundary: false, audit: false, statusLifecycle: false },
  { key: 'bus_ops', label: 'Bus Ops / Staff Transport', guardedRoutes: [], tenantBoundary: false, audit: false, statusLifecycle: false },
  { key: 'drivers', label: 'Drivers', guardedRoutes: [], tenantBoundary: false, audit: false, statusLifecycle: false },
  { key: 'maintenance', label: 'Maintenance', guardedRoutes: [], tenantBoundary: false, audit: false, statusLifecycle: false },
  { key: 'reports', label: 'Reports', guardedRoutes: [], tenantBoundary: false, audit: false, statusLifecycle: false },
] as const;

export async function GET(req: NextRequest) {
  const auth = await requireAdminPermission(req, 'view', 'platform');
  if (auth instanceof NextResponse) return auth;

  const rows = MODULES.map(module => {
    const score =
      (module.tenantBoundary ? 25 : 0) +
      (module.audit ? 25 : 0) +
      (module.statusLifecycle ? 20 : 0) +
      (module.guardedRoutes.length ? 20 : 0) +
      (canonicalModuleKey(module.key) ? 10 : 0);
    return {
      ...module,
      score,
      status: score >= 80 ? 'HARDENED' : score >= 40 ? 'PARTIAL' : 'GAP',
      gaps: [
        module.tenantBoundary ? null : 'Tenant boundary guard not wired yet',
        module.audit ? null : 'Operational mutations need before/after audit',
        module.statusLifecycle ? null : 'Status lifecycle transitions need enforcement',
        module.guardedRoutes.length ? null : 'No guarded route converted yet',
      ].filter(Boolean),
    };
  });

  return NextResponse.json({
    summary: {
      modules: rows.length,
      hardened: rows.filter(row => row.status === 'HARDENED').length,
      partial: rows.filter(row => row.status === 'PARTIAL').length,
      gaps: rows.filter(row => row.status === 'GAP').length,
      statusModels: Object.keys(STATUS_TRANSITIONS),
    },
    modules: rows,
    nextFixOrder: rows
      .filter(row => row.status !== 'HARDENED')
      .sort((a, b) => a.score - b.score)
      .map(row => row.key),
  }, {
    headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=120' },
  });
}
