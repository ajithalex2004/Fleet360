/**
 * Access control utilities — role + plan based permissions.
 *
 * Rules:
 *  - SUPER_ADMIN: full access to everything
 *  - TENANT_ADMIN on TRIAL plan: read-only everywhere EXCEPT the 'fleet' module
 *  - TENANT_ADMIN on paid plan: full write access to their tenant's data
 *
 * "Module" maps to URL prefixes:
 *   fleet      → /fleet, /api/fleet, /api/vehicles, /api/drivers
 *   rac        → /rac, /api/rac
 *   leasing    → /leasing, /api/leasing
 *   logistics  → /logistics, /api/logistics, /api/trips
 *   finance    → /finance, /api/finance
 *   school-bus → /school-bus, /api/school-bus
 *   ambulance  → /ambulance, /api/ambulance, /api/incidents
 *   dispatch   → /dispatch, /api/dispatch
 *   staff      → /staff-transport, /api/staff
 *   admin      → /admin, /api/admin
 */

export const TRIAL_FREE_MODULES = ['fleet'] as const;

export type AppModule =
  | 'fleet' | 'rac' | 'leasing' | 'logistics' | 'finance'
  | 'school-bus' | 'ambulance' | 'dispatch' | 'staff' | 'admin';

/**
 * Returns true if the user can perform write operations (POST/PUT/PATCH/DELETE)
 * for the given module based on their plan and role.
 */
export function canWrite(plan: string, role: string, module: AppModule): boolean {
  if (role === 'SUPER_ADMIN') return true;
  if (plan !== 'TRIAL') return true;
  // Trial plan: only fleet is writable
  return TRIAL_FREE_MODULES.includes(module as typeof TRIAL_FREE_MODULES[number]);
}

/**
 * Derives the module from an API pathname.
 * Returns null if module cannot be determined.
 */
export function moduleFromPath(pathname: string): AppModule | null {
  if (pathname.startsWith('/api/vehicles') || pathname.startsWith('/api/fleet') || pathname.startsWith('/api/drivers'))
    return 'fleet';
  if (pathname.startsWith('/api/rac') || pathname.startsWith('/api/rental')) return 'rac';
  if (pathname.startsWith('/api/leasing'))    return 'leasing';
  if (pathname.startsWith('/api/logistics') || pathname.startsWith('/api/trips'))
    return 'logistics';
  if (pathname.startsWith('/api/finance') || pathname.startsWith('/api/invoice'))
    return 'finance';
  if (pathname.startsWith('/api/school-bus') || pathname.startsWith('/api/bus-ops') || pathname.startsWith('/api/students') || pathname.startsWith('/api/routes'))
    return 'school-bus';
  if (pathname.startsWith('/api/ambulance') || pathname.startsWith('/api/incidents'))
    return 'ambulance';
  if (pathname.startsWith('/api/dispatch'))   return 'dispatch';
  if (pathname.startsWith('/api/staff'))      return 'staff';
  if (pathname.startsWith('/api/admin') || pathname.startsWith('/api/service-tickets') || pathname.startsWith('/api/reports')) return 'admin';
  return null;
}

/**
 * Guard for use in API route handlers.
 * Call at the top of any write handler (POST/PUT/PATCH/DELETE).
 *
 * Usage:
 *   import { assertCanWrite, moduleFromPath } from '@/lib/access-control';
 *   const guard = assertCanWrite(request, 'fleet');
 *   if (guard) return guard; // returns 403 NextResponse
 */
import { NextRequest, NextResponse } from 'next/server';

export function assertCanWrite(
  request: NextRequest,
  module: AppModule,
): NextResponse | null {
  const plan = request.headers.get('x-tenant-plan') ?? 'TRIAL';
  const role = request.headers.get('x-user-role')   ?? 'TENANT_ADMIN';

  if (canWrite(plan, role, module)) return null; // allowed

  return NextResponse.json(
    {
      error:   'Forbidden',
      message: `Your Free Trial plan is read-only for the ${module} module. Upgrade your plan to enable this action.`,
      code:    'TRIAL_READ_ONLY',
    },
    { status: 403 },
  );
}
