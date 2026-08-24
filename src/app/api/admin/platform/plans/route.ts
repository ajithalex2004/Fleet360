/**
 * Platform plans — admin CRUD.
 *
 * GET  /api/admin/platform/plans        — list ALL plans (active + inactive)
 * POST /api/admin/platform/plans        — create a new plan
 *
 * PATCH /api/admin/platform/plans/[code]
 * DELETE /api/admin/platform/plans/[code]
 *
 * SUPER_ADMIN only. The x-user-role header is set by the middleware
 * from the signed session cookie. A per-tenant role with code=SUPER_ADMIN
 * is NOT a platform admin — only the system-wide role grants this.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { listPlans, invalidatePlanCache } from '@/lib/plans';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
function requireSuperAdmin(req: NextRequest): { ok: true; userId: string } | { ok: false; res: NextResponse } {
  const role   = req.headers.get('x-user-role')   ?? '';
  const userId = req.headers.get('x-user-id')     ?? '';
  if (role !== 'SUPER_ADMIN') {
    return {
      ok: false,
      res: NextResponse.json(
        { error: 'Forbidden', message: 'Platform admin only. Requires a system-wide SUPER_ADMIN role.' },
        { status: 403 },
      ),
    };
  }
  if (!userId) {
    return { ok: false, res: NextResponse.json({ error: 'No session' }, { status: 401 }) };
  }
  return { ok: true, userId };
}

// ── GET — list all plans (admin sees inactive too) ────────────────────────
export async function GET(req: NextRequest) {
  const auth = requireSuperAdmin(req);
  if (!auth.ok) return auth.res;
  try {
    const plans = await listPlans({ activeOnly: false });
    return NextResponse.json({ plans });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

// ── POST — create a new plan ───────────────────────────────────────────────
interface CreateBody {
  code?: string;
  name?: string;
  priceLabel?: string;
  description?: string;
  highlight?: boolean;
  sortOrder?: number;
  maxUsers?: number;
  maxVehicles?: number;
  maxBookingsPerMonth?: number;
  premiumModules?: string[];
  ssoEnabled?: boolean;
  apiKeysEnabled?: boolean;
  brandingEnabled?: boolean;
}

export async function POST(req: NextRequest) {
  const auth = requireSuperAdmin(req);
  if (!auth.ok) return auth.res;

  let body: CreateBody;
  try {
    body = await req.json() as CreateBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Validate required fields + the code shape (uppercase alphanumeric + underscore)
  const code = String(body.code ?? '').trim().toUpperCase();
  if (!code || !/^[A-Z0-9_]{2,32}$/.test(code)) {
    return NextResponse.json(
      { error: 'code is required and must match /^[A-Z0-9_]{2,32}$/' },
      { status: 400 },
    );
  }
  if (!body.name || !body.priceLabel || !body.description) {
    return NextResponse.json(
      { error: 'name, priceLabel, description are required' },
      { status: 400 },
    );
  }
  const requiredQuotas = {
    maxUsers:              body.maxUsers,
    maxVehicles:           body.maxVehicles,
    maxBookingsPerMonth:   body.maxBookingsPerMonth,
  };
  for (const [k, v] of Object.entries(requiredQuotas)) {
    if (typeof v !== 'number' || v <= 0 || !Number.isFinite(v)) {
      return NextResponse.json(
        { error: `${k} must be a positive finite number` },
        { status: 400 },
      );
    }
  }

  try {
    const result = await withPlatformAdmin(prisma, async (tx) => {
      const exists = await tx.$queryRawUnsafe<{ code: string }[]>(
        `SELECT code FROM platform_plans WHERE code = $1`,
        code,
      );
      if (exists.length) {
        return { conflict: true as const };
      }
      await tx.$executeRawUnsafe(
        `INSERT INTO platform_plans
           (code, name, price_label, description, highlight, sort_order,
            max_users, max_vehicles, max_bookings_per_month,
            premium_modules, sso_enabled, api_keys_enabled, branding_enabled,
            is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, true)`,
        code,
        body.name,
        body.priceLabel,
        body.description,
        !!body.highlight,
        body.sortOrder ?? 0,
        body.maxUsers!,
        body.maxVehicles!,
        body.maxBookingsPerMonth!,
        body.premiumModules ?? [],
        !!body.ssoEnabled,
        !!body.apiKeysEnabled,
        !!body.brandingEnabled,
      );
      return { ok: true as const, code };
    });

    if (result.conflict) {
      return NextResponse.json({ error: `Plan "${code}" already exists` }, { status: 409 });
    }
    invalidatePlanCache();
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
