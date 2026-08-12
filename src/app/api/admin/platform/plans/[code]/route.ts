/**
 * Single plan — PATCH / DELETE.
 *
 * PATCH  /api/admin/platform/plans/[code]   — partial update; any subset of fields
 * DELETE /api/admin/platform/plans/[code]   — soft delete (sets is_active = false)
 *
 * SUPER_ADMIN only. Hard delete is intentionally not exposed: the rule
 * is that a plan can be retired (is_active=false) but never destroyed,
 * because tenants still reference the plan code and we need history.
 * To fully remove, use a DB migration + cache invalidation manually.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { invalidatePlanCache } from '@/lib/plans';

interface RouteParams { params: Promise<{ code: string }>; }

function requireSuperAdmin(req: NextRequest): { ok: true; userId: string } | { ok: false; res: NextResponse } {
  const role   = req.headers.get('x-user-role')   ?? '';
  const userId = req.headers.get('x-user-id')     ?? '';
  if (role !== 'SUPER_ADMIN') {
    return {
      ok: false,
      res: NextResponse.json(
        { error: 'Forbidden', message: 'Platform admin only.' },
        { status: 403 },
      ),
    };
  }
  if (!userId) {
    return { ok: false, res: NextResponse.json({ error: 'No session' }, { status: 401 }) };
  }
  return { ok: true, userId };
}

// ── PATCH — partial update ─────────────────────────────────────────────────
interface UpdateBody {
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
  isActive?: boolean;
}

const UPDATABLE: Array<keyof UpdateBody> = [
  'name', 'priceLabel', 'description', 'highlight', 'sortOrder',
  'maxUsers', 'maxVehicles', 'maxBookingsPerMonth',
  'premiumModules', 'ssoEnabled', 'apiKeysEnabled', 'brandingEnabled', 'isActive',
];

const COL_MAP: Record<keyof UpdateBody, string> = {
  name:               'name',
  priceLabel:         'price_label',
  description:        'description',
  highlight:          'highlight',
  sortOrder:          'sort_order',
  maxUsers:           'max_users',
  maxVehicles:        'max_vehicles',
  maxBookingsPerMonth:'max_bookings_per_month',
  premiumModules:     'premium_modules',
  ssoEnabled:         'sso_enabled',
  apiKeysEnabled:     'api_keys_enabled',
  brandingEnabled:    'branding_enabled',
  isActive:           'is_active',
};

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const auth = requireSuperAdmin(req);
  if (!auth.ok) return auth.res;
  const { code: rawCode } = await params;
  const code = String(rawCode ?? '').trim().toUpperCase();
  if (!code) {
    return NextResponse.json({ error: 'code is required' }, { status: 400 });
  }

  let body: UpdateBody;
  try {
    body = await req.json() as UpdateBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Build a SET clause from the keys that are actually present
  const setClauses: string[] = [];
  const values: unknown[] = [];
  for (const k of UPDATABLE) {
    if (!(k in body)) continue;
    const v = body[k];
    if (k === 'maxUsers' || k === 'maxVehicles' || k === 'maxBookingsPerMonth') {
      if (typeof v !== 'number' || v <= 0 || !Number.isFinite(v)) {
        return NextResponse.json({ error: `${k} must be a positive finite number` }, { status: 400 });
      }
    }
    setClauses.push(`${COL_MAP[k]} = $${values.length + 1}`);
    values.push(v);
  }
  if (setClauses.length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
  }
  values.push(code); // for the WHERE

  try {
    const result = await withPlatformAdmin(prisma, async (tx) => {
      const r = await tx.$executeRawUnsafe(
        `UPDATE platform_plans SET ${setClauses.join(', ')} WHERE code = $${values.length}`,
        ...values,
      );
      return r;
    });
    if (result === 0) {
      return NextResponse.json({ error: `Plan "${code}" not found` }, { status: 404 });
    }
    invalidatePlanCache();
    return NextResponse.json({ ok: true, updated: code });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

// ── DELETE — soft delete ───────────────────────────────────────────────────
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const auth = requireSuperAdmin(req);
  if (!auth.ok) return auth.res;
  const { code: rawCode } = await params;
  const code = String(rawCode ?? '').trim().toUpperCase();
  if (!code) {
    return NextResponse.json({ error: 'code is required' }, { status: 400 });
  }

  try {
    const result = await withPlatformAdmin(prisma, async (tx) => {
      const r = await tx.$executeRawUnsafe(
        `UPDATE platform_plans SET is_active = false WHERE code = $1`,
        code,
      );
      return r;
    });
    if (result === 0) {
      return NextResponse.json({ error: `Plan "${code}" not found` }, { status: 404 });
    }
    invalidatePlanCache();
    return NextResponse.json({ ok: true, retired: code });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
